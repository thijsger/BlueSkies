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
    user_id       TEXT,
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
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE,
    name          TEXT,
    password_hash TEXT,
    google_sub    TEXT,
    api_key       TEXT UNIQUE,
    created_at    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta ( k TEXT PRIMARY KEY, v TEXT );
`);

// migration: add user_id to an older jumps table that predates auth
const cols = db.prepare("PRAGMA table_info(jumps)").all().map((c) => c.name);
if (!cols.includes("user_id")) {
  db.exec("ALTER TABLE jumps ADD COLUMN user_id TEXT");
}
// migration: password-reset columns on users
const ucols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!ucols.includes("reset_token")) db.exec("ALTER TABLE users ADD COLUMN reset_token TEXT");
if (!ucols.includes("reset_expiry")) db.exec("ALTER TABLE users ADD COLUMN reset_expiry INTEGER");

const insertStmt = db.prepare(`
  INSERT INTO jumps (
    id, user_id, created_at, start_time, end_time, source, device, dropzone,
    jump_type, jump_number, notes, exit_altitude, freefall_time, canopy_time,
    peak_vs, peak_hr, duration_sec, target_lat, target_lng, data
  ) VALUES (
    @id, @user_id, @created_at, @start_time, @end_time, @source, @device, @dropzone,
    @jump_type, @jump_number, @notes, @exit_altitude, @freefall_time, @canopy_time,
    @peak_vs, @peak_hr, @duration_sec, @target_lat, @target_lng, @data
  )
`);

// jump numbering is per user
function nextJumpNumber(userId) {
  const row = db.prepare("SELECT MAX(jump_number) AS n FROM jumps WHERE user_id = ?").get(userId);
  return (row && row.n ? row.n : 0) + 1;
}

// ---------------------------------------------------------------- users
export function createUser({ email, name, passwordHash = null, googleSub = null }) {
  const id = randomUUID();
  const apiKey = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash, google_sub, api_key, created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(id, email, name, passwordHash, googleSub, apiKey, new Date().toISOString());
  return getUserById(id);
}
export function getUserById(id) { return db.prepare("SELECT * FROM users WHERE id = ?").get(id) || null; }
export function getUserByEmail(email) { return db.prepare("SELECT * FROM users WHERE email = ?").get(email) || null; }
export function getUserByGoogleSub(sub) { return db.prepare("SELECT * FROM users WHERE google_sub = ?").get(sub) || null; }
export function getUserByApiKey(key) { return db.prepare("SELECT * FROM users WHERE api_key = ?").get(key) || null; }
export function linkGoogle(id, sub) { db.prepare("UPDATE users SET google_sub = ? WHERE id = ?").run(sub, id); }
export function regenerateApiKey(id) {
  const key = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  db.prepare("UPDATE users SET api_key = ? WHERE id = ?").run(key, id);
  return key;
}
export function userCount() { return db.prepare("SELECT COUNT(*) AS n FROM users").get().n; }
// one-time migration: assign pre-auth (ownerless) jumps to the first user
export function claimOrphanJumps(userId) {
  db.prepare("UPDATE jumps SET user_id = ? WHERE user_id IS NULL").run(userId);
}

export function getMeta(k) { const r = db.prepare("SELECT v FROM meta WHERE k = ?").get(k); return r ? r.v : null; }
export function setMeta(k, v) { db.prepare("INSERT INTO meta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, v); }

// password reset
export function setResetToken(userId, token, expiry) {
  db.prepare("UPDATE users SET reset_token = ?, reset_expiry = ? WHERE id = ?").run(token, expiry, userId);
}
export function getUserByResetToken(token) {
  const u = db.prepare("SELECT * FROM users WHERE reset_token = ?").get(token);
  return u && u.reset_expiry && u.reset_expiry > Date.now() ? u : null;
}
export function setPassword(userId, passwordHash) {
  db.prepare("UPDATE users SET password_hash = ?, reset_token = NULL, reset_expiry = NULL WHERE id = ?").run(passwordHash, userId);
}

// online backup of the SQLite file (safe with WAL); keeps the last `keep` copies
export function backupTo(dir, keep = 7) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(dir, `skydive-${stamp}.db`);
  return db.backup(dest).then(() => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".db")).sort();
    while (files.length > keep) fs.rmSync(path.join(dir, files.shift()), { force: true });
    return dest;
  });
}

// ---------------------------------------------------------------- jumps
export function insertJump(jump, userId) {
  const id = randomUUID();
  const jumpNumber = jump.jumpNumber ?? nextJumpNumber(userId);
  const full = { ...jump, id, jumpNumber };
  insertStmt.run({
    id,
    user_id: userId,
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
export function listJumps(userId) {
  const rows = db
    .prepare("SELECT data FROM jumps WHERE user_id = ? ORDER BY start_time DESC")
    .all(userId);
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

export function getJump(id, userId) {
  const row = db.prepare("SELECT data FROM jumps WHERE id = ? AND user_id = ?").get(id, userId);
  return row ? JSON.parse(row.data) : null;
}

// full jumps incl. series — used by the stats aggregation (HR time-in-zone)
export function allJumpsFull(userId) {
  return db
    .prepare("SELECT data FROM jumps WHERE user_id = ? ORDER BY start_time ASC")
    .all(userId)
    .map((r) => JSON.parse(r.data));
}

// patch user-editable fields: jumpType, notes, jumpNumber, target {lat,lng}
export function updateJump(id, patch, userId) {
  const jump = getJump(id, userId);
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
       dropzone=@dz, target_lat=@tlat, target_lng=@tlng, data=@data WHERE id=@id AND user_id=@uid`
  ).run({
    id,
    uid: userId,
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

export function deleteJump(id, userId) {
  const r = db.prepare("DELETE FROM jumps WHERE id = ? AND user_id = ?").run(id, userId);
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
