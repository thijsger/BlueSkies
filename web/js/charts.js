import { PHASE_COLORS, METRIC_COLOR, num } from "./util.js";
import { t } from "./i18n.js";
import { altValue, altUnit } from "./units.js";

// ---- global theming (light) ----
const AXIS = "#7a88a3", GRID = "rgba(15,23,42,0.07)", BORDER = "rgba(15,23,42,0.14)";
Chart.defaults.color = AXIS;
Chart.defaults.font.family = "Inter, system-ui, sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.plugins.legend.display = false;
const TT = Chart.defaults.plugins.tooltip;
TT.backgroundColor = "rgba(255,255,255,0.98)";
TT.borderColor = "rgba(15,23,42,0.12)";
TT.borderWidth = 1;
TT.padding = 10;
TT.cornerRadius = 10;
TT.titleColor = "#0f1b33";
TT.bodyColor = "#42506b";
TT.displayColors = false;
TT.titleFont = { weight: "700" };

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// gradient fill under a line
function fill(color) {
  return (context) => {
    const { ctx, chartArea } = context.chart;
    if (!chartArea) return hexA(color, 0.15);
    const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, hexA(color, 0.34));
    g.addColorStop(1, hexA(color, 0.01));
    return g;
  };
}

// ---- plugins: phase bands + event markers + point markers ----
const phaseBandsPlugin = {
  id: "phaseBands",
  beforeDatasetsDraw(chart, _a, opts) {
    const phases = opts && opts.phases;
    if (!phases || !phases.length) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x;
    if (!x) return;
    ctx.save();
    for (const p of phases) {
      const x0 = x.getPixelForValue(p.startT);
      const x1 = x.getPixelForValue(p.endT);
      ctx.fillStyle = hexA(PHASE_COLORS[p.phase] || "#888", 0.08);
      ctx.fillRect(x0, chartArea.top, Math.max(1, x1 - x0), chartArea.bottom - chartArea.top);
    }
    ctx.restore();
  },
};

const markersPlugin = {
  id: "markers",
  afterDatasetsDraw(chart, _a, opts) {
    const { ctx, chartArea, scales } = chart;
    const x = scales.x;
    // event markers: vertical dashed lines + labels
    for (const ev of (opts && opts.events) || []) {
      const px = x.getPixelForValue(ev.x);
      if (px < chartArea.left - 1 || px > chartArea.right + 1) continue;
      ctx.save();
      ctx.strokeStyle = hexA(ev.color, 0.85);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(px, chartArea.top);
      ctx.lineTo(px, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "700 10px Inter, sans-serif";
      const w = ctx.measureText(ev.label).width + 12;
      const lx = Math.min(Math.max(px - w / 2, chartArea.left), chartArea.right - w);
      ctx.fillStyle = hexA(ev.color, 0.95);
      roundRect(ctx, lx, chartArea.top + 2, w, 16, 5);
      ctx.fill();
      ctx.fillStyle = "#0a0e16";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ev.label, lx + w / 2, chartArea.top + 11);
      ctx.restore();
    }
    // point markers: min/max rings
    const yScales = chart.scales;
    for (const pm of (opts && opts.points) || []) {
      const ys = yScales[pm.axis || "y"];
      const px = x.getPixelForValue(pm.x);
      const py = ys.getPixelForValue(pm.y);
      ctx.save();
      ctx.fillStyle = pm.color;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (pm.label) {
        ctx.font = "700 10px Inter, sans-serif";
        ctx.fillStyle = "#0f1b33";
        ctx.textAlign = "center";
        const ty = py < chartArea.top + 20 ? py + 16 : py - 10;
        ctx.fillText(pm.label, px, ty);
      }
      ctx.restore();
    }
  },
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

Chart.register(phaseBandsPlugin, markersPlugin);

// ---- helpers ----
export function phaseEvents(jump) {
  const ev = [];
  const find = (ph) => (jump.phases || []).find((p) => p.phase === ph);
  const ex = find("exit") || find("freefall");
  const can = find("canopy");
  const land = find("landed");
  if (ex) ev.push({ x: ex.startT, label: "Exit", color: PHASE_COLORS.exit });
  if (can) ev.push({ x: can.startT, label: "Canopy", color: PHASE_COLORS.canopy });
  if (land) ev.push({ x: land.startT, label: "Landing", color: PHASE_COLORS.landed });
  return ev;
}

function extreme(series, key, type) {
  let best = null;
  for (const s of series) {
    const v = s[key];
    if (v == null) continue;
    if (best == null || (type === "max" ? v > best.v : v < best.v)) best = { x: s.t, v };
  }
  return best;
}

export function hasValues(series, key) {
  return series.some((s) => s[key] != null && (key !== "hr" || s[key] > 0));
}

const baseOpts = (jump, yTitle, extra = {}) => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: "index", intersect: false },
  layout: { padding: { top: 22, right: 8, left: 2, bottom: 0 } },
  plugins: {
    phaseBands: { phases: jump.phases },
    markers: { events: extra.events || [], points: extra.points || [] },
    tooltip: extra.tooltip || {},
  },
  scales: {
    x: {
      type: "linear",
      title: { display: true, text: "Tijd (s)", color: AXIS, font: { size: 10 } },
      ticks: { color: AXIS, maxTicksLimit: 8 },
      grid: { color: GRID },
      border: { color: BORDER },
    },
    y: {
      title: { display: !!yTitle, text: yTitle, color: AXIS, font: { size: 10 } },
      ticks: { color: AXIS, maxTicksLimit: 6 },
      grid: { color: GRID },
      border: { display: false },
    },
  },
});

