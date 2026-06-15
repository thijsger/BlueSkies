#!/usr/bin/env node
// Optional demo seeder — NOT part of the app, run manually.
// Posts a set of realistic jumps to YOUR account so the dashboard/stats/3D look
// alive before you've logged real jumps. Delete them anytime from the logbook.
//
// Usage:
//   BASE=https://blueskies.fun API_KEY=<your watch key> node tools/seed-demo.js
//   (BASE defaults to http://localhost:3000)
//
// Find your API key in the dashboard: avatar → Profiel → Watch-key.

const BASE = (process.env.BASE || "http://localhost:3000").replace(/\/$/, "");
const API_KEY = process.env.API_KEY;
if (!API_KEY) { console.error("Set API_KEY (dashboard → Profiel → Watch-key)."); process.exit(1); }

// Dutch dropzones
const DZ = {
  teuge: { lat: 52.2447, lng: 6.0469 },
  texel: { lat: 53.1183, lng: 4.8336 },
};
const mPerDeg = (lat) => ({ lat: 111320, lng: 111320 * Math.cos((lat * Math.PI) / 180) });
const lerp = (a, b, t) => a + (b - a) * t;

// Build one realistic jump as a live-style payload.
function buildJump({ date, exitAlt, deployAlt = 1100, terminal = 55, type, dz = DZ.teuge, windDir = 240, wingsuit = false, freefly = false }) {
  const t = [], alt = [], hr = [], lat = [], lng = [], ph = [];
  const md = mPerDeg(dz.lat);
  let time = 0;
  const push = (a, h, la, lo, p) => {
    t.push(time); alt.push(Math.round(a)); hr.push(Math.round(h));
    lat.push(+la.toFixed(6)); lng.push(+lo.toFixed(6)); ph.push(p); time++;
  };

  // wind vector (m/s) — direction wind blows TOWARD
  const wr = (windDir * Math.PI) / 180;
  const windSpeed = 7;
  const wvLat = -Math.cos(wr) * windSpeed; // north component
  const wvLng = -Math.sin(wr) * windSpeed; // east component

  // exit point ~1.3 km up the jump run from the DZ
  let la = dz.lat + 0.011, lo = dz.lng - 0.005;

  // CLIMB — plane circling up to exit altitude (compressed to ~50 s)
  const climbSec = 50;
  for (let i = 0; i < climbSec; i++) {
    const f = i / climbSec;
    const ang = f * Math.PI * 4, r = 350;
    push(200 + f * (exitAlt - 200), 92 + f * 22,
      dz.lat + (r * Math.cos(ang)) / md.lat, dz.lng + (r * Math.sin(ang)) / md.lng, 0);
  }

  // FREEFALL — accelerate toward terminal, drift with wind (+ forward throw / wingsuit glide)
  // wingsuits fall slower (~38 m/s) but move forward fast -> realistic glide ~1.5
  const term = wingsuit ? 38 : freefly ? 62 : terminal;
  let a = exitAlt, vr = 3, hrv = 122;
  const fwd = wingsuit ? 56 : freefly ? 5 : 7;       // horizontal m/s
  const fdir = wr + Math.PI;                          // fly roughly up the run
  while (a > deployAlt) {
    vr = Math.min(term, vr + (term - vr) * 0.10 + 1.4);
    a -= vr;
    la += (wvLat + Math.cos(fdir) * fwd) / md.lat;
    lo += (wvLng + Math.sin(fdir) * fwd) / md.lng;
    hrv = Math.min(169, hrv + 1.3);
    push(Math.max(a, deployAlt), hrv, la, lo, 2);
  }

  // CANOPY — descending spiral around the landing area, then a final approach into wind
  const openLat = la, openLng = lo;
  const land = { lat: dz.lat, lng: dz.lng };
  const r0 = Math.hypot((openLat - land.lat) * md.lat, (openLng - land.lng) * md.lng);
  const startAng = Math.atan2((openLng - land.lng) * md.lng, (openLat - land.lat) * md.lat);
  const canopyTime = Math.round(deployAlt / 5.0);     // ~5 m/s descent
  let spiralLat = openLat, spiralLng = openLng;
  for (let i = 0; i < canopyTime; i++) {
    const f = i / canopyTime;
    const ca = deployAlt * (1 - f);
    const chr = 142 - f * 32;
    if (f < 0.78) {
      const turns = 2.5;
      const ang = startAng + (f / 0.78) * turns * Math.PI * 2;
      const rad = r0 * (1 - (f / 0.78) * 0.92);
      spiralLat = land.lat + (rad * Math.cos(ang)) / md.lat;
      spiralLng = land.lng + (rad * Math.sin(ang)) / md.lng;
      push(ca, chr, spiralLat, spiralLng, 3);
    } else {
      const g = (f - 0.78) / 0.22;                    // straight final into the landing
      push(ca, chr, lerp(spiralLat, land.lat, g), lerp(spiralLng, land.lng, g), 3);
    }
  }

  // LANDED
  for (let i = 0; i < 8; i++) push(0, 104, land.lat, land.lng, 4);

  return {
    schema: "skydive.v1", source: "live", device: "venu3",
    startTime: Math.floor(new Date(date).getTime() / 1000),
    jumpType: type,
    series: { t, alt, hr, lat, lng, ph },
  };
}

// a season of realistic jumps
const JUMPS = [
  { date: "2026-03-08T11:20:00", exitAlt: 4000, type: "fun", dz: DZ.teuge, windDir: 230 },
  { date: "2026-03-22T13:05:00", exitAlt: 4100, type: "freefly", dz: DZ.teuge, windDir: 250, freefly: true },
  { date: "2026-04-05T10:40:00", exitAlt: 3600, type: "hop & pop", deployAlt: 1500, dz: DZ.teuge, windDir: 200 },
  { date: "2026-04-19T15:10:00", exitAlt: 4200, type: "fun", dz: DZ.texel, windDir: 300 },
  { date: "2026-05-03T12:30:00", exitAlt: 4000, type: "tracking", dz: DZ.teuge, windDir: 240, wingsuit: false, freefly: false },
  { date: "2026-05-17T14:00:00", exitAlt: 4100, type: "wingsuit", deployAlt: 1300, dz: DZ.teuge, windDir: 260, wingsuit: true },
  { date: "2026-05-31T11:50:00", exitAlt: 3900, type: "fun", dz: DZ.teuge, windDir: 220 },
  { date: "2026-06-13T16:20:00", exitAlt: 4150, type: "freefly", dz: DZ.teuge, windDir: 270, freefly: true },
];

(async () => {
  let ok = 0;
  for (const cfg of JUMPS) {
    const payload = buildJump(cfg);
    const res = await fetch(BASE + "/api/jumps", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify(payload),
    });
    if (res.ok) { const j = await res.json(); console.log(`✓ #${j.jumpNumber} ${cfg.type} ${cfg.date.slice(0, 10)}`); ok++; }
    else { console.error(`✗ ${cfg.date}: ${res.status} ${await res.text()}`); }
  }
  console.log(`\nDone: ${ok}/${JUMPS.length} jumps seeded to ${BASE}.`);
})();
