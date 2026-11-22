#!/usr/bin/env node
/**
 * Local / publish-app HTTP server for Maindeck API helper.
 * Secrets stay in env (Cursor Secrets); never printed.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConfigError,
  MaindeckApiError,
  constants,
  getMe,
  listProjects,
  listTeams,
  requireCredentials,
} from "./lib/maindeck.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT) || 3000;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  res.end(text);
}

function handleError(res, err) {
  if (err instanceof ConfigError) {
    return sendJson(res, err.statusCode, {
      ok: false,
      error: "config_missing",
      message: err.message,
      secrets: ["MAINDECK_CLIENT_ID", "MAINDECK_CLIENT_SECRET"],
      token_url: constants.TOKEN_URL,
      token_expires_in_sec: constants.TOKEN_EXPIRES_HINT_SEC,
    });
  }
  if (err instanceof MaindeckApiError) {
    return sendJson(res, err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 502, {
      ok: false,
      error: "maindeck_api",
      message: err.message,
      // Do not echo bodies that might contain tokens; only high-level error fields.
      details: err.body && typeof err.body === "object"
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

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  };
  return map[ext] || "application/octet-stream";
}

function serveStatic(req, res, urlPath) {
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safe === "/" || safe === "" ? "index.html" : safe);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, "Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (urlPath === "/" || urlPath === "/index.html") {
        return sendText(res, 404, "index.html missing");
      }
      return sendText(res, 404, "Not found");
    }
    sendText(res, 200, data, contentTypeFor(filePath));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/health") {
    let configured = false;
    try {
      requireCredentials();
      configured = true;
    } catch {
      configured = false;
    }
    return sendJson(res, 200, {
      ok: true,
      service: "maindeck-api",
      configured,
      token_url: constants.TOKEN_URL,
      api_base: constants.API_BASE,
      token_expires_in_sec: constants.TOKEN_EXPIRES_HINT_SEC,
    });
  }

  if (req.method === "GET" && pathname === "/api/me") {
    try {
      const data = await getMe();
      return sendJson(res, 200, { ok: true, data });
    } catch (err) {
      return handleError(res, err);
    }
  }

  if (req.method === "GET" && pathname === "/api/teams") {
    try {
      const data = await listTeams();
      return sendJson(res, 200, { ok: true, data });
    } catch (err) {
      return handleError(res, err);
    }
  }

  if (req.method === "GET" && pathname === "/api/projects") {
    try {
      const data = await listProjects();
      return sendJson(res, 200, { ok: true, data });
    } catch (err) {
      return handleError(res, err);
    }
  }

  if (req.method === "GET") {
    return serveStatic(req, res, pathname);
  }

  sendJson(res, 405, { ok: false, error: "method_not_allowed" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Maindeck API helper listening on http://127.0.0.1:${PORT}`);
  console.log(`Routes: /  /health  /api/me  /api/teams  /api/projects`);
  try {
    requireCredentials();
    console.log("Credentials: MAINDECK_CLIENT_ID / MAINDECK_CLIENT_SECRET are set");
  } catch {
    console.log(
      "Credentials: not set — /api/* will return a clear config error until secrets are bound"
    );
  }
});
