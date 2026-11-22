/**
 * Maindeck Reader — live UI matching docs/maindeck-ui-prototype.html
 * Talks only to same-origin /api/* (never app.maindeck.io).
 */

const PH = {
  planning: ["Planning", "var(--ph-planning)"],
  yard_selection: ["Yard selection", "var(--ph-yard)"],
  kick_off: ["Kick-off", "var(--ph-kick)"],
  execution: ["Execution", "var(--ph-exec)"],
  closing: ["Closing", "var(--ph-closing)"],
};
const PHO = Object.keys(PH);
const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 864e5;
const NOW = Date.now();

const STATUS_LABELS = {
  not_specified: "Not specified",
  cancelled: "Cancelled",
  fully_received: "Fully received",
  ordered: "Ordered",
  partially_received: "Partially received",
  prepared: "Prepared",
  received_forwarder: "Received forwarder",
  received_goods: "Received goods",
  sent_to_agent_workshop: "Sent to agent workshop",
  sent_to_forwarder: "Sent to forwarder",
  confirmed: "Confirmed",
  forwarder_notified: "Forwarder notified",
  agent_notified: "Agent notified",
  ready_at_supplier: "Ready at supplier",
  prepayment: "Prepayment",
  paid_pending_readiness: "Paid pending readiness",
  received_agent_workshop: "Received agent workshop",
  sent_to_vessel: "Sent to vessel",
  sent: "Sent",
  sent_to_supplier: "Sent to supplier",
  over_supplied: "Over supplied",
  transferred_to_warehouse: "Transferred to warehouse",
  request_made_by_vessel: "Request made by vessel",
  approved: "Approved",
  in_query: "In query",
};

const STATUS_COLOR = {
  not_specified: "#5F7193",
  cancelled: "var(--danger)",
  fully_received: "var(--accent-2)",
  ordered: "var(--accent)",
  partially_received: "var(--accent)",
  prepared: "var(--warn)",
  confirmed: "var(--accent)",
  in_query: "var(--danger)",
  request_made_by_vessel: "var(--warn)",
  sent_to_vessel: "var(--violet)",
  approved: "var(--accent-2)",
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  teamId: localStorage.getItem("md_team") || "",
  teams: [],
  projects: [],
  filter: "active",
  current: null,
  ptab: "overview",
  supplies: [],
  workOrders: [],
  groups: [],
  owners: [],
  categories: new Map(),
  rates: { rates: {}, asOf: null, overrides: JSON.parse(localStorage.getItem("md_fx_overrides") || "{}") },
  osStatus: "all",
  osQ: "",
  osSort: { key: "usd", dir: -1 },
  econ: null,
  econFile: "",
  connected: false,
  gsearch: "",
};

function parseMaindeckDate(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return raw;
  const s = String(raw).trim();
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?\s*([+-]\d{2}):?(\d{2})?/
  );
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4] || "00"}:${m[5] || "00"}:${m[6] || "00"}${
      m[7] ? `${m[7]}:${m[8] || "00"}` : "Z"
    }`;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : t;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function fd(t) {
  if (t == null) return "—";
  const d = new Date(t);
  return `${d.getDate()} ${MN[d.getMonth()]} ${d.getFullYear()}`;
}
function fs(t) {
  if (t == null) return "—";
  const d = new Date(t);
  return `${d.getDate()} ${MN[d.getMonth()]}`;
}
function usd(n, c) {
  if (n == null || Number.isNaN(n)) return "—";
  return Math.round(n).toLocaleString("en-GB") + (c ? " " + c : "");
}
function kusd(n) {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (n >= 1e3) return Math.round(n / 1e3) + "k";
  return String(Math.round(n));
}
function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function stripHtml(html) {
  const d = document.createElement("div");
  d.innerHTML = String(html || "");
  return d.textContent || "";
}
function normalizeProgress(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return 0;
  return n > 0 && n <= 1 ? Math.round(n * 100) : Math.max(0, Math.min(100, Math.round(n)));
}
function normalizePhase(p) {
  if (typeof p === "string" && PH[p]) return p;
  const map = ["planning", "yard_selection", "kick_off", "execution", "closing"];
  if (typeof p === "number" && map[p]) return map[p];
  if (typeof p === "number" && map[p - 1]) return map[p - 1];
  return "planning";
}
function statusKey(s) {
  if (s == null) return "not_specified";
  if (typeof s === "number") return "not_specified";
  return String(s).toLowerCase().replace(/\s+/g, "_");
}
function statusLabel(k) {
  return STATUS_LABELS[k] || k.replace(/_/g, " ");
}
function statusColor(k) {
  return STATUS_COLOR[k] || "#5F7193";
}
function tag(t, c, solid) {
  return `<span class="tag" style="${
    solid
      ? `background:${c};color:#06101F`
      : `background:color-mix(in srgb, ${c} 18%, transparent);color:${c}`
  }">${escapeHtml(t)}</span>`;
}
function kpi(v, l, s, c) {
  return `<div class="card kpi" style="--glow:${c}"><div class="v num" style="color:${c}">${v}</div><div class="l">${l}</div>${
    s ? `<div class="s">${s}</div>` : ""
  }</div>`;
}

