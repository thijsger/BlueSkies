import { el, fmtClock, fmtDuration, fmtDate, num, PHASE_COLORS, PHASE_LABEL } from "./util.js";
import { icon, iconSVG, PHASE_ICON } from "./icons.js";

// ---------------------------------------------------------------- EmptyState
export function EmptyState({ name = "activity", title, text, action, compact = false }) {
  return el("div", { class: "empty-state" + (compact ? " compact" : "") }, [
    el("div", { class: "empty-ico" }, [icon(name, compact ? 26 : 34)]),
    title ? el("div", { class: "empty-title" }, title) : null,
    text ? el("p", { class: "empty-text" }, text) : null,
    action || null,
  ]);
}

// ---------------------------------------------------------------- PhaseChip
export function PhaseChip(phase, { duration, muted = false } = {}) {
  return el("span", { class: "phase-chip" + (muted ? " muted" : "") }, [
    el("span", { class: "dot", style: `background:${PHASE_COLORS[phase] || "#888"}` }),
    PHASE_LABEL[phase] || phase,
    duration != null ? el("span", { class: "chip-dur" }, fmtClock(duration) || fmtDuration(duration)) : null,
  ]);
}

// ---------------------------------------------------------------- MetricCard
// { name, label, value, unit, color, estimate, tooltip, trend:{dir,text}, placeholder }
export function MetricCard(opts) {
  const { name = "activity", label, value, unit, color = "altitude", estimate, tooltip, trend } = opts;
  const has = value != null && value !== "" && value !== "—";
  const placeholder = opts.placeholder || "Niet beschikbaar";

  const labelRow = el("div", { class: "metric-label" }, [
    label,
    estimate ? el("span", { class: "tag est", title: tooltip || "Schatting — barometer onbetrouwbaar in vrije val" }, "schatting") : null,
  ]);

  let valueEl;
  if (has) {
    valueEl = el("div", { class: "metric-value" }, [
      String(value),
      unit ? el("span", { class: "metric-unit" }, unit) : null,
    ]);
  } else {
    valueEl = el("div", { class: "metric-na" }, placeholder);
  }

  const trendEl = trend
    ? el("span", { class: "metric-trend " + trend.dir }, [icon(trend.dir === "up" ? "trendingUp" : "trendingDown", 13), trend.text])
    : null;

  return el("div", { class: "metric-card", "data-color": color }, [
    el("div", { class: "metric-top" }, [
      el("span", { class: "metric-ico", "data-color": color }, [icon(name, 18)]),
      trendEl,
    ]),
    valueEl,
    labelRow,
  ]);
}

// ---------------------------------------------------------------- JumpPhaseTimeline
export function JumpPhaseTimeline(jump) {
  const order = ["climb", "exit", "freefall", "canopy", "landed"];
  const present = {};
  for (const p of jump.phases || []) {
    const dur = Math.max(0, (p.endT - p.startT));
    present[p.phase] = (present[p.phase] || 0) + dur;
  }
  const total = Object.values(present).reduce((a, b) => a + b, 0) || 1;

  const track = el("div", { class: "timeline-track" });
  for (const ph of order) {
    const dur = present[ph];
    if (dur != null) {
      const grow = Math.max(dur / total, 0.04);
      const seg = el("div", {
        class: "tl-seg", "data-phase": ph,
        style: `flex-grow:${grow}; --c:${PHASE_COLORS[ph]}`,
      }, [
        el("span", { class: "tl-ico" }, [icon(PHASE_ICON[ph], 14)]),
        el("span", { class: "tl-label" }, PHASE_LABEL[ph]),
        el("span", { class: "tl-dur" }, fmtClock(dur) || "0:00"),
      ]);
      track.append(seg);
    } else {
      track.append(el("div", { class: "tl-seg missing", "data-phase": ph },
        [el("span", { class: "tl-label" }, PHASE_LABEL[ph]), el("span", { class: "tl-dur" }, "—")]));
    }
  }

  return el("div", { class: "panel timeline-panel" }, [
    PanelHead("route", "Sprongverloop", "track"),
    track,
  ]);
}

