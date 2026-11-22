/**
 * Maindeck production client — GET-only Integration Hub.
 * Secrets: MAINDECK_CLIENT_ID, MAINDECK_CLIENT_SECRET (never logged).
 */

const DEFAULT_BASE = "https://app.maindeck.io";
const DEFAULT_SCOPE = "read";
const TOKEN_SKEW_SEC = 300;
const DEFAULT_PER_PAGE = 100;
const MAX_PAGES = 50;

export const ALLOWED_ROOTS = new Set([
  "me",
  "teams",
  "projects",
  "groups",
  "ships",
  "work_orders",
  "owner_supplies",
  "owner_supply_categories",
  "owner_supplies_work_orders",
  "inspections",
  "inspection_templates",
]);

const PATH_RE = /^[a-z_]+(\/[A-Za-z0-9_-]+)*$/;

let cachedToken = null;
let cachedExpiresAt = 0;
let workingTokenMethod = null;

let ratesCache = { at: 0, base: "USD", rates: {}, asOf: null };

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
    this.statusCode = 503;
  }
}

export class MaindeckApiError extends Error {
  constructor(message, statusCode, body) {
    super(message);
    this.name = "MaindeckApiError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

export function baseUrl() {
  return (process.env.MAINDECK_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
}

export function requireCredentials() {
  const clientId = process.env.MAINDECK_CLIENT_ID?.trim();
  const clientSecret = process.env.MAINDECK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new ConfigError(
      "Missing Maindeck credentials. Set MAINDECK_CLIENT_ID and MAINDECK_CLIENT_SECRET."
    );
  }
  return { clientId, clientSecret };
}

/** Validate a relative Hub path (no leading slash). */
export function assertAllowedPath(raw) {
  const path = String(raw ?? "")
    .trim()
    .replace(/^\/+/, "");
  if (!path || path.includes("..") || path.includes(":") || path.includes("//") || !PATH_RE.test(path)) {
    throw new MaindeckApiError("Path not allowed", 400, { error: "invalid_path" });
  }
  const root = path.split("/")[0];
  if (!ALLOWED_ROOTS.has(root)) {
    throw new MaindeckApiError("Path not on allowlist", 400, { error: "invalid_path" });
  }
  return path;
}

async function parseBody(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function requestToken(method) {
  const { clientId, clientSecret } = requireCredentials();
  const url = `${baseUrl()}/oauth/token`;

  if (method === "json") {
    return fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: DEFAULT_SCOPE,
      }),
    });
  }

  if (method === "basic") {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    return fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: DEFAULT_SCOPE,
      }),
    });
  }

  // form
  return fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: DEFAULT_SCOPE,
    }),
  });
}

export function clearTokenCache() {
  cachedToken = null;
  cachedExpiresAt = 0;
}

export async function getAccessToken({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && cachedToken && now < cachedExpiresAt) return cachedToken;

  requireCredentials();
  const order = workingTokenMethod
    ? [workingTokenMethod, "json", "basic", "form"].filter(
        (v, i, a) => a.indexOf(v) === i
      )
    : ["json", "basic", "form"];

  let lastErr = null;
  for (const method of order) {
    const res = await requestToken(method);
    const data = await parseBody(res);
    if (res.ok && data.access_token) {
      workingTokenMethod = method;
      const expiresIn = Number(data.expires_in) || 7200;
      cachedToken = data.access_token;
      cachedExpiresAt = now + Math.max(60, expiresIn - TOKEN_SKEW_SEC) * 1000;
      return cachedToken;
    }
    lastErr = data;
    if (!(res.status === 401 || data.error === "invalid_client")) {
      throw new MaindeckApiError(
        data.error_description || data.error || `Token HTTP ${res.status}`,
        res.status,
        { error: data.error }
      );
    }
  }
  throw new MaindeckApiError(
    lastErr?.error_description || lastErr?.error || "OAuth token request failed",
    401,
    { error: lastErr?.error || "invalid_client" }
  );
}

