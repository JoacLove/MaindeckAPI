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
const supplyFilters = document.getElementById("supplyFilters");
const categoryFilter = document.getElementById("categoryFilter");
const supplySearch = document.getElementById("supplySearch");

const state = {
  me: null,
  teams: [],
  projectsByTeam: new Map(),
  allProjects: [],
  shipsByTeam: new Map(),
  inspectionsByTeam: new Map(),
  categories: [],
  activeTab: "jobs",
  selectedTeamId: null,
  selectedProjectId: null,
  selectedItemId: null,
  workOrders: [],
  groups: [],
  supplies: [],
  supplyCategoryId: "",
  supplyQuery: "",
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
  state.supplyCategoryId = "";
  state.supplyQuery = "";
  categoryFilter.value = "";
  supplySearch.value = "";
  clearBanner();
  setLoading(true);
  listHost.innerHTML = `<p class="loading">Loading project data…</p>`;
  detailHost.innerHTML = `<p class="detail-empty">Select a row to inspect it.</p>`;
  detailMeta.textContent = "";

  const teamQ = state.selectedTeamId
    ? `?team_id=${encodeURIComponent(state.selectedTeamId)}`
    : "";

  try {
    const [workOrders, groups, supplyPayload] = await Promise.all([
      api(`/api/projects/${encodeURIComponent(projectId)}/work_orders`),
      api(`/api/projects/${encodeURIComponent(projectId)}/groups`).catch(() => []),
      api(`/api/projects/${encodeURIComponent(projectId)}/owner_supplies${teamQ}`).catch(() => ({
        items: [],
        categories: [],
      })),
    ]);
    state.workOrders = Array.isArray(workOrders) ? workOrders : [];
    state.groups = Array.isArray(groups) ? groups : [];
    if (Array.isArray(supplyPayload)) {
      state.supplies = supplyPayload;
      state.categories = [];
    } else {
      state.supplies = Array.isArray(supplyPayload?.items) ? supplyPayload.items : [];
      state.categories = Array.isArray(supplyPayload?.categories) ? supplyPayload.categories : [];
    }
    fillCategoryFilter();
    renderList();
  } catch (err) {
    showBanner(`Project load failed: ${err.message}`);
    listHost.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
  } finally {
    setLoading(false);
  }
}

function fillCategoryFilter() {
  const opts = [`<option value="">All categories</option>`];
  for (const c of state.categories) {
    opts.push(
      `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name || c.title || c.id)}</option>`
    );
  }
  // Also include category ids present on supplies but missing from team list
  const known = new Set(state.categories.map((c) => String(c.id)));
  for (const s of state.supplies) {
    if (s.category_id && !known.has(String(s.category_id))) {
      known.add(String(s.category_id));
      opts.push(
        `<option value="${escapeHtml(s.category_id)}">${escapeHtml(
          s.category_name || s.category_id
        )}</option>`
      );
    }
  }
  categoryFilter.innerHTML = opts.join("");
}

