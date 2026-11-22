/**
 * Maindeck browser client — talks only to same-origin /api/* (no secrets).
 */

const openBtn = document.getElementById("openBtn");
const reloadBtn = document.getElementById("reloadBtn");
const workspace = document.getElementById("workspace");
const hero = document.getElementById("hero");
const banner = document.getElementById("banner");
const teamSelect = document.getElementById("teamSelect");
const projectSelect = document.getElementById("projectSelect");
const meChip = document.getElementById("meChip");
const listHost = document.getElementById("listHost");
const detailHost = document.getElementById("detailHost");
const jobsMeta = document.getElementById("jobsMeta");
const detailMeta = document.getElementById("detailMeta");
const tabs = document.getElementById("resourceTabs");

const state = {
  me: null,
  teams: [],
  projectsByTeam: new Map(),
  allProjects: [],
  shipsByTeam: new Map(),
  inspectionsByTeam: new Map(),
  activeTab: "jobs",
  selectedTeamId: null,
  selectedProjectId: null,
  selectedItemId: null,
  workOrders: [],
  groups: [],
  supplies: [],
  loading: false,
};

async function api(path) {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok || (body && body.ok === false)) {
    const err = new Error(
      (body && body.message) || `Request failed (${res.status})`
    );
    err.status = res.status;
    err.code = body?.error;
    err.body = body;
    throw err;
  }
  return body?.data ?? body;
}

function showBanner(message, kind = "err") {
  banner.textContent = message;
  banner.className = `banner show${kind === "warn" ? " warn" : ""}`;
}

function clearBanner() {
  banner.className = "banner";
  banner.textContent = "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function progressHtml(progress) {
  const n = Math.max(0, Math.min(100, Number(progress) || 0));
  return `<span class="progress" title="${n}%"><span class="progress-track"><span class="progress-fill" style="width:${n}%"></span></span><span>${n}%</span></span>`;
}

function setLoading(isLoading) {
  state.loading = isLoading;
  openBtn.disabled = isLoading;
  reloadBtn.disabled = isLoading;
  teamSelect.disabled = isLoading || state.teams.length === 0;
  projectSelect.disabled = isLoading || !state.selectedTeamId;
}

async function bootstrap() {
  clearBanner();
  setLoading(true);
  listHost.innerHTML = `<p class="loading">Loading teams and projects…</p>`;
  detailHost.innerHTML = `<p class="detail-empty">Select a row to inspect it.</p>`;

  try {
    const [me, catalog] = await Promise.all([api("/api/me"), api("/api/projects")]);
    state.me = me;
    state.teams = catalog.teams || [];
    state.allProjects = catalog.projects || [];
    state.projectsByTeam = new Map();
    for (const p of state.allProjects) {
      const tid = p.team_id;
      if (!tid) continue;
      if (!state.projectsByTeam.has(tid)) state.projectsByTeam.set(tid, []);
      state.projectsByTeam.get(tid).push(p);
    }

    const name =
      me?.name ||
      me?.full_name ||
      me?.email ||
      me?.application_name ||
      me?.attributes?.name ||
      "API client";
    meChip.innerHTML = `Connected as <strong>${escapeHtml(name)}</strong>`;

    fillTeamSelect();
    if (state.teams.length === 0) {
      showBanner("No teams returned for these credentials.", "warn");
      listHost.innerHTML = `<p class="empty">No teams available.</p>`;
    } else {
      const first = state.teams[0];
      teamSelect.value = first.id;
      await onTeamChange(first.id);
    }

    workspace.hidden = false;
    workspace.classList.add("open");
    reloadBtn.hidden = false;
    hero.style.minHeight = "auto";
    hero.style.paddingBottom = "2rem";
    workspace.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    const msg =
      err.code === "config_missing"
        ? err.message
        : `Could not load Maindeck data: ${err.message}`;
    showBanner(msg, err.code === "config_missing" ? "warn" : "err");
    listHost.innerHTML = `<p class="empty">${escapeHtml(msg)}</p>`;
    workspace.hidden = false;
    workspace.classList.add("open");
    reloadBtn.hidden = false;
  } finally {
    setLoading(false);
  }
}