function toUsd(amount, currency) {
  if (amount == null || Number.isNaN(amount)) return null;
  const cur = (currency || "USD").toUpperCase();
  if (cur === "USD") return amount;
  const override = state.rates.overrides[cur];
  const rate = override ?? state.rates.rates[cur];
  if (!rate) return null;
  return amount / rate;
}

async function proxy(path, { params = {}, all = false } = {}) {
  const res = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ path, params, all }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    const err = new Error(body.message || `Request failed (${res.status})`);
    err.status = body.status || res.status;
    err.code = body.error;
    throw err;
  }
  return body;
}

function unwrap(body) {
  const rows = Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : [];
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    ...(r.attributes || {}),
    relationships: r.relationships,
  }));
}

function showBanner(msg) {
  const el = $("#banner");
  if (!msg) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.style.display = "block";
  el.textContent = msg;
}

function setConnected(ok, label) {
  state.connected = ok;
  $("#connLabel").textContent = label;
  $("#connDot").style.background = ok ? "var(--accent-2)" : "var(--danger)";
}

async function loadRates() {
  try {
    const res = await fetch("/api/rates");
    const body = await res.json();
    if (body.ok) {
      state.rates.rates = body.data.rates || {};
      state.rates.asOf = body.data.asOf;
      const asOf = body.data.asOf ? fd(parseMaindeckDate(String(body.data.asOf).slice(0, 10)) || Date.parse(body.data.asOf)) : "—";
      const nok = state.rates.overrides.NOK || state.rates.rates.NOK;
      const eur = state.rates.overrides.EUR || state.rates.rates.EUR;
      $("#fxPill").textContent = `USD · ECB ${asOf}`;
      $("#fxNote").textContent = `Converted to USD · ECB rate ${asOf}${
        nok ? ` · 1 USD = ${Number(nok).toFixed(2)} NOK` : ""
      }${eur ? ` · ${Number(eur).toFixed(2)} EUR` : ""}. Original amount below the USD figure.`;
    }
  } catch {
    $("#fxPill").textContent = "USD · rates unavailable";
  }
}

async function bootstrap() {
  showBanner("");
  setConnected(false, "Connecting…");
  try {
    await loadRates();
    await proxy("me");
    setConnected(true, "Connected");
    const teamsRes = await proxy("teams", { all: true });
    state.teams = unwrap(teamsRes.body);
    fillTeams();
    if (!state.teamId && state.teams[0]) state.teamId = state.teams[0].id;
    if (state.teamId) {
      $("#teamSelect").value = state.teamId;
      await loadProjects();
    }
  } catch (err) {
    setConnected(false, "Not connected");
    showBanner(
      err.code === "config_missing"
        ? err.message
        : `Maindeck ${err.status || ""}: ${err.message}`.trim()
    );
    $("#fleetSub").textContent = "Could not load data";
    $("#fleetKpis").innerHTML = "";
    $("#board").innerHTML = `<p class="dim">No projects loaded.</p>`;
  }
}