// ---------------------------------------------------------------- ChartCard
// { name, title, color, badge, hasData, emptyText, build(canvas)->chart, charts[] }
export function ChartCard({ name = "activity", title, color = "altitude", badge, hasData = true, emptyText, build, charts }) {
  const body = el("div", { class: "chart-body" });
  if (hasData) {
    const canvas = el("canvas", {});
    body.append(el("div", { class: "chart-wrap" }, canvas));
    requestAnimationFrame(() => {
      const c = build(canvas);
      if (c && charts) charts.push(c);
    });
  } else {
    body.append(EmptyState({
      name: "satellite", compact: true,
      title: "Geen data",
      text: emptyText || "Voor deze grafiek is geen data beschikbaar in deze sprong.",
    }));
  }
  return el("div", { class: "panel chart-card" }, [
    PanelHead(name, title, color, badge),
    body,
  ]);
}

function PanelHead(name, title, color, badge) {
  return el("div", { class: "panel-head" }, [
    el("span", { class: "panel-ico", "data-color": color }, [icon(name, 17)]),
    el("h3", {}, title),
    badge ? el("span", { class: "tag est" }, badge) : null,
  ]);
}

// ---------------------------------------------------------------- JumpHeader
export function JumpHeader(jump) {
  const s = jump.summary || {};
  const meta = el("div", { class: "hero-meta" }, [
    metaItem("clock", fmtDate(jump.startTime)),
    metaItem("mapPin", jump.dropzone || "Onbekende dropzone"),
    jump.aircraft ? metaItem("plane", jump.aircraft) : null,
    jump.jumpType ? metaItem("parachute", capitalize(jump.jumpType)) : null,
  ]);

  // status badges
  const badges = el("div", { class: "hero-badges" });
  badges.append(StatusBadge(jump.source === "fit" ? ".FIT import" : "Watch sync", "neutral",
    jump.source === "fit" ? "upload" : "refresh"));
  if (s.dataQuality === "no-freefall-detected") {
    badges.append(StatusBadge("Geen vrije val gedetecteerd", "warn", "alert"));
  }
  const hasGps = s.exitPoint || s.landingPoint;
  if (!hasGps) badges.append(StatusBadge("GPS ontbreekt", "track", "satellite"));
  if (s.peakVerticalSpeed != null) badges.append(StatusBadge("Bevat schattingen", "warn", "alert"));

  return el("div", { class: "hero" }, [
    el("div", { class: "hero-glow" }),
    el("div", { class: "hero-path", html: heroFlightPath() }),
    el("div", { class: "hero-content" }, [
      el("div", { class: "hero-eyebrow" }, "Sprongdetail"),
      el("h1", { class: "hero-title" }, [
        "Sprong ", el("span", { class: "hero-num" }, "#" + (jump.jumpNumber ?? "—")),
      ]),
      meta,
      badges,
    ]),
  ]);
}

function metaItem(name, text) {
  return el("span", { class: "meta-item" }, [icon(name, 15), text]);
}
function StatusBadge(text, kind, name) {
  return el("span", { class: "status-badge " + kind }, [name ? icon(name, 13) : null, text]);
}

function heroFlightPath() {
  // abstract jump arc: climb up, brief level, steep freefall, gentle canopy glide
  return `<svg viewBox="0 0 600 200" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="hp" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4f8dff"/><stop offset="0.45" stop-color="#f6a23b"/>
      <stop offset="0.6" stop-color="#f43f6e"/><stop offset="1" stop-color="#10d68a"/>
    </linearGradient></defs>
    <path d="M-10 170 C 90 150, 150 60, 250 50 C 280 48, 300 55, 320 120 C 335 165, 380 168, 460 150 C 520 138, 560 140, 610 150"
      fill="none" stroke="url(#hp)" stroke-width="2.5" stroke-linecap="round" opacity="0.55"/>
  </svg>`;
}

// ---------------------------------------------------------------- EditJumpForm
const JUMP_TYPES = ["", "tandem", "AFF", "fun", "freefly", "tracking", "wingsuit", "hop & pop"];

