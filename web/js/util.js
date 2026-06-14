export const PHASE_COLORS = {
  climb: "#4f8dff",
  exit: "#f6a23b",
  freefall: "#f43f6e",
  canopy: "#10d68a",
  landed: "#8a93a8",
};
export const PHASE_LABEL = {
  climb: "Klim",
  exit: "Exit",
  freefall: "Vrije val",
  canopy: "Canopy",
  landed: "Landing",
};

// metric accent colors (per spec)
export const METRIC_COLOR = {
  altitude: "#4f8dff",
  freefall: "#f43f6e",
  canopy: "#10d68a",
  heart: "#ff5d8f",
  speed: "#f6a23b",
  track: "#9b6bff",
};

export function fmtClock(sec) {
  if (sec == null) return null;
  sec = Math.round(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtDuration(sec) {
  if (sec == null) return "—";
  sec = Math.round(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("nl-NL", { day: "2-digit", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

export function num(v, digits = 0) {
  if (v == null || Number.isNaN(v)) return "—";
  return Number(v).toLocaleString("nl-NL", { maximumFractionDigits: digits });
}

export function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (v != null) e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}

export function toast(msg, kind = "ok") {
  const t = el("div", { class: `toast ${kind}` }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 4500);
}