function fillTeams() {
  const sel = $("#teamSelect");
  sel.innerHTML = state.teams
    .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name || t.title || t.id)}</option>`)
    .join("");
  if (state.teamId) sel.value = state.teamId;
}

async function loadProjects() {
  if (!state.teamId) return;
  localStorage.setItem("md_team", state.teamId);
  $("#fleetSub").textContent = "Fetching projects…";
  const res = await proxy(`teams/${state.teamId}/projects`, { all: true });
  const rows = unwrap(res.body);
  state.projects = rows.map((p) => {
    const from = parseMaindeckDate(p.period_from);
    const to = parseMaindeckDate(p.period_to) || parseMaindeckDate(p.deadline);
    return {
      id: p.id,
      ship: p.ship_name || "—",
      name: p.name || "Untitled",
      phase: normalizePhase(p.phase),
      type: p.survey_type != null ? String(p.survey_type) : "Project",
      from,
      to,
      slug: p.slug,
      team_id: p.team_id || state.teamId,
      raw: p,
    };
  });
  const teamName = state.teams.find((t) => t.id === state.teamId)?.name || "Team";
  $("#connLabel").textContent = `Connected · ${teamName}`;
  const week = (() => {
    const d = new Date();
    const onejan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - onejan) / DAY + onejan.getUTCDay() + 1) / 7);
  })();
  $("#fleetTitle").textContent = `Fleet projects · week ${week}`;
  $("#fleetSub").textContent = `${fd(NOW)} · ${state.projects.length} projects · data just fetched`;
  renderFleet();
}

function renderFleet() {
  const q = state.gsearch.trim().toLowerCase();
  let list = state.projects.filter(
    (p) => state.filter === "all" || p.phase !== "closing"
  );
  if (q) {
    list = list.filter((p) =>
      [p.name, p.ship, p.slug, p.type].join(" ").toLowerCase().includes(q)
    );
  }
  const ongoing = list.filter((p) => p.from && p.to && p.from <= NOW && p.to >= NOW);
  const soon = list.filter((p) => p.from && p.from > NOW && p.from - NOW <= 30 * DAY);
  $("#fleetKpis").innerHTML =
    kpi(list.length, "Active projects", state.filter === "all" ? "incl. closing" : "excl. closing", "var(--accent)") +
    kpi(ongoing.length, "Ongoing now", "within the period today", "var(--accent-2)") +
    kpi(soon.length, "Starting within 30 days", soon[0] ? `Next: ${soon[0].name}` : "", "var(--warn)") +
    kpi(new Set(list.map((p) => p.ship)).size, "Vessels involved", "", "var(--violet)");

  const c = PHO.map((k) => [k, list.filter((p) => p.phase === k).length]).filter((x) => x[1]);
  $("#phasebar").innerHTML = c.map(([k, n]) => `<i title="${PH[k][0]} ${n}" style="flex:${n};background:${PH[k][1]}"></i>`).join("");
  $("#phaseLegend").innerHTML = c
    .map(([k, n]) => `<span><i style="background:${PH[k][1]}"></i>${PH[k][0]} <b style="color:var(--text)">${n}</b></span>`)
    .join("");

  const upcoming = list
    .filter((p) => p.from && p.from > NOW)
    .sort((a, b) => a.from - b.from)
    .slice(0, 4);
  $("#upcoming").innerHTML =
    upcoming
      .map(
        (p) =>
          `<li><span class="d" style="background:${PH[p.phase][1]}"></span><div><b>${escapeHtml(p.ship)}</b> · ${escapeHtml(p.name)}<span class="sub">Starts ${fd(p.from)} · in ${Math.ceil((p.from - NOW) / DAY)} days</span></div></li>`
      )
      .join("") || `<li class="dim">Nothing scheduled.</li>`;

  const dated = list.filter((p) => p.from && p.to);
  let lo = dated.length ? Math.min(...dated.map((p) => p.from)) : NOW - 60 * DAY;
  let hi = dated.length ? Math.max(...dated.map((p) => p.to)) : NOW + 120 * DAY;
  if (hi <= lo) hi = lo + 90 * DAY;
  const pct = (t) => Math.max(0, Math.min(100, ((t - lo) / (hi - lo)) * 100));
  const ticks = [];
  for (let d = new Date(lo); d.getTime() < hi; d.setUTCMonth(d.getUTCMonth() + 1)) ticks.push(d.getTime());
  const ships = [...new Set(list.map((p) => p.ship))].sort();
  $("#timeline").innerHTML =
    `<div class="axis">${ticks.map((t) => `<span style="left:${pct(t)}%">${MN[new Date(t).getUTCMonth()]}</span>`).join("")}</div>` +
    ships
      .map((s) => {
        const bars = list
          .filter((p) => p.ship === s && p.from && p.to)
          .map((p) => {
            const l = pct(p.from);
            const w = Math.max(1.2, pct(p.to) - l);
            return `<div class="bar" data-p="${escapeHtml(p.id)}" title="${escapeHtml(p.name)}" style="left:${l}%;width:${w}%;background:${PH[p.phase][1]}">${w > 9 ? escapeHtml(p.name) : ""}</div>`;
          })
          .join("");
        return `<div class="lane"><b>${escapeHtml(s)}</b><div class="track">${bars}<div class="today" style="left:${pct(NOW)}%"></div></div></div>`;
      })
      .join("") || `<p class="dim">No dated projects for the timeline.</p>`;

  $("#board").innerHTML =
    list
      .map((p) => {
        const on = p.from && p.to && p.from <= NOW && p.to >= NOW;
        const st = on
          ? `<span style="color:var(--accent-2);font-weight:700">● Ongoing · ${Math.ceil((p.to - NOW) / DAY)} d left</span>`
          : p.from && p.from > NOW
            ? `<span style="color:var(--warn);font-weight:700">Starts in ${Math.ceil((p.from - NOW) / DAY)} d</span>`
            : p.to && p.to < NOW
              ? `<span class="dim">Ended</span>`
              : `<span class="dim">no dates</span>`;
        const period =
          p.from || p.to
            ? `${fd(p.from)} – ${fd(p.to)}`
            : "no dates";
        return `<div class="pcard" data-p="${escapeHtml(p.id)}" style="--c:${PH[p.phase][1]}"><div class="ship">${escapeHtml(p.ship)}</div><div class="name">${escapeHtml(p.name)}</div><div class="row">${tag(PH[p.phase][0], PH[p.phase][1], true)}<span>${escapeHtml(p.type)}</span><span style="margin-left:auto">${st}</span></div><div class="row" style="margin-top:8px"><span class="num">${period}</span></div></div>`;
      })
      .join("") || `<p class="dim">No projects match.</p>`;

  $$("[data-p]").forEach((el) => {
    el.onclick = () => openProject(el.dataset.p);
  });
}

async function openProject(id) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) return;
  state.current = p;
  $("#navProject").disabled = false;
  go("project");
  $("#pShip").textContent = p.ship;
  $("#pName").textContent = p.name;
  $("#pSub").textContent = "Loading project data…";
  $("#pKpis").innerHTML = `<div class="card muted">Loading…</div>`;
  try {
    const teamId = p.team_id || state.teamId;
    const [proj, supplies, wos, groups, owners, cats] = await Promise.all([
      proxy(`projects/${p.id}`),
      proxy(`projects/${p.id}/owner_supplies`, { all: true }),
      proxy(`projects/${p.id}/work_orders`, { all: true }),
      proxy(`projects/${p.id}/groups`, { all: true }).catch(() => ({ body: { data: [] } })),
      proxy(`projects/${p.id}/owners`, { all: true }).catch(() => ({ body: { data: [] } })),
      proxy(`teams/${teamId}/owner_supply_categories`, { all: true }).catch(() =>
        proxy("owner_supply_categories", { all: true }).catch(() => ({ body: { data: [] } }))
      ),
    ]);
    const detail = unwrap(proj.body)[0] || p.raw;
    state.categories = new Map(
      unwrap(cats.body).map((c) => [String(c.id), c.name || c.title || c.id])
    );
    state.supplies = unwrap(supplies.body).map((s) => {
      const cents = Number(s.cost_cents);
      const amount = Number.isFinite(cents) ? cents / 100 : null;
      const currency = (s.cost_currency || "").toUpperCase() || null;
      const usdVal = amount == null ? null : toUsd(amount, currency || "USD");
      return {
        id: s.id,
        name: s.name || "—",
        po: s.po_number || "—",
        supplier: s.supplier || "—",
        status: statusKey(s.status),
        amount,
        currency,
        usd: usdVal,
        orig:
          amount != null && currency && currency !== "USD"
            ? `${amount.toLocaleString("en-GB")} ${currency}`
            : amount != null && currency === "USD"
              ? null
              : amount != null
                ? `${amount.toLocaleString("en-GB")}`
                : null,
        delivery: parseMaindeckDate(s.delivery_date),
        location: s.location || "—",
        equipment: s.equipment || "—",
        category: state.categories.get(String(s.category_id)) || "—",
        raw: s,
      };
    });
    state.workOrders = unwrap(wos.body).map((w) => {
      let start = parseMaindeckDate(w.start_date);
      let end = parseMaindeckDate(w.end_date);
      const dur = Number(w.duration);
      if (!end && start && Number.isFinite(dur)) end = start + dur * DAY;
      return {
        id: w.id,
        group: w.group_name || "Ungrouped",
        name: w.name || "Untitled",
        content: stripHtml(w.content),
        s: start,
        e: end,
        p: normalizeProgress(w.progress),
        planning: w.planning_status,
        execution: w.execution_status,
        raw: w,
      };
    });
    state.groups = unwrap(groups.body);
    state.owners = unwrap(owners.body);
    state.econ = JSON.parse(localStorage.getItem(`md_econ_${p.id}`) || "null");
    state.econFile = localStorage.getItem(`md_econ_file_${p.id}`) || "";

    const left =
      p.to && p.to >= NOW ? `${Math.ceil((p.to - NOW) / DAY)} days left` : p.to ? "ended" : "no dates";
    $("#pSub").textContent = `${p.type} · ${fd(p.from)} – ${fd(p.to)} · ${left}`;
    $("#btnOpenMd").href = `https://app.maindeck.io/projects/${encodeURIComponent(p.slug || p.id)}`;
    renderProject();
  } catch (err) {
    showBanner(`Project load failed (${err.status || "?"}): ${err.message}`);
    $("#pSub").textContent = "Failed to load";
  }
}

