/**
 * Maindeck production OAuth (client credentials) + REST helpers.
 * Secrets: MAINDECK_CLIENT_ID, MAINDECK_CLIENT_SECRET (never logged).
 * Docs: https://developers.maindeck.io/llms.txt
 */

const TOKEN_URL = "https://app.maindeck.io/oauth/token";
const API_BASE = "https://app.maindeck.io/api/v1";
const DEFAULT_SCOPE = "read";
/** Access tokens expire in 7200s; refresh a little early. */
const EXPIRY_SKEW_MS = 60_000;
const DEFAULT_PER_PAGE = 100;

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

  const data = await parseBody(res);
  if (!res.ok) {
    const desc =
      data.error_description || data.error || `HTTP ${res.status} from token endpoint`;
    throw new MaindeckApiError(`OAuth token request failed: ${desc}`, res.status, data);
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
 * @param {string} path e.g. "/me" or "/teams/…/projects"
 * @param {Record<string, string|number|undefined>} [query]
 */
export async function apiGet(path, query = {}) {
  const token = await getAccessToken();
  const url = new URL(
    path.startsWith("http")
      ? path
      : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`
  );
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/vnd.api+json, application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await parseBody(res);
  if (!res.ok) {
    const msg =
      (data && (data.error || data.message || data.errors?.[0]?.detail)) ||
      `Maindeck API HTTP ${res.status}`;
    throw new MaindeckApiError(String(msg), res.status, data);
  }
  return data;
}

/** Flatten JSON:API resource(s) into plain objects with id + attributes. */
export function unwrap(payload) {
  if (!payload) return null;
  if (Array.isArray(payload.data)) {
    return payload.data.map(flattenResource);
  }
  if (payload.data && typeof payload.data === "object") {
    return flattenResource(payload.data);
  }
  if (Array.isArray(payload)) return payload;
  return payload;
}

function flattenResource(resource) {
  if (!resource || typeof resource !== "object") return resource;
  const attrs = resource.attributes && typeof resource.attributes === "object"
    ? resource.attributes
    : {};
  return {
    id: resource.id ?? attrs.id,
    type: resource.type,
    ...attrs,
    relationships: resource.relationships || undefined,
  };
}

/**
 * Fetch every page for a list endpoint (JSON:API data arrays).
 * Stops when a page returns fewer than per_page items or an empty page.
 */
export async function apiGetAll(path, query = {}, { perPage = DEFAULT_PER_PAGE, maxPages = 50 } = {}) {
  const items = [];
  let page = 1;
  while (page <= maxPages) {
    const payload = await apiGet(path, { ...query, page, per_page: perPage });
    const batch = unwrap(payload);
    const list = Array.isArray(batch) ? batch : batch ? [batch] : [];
    items.push(...list);
    if (list.length < perPage) break;
    page += 1;
  }
  return items;
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

// —— High-level read helpers ——

export async function getMe() {
  return unwrap(await apiGet("/me"));
}

export async function listTeams() {
  return apiGetAll("/teams");
}

export async function getTeam(teamId) {
  return unwrap(await apiGet(`/teams/${teamId}`));
}

export async function listTeamProjects(teamId) {
  return apiGetAll(`/teams/${teamId}/projects`);
}

export async function listTeamShips(teamId) {
  return apiGetAll(`/teams/${teamId}/ships`);
}

export async function listTeamInspections(teamId) {
  return apiGetAll(`/teams/${teamId}/inspections`);
}

export async function listTeamInspectionTemplates(teamId) {
  return apiGetAll(`/teams/${teamId}/inspection_templates`);
}

export async function listTeamOffices(teamId) {
  return apiGetAll(`/teams/${teamId}/offices`);
}

export async function listTeamOwnerSupplyCategories(teamId) {
  return apiGetAll(`/teams/${teamId}/owner_supply_categories`);
}

export async function getProject(projectId) {
  return unwrap(await apiGet(`/projects/${projectId}`));
}

export async function listProjectWorkOrders(projectId) {
  return apiGetAll(`/projects/${projectId}/work_orders`);
}

export async function listProjectGroups(projectId) {
  return apiGetAll(`/projects/${projectId}/groups`);
}

export async function listProjectOwners(projectId) {
  return apiGetAll(`/projects/${projectId}/owners`);
}

export async function listProjectOwnerSupplies(projectId) {
  return apiGetAll(`/projects/${projectId}/owner_supplies`);
}

export async function getWorkOrder(workOrderId) {
  return unwrap(await apiGet(`/work_orders/${workOrderId}`));
}

export async function getWorkDoneReport(workOrderId) {
  return unwrap(await apiGet(`/work_orders/${workOrderId}/work_done_report`));
}

export async function listWorkOrderOwnerSupplies(workOrderId) {
  return apiGetAll(`/work_orders/${workOrderId}/owner_supplies_work_orders`);
}

export async function getShip(shipId) {
  return unwrap(await apiGet(`/ships/${shipId}`));
}

export async function getGroup(groupId) {
  return unwrap(await apiGet(`/groups/${groupId}`));
}

export async function getInspection(inspectionId) {
  return unwrap(await apiGet(`/inspections/${inspectionId}`));
}

export async function listInspectionItems(inspectionId) {
  return apiGetAll(`/inspections/${inspectionId}/items`);
}

export async function getInspectionTemplate(templateId) {
  return unwrap(await apiGet(`/inspection_templates/${templateId}`));
}

export async function getOwnerSupply(id) {
  return unwrap(await apiGet(`/owner_supplies/${id}`));
}

export async function getOwnerSupplyCategory(id) {
  return unwrap(await apiGet(`/owner_supply_categories/${id}`));
}

/** All projects across every team the credentials can access. */
export async function listAllProjects() {
  const teams = await listTeams();
  const projects = [];
  for (const team of teams) {
    const teamId = team.id;
    if (!teamId) continue;
    const list = await listTeamProjects(teamId);
    for (const p of list) {
      projects.push({
        ...p,
        team_id: p.team_id ?? teamId,
        team_name: team.name ?? team.title ?? null,
      });
    }
  }
  return { teams_count: teams.length, projects_count: projects.length, teams, projects };
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
