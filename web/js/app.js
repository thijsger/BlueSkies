import { api } from "./api.js";
import { el, toast, fmtDuration, fmtDate, num } from "./util.js";
import {
  altitudeChart, verticalSpeedChart, heartRateChart, groundSpeedChart,
  jumpsPerMonthChart, freefallAccrualChart, exitDistributionChart, phaseLegend,
} from "./charts.js";
import { mount3D } from "./three-view.js";

const view = document.getElementById("view");
const JUMP_TYPES = ["", "tandem", "AFF", "fun", "freefly", "tracking", "wingsuit", "hop & pop"];

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
const routes = {
  "": logbookView,
  "#/logbook": logbookView,
  "#/stats": statsView,
  "#/upload": uploadView,
};

async function router() {
  teardown();
  const hash = location.hash;
  setActiveNav(hash);
  try {
    if (hash.startsWith("#/jump/")) {
      await jumpDetailView(hash.slice("#/jump/".length));
    } else {
      await (routes[hash] || logbookView)();
    }
  } catch (e) {
    view.innerHTML = "";
    view.append(el("div", { class: "empty" }, [
      el("div", { class: "big" }, "⚠️"),
      el("p", {}, el("strong", {}, "Kon data niet laden")),
      el("p", { class: "muted" }, e.message),
      el("p", { class: "dim" }, "Draait de backend? Controleer de API-URL."),
    ]));
  }
}
window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", router);
document.querySelector(".brand").addEventListener("click", () => (location.hash = "#/logbook"));

function setActiveNav(hash) {
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const key = a.getAttribute("data-nav");
    a.classList.toggle("active", hash.includes(key) || (key === "logbook" && (hash === "" || hash.startsWith("#/jump"))));
  });
}

// ---------------------------------------------------------------- logbook
async function logbookView() {
  let sig = null;
  let prevCount = 0;

  async function load() {
    const jumps = await api.listJumps();
    const newSig = jumps.map((j) => j.id + (j.jumpType || "")).join(",") + "|" + jumps.length;
    if (newSig === sig) return;           // niets veranderd -> niet opnieuw renderen
    if (sig !== null && jumps.length > prevCount) {
      toast("🪂 Nieuwe sprong binnengekomen!", "ok");
    }
    sig = newSig;
    prevCount = jumps.length;
    renderLogbook(jumps);
  }

  await load();
  startPoll(load, 5000);  // automatisch verversen: live POST's verschijnen vanzelf
}

function renderLogbook(jumps) {
  view.innerHTML = "";
  view.append(el("div", { class: "page-head" }, [
    el("div", {}, [
      el("h1", {}, [el("span", { class: "grad" }, "Logboek")]),
      el("p", { class: "sub" }, jumps.length
        ? `${jumps.length} sprong${jumps.length === 1 ? "" : "en"} · vernieuwt automatisch`
        : "Persoonlijk naslag-logboek"),
    ]),
    el("a", { class: "btn", href: "#/upload" }, ["⬆️ Upload .FIT"]),
  ]));

  if (!jumps.length) { view.append(emptyState()); return; }

  const grid = el("div", { class: "logbook-grid" });
  for (const j of jumps) {
    const s = j.summary || {};
    grid.append(el("div", { class: "jump-card", onclick: () => (location.hash = "#/jump/" + j.id) }, [
      el("div", { class: "jc-top" }, [
        el("div", { class: "jc-num" }, [el("small", {}, "#"), String(j.jumpNumber ?? "—")]),
        el("div", { style: "text-align:right" }, [
          el("div", {}, sourceBadge(j.source)),
          el("div", { class: "jc-date", style: "margin-top:4px" }, fmtDate(j.startTime)),
        ]),
      ]),
      el("div", { class: "jc-dz" }, ["📍 ", j.dropzone || "Onbekende dropzone",
        j.jumpType ? el("span", { class: "badge", style: "background:rgba(255,255,255,0.1);margin-left:auto" }, j.jumpType) : null]),
      el("div", { class: "jc-stats" }, [
        miniStat("Exit", s.exitAltitude != null ? num(s.exitAltitude) + " m" : "—"),
        miniStat("Vrije val", fmtDuration(s.freefallTime)),
        miniStat("Piek HR", s.peakHr != null ? s.peakHr + "" : "—"),
      ]),
    ]));
  }
  view.append(grid);
}

