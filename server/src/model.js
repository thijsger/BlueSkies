// Canonical jump data model + analysis shared by BOTH ingestion paths
// (live JSON from the watch and server-side parsed .FIT). The dashboard
// never needs to know the source: everything ends up in this shape.
//
// Canonical Jump:
// {
//   id, source ("live"|"fit"), schema, createdAt, device,
//   startTime (ISO), endTime (ISO), durationSec,
//   jumpType, jumpNumber, notes, dropzone,
//   target: { lat, lng } | null,
//   summary: {
//     exitAltitude, freefallTime, canopyTime,
//     peakVerticalSpeed, avgVerticalSpeed,   // fall rate, m/s, ESTIMATE
//     peakHr, avgHr,
//     exitPoint: {lat,lng}|null, landingPoint: {lat,lng}|null,
//     horizontalDrift, distanceToTarget,
//     maxGroundSpeed, dataQuality
//   },
//   phases: [ { phase, startT, endT } ],       // t = seconds from start
//   series: [ { t, alt, vs, fallRate, hr, lat, lng, groundSpeed, phase } ]
// }

export const SCHEMA = "skydive.v1";

export const PHASE = {
  CLIMB: "climb",
  EXIT: "exit",
  FREEFALL: "freefall",
  CANOPY: "canopy",
  LANDED: "landed",
};

// Phase code mapping used by the compact live payload from the watch.
export const PHASE_BY_CODE = ["climb", "exit", "freefall", "canopy", "landed"];

// --- thresholds (fall rate is positive when descending, m/s) -----------------
const FREEFALL_FR = 25;   // sustained fall rate above this => freefall
const CANOPY_FR = 12;     // fall rate drops below this after freefall => canopy
const EXIT_FR = 8;        // first rapid descent after climb peak => exit boundary
const LANDED_SPEED = 1.5; // total speed below this near ground => landed
const SMOOTH_WINDOW = 3;  // moving-average half-window for altitude (samples)

// Real Dutch dropzones (reference data, not mock jumps). Nearest match within
// MATCH_RADIUS_M of the exit/landing point names the dropzone.
const DROPZONES = [
  { name: "Paracentrum Teuge", lat: 52.2447, lng: 6.0469 },
  { name: "Paracentrum Texel", lat: 53.1183, lng: 4.8336 },
  { name: "Skydive Hoogeveen", lat: 52.7300, lng: 6.5160 },
  { name: "Paracentrum Seppe (Bosschenhoofd)", lat: 51.5547, lng: 4.5530 },
  { name: "Skydive Eelde (Groningen)", lat: 53.1197, lng: 6.5794 },
  { name: "Skydive Rotterdam", lat: 51.9569, lng: 4.4372 },
  { name: "Skydive Flevo (Lelystad)", lat: 52.4603, lng: 5.5272 },
  { name: "Paracentrum Ameland", lat: 53.4517, lng: 5.6772 },
];
const DZ_MATCH_RADIUS_M = 6000;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
export function haversine(aLat, aLng, bLat, bLng) {
  if (aLat == null || bLat == null) return null;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nearestDropzone(lat, lng) {
  if (lat == null || lng == null) return null;
  let best = null;
  let bestD = Infinity;
  for (const dz of DROPZONES) {
    const d = haversine(lat, lng, dz.lat, dz.lng);
    if (d != null && d < bestD) {
      bestD = d;
      best = dz;
    }
  }
  return best && bestD <= DZ_MATCH_RADIUS_M ? best.name : null;
}

function mean(arr) {
  const v = arr.filter((x) => x != null && !Number.isNaN(x));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

// ---------------------------------------------------------------------------
// Core: take raw aligned series + metadata -> full canonical jump
// rawSeries: [{ t, alt, hr, lat, lng }] with t = seconds from start.
// Optional: providedPhases (codes from live watch) used only as a hint.
// ---------------------------------------------------------------------------
export function buildJump(rawSeries, meta = {}) {
  const series = rawSeries
    .filter((s) => s && s.t != null)
    .map((s) => ({
      t: Number(s.t),
      alt: numOrNull(s.alt),
      hr: numOrNull(s.hr),
      lat: numOrNull(s.lat),
      lng: numOrNull(s.lng),
      vs: null,
      fallRate: null,
      groundSpeed: null,
      phase: PHASE.CLIMB,
    }))
    .sort((a, b) => a.t - b.t);

  if (!series.length) {
    throw new Error("Jump has no usable samples.");
  }

  const smoothAlt = smooth(series.map((s) => s.alt), SMOOTH_WINDOW);

  // vertical speed (m/s, negative = descending) + fall rate (positive descending)
  for (let i = 0; i < series.length; i++) {
    const prev = i > 0 ? i - 1 : i;
    const next = i < series.length - 1 ? i + 1 : i;
    const dAlt = (smoothAlt[next] ?? 0) - (smoothAlt[prev] ?? 0);
    const dt = series[next].t - series[prev].t || 1;
    const vs = smoothAlt[i] == null ? null : dAlt / dt;
    series[i].vs = vs == null ? null : round(vs, 2);
    series[i].fallRate = vs == null ? null : round(-vs, 2);
  }

  // ground speed (m/s) from GPS deltas (used for the canopy phase)
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1];
    const b = series[i];
    const d = haversine(a.lat, a.lng, b.lat, b.lng);
    const dt = b.t - a.t || 1;
    b.groundSpeed = d == null ? null : round(d / dt, 2);
  }
  if (series.length > 1) series[0].groundSpeed = series[1].groundSpeed;

  const phases = detectPhases(series, smoothAlt);
  applyPhases(series, phases);

  const summary = buildSummary(series, phases, smoothAlt);

  const startMs = meta.startTimeMs ?? Date.now();
  const durationSec = series[series.length - 1].t - series[0].t;

  const exitPoint = summary.exitPoint;
  const dropzone =
    meta.dropzone ||
    nearestDropzone(exitPoint?.lat, exitPoint?.lng) ||
    nearestDropzone(summary.landingPoint?.lat, summary.landingPoint?.lng) ||
    null;

  return {
    schema: SCHEMA,
    source: meta.source || "live",
    device: meta.device || null,
    createdAt: new Date().toISOString(),
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(startMs + durationSec * 1000).toISOString(),
    durationSec: round(durationSec, 1),
    jumpType: meta.jumpType || null,
    jumpNumber: meta.jumpNumber ?? null,
    notes: meta.notes || null,
    dropzone,
    target: meta.target || null,
    summary,
    phases,
    series,
  };
}

