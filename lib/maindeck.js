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

/** Safe path id: UUID or simple slug/id — blocks traversal and open redirects. */
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate a single route id before it is joined into an upstream path.
 * @param {string} raw
 * @returns {string}
 */
export function assertSafeId(raw) {
  const id = String(raw ?? "").trim();
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..") || id.includes(":")) {
    throw new MaindeckApiError("Invalid resource id", 400, { error: "invalid_id" });
  }
  if (!(UUID_RE.test(id) || SAFE_ID_RE.test(id))) {
    throw new MaindeckApiError("Invalid resource id", 400, { error: "invalid_id" });
  }
  return id;
}

/**
 * Build a relative API path from fixed segments + validated ids.
 * Never accepts absolute URLs or user-controlled hosts.
 * @param {string[]} parts e.g. ["work_orders", id, "cost_items"]
 */
export function safeApiPath(...parts) {
  const segs = parts.map((p, i) => {
    const s = String(p ?? "").replace(/^\/+|\/+$/g, "");
    if (!s || s.includes("..") || s.includes(":") || s.includes("//")) {
      throw new MaindeckApiError("Invalid API path", 400, { error: "invalid_path" });
    }
    // Even indices in helpers are usually static resource names; still reject traversal.
    if (i % 2 === 1 || UUID_RE.test(s) || SAFE_ID_RE.test(s)) {
      if (i % 2 === 1) return assertSafeId(s);
      // static segment: letters, underscores only
      if (!/^[a-z][a-z0-9_]*$/i.test(s) && !UUID_RE.test(s)) {
        return assertSafeId(s);
      }
      return s;
    }
    if (!/^[a-z][a-z0-9_]*$/i.test(s)) {
      throw new MaindeckApiError("Invalid API path", 400, { error: "invalid_path" });
    }
    return s;
  });
  return `/${segs.join("/")}`;
}

/**
 * Authenticated GET against Maindeck REST API v1.
 * Path must be relative under /api/v1 — absolute URLs are rejected (SSRF guard).
 * @param {string} path e.g. "/me" or "/teams/…/projects"
 * @param {Record<string, string|number|undefined>} [query]
 */
export async function apiGet(path, query = {}) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || /https?:/i.test(path)) {
    throw new MaindeckApiError("Refusing non-relative API path", 400, { error: "invalid_path" });
  }
  if (path.includes("..")) {
    throw new MaindeckApiError("Refusing path traversal", 400, { error: "invalid_path" });
  }

  const token = await getAccessToken();
  const url = new URL(`${API_BASE}${path}`);
  if (url.origin !== "https://app.maindeck.io" || !url.pathname.startsWith("/api/v1")) {
    throw new MaindeckApiError("Refusing unexpected upstream host", 400, { error: "invalid_path" });
  }
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
  return unwrap(await apiGet(safeApiPath("teams", assertSafeId(teamId))));
}

export async function listTeamProjects(teamId) {
  return apiGetAll(safeApiPath("teams", assertSafeId(teamId), "projects"));
}

export async function listTeamShips(teamId) {
  return apiGetAll(safeApiPath("teams", assertSafeId(teamId), "ships"));
}

export async function listTeamInspections(teamId) {
  return apiGetAll(safeApiPath("teams", assertSafeId(teamId), "inspections"));
}

export async function listTeamInspectionTemplates(teamId) {
  return apiGetAll(safeApiPath("teams", assertSafeId(teamId), "inspection_templates"));
}

export async function listTeamOffices(teamId) {
  return apiGetAll(safeApiPath("teams", assertSafeId(teamId), "offices"));
}

export async function listTeamOwnerSupplyCategories(teamId) {
  return apiGetAll(safeApiPath("teams", assertSafeId(teamId), "owner_supply_categories"));
}

export async function getProject(projectId) {
  return unwrap(await apiGet(safeApiPath("projects", assertSafeId(projectId))));
}

export async function listProjectWorkOrders(projectId) {
  return apiGetAll(safeApiPath("projects", assertSafeId(projectId), "work_orders"));
}

export async function listProjectGroups(projectId) {
  return apiGetAll(safeApiPath("projects", assertSafeId(projectId), "groups"));
}

export async function listProjectOwners(projectId) {
  return apiGetAll(safeApiPath("projects", assertSafeId(projectId), "owners"));
}

export async function listProjectOwnerSupplies(projectId) {
  return apiGetAll(safeApiPath("projects", assertSafeId(projectId), "owner_supplies"));
}

/**
 * Owner supplies for a project, enriched with category names when team categories are known.
 */
