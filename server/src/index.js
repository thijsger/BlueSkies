import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jumpsRouter from "./routes/jumps.js";
import authRouter from "./routes/auth.js";

// NOTE: render.yaml sets rootDir=server, so only changes under server/ trigger a
// Render auto-deploy. Web-only changes won't redeploy on their own — bump this to
// force a deploy that ships the latest web/ too.
const BUILD = "2026-06-15.1";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// CORS: allow the dashboard origin. CORS_ORIGIN can be a comma-separated list,
// or "*" (default) for the bundled same-origin dashboard. credentials:true so
// the session cookie works (origin is reflected, never literal "*").
const origins = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim());
app.use(
  cors({
    origin: origins.includes("*") ? true : origins,
    credentials: true,
  })
);

// Live payloads can be a few hundred KB of columnar series data.
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, build: BUILD, ts: Date.now() }));

app.use("/api", authRouter);   // public auth endpoints
app.use("/api", jumpsRouter);  // jump/stats endpoints (require auth)

// Serve the web dashboard (static) from the same service.
// No-store on HTML/JS/CSS so the SPA always loads the latest code after a deploy
// (avoids stale cached modules); tiles/assets can still be cached by their CDN.
const webDir = process.env.WEB_DIR || path.join(__dirname, "..", "..", "web");
app.use(express.static(webDir, {
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/.test(filePath)) {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
    }
  },
}));
// SPA-ish fallback for non-API routes -> index.html
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(webDir, "index.html"));
});

// JSON error handler (multer / body parse errors etc.)
app.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: String(err.message || err) });
});

app.listen(PORT, () => {
  console.log(`Skydive backend listening on :${PORT}`);
  console.log(`Serving dashboard from ${webDir}`);
});
