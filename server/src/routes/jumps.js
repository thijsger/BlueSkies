import express from "express";
import multer from "multer";
import FitParserPkg from "fit-file-parser";
import {
  insertJump,
  listJumps,
  getJump,
  allJumpsFull,
  updateJump,
  deleteJump,
} from "../db.js";
import { normalizeLive, normalizeFit } from "../model.js";

const FitParser = FitParserPkg.default || FitParserPkg;

const router = express.Router();

// .FIT files are small; 25 MB is generous. Memory storage -> parse buffer.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function parseFit(buffer) {
  return new Promise((resolve, reject) => {
    const parser = new FitParser({
      force: true,
      speedUnit: "m/s",
      lengthUnit: "m",
      temperatureUnit: "celsius",
      elapsedRecordField: true,
      mode: "list",
    });
    parser.parse(buffer, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

// POST /api/jumps  — live JSON payload from the watch
router.post("/jumps", (req, res) => {
  try {
    const jump = normalizeLive(req.body);
    const saved = insertJump(jump);
    res.status(201).json({ id: saved.id, jumpNumber: saved.jumpNumber });
  } catch (err) {
    res.status(400).json({ error: "Invalid live payload", detail: String(err.message || err) });
  }
});

// POST /api/jumps/upload  — multipart .FIT file
router.post("/jumps/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded (field name must be 'file')." });
  }
  try {
    const fit = await parseFit(req.file.buffer);
    const meta = {
      jumpType: req.body.jumpType,
      notes: req.body.notes,
    };
    const jump = normalizeFit(fit, meta);
    const saved = insertJump(jump);
    res.status(201).json({ id: saved.id, jumpNumber: saved.jumpNumber, summary: saved.summary });
  } catch (err) {
    res.status(400).json({ error: "Could not parse .FIT file", detail: String(err.message || err) });
  }
});

// GET /api/jumps  — list summaries
router.get("/jumps", (_req, res) => {
  res.json(listJumps());
});

// GET /api/jumps/:id  — full jump (series + phases)
router.get("/jumps/:id", (req, res) => {
  const jump = getJump(req.params.id);
  if (!jump) return res.status(404).json({ error: "Jump not found" });
  res.json(jump);
});

// PATCH /api/jumps/:id  — edit jumpType / notes / jumpNumber / target / dropzone
router.patch("/jumps/:id", (req, res) => {
  const allowed = ["jumpType", "aircraft", "notes", "jumpNumber", "target", "dropzone"];
  const patch = {};
  for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
  const jump = updateJump(req.params.id, patch);
  if (!jump) return res.status(404).json({ error: "Jump not found" });
  res.json(jump);
});

// DELETE /api/jumps/:id
router.delete("/jumps/:id", (req, res) => {
  const ok = deleteJump(req.params.id);
  if (!ok) return res.status(404).json({ error: "Jump not found" });
  res.status(204).end();
});

