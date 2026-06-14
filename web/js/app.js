import { api } from "./api.js";
import { el, toast, fmtDuration, fmtDate, num } from "./util.js";
import { icon } from "./icons.js";
import {
  MetricCard, JumpPhaseTimeline, ChartCard, JumpHeader, EmptyState,
  EditJumpForm, StatsOverview, capitalize,
} from "./components.js";
import {
  altitudeChart, verticalSpeedChart, heartRateChart, groundSpeedChart, combinedChart,
  jumpsPerMonthChart, freefallAccrualChart, exitDistributionChart, hasValues,
} from "./charts.js";
import { mount3D } from "./three-view.js";

const view = document.getElementById("view");

let liveCharts = [];
let cleanup3D = null;
let pollTimer = null;

function teardown() {
  liveCharts.forEach((c) => c.destroy());
  liveCharts = [];
  if (cleanup3D) { cleanup3D(); cleanup3D = null; }
  stopPoll();
}
function startPoll(fn, ms = 5000) { stopPoll(); pollTimer = setInterval(fn, ms); }
function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

// ---------------------------------------------------------------- router
const routes = { "": logbookView, "#/logbook": logbookView, "#/stats": statsView, "#/upload": uploadView };

async function router() {
  teardown();
  const hash = location.hash;
  setActiveNav(hash);
  try {
    if (hash.startsWith("#/jump/")) await jumpDetailView(hash.slice("#/jump/".length));
    else await (routes[hash] || logbookView)();
    window.scrollTo({ top: 0 });
  } catch (e) {
    view.innerHTML = "";
    view.append(EmptyState({
      name: "alert", title: "Kon data niet laden", text: e.message,
    }));
  }
}
window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", router);

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
    grid.append(el("div", { class: "jump-card", onclick: () => (location.hash = "#/jump/" + j.id) }, [
      el("div", { class: "jc-rail" }),
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
    ]));
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
    MetricCard({ name: "clock", color: "freefall", label: "Vrije-val-tijd", value: s.freefallTime != null ? fmtDuration(s.freefallTime) : null }),
    MetricCard({ name: "parachute", color: "canopy", label: "Canopy-tijd", value: s.canopyTime != null ? fmtDuration(s.canopyTime) : null }),
    MetricCard({ name: "gauge", color: "freefall", label: "Piek daalsnelheid", value: s.peakVerticalSpeed, unit: "m/s", estimate: true }),
    MetricCard({ name: "gauge", color: "freefall", label: "Gem. daalsnelheid", value: s.avgVerticalSpeed, unit: "m/s", estimate: true }),
    MetricCard({ name: "heart", color: "heart", label: "Piek hartslag", value: s.peakHr, unit: "bpm" }),
    MetricCard({ name: "heart", color: "heart", label: "Gem. hartslag", value: s.avgHr, unit: "bpm" }),
    MetricCard({ name: "wind", color: "speed", label: "Max grondsnelheid", value: s.maxGroundSpeed != null ? Math.round(s.maxGroundSpeed * 3.6) : null, unit: "km/u" }),
    MetricCard({ name: "move", color: "track", label: "Horizontale drift", value: s.horizontalDrift != null ? num(s.horizontalDrift) : null, unit: "m" }),
    MetricCard({ name: "target", color: "track", label: "Afstand tot target", value: s.distanceToTarget != null ? num(s.distanceToTarget) : null, unit: "m", placeholder: "Geen target" }),
  ]);
  view.append(grid);

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
  view.append(el("div", { class: "chart-grid" }, [
    ChartCard({ name: "barChart", color: "track", title: "Sprongen per maand", charts: liveCharts, build: (cv) => jumpsPerMonthChart(cv, st.perMonth) }),
    ChartCard({ name: "mountain", color: "altitude", title: "Verdeling exit-hoogtes", charts: liveCharts, hasData: Object.keys(st.exitBuckets).length > 0, build: (cv) => exitDistributionChart(cv, st.exitBuckets) }),
  ]));
  view.append(ChartCard({ name: "trendingUp", color: "freefall", title: "Cumulatieve vrije-val-tijd", charts: liveCharts, hasData: st.freefallAccrual.length > 0, build: (cv) => freefallAccrualChart(cv, st.freefallAccrual) }));
}

// ---------------------------------------------------------------- upload
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