function line(color, data, label) {
  return {
    label, data, borderColor: color, borderWidth: 2.5, pointRadius: 0,
    pointHoverRadius: 4, pointHoverBackgroundColor: color, tension: 0.35,
    spanGaps: true, fill: true, backgroundColor: fill(color), cubicInterpolationMode: "monotone",
  };
}

// ---- detail charts ----
export function altitudeChart(canvas, jump) {
  const c = METRIC_COLOR.altitude;
  const u = altUnit();
  const data = jump.series.map((s) => ({ x: s.t, y: altValue(s.alt) }));
  const mx = extreme(jump.series, "alt", "max");
  return new Chart(canvas, {
    type: "line",
    data: { datasets: [line(c, data, t("m.exitAlt"))] },
    options: baseOpts(jump, u, {
      events: phaseEvents(jump),
      points: mx ? [{ x: mx.x, y: altValue(mx.v), color: c, label: num(altValue(mx.v)) + " " + u }] : [],
      tooltip: { callbacks: { label: (i) => `${Math.round(i.parsed.y)} ${u}`, title: (i) => `t = ${i[0].parsed.x}s` } },
    }),
  });
}

export function verticalSpeedChart(canvas, jump) {
  const c = METRIC_COLOR.freefall;
  const data = jump.series.map((s) => ({ x: s.t, y: s.fallRate }));
  const mx = extreme(jump.series, "fallRate", "max");
  return new Chart(canvas, {
    type: "line",
    data: { datasets: [line(c, data, "Daalsnelheid")] },
    options: baseOpts(jump, "m/s", {
      events: phaseEvents(jump),
      points: mx ? [{ x: mx.x, y: mx.v, color: c, label: Math.round(mx.v) + " m/s" }] : [],
      tooltip: { callbacks: { label: (i) => `Daalsnelheid: ${i.parsed.y?.toFixed(1)} m/s`, title: (i) => `t = ${i[0].parsed.x}s` } },
    }),
  });
}