// ---------------------------------------------------------------------------
// Phase detection from the speed/altitude profile.
// Returns [{phase, startT, endT}] covering the whole timeline.
// ---------------------------------------------------------------------------
function detectPhases(series, smoothAlt) {
  const n = series.length;
  const fr = series.map((s) => s.fallRate);

  // 1) find altitude peak (top of climb / exit region)
  let peakIdx = 0;
  let peakAlt = -Infinity;
  for (let i = 0; i < n; i++) {
    if (smoothAlt[i] != null && smoothAlt[i] > peakAlt) {
      peakAlt = smoothAlt[i];
      peakIdx = i;
    }
  }

  // 2) freefall = longest run after peak with sustained high fall rate
  let ffStart = -1;
  let ffEnd = -1;
  {
    let runStart = -1;
    for (let i = peakIdx; i < n; i++) {
      const fast = fr[i] != null && fr[i] >= FREEFALL_FR;
      if (fast && runStart === -1) runStart = i;
      if ((!fast || i === n - 1) && runStart !== -1) {
        const runEnd = fast ? i : i - 1;
        if (ffStart === -1 || runEnd - runStart > ffEnd - ffStart) {
          ffStart = runStart;
          ffEnd = runEnd;
        }
        runStart = -1;
      }
    }
  }

  // 3) exit boundary = first time fall rate exceeds EXIT_FR after the peak
  let exitIdx = peakIdx;
  for (let i = peakIdx; i < (ffStart === -1 ? n : ffStart); i++) {
    if (fr[i] != null && fr[i] >= EXIT_FR) {
      exitIdx = i;
      break;
    }
  }
  if (ffStart !== -1 && exitIdx >= ffStart) exitIdx = Math.max(peakIdx, ffStart - 2);

  // 4) landed = sustained low total speed near the minimum altitude at the end
  const minAlt = Math.min(...smoothAlt.filter((a) => a != null));
  let landedIdx = -1;
  for (let i = (ffEnd === -1 ? peakIdx : ffEnd); i < n; i++) {
    const slow =
      (series[i].fallRate == null || Math.abs(series[i].fallRate) < LANDED_SPEED) &&
      (series[i].groundSpeed == null || series[i].groundSpeed < LANDED_SPEED);
    const low = smoothAlt[i] == null || smoothAlt[i] - minAlt < 15;
    if (slow && low) {
      landedIdx = i;
      break;
    }
  }

  const t = (i) => series[i].t;
  const phases = [];
  const lastT = t(n - 1);

  if (ffStart === -1) {
    // No freefall detected (e.g. a ground/walk test recording, or baro garbage).
    // Still produce a best-effort climb -> canopy/landed split so the UI works.
    const splitIdx = landedIdx !== -1 ? landedIdx : Math.floor(n * 0.8);
    phases.push({ phase: PHASE.CLIMB, startT: t(0), endT: t(Math.min(splitIdx, n - 1)) });
    if (landedIdx !== -1 && landedIdx < n - 1) {
      phases.push({ phase: PHASE.CANOPY, startT: t(landedIdx), endT: t(landedIdx) });
      phases.push({ phase: PHASE.LANDED, startT: t(landedIdx), endT: lastT });
    }
    return mergeCover(phases, t(0), lastT);
  }

  phases.push({ phase: PHASE.CLIMB, startT: t(0), endT: t(exitIdx) });
  phases.push({ phase: PHASE.EXIT, startT: t(exitIdx), endT: t(ffStart) });
  phases.push({ phase: PHASE.FREEFALL, startT: t(ffStart), endT: t(ffEnd) });
  const canopyEnd = landedIdx !== -1 ? t(landedIdx) : lastT;
  phases.push({ phase: PHASE.CANOPY, startT: t(ffEnd), endT: canopyEnd });
  if (landedIdx !== -1) {
    phases.push({ phase: PHASE.LANDED, startT: canopyEnd, endT: lastT });
  }
  return mergeCover(phases, t(0), lastT);
}

