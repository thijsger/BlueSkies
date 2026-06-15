import { api } from "./api.js";
import { el, toast, fmtDuration, fmtDate, num } from "./util.js";
import { icon } from "./icons.js";
import {
  MetricCard, JumpPhaseTimeline, ChartCard, JumpHeader, EmptyState,
  EditJumpForm, StatsOverview, TrackingPanel, shouldShowTracking, RecordsPanel, capitalize,
} from "./components.js";
import {
  altitudeChart, verticalSpeedChart, heartRateChart, groundSpeedChart, combinedChart,
  jumpsPerMonthChart, freefallAccrualChart, exitDistributionChart,
  byTypeChart, byDropzoneChart, hrTrendChart, hrZonesChart, perfTrendChart, glideTrendChart, hasValues,
} from "./charts.js";
import { mount3D } from "./three-view.js";
import { mountMap } from "./map-view.js";
import { auth } from "./auth.js";
import { renderLogin } from "./login.js";
import { t, LANGS, getLang, setLang } from "./i18n.js";
import { altValue, altUnit, getUnit, setUnit, UNITS } from "./units.js";

let currentUser = null;

function applyStaticI18n() {
  document.querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = t(n.getAttribute("data-i18n")); });
}
function mountLangSelect() {
  const sel = document.getElementById("lang-select");
  if (!sel) return;
  sel.innerHTML = "";
  for (const l of LANGS) {
    const o = document.createElement("option");
    o.value = l.code; o.textContent = l.label;
    if (l.code === getLang()) o.selected = true;
    sel.append(o);
  }
  sel.onchange = () => setLang(sel.value); // persists + reloads

  const usel = document.getElementById("unit-select");
  if (usel) {
    usel.innerHTML = "";
    for (const u of UNITS) {
      const o = document.createElement("option");
      o.value = u.code; o.textContent = u.label;
      if (u.code === getUnit()) o.selected = true;
      usel.append(o);
    }
    usel.onchange = () => setUnit(usel.value);
  }
}

const view = document.getElementById("view");

let liveCharts = [];
let cleanup3D = null;
let cleanupMap = null;
let pollTimer = null;

function teardown() {
  liveCharts.forEach((c) => c.destroy());
  liveCharts = [];
  if (cleanup3D) { cleanup3D(); cleanup3D = null; }
  if (cleanupMap) { cleanupMap(); cleanupMap = null; }
  stopPoll();
}
function startPoll(fn, ms = 5000) { stopPoll(); pollTimer = setInterval(fn, ms); }
function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

// ---------------------------------------------------------------- router
const routes = { "": logbookView, "#/logbook": logbookView, "#/stats": statsView, "#/upload": uploadView, "#/profile": profileView, "#/privacy": privacyView };

async function router() {
  if (!currentUser) return; // gated; login screen handles it
  teardown();
  const hash = location.hash;
  setActiveNav(hash);
  try {
    if (hash.startsWith("#/jump/")) await jumpDetailView(hash.slice("#/jump/".length));
    else await (routes[hash] || logbookView)();
    window.scrollTo({ top: 0 });
  } catch (e) {
    if (e && e.status === 401) return showLogin();
    view.innerHTML = "";
    view.append(EmptyState({ name: "alert", title: "Kon data niet laden", text: e.message }));
  }
}
window.addEventListener("hashchange", router);

// ---------------------------------------------------------------- auth boot
async function boot() {
  applyStaticI18n();
  mountLangSelect();
  try {
    const { user } = await auth.me();
    if (user) { currentUser = user; onLoggedIn(); }
    else showLogin();
  } catch { showLogin(); }
}

function showLogin() {
  currentUser = null;
  teardown();
  document.body.classList.add("logged-out");
  renderLogin(view, (user) => {
    currentUser = user;
    document.body.classList.remove("logged-out");
    onLoggedIn();
  });
}

function onLoggedIn() {
  document.body.classList.remove("logged-out");
  mountUserMenu();
  if (!location.hash || location.hash === "#/login") location.hash = "#/logbook";
  router();
}