function miniStat(label, value) {
  return el("div", { class: "jc-stat" }, [
    el("div", { class: "l" }, label),
    el("div", { class: "v" }, value),
  ]);
}

function emptyState() {
  return el("div", { class: "empty" }, [
    el("div", { class: "big" }, "🪂"),
    el("p", {}, el("strong", {}, "Nog geen sprongen")),
    el("p", {}, "Upload een .FIT-bestand of maak je eerste opname met de Garmin-app."),
    el("p", { class: "dim" }, "Nieuwe sprongen verschijnen hier automatisch."),
    el("div", { class: "cta" }, el("a", { class: "btn", href: "#/upload" }, "⬆️ Upload .FIT")),
  ]);
}

function sourceBadge(src) {
  const map = { live: ["⌚ watch", "linear-gradient(135deg,#4f8dff,#8a5cff)"], fit: [".FIT", "linear-gradient(135deg,#8a5cff,#c026d3)"] };
  const [txt, bg] = map[src] || ["?", "#30363d"];
  return el("span", { class: "badge", style: `background:${bg}` }, txt);
}

// ---------------------------------------------------------------- jump detail
async function jumpDetailView(id) {
  const jump = await api.getJump(id);
  view.innerHTML = "";
  const s = jump.summary || {};

  view.append(el("a", { class: "back", href: "#/logbook" }, "← Terug naar logboek"));
  view.append(el("div", { class: "page-head" }, [
    el("div", {}, [
      el("h1", {}, [el("span", { class: "grad" }, "Sprong #" + (jump.jumpNumber ?? "—"))]),
      el("p", { class: "sub" }, `${fmtDate(jump.startTime)} · 📍 ${jump.dropzone || "Onbekende dropzone"} · ${jump.device || ""}`),
    ]),
    sourceBadge(jump.source),
  ]));

  if (s.dataQuality === "no-freefall-detected") {
    view.append(el("div", { class: "note" },
      "ℹ️ Geen vrije val gedetecteerd (bv. een grondtest of trage daling). Fases en samenvatting zijn een beste schatting."));
  }

  // summary cards
  const cards = el("div", { class: "cards" });
  cards.append(card("Exit-hoogte", s.exitAltitude, "m", { icon: "🛩️", accent: "blue" }));
  cards.append(card("Vrije val", fmtDuration(s.freefallTime), "", { icon: "🪂", accent: "red" }));
  cards.append(card("Canopy-tijd", fmtDuration(s.canopyTime), "", { icon: "🟢", accent: "green" }));
  cards.append(card("Piek daalsnelheid", s.peakVerticalSpeed, "m/s", { icon: "⚡", accent: "red", est: true }));
  cards.append(card("Gem. daalsnelheid", s.avgVerticalSpeed, "m/s", { icon: "📉", est: true }));
  cards.append(card("Piek hartslag", s.peakHr, "bpm", { icon: "❤️", accent: "pink" }));
  cards.append(card("Gem. hartslag", s.avgHr, "bpm", { icon: "💗", accent: "pink" }));
  cards.append(card("Horizontale drift", s.horizontalDrift, "m", { icon: "↔️", accent: "blue" }));
  cards.append(card("Max grondsnelheid", s.maxGroundSpeed != null ? (s.maxGroundSpeed * 3.6).toFixed(0) : null, "km/u", { icon: "💨", accent: "green" }));
  if (s.distanceToTarget != null) cards.append(card("Afstand tot target", s.distanceToTarget, "m", { icon: "🎯", accent: "blue" }));
  view.append(cards);

  view.append(editPanel(jump));

  // 3D
  const threeContainer = el("div", {});
  const scrub = el("input", { type: "range", min: "0", max: "1", value: "1" });
  const playBtn = el("button", { class: "btn secondary" }, "▶ Afspelen");
  const threePanel = el("div", { class: "panel" }, [
    el("h3", {}, [el("span", { class: "ico" }, "🧊"), "3D-sprongtrack"]),
    phaseLegend(),
    threeContainer,
    el("div", { class: "three-controls" }, [playBtn, scrub]),
  ]);
  view.append(threePanel);
  cleanup3D = mount3D(threeContainer, scrub, playBtn, jump);

  // charts
  view.append(phaseLegend());
  view.append(chartPanel("📈", "Hoogte vs tijd", (cv) => altitudeChart(cv, jump)));
  view.append(chartPanel("⚡", "Daalsnelheid vs tijd", (cv) => verticalSpeedChart(cv, jump), true));
  view.append(chartPanel("❤️", "Hartslag vs tijd", (cv) => heartRateChart(cv, jump)));
  view.append(chartPanel("💨", "Grondsnelheid — canopy-fase", (cv) => groundSpeedChart(cv, jump)));
}

