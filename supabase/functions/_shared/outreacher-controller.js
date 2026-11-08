// Controller transport and worker-session checks.
// A hosted custom channel answers with an empty 202 before its handler runs.
// That response is acceptance only. It is not browser confirmation.
// Nothing in this file turns message sending on.

import { MACHINE_JWT_TTL_MS, randomToken } from "./outreacher-token.js";

export const CHANNEL_URL = /^https:\/\/[a-z0-9.-]+(?::[0-9]+)?(?:\/[a-z0-9-]+)?\/v1\/channels\/[a-z0-9_-]+\/[a-z0-9_-]+$/;
export const BACKOFF_S = Object.freeze([60, 300, 900, 1800]);

const CURRENT_DESKTOP_UNAVAILABLE = true;

export function planDelivery(input) {
  const command = input && input.command;
  const route = input && input.route;
  const now = input && input.now ? new Date(input.now).getTime() : Date.now();
  if (!command) return closed("needs_setup");
  if (command.test_only === true) return closed("test_only");
  if (CURRENT_DESKTOP_UNAVAILABLE && (!input || input.desktopAvailable !== true)) return closed("unsupported");
  if (command.status === "accepted" || command.status === "acknowledged" || command.status === "observed") {
    return closed("already_accepted");
  }
  if (command.expires_at && Date.parse(command.expires_at) <= now) return closed("expired");
  if (!route || route.enabled !== true || !input.secretPresent) return closed("needs_setup");
  if (route.desktop_capability !== "reported" || route.proxy_mode !== "process_binding") return closed("unsupported");
  const url = String(route.channel_url || "");
  if (!CHANNEL_URL.test(url)) return closed("needs_setup");
  if (Number(command.attempt_count || 0) >= 5) return closed("failed");
  if (command.next_attempt_at && Date.parse(command.next_attempt_at) > now) return closed("backoff");
  return {
    deliver: true,
    reason: "ready",
    url,
    body: {
      id: command.id,
      business_id: command.business_id,
      profile_id: command.profile_id,
      worker_id: command.worker_id,
      proxy_id: command.proxy_id,
      operation: command.operation,
      workflow_version: command.workflow_version,
      payload: command.payload,
      expires_at: command.expires_at,
      signature: command.signature
    }
  };
}

export function interpretTransport(response) {
  const status = response && Number(response.status);
  if (!response || !status) return { status: "queued", retry: true, reason: "no_response", observed: false };
  if (status === 202) return { status: "accepted", retry: false, reason: "accepted", observed: false };
  if (status === 401 || status === 403) return { status: "needs_setup", retry: false, reason: "unauthorized", observed: false };
  if (status === 408 || status === 429 || status >= 500) return { status: "queued", retry: true, reason: "transport", observed: false };
  return { status: "failed", retry: false, reason: "unexpected_status", observed: false };
}

export function nextAttempt(attempt, nowMs) {
  const index = Math.max(0, Number(attempt || 1) - 1);
  const wait = BACKOFF_S[Math.min(index, BACKOFF_S.length - 1)];
  return new Date(Number(nowMs) + wait * 1000).toISOString();
}

export async function deliverCommand(input) {
  const plan = planDelivery(input);
  if (!plan.deliver) return { ok: false, fetched: false, reason: plan.reason, status: input.command && input.command.status };
  if (!input || typeof input.fetchImpl !== "function" || !input.token) {
    return { ok: false, fetched: false, reason: "needs_setup", status: input.command.status };
  }
  let response;
  try {
    response = await input.fetchImpl(plan.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Agent-Alias-Token": input.token,
        "X-BDK-Session-Key": "cmd-" + plan.body.id
      },
      body: JSON.stringify(plan.body)
    });
  } catch {
    response = null;
  }
  const interpreted = interpretTransport(response);
  const command = { ...input.command, attempt_count: Number(input.command.attempt_count || 0) + (interpreted.retry ? 1 : 0) };
  command.status = interpreted.status;
  if (interpreted.status === "accepted") command.accepted_at = new Date(input.now || Date.now()).toISOString();
  if (interpreted.retry) command.next_attempt_at = nextAttempt(command.attempt_count, input.now || Date.now());
  if (interpreted.reason === "failed" || interpreted.status === "failed") command.last_error = interpreted.reason;
  return { ok: interpreted.status === "accepted", fetched: true, reason: interpreted.reason, status: command.status, command, observed: false };
}

export async function signWorkerJwt(claims, privateKeyPem, nowMs) {
  if (!privateKeyPem) throw new Error("missing_worker_jwt_secret");
  const now = Math.floor(Number(nowMs) / 1000);
  const payload = {
    iss: "roleflow-outreacher",
    aud: "authenticated",
    role: "outreacher_worker",
    sub: claims.worker_id,
    worker_id: claims.worker_id,
    jti: claims.jti || randomToken(16),
    iat: now,
    exp: now + Math.floor(MACHINE_JWT_TTL_MS / 1000)
  };
  const header = b64urlJson({ alg: "ES256", typ: "JWT", kid: "outreacher-worker-1" });
  const body = b64urlJson(payload);
  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(header + "." + body));
  return { token: header + "." + body + "." + b64url(new Uint8Array(signature)), claims: payload };
}

export async function readWorkerJwt(token, publicKeyPem, nowMs) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || !publicKeyPem) return { ok: false, reason: "unauthorized" };
  let header;
  let claims;
  try {
    header = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
  } catch {
    return { ok: false, reason: "unauthorized" };
  }
  if (!header || header.alg !== "ES256" || header.kid !== "outreacher-worker-1") return { ok: false, reason: "unauthorized" };
  const key = await importPublicKey(publicKeyPem);
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    fromB64url(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1])
  );
  if (!valid) return { ok: false, reason: "unauthorized" };
  const now = Math.floor(Number(nowMs) / 1000);
  if (!claims || claims.role !== "outreacher_worker" || claims.iss !== "roleflow-outreacher" || claims.aud !== "authenticated") {
    return { ok: false, reason: "unauthorized" };
  }
  if (!claims.worker_id || claims.sub !== claims.worker_id || claims.business_id) return { ok: false, reason: "unauthorized" };
  if (!claims.exp || claims.exp <= now || claims.exp - claims.iat !== Math.floor(MACHINE_JWT_TTL_MS / 1000)) {
    return { ok: false, reason: "unauthorized" };
  }
  return { ok: true, claims };
}

function closed(reason) {
  return { deliver: false, reason, observed: false };
}

function b64url(bytes) {
  const view = typeof bytes === "string" ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  let binary = "";
  view.forEach((part) => { binary += String.fromCharCode(part); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlJson(value) {
  return b64url(JSON.stringify(value));
}

function fromB64url(text) {
  const padded = String(text || "").replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(text || "").length + 3) % 4);
  const binary = atob(padded);
  return new Uint8Array([...binary].map((char) => char.charCodeAt(0)));
}

function pemToBytes(pem) {
  const body = String(pem || "").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return fromB64url(body.replace(/\+/g, "-").replace(/\//g, "_"));
}

async function importPrivateKey(pem) {
  return crypto.subtle.importKey("pkcs8", pemToBytes(pem), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function importPublicKey(pem) {
  return crypto.subtle.importKey("spki", pemToBytes(pem), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
}