export function EditJumpForm(jump, { onSave, onDelete }) {
  const typeSel = el("select", {}, JUMP_TYPES.map((t) =>
    el("option", t === (jump.jumpType || "") ? { value: t, selected: "" } : { value: t }, t || "— kies type —")));
  const aircraft = el("input", { type: "text", placeholder: "bv. Cessna 208, PAC 750", value: jump.aircraft || "" });
  const jumpNumber = el("input", { type: "number", min: "1", value: jump.jumpNumber ?? "" });
  const targetLat = el("input", { type: "number", step: "0.000001", placeholder: "52.244700", value: jump.target?.lat ?? "" });
  const targetLng = el("input", { type: "number", step: "0.000001", placeholder: "6.046900", value: jump.target?.lng ?? "" });
  const notes = el("textarea", { placeholder: "Vrije notities over deze sprong…" }, jump.notes || "");

  const saveBtn = el("button", { class: "btn primary sm" }, [icon("save", 15), "Opslaan"]);
  saveBtn.addEventListener("click", () => onSave({
    jumpType: typeSel.value,
    aircraft: aircraft.value || null,
    jumpNumber: jumpNumber.value ? Number(jumpNumber.value) : jump.jumpNumber,
    target: (targetLat.value && targetLng.value) ? { lat: Number(targetLat.value), lng: Number(targetLng.value) } : null,
    notes: notes.value || null,
  }));

  // two-step delete confirmation
  const delWrap = el("div", { class: "del-wrap" });
  const delBtn = el("button", { class: "btn ghost-danger sm" }, [icon("trash", 15), "Verwijderen"]);
  delBtn.addEventListener("click", () => {
    delWrap.innerHTML = "";
    delWrap.append(
      el("span", { class: "del-confirm-text" }, "Zeker weten?"),
      el("button", { class: "btn danger sm", onclick: () => onDelete() }, "Ja, verwijder"),
      el("button", { class: "btn ghost sm", onclick: () => { delWrap.innerHTML = ""; delWrap.append(delBtn); } }, "Annuleer"),
    );
  });
  delWrap.append(delBtn);

  const body = el("div", { class: "edit-body" }, [
    el("div", { class: "edit-section" }, [
      el("div", { class: "edit-section-title" }, "Sprong-info"),
      el("div", { class: "form-grid" }, [
        Field("Type", typeSel),
        Field("Vliegtuig", aircraft),
        Field("Sprongnummer", jumpNumber),
      ]),
    ]),
    el("div", { class: "edit-section" }, [
      el("div", { class: "edit-section-title" }, "Target-locatie"),
      el("div", { class: "form-grid two" }, [
        Field("Latitude", targetLat),
        Field("Longitude", targetLng),
      ]),
      el("p", { class: "field-hint" }, "Zet je beoogde landingspunt om de afstand tot target te berekenen."),
    ]),
    el("div", { class: "edit-section" }, [
      el("div", { class: "edit-section-title" }, "Notities"),
      notes,
    ]),
    el("div", { class: "edit-actions" }, [saveBtn, delWrap]),
  ]);

  // collapsible
  const card = el("div", { class: "panel edit-card collapsed" });
  const head = el("button", { class: "edit-head" }, [
    el("span", { class: "panel-ico", "data-color": "track" }, [icon("pencil", 17)]),
    el("h3", {}, "Bewerk sprong"),
    el("span", { class: "edit-chevron" }, [icon("chevronDown", 18)]),
  ]);
  head.addEventListener("click", () => card.classList.toggle("collapsed"));
  card.append(head, body);
  return card;
}

function Field(label, input) {
  return el("label", { class: "field" }, [el("span", { class: "field-label" }, label), input]);
}