function execOf(w) {
  const ex = String(w.execution || "").toLowerCase();
  if (w.p >= 100 || ex.includes("complete") || ex.includes("done")) return "done";
  if (ex.includes("progress") || ex.includes("started") || (w.s && w.s <= NOW) || w.p > 0)
    return "progress";
  return "todo";
}
const EXC = { done: "var(--accent-2)", progress: "var(--accent)", todo: "#5F7193" };

function renderProject() {
  const p = state.current;
  if (!p) return;
  const ci = PHO.indexOf(p.phase);
  $("#pStepper").innerHTML = PHO.map(
    (k, i) =>
      `<span class="${i === ci ? "on" : i < ci ? "past" : ""}" style="${i === ci ? `background:${PH[k][1]}` : ""}">${PH[k][0]}</span>`
  ).join("");

  const T = [
    ["overview", "Overview"],
    ["supplies", "Owner supplies", state.supplies.length],
    ["workorders", "Work orders", state.workOrders.length],
    ["groups", "Groups", state.groups.length],
    ["owners", "Owners", state.owners.length],
    ["economy", "Economy"],
    ["raw", "Raw JSON"],
  ];
  $("#ptabs").innerHTML = T.map(
    ([k, l, n]) =>
      `<button data-t="${k}" class="${k === state.ptab ? "on" : ""}">${l}${
        n != null ? `<span class="n">${n}</span>` : ""
      }</button>`
  ).join("");
  $$("#ptabs button").forEach((b) => {
    b.onclick = () => {
      state.ptab = b.dataset.t;
      renderProject();
    };
  });
  $$(".ptab").forEach((el) => el.classList.toggle("hidden", el.dataset.t !== state.ptab));

  const dated = state.workOrders.filter((w) => w.s).length;
  const done = state.workOrders.filter((w) => execOf(w) === "done").length;
  const avg = state.workOrders.length
    ? Math.round(state.workOrders.reduce((s, w) => s + w.p, 0) / state.workOrders.length)
    : 0;
  const late = state.workOrders.filter((w) => w.e && w.e < NOW && w.p < 100).length;
  const totalUsd = state.supplies.reduce((s, x) => s + (x.usd || 0), 0);
  const noDel = state.supplies.filter((s) => !s.delivery).length;

  $("#pKpis").innerHTML =
    kpi(avg + "%", "Average progress", `${state.workOrders.length} work orders`, "var(--accent-2)") +
    kpi(`${done} / ${state.workOrders.length}`, "Work orders completed", `${state.workOrders.length - dated} without dates`, "var(--accent)") +
    kpi(kusd(totalUsd) + " USD", "Owner supplies", `${state.supplies.length} lines`, "var(--warn)") +
    kpi(noDel, "No delivery date", `of ${state.supplies.length} owner supplies`, "var(--danger)");

  const sc = Object.keys(STATUS_LABELS)
    .map((k) => [k, state.supplies.filter((s) => s.status === k).length])
    .filter((x) => x[1]);
  $("#osTotal").textContent = usd(totalUsd, "USD");
  $("#osStack").innerHTML = sc
    .map(([k, n]) => `<i style="flex:${n};background:${statusColor(k)}" title="${statusLabel(k)} ${n}"></i>`)
    .join("");
  $("#osLegend").innerHTML = sc
    .map(([k, n]) => `<span><i style="background:${statusColor(k)}"></i>${statusLabel(k)} ${n}</span>`)
    .join("");

  const bySup = {};
  state.supplies.forEach((s) => {
    if (s.usd == null) return;
    bySup[s.supplier] = (bySup[s.supplier] || 0) + s.usd;
  });
  const sb = Object.entries(bySup).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const mx = sb[0]?.[1] || 1;
  $("#supBars").innerHTML = sb.length
    ? sb
        .map(
          ([n, v]) =>
            `<div class="hbar"><span>${escapeHtml(n)}</span><div class="t"><i style="width:${(v / mx) * 100}%;background:var(--warn)"></i></div><b class="num" style="text-align:right">${usd(v)}</b></div>`
        )
        .join("")
    : `<p class="dim">No convertible costs.</p>`;

  const inQuery = state.supplies.filter((s) => s.status === "in_query");
  $("#followup").innerHTML = [
    ["var(--danger)", `${late} work order${late === 1 ? "" : "s"} past end date`, late ? state.workOrders.find((w) => w.e && w.e < NOW && w.p < 100)?.name || "" : ""],
    ["var(--warn)", `${noDel} owner supplies have no delivery date`, ""],
    ["var(--danger)", `${inQuery.length} owner supply in query`, inQuery[0]?.name || ""],
    ["#5F7193", `${state.workOrders.length - dated} work orders have no start date`, "Data quality"],
  ]
    .map(
      ([c, a, b]) =>
        `<li><span class="d" style="background:${c}"></span><div><b>${escapeHtml(a)}</b>${b ? `<span class="sub">${escapeHtml(b)}</span>` : ""}</div></li>`
    )
    .join("");

  renderSupplies();
  renderGantt();
  renderGroupsOwners();
  renderEcon();
  $("#rawJson").textContent = JSON.stringify(
    {
      project: p.raw,
      supplies: state.supplies.map((s) => s.raw),
      work_orders: state.workOrders.map((w) => w.raw),
      groups: state.groups,
      owners: state.owners,
    },
    null,
    2
  );
}

