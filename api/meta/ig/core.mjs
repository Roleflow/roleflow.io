// Instagram API with Instagram Login.
// Nothing here calls Instagram. Callers pass fetch, and only when the app is on.

import { createHmac, timingSafeEqual } from "node:crypto";

export const REDIRECT_URI = "https://www.roleflow.io/api/meta/ig/callback";
export const DEFAULT_CHANNEL = "tailor" + "talk";
export const GRAPH_VERSION = "v23.0";
export const SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
  "instagram_business_content_publish"
];
export const WEBHOOK_FIELDS = ["messages", "comments", "messaging_postbacks"];
export const REFRESH_WITHIN_MS = 14 * 24 * 60 * 60 * 1000;
export const STATE_TTL_MS = 15 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function igReady(env = {}) {
  return truthy(env.META_IG_ENABLED)
    && String(env.META_IG_APP_ID || "").trim().length > 0
    && String(env.META_IG_APP_SECRET || "").trim().length >= 8;
}

export function tokenKey(env = {}) {
  const key = String(env.META_IG_TOKEN_KEY || env.META_TOKEN_KEY || "");
  return key.length >= 16 ? key : "";
}

export function graphVersion(env = {}) {
  const value = String(env.META_IG_GRAPH_VERSION || GRAPH_VERSION).trim();
  return /^v\d+\.\d+$/.test(value) ? value : GRAPH_VERSION;
}

export function redirectUri(env = {}) {
  const value = String(env.META_IG_REDIRECT_URI || REDIRECT_URI).trim();
  if (value !== REDIRECT_URI && !value.startsWith("https://www.roleflow.io/api/meta/ig/callback")) return REDIRECT_URI;
  return value;
}

export function authorizeUrl({ appId, redirectUri: redirect, state, scopes = SCOPES }) {
  const params = new URLSearchParams({
    client_id: String(appId || ""),
    redirect_uri: String(redirect || REDIRECT_URI),
    response_type: "code",
    scope: scopes.join(","),
    state: String(state || "")
  });
  return "https://www.instagram.com/oauth/authorize?" + params.toString();
}

export function signState(payload, secret) {
  const body = base64url(Buffer.from(JSON.stringify({
    business_id: payload.business_id,
    nonce: payload.nonce,
    exp: payload.exp
  })));
  const sig = base64url(createHmac("sha256", String(secret || "")).update(body).digest());
  return body + "." + sig;
}

export function verifyState(state, secret, now = Date.now()) {
  const parts = String(state || "").split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = base64url(createHmac("sha256", String(secret || "")).update(body).digest());
  if (!same(sig, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(base64urlDecode(body)).toString("utf8"));
  } catch (_error) {
    return null;
  }
  if (!payload || !UUID.test(payload.business_id) || !payload.nonce || !payload.exp) return null;
  if (Number(payload.exp) < now) return null;
  if (!/^[a-z0-9]{16,80}$/i.test(payload.nonce)) return null;
  return { business_id: payload.business_id, nonce: payload.nonce, exp: Number(payload.exp) };
}

export function needsRefresh(expiresAt, now = Date.now()) {
  const exp = new Date(expiresAt).getTime();
  if (!Number.isFinite(exp)) return false;
  return exp - now <= REFRESH_WITHIN_MS;
}

export function sendCall({ version, recipientId, text }) {
  return {
    method: "POST",
    url: "https://graph.instagram.com/" + version + "/me/messages",
    body: {
      recipient: { id: String(recipientId) },
      message: { text: String(text || "").slice(0, 1000) }
    }
  };
}

export function outboxDecision(row, provider, ready) {
  if (!row || row.kind !== "message_lead_draft") return { action: "skip" };
  if (provider !== "meta" || ready !== true) return { action: "skip" };
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const text = String(payload.text || "").trim();
  const recipient = String(payload.recipient_id || payload.igsid || "").trim();
  const threadId = String(payload.thread_id || "").trim();
  if (!text) return { action: "fail", error: "The draft has no text." };
  if (recipient && /^\d{5,20}$/.test(recipient)) return { action: "send", recipient, text };
  if (UUID.test(threadId)) return { action: "lookup", threadId, text };
  return { action: "fail", error: "The draft has no Instagram recipient." };
}

