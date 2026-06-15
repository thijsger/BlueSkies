import express from "express";
import {
  createUser, getUserByEmail, getUserByGoogleSub, getUserById,
  linkGoogle, regenerateApiKey, userCount, claimOrphanJumps,
} from "../db.js";
import {
  hashPassword, verifyPassword, signToken, setSessionCookie, clearSessionCookie,
  verifyGoogleToken, googleClientId, currentUser,
} from "../auth.js";

const router = express.Router();

const safeUser = (u) => ({ id: u.id, email: u.email, name: u.name, apiKey: u.api_key });

// simple in-memory rate limiter (per IP) for the auth endpoints
const attempts = new Map(); // ip -> [timestamps]
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || req.socket?.remoteAddress || "?";
    const now = Date.now();
    const arr = (attempts.get(ip) || []).filter((tms) => now - tms < windowMs);
    if (arr.length >= max) {
      return res.status(429).json({ error: "Too many attempts. Please wait a moment and try again.", code: "rate_limited" });
    }
    arr.push(now);
    attempts.set(ip, arr);
    if (attempts.size > 5000) attempts.clear(); // crude cap
    next();
  };
}
// 12 attempts per 10 minutes per IP on the auth surface
const authLimit = rateLimit(12, 10 * 60 * 1000);

function loginResponse(res, user) {
  // first ever user inherits any pre-auth jumps
  if (userCount() === 1) claimOrphanJumps(user.id);
  setSessionCookie(res, signToken(user.id));
  res.json({ user: safeUser(user) });
}

// public config for the frontend (Google client id is public)
router.get("/auth/config", (_req, res) => {
  res.json({ googleClientId: googleClientId() });
});

// who am I
router.get("/auth/me", (req, res) => {
  const u = currentUser(req);
  res.json({ user: u ? safeUser(u) : null });
});

// register with email + password
router.post("/auth/register", authLimit, (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required.", code: "email_password_required" });
  if (String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters.", code: "password_too_short" });
  const norm = String(email).trim().toLowerCase();
  if (getUserByEmail(norm)) return res.status(409).json({ error: "An account with this email already exists.", code: "email_taken" });
  const user = createUser({ email: norm, name: name || norm.split("@")[0], passwordHash: hashPassword(password) });
  loginResponse(res, user);
});

// login with email + password
router.post("/auth/login", authLimit, (req, res) => {
  const { email, password } = req.body || {};
  const norm = String(email || "").trim().toLowerCase();
  const user = getUserByEmail(norm);
  if (!user || !verifyPassword(password || "", user.password_hash)) {
    return res.status(401).json({ error: "Incorrect email or password.", code: "bad_credentials" });
  }
  loginResponse(res, user);
});

// login / register with a Google ID token
router.post("/auth/google", authLimit, async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: "No Google token received.", code: "google_failed" });
    const g = await verifyGoogleToken(credential);
    let user = getUserByGoogleSub(g.sub) || getUserByEmail(g.email);
    if (!user) {
      user = createUser({ email: g.email, name: g.name, googleSub: g.sub });
    } else if (!user.google_sub) {
      linkGoogle(user.id, g.sub);
    }
    loginResponse(res, user);
  } catch (err) {
    res.status(401).json({ error: "Google sign-in failed.", code: "google_failed" });
  }
});

router.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// rotate the watch/device API key
router.post("/auth/apikey/regenerate", (req, res) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: "Niet ingelogd" });
  res.json({ apiKey: regenerateApiKey(u.id) });
});

export default router;