function formatMoney(cents, currency) {
  if (cents == null || cents === "") return "—";
  const n = Number(cents) / 100;
  if (Number.isNaN(n)) return String(cents);
  try {
    return new Intl.NumberFormat(undefined, {
      style: currency ? "currency" : "decimal",
      currency: currency || undefined,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)}${currency ? ` ${currency}` : ""}`;
  }
}

function currentList() {
  const teamId = state.selectedTeamId;
  switch (state.activeTab) {
    case "groups":
      return state.groups;
    case "supplies": {
      let items = state.supplies;
      if (state.supplyCategoryId) {
        items = items.filter((s) => String(s.category_id) === String(state.supplyCategoryId));
      }
      const q = state.supplyQuery.trim().toLowerCase();
      if (q) {
        items = items.filter((s) => {
          const hay = [
            s.name,
            s.description,
            s.po_number,
            s.supplier,
            s.location,
            s.equipment,
            s.account_reference,
            s.category_name,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });
      }
      return items;
    }
    case "ships":
      return state.shipsByTeam.get(teamId) || [];
    case "inspections":
      return state.inspectionsByTeam.get(teamId) || [];
    case "jobs":
    default:
      return state.workOrders;
  }
}

function updateSupplyFilterVisibility() {
  supplyFilters.hidden = state.activeTab !== "supplies";
}

function renderList() {
  updateSupplyFilterVisibility();
  const items = currentList();
  const labels = {
    jobs: "work orders",
    groups: "groups",
    supplies: "owner supplies",
    ships: "ships",
    inspections: "inspections",
  };
  const totalHint =
    state.activeTab === "supplies" && items.length !== state.supplies.length
      ? `${items.length} of ${state.supplies.length} owner supplies`
      : `${items.length} ${labels[state.activeTab] || "items"}`;
  jobsMeta.textContent = totalHint;

  if (!items.length) {
    const emptyMsg =
      state.activeTab === "supplies"
        ? state.supplies.length
          ? "No owner supplies match this category/search."
          : "No owner supplies on this project."
        : state.activeTab === "jobs"
          ? "No work orders on this project."
          : "Nothing here for this selection.";
    listHost.innerHTML = `<p class="empty">${emptyMsg}</p>`;
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
        const cost = formatMoney(item.cost_cents, item.cost_currency);
        return `<button type="button" class="list-item${active}" data-id="${escapeHtml(item.id)}" style="animation-delay:${delay}ms">
          <span class="title">${escapeHtml(item.name || item.description || "Supply")}</span>
          <span class="sub">${escapeHtml(item.category_name || "Uncategorized")}${item.supplier ? ` · ${escapeHtml(item.supplier)}` : ""}${item.po_number ? ` · PO ${escapeHtml(item.po_number)}` : ""}</span>
          <span class="row-meta">
            <span class="pill">${escapeHtml(item.status != null ? `Status ${item.status}` : "—")}</span>
            <span>${escapeHtml(cost)}</span>
          </span>
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

      let costBlock = "";
      try {
        const costPayload = await api(
          `/api/work_orders/${encodeURIComponent(id)}/cost_items`
        );
        data = { ...data, cost_items_payload: costPayload };
        const lines = Array.isArray(costPayload?.items) ? costPayload.items : [];
        if (costPayload?.available && lines.length) {
          costBlock = `
            <p class="section-label">Cost / estimation lines</p>
            <table class="mini-table">
              <thead><tr><th>Name</th><th>Qty</th><th>Unit</th><th>Amount</th></tr></thead>
              <tbody>
                ${lines
                  .map((row) => {
                    const name = row.name || row.description || row.title || row.id || "Line";
                    const qty = row.quantity ?? row.qty ?? "—";
                    const unit = row.unit || row.uom || "";
                    const amount =
                      row.amount != null
                        ? row.amount
                        : row.cost_cents != null
                          ? formatMoney(row.cost_cents, row.cost_currency || row.currency)
                          : row.total ?? row.price ?? "—";
                    return `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(qty)}</td><td>${escapeHtml(unit)}</td><td>${escapeHtml(amount)}</td></tr>`;
                  })
                  .join("")}
              </tbody>
            </table>
            ${
              costPayload.note
                ? `<p class="note-soft">${escapeHtml(costPayload.note)}</p>`
                : ""
            }`;
        } else {
          costBlock = `
            <p class="section-label">Cost / estimation lines</p>
            <p class="note-soft">${escapeHtml(
              costPayload?.note ||
                "No cost items available for this work order via the Integration Hub REST API."
            )}</p>
            <p class="note-soft">Work order qty/unit above is the job estimate summary when present.</p>`;
        }
      } catch (err) {
        costBlock = `
          <p class="section-label">Cost / estimation lines</p>
          <p class="note-soft">${escapeHtml(err.message)}</p>`;
      }

      try {
        const report = await api(
          `/api/work_orders/${encodeURIComponent(id)}/work_done_report`
        );
        if (report) kv.push(["Work done", "Report available (see raw)"]);
        data = { ...data, work_done_report: report };
      } catch {
        /* optional */
      }

      try {
        const links = await api(
          `/api/work_orders/${encodeURIComponent(id)}/owner_supplies`
        );
        if (Array.isArray(links) && links.length) {
          kv.push(["Owner supplies linked", String(links.length)]);
          data = { ...data, owner_supplies_work_orders: links };
        }
      } catch {
        /* optional */
      }

      data._costBlock = costBlock;
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
      // Prefer enriched list fields when detail is sparse
      const fromList = state.supplies.find((s) => s.id === id) || {};
      data = { ...fromList, ...data };
      title = data.name || data.description || "Owner supply";
      lede = data.description && data.description !== data.name ? data.description : "";
      kv.push(
        ["Category", data.category_name || data.category_id],
        ["Status", data.status],
        ["Supplier", data.supplier],
        ["PO", data.po_number],
        ["Account ref", data.account_reference],
        ["Location", data.location],
        ["Equipment", data.equipment],
        ["Weight", data.weight_value != null ? `${data.weight_value} ${data.weight_unit || ""}`.trim() : null],
        ["Cost", formatMoney(data.cost_cents, data.cost_currency)],
        ["Delivery", fmtDate(data.delivery_date)],
        ["Updated", fmtDate(data.updated_at)]
      );
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

    const costBlock = data._costBlock || "";
    const rawData = { ...data };
    delete rawData._costBlock;

    detailMeta.textContent = id;
    detailHost.innerHTML = `
      <div class="detail-panel">
        <h3>${escapeHtml(title)}</h3>
        ${lede ? `<p class="lede">${escapeHtml(lede)}</p>` : ""}
        ${kvHtml ? `<dl class="kv">${kvHtml}</dl>` : ""}
        ${costBlock}
        <button type="button" class="btn btn-ghost raw-toggle" id="rawToggle">Show raw JSON</button>
        <pre class="raw-block" id="rawBlock">${escapeHtml(JSON.stringify(rawData, null, 2))}</pre>
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

categoryFilter.addEventListener("change", () => {
  state.supplyCategoryId = categoryFilter.value;
  state.selectedItemId = null;
  renderList();
});

supplySearch.addEventListener("input", () => {
  state.supplyQuery = supplySearch.value;
  renderList();
});
