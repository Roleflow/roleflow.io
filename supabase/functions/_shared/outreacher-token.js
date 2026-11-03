// Shared token helpers for the outreacher.
// The image owner's acquisition-bot actions and the provisioner both import this.
// Hashes are SHA-256 hex, the same encoding as encode(digest(token, 'sha256'), 'hex').

export const BOOTSTRAP_TTL_MS = 15 * 60 * 1000;
export const MACHINE_JWT_TTL_MS = 60 * 60 * 1000;
export const LIVE_TICKET_TTL_MS = 10 * 60 * 1000;
export const CLAIM_TTL_MS = 2 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function tokenHash(token) {
  const bytes = new TextEncoder().encode(String(token || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function randomToken(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return [...buffer].map((part) => part.toString(16).padStart(2, "0")).join("");
}

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(message || "")));
  return [...new Uint8Array(sig)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function b64url(bytes) {
  const view = typeof bytes === "string" ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  let binary = "";
  view.forEach((part) => { binary += String.fromCharCode(part); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacBytes(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(message || ""))));
}

function b64urlJson(value) {
  return b64url(JSON.stringify(value));
}

function fromB64url(text) {
  const padded = String(text || "").replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(text || "").length + 3) % 4);
  const binary = atob(padded);
  return new Uint8Array([...binary].map((char) => char.charCodeAt(0)));
}

export async function signMachineJwt(claims, secret, nowMs) {
  if (!secret) throw new Error("missing_machine_jwt_secret");
  const now = Math.floor(Number(nowMs) / 1000);
  const payload = {
    iss: "roleflow-outreacher",
    aud: "authenticated",
    role: "outreacher",
    sub: claims.machine_id,
    business_id: claims.business_id,
    machine_id: claims.machine_id,
    jti: claims.jti || randomToken(16),
    iat: now,
    exp: now + Math.floor(MACHINE_JWT_TTL_MS / 1000)
  };
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const body = b64urlJson(payload);
  const sig = b64url(await hmacBytes(secret, header + "." + body));
  return { token: header + "." + body + "." + sig, claims: payload };
}

export async function readMachineJwt(token, secret, nowMs) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || !secret) return { ok: false, reason: "unauthorized" };
  const expected = b64url(await hmacBytes(secret, parts[0] + "." + parts[1]));
  if (!timingSafeEqual(expected, parts[2])) return { ok: false, reason: "unauthorized" };
  let claims;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
  } catch {
    return { ok: false, reason: "unauthorized" };
  }
  const now = Math.floor(Number(nowMs) / 1000);
  if (!claims || claims.role !== "outreacher" || !claims.exp || claims.exp <= now) {
    return { ok: false, reason: "unauthorized" };
  }
  return { ok: true, claims };
}

// Allowed while the machine may still call Roleflow. Sends are a separate claim.
const MACHINE_CALL_STATUSES = new Set(["provisioning", "health_check", "ready", "paused"]);

export function authorizeMachineCall(claims, row, nowMs) {
  if (!claims || claims.role !== "outreacher") return { ok: false, reason: "unauthorized" };
  if (!row) return { ok: false, reason: "revoked" };
  if (String(claims.business_id || "") !== String(row.business_id || "")) return { ok: false, reason: "revoked" };
  if (String(claims.machine_id || "") !== String(row.id || "")) return { ok: false, reason: "revoked" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  if (row.status === "revoked" || row.status === "deleted" || row.status === "deleting") {
    return { ok: false, reason: "revoked" };
  }
  if (!MACHINE_CALL_STATUSES.has(row.status)) return { ok: false, reason: "status" };
  if (claims.exp && Number(claims.exp) * 1000 <= Number(nowMs)) return { ok: false, reason: "unauthorized" };
  return { ok: true, business_id: row.business_id, machine_id: row.id };
}

// Binding is checked at exchange time. The server id and address are recorded
// from the create-server response, after cloud-init was already written.
export function evaluateBootstrap({ hash, presentedHash, expiresAt, usedAt, boundServerId, boundIp, serverId, sourceIp, nowMs }) {
  if (!boundServerId || !boundIp) return { ok: false, reason: "binding_pending", status: 425 };
  if (!hash || !presentedHash || !timingSafeEqual(hash, presentedHash)) return { ok: false, reason: "unauthorized", status: 401 };
  if (String(serverId || "") !== String(boundServerId)) return { ok: false, reason: "unauthorized", status: 401 };
  if (String(sourceIp || "") !== String(boundIp)) return { ok: false, reason: "unauthorized", status: 401 };
  if (!expiresAt || Number(nowMs) >= Date.parse(expiresAt)) return { ok: false, reason: "expired", status: 401 };
  if (usedAt) return { ok: false, reason: "replay", status: 403, revoke: true };
  return { ok: true };
}

export function evaluateRefresh({ currentHash, previousHash, presentedHash, expiresAt, revokedAt, nowMs }) {
  if (revokedAt) return { ok: false, reason: "revoked", revoke: false };
  if (!presentedHash) return { ok: false, reason: "unauthorized" };
  if (previousHash && timingSafeEqual(previousHash, presentedHash) && !timingSafeEqual(currentHash, presentedHash)) {
    return { ok: false, reason: "refresh_reuse", revoke: true };
  }
  if (!currentHash || !timingSafeEqual(currentHash, presentedHash)) return { ok: false, reason: "unauthorized" };
  if (!expiresAt || Number(nowMs) >= Date.parse(expiresAt)) return { ok: false, reason: "expired" };
  return { ok: true };
}
