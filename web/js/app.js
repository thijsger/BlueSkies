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

let currentUser = null;

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
const routes = { "": logbookView, "#/logbook": logbookView, "#/stats": statsView, "#/upload": uploadView, "#/profile": profileView };

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
    el("a", { class: "um-item", href: "#/profile", onclick: () => menu.classList.add("hidden") }, [icon("satellite", 15), "Profiel & watch-key"]),
    el("button", { class: "um-item", onclick: doLogout }, [icon("logOut", 15), "Uitloggen"]),
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
    if (sig !== null && jumps.length > prev) toast("Nieuwe sprong binnengekomen", "ok");
    sig = newSig; prev = jumps.length;
    renderLogbook(jumps);
  }
  await load();
  startPoll(load, 5000);
}

function renderLogbook(jumps) {
  view.innerHTML = "";
  const uploadBtn = el("a", { class: "btn primary", href: "#/upload" }, [icon("upload", 16), "Upload .FIT"]);
  view.append(pageHead("Logboek",
    jumps.length ? `${jumps.length} sprong${jumps.length === 1 ? "" : "en"} · synct automatisch` : "Persoonlijk skydive-logboek",
    uploadBtn));

  if (!jumps.length) {
    view.append(EmptyState({
      name: "parachute", title: "Nog geen sprongen",
      text: "Upload een .FIT-bestand of maak je eerste opname met de Garmin-app. Nieuwe sprongen verschijnen hier automatisch.",
      action: el("a", { class: "btn primary", href: "#/upload" }, [icon("upload", 16), "Upload .FIT"]),
    }));
    return;
  }

  const grid = el("div", { class: "logbook-grid" });
  for (const j of jumps) {
    const s = j.summary || {};
    let card;
    const delBtn = el("button", { class: "jc-del", title: "Verwijder sprong" }, [icon("trash", 15)]);
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Sprong #${j.jumpNumber} verwijderen?`)) return;
      try {
        await api.deleteJump(j.id);
        if (card) card.remove();
        toast("Sprong verwijderd", "ok");
      } catch (err) { toast("Verwijderen mislukt: " + err.message, "err"); }
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
      el("div", { class: "jc-dz" }, [icon("mapPin", 15), j.dropzone || "Onbekende dropzone",
        j.jumpType ? el("span", { class: "jc-type" }, capitalize(j.jumpType)) : null]),
      el("div", { class: "jc-stats" }, [
        jcStat("mountain", "altitude", "Exit", s.exitAltitude != null ? num(s.exitAltitude) + " m" : "—"),
        jcStat("trendingDown", "freefall", "Vrije val", fmtDuration(s.freefallTime)),
        jcStat("heart", "heart", "Piek HR", s.peakHr != null ? s.peakHr + "" : "—"),
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

  view.append(el("a", { class: "back", href: "#/logbook" }, [icon("chevronDown", 16, "rot90"), "Terug naar logboek"]));
  view.append(JumpHeader(jump));

  // phase timeline
  view.append(JumpPhaseTimeline(jump));

  // metric cards
  const grid = el("div", { class: "metric-grid" }, [
    MetricCard({ name: "mountain", color: "altitude", label: "Exit-hoogte", value: s.exitAltitude != null ? num(s.exitAltitude) : null, unit: "m" }),
    MetricCard({ name: "gauge", color: "freefall", label: "Piek daalsnelheid", value: s.peakVerticalSpeed, unit: "m/s", estimate: true }),
    MetricCard({ name: "gauge", color: "freefall", label: "Gem. daalsnelheid", value: s.avgVerticalSpeed, unit: "m/s", estimate: true }),
    MetricCard({ name: "heart", color: "heart", label: "Piek hartslag", value: s.peakHr, unit: "bpm" }),
    MetricCard({ name: "heart", color: "heart", label: "Gem. hartslag", value: s.avgHr, unit: "bpm" }),
    MetricCard({ name: "wind", color: "speed", label: "Max grondsnelheid", value: s.maxGroundSpeed != null ? Math.round(s.maxGroundSpeed * 3.6) : null, unit: "km/u" }),
    MetricCard({ name: "move", color: "track", label: "Horizontale drift", value: s.horizontalDrift != null ? num(s.horizontalDrift) : null, unit: "m" }),
    MetricCard({ name: "target", color: "track", label: "Afstand tot target", value: s.distanceToTarget != null ? num(s.distanceToTarget) : null, unit: "m", placeholder: "Geen target" }),
  ]);
  view.append(grid);

  // tracking / wingsuit performance (only when relevant)
  if (shouldShowTracking(jump)) view.append(TrackingPanel(jump));

  // edit form (collapsible)
  view.append(EditJumpForm(jump, {
    onSave: async (patch) => {
      try { await api.updateJump(jump.id, patch); toast("Opgeslagen", "ok"); router(); }
      catch (e) { toast("Opslaan mislukt: " + e.message, "err"); }
    },
    onDelete: async () => {
      try { await api.deleteJump(jump.id); toast("Sprong verwijderd", "ok"); location.hash = "#/logbook"; }
      catch (e) { toast("Verwijderen mislukt: " + e.message, "err"); }
    },
  }));

  // map (ground track on satellite imagery)
  view.append(mapPanel(jump));

  // 3D track
  view.append(track3DPanel(jump));

  // charts
  const series = jump.series || [];
  view.append(el("div", { class: "chart-grid" }, [
    ChartCard({ name: "mountain", color: "altitude", title: "Hoogte vs tijd", charts: liveCharts, hasData: hasValues(series, "alt"), build: (cv) => altitudeChart(cv, jump) }),
    ChartCard({ name: "gauge", color: "freefall", title: "Daalsnelheid vs tijd", badge: "schatting", charts: liveCharts, hasData: hasValues(series, "fallRate"), build: (cv) => verticalSpeedChart(cv, jump) }),
    ChartCard({ name: "heart", color: "heart", title: "Hartslag vs tijd", charts: liveCharts, hasData: hasValues(series, "hr"), build: (cv) => heartRateChart(cv, jump) }),
    ChartCard({ name: "wind", color: "canopy", title: "Grondsnelheid — canopy", charts: liveCharts, hasData: series.some((s2) => s2.phase === "canopy" && s2.groundSpeed != null), emptyText: "Geen GPS-grondsnelheid in de canopy-fase.", build: (cv) => groundSpeedChart(cv, jump) }),
  ]));
  view.append(ChartCard({ name: "activity", color: "altitude", title: "Hoogte + daalsnelheid", charts: liveCharts, hasData: hasValues(series, "alt"), build: (cv) => combinedChart(cv, jump) }));
}

function mapPanel(jump) {
  const hasGps = (jump.series || []).some((s) => s.lat != null && s.lng != null);
  const head = el("div", { class: "panel-head" }, [
    el("span", { class: "panel-ico", "data-color": "canopy" }, [icon("mapPin", 17)]),
    el("h3", {}, "Kaart — grondtrack"),
  ]);
  if (!hasGps) {
    return el("div", { class: "panel" }, [head, EmptyState({
      name: "satellite", title: "Geen GPS-track beschikbaar",
      text: "Deze opname bevat geen GPS-posities, dus er is geen kaart te tonen.",
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
    el("h3", {}, "3D-sprongtrack"),
  ]);

  if (!hasGps) {
    return el("div", { class: "panel track-panel" }, [head, EmptyState({
      name: "satellite", title: "Geen GPS-track beschikbaar",
      text: "Deze opname bevat geen GPS-posities. Maak een opname buiten met GPS-fix, of upload een .FIT met locatiedata om de 3D-track te zien.",
      action: el("a", { class: "btn ghost", href: "#/upload" }, [icon("upload", 15), "Upload .FIT"]),
    })]);
  }

  const phaseChips = el("div", { class: "track-chips" });
  for (const [ph, label] of [["climb", "Klim"], ["exit", "Exit"], ["freefall", "Vrije val"], ["canopy", "Canopy"], ["landed", "Landing"]]) {
    phaseChips.append(el("span", { class: "phase-chip", "data-phase": ph }, [
      el("span", { class: "dot", "data-phase": ph }), label,
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
  view.append(pageHead("Statistieken", st.totalJumps ? "Cumulatieve cijfers en trends · synct automatisch" : "Cumulatieve cijfers en trends over al je sprongen"));

  if (!st.totalJumps) {
    view.append(EmptyState({
      name: "barChart", title: "Nog geen statistieken",
      text: "Zodra je eerste sprong binnen is, verschijnen hier je totalen en trends.",
      action: el("a", { class: "btn primary", href: "#/upload" }, [icon("upload", 16), "Upload .FIT"]),
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
      currencyChip("Laatste 30 dagen", c.last30 + " sprong" + (c.last30 === 1 ? "" : "en")),
      currencyChip("Laatste 90 dagen", c.last90 + " sprong" + (c.last90 === 1 ? "" : "en")),
      currencyChip("Gem. per maand", String(c.avgPerMonth)),
      currencyChip("Langste pauze", c.longestGapDays + " dgn"),
    ]));
  }

  const trend = st.trend || [];
  view.append(el("h2", {}, "Trends over tijd"));
  view.append(ChartCard({ name: "heart", color: "heart", title: "Hartslag per sprong", charts: liveCharts, hasData: trend.some((p) => p.peakHr != null), emptyText: "Nog geen hartslagdata.", build: (cv) => hrTrendChart(cv, trend) }));
  view.append(el("div", { class: "chart-grid" }, [
    ChartCard({ name: "activity", color: "heart", title: "Hartslag-zones (totaal)", charts: liveCharts, hasData: (st.hrZones || []).some((z) => z.sec > 0), emptyText: "Nog geen hartslagdata.", build: (cv) => hrZonesChart(cv, st.hrZones) }),
    ChartCard({ name: "trendingUp", color: "altitude", title: "Exit-hoogte & vrije val", charts: liveCharts, hasData: trend.some((p) => p.exit != null), build: (cv) => perfTrendChart(cv, trend) }),
  ]));
  if ((st.glideTrend || []).length > 0) {
    view.append(ChartCard({ name: "navigation", color: "track", title: "Glijgetal-trend (tracking/wingsuit)", charts: liveCharts, build: (cv) => glideTrendChart(cv, st.glideTrend) }));
  }

  view.append(el("h2", {}, "Verdelingen"));
  view.append(el("div", { class: "chart-grid" }, [
    ChartCard({ name: "barChart", color: "track", title: "Sprongen per maand", charts: liveCharts, build: (cv) => jumpsPerMonthChart(cv, st.perMonth) }),
    ChartCard({ name: "parachute", color: "freefall", title: "Sprongen per type", charts: liveCharts, hasData: Object.keys(st.byType || {}).length > 0, build: (cv) => byTypeChart(cv, st.byType) }),
  ]));
  view.append(el("div", { class: "chart-grid" }, [
    ChartCard({ name: "mapPin", color: "canopy", title: "Sprongen per dropzone", charts: liveCharts, hasData: Object.keys(st.byDropzone || {}).length > 0, build: (cv) => byDropzoneChart(cv, st.byDropzone) }),
    ChartCard({ name: "mountain", color: "altitude", title: "Verdeling exit-hoogtes", charts: liveCharts, hasData: Object.keys(st.exitBuckets).length > 0, build: (cv) => exitDistributionChart(cv, st.exitBuckets) }),
  ]));
  view.append(ChartCard({ name: "trendingUp", color: "freefall", title: "Cumulatieve vrije-val-tijd", charts: liveCharts, hasData: st.freefallAccrual.length > 0, build: (cv) => freefallAccrualChart(cv, st.freefallAccrual) }));
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
  view.append(el("a", { class: "back", href: "#/logbook" }, [icon("chevronDown", 16, "rot90"), "Terug"]));
  view.append(pageHead("Profiel", currentUser.email));

  // account
  view.append(el("div", { class: "panel" }, [
    el("div", { class: "panel-head" }, [el("span", { class: "panel-ico", "data-color": "track" }, [icon("flag", 17)]), el("h3", {}, "Account")]),
    el("div", { class: "field" }, [el("span", { class: "field-label" }, "Naam"), el("input", { type: "text", value: currentUser.name || "", disabled: "" })]),
    el("div", { class: "field" }, [el("span", { class: "field-label" }, "E-mail"), el("input", { type: "text", value: currentUser.email, disabled: "" })]),
    el("button", { class: "btn ghost sm", onclick: doLogout }, [icon("logOut", 15), "Uitloggen"]),
  ]));

  // watch API key
  const keyInput = el("input", { type: "text", value: currentUser.apiKey, readonly: "", class: "mono-input" });
  const copyBtn = el("button", { class: "btn ghost sm", onclick: () => { keyInput.select(); navigator.clipboard?.writeText(currentUser.apiKey); toast("Gekopieerd", "ok"); } }, [icon("save", 15), "Kopieer"]);
  const regenBtn = el("button", { class: "btn ghost-danger sm", onclick: async () => {
    if (!confirm("Nieuwe key genereren? De oude stopt direct met werken (watch opnieuw instellen).")) return;
    try { const r = await auth.regenerateKey(); currentUser.apiKey = r.apiKey; keyInput.value = r.apiKey; toast("Nieuwe key", "ok"); }
    catch (e) { toast(e.message, "err"); }
  } }, [icon("refresh", 15), "Vernieuw"]);

  view.append(el("div", { class: "panel" }, [
    el("div", { class: "panel-head" }, [el("span", { class: "panel-ico", "data-color": "altitude" }, [icon("satellite", 17)]), el("h3", {}, "Watch-key (API)")]),
    el("p", { class: "field-hint" }, "Zet deze key in de Garmin-app (BlueSkies → instellingen → API-key) zodat je horloge sprongen naar jouw account stuurt."),
    el("div", { class: "inline-edit" }, [el("div", { class: "field", style: "flex:1" }, [el("span", { class: "field-label" }, "Jouw API-key"), keyInput]), copyBtn, regenBtn]),
  ]));
}

async function uploadView() {
  view.innerHTML = "";
  view.append(pageHead("Upload .FIT", "Exporteer een activiteit van je Garmin als .FIT en sleep hem hierheen. Wordt server-side geparsed in hetzelfde datamodel als een live opname."));

  const JUMP_TYPES = ["", "tandem", "AFF", "fun", "freefly", "tracking", "wingsuit", "hop & pop"];
  const fileInput = el("input", { type: "file", accept: ".fit,.FIT", style: "display:none" });
  const typeSel = el("select", {}, JUMP_TYPES.map((t) => el("option", { value: t }, t || "— type (optioneel) —")));
  const status = el("div", { class: "upload-status" });

  const dz = el("div", { class: "dropzone" }, [
    el("div", { class: "dz-ico" }, [icon("upload", 30)]),
    el("div", { class: "dz-title" }, "Sleep een .FIT hierheen of klik om te kiezen"),
    el("div", { class: "dz-hint" }, "max 25 MB · wordt automatisch geüpload zodra je een bestand kiest"),
  ]);
  dz.addEventListener("click", () => fileInput.click());
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("drag"); if (e.dataTransfer.files[0]) doUpload(e.dataTransfer.files[0]); });
  fileInput.addEventListener("change", () => { if (fileInput.files[0]) doUpload(fileInput.files[0]); });

  async function doUpload(file) {
    status.innerHTML = "";
    status.append(el("div", { class: "note info" }, [icon("refresh", 15), `Bezig met uploaden en parsen van ${file.name}…`]));
    try {
      const res = await api.uploadFit(file, { jumpType: typeSel.value });
      toast("Sprong geïmporteerd (#" + res.jumpNumber + ")", "ok");
      location.hash = "#/jump/" + res.id;
    } catch (e) {
      status.innerHTML = "";
      status.append(el("div", { class: "note err" }, [icon("alert", 15), "Upload mislukt: " + e.message]));
    }
  }

  view.append(el("div", { class: "panel upload-panel" }, [
    el("label", { class: "field" }, [el("span", { class: "field-label" }, "Type (optioneel)"), typeSel]),
    dz, fileInput, status,
    el("p", { class: "field-hint" }, "Tip: maak eerst een normale activiteit-opname om de hele pijplijn te testen vóór een echte sprong."),
  ]));
}
