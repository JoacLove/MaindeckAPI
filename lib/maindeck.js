/**
 * Maindeck production OAuth (client credentials) + REST helpers.
 * Secrets: MAINDECK_CLIENT_ID, MAINDECK_CLIENT_SECRET (never logged).
 */

const TOKEN_URL = "https://app.maindeck.io/oauth/token";
const API_BASE = "https://app.maindeck.io/api/v1";
const DEFAULT_SCOPE = "read";
/** Access tokens expire in 7200s; refresh a little early. */
const EXPIRY_SKEW_MS = 60_000;

let cachedToken = null;
let cachedExpiresAt = 0;

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

/**
 * @returns {{ clientId: string, clientSecret: string }}
 */
export function requireCredentials() {
  const clientId = process.env.MAINDECK_CLIENT_ID?.trim();
  const clientSecret = process.env.MAINDECK_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new ConfigError(
      "Missing Maindeck credentials. Set MAINDECK_CLIENT_ID and MAINDECK_CLIENT_SECRET " +
        "(Cursor Secrets / local env). Values are never hardcoded. " +
        "Token URL: https://app.maindeck.io/oauth/token (client_credentials, scope=read; expires_in typically 7200)."
    );
  }

  return { clientId, clientSecret };
}

/**
 * Fetch a Bearer access token (cached until near expiry).
 * @param {{ scope?: string, forceRefresh?: boolean }} [opts]
 */
export async function getAccessToken(opts = {}) {
  const scope = opts.scope ?? DEFAULT_SCOPE;
  const now = Date.now();

  if (!opts.forceRefresh && cachedToken && now < cachedExpiresAt - EXPIRY_SKEW_MS) {
    return cachedToken;
  }

  const { clientId, clientSecret } = requireCredentials();

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const desc =
      data.error_description || data.error || `HTTP ${res.status} from token endpoint`;
    throw new MaindeckApiError(
      `OAuth token request failed: ${desc}`,
      res.status,
      data
    );
  }

  if (!data.access_token) {
    throw new MaindeckApiError("Token response missing access_token", 502, data);
  }

  const expiresInSec = Number(data.expires_in) || 7200;
  cachedToken = data.access_token;
  cachedExpiresAt = now + expiresInSec * 1000;

  return cachedToken;
}

/**
 * Authenticated GET against Maindeck REST API v1.
 * @param {string} path e.g. "/me" or "/teams"
 */
export async function apiGet(path) {
  const token = await getAccessToken();
  const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg =
      (data && (data.error || data.message)) || `Maindeck API HTTP ${res.status}`;
    throw new MaindeckApiError(String(msg), res.status, data);
  }

  return data;
}

export async function getMe() {
  return apiGet("/me");
}

export async function listTeams() {
  return apiGet("/teams");
}

/**
 * List projects: fetch teams, then projects for each team id.
 */
export async function listProjects() {
  const teamsPayload = await listTeams();
  const teams = normalizeList(teamsPayload, "teams");

  const projects = [];
  for (const team of teams) {
    const id = team?.id ?? team?.uuid;
    if (id == null) continue;
    const payload = await apiGet(`/teams/${id}/projects`);
    const list = normalizeList(payload, "projects");
    for (const p of list) {
      projects.push({ ...p, team_id: id, team_name: team.name ?? team.title });
    }
  }

  return { teams_count: teams.length, projects_count: projects.length, projects };
}

function normalizeList(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload[key])) return payload[key];
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}

export function clearTokenCache() {
  cachedToken = null;
  cachedExpiresAt = 0;
}

export const constants = {
  TOKEN_URL,
  API_BASE,
  DEFAULT_SCOPE,
  TOKEN_EXPIRES_HINT_SEC: 7200,
};