function mountUserMenu() {
  const bar = document.querySelector(".topbar");
  let slot = document.getElementById("user-slot");
  if (slot) slot.remove();
  slot = el("div", { id: "user-slot", class: "user-slot" });
  const initial = (currentUser.name || currentUser.email || "?").trim().charAt(0).toUpperCase();
  const avatar = el("button", { class: "avatar-btn", title: currentUser.email }, initial);
  const menu = el("div", { class: "user-menu hidden" }, [
    el("div", { class: "um-head" }, [el("div", { class: "um-name" }, currentUser.name || "—"), el("div", { class: "um-email" }, currentUser.email)]),
    el("a", { class: "um-item", href: "#/profile", onclick: () => menu.classList.add("hidden") }, [icon("satellite", 15), t("profile.title")]),
    el("button", { class: "um-item", onclick: doLogout }, [icon("logOut", 15), t("profile.logout")]),
  ]);
  avatar.addEventListener("click", (e) => { e.stopPropagation(); menu.classList.toggle("hidden"); });
  document.addEventListener("click", () => menu.classList.add("hidden"));
  slot.append(avatar, menu);
  bar.append(slot);
}

async function doLogout() {
  try { await auth.logout(); } catch {}
  const slot = document.getElementById("user-slot");
  if (slot) slot.remove();
  location.hash = "";
  showLogin();
}

window.addEventListener("DOMContentLoaded", boot);

function setActiveNav(hash) {
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const key = a.getAttribute("data-nav");
    a.classList.toggle("active", hash.includes(key) || (key === "logbook" && (hash === "" || hash.startsWith("#/jump"))));
  });
}

function pageHead(title, sub, action) {
  return el("div", { class: "page-head" }, [
    el("div", {}, [el("h1", { class: "page-title" }, title), sub ? el("p", { class: "page-sub" }, sub) : null]),
    action || null,
  ]);
}

// ---------------------------------------------------------------- logbook
async function logbookView() {
  let sig = null, prev = 0;
  async function load() {
    const jumps = await api.listJumps();
    const newSig = jumps.map((j) => j.id + (j.jumpType || "")).join(",") + "|" + jumps.length;
    if (newSig === sig) return;
    if (sig !== null && jumps.length > prev) toast(t("toast.newJump"), "ok");
    sig = newSig; prev = jumps.length;
    renderLogbook(jumps);
  }
  await load();
  startPoll(load, 5000);
}

function renderLogbook(jumps) {
  view.innerHTML = "";
  const uploadBtn = el("a", { class: "btn primary", href: "#/upload" }, [icon("upload", 16), t("btn.uploadFit")]);
  view.append(pageHead(t("logbook.title"),
    jumps.length ? t("logbook.count", { n: jumps.length }) : t("logbook.subDefault"),
    uploadBtn));

  if (!jumps.length) {
    view.append(EmptyState({
      name: "parachute", title: t("empty.noJumps.title"),
      text: t("empty.noJumps.text"),
      action: el("a", { class: "btn primary", href: "#/upload" }, [icon("upload", 16), t("btn.uploadFit")]),
    }));
    return;
  }

  const grid = el("div", { class: "logbook-grid" });
  for (const j of jumps) {
    const s = j.summary || {};
    let card;
    const delBtn = el("button", { class: "jc-del", title: t("jump.delete") }, [icon("trash", 15)]);
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(t("jump.deleteConfirm", { n: j.jumpNumber }))) return;
      try {
        await api.deleteJump(j.id);
        if (card) card.remove();
        toast(t("toast.deleted"), "ok");
      } catch (err) { toast(t("toast.deleteFail", { e: err.message }), "err"); }
    });
    card = el("div", { class: "jump-card", onclick: () => (location.hash = "#/jump/" + j.id) }, [
      el("div", { class: "jc-rail" }),
      delBtn,
      el("div", { class: "jc-head" }, [
        el("div", { class: "jc-num" }, [el("span", { class: "hash" }, "#"), String(j.jumpNumber ?? "—")]),
        el("div", { class: "jc-src" }, [
          el("span", { class: "status-badge neutral" }, [icon(j.source === "fit" ? "upload" : "refresh", 12), j.source === "fit" ? ".FIT" : "Watch"]),
          el("div", { class: "jc-date" }, fmtDate(j.startTime)),
        ]),
      ]),
      el("div", { class: "jc-dz" }, [icon("mapPin", 15), j.dropzone || t("dz.unknown"),
        j.jumpType ? el("span", { class: "jc-type" }, capitalize(j.jumpType)) : null]),
      el("div", { class: "jc-stats" }, [
        jcStat("mountain", "altitude", t("phase.exit"), s.exitAltitude != null ? num(s.exitAltitude) + " m" : "—"),
        jcStat("trendingDown", "freefall", t("phase.freefall"), fmtDuration(s.freefallTime)),
        jcStat("heart", "heart", t("m.peakHr"), s.peakHr != null ? s.peakHr + "" : "—"),
      ]),
    ]);
    grid.append(card);
  }
  view.append(grid);
}