function renderSupplies() {
  const seg = [
    ["all", "All"],
    ["open", "Open"],
    ["received", "Received"],
    ["nodate", "No date"],
  ];
  $("#osSeg").innerHTML = seg
    .map(([k, l]) => `<button data-s="${k}" class="${k === state.osStatus ? "on" : ""}">${l}</button>`)
    .join("");
  $$("#osSeg button").forEach((b) => {
    b.onclick = () => {
      state.osStatus = b.dataset.s;
      renderSupplies();
    };
  });

  let rows = state.supplies.filter((s) => {
    if (state.osStatus === "received") return s.status === "fully_received";
    if (state.osStatus === "open") return s.status !== "fully_received" && s.status !== "cancelled";
    if (state.osStatus === "nodate") return !s.delivery;
    return true;
  });
  if (state.osQ) {
    const q = state.osQ;
    rows = rows.filter((s) =>
      [s.name, s.po, s.supplier, s.category].join(" ").toLowerCase().includes(q)
    );
  }
  const { key, dir } = state.osSort;
  rows = [...rows].sort((a, b) => {
    const av = a[key] ?? "";
    const bv = b[key] ?? "";
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });

  $("#osBody").innerHTML =
    rows
      .map(
        (s) =>
          `<tr data-s="${escapeHtml(s.id)}"><td><b style="font-weight:600">${escapeHtml(s.name)}</b><span class="sub">${escapeHtml(s.category)}</span></td><td class="num muted">${escapeHtml(s.po)}</td><td class="muted">${escapeHtml(s.supplier)}</td><td>${tag(statusLabel(s.status), statusColor(s.status))}</td><td class="num" style="${s.delivery ? "" : "color:var(--warn);font-weight:600"}">${s.delivery ? fd(s.delivery) : "—"}</td><td class="r num"><b>${s.usd != null ? usd(s.usd) : s.amount != null ? usd(s.amount, s.currency || "") : "—"}</b>${s.orig ? `<span class="sub">${escapeHtml(s.orig)}</span>` : ""}</td></tr>`
      )
      .join("") ||
    `<tr><td colspan="6" class="dim" style="text-align:center;padding:30px">No owner supplies match.</td></tr>`;

  $$("#osBody tr[data-s]").forEach((tr) => {
    tr.onclick = () => openSupply(tr.dataset.s, tr);
  });
}

