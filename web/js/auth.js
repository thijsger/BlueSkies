import { API } from "./api.js";

async function j(method, path, body) {
  const res = await fetch(API + path, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export const auth = {
  me: () => j("GET", "/api/auth/me"),
  config: () => j("GET", "/api/auth/config"),
  register: (email, password, name) => j("POST", "/api/auth/register", { email, password, name }),
  login: (email, password) => j("POST", "/api/auth/login", { email, password }),
  google: (credential) => j("POST", "/api/auth/google", { credential }),
  logout: () => j("POST", "/api/auth/logout"),
  regenerateKey: () => j("POST", "/api/auth/apikey/regenerate"),
};