function jcStat(name, color, label, value) {
  return el("div", { class: "jc-stat" }, [
    el("span", { class: "jc-stat-ico", "data-color": color }, [icon(name, 14)]),
    el("div", {}, [el("div", { class: "jc-stat-l" }, label), el("div", { class: "jc-stat-v" }, value)]),
  ]);
}

// ---------------------------------------------------------------- jump detail
async function jumpDetailView(id) {
  const jump = await api.getJump(id);
  view.innerHTML = "";
  const s = jump.summary || {};

  view.append(el("a", { class: "back", href: "#/logbook" }, [icon("chevronDown", 16, "rot90"), t("back.logbook")]));
  view.append(JumpHeader(jump));

  // phase timeline
  view.append(JumpPhaseTimeline(jump));

  // metric cards
  const grid = el("div", { class: "metric-grid" }, [
    MetricCard({ name: "mountain", color: "altitude", label: t("m.exitAlt"), value: s.exitAltitude != null ? num(altValue(s.exitAltitude)) : null, unit: altUnit() }),
    MetricCard({ name: "gauge", color: "freefall", label: t("m.peakVs"), value: s.peakVerticalSpeed, unit: "m/s", estimate: true }),
    MetricCard({ name: "gauge", color: "freefall", label: t("m.avgVs"), value: s.avgVerticalSpeed, unit: "m/s", estimate: true }),
    MetricCard({ name: "heart", color: "heart", label: t("m.peakHr"), value: s.peakHr, unit: "bpm" }),
    MetricCard({ name: "heart", color: "heart", label: t("m.avgHr"), value: s.avgHr, unit: "bpm" }),
    MetricCard({ name: "wind", color: "speed", label: t("m.maxGround"), value: s.maxGroundSpeed != null ? Math.round(s.maxGroundSpeed * 3.6) : null, unit: "km/u" }),
    MetricCard({ name: "move", color: "track", label: t("m.drift"), value: s.horizontalDrift != null ? num(s.horizontalDrift) : null, unit: "m" }),
    MetricCard({ name: "target", color: "track", label: t("m.distTarget"), value: s.distanceToTarget != null ? num(s.distanceToTarget) : null, unit: "m", placeholder: t("noTarget") }),
  ]);
  view.append(grid);

  // tracking / wingsuit performance (only when relevant)
  if (shouldShowTracking(jump)) view.append(TrackingPanel(jump));

  // edit form (collapsible)
  view.append(EditJumpForm(jump, {
    onSave: async (patch) => {
      try { await api.updateJump(jump.id, patch); toast(t("toast.saved"), "ok"); router(); }
      catch (e) { toast(t("toast.saveFail", { e: e.message }), "err"); }
    },
    onDelete: async () => {
      try { await api.deleteJump(jump.id); toast(t("toast.deleted"), "ok"); location.hash = "#/logbook"; }
      catch (e) { toast(t("toast.deleteFail", { e: e.message }), "err"); }
    },
  }));

  // 3D track (Google-Earth-style satellite world)
  view.append(track3DPanel(jump));

  // charts
  const series = jump.series || [];
  view.append(el("div", { class: "chart-grid" }, [
    ChartCard({ name: "mountain", color: "altitude", title: t("chart.altTime"), charts: liveCharts, hasData: hasValues(series, "alt"), build: (cv) => altitudeChart(cv, jump) }),
    ChartCard({ name: "gauge", color: "freefall", title: t("chart.vsTime"), badge: t("estimate"), charts: liveCharts, hasData: hasValues(series, "fallRate"), build: (cv) => verticalSpeedChart(cv, jump) }),
    ChartCard({ name: "heart", color: "heart", title: t("chart.hrTime"), charts: liveCharts, hasData: hasValues(series, "hr"), build: (cv) => heartRateChart(cv, jump) }),
    ChartCard({ name: "wind", color: "canopy", title: t("chart.groundCanopy"), charts: liveCharts, hasData: series.some((s2) => s2.phase === "canopy" && s2.groundSpeed != null), build: (cv) => groundSpeedChart(cv, jump) }),
  ]));
  view.append(ChartCard({ name: "activity", color: "altitude", title: t("chart.combined"), charts: liveCharts, hasData: hasValues(series, "alt"), build: (cv) => combinedChart(cv, jump) }));
}