function renderGantt() {
  const wos = state.workOrders;
  const dated = wos.filter((w) => w.s && w.e);
  if (!dated.length) {
    $("#gantt").innerHTML =
      `<p class="dim" style="padding:16px">No dated work orders. ${wos.filter((w) => !w.s).length} shown as “no dates” below.</p>` +
      wos
        .map(
          (w) =>
            `<div class="g-row"><div class="lab"><span class="t dim">${escapeHtml(w.name)}</span><span class="p num">${w.p}%</span></div><div class="trk"><span class="nd">no dates in Maindeck</span></div></div>`
        )
        .join("");
    return;
  }
  const lo = Math.min(...dated.map((w) => w.s)) - 3 * DAY;
  const hi = Math.max(...dated.map((w) => w.e)) + 3 * DAY;
  const pct = (t) => ((t - lo) / (hi - lo)) * 100;
  const ticks = [];
  for (let t = lo; t < hi - 3 * DAY; t += 7 * DAY) ticks.push(t);
  let h = `<div class="g-head"><div></div><div style="position:relative">${ticks
    .map((t) => `<span style="position:absolute;left:${pct(t)}%;transform:translateX(-50%)">${fs(t)}</span>`)
    .join("")}</div></div>`;
  const groups = [...new Set(wos.map((w) => w.group))];
  for (const g of groups) {
    const ws = wos.filter((w) => w.group === g);
    const gd = ws.filter((w) => w.s && w.e);
    const ga = Math.round(ws.reduce((s, w) => s + w.p, 0) / (ws.length || 1));
    const gs = gd.length ? Math.min(...gd.map((w) => w.s)) : null;
    const ge = gd.length ? Math.max(...gd.map((w) => w.e)) : null;
    h += `<div class="g-row grp"><div class="lab"><span class="t">${escapeHtml(g)}</span><span class="p">${ga}%</span></div><div class="trk">${
      gs != null
        ? `<div class="gb" style="left:${pct(gs)}%;width:${pct(ge) - pct(gs)}%;top:12px;height:6px;background:#2C3D61"><i style="width:${ga}%;background:var(--muted)"></i></div>`
        : ""
    }<div class="today" style="position:absolute;top:0;bottom:0;width:2px;left:${pct(NOW)}%;background:var(--danger)"></div></div></div>`;
    for (const w of ws) {
      const k = execOf(w);
      const c = EXC[k];
      h += `<div class="g-row"><div class="lab"><span style="width:8px;height:8px;border-radius:50%;background:${c};flex:none"></span><span class="t ${w.s ? "" : "dim"}">${escapeHtml(w.name)}</span><span class="p num">${w.p}%</span></div><div class="trk">${
        w.s && w.e
          ? `<div class="gb" title="${fs(w.s)} – ${fs(w.e)}" style="left:${pct(w.s)}%;width:${Math.max(0.8, pct(w.e) - pct(w.s))}%;background:color-mix(in srgb, ${c} 28%, transparent)"><i style="width:${k === "done" ? 100 : w.p}%;background:${c}"></i></div>`
          : `<span class="nd">no dates in Maindeck</span>`
      }<div style="position:absolute;top:0;bottom:0;width:2px;left:${pct(NOW)}%;background:var(--danger);opacity:.7"></div></div></div>`;
    }
  }
  $("#gantt").innerHTML = h;
}

