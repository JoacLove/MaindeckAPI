#!/usr/bin/env node
/**
 * Local / publish-app HTTP server for Maindeck API browser.
 * Secrets stay in env (Cursor Secrets); never printed.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as md from "./lib/maindeck.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT) || 3000;

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  res.end(text);
}

function handleError(res, err) {
  if (err instanceof md.ConfigError) {
    return sendJson(res, err.statusCode, {
      ok: false,
      error: "config_missing",
      message: err.message,
      secrets: ["MAINDECK_CLIENT_ID", "MAINDECK_CLIENT_SECRET"],
      token_url: md.constants.TOKEN_URL,
      token_expires_in_sec: md.constants.TOKEN_EXPIRES_HINT_SEC,
    });
  }
  if (err instanceof md.MaindeckApiError) {
    return sendJson(res, err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 502, {
      ok: false,
      error: "maindeck_api",
      message: err.message,
      details:
        err.body && typeof err.body === "object"
          ? {
              error: err.body.error,
              error_description: err.body.error_description,
              message: err.body.message,
            }
          : undefined,
    });
  }
  console.error("Unhandled error:", err?.message || err);
  return sendJson(res, 500, { ok: false, error: "internal", message: "Unexpected server error" });
}

async function ok(res, data) {
  return sendJson(res, 200, { ok: true, data });
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".png": "image/png",
      ".woff2": "font/woff2",
    }[ext] || "application/octet-stream"
  );
}

function serveStatic(req, res, urlPath) {
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safe === "/" || safe === "" ? "index.html" : safe);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, "Forbidden");
  fs.readFile(filePath, (err, data) => {
    if (err) return sendText(res, 404, "Not found");
    sendText(res, 200, data, contentTypeFor(filePath));
  });
}

/** Match /api/... patterns and dispatch. Returns true if handled. */
async function handleApi(req, res, pathname) {
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return true;
  }

  try {
    if (pathname === "/api/health" || pathname === "/health") {
      let configured = false;
      try {
        md.requireCredentials();
        configured = true;
      } catch {
        configured = false;
      }
      sendJson(res, 200, {
        ok: true,
        service: "maindeck-api",
        configured,
        token_url: md.constants.TOKEN_URL,
        api_base: md.constants.API_BASE,
        token_expires_in_sec: md.constants.TOKEN_EXPIRES_HINT_SEC,
      });
      return true;
    }

    if (pathname === "/api/me") {
      await ok(res, await md.getMe());
      return true;
    }

    if (pathname === "/api/teams") {
      await ok(res, await md.listTeams());
      return true;
    }

    if (pathname === "/api/projects") {
      await ok(res, await md.listAllProjects());
      return true;
    }

    let m;

    m = pathname.match(/^\/api\/teams\/([^/]+)$/);
    if (m) {
      await ok(res, await md.getTeam(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/teams\/([^/]+)\/projects$/);
    if (m) {
      await ok(res, await md.listTeamProjects(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/teams\/([^/]+)\/ships$/);
    if (m) {
      await ok(res, await md.listTeamShips(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/teams\/([^/]+)\/inspections$/);
    if (m) {
      await ok(res, await md.listTeamInspections(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/teams\/([^/]+)\/inspection_templates$/);
    if (m) {
      await ok(res, await md.listTeamInspectionTemplates(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/teams\/([^/]+)\/offices$/);
    if (m) {
      await ok(res, await md.listTeamOffices(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/teams\/([^/]+)\/owner_supply_categories$/);
    if (m) {
      await ok(res, await md.listTeamOwnerSupplyCategories(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (m) {
      await ok(res, await md.getProject(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/projects\/([^/]+)\/work_orders$/);
    if (m) {
      await ok(res, await md.listProjectWorkOrders(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/projects\/([^/]+)\/groups$/);
    if (m) {
      await ok(res, await md.listProjectGroups(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/projects\/([^/]+)\/owners$/);
    if (m) {
      await ok(res, await md.listProjectOwners(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/projects\/([^/]+)\/owner_supplies$/);
    if (m) {
      await ok(res, await md.listProjectOwnerSupplies(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/work_orders\/([^/]+)$/);
    if (m) {
      await ok(res, await md.getWorkOrder(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/work_orders\/([^/]+)\/work_done_report$/);
    if (m) {
      await ok(res, await md.getWorkDoneReport(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/work_orders\/([^/]+)\/owner_supplies$/);
    if (m) {
      await ok(res, await md.listWorkOrderOwnerSupplies(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/ships\/([^/]+)$/);
    if (m) {
      await ok(res, await md.getShip(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/groups\/([^/]+)$/);
    if (m) {
      await ok(res, await md.getGroup(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/inspections\/([^/]+)$/);
    if (m) {
      await ok(res, await md.getInspection(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/inspections\/([^/]+)\/items$/);
    if (m) {
      await ok(res, await md.listInspectionItems(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/inspection_templates\/([^/]+)$/);
    if (m) {
      await ok(res, await md.getInspectionTemplate(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/owner_supplies\/([^/]+)$/);
    if (m) {
      await ok(res, await md.getOwnerSupply(decodeURIComponent(m[1])));
      return true;
    }

    m = pathname.match(/^\/api\/owner_supply_categories\/([^/]+)$/);
    if (m) {
      await ok(res, await md.getOwnerSupplyCategory(decodeURIComponent(m[1])));
      return true;
    }

    return false;
  } catch (err) {
    handleError(res, err);
    return true;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const { pathname } = url;

  if (pathname.startsWith("/api/") || pathname === "/health") {
    const handled = await handleApi(req, res, pathname);
    if (handled) return;
    return sendJson(res, 404, { ok: false, error: "not_found" });
  }

  if (req.method === "GET") return serveStatic(req, res, pathname);
  sendJson(res, 405, { ok: false, error: "method_not_allowed" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Maindeck API browser listening on http://127.0.0.1:${PORT}`);
  try {
    md.requireCredentials();
    console.log("Credentials: MAINDECK_CLIENT_ID / MAINDECK_CLIENT_SECRET are set");
  } catch {
    console.log("Credentials: not set — /api/* returns a clear config error until secrets are bound");
  }
});
