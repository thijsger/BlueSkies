import express from "express";
import multer from "multer";
import FitParserPkg from "fit-file-parser";
import {
  insertJump,
  listJumps,
  getJump,
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
  const allowed = ["jumpType", "notes", "jumpNumber", "target", "dropzone"];
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
    }
  }

  res.json({
    totalJumps: n,
    totalFreefallSec: Math.round(totalFreefall),
    totalCanopySec: Math.round(totalCanopy),
    highestExit,
    longestFreefall,
    perMonth,
    exitBuckets,
    freefallAccrual,
  });
});

export default router;