function renderGroupsOwners() {
  $("#groupsBody").innerHTML =
    state.groups
      .map((g) => `<tr><td>${escapeHtml(g.name || g.title || "—")}</td><td class="muted num">${escapeHtml(g.id)}</td></tr>`)
      .join("") || `<tr><td colspan="2" class="dim" style="text-align:center;padding:24px">No groups.</td></tr>`;
  $("#ownersBody").innerHTML =
    state.owners
      .map((o) => `<tr><td>${escapeHtml(o.name || o.email || o.title || "—")}</td><td class="muted num">${escapeHtml(o.id)}</td></tr>`)
      .join("") || `<tr><td colspan="2" class="dim" style="text-align:center;padding:24px">No owners.</td></tr>`;
}

function renderEcon() {
  const rows = state.econ;
  $("#econFile").textContent = state.econFile
    ? `Loaded: ${state.econFile}`
    : "Maindeck: Budgeting and cost → Export → Billed and actual amounts";
  if (!rows || !rows.length) {
    $("#eKpis").innerHTML = kpi("—", "Estimate", "Import Excel to load", "var(--muted)");
    $("#econBars").innerHTML = `<p class="dim">No economy file for this project yet.</p>`;
    return;
  }
  const byGroup = {};
  for (const r of rows) {
    const g = r.group || "Ungrouped";
    if (!byGroup[g]) byGroup[g] = { estimate: 0, committed: 0 };
    byGroup[g].estimate += r.estimate || 0;
    byGroup[g].committed += r.committed || 0;
  }
  const econ = Object.entries(byGroup).map(([n, v]) => [n, v.estimate, v.committed]);
  const est = econ.reduce((s, r) => s + r[1], 0);
  const com = econ.reduce((s, r) => s + r[2], 0);
  const mx = Math.max(...econ.flatMap((r) => [r[1], r[2]]), 1);
  $("#eKpis").innerHTML =
    kpi(kusd(est), "Estimate", "USD", "var(--muted)") +
    kpi(kusd(com), "Committed", "final › billed › total", "var(--accent)") +
    kpi(
      kusd(Math.abs(est - com)),
      com > est ? "Over estimate" : "Remaining",
      est ? Math.round((com / est) * 100) + "% of estimate used" : "",
      com > est ? "var(--danger)" : "var(--accent-2)"
    ) +
    kpi(econ.filter((r) => r[2] > r[1]).length, "Groups over estimate", "", "var(--danger)");
  $("#econBars").innerHTML =
    econ
      .map(
        ([n, e, c]) =>
          `<div class="hbar" style="grid-template-columns:220px 1fr 170px"><span>${escapeHtml(n)}</span><div style="display:grid;gap:3px"><div class="t"><i style="width:${(e / mx) * 100}%;background:#5F7193"></i></div><div class="t"><i style="width:${(c / mx) * 100}%;background:${c > e ? "var(--danger)" : "var(--accent)"}"></i></div></div><span class="num" style="text-align:right;${c > e ? "color:var(--danger);font-weight:700" : ""}">${usd(c)} / ${usd(e)}</span></div>`
      )
      .join("") +
    `<div class="legend" style="margin-top:12px"><span><i style="background:#5F7193"></i>Estimate</span><span><i style="background:var(--accent)"></i>Committed</span><span><i style="background:var(--danger)"></i>Over estimate</span></div>`;
}

function openSupply(id, tr) {
  const s = state.supplies.find((x) => x.id === id);
  if (!s) return;
  $$("#osBody tr").forEach((r) => r.classList.toggle("sel", r === tr));
  $("#dTag").innerHTML = tag(statusLabel(s.status), statusColor(s.status));
  $("#dTitle").textContent = s.name;
  $("#dSub").textContent = `PO ${s.po} · ${s.supplier}`;
  $("#dBody").innerHTML = `<div class="big num">${s.usd != null ? usd(s.usd, "USD") : "—"}</div><div class="muted" style="margin-bottom:20px">${s.orig ? `Original ${escapeHtml(s.orig)}` : s.amount != null ? "Booked amount" : "No cost"}</div>
   <dl class="kv"><dt>Delivery</dt><dd style="${s.delivery ? "" : "color:var(--warn)"}">${s.delivery ? fd(s.delivery) : "Not set"}</dd><dt>Category</dt><dd>${escapeHtml(s.category)}</dd><dt>Location</dt><dd>${escapeHtml(s.location)}</dd><dt>Equipment</dt><dd>${escapeHtml(s.equipment)}</dd></dl>`;
  $("#drawer").classList.add("open");
}

function go(v) {
  $$(".view").forEach((el) => el.classList.toggle("on", el.id === "v-" + v));
  $$(".rail [data-go]").forEach((b) => b.classList.toggle("on", b.dataset.go === v));
  if (v === "fleet") {
    $("#crumb").innerHTML = `<span>Fleet</span>`;
    renderFleet();
  } else if (state.current) {
    $("#crumb").innerHTML = `<a data-go="fleet">Fleet</a><span class="sep">/</span><span>${escapeHtml(state.current.ship)}</span><span class="sep">/</span><span>${escapeHtml(state.current.name)}</span>`;
    $("#crumb [data-go]")?.addEventListener("click", () => go("fleet"));
    renderProject();
  }
}