function fillTeamSelect() {
  if (!state.teams.length) {
    teamSelect.innerHTML = `<option value="">No teams</option>`;
    return;
  }
  teamSelect.innerHTML = state.teams
    .map((t) => {
      const label = t.name || t.title || t.id;
      const count = (state.projectsByTeam.get(t.id) || []).length;
      return `<option value="${escapeHtml(t.id)}">${escapeHtml(label)} (${count})</option>`;
    })
    .join("");
}

function fillProjectSelect(teamId) {
  const projects = state.projectsByTeam.get(teamId) || [];
  if (!projects.length) {
    projectSelect.innerHTML = `<option value="">No projects</option>`;
    projectSelect.disabled = true;
    return;
  }
  projectSelect.innerHTML = projects
    .map((p) => {
      const ship = p.ship_name ? ` · ${p.ship_name}` : "";
      return `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.slug || p.id)}${escapeHtml(ship)}</option>`;
    })
    .join("");
  projectSelect.disabled = state.loading;
}

async function onTeamChange(teamId) {
  state.selectedTeamId = teamId;
  state.selectedProjectId = null;
  state.selectedItemId = null;
  state.workOrders = [];
  state.groups = [];
  state.supplies = [];
  fillProjectSelect(teamId);

  // Prefetch team-scoped resources in background
  prefetchTeamExtras(teamId);

  const projects = state.projectsByTeam.get(teamId) || [];
  if (projects.length) {
    projectSelect.value = projects[0].id;
    await onProjectChange(projects[0].id);
  } else {
    jobsMeta.textContent = "No projects in this team";
    listHost.innerHTML = `<p class="empty">This team has no projects.</p>`;
    detailHost.innerHTML = `<p class="detail-empty">Select a row to inspect it.</p>`;
  }
}

async function prefetchTeamExtras(teamId) {
  if (!state.shipsByTeam.has(teamId)) {
    try {
      state.shipsByTeam.set(teamId, await api(`/api/teams/${encodeURIComponent(teamId)}/ships`));
    } catch {
      state.shipsByTeam.set(teamId, []);
    }
  }
  if (!state.inspectionsByTeam.has(teamId)) {
    try {
      state.inspectionsByTeam.set(
        teamId,
        await api(`/api/teams/${encodeURIComponent(teamId)}/inspections`)
      );
    } catch {
      state.inspectionsByTeam.set(teamId, []);
    }
  }
}

async function onProjectChange(projectId) {
  state.selectedProjectId = projectId;
  state.selectedItemId = null;
  clearBanner();
  setLoading(true);
  listHost.innerHTML = `<p class="loading">Loading project data…</p>`;
  detailHost.innerHTML = `<p class="detail-empty">Select a row to inspect it.</p>`;
  detailMeta.textContent = "";

  try {
    const [workOrders, groups, supplies] = await Promise.all([
      api(`/api/projects/${encodeURIComponent(projectId)}/work_orders`),
      api(`/api/projects/${encodeURIComponent(projectId)}/groups`).catch(() => []),
      api(`/api/projects/${encodeURIComponent(projectId)}/owner_supplies`).catch(() => []),
    ]);
    state.workOrders = Array.isArray(workOrders) ? workOrders : [];
    state.groups = Array.isArray(groups) ? groups : [];
    state.supplies = Array.isArray(supplies) ? supplies : [];
    renderList();
  } catch (err) {
    showBanner(`Project load failed: ${err.message}`);
    listHost.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
  } finally {
    setLoading(false);
  }
}

function currentList() {
  const teamId = state.selectedTeamId;
  switch (state.activeTab) {
    case "groups":
      return state.groups;
    case "supplies":
      return state.supplies;
    case "ships":
      return state.shipsByTeam.get(teamId) || [];
    case "inspections":
      return state.inspectionsByTeam.get(teamId) || [];
    case "jobs":
    default:
      return state.workOrders;
  }
}