export function heartRateChart(canvas, jump) {
  const c = METRIC_COLOR.heart;
  const data = jump.series.map((s) => ({ x: s.t, y: s.hr }));
  const mx = extreme(jump.series.filter((s) => s.hr > 0), "hr", "max");
  return new Chart(canvas, {
    type: "line",
    data: { datasets: [line(c, data, "Hartslag")] },
    options: baseOpts(jump, "bpm", {
      events: phaseEvents(jump),
      points: mx ? [{ x: mx.x, y: mx.v, color: c, label: mx.v + " bpm" }] : [],
      tooltip: { callbacks: { label: (i) => `Hartslag: ${i.parsed.y} bpm`, title: (i) => `t = ${i[0].parsed.x}s` } },
    }),
  });
}

export function groundSpeedChart(canvas, jump) {
  const c = METRIC_COLOR.canopy;
  const canopy = jump.series.filter((s) => s.phase === "canopy");
  const data = canopy.map((s) => ({ x: s.t, y: s.groundSpeed == null ? null : s.groundSpeed * 3.6 }));
  return new Chart(canvas, {
    type: "line",
    data: { datasets: [line(c, data, "Grondsnelheid")] },
    options: baseOpts(jump, "km/u", {
      tooltip: { callbacks: { label: (i) => `Grondsnelheid: ${Math.round(i.parsed.y)} km/u`, title: (i) => `t = ${i[0].parsed.x}s` } },
    }),
  });
}

// combined altitude + vertical speed (dual axis)
export function combinedChart(canvas, jump) {
  const cAlt = METRIC_COLOR.altitude;
  const cVs = METRIC_COLOR.freefall;
  const u = altUnit();
  const alt = jump.series.map((s) => ({ x: s.t, y: altValue(s.alt) }));
  const vs = jump.series.map((s) => ({ x: s.t, y: s.fallRate }));
  const opts = baseOpts(jump, null, { events: phaseEvents(jump) });
  opts.scales.y = { ...opts.scales.y, title: { display: true, text: t("m.exitAlt") + " (" + u + ")", color: cAlt, font: { size: 10 } }, ticks: { color: AXIS, maxTicksLimit: 6 } };
  opts.scales.y1 = {
    position: "right", title: { display: true, text: t("m.peakVs") + " (m/s)", color: cVs, font: { size: 10 } },
    ticks: { color: AXIS, maxTicksLimit: 6 }, grid: { drawOnChartArea: false }, border: { display: false },
  };
  return new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        { ...line(cAlt, alt, t("m.exitAlt")), fill: true },
        { ...line(cVs, vs, t("phase.freefall")), yAxisID: "y1", fill: false },
      ],
    },
    options: opts,
  });
}

// ---- stats charts ----
export function jumpsPerMonthChart(canvas, perMonth) {
  const labels = Object.keys(perMonth).sort();
  return new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [{ data: labels.map((m) => perMonth[m]), backgroundColor: hexA("#9b6bff", 0.75), borderRadius: 6, maxBarThickness: 38 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { tooltip: { callbacks: { label: (i) => `${i.parsed.y} sprongen` } } },
      scales: {
        x: { ticks: { color: AXIS }, grid: { display: false }, border: { color: BORDER } },
        y: { ticks: { color: AXIS, precision: 0 }, grid: { color: GRID }, beginAtZero: true, border: { display: false } },
      },
    },
  });
}

