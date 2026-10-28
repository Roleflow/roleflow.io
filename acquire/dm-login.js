// One-time Instagram login for auto-DMs. The password never enters this module.

export const LOGIN_TTL_MS = 10 * 60 * 1000;

export function mintLoginToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashLoginToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(token || "")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function loginExpiry(now) {
  const start = now instanceof Date ? now : new Date(now);
  return new Date(start.getTime() + LOGIN_TTL_MS).toISOString();
}

export function loginLinkOpen(row, now) {
  if (!row || row.used_at) return false;
  const end = new Date(row.expires_at).getTime();
  const clock = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return Number.isFinite(end) && end > clock;
}

const RESERVED_HANDLES = new Set(["accounts", "direct", "explore", "reels", "stories", "p", "about"]);

export function connectStatusPatch(handle) {
  const ig = String(handle || "").trim().replace(/^@+/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(ig)) return null;
  if (RESERVED_HANDLES.has(ig.toLowerCase())) return null;
  return { ig_handle: ig, session_ready: true };
}

export function controlPatchIsSafe(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
  const keys = Object.keys(patch);
  if (!keys.length || keys.some((key) => key !== "ig_handle" && key !== "session_ready")) return false;
  if (typeof patch.session_ready !== "boolean") return false;
  if (!(patch.ig_handle === null || typeof patch.ig_handle === "string")) return false;
  return true;
}

export function disconnectStatusPatch() {
  return { ig_handle: null, session_ready: false };
}

const SECRET_KEY = /password|passwd|pwd/i;

export function sessionStateForDisk(state) {
  const scrub = (value, parentKey) => {
    if (Array.isArray(value)) {
      return value.map((item) => scrub(item, parentKey)).filter((item) => item !== undefined);
    }
    if (!value || typeof value !== "object") return value;
    const named = String(value.name || "");
    if ((parentKey === "cookies" || parentKey === "localStorage" || parentKey === "sessionStorage") && SECRET_KEY.test(named)) {
      return undefined;
    }
    const out = {};
    Object.entries(value).forEach(([key, item]) => {
      if (SECRET_KEY.test(key)) return;
      const next = scrub(item, key);
      if (next !== undefined) out[key] = next;
    });
    return out;
  };
  const source = state && typeof state === "object" ? JSON.parse(JSON.stringify(state)) : { cookies: [], origins: [] };
  return scrub(source, "");
}

export function sessionCookiePresent(state) {
  const cookies = state && Array.isArray(state.cookies) ? state.cookies : [];
  return cookies.some((cookie) => cookie && cookie.name === "sessionid" && String(cookie.value || "").length > 0);
}

export function loginSettled(cookies, pageUrl) {
  if (!sessionCookiePresent({ cookies })) return false;
  return !/challenge|checkpoint|two_factor|codeentry|auth_platform|accounts\/login/i.test(String(pageUrl || ""));
}

export function forwardClientMessage(message) {
  if (!message || typeof message !== "object") return null;
  if (message.method !== "Input.dispatchKeyEvent" && message.method !== "Input.dispatchMouseEvent" && message.method !== "Input.insertText") return null;
  return { method: message.method, params: message.params || {} };
}

export function mayLogClientMessage(message) {
  return forwardClientMessage(message) == null;
}

export function handleFromProfileUrl(url) {
  const match = String(url || "").match(/instagram\.com\/([A-Za-z0-9._]{1,30})\/?/);
  if (!match) return "";
  if (RESERVED_HANDLES.has(match[1].toLowerCase())) return "";
  return match[1];
}

export function handleFromUsernameField(value) {
  const ig = String(value || "").trim().replace(/^@+/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(ig)) return "";
  if (RESERVED_HANDLES.has(ig.toLowerCase())) return "";
  return ig;
}

export function handleFromAnchors(hrefs) {
  const counts = new Map();
  for (const href of hrefs || []) {
    const match = String(href || "").match(/^\/([A-Za-z0-9._]{1,30})\/?$/);
    if (!match || RESERVED_HANDLES.has(match[1].toLowerCase())) continue;
    counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

export function workspaceIdOk(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""));
}

function publicOrigin(origin) {
  let parsed;
  try { parsed = new URL(String(origin || "")); } catch (_error) { return ""; }
  const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) return "";
  if (parsed.username || parsed.password) return "";
  return parsed.origin;
}

export function loginUrl(origin, token) {
  const base = publicOrigin(origin);
  if (!base || !/^[a-f0-9]{64}$/.test(String(token || ""))) return "";
  return base + "/login/" + token;
}

export function disconnectUrl(origin, token) {
  const base = publicOrigin(origin);
  if (!base || !/^[a-f0-9]{64}$/.test(String(token || ""))) return "";
  return base + "/disconnect/" + token;
}