// ---------------------------------------------------------------- TrackingPanel
// Wingsuit / tracking performance — horizontal motion during freefall.
export function TrackingPanel(jump) {
  const s = jump.summary || {};
  const kmh = (v) => (v != null ? Math.round(v * 3.6) : null);
  const grid = el("div", { class: "metric-grid" }, [
    MetricCard({ name: "navigation", color: "track", label: "Glijgetal", value: s.glideRatio != null ? s.glideRatio.toFixed(2) : null, unit: ": 1", estimate: true, tooltip: "Horizontale verplaatsing ÷ verticale val — schatting (baro)", placeholder: "Niet beschikbaar" }),
    MetricCard({ name: "wind", color: "speed", label: "Gem. horiz. snelheid", value: kmh(s.ffAvgHorizontalSpeed), unit: "km/u", placeholder: "Geen GPS" }),
    MetricCard({ name: "gauge", color: "speed", label: "Piek horiz. snelheid", value: kmh(s.ffPeakHorizontalSpeed), unit: "km/u", placeholder: "Geen GPS" }),
    MetricCard({ name: "move", color: "track", label: "Horizontale afstand", value: s.ffHorizontalDistance != null ? num(s.ffHorizontalDistance) : null, unit: "m", placeholder: "Geen GPS" }),
  ]);
  return el("div", { class: "panel" }, [PanelHead("navigation", "Tracking & wingsuit", "track"), grid]);
}

// shows the tracking panel only when it's relevant
export function shouldShowTracking(jump) {
  const t = (jump.jumpType || "").toLowerCase();
  const s = jump.summary || {};
  return t === "wingsuit" || t === "tracking" || (s.glideRatio != null && s.glideRatio >= 0.5);
}

// ---------------------------------------------------------------- StatsOverview
export function StatsOverview(st) {
  const currency = st.daysSinceLast == null
    ? { value: null }
    : st.daysSinceLast === 0
      ? { value: "Vandaag", unit: "" }
      : { value: num(st.daysSinceLast), unit: st.daysSinceLast === 1 ? "dag geleden" : "dagen geleden" };

  return el("div", { class: "metric-grid" }, [
    MetricCard({ name: "parachute", label: "Totaal sprongen", value: num(st.totalJumps), color: "track" }),
    MetricCard({ name: "clock", label: "Laatste sprong", value: currency.value, unit: currency.unit, color: "altitude", placeholder: "—" }),
    MetricCard({ name: "trendingDown", label: "Totale vrije val", value: fmtDuration(st.totalFreefallSec), color: "freefall" }),
    MetricCard({ name: "activity", label: "Gem. vrije val", value: st.avgFreefallSec != null ? fmtDuration(st.avgFreefallSec) : null, color: "freefall" }),
    MetricCard({ name: "mountain", label: "Hoogste exit", value: st.highestExit != null ? num(st.highestExit) : null, unit: "m", color: "altitude" }),
    MetricCard({ name: "mountain", label: "Gem. exit-hoogte", value: st.avgExit != null ? num(st.avgExit) : null, unit: "m", color: "altitude" }),
  ]);
}

export function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ---------------------------------------------------------------- RecordsPanel
// Personal bests; each row links to the jump it belongs to.
export function RecordsPanel(records, onOpen) {
  const rows = [
    { key: "highestExit", icon: "mountain", color: "altitude", label: "Hoogste exit", fmt: (v) => num(v) + " m" },
    { key: "longestFreefall", icon: "trendingDown", color: "freefall", label: "Langste vrije val", fmt: (v) => fmtDuration(v) },
    { key: "peakHr", icon: "heart", color: "heart", label: "Hoogste hartslag", fmt: (v) => v + " bpm" },
    { key: "maxGroundSpeed", icon: "wind", color: "speed", label: "Hoogste grondsnelheid", fmt: (v) => num(v) + " km/u" },
    { key: "maxGlide", icon: "navigation", color: "track", label: "Beste glijgetal", fmt: (v) => Number(v).toFixed(2) },
  ];
  const list = el("div", { class: "records" });
  for (const r of rows) {
    const rec = records[r.key];
    if (!rec || rec.value == null) continue;
    const row = el("div", { class: "record-row", onclick: rec.id ? () => onOpen(rec.id) : null }, [
      el("span", { class: "record-ico", "data-color": r.color }, [icon(r.icon, 16)]),
      el("div", { class: "record-main" }, [
        el("div", { class: "record-label" }, r.label),
        el("div", { class: "record-sub" }, rec.jumpNumber != null ? "Sprong #" + rec.jumpNumber : ""),
      ]),
      el("div", { class: "record-value" }, r.fmt(rec.value)),
    ]);
    list.append(row);
  }
  return el("div", { class: "panel" }, [PanelHead("flag", "Persoonlijke records", "speed"), list]);
}