function renderList() {
  const items = currentList();
  const labels = {
    jobs: "work orders",
    groups: "groups",
    supplies: "owner supplies",
    ships: "ships",
    inspections: "inspections",
  };
  jobsMeta.textContent = `${items.length} ${labels[state.activeTab] || "items"}`;

  if (!items.length) {
    listHost.innerHTML = `<p class="empty">Nothing here for this selection.</p>`;
    return;
  }

  const html = items
    .map((item, i) => {
      const delay = Math.min(i * 28, 360);
      const active = item.id === state.selectedItemId ? " active" : "";
      if (state.activeTab === "jobs") {
        return `<button type="button" class="list-item${active}" data-id="${escapeHtml(item.id)}" style="animation-delay:${delay}ms">
          <span class="title">${escapeHtml(item.name || "Untitled job")}</span>
          <span class="sub">${escapeHtml(item.group_name || "No group")}${item.external_reference ? ` · ${escapeHtml(item.external_reference)}` : ""}</span>
          <span class="row-meta">
            <span class="pill">${escapeHtml(item.execution_status || item.planning_status || "—")}</span>
            ${progressHtml(item.progress)}
          </span>
        </button>`;
      }
      if (state.activeTab === "ships") {
        return `<button type="button" class="list-item${active}" data-id="${escapeHtml(item.id)}" style="animation-delay:${delay}ms">
          <span class="title">${escapeHtml(item.name || item.ship_name || "Ship")}</span>
          <span class="sub">${escapeHtml(item.imo || item.external_id || item.id)}</span>
        </button>`;
      }
      if (state.activeTab === "inspections") {
        return `<button type="button" class="list-item${active}" data-id="${escapeHtml(item.id)}" style="animation-delay:${delay}ms">
          <span class="title">${escapeHtml(item.title || item.name || "Inspection")}</span>
          <span class="sub">Deadline ${escapeHtml(fmtDate(item.deadline))}</span>
        </button>`;
      }
      if (state.activeTab === "supplies") {
        return `<button type="button" class="list-item${active}" data-id="${escapeHtml(item.id)}" style="animation-delay:${delay}ms">
          <span class="title">${escapeHtml(item.name || item.description || "Supply")}</span>
          <span class="sub">${escapeHtml(item.category_name || item.status || item.id)}</span>
        </button>`;
      }
      return `<button type="button" class="list-item${active}" data-id="${escapeHtml(item.id)}" style="animation-delay:${delay}ms">
        <span class="title">${escapeHtml(item.name || item.title || "Item")}</span>
        <span class="sub">${escapeHtml(item.id)}</span>
      </button>`;
    })
    .join("");

  listHost.innerHTML = `<div class="list">${html}</div>`;
  listHost.querySelectorAll(".list-item").forEach((btn) => {
    btn.addEventListener("click", () => selectItem(btn.getAttribute("data-id")));
  });
  // Kick progress bar widths after paint
  requestAnimationFrame(() => {
    listHost.querySelectorAll(".progress-fill").forEach((el) => {
      const w = el.style.width;
      el.style.width = "0";
      requestAnimationFrame(() => {
        el.style.width = w;
      });
    });
  });
}