// GET /api/stats  — cumulative stats + trends
router.get("/stats", (_req, res) => {
  const jumps = listJumps();
  const n = jumps.length;

  let totalFreefall = 0;
  let totalCanopy = 0;
  let highestExit = null;
  let longestFreefall = null;
  const perMonth = {}; // "YYYY-MM" -> count
  const exitBuckets = {}; // altitude bucket -> count
  let freefallAccrual = []; // [{date, cumSec}]
  const byDropzone = {}; // dropzone -> count
  const byType = {}; // jumpType -> count
  let exitSum = 0;
  let exitCount = 0;

  const sorted = [...jumps].sort(
    (a, b) => new Date(a.startTime) - new Date(b.startTime)
  );
  let cum = 0;
  for (const j of sorted) {
    const ff = j.summary?.freefallTime || 0;
    const cp = j.summary?.canopyTime || 0;
    totalFreefall += ff;
    totalCanopy += cp;
    cum += ff;
    freefallAccrual.push({ date: j.startTime, cumSec: cum });

    const exit = j.summary?.exitAltitude;
    if (exit != null && (highestExit == null || exit > highestExit)) highestExit = exit;
    if (longestFreefall == null || ff > longestFreefall) longestFreefall = ff;

    const month = j.startTime.slice(0, 7);
    perMonth[month] = (perMonth[month] || 0) + 1;

    if (exit != null) {
      const bucket = `${Math.floor(exit / 500) * 500}`;
      exitBuckets[bucket] = (exitBuckets[bucket] || 0) + 1;
      exitSum += exit;
      exitCount += 1;
    }

    const dz = j.dropzone || "Onbekend";
    byDropzone[dz] = (byDropzone[dz] || 0) + 1;
    const tp = j.jumpType || "onbekend";
    byType[tp] = (byType[tp] || 0) + 1;
  }

  // currency: days since most recent jump (jumps list is newest-first)
  const lastJumpDate = n ? jumps[0].startTime : null;
  const now = Date.now();
  const daysSinceLast = lastJumpDate
    ? Math.floor((now - new Date(lastJumpDate).getTime()) / 86400000)
    : null;

  // --- richer trends (all from summaries unless noted) ---
  const trend = [];        // per-jump series over time
  const glideTrend = [];   // wingsuit/tracking only
  const records = {
    highestExit: rec(), longestFreefall: rec(), maxGlide: rec(),
    maxGroundSpeed: rec(), peakHr: rec(),
  };
  let last30 = 0, last90 = 0, prevDate = null, longestGapDays = 0;

  for (const j of sorted) {
    const s = j.summary || {};
    const d = new Date(j.startTime);
    const ageDays = (now - d.getTime()) / 86400000;
    if (ageDays <= 30) last30++;
    if (ageDays <= 90) last90++;
    if (prevDate) {
      const gap = (d.getTime() - prevDate) / 86400000;
      if (gap > longestGapDays) longestGapDays = gap;
    }
    prevDate = d.getTime();

    trend.push({
      date: j.startTime, jumpNumber: j.jumpNumber,
      exit: s.exitAltitude ?? null, freefall: s.freefallTime ?? null,
      peakHr: s.peakHr ?? null, avgHr: s.avgHr ?? null,
      maxGroundKmh: s.maxGroundSpeed != null ? Math.round(s.maxGroundSpeed * 3.6) : null,
    });
    if (s.glideRatio != null) glideTrend.push({ date: j.startTime, glide: s.glideRatio });

    consider(records.highestExit, s.exitAltitude, j);
    consider(records.longestFreefall, s.freefallTime, j);
    consider(records.maxGlide, s.glideRatio, j);
    consider(records.maxGroundSpeed, s.maxGroundSpeed != null ? Math.round(s.maxGroundSpeed * 3.6) : null, j);
    consider(records.peakHr, s.peakHr, j);
  }

  // --- HR time-in-zone across all jumps (needs full series) ---
  // generic bpm bands (no personal max-HR configured)
  const zoneEdges = [0, 100, 120, 140, 160, 180, 999];
  const zoneLabels = ["<100", "100–120", "120–140", "140–160", "160–180", "180+"];
  const hrZones = new Array(zoneLabels.length).fill(0); // seconds
  for (const j of allJumpsFull()) {
    const series = j.series || [];
    for (let i = 1; i < series.length; i++) {
      const hr = series[i].hr;
      if (hr == null || hr <= 0) continue;
      const dt = (series[i].t - series[i - 1].t) || 1;
      for (let z = 0; z < zoneLabels.length; z++) {
        if (hr >= zoneEdges[z] && hr < zoneEdges[z + 1]) { hrZones[z] += dt; break; }
      }
    }
  }

  function rec() { return { value: null, jumpNumber: null, id: null, date: null }; }
  function consider(r, val, j) {
    if (val == null) return;
    if (r.value == null || val > r.value) {
      r.value = val; r.jumpNumber = j.jumpNumber; r.id = j.id; r.date = j.startTime;
    }
  }

  res.json({
    totalJumps: n,
    totalFreefallSec: Math.round(totalFreefall),
    totalCanopySec: Math.round(totalCanopy),
    avgFreefallSec: n ? Math.round(totalFreefall / n) : null,
    avgExit: exitCount ? Math.round(exitSum / exitCount) : null,
    highestExit,
    longestFreefall,
    lastJumpDate,
    daysSinceLast,
    currency: { last30, last90, longestGapDays: Math.round(longestGapDays), avgPerMonth: round1(avgPerMonth(sorted)) },
    perMonth,
    exitBuckets,
    freefallAccrual,
    byDropzone,
    byType,
    trend,
    glideTrend,
    records,
    hrZones: hrZones.map((sec, i) => ({ label: zoneLabels[i], sec: Math.round(sec) })),
  });
});

function avgPerMonth(sorted) {
  if (sorted.length < 1) return 0;
  const first = new Date(sorted[0].startTime).getTime();
  const months = Math.max((Date.now() - first) / (86400000 * 30.4), 1);
  return sorted.length / months;
}
function round1(v) { return Math.round(v * 10) / 10; }

export default router;