function mapPanel(jump) {
  const hasGps = (jump.series || []).some((s) => s.lat != null && s.lng != null);
  const head = el("div", { class: "panel-head" }, [
    el("span", { class: "panel-ico", "data-color": "canopy" }, [icon("mapPin", 17)]),
    el("h3", {}, t("panel.map")),
  ]);
  if (!hasGps) {
    return el("div", { class: "panel" }, [head, EmptyState({
      name: "satellite", title: t("threeD.noGps"),
      text: t("map.noGps"),
    })]);
  }
  const container = el("div", { class: "map-wrap" });
  const panel = el("div", { class: "panel" }, [head, container]);
  requestAnimationFrame(() => { cleanupMap = mountMap(container, jump); });
  return panel;
}

function track3DPanel(jump) {
  const hasGps = (jump.series || []).some((s) => s.lat != null && s.lng != null);
  const head = el("div", { class: "panel-head" }, [
    el("span", { class: "panel-ico", "data-color": "track" }, [icon("cube", 17)]),
    el("h3", {}, t("panel.3d")),
  ]);

  if (!hasGps) {
    return el("div", { class: "panel track-panel" }, [head, EmptyState({
      name: "satellite", title: t("threeD.noGps"),
      text: t("map.noGps"),
      action: el("a", { class: "btn ghost", href: "#/upload" }, [icon("upload", 15), t("btn.uploadFit")]),
    })]);
  }

  const phaseChips = el("div", { class: "track-chips" });
  for (const ph of ["climb", "exit", "freefall", "canopy", "landed"]) {
    phaseChips.append(el("span", { class: "phase-chip", "data-phase": ph }, [
      el("span", { class: "dot", "data-phase": ph }), t("phase." + ph),
    ]));
  }

  const container = el("div", { class: "three-container" });
  const scrub = el("input", { type: "range", min: "0", max: "1", value: "1", class: "scrubber" });
  const playBtn = el("button", { class: "btn ghost icon-btn" }, [icon("play", 16)]);
  const controls = el("div", { class: "three-controls" }, [playBtn, scrub]);
  const panel = el("div", { class: "panel track-panel" }, [head, phaseChips, container, controls]);
  requestAnimationFrame(() => { cleanup3D = mount3D(container, scrub, playBtn, jump); });
  return panel;
}

// ---------------------------------------------------------------- stats
async function statsView() {
  let sig = null;
  async function load() {
    const st = await api.stats();
    const newSig = st.totalJumps + "|" + st.totalFreefallSec;
    if (newSig === sig) return;
    sig = newSig;
    renderStats(st);
  }
  await load();
  startPoll(load, 6000);
}

