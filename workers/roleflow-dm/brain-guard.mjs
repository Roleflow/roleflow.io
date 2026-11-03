// Send gate for the outreacher. A claim is used once. Text is never shortened.

import { normalizeHandle } from "../../acquire/auto-dm.js";

const PRICE = /(?:\$|€|£)\s?\d|\b\d+\s?%|\bcommission\b|\bcomisi[oó]n\b|\bprecio\b|\bprice\b/i;
export const DM_TEXT_LIMIT = 1000;

export function sendingMode({ env, config }) {
  const source = config || {};
  const controls = source.controls || {};
  const settings = source.settings || {};
  const outreach = source.outreacher || {};
  const workforce = source.workforce || {};
  const liveEnv = String(env && env.ROLEFLOW_DM_LIVE || "") === "1";
  if (source.halt === true || controls.killed === true || String(env && env.ROLEFLOW_DM_KILL || "") === "1") return "off";
  if (controls.enabled !== true) return "off";
  if (controls.paused === true || settings.ig_paused === true || settings.system_enabled !== true) return "off";
  if (workforce.active !== true) return "off";
  if (source.machine && source.machine.status && source.machine.status !== "running" && source.machine.status !== "awaiting_login") return "off";
  if (!liveEnv || outreach.dry_run !== false) return "dry_run";
  return "live";
}

export function messageSendable(text) {
  if (typeof text !== "string" || text.length === 0 || !text.trim()) return { ok: false, reason: "empty" };
  if (text.length > DM_TEXT_LIMIT) return { ok: false, reason: "will_not_truncate" };
  if (PRICE.test(text)) return { ok: false, reason: "price" };
  return { ok: true, text };
}

export function claimStillFresh(claim, now) {
  if (!claim || !claim.claim_id || !claim.expires_at) return false;
  const expires = new Date(claim.expires_at).getTime();
  const clock = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return Number.isFinite(expires) && expires > clock;
}

export async function authorizeAction(api, input) {
  const claim = await api.claim({ kind: input.kind, target: input.target });
  if (!claim || claim.ok !== true || !claim.claim_id) {
    return { ok: false, reason: claim && (claim.reason || claim.error) || "claim_failed" };
  }
  return { ok: true, claim_id: claim.claim_id, expires_at: claim.expires_at || "" };
}

export async function recheckClaim(api, claim, now) {
  if (!claimStillFresh(claim, now)) return { ok: false, reason: "claim_expired" };
  const again = await api.claimCheck({ claim_id: claim.claim_id });
  if (!again || again.ok !== true) return { ok: false, reason: again && (again.reason || again.error) || "claim_failed" };
  return { ok: true, claim_id: claim.claim_id };
}

export async function typeAndMaybeSend(ui, input) {
  const check = messageSendable(input.text);
  if (!check.ok) return { ok: false, reason: check.reason, clicked: false };
  if (!input.claim || input.claim.ok !== true) return { ok: false, reason: "claim", clicked: false };
  await ui.typeAll(input.text);
  const composer = await ui.readComposer();
  if (composer !== input.text) return { ok: false, reason: "composer_mismatch", clicked: false };
  const again = await input.recheck();
  if (!again || again.ok !== true) return { ok: false, reason: again && again.reason || "claim_failed", clicked: false };
  if (input.live !== true) return { ok: true, reason: "dry_run", body: input.text, clicked: false };
  await ui.clickSend();
  const bubble = await ui.readLastBubble();
  if (bubble !== input.text) return { ok: false, reason: "bubble_mismatch", body: input.text, clicked: true };
  return { ok: true, reason: "sent", body: input.text, clicked: true };
}

export async function performClaimed(api, input) {
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  const claim = await authorizeAction(api, { kind: input.kind, target: input.target });
  if (!claim.ok) return { ok: false, reason: claim.reason, clicked: false };
  const again = await recheckClaim(api, claim, now);
  if (!again.ok) return { ok: false, reason: again.reason, clicked: false };
  const result = await input.run();
  await api.report({
    claim_id: claim.claim_id,
    result: result && result.ok ? "sent" : "failed",
    handle: input.target,
    kind: input.kind,
    body: result && result.body || ""
  });
  return { ok: Boolean(result && result.ok), reason: result && result.reason || "done", claim_id: claim.claim_id };
}

export function sameHandle(left, right) {
  return normalizeHandle(left) === normalizeHandle(right) && normalizeHandle(left) !== "";
}

export const SECRET_LOG_KEYS = new Set([
  "access_token",
  "refresh_token",
  "token",
  "bootstrap_token",
  "proxy_url",
  "backup_key",
  "volume_key",
  "serverArg",
  "password"
]);

export function publicLog(entry) {
  const out = {};
  for (const [key, value] of Object.entries(entry || {})) {
    if (SECRET_LOG_KEYS.has(key)) continue;
    if (typeof value === "string" && /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)) continue;
    out[key] = value;
  }
  return out;
}