function card(label, value, unit, opts = {}) {
  const v = (value == null || value === "—") ? "—" : value;
  return el("div", { class: "card" + (opts.accent ? " accent-" + opts.accent : "") }, [
    opts.icon ? el("div", { class: "card-ico" }, opts.icon) : null,
    el("div", { class: "label" }, [label, opts.est ? el("span", { class: "est", title: "Schatting — barometer onbetrouwbaar in vrije val" }, "schatting") : null]),
    el("div", { class: "value" }, [String(v), unit ? el("span", { class: "unit" }, " " + unit) : null]),
  ]);
}

function chartPanel(ico, title, build, estimate) {
  const canvas = el("canvas", {});
  const panel = el("div", { class: "panel" }, [
    el("h3", {}, [el("span", { class: "ico" }, ico), title,
      estimate ? el("span", { class: "est", style: "margin-left:auto" }, "schatting") : null]),
    el("div", { class: "chart-wrap" }, canvas),
  ]);
  requestAnimationFrame(() => liveCharts.push(build(canvas)));
  return panel;
}

function editPanel(jump) {
  const typeSel = el("select", {},
    JUMP_TYPES.map((t) => el("option", t === (jump.jumpType || "") ? { value: t, selected: "" } : { value: t }, t || "— type —")));
  const notes = el("textarea", { placeholder: "Notities…" }, jump.notes || "");
  const targetLat = el("input", { type: "number", step: "0.000001", placeholder: "lat", value: jump.target?.lat ?? "" });
  const targetLng = el("input", { type: "number", step: "0.000001", placeholder: "lng", value: jump.target?.lng ?? "" });

  const save = el("button", { class: "btn", onclick: async () => {
    try {
      const target = (targetLat.value && targetLng.value)
        ? { lat: Number(targetLat.value), lng: Number(targetLng.value) } : null;
      await api.updateJump(jump.id, { jumpType: typeSel.value, notes: notes.value, target });
      toast("✓ Opgeslagen", "ok");
      router();
    } catch (e) { toast("Opslaan mislukt: " + e.message, "err"); }
  } }, "💾 Opslaan");

  const del = el("button", { class: "btn danger", onclick: async () => {
    if (!confirm("Deze sprong verwijderen?")) return;
    try { await api.deleteJump(jump.id); toast("Verwijderd", "ok"); location.hash = "#/logbook"; }
    catch (e) { toast("Verwijderen mislukt: " + e.message, "err"); }
  } }, "🗑 Verwijder");

  return el("div", { class: "panel" }, [
    el("h3", {}, [el("span", { class: "ico" }, "✏️"), "Bewerken"]),
    el("div", { class: "inline-edit" }, [
      field("Type", typeSel),
      field("Target lat", targetLat),
      field("Target lng", targetLng),
    ]),
    field("Notities", notes),
    el("div", { class: "inline-edit", style: "margin-top:0.5rem" }, [save, del]),
  ]);
}