function renderStats(st) {
  liveCharts.forEach((c) => c.destroy());
  liveCharts = [];
  view.innerHTML = "";
  view.append(pageHead(t("stats.title"), st.totalJumps ? t("stats.subAuto") : t("stats.subDefault")));

  if (!st.totalJumps) {
    view.append(EmptyState({
      name: "barChart", title: t("stats.emptyTitle"),
      text: t("stats.emptyText"),
      action: el("a", { class: "btn primary", href: "#/upload" }, [icon("upload", 16), t("btn.uploadFit")]),
    }));
    return;
  }

  view.append(StatsOverview(st));

  // personal records
  if (st.records) view.append(RecordsPanel(st.records, (id) => (location.hash = "#/jump/" + id)));

  // currency line
  if (st.currency) {
    const c = st.currency;
    view.append(el("div", { class: "currency-bar" }, [
      currencyChip(t("cur.last30"), t("cur.jumpsN", { n: c.last30 })),
      currencyChip(t("cur.last90"), t("cur.jumpsN", { n: c.last90 })),
      currencyChip(t("cur.avgMonth"), String(c.avgPerMonth)),
      currencyChip(t("cur.gap"), c.longestGapDays + " " + t("unit.days")),
    ]));
  }

  const trend = st.trend || [];
  view.append(el("h2", {}, t("sec.trends")));
  view.append(ChartCard({ name: "heart", color: "heart", title: t("chart.hrPerJump"), charts: liveCharts, hasData: trend.some((p) => p.peakHr != null), build: (cv) => hrTrendChart(cv, trend) }));
  view.append(el("div", { class: "chart-grid" }, [
    ChartCard({ name: "activity", color: "heart", title: t("chart.hrZones"), charts: liveCharts, hasData: (st.hrZones || []).some((z) => z.sec > 0), build: (cv) => hrZonesChart(cv, st.hrZones) }),
    ChartCard({ name: "trendingUp", color: "altitude", title: t("chart.exitFf"), charts: liveCharts, hasData: trend.some((p) => p.exit != null), build: (cv) => perfTrendChart(cv, trend) }),
  ]));
  if ((st.glideTrend || []).length > 0) {
    view.append(ChartCard({ name: "navigation", color: "track", title: t("chart.glideTrend"), charts: liveCharts, build: (cv) => glideTrendChart(cv, st.glideTrend) }));
  }

  view.append(el("h2", {}, t("sec.distributions")));
  view.append(el("div", { class: "chart-grid" }, [
    ChartCard({ name: "barChart", color: "track", title: t("chart.perMonth"), charts: liveCharts, build: (cv) => jumpsPerMonthChart(cv, st.perMonth) }),
    ChartCard({ name: "parachute", color: "freefall", title: t("chart.perType"), charts: liveCharts, hasData: Object.keys(st.byType || {}).length > 0, build: (cv) => byTypeChart(cv, st.byType) }),
  ]));
  view.append(el("div", { class: "chart-grid" }, [
    ChartCard({ name: "mapPin", color: "canopy", title: t("chart.perDz"), charts: liveCharts, hasData: Object.keys(st.byDropzone || {}).length > 0, build: (cv) => byDropzoneChart(cv, st.byDropzone) }),
    ChartCard({ name: "mountain", color: "altitude", title: t("chart.exitDist"), charts: liveCharts, hasData: Object.keys(st.exitBuckets).length > 0, build: (cv) => exitDistributionChart(cv, st.exitBuckets) }),
  ]));
  view.append(ChartCard({ name: "trendingUp", color: "freefall", title: t("chart.cumFf"), charts: liveCharts, hasData: st.freefallAccrual.length > 0, build: (cv) => freefallAccrualChart(cv, st.freefallAccrual) }));
}

// ---------------------------------------------------------------- upload
function currencyChip(label, value) {
  return el("div", { class: "currency-chip" }, [
    el("div", { class: "cc-value" }, value),
    el("div", { class: "cc-label" }, label),
  ]);
}

