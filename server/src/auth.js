import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { getMeta, setMeta, getUserById, getUserByApiKey } from "./db.js";

// ---- session secret (persisted in DB so restarts don't log everyone out) ----
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  let s = getMeta("session_secret");
  if (!s) { s = crypto.randomBytes(32).toString("hex"); setMeta("session_secret", s); }
  return s;
}

// ---- password hashing (scrypt, no native deps) ----
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
export function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(pw, salt, 64);
  const ref = Buffer.from(hash, "hex");
  return test.length === ref.length && crypto.timingSafeEqual(test, ref);
}

// ---- signed session token (HMAC), stored in an httpOnly cookie ----
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
export function signToken(uid, days = 30) {
  const payload = { uid, exp: Date.now() + days * 86400000 };
  const body = b64(payload);
  const sig = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload.uid;
  } catch { return null; }
}

// ---- cookies ----
const COOKIE = "bs_session";
export function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie",
    `${COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${30 * 86400}; SameSite=Lax${secure}`);
}
export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}
function readCookie(req, name) {
  const h = req.headers.cookie;
  if (!h) return null;
  for (const part of h.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

// ---- Google ID-token verification ----
export function googleClientId() {
  return process.env.GOOGLE_CLIENT_ID || null;
}
let _gClient = null;
export async function verifyGoogleToken(idToken) {
  const cid = googleClientId();
  if (!cid) throw new Error("Google login is niet geconfigureerd op de server.");
  if (!_gClient) _gClient = new OAuth2Client(cid);
  const ticket = await _gClient.verifyIdToken({ idToken, audience: cid });
  const p = ticket.getPayload();
  return { sub: p.sub, email: p.email, name: p.name || p.email };
}

// ---- middleware: require a logged-in user (session cookie) OR a device API key ----
export function requireAuth(req, res, next) {
  // device API key (the watch can't do interactive login)
  const key = req.headers["x-api-key"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (key) {
    const user = getUserByApiKey(key);
    if (user) { req.userId = user.id; req.authVia = "apikey"; return next(); }
  }
  // session cookie
  const uid = verifyToken(readCookie(req, COOKIE));
  if (uid && getUserById(uid)) { req.userId = uid; req.authVia = "session"; return next(); }
  res.status(401).json({ error: "Niet ingelogd" });
}

export function currentUser(req) {
  const uid = verifyToken(readCookie(req, COOKIE));
  return uid ? getUserById(uid) : null;
}