export function freefallAccrualChart(canvas, accrual) {
  const labels = accrual.map((a) => new Date(a.date).toLocaleDateString("nl-NL", { day: "2-digit", month: "short", year: "2-digit" }));
  const data = accrual.map((a) => a.cumSec / 60);
  const c = METRIC_COLOR.freefall;
  return new Chart(canvas, {
    type: "line",
    data: { labels, datasets: [{ data, borderColor: c, borderWidth: 2.5, pointRadius: 2, pointBackgroundColor: c, tension: 0.3, fill: true, backgroundColor: fill(c) }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { tooltip: { callbacks: { label: (i) => `${i.parsed.y.toFixed(1)} min totaal` } } },
      scales: {
        x: { ticks: { color: AXIS, maxRotation: 60, maxTicksLimit: 10 }, grid: { color: GRID }, border: { color: BORDER } },
        y: { title: { display: true, text: "minuten", color: AXIS, font: { size: 10 } }, ticks: { color: AXIS }, grid: { color: GRID }, beginAtZero: true, border: { display: false } },
      },
    },
  });
}

const CAT_PALETTE = ["#5b8cff", "#9b6bff", "#10d68a", "#f6a23b", "#f43f6e", "#36c5f0", "#ffd166"];

export function byTypeChart(canvas, byType) {
  const labels = Object.keys(byType).sort((a, b) => byType[b] - byType[a]);
  return new Chart(canvas, {
    type: "bar",
    data: {
      labels: labels.map((l) => l.charAt(0).toUpperCase() + l.slice(1)),
      datasets: [{ data: labels.map((l) => byType[l]), backgroundColor: labels.map((_, i) => hexA(CAT_PALETTE[i % CAT_PALETTE.length], 0.8)), borderRadius: 6, maxBarThickness: 42 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { tooltip: { callbacks: { label: (i) => `${i.parsed.y} sprongen` } } },
      scales: {
        x: { ticks: { color: AXIS }, grid: { display: false }, border: { color: BORDER } },
        y: { ticks: { color: AXIS, precision: 0 }, grid: { color: GRID }, beginAtZero: true, border: { display: false } },
      },
    },
  });
}

export function byDropzoneChart(canvas, byDz) {
  const labels = Object.keys(byDz).sort((a, b) => byDz[b] - byDz[a]).slice(0, 8);
  return new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [{ data: labels.map((l) => byDz[l]), backgroundColor: hexA("#10d68a", 0.78), borderRadius: 6, maxBarThickness: 26 }] },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { tooltip: { callbacks: { label: (i) => `${i.parsed.x} sprongen` } } },
      scales: {
        x: { ticks: { color: AXIS, precision: 0 }, grid: { color: GRID }, beginAtZero: true, border: { display: false } },
        y: { ticks: { color: "#8b97b3" }, grid: { display: false }, border: { color: BORDER } },
      },
    },
  });
}

// per-jump trend over time (multi-line). keys: [{key,label,color,axis}]
function trendDates(trend) {
  return trend.map((p) => new Date(p.date).toLocaleDateString("nl-NL", { day: "2-digit", month: "short", year: "2-digit" }));
}

