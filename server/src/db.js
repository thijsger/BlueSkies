import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// DATA_DIR points at the Render persistent disk in production
// (mount path configured in render.yaml), or ./data locally.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "skydive.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS jumps (
    id            TEXT PRIMARY KEY,
    created_at    TEXT NOT NULL,
    start_time    TEXT NOT NULL,
    end_time      TEXT,
    source        TEXT NOT NULL,
    device        TEXT,
    dropzone      TEXT,
    jump_type     TEXT,
    jump_number   INTEGER,
    notes         TEXT,
    exit_altitude REAL,
    freefall_time REAL,
    canopy_time   REAL,
    peak_vs       REAL,
    peak_hr       INTEGER,
    duration_sec  REAL,
    target_lat    REAL,
    target_lng    REAL,
    data          TEXT NOT NULL  -- full canonical jump JSON (summary+phases+series)
  );
`);

const insertStmt = db.prepare(`
  INSERT INTO jumps (
    id, created_at, start_time, end_time, source, device, dropzone,
    jump_type, jump_number, notes, exit_altitude, freefall_time, canopy_time,
    peak_vs, peak_hr, duration_sec, target_lat, target_lng, data
  ) VALUES (
    @id, @created_at, @start_time, @end_time, @source, @device, @dropzone,
    @jump_type, @jump_number, @notes, @exit_altitude, @freefall_time, @canopy_time,
    @peak_vs, @peak_hr, @duration_sec, @target_lat, @target_lng, @data
  )
`);

function nextJumpNumber() {
  const row = db.prepare("SELECT MAX(jump_number) AS n FROM jumps").get();
  return (row && row.n ? row.n : 0) + 1;
}

export function insertJump(jump) {
  const id = randomUUID();
  const jumpNumber = jump.jumpNumber ?? nextJumpNumber();
  const full = { ...jump, id, jumpNumber };
  insertStmt.run({
    id,
    created_at: full.createdAt,
    start_time: full.startTime,
    end_time: full.endTime || null,
    source: full.source,
    device: full.device || null,
    dropzone: full.dropzone || null,
    jump_type: full.jumpType || null,
    jump_number: jumpNumber,
    notes: full.notes || null,
    exit_altitude: full.summary?.exitAltitude ?? null,
    freefall_time: full.summary?.freefallTime ?? null,
    canopy_time: full.summary?.canopyTime ?? null,
    peak_vs: full.summary?.peakVerticalSpeed ?? null,
    peak_hr: full.summary?.peakHr ?? null,
    duration_sec: full.durationSec ?? null,
    target_lat: full.target?.lat ?? null,
    target_lng: full.target?.lng ?? null,
    data: JSON.stringify(full),
  });
  return full;
}

// list = summaries only (no heavy series), newest first
export function listJumps() {
  const rows = db
    .prepare("SELECT data FROM jumps ORDER BY start_time DESC")
    .all();
  return rows.map((r) => {
    const j = JSON.parse(r.data);
    return {
      id: j.id,
      jumpNumber: j.jumpNumber,
      startTime: j.startTime,
      source: j.source,
      device: j.device,
      dropzone: j.dropzone,
      jumpType: j.jumpType,
      notes: j.notes,
      durationSec: j.durationSec,
      summary: j.summary,
    };
  });
}

export function getJump(id) {
  const row = db.prepare("SELECT data FROM jumps WHERE id = ?").get(id);
  return row ? JSON.parse(row.data) : null;
}

// full jumps incl. series — used by the stats aggregation (HR time-in-zone)
export function allJumpsFull() {
  return db
    .prepare("SELECT data FROM jumps ORDER BY start_time ASC")
    .all()
    .map((r) => JSON.parse(r.data));
}

// patch user-editable fields: jumpType, notes, jumpNumber, target {lat,lng}
export function updateJump(id, patch) {
  const jump = getJump(id);
  if (!jump) return null;

  if (patch.jumpType !== undefined) jump.jumpType = patch.jumpType;
  if (patch.aircraft !== undefined) jump.aircraft = patch.aircraft;
  if (patch.notes !== undefined) jump.notes = patch.notes;
  if (patch.jumpNumber !== undefined) jump.jumpNumber = patch.jumpNumber;
  if (patch.dropzone !== undefined) jump.dropzone = patch.dropzone;
  if (patch.target !== undefined) {
    jump.target = patch.target;
    // recompute distance-to-target from the landing point
    if (patch.target && jump.summary?.landingPoint) {
      jump.summary.distanceToTarget = haversineLocal(
        patch.target.lat,
        patch.target.lng,
        jump.summary.landingPoint.lat,
        jump.summary.landingPoint.lng
      );
    } else {
      jump.summary.distanceToTarget = null;
    }
  }

  db.prepare(
    `UPDATE jumps SET jump_type=@jt, notes=@notes, jump_number=@jn,
       dropzone=@dz, target_lat=@tlat, target_lng=@tlng, data=@data WHERE id=@id`
  ).run({
    id,
    jt: jump.jumpType || null,
    notes: jump.notes || null,
    jn: jump.jumpNumber ?? null,
    dz: jump.dropzone || null,
    tlat: jump.target?.lat ?? null,
    tlng: jump.target?.lng ?? null,
    data: JSON.stringify(jump),
  });
  return jump;
}

export function deleteJump(id) {
  const r = db.prepare("DELETE FROM jumps WHERE id = ?").run(id);
  return r.changes > 0;
}

function haversineLocal(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export default db;