export async function listProjectOwnerSuppliesEnriched(projectId, teamId) {
  const supplies = await listProjectOwnerSupplies(projectId);
  let categories = [];
  if (teamId) {
    try {
      categories = await listTeamOwnerSupplyCategories(teamId);
    } catch {
      categories = [];
    }
  }
  const byId = new Map(categories.map((c) => [String(c.id), c]));
  const items = supplies.map((s) => {
    const cat =
      byId.get(String(s.category_id)) ||
      byId.get(String(s.relationships?.category?.data?.id));
    return {
      ...s,
      category_name: s.category_name || cat?.name || cat?.title || null,
      category_id: s.category_id || cat?.id || null,
    };
  });
  return { items, categories };
}

export async function getWorkOrder(workOrderId) {
  return unwrap(await apiGet(safeApiPath("work_orders", assertSafeId(workOrderId))));
}

export async function getWorkDoneReport(workOrderId) {
  return unwrap(
    await apiGet(safeApiPath("work_orders", assertSafeId(workOrderId), "work_done_report"))
  );
}

export async function listWorkOrderOwnerSupplies(workOrderId) {
  return apiGetAll(
    safeApiPath("work_orders", assertSafeId(workOrderId), "owner_supplies_work_orders")
  );
}

/**
 * Cost / estimation lines on a work order.
 * Public Integration Hub docs do not list these; live GET candidates return 404.
 * We still try known MCP-aligned paths and nested payload keys, then report availability.
 */
export async function listWorkOrderCostItems(workOrderId) {
  const id = assertSafeId(workOrderId);
  const candidates = [
    safeApiPath("work_orders", id, "cost_items"),
    safeApiPath("work_orders", id, "costs"),
    safeApiPath("work_orders", id, "estimation_items"),
    safeApiPath("work_orders", id, "estimation_lines"),
  ];

  for (const path of candidates) {
    try {
      const items = await apiGetAll(path);
      return {
        available: true,
        source: path,
        items: Array.isArray(items) ? items : [],
        note: null,
      };
    } catch (err) {
      if (err instanceof MaindeckApiError && err.statusCode === 404) continue;
      if (err instanceof MaindeckApiError && err.statusCode === 400) throw err;
      // Other errors (403/401/500): stop and surface
      if (err instanceof MaindeckApiError && err.statusCode !== 404) {
        return {
          available: false,
          source: path,
          items: [],
          note: err.message,
          status: err.statusCode,
        };
      }
    }
  }

  // Fall back: inspect work order + work_done_report for nested estimation arrays
  let nested = [];
  let wo = null;
  try {
    wo = await getWorkOrder(id);
    nested = extractCostLikeArrays(wo);
  } catch {
    /* ignore */
  }
  try {
    const report = await getWorkDoneReport(id);
    nested = nested.concat(extractCostLikeArrays(report));
  } catch {
    /* ignore */
  }

  if (nested.length) {
    return {
      available: true,
      source: "nested",
      items: nested,
      note: "Derived from work order / work-done payload (no dedicated cost_items list endpoint).",
      work_order: wo,
    };
  }

  return {
    available: false,
    source: null,
    items: [],
    note:
      "Cost items are not exposed as a readable Integration Hub REST list (live paths 404). " +
      "MCP tools mention add/update cost item, but no public GET is documented in llms.txt.",
    work_order: wo,
  };
}

function extractCostLikeArrays(obj) {
  if (!obj || typeof obj !== "object") return [];
  const keys = [
    "cost_items",
    "costs",
    "estimation_items",
    "estimation_lines",
    "estimate_lines",
    "line_items",
  ];
  const out = [];
  for (const k of keys) {
    if (Array.isArray(obj[k])) {
      for (const row of obj[k]) out.push({ ...row, _from: k });
    }
  }
  return out;
}

export async function getShip(shipId) {
  return unwrap(await apiGet(safeApiPath("ships", assertSafeId(shipId))));
}

export async function getGroup(groupId) {
  return unwrap(await apiGet(safeApiPath("groups", assertSafeId(groupId))));
}

export async function getInspection(inspectionId) {
  return unwrap(await apiGet(safeApiPath("inspections", assertSafeId(inspectionId))));
}

export async function listInspectionItems(inspectionId) {
  return apiGetAll(safeApiPath("inspections", assertSafeId(inspectionId), "items"));
}

export async function getInspectionTemplate(templateId) {
  return unwrap(
    await apiGet(safeApiPath("inspection_templates", assertSafeId(templateId)))
  );
}

export async function getOwnerSupply(id) {
  return unwrap(await apiGet(safeApiPath("owner_supplies", assertSafeId(id))));
}

export async function getOwnerSupplyCategory(id) {
  return unwrap(await apiGet(safeApiPath("owner_supply_categories", assertSafeId(id))));
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