function exportCsv(rows, filename) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

async function handleXlsx(file) {
  if (!state.current || !window.readXlsxFile) {
    showBanner("Excel reader not available.");
    return;
  }
  try {
    const rows = await readXlsxFile(file);
    if (!rows.length) throw new Error("Empty workbook");
    const header = rows[0].map((h) => String(h || "").trim().toLowerCase());
    const need = ["wo name", "group", "estimate", "owner's supply", "total", "billed", "final"];
    const missing = need.filter((n) => !header.includes(n));
    if (missing.length) {
      throw new Error(`Missing columns: ${missing.join(", ")}`);
    }
    const idx = (n) => header.indexOf(n);
    const num = (v) => {
      const n = Number(String(v ?? "").replace(/,/g, ""));
      return Number.isFinite(n) ? n : 0;
    };
    const parsed = rows.slice(1).map((r) => {
      const final = num(r[idx("final")]);
      const billed = num(r[idx("billed")]);
      const total = num(r[idx("total")]);
      const committed = final > 0 ? final : billed > 0 ? billed : total;
      return {
        group: String(r[idx("group")] || "Ungrouped"),
        name: String(r[idx("wo name")] || ""),
        estimate: num(r[idx("estimate")]),
        ownerSupply: num(r[idx("owner's supply")]),
        total,
        billed,
        final,
        committed,
      };
    });
    if (state.current.slug && !file.name.toLowerCase().includes(String(state.current.slug).toLowerCase())) {
      showBanner(`Warning: filename does not include project slug “${state.current.slug}”.`);
    } else {
      showBanner("");
    }
    state.econ = parsed;
    state.econFile = file.name;
    localStorage.setItem(`md_econ_${state.current.id}`, JSON.stringify(parsed));
    localStorage.setItem(`md_econ_file_${state.current.id}`, file.name);
    state.ptab = "economy";
    renderProject();
  } catch (err) {
    showBanner(`Excel import failed: ${err.message}`);
  }
}

/* events */
$$(".rail [data-go]").forEach((b) => {
  b.onclick = () => {
    if (b.dataset.go === "project" && !state.current) return;
    go(b.dataset.go);
  };
});
$$("#phaseFilter button").forEach((b) => {
  b.onclick = () => {
    $$("#phaseFilter button").forEach((x) => x.classList.toggle("on", x === b));
    state.filter = b.dataset.f;
    renderFleet();
  };
});
$("#btnRefresh").onclick = () => bootstrap();
$("#btnPresent").onclick = () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
};
$("#teamSelect").onchange = async () => {
  state.teamId = $("#teamSelect").value;
  try {
    await loadProjects();
  } catch (err) {
    showBanner(err.message);
  }
};
$("#gsearch").oninput = (e) => {
  state.gsearch = e.target.value;
  if ($("#v-fleet").classList.contains("on")) renderFleet();
};
$("#osSearch").oninput = (e) => {
  state.osQ = e.target.value.toLowerCase();
  renderSupplies();
};
$$("th[data-sort]").forEach((th) => {
  th.onclick = () => {
    const key = th.dataset.sort;
    if (state.osSort.key === key) state.osSort.dir *= -1;
    else state.osSort = { key, dir: key === "usd" ? -1 : 1 };
    renderSupplies();
  };
});
$("#dx").onclick = () => {
  $("#drawer").classList.remove("open");
  $$("#osBody tr").forEach((r) => r.classList.remove("sel"));
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("#dx").click();
  if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
    e.preventDefault();
    $("#gsearch").focus();
  }
});
$("#btnOsCsv").onclick = () => {
  exportCsv(
    [
      ["Supply", "PO", "Supplier", "Status", "Delivery", "USD", "Original"],
      ...state.supplies.map((s) => [
        s.name,
        s.po,
        s.supplier,
        statusLabel(s.status),
        s.delivery ? fd(s.delivery) : "",
        s.usd ?? "",
        s.orig || "",
      ]),
    ],
    `owner-supplies-${state.current?.slug || "project"}.csv`
  );
};
$("#btnCsv").onclick = () => $("#btnOsCsv").click();
$("#xlsxInput").onchange = (e) => {
  const f = e.target.files?.[0];
  if (f) handleXlsx(f);
};
$("#btnSettings").onclick = () => {
  const nok = prompt("Override NOK per 1 USD (blank = ECB)", state.rates.overrides.NOK || "");
  if (nok == null) return;
  if (nok === "") delete state.rates.overrides.NOK;
  else state.rates.overrides.NOK = Number(nok);
  localStorage.setItem("md_fx_overrides", JSON.stringify(state.rates.overrides));
  if (state.current) openProject(state.current.id);
  else loadRates();
};

go("fleet");
bootstrap();
