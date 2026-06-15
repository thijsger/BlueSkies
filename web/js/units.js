// Altitude/length units. Skydiving is universally in feet, so feet is default;
// metres is available as a toggle. Internally everything stays in metres.
let UNIT = localStorage.getItem("bs_unit");
if (UNIT !== "m" && UNIT !== "ft") UNIT = "ft";

export function getUnit() { return UNIT; }
export function setUnit(u) {
  if (u !== "m" && u !== "ft") return;
  localStorage.setItem("bs_unit", u);
  UNIT = u;
  location.reload();
}
export function altUnit() { return UNIT === "ft" ? "ft" : "m"; }

// metres -> display value in the chosen unit (feet rounded to 10 ft)
export function altValue(m) {
  if (m == null || Number.isNaN(m)) return null;
  return UNIT === "ft" ? Math.round((m * 3.28084) / 10) * 10 : Math.round(m);
}
export const UNITS = [{ code: "ft", label: "ft" }, { code: "m", label: "m" }];