// Ensure phases are contiguous and cover [start,end]; drop zero-length except exit.
function mergeCover(phases, start, end) {
  const out = [];
  for (const p of phases) {
    if (p.endT < p.startT) continue;
    out.push(p);
  }
  if (out.length) {
    out[0].startT = start;
    out[out.length - 1].endT = end;
  }
  return out;
}

function applyPhases(series, phases) {
  for (const s of series) {
    let ph = PHASE.CLIMB;
    for (const p of phases) {
      if (s.t >= p.startT && s.t <= p.endT) ph = p.phase;
    }
    s.phase = ph;
  }
}

// ---------------------------------------------------------------------------
function buildSummary(series, phases, smoothAlt) {
  const inPhase = (name) => series.filter((s) => s.phase === name);
  const ff = inPhase(PHASE.FREEFALL);
  const canopy = inPhase(PHASE.CANOPY);

  const exitBand = phases.find((p) => p.phase === PHASE.EXIT) ||
    phases.find((p) => p.phase === PHASE.FREEFALL);
  // Exit altitude is captured at the exit boundary (still reliable: stable baro
  // before the airflow corrupts readings).
  let exitAltitude = null;
  let exitPoint = null;
  if (exitBand) {
    const exitSample = nearestSample(series, exitBand.startT);
    exitAltitude = exitSample ? round(exitSample.alt, 0) : null;
    if (exitSample && exitSample.lat != null) {
      exitPoint = { lat: exitSample.lat, lng: exitSample.lng };
    }
  }
  if (exitAltitude == null) {
    const valid = smoothAlt.filter((a) => a != null);
    exitAltitude = valid.length ? round(Math.max(...valid), 0) : null;
  }

  // landing point = last sample with a GPS fix
  let landingPoint = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].lat != null) {
      landingPoint = { lat: series[i].lat, lng: series[i].lng };
      break;
    }
  }

  const freefallTime = phaseDuration(phases, PHASE.FREEFALL);
  const canopyTime = phaseDuration(phases, PHASE.CANOPY);

  const ffRates = ff.map((s) => s.fallRate).filter((x) => x != null);
  const peakVerticalSpeed = ffRates.length ? round(Math.max(...ffRates), 1) : null;
  const avgVerticalSpeed = ffRates.length ? round(mean(ffRates), 1) : null;

  const hrs = series.map((s) => s.hr).filter((x) => x != null && x > 0);
  const peakHr = hrs.length ? Math.max(...hrs) : null;
  const avgHr = hrs.length ? round(mean(hrs), 0) : null;

  const canopySpeeds = canopy.map((s) => s.groundSpeed).filter((x) => x != null);
  const maxGroundSpeed = canopySpeeds.length ? round(Math.max(...canopySpeeds), 1) : null;

  const horizontalDrift =
    exitPoint && landingPoint
      ? round(haversine(exitPoint.lat, exitPoint.lng, landingPoint.lat, landingPoint.lng), 0)
      : null;

  // tracking / wingsuit performance: horizontal motion during freefall.
  // glide ratio = horizontal displacement / vertical drop over the freefall.
  let glideRatio = null;
  let ffAvgHorizontalSpeed = null;
  let ffPeakHorizontalSpeed = null;
  let ffHorizontalDistance = null;
  const ffGps = ff.filter((s) => s.lat != null && s.lng != null);
  if (ffGps.length >= 2) {
    let path = 0;
    for (let i = 1; i < ffGps.length; i++) {
      const d = haversine(ffGps[i - 1].lat, ffGps[i - 1].lng, ffGps[i].lat, ffGps[i].lng);
      if (d != null) path += d;
    }
    const net = haversine(ffGps[0].lat, ffGps[0].lng, ffGps[ffGps.length - 1].lat, ffGps[ffGps.length - 1].lng);
    const aTop = ffGps[0].alt;
    const aBot = ffGps[ffGps.length - 1].alt;
    const vDrop = aTop != null && aBot != null ? aTop - aBot : null;
    if (net != null) ffHorizontalDistance = round(net, 0);
    if (vDrop && vDrop > 0 && net != null) glideRatio = round(net / vDrop, 2);
    if (freefallTime > 0) ffAvgHorizontalSpeed = round(path / freefallTime, 1);
    const ffGspeeds = ff.map((s) => s.groundSpeed).filter((x) => x != null);
    ffPeakHorizontalSpeed = ffGspeeds.length ? round(Math.max(...ffGspeeds), 1) : null;
  }

  // data quality flag for honest UI labelling
  let dataQuality = "ok";
  if (!ff.length) dataQuality = "no-freefall-detected";
  else if (exitAltitude == null) dataQuality = "no-altitude";

  return {
    exitAltitude,
    freefallTime: round(freefallTime, 0),
    canopyTime: round(canopyTime, 0),
    peakVerticalSpeed,
    avgVerticalSpeed,
    peakHr,
    avgHr,
    exitPoint,
    landingPoint,
    horizontalDrift,
    distanceToTarget: null, // filled when a target is set (see routes)
    maxGroundSpeed,
    glideRatio,
    ffAvgHorizontalSpeed,
    ffPeakHorizontalSpeed,
    ffHorizontalDistance,
    dataQuality,
  };
}