async function fetchWith429(url, headers, attempt = 0) {
  const res = await fetch(url, { method: "GET", headers });
  if (res.status === 429 && attempt < 4) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = (Number.isFinite(retryAfter) ? retryAfter : 2 * (attempt + 1)) * 1000;
    await new Promise((r) => setTimeout(r, waitMs));
    return fetchWith429(url, headers, attempt + 1);
  }
  return res;
}

/**
 * GET one page from Hub.
 * @param {string} path relative allowlisted path
 * @param {Record<string,string|number>} [params]
 */
export async function apiGet(path, params = {}, { retried = false } = {}) {
  const safe = assertAllowedPath(path);
  const token = await getAccessToken();
  const url = new URL(`${baseUrl()}/api/v1/${safe}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  if (url.origin !== new URL(baseUrl()).origin || !url.pathname.startsWith("/api/v1/")) {
    throw new MaindeckApiError("Refusing unexpected upstream", 400, { error: "invalid_path" });
  }

  const headers = {
    Accept: "application/vnd.api+json",
    Authorization: `Bearer ${token}`,
  };
  const res = await fetchWith429(url, headers);
  const body = await parseBody(res);

  if (res.status === 401 && !retried) {
    clearTokenCache();
    await getAccessToken({ forceRefresh: true });
    return apiGet(path, params, { retried: true });
  }

  if (!res.ok) {
    throw new MaindeckApiError(
      body.error || body.message || body.errors?.[0]?.detail || `Maindeck HTTP ${res.status}`,
      res.status,
      { error: body.error }
    );
  }

  return { status: res.status, body, url: url.toString() };
}

/** Paginate until short page or MAX_PAGES. */
export async function apiGetAll(path, params = {}) {
  const data = [];
  const included = [];
  let meta = {};
  let truncated = false;
  let page = 1;

  while (page <= MAX_PAGES) {
    const { body, url, status } = await apiGet(path, {
      ...params,
      page,
      per_page: DEFAULT_PER_PAGE,
    });
    const batch = Array.isArray(body.data) ? body.data : body.data ? [body.data] : [];
    data.push(...batch);
    if (Array.isArray(body.included)) included.push(...body.included);
    if (body.meta) meta = { ...meta, ...body.meta };
    if (batch.length < DEFAULT_PER_PAGE) {
      return {
        status,
        body: { data, included, meta, truncated },
        url,
      };
    }
    page += 1;
  }
  truncated = true;
  return {
    status: 200,
    body: { data, included, meta, truncated },
    url: `${baseUrl()}/api/v1/${assertAllowedPath(path)}`,
  };
}

export function unwrapResources(payload) {
  const rows = Array.isArray(payload?.data)
    ? payload.data
    : payload?.data
      ? [payload.data]
      : [];
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    ...(r.attributes || {}),
    relationships: r.relationships,
  }));
}

export async function getUsdRates() {
  const now = Date.now();
  if (ratesCache.at && now - ratesCache.at < 6 * 60 * 60 * 1000 && ratesCache.rates) {
    return ratesCache;
  }
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD");
    const data = await parseBody(res);
    if (res.ok && data.rates) {
      ratesCache = {
        at: now,
        base: "USD",
        rates: data.rates,
        asOf: data.date || new Date().toISOString().slice(0, 10),
        source: "frankfurter",
      };
      return ratesCache;
    }
  } catch {
    /* fall through */
  }
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = await parseBody(res);
    if (res.ok && data.rates) {
      ratesCache = {
        at: now,
        base: "USD",
        rates: data.rates,
        asOf: data.time_last_update_utc || new Date().toISOString().slice(0, 10),
        source: "open.er-api",
      };
      return ratesCache;
    }
  } catch {
    /* ignore */
  }
  if (ratesCache.rates && Object.keys(ratesCache.rates).length) return ratesCache;
  throw new MaindeckApiError("Could not fetch FX rates", 502, { error: "fx_unavailable" });
}

export const constants = {
  DEFAULT_BASE,
  TOKEN_EXPIRES_HINT_SEC: 7200,
  ALLOWED_ROOTS: [...ALLOWED_ROOTS],
};
