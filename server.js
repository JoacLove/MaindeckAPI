#!/usr/bin/env node
/**
 * Maindeck Reader server — allowlisted GET proxy + static UI.
 * Secrets stay in env; never printed.
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
    });
  }
  if (err instanceof md.MaindeckApiError) {
    return sendJson(res, err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 502, {
      ok: false,
      error: err.body?.error || "maindeck_api",
      message: err.message,
      status: err.statusCode,
    });
  }
  console.error("Unhandled error:", err?.message || err);
  return sendJson(res, 500, { ok: false, error: "internal", message: "Unexpected server error" });
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
    }[ext] || "application/octet-stream"
  );
}

function serveStatic(res, urlPath) {
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safe === "/" || safe === "" ? "index.html" : safe);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, "Forbidden");
  fs.readFile(filePath, (err, data) => {
    if (err) return sendText(res, 404, "Not found");
    sendText(res, 200, data, contentTypeFor(filePath));
  });
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const { pathname } = url;

  try {
    if (pathname === "/health" || pathname === "/api/health") {
      let configured = false;
      try {
        md.requireCredentials();
        configured = true;
      } catch {
        configured = false;
      }
      return sendJson(res, 200, {
        ok: true,
        service: "maindeck-api",
        configured,
        base: md.baseUrl(),
        allowlist: md.constants.ALLOWED_ROOTS,
      });
    }

    if (pathname === "/api/rates" && req.method === "GET") {
      const rates = await md.getUsdRates();
      return sendJson(res, 200, {
        ok: true,
        data: {
          base: rates.base,
          rates: rates.rates,
          asOf: rates.asOf,
          source: rates.source,
        },
      });
    }

    // Unified allowlisted proxy (GET-only to Maindeck)
    if (pathname === "/api/proxy") {
      if (req.method !== "POST") {
        return sendJson(res, 405, { ok: false, error: "method_not_allowed", message: "Use POST" });
      }
      const input = await readJson(req);
      const pathStr = input.path;
      const params = input.params && typeof input.params === "object" ? input.params : {};
      const all = Boolean(input.all);
      md.assertAllowedPath(pathStr);
      const result = all
        ? await md.apiGetAll(pathStr, params)
        : await md.apiGet(pathStr, params);
      return sendJson(res, 200, {
        ok: true,
        status: result.status,
        body: result.body,
        url: result.url,
      });
    }

    // Convenience GETs used by the UI (still allowlisted server-side)
    if (req.method === "GET" && pathname === "/api/me") {
      const result = await md.apiGet("me");
      return sendJson(res, 200, { ok: true, data: md.unwrapResources(result.body)[0] || result.body });
    }

    if (req.method === "GET" && pathname === "/api/teams") {
      const result = await md.apiGetAll("teams");
      return sendJson(res, 200, { ok: true, data: md.unwrapResources(result.body), truncated: result.body.truncated });
    }

    if (req.method === "GET" && pathname.startsWith("/api/")) {
      return sendJson(res, 404, {
        ok: false,
        error: "not_found",
        message: "Use POST /api/proxy with { path, params?, all? }",
      });
    }

    if (req.method === "GET") return serveStatic(res, pathname);
    return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return sendJson(res, 400, { ok: false, error: "bad_json", message: "Invalid JSON body" });
    }
    return handleError(res, err);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Maindeck Reader listening on http://127.0.0.1:${PORT}`);
  try {
    md.requireCredentials();
    console.log("Credentials: configured");
  } catch {
    console.log("Credentials: not set — API returns config_missing until secrets are bound");
  }
});
