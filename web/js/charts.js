import { PHASE_COLORS, PHASE_LABEL } from "./util.js";

// Chart.js plugin: shade phase bands behind a time-series chart.
const phaseBandsPlugin = {
  id: "phaseBands",
  beforeDatasetsDraw(chart, _args, opts) {
    const phases = opts && opts.phases;
    if (!phases || !phases.length) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x;
    if (!x) return;
    ctx.save();
    for (const p of phases) {
      const x0 = x.getPixelForValue(p.startT);
      const x1 = x.getPixelForValue(p.endT);
      ctx.fillStyle = hexA(PHASE_COLORS[p.phase] || "#888", 0.12);
      ctx.fillRect(x0, chartArea.top, Math.max(1, x1 - x0), chartArea.bottom - chartArea.top);
    }
    ctx.restore();
  },
};
Chart.register(phaseBandsPlugin);

// global theming
Chart.defaults.color = "#93a0bd";
Chart.defaults.font.family = "Inter, system-ui, sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.plugins.tooltip.backgroundColor = "rgba(11,17,32,0.95)";
Chart.defaults.plugins.tooltip.borderColor = "rgba(255,255,255,0.12)";
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.cornerRadius = 8;

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const baseOpts = (phases, yTitle, xTitle = "Tijd (s)") => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: "index", intersect: false },
  plugins: {
    legend: { labels: { color: "#8b949e" } },
    phaseBands: { phases },
    tooltip: { enabled: true },
  },
  scales: {
    x: {
      type: "linear",
      title: { display: true, text: xTitle, color: "#8b949e" },
      ticks: { color: "#8b949e" },
      grid: { color: "rgba(255,255,255,0.05)" },
    },
    y: {
      title: { display: true, text: yTitle, color: "#8b949e" },
      ticks: { color: "#8b949e" },
      grid: { color: "rgba(255,255,255,0.05)" },
    },
  },
});

export function altitudeChart(canvas, jump) {
  const data = jump.series.map((s) => ({ x: s.t, y: s.alt }));
  return new Chart(canvas, {
    type: "line",
    data: {
      datasets: [{
        label: "Hoogte (m)", data, borderColor: "#4f8dff", borderWidth: 2.5,
        pointRadius: 0, tension: 0.25, spanGaps: true, fill: true,
        backgroundColor: hexA("#4f8dff", 0.14),
      }],
    },
    options: baseOpts(jump.phases, "Hoogte (m)"),
  });
}

export function verticalSpeedChart(canvas, jump) {
  const data = jump.series.map((s) => ({ x: s.t, y: s.fallRate }));
  return new Chart(canvas, {
    type: "line",
    data: {
      datasets: [{
        label: "Daalsnelheid (m/s) — schatting", data, borderColor: "#f43f5e",
        borderWidth: 2.5, pointRadius: 0, tension: 0.25, spanGaps: true, fill: true,
        backgroundColor: hexA("#f43f5e", 0.13),
      }],
    },
    options: baseOpts(jump.phases, "m/s (schatting)"),
  });
}

export function heartRateChart(canvas, jump) {
  const data = jump.series.map((s) => ({ x: s.t, y: s.hr }));
  return new Chart(canvas, {
    type: "line",
    data: {
      datasets: [{
        label: "Hartslag (bpm)", data, borderColor: "#ec4899",
        borderWidth: 2.5, pointRadius: 0, tension: 0.25, spanGaps: true, fill: true,
        backgroundColor: hexA("#ec4899", 0.13),
      }],
    },
    options: baseOpts(jump.phases, "bpm"),
  });
}

// Ground speed during the canopy phase only.
export function groundSpeedChart(canvas, jump) {
  const canopy = jump.series.filter((s) => s.phase === "canopy");
  const data = canopy.map((s) => ({ x: s.t, y: s.groundSpeed == null ? null : s.groundSpeed * 3.6 }));
  return new Chart(canvas, {
    type: "line",
    data: {
      datasets: [{
        label: "Grondsnelheid canopy (km/u)", data, borderColor: "#10d68a",
        borderWidth: 2.5, pointRadius: 0, tension: 0.25, spanGaps: true, fill: true,
        backgroundColor: hexA("#10d68a", 0.13),
      }],
    },
    options: baseOpts(jump.phases.filter((p) => p.phase === "canopy"), "km/u"),
  });
}

// ---- stats page charts ----
export function jumpsPerMonthChart(canvas, perMonth) {
  const labels = Object.keys(perMonth).sort();
  return new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Sprongen", data: labels.map((m) => perMonth[m]), backgroundColor: "#2f81f7" }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { labels: { color: "#8b949e" } } },
      scales: {
        x: { ticks: { color: "#8b949e" }, grid: { display: false } },
        y: { ticks: { color: "#8b949e", precision: 0 }, grid: { color: "rgba(255,255,255,0.05)" }, beginAtZero: true },
      },
    },
  });
}

export function freefallAccrualChart(canvas, accrual) {
  const labels = accrual.map((a) =>
    new Date(a.date).toLocaleDateString("nl-NL", { day: "2-digit", month: "short", year: "2-digit" })
  );
  const data = accrual.map((a) => a.cumSec / 60);
  return new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Cumulatieve vrije val (min)", data, borderColor: "#ef4444",
        borderWidth: 2, pointRadius: 2, tension: 0.1, fill: false,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { labels: { color: "#8b949e" } } },
      scales: {
        x: { ticks: { color: "#8b949e", maxRotation: 60 }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: { ticks: { color: "#8b949e" }, grid: { color: "rgba(255,255,255,0.05)" }, beginAtZero: true },
      },
    },
  });
}

export function exitDistributionChart(canvas, buckets) {
  const keys = Object.keys(buckets).map(Number).sort((a, b) => a - b);
  return new Chart(canvas, {
    type: "bar",
    data: {
      labels: keys.map((k) => `${k}–${k + 500} m`),
      datasets: [{ label: "Sprongen", data: keys.map((k) => buckets[k]), backgroundColor: "#10b981" }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { labels: { color: "#8b949e" } } },
      scales: {
        x: { ticks: { color: "#8b949e" }, grid: { display: false } },
        y: { ticks: { color: "#8b949e", precision: 0 }, grid: { color: "rgba(255,255,255,0.05)" }, beginAtZero: true },
      },
    },
  });
}

export function phaseLegend() {
  const wrap = document.createElement("div");
  wrap.className = "legend";
  for (const [k, label] of Object.entries(PHASE_LABEL)) {
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `<span class="swatch" style="background:${PHASE_COLORS[k]}"></span>${label}`;
    wrap.append(item);
  }
  return wrap;
}