export function hrTrendChart(canvas, trend) {
  const labels = trendDates(trend);
  const c = METRIC_COLOR.heart;
  return new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: t("m.peakHr"), data: trend.map((p) => p.peakHr), borderColor: c, backgroundColor: fill(c), borderWidth: 2.5, pointRadius: 2, tension: 0.3, fill: true, spanGaps: true },
        { label: t("m.avgHr"), data: trend.map((p) => p.avgHr), borderColor: "#9b6bff", borderWidth: 2, pointRadius: 2, tension: 0.3, fill: false, spanGaps: true, borderDash: [5, 4] },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: true, labels: { color: AXIS, boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${i.parsed.y ?? "—"} bpm` } } },
      scales: {
        x: { ticks: { color: AXIS, maxRotation: 60, maxTicksLimit: 10 }, grid: { color: GRID }, border: { color: BORDER } },
        y: { title: { display: true, text: "bpm", color: AXIS, font: { size: 10 } }, ticks: { color: AXIS }, grid: { color: GRID }, border: { display: false } },
      },
    },
  });
}

export function hrZonesChart(canvas, zones) {
  const colors = ["#9aa6c2", "#5b9bff", "#10d68a", "#e8870f", "#ff5d7a", "#ec2d62"];
  const mins = zones.map((z) => Math.round(z.sec / 60 * 10) / 10);
  return new Chart(canvas, {
    type: "bar",
    data: { labels: zones.map((z) => z.label), datasets: [{ data: mins, backgroundColor: zones.map((_, i) => colors[i % colors.length]), borderRadius: 6, maxBarThickness: 46 }] },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { tooltip: { callbacks: { label: (i) => `${i.parsed.x} min`, title: (i) => `Zone ${i[0].label} bpm` } } },
      scales: {
        x: { title: { display: true, text: "minuten (cumulatief)", color: AXIS, font: { size: 10 } }, ticks: { color: AXIS }, grid: { color: GRID }, border: { display: false }, beginAtZero: true },
        y: { ticks: { color: AXIS }, grid: { display: false }, border: { color: BORDER } },
      },
    },
  });
}

export function perfTrendChart(canvas, trend) {
  const labels = trendDates(trend);
  const cA = METRIC_COLOR.altitude, cF = METRIC_COLOR.freefall;
  const u = altUnit();
  return new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: t("m.exitAlt") + " (" + u + ")", data: trend.map((p) => altValue(p.exit)), borderColor: cA, backgroundColor: fill(cA), borderWidth: 2.5, pointRadius: 2, tension: 0.3, fill: true, spanGaps: true, yAxisID: "y" },
        { label: t("phase.freefall") + " (s)", data: trend.map((p) => p.freefall), borderColor: cF, borderWidth: 2, pointRadius: 2, tension: 0.3, fill: false, spanGaps: true, yAxisID: "y1" },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: true, labels: { color: AXIS, boxWidth: 12, font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: AXIS, maxRotation: 60, maxTicksLimit: 10 }, grid: { color: GRID }, border: { color: BORDER } },
        y: { position: "left", title: { display: true, text: u, color: cA, font: { size: 10 } }, ticks: { color: AXIS }, grid: { color: GRID }, border: { display: false } },
        y1: { position: "right", title: { display: true, text: "s", color: cF, font: { size: 10 } }, ticks: { color: AXIS }, grid: { drawOnChartArea: false }, border: { display: false } },
      },
    },
  });
}

export function glideTrendChart(canvas, glideTrend) {
  const labels = glideTrend.map((p) => new Date(p.date).toLocaleDateString("nl-NL", { day: "2-digit", month: "short", year: "2-digit" }));
  const c = METRIC_COLOR.track;
  return new Chart(canvas, {
    type: "line",
    data: { labels, datasets: [{ label: "Glijgetal", data: glideTrend.map((p) => p.glide), borderColor: c, backgroundColor: fill(c), borderWidth: 2.5, pointRadius: 3, tension: 0.3, fill: true }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { tooltip: { callbacks: { label: (i) => `Glijgetal: ${i.parsed.y}` } } },
      scales: {
        x: { ticks: { color: AXIS, maxRotation: 60, maxTicksLimit: 10 }, grid: { color: GRID }, border: { color: BORDER } },
        y: { ticks: { color: AXIS }, grid: { color: GRID }, border: { display: false }, beginAtZero: true },
      },
    },
  });
}

export function exitDistributionChart(canvas, buckets) {
  const keys = Object.keys(buckets).map(Number).sort((a, b) => a - b);
  return new Chart(canvas, {
    type: "bar",
    data: { labels: keys.map((k) => `${(k / 1000).toFixed(1)}–${((k + 500) / 1000).toFixed(1)}k`), datasets: [{ data: keys.map((k) => buckets[k]), backgroundColor: hexA("#4f8dff", 0.75), borderRadius: 6, maxBarThickness: 38 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { tooltip: { callbacks: { label: (i) => `${i.parsed.y} sprongen`, title: (i) => `${i[0].label} m` } } },
      scales: {
        x: { ticks: { color: AXIS }, grid: { display: false }, border: { color: BORDER } },
        y: { ticks: { color: AXIS, precision: 0 }, grid: { color: GRID }, beginAtZero: true, border: { display: false } },
      },
    },
  });
}