function phaseDuration(phases, name) {
  return phases
    .filter((p) => p.phase === name)
    .reduce((a, p) => a + (p.endT - p.startT), 0);
}

function nearestSample(series, t) {
  let best = null;
  let bestD = Infinity;
  for (const s of series) {
    const d = Math.abs(s.t - t);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

// Live payload from the watch: compact columnar arrays.
// { schema, source, device, startTime (epoch s), summary?, series:{t,alt,vs,hr,lat,lng,ph} }
export function normalizeLive(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Empty payload.");
  }
  const s = payload.series;
  if (!s || !Array.isArray(s.t) || !s.t.length) {
    throw new Error("Payload missing series.t[].");
  }
  const at = (arr, i) => (Array.isArray(arr) ? arr[i] : undefined);
  const raw = s.t.map((t, i) => ({
    t,
    alt: at(s.alt, i),
    hr: at(s.hr, i),
    lat: at(s.lat, i),
    lng: at(s.lng, i),
  }));

  return buildJump(raw, {
    source: "live",
    device: payload.device || "garmin",
    startTimeMs: payload.startTime ? Number(payload.startTime) * 1000 : Date.now(),
    jumpType: payload.jumpType,
    notes: payload.notes,
  });
}

// Parsed FIT object (from fit-file-parser) -> canonical.
export function normalizeFit(fit, meta = {}) {
  const records = (fit && fit.records) || [];
  if (!records.length) throw new Error("FIT file has no record messages.");

  const t0 = records[0].timestamp ? new Date(records[0].timestamp).getTime() : Date.now();
  const raw = [];
  for (const r of records) {
    const ts = r.timestamp ? new Date(r.timestamp).getTime() : null;
    if (ts == null) continue;
    raw.push({
      t: (ts - t0) / 1000,
      alt: pick(r.enhanced_altitude, r.altitude),
      hr: r.heart_rate,
      lat: pick(r.position_lat, r.latitude),
      lng: pick(r.position_long, r.longitude),
    });
  }
  if (!raw.length) throw new Error("FIT records have no timestamps.");

  return buildJump(raw, {
    source: "fit",
    device: fitDevice(fit),
    startTimeMs: t0,
    jumpType: meta.jumpType,
    notes: meta.notes,
  });
}

function fitDevice(fit) {
  const di = fit && (fit.device_infos || fit.device_info);
  if (Array.isArray(di) && di.length) {
    return di[0].product_name || di[0].manufacturer || "garmin";
  }
  return "garmin";
}

// ---------------------------------------------------------------------------
// small utils
// ---------------------------------------------------------------------------
function smooth(arr, half) {
  const out = new Array(arr.length).fill(null);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0;
    let cnt = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < arr.length && arr[j] != null && !Number.isNaN(arr[j])) {
        sum += arr[j];
        cnt++;
      }
    }
    out[i] = cnt ? sum / cnt : null;
  }
  return out;
}

function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function pick(a, b) {
  return a != null ? a : b != null ? b : null;
}
function round(v, d = 0) {
  if (v == null || Number.isNaN(v)) return null;
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