async function selectItem(id) {
  state.selectedItemId = id;
  renderList();
  detailMeta.textContent = "Loading…";
  detailHost.innerHTML = `<p class="loading">Loading detail…</p>`;

  try {
    let data;
    let title;
    let lede = "";
    const kv = [];

    if (state.activeTab === "jobs") {
      data = await api(`/api/work_orders/${encodeURIComponent(id)}`);
      title = data.name || "Work order";
      lede = data.content || "";
      kv.push(
        ["Execution", data.execution_status],
        ["Planning", data.planning_status],
        ["Progress", `${data.progress ?? 0}%`],
        ["Group", data.group_name],
        ["Start", fmtDate(data.start_date)],
        ["End", fmtDate(data.end_date)],
        ["Duration", data.duration != null ? `${data.duration}` : null],
        ["Qty", data.quantity != null ? `${data.quantity} ${data.unit || ""}`.trim() : null],
        ["Ref", data.external_reference],
        ["Updated", fmtDate(data.updated_at)]
      );
      // Optional extras
      try {
        const report = await api(
          `/api/work_orders/${encodeURIComponent(id)}/work_done_report`
        );
        if (report) kv.push(["Work done", "Report available (see raw)"]);
        data = { ...data, work_done_report: report };
      } catch {
        /* optional */
      }
    } else if (state.activeTab === "ships") {
      data = await api(`/api/ships/${encodeURIComponent(id)}`);
      title = data.name || data.ship_name || "Ship";
      kv.push(
        ["IMO", data.imo],
        ["External ID", data.external_id],
        ["Type", data.ship_type || data.type_name]
      );
    } else if (state.activeTab === "inspections") {
      data = await api(`/api/inspections/${encodeURIComponent(id)}`);
      title = data.title || data.name || "Inspection";
      kv.push(["Deadline", fmtDate(data.deadline)], ["Status", data.status]);
      try {
        const items = await api(`/api/inspections/${encodeURIComponent(id)}/items`);
        data = { ...data, items };
        kv.push(["Questions", Array.isArray(items) ? String(items.length) : "—"]);
      } catch {
        /* optional */
      }
    } else if (state.activeTab === "groups") {
      try {
        data = await api(`/api/groups/${encodeURIComponent(id)}`);
      } catch {
        data = state.groups.find((g) => g.id === id) || { id };
      }
      title = data.name || "Group";
    } else if (state.activeTab === "supplies") {
      try {
        data = await api(`/api/owner_supplies/${encodeURIComponent(id)}`);
      } catch {
        data = state.supplies.find((s) => s.id === id) || { id };
      }
      title = data.name || data.description || "Owner supply";
      kv.push(["Status", data.status], ["Category", data.category_name]);
    } else {
      data = { id };
      title = "Item";
    }

    const kvHtml = kv
      .filter(([, v]) => v != null && v !== "")
      .map(
        ([k, v]) =>
          `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`
      )
      .join("");

    detailMeta.textContent = id;
    detailHost.innerHTML = `
      <div class="detail-panel">
        <h3>${escapeHtml(title)}</h3>
        ${lede ? `<p class="lede">${escapeHtml(lede)}</p>` : ""}
        ${kvHtml ? `<dl class="kv">${kvHtml}</dl>` : ""}
        <button type="button" class="btn btn-ghost raw-toggle" id="rawToggle">Show raw JSON</button>
        <pre class="raw-block" id="rawBlock">${escapeHtml(JSON.stringify(data, null, 2))}</pre>
      </div>`;
    document.getElementById("rawToggle").addEventListener("click", () => {
      const block = document.getElementById("rawBlock");
      const open = block.classList.toggle("show");
      document.getElementById("rawToggle").textContent = open
        ? "Hide raw JSON"
        : "Show raw JSON";
    });
  } catch (err) {
    showBanner(`Detail failed: ${err.message}`);
    detailHost.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
    detailMeta.textContent = "";
  }
}

openBtn.addEventListener("click", bootstrap);
reloadBtn.addEventListener("click", bootstrap);

teamSelect.addEventListener("change", () => {
  if (teamSelect.value) onTeamChange(teamSelect.value);
});

projectSelect.addEventListener("change", () => {
  if (projectSelect.value) onProjectChange(projectSelect.value);
});

tabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  tabs.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  state.activeTab = btn.getAttribute("data-tab");
  state.selectedItemId = null;
  detailHost.innerHTML = `<p class="detail-empty">Select a row to inspect it.</p>`;
  detailMeta.textContent = "";
  renderList();
});
