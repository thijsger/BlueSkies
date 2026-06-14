// API base: same origin (the Node server serves this dashboard). Override with
// ?api=https://my-api.onrender.com when hosting the dashboard separately.
const params = new URLSearchParams(location.search);
export const API = (params.get("api") || "").replace(/\/$/, "");

async function j(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { const e = await res.json(); detail = e.detail || e.error || detail; } catch {}
    throw new Error(detail);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  listJumps: () => j("GET", "/api/jumps"),
  getJump: (id) => j("GET", `/api/jumps/${id}`),
  updateJump: (id, patch) => j("PATCH", `/api/jumps/${id}`, patch),
  deleteJump: (id) => j("DELETE", `/api/jumps/${id}`),
  stats: () => j("GET", "/api/stats"),
  uploadFit: async (file, meta = {}) => {
    const fd = new FormData();
    fd.append("file", file);
    if (meta.jumpType) fd.append("jumpType", meta.jumpType);
    if (meta.notes) fd.append("notes", meta.notes);
    const res = await fetch(API + "/api/jumps/upload", { method: "POST", body: fd });
    if (!res.ok) {
      let detail = res.statusText;
      try { const e = await res.json(); detail = e.detail || e.error || detail; } catch {}
      throw new Error(detail);
    }
    return res.json();
  },
};