export function verifyChallenge(query, expected) {
  const mode = String(query && (query["hub.mode"] || query.hub_mode) || "");
  const token = String(query && (query["hub.verify_token"] || query.hub_verify_token) || "");
  const challenge = String(query && (query["hub.challenge"] || query.hub_challenge) || "");
  if (mode !== "subscribe" || !expected || !challenge) return "";
  if (!same(token, String(expected))) return "";
  return challenge;
}

export function verifySignature(rawBody, header, secret) {
  const given = String(header || "").replace(/^sha256=/i, "");
  if (!given || !secret) return false;
  const expected = createHmac("sha256", String(secret)).update(String(rawBody || "")).digest("hex");
  return same(given, expected);
}

export function leadEvents(payload) {
  const events = [];
  const entries = payload && Array.isArray(payload.entry) ? payload.entry : [];
  entries.forEach((entry) => {
    const accountId = String(entry && entry.id || "");
    if (!accountId) return;
    (entry.messaging || []).forEach((item) => events.push(...messagingEvent(accountId, item)));
    (entry.changes || []).forEach((change) => {
      const row = commentEvent(accountId, change);
      if (row) events.push(row);
    });
  });
  return events;
}

export function parseSignedRequest(signed, secret) {
  const parts = String(signed || "").split(".");
  if (parts.length !== 2 || !secret) return null;
  const [encodedSig, payload] = parts;
  const expected = createHmac("sha256", String(secret)).update(payload).digest();
  const given = base64urlDecode(encodedSig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(base64urlDecode(payload)).toString("utf8"));
    const userId = String(data && (data.user_id || data.userId) || "");
    if (!/^\d{5,20}$/.test(userId)) return null;
    return { user_id: userId };
  } catch (_error) {
    return null;
  }
}

export function deletionStatusBody(row) {
  if (!row || !row.status) return { ok: false };
  return { ok: true, status: row.status, received_at: row.received_at || null };
}

function messagingEvent(accountId, item) {
  if (!item || item.message && item.message.is_echo) return [];
  const sender = String(item.sender && item.sender.id || "");
  if (!sender || sender === accountId) return [];
  const sentAt = stamp(item.timestamp);
  if (item.message) {
    const body = String(item.message.text || "").trim();
    const externalId = String(item.message.mid || "");
    if (!body || !externalId) return [];
    return [eventRow(accountId, sender, externalId, body, "message", sentAt)];
  }
  if (item.postback) {
    const body = String(item.postback.title || item.postback.payload || "").trim();
    const externalId = String(item.postback.mid || "postback:" + sender + ":" + (item.timestamp || body.slice(0, 24)));
    if (!body) return [];
    return [eventRow(accountId, sender, externalId, body, "postback", sentAt)];
  }
  return [];
}

function commentEvent(accountId, change) {
  if (!change || String(change.field || "") !== "comments") return null;
  const value = change.value || {};
  const from = value.from || {};
  const sender = String(from.id || "");
  if (!sender || sender === accountId) return null;
  const body = String(value.text || "").trim();
  const externalId = String(value.id || "");
  if (!body || !externalId) return null;
  return eventRow(accountId, sender, externalId, body, "comment", null, String(from.username || ""));
}

function eventRow(accountId, sender, externalId, body, kind, sentAt, username) {
  return {
    account_id: accountId,
    external_id: "ig:" + sender,
    message_id: externalId.slice(0, 180),
    body: body.slice(0, 4000),
    kind,
    sent_at: sentAt,
    username: String(username || "").replace(/^@/, "").toLowerCase().slice(0, 30)
  };
}

function stamp(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const ms = raw < 1e12 ? raw * 1000 : raw;
  return new Date(ms).toISOString();
}

function truthy(value) {
  return ["true", "1", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function same(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecode(text) {
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  return Buffer.from(String(text || "").replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}
