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
router.post("/auth/register", (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "E-mail en wachtwoord verplicht." });
  if (String(password).length < 8) return res.status(400).json({ error: "Wachtwoord moet minstens 8 tekens zijn." });
  const norm = String(email).trim().toLowerCase();
  if (getUserByEmail(norm)) return res.status(409).json({ error: "Er bestaat al een account met dit e-mailadres." });
  const user = createUser({ email: norm, name: name || norm.split("@")[0], passwordHash: hashPassword(password) });
  loginResponse(res, user);
});

// login with email + password
router.post("/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const norm = String(email || "").trim().toLowerCase();
  const user = getUserByEmail(norm);
  if (!user || !verifyPassword(password || "", user.password_hash)) {
    return res.status(401).json({ error: "Onjuist e-mailadres of wachtwoord." });
  }
  loginResponse(res, user);
});

// login / register with a Google ID token
router.post("/auth/google", async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: "Geen Google-token ontvangen." });
    const g = await verifyGoogleToken(credential);
    let user = getUserByGoogleSub(g.sub) || getUserByEmail(g.email);
    if (!user) {
      user = createUser({ email: g.email, name: g.name, googleSub: g.sub });
    } else if (!user.google_sub) {
      linkGoogle(user.id, g.sub);
    }
    loginResponse(res, user);
  } catch (err) {
    res.status(401).json({ error: "Google-login mislukt: " + String(err.message || err) });
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
