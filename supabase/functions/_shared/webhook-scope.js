// Keeps the inbox webhook listening to every connected Instagram account.
// When a business connects an account, its id is appended to the account list of
// each existing webhook that points at our inbound function. It only ever adds
// ids: it never removes one, and never sends the url, events or secret back.

import { API_BASE } from "./ig-gateway.js";

export const SCOPE_EXCEPTION_KIND = "instagram_webhook";
export const SCOPE_EXCEPTION_COPY = "Instagram connected, but new messages may not reach the setter yet. Nothing was sent. Ask support to finish the connection.";

function normalizeUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "").toLowerCase();
}

export function inboundWebhookUrl(supabaseUrl) {
  const base = String(supabaseUrl || "").trim().replace(/\/+$/, "");
  return base ? base + "/functions/v1/zernio-webhook" : "";
}

export function hookId(hook) {
  return String((hook && (hook._id || hook.id || hook.webhookId)) || "");
}

export function matchingHooks(list, functionUrl) {
  const target = normalizeUrl(functionUrl);
  if (!target) return [];
  return (Array.isArray(list) ? list : []).filter((hook) => hook && normalizeUrl(hook.url) === target && hookId(hook));
}

// null when nothing has to change. An unscoped webhook already hears every account.
export function scopePatch(hook, accountId) {
  const id = String(accountId || "").trim();
  if (!hook || !id) return null;
  const accounts = Array.isArray(hook.accountIds) ? hook.accountIds.map(String) : [];
  if (!accounts.length) return null;
  if (accounts.includes(id)) return null;
  return { webhookId: hookId(hook), accountIds: [...accounts, id] };
}

// A webhook filtered by profile as well would still drop the new account.
export function profileScoped(hook) {
  return Boolean(hook && Array.isArray(hook.profileIds) && hook.profileIds.length);
}

async function call(fetchImpl, apiKey, method, body) {
  const response = await fetchImpl(API_BASE + "/webhooks/settings", {
    method,
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, payload };
}

export async function ensureWebhookScope({ apiKey, accountId, functionUrl, fetchImpl }) {
  const fetchFn = fetchImpl || fetch;
  const id = String(accountId || "").trim();
  if (!apiKey || !id || !functionUrl) return { ok: false, reason: "not_configured", changed: [] };
  try {
    const listed = await call(fetchFn, apiKey, "GET");
    if (!listed.ok) return { ok: false, reason: "list_failed", changed: [] };
    const hooks = matchingHooks(listed.payload && listed.payload.webhooks, functionUrl);
    if (!hooks.length) return { ok: false, reason: "no_webhook", changed: [] };
    const changed = [];
    let profileBlocked = false;
    for (const hook of hooks) {
      if (profileScoped(hook)) profileBlocked = true;
      const patch = scopePatch(hook, id);
      if (!patch) continue;
      const updated = await call(fetchFn, apiKey, "PUT", patch);
      if (!updated.ok) return { ok: false, reason: "update_failed", changed };
      changed.push(patch.webhookId);
    }
    if (changed.length) {
      const again = await call(fetchFn, apiKey, "GET");
      const fresh = matchingHooks(again.payload && again.payload.webhooks, functionUrl);
      const missing = fresh.some((hook) => scopePatch(hook, id));
      if (!again.ok || missing) return { ok: false, reason: "not_confirmed", changed };
    }
    if (profileBlocked) return { ok: false, reason: "profile_scoped", changed };
    return { ok: true, reason: changed.length ? "added" : "already_listed", changed };
  } catch (_error) {
    return { ok: false, reason: "request_failed", changed: [] };
  }
}