function field(label, input) {
  return el("div", { class: "field" }, [el("label", {}, label), input]);
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
  view.append(el("h1", {}, [el("span", { class: "grad" }, "Statistieken")]));

  if (!st.totalJumps) {
    view.append(el("p", { class: "sub" }, "Cumulatieve cijfers en trends over al je sprongen."));
    view.append(emptyState());
    return;
  }
  view.append(el("p", { class: "sub" }, "Cumulatieve cijfers en trends — vernieuwt automatisch."));

  const cards = el("div", { class: "cards" });
  cards.append(card("Totaal sprongen", st.totalJumps, "", { icon: "🪂", accent: "blue" }));
  cards.append(card("Totale vrije val", fmtDuration(st.totalFreefallSec), "", { icon: "⏱️", accent: "red" }));
  cards.append(card("Totale canopy-tijd", fmtDuration(st.totalCanopySec), "", { icon: "🟢", accent: "green" }));
  cards.append(card("Hoogste exit", st.highestExit, "m", { icon: "🛩️", accent: "blue" }));
  cards.append(card("Langste vrije val", fmtDuration(st.longestFreefall), "", { icon: "📏", accent: "red" }));
  view.append(cards);

  view.append(chartPanelData("📊", "Sprongen per maand", (cv) => jumpsPerMonthChart(cv, st.perMonth)));
  view.append(chartPanelData("📈", "Cumulatieve vrije-val-tijd", (cv) => freefallAccrualChart(cv, st.freefallAccrual)));
  view.append(chartPanelData("🛩️", "Verdeling exit-hoogtes", (cv) => exitDistributionChart(cv, st.exitBuckets)));
}

function chartPanelData(ico, title, build) {
  const canvas = el("canvas", {});
  const panel = el("div", { class: "panel" }, [
    el("h3", {}, [el("span", { class: "ico" }, ico), title]),
    el("div", { class: "chart-wrap tall" }, canvas),
  ]);
  requestAnimationFrame(() => liveCharts.push(build(canvas)));
  return panel;
}

// ---------------------------------------------------------------- upload
async function uploadView() {
  view.innerHTML = "";
  view.append(el("h1", {}, [el("span", { class: "grad" }, "Upload .FIT-bestand")]));
  view.append(el("p", { class: "sub" },
    "Exporteer een activiteit van je Garmin als .FIT en sleep hem hierheen. Wordt direct geparsed en getoond."));

  const fileInput = el("input", { type: "file", accept: ".fit,.FIT", style: "display:none" });
  const typeSel = el("select", {}, JUMP_TYPES.map((t) => el("option", { value: t }, t || "— type (optioneel) —")));
  const status = el("div", {});

  const dz = el("div", { class: "dropzone" }, [
    el("div", { class: "big" }, "📂"),
    el("p", {}, el("strong", {}, "Sleep een .FIT hierheen of klik om te kiezen")),
    el("p", { class: "dim" }, "max 25 MB · wordt automatisch geüpload zodra je een bestand kiest"),
  ]);
  dz.addEventListener("click", () => fileInput.click());
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault(); dz.classList.remove("drag");
    if (e.dataTransfer.files[0]) doUpload(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", () => { if (fileInput.files[0]) doUpload(fileInput.files[0]); });

  async function doUpload(file) {
    status.innerHTML = "";
    status.append(el("div", { class: "note" }, `⏳ Bezig met uploaden en parsen van ${file.name}…`));
    try {
      const res = await api.uploadFit(file, { jumpType: typeSel.value });
      toast("✓ Sprong geïmporteerd (#" + res.jumpNumber + ")", "ok");
      location.hash = "#/jump/" + res.id;
    } catch (e) {
      status.innerHTML = "";
      status.append(el("div", { class: "note" }, "❌ Upload mislukt: " + e.message));
    }
  }

  view.append(el("div", { class: "panel" }, [
    field("Type (optioneel)", typeSel),
    dz, fileInput, status,
  ]));
  view.append(el("p", { class: "dim" },
    "Tip: maak eerst een normale activiteit-opname om de hele pijplijn te testen vóór een echte sprong."));
}