// ---------------------------------------------------------------- profile
async function profileView() {
  view.innerHTML = "";
  view.append(el("a", { class: "back", href: "#/logbook" }, [icon("chevronDown", 16, "rot90"), t("btn.back")]));
  view.append(pageHead(t("profile.title"), currentUser.email));

  // account
  view.append(el("div", { class: "panel" }, [
    el("div", { class: "panel-head" }, [el("span", { class: "panel-ico", "data-color": "track" }, [icon("flag", 17)]), el("h3", {}, t("profile.account"))]),
    el("div", { class: "field" }, [el("span", { class: "field-label" }, t("profile.name")), el("input", { type: "text", value: currentUser.name || "", disabled: "" })]),
    el("div", { class: "field" }, [el("span", { class: "field-label" }, t("profile.email")), el("input", { type: "text", value: currentUser.email, disabled: "" })]),
    el("button", { class: "btn ghost sm", onclick: doLogout }, [icon("logOut", 15), t("profile.logout")]),
  ]));

  // watch API key
  const keyInput = el("input", { type: "text", value: currentUser.apiKey, readonly: "", class: "mono-input" });
  const copyBtn = el("button", { class: "btn ghost sm", onclick: () => { keyInput.select(); navigator.clipboard?.writeText(currentUser.apiKey); toast(t("toast.copied"), "ok"); } }, [icon("save", 15), t("btn.copy")]);
  const regenBtn = el("button", { class: "btn ghost-danger sm", onclick: async () => {
    if (!confirm(t("regen.confirm"))) return;
    try { const r = await auth.regenerateKey(); currentUser.apiKey = r.apiKey; keyInput.value = r.apiKey; toast(t("toast.newKey"), "ok"); }
    catch (e) { toast(e.message, "err"); }
  } }, [icon("refresh", 15), t("btn.regen")]);

  view.append(el("div", { class: "panel" }, [
    el("div", { class: "panel-head" }, [el("span", { class: "panel-ico", "data-color": "altitude" }, [icon("satellite", 17)]), el("h3", {}, t("profile.watchKey"))]),
    el("p", { class: "field-hint" }, t("profile.watchKeyHint")),
    el("div", { class: "inline-edit" }, [el("div", { class: "field", style: "flex:1" }, [el("span", { class: "field-label" }, t("profile.yourKey")), keyInput]), copyBtn, regenBtn]),
  ]));

  // data export (personal backup the user controls)
  view.append(el("div", { class: "panel" }, [
    el("div", { class: "panel-head" }, [el("span", { class: "panel-ico", "data-color": "canopy" }, [icon("save", 17)]), el("h3", {}, t("profile.data"))]),
    el("a", { class: "btn ghost sm", href: "/api/jumps/export" }, [icon("upload", 15), t("profile.export")]),
  ]));
}

function privacyView() {
  view.innerHTML = "";
  view.append(el("a", { class: "back", href: "#/logbook" }, [icon("chevronDown", 16, "rot90"), t("btn.back")]));
  view.append(pageHead(t("privacy.title")));
  const body = el("div", { class: "panel" }, []);
  for (const para of t("privacy.body").split("\n\n")) {
    body.append(el("p", { class: "privacy-p" }, para));
  }
  view.append(body);
}

async function uploadView() {
  view.innerHTML = "";
  view.append(pageHead(t("upload.title"), t("upload.sub")));

  const JUMP_TYPES = ["", "tandem", "AFF", "fun", "freefly", "tracking", "wingsuit", "hop & pop"];
  const fileInput = el("input", { type: "file", accept: ".fit,.FIT", style: "display:none" });
  const typeSel = el("select", {}, JUMP_TYPES.map((tp) => el("option", { value: tp }, tp || t("upload.typeOptional"))));
  const status = el("div", { class: "upload-status" });

  const dz = el("div", { class: "dropzone" }, [
    el("div", { class: "dz-ico" }, [icon("upload", 30)]),
    el("div", { class: "dz-title" }, t("dz.drop")),
    el("div", { class: "dz-hint" }, t("dz.hint")),
  ]);
  dz.addEventListener("click", () => fileInput.click());
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("drag"); if (e.dataTransfer.files[0]) doUpload(e.dataTransfer.files[0]); });
  fileInput.addEventListener("change", () => { if (fileInput.files[0]) doUpload(fileInput.files[0]); });

  async function doUpload(file) {
    status.innerHTML = "";
    status.append(el("div", { class: "note info" }, [icon("refresh", 15), t("upload.parsing", { f: file.name })]));
    try {
      const res = await api.uploadFit(file, { jumpType: typeSel.value });
      toast(t("upload.imported", { n: res.jumpNumber }), "ok");
      location.hash = "#/jump/" + res.id;
    } catch (e) {
      status.innerHTML = "";
      status.append(el("div", { class: "note err" }, [icon("alert", 15), t("upload.fail", { e: e.message })]));
    }
  }

  view.append(el("div", { class: "panel upload-panel" }, [
    el("label", { class: "field" }, [el("span", { class: "field-label" }, t("upload.typeOptional")), typeSel]),
    dz, fileInput, status,
    el("p", { class: "field-hint" }, t("upload.tip")),
  ]));
}
