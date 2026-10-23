import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

export const CALLBACK_URL = "https://roleflow.io/app/instagram/callback";
export const LOGO_URL = "https://roleflow.io/assets/logo.jpg";
export const API_BASE = "https://zernio.com/api/v1";
const STATE_MS = 20 * 60 * 1000;

function authHeaders(apiKey) {
  return { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" };
}

function sameHex(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function signWebhook(raw, secret) {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

export function verifyWebhook(raw, header, secret) {
  if (!secret || !header) return false;
  return sameHex(signWebhook(raw, secret), String(header).trim().toLowerCase());
}

export function safeWebhookError(error) {
  const name = error && error.name ? String(error.name) : "Error";
  const message = String((error && error.message) || "unknown")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]")
    .slice(0, 160);
  return name + ": " + message;
}

export function signState(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  return body + "." + sig;
}

export function verifyState(token, secret, now) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !secret) return { ok: false };
  const expected = createHmac("sha256", secret).update(parts[0]).digest("hex");
  if (!sameHex(expected, parts[1])) return { ok: false };
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch (_error) {
    return { ok: false };
  }
  const businessId = String(payload.b || "");
  const nonce = String(payload.n || "");
  const exp = Number(payload.e);
  if (!/^[0-9a-f-]{36}$/i.test(businessId) || !nonce || !Number.isFinite(exp) || exp < now) return { ok: false };
  return { ok: true, businessId, nonce };
}

export function profileBody(business) {
  const name = String(business.name || "Roleflow").replace(/[\r\n]+/g, " ").trim().slice(0, 80) || "Roleflow";
  return { name, externalId: business.id };
}

export function profileIdFrom(payload) {
  const profile = payload && payload.profile;
  return String((profile && (profile._id || profile.id)) || (payload && (payload._id || payload.id)) || "");
}

export function connectQuery({ profileId, state }) {
  const redirect = CALLBACK_URL + "?state=" + encodeURIComponent(state);
  // welcome=false skips the vendor welcome page. logoUrl is rejected unless that page is on.
  return {
    profileId,
    redirect_url: redirect,
    scopes: "messaging,comments",
    welcome: "false"
  };
}

export function instagramAuthUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch (_error) {
    return "";
  }
  if (url.protocol !== "https:") return "";
  if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return "";
  return url.toString();
}

export function callbackFailure(params) {
  const error = String(params.get("error") || "");
  if (!error) return "";
  const reason = String(params.get("platform_error_reason") || "");
  if (error === "oauth_denied" || reason === "user_denied" || reason === "access_denied") {
    return "Instagram didn't allow the connection. You can try again from the panel.";
  }
  return "Instagram didn't finish connecting. You can try again from the panel.";
}

export async function startConnect(input) {
  const apiKey = String(input.apiKey || "");
  if (!apiKey) return { configured: false };
  const secret = String(input.webhookSecret || apiKey);
  const now = input.now || Date.now();
  const nonce = input.nonce || randomBytes(16).toString("hex");
  let profileId = String(input.existingProfileId || "");
  const fetchImpl = input.fetchImpl;
  if (!profileId) {
    const listed = await fetchImpl(API_BASE + "/profiles?externalId=" + encodeURIComponent(input.business.id), {
      headers: authHeaders(apiKey)
    });
    const list = await listed.json().catch(() => ({}));
    const profiles = Array.isArray(list.profiles) ? list.profiles : [];
    const found = profiles.find((profile) => String(profile.externalId || "") === String(input.business.id));
    profileId = found ? profileIdFrom(found) : "";
  }
  if (!profileId) {
    const created = await fetchImpl(API_BASE + "/profiles", {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify(profileBody(input.business))
    });
    const payload = await created.json().catch(() => ({}));
    const existing = String((payload.details && payload.details.existingProfileId) || "");
    if (created.status === 409 && existing) profileId = existing;
    else if (!created.ok) return { configured: true, error: "Instagram connect could not start." };
    else profileId = profileIdFrom(payload);
    if (!profileId) return { configured: true, error: "Instagram connect could not start." };
  }
  const state = signState({ b: input.business.id, e: now + STATE_MS, n: nonce }, secret);
  const query = connectQuery({ profileId, state, logoUrl: input.logoUrl });
  const response = await fetchImpl(API_BASE + "/connect/instagram?" + new URLSearchParams(query).toString(), {
    headers: authHeaders(apiKey)
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 402) {
    return { configured: true, profileId, error: "Instagram connect needs a billing update before it can continue." };
  }
  if (!response.ok) return { configured: true, profileId, error: "Instagram connect could not start." };
  const authUrl = instagramAuthUrl(payload.authUrl);
  if (!authUrl) return { configured: true, profileId, error: "Instagram connect could not start." };
  return { configured: true, authUrl, profileId, state, nonce, expiresAt: new Date(now + STATE_MS).toISOString() };
}

export function normalizeEvent(payload, headerEventId) {
  const body = payload && typeof payload === "object" ? payload : {};
  const id = String(body.id || headerEventId || "");
  const event = String(body.event || "");
  const account = body.account || {};
  const accountId = String(account.accountId || account.id || "");
  const profileId = String(account.profileId || "");
  if (event === "message.received") {
    const message = body.message || {};
    return {
      id,
      event,
      accountId,
      profileId,
      conversationId: String(message.conversationId || (body.conversation && body.conversation.id) || ""),
      text: String(message.text || "").slice(0, 4000),
      senderId: String((message.sender && message.sender.id) || ""),
      username: String((message.sender && message.sender.username) || ""),
      externalId: String(message.id || id),
      standby: Boolean((body.metadata && body.metadata.standby) || (message.metadata && message.metadata.standby)),
      kind: "message"
    };
  }
  if (event === "message.sent") {
    const message = body.message || {};
    const recipient = String((message.recipient && message.recipient.id) || "");
    if (!recipient || recipient === accountId) {
      return { id, event, accountId, profileId, ignored: true, standby: false, kind: "" };
    }
    return {
      id,
      event,
      accountId,
      profileId,
      conversationId: String(message.conversationId || (body.conversation && body.conversation.id) || ""),
      text: String(message.text || "").slice(0, 4000),
      senderId: recipient,
      username: String((message.recipient && message.recipient.username) || ""),
      externalId: "out:" + String(message.id || id),
      standby: false,
      kind: "sent"
    };
  }
  if (event === "comment.received") {
    const comment = body.comment || {};
    const author = comment.author || comment.from || {};
    return {
      id,
      event,
      accountId,
      profileId,
      postId: String(comment.postId || comment.mediaId || (comment.post && comment.post.id) || ""),
      commentId: String(comment.id || comment.commentId || ""),
      text: String(comment.text || comment.message || "").slice(0, 4000),
      senderId: String(author.id || ""),
      username: String(author.username || ""),
      externalId: "comment:" + String(comment.id || comment.commentId || id),
      conversationId: "",
      standby: false,
      kind: "comment"
    };
  }
  return { id, event, accountId, profileId, ignored: true, standby: false, kind: "" };
}

export function shouldEnqueue(event, flags) {
  if (!event || event.ignored || event.standby || event.kind === "sent") return false;
  if (!flags || flags.systemEnabled !== true) return false;
  if (event.event === "comment.received") return flags.commentToDm === true && Boolean(event.commentId && event.postId && event.senderId);
  if (event.event === "message.received") return Boolean(event.senderId && event.conversationId);
  return false;
}

export function outboxKind(event) {
  return event && event.event === "comment.received" ? "comment_private" : "reply";
}

export function sendRequest(row) {
  const payload = row.payload || {};
  const text = String(payload.text || "");
  const accountId = String(payload.accountId || "");
  if (row.kind === "comment_private") {
    return {
      path: "/inbox/comments/" + encodeURIComponent(payload.postId || "") + "/" + encodeURIComponent(payload.commentId || "") + "/private-reply",
      body: { accountId, message: text }
    };
  }
  const body = { accountId };
  if (text.trim()) body.message = text;
  const attachmentUrl = String(payload.attachmentUrl || "");
  if (attachmentUrl.startsWith("https://")) {
    body.attachmentUrl = attachmentUrl;
    const type = String(payload.attachmentType || "audio");
    body.attachmentType = ["image", "video", "audio", "file"].includes(type) ? type : "audio";
  }
  if (!body.message && !body.attachmentUrl) body.message = text;
  return {
    path: "/inbox/conversations/" + encodeURIComponent(payload.conversationId || "") + "/messages",
    body
  };
}

export function interpretSend(status, payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const nested = body.error && typeof body.error === "object" ? body.error : {};
  const code = String(body.code || nested.code || (typeof body.error === "string" ? body.error : "") || "");
  if (status === 409 && code === "not_thread_owner") {
    return { ok: false, status: "not_thread_owner", error: "Another app owns this Instagram thread." };
  }
  if (status >= 200 && status < 300) return { ok: true, status: "sent", error: "" };
  return { ok: false, status: "failed", error: "The reply was not sent." };
}

export function gatewayConfigFrom(env, row) {
  const stored = row && typeof row === "object" ? row : {};
  const source = env || {};
  return {
    apiKey: String(source.ZERNIO_API_KEY || stored.api_key || ""),
    webhookSecret: String(source.ZERNIO_WEBHOOK_SECRET || stored.webhook_secret || "")
  };
}

export function readWebhookHeaders(headers) {
  const get = (name) => {
    if (!headers) return "";
    if (typeof headers.get === "function") return String(headers.get(name) || "");
    const found = Object.keys(headers).find((key) => key.toLowerCase() === name);
    return found ? String(headers[found] || "") : "";
  };
  return {
    signature: get("x-zernio-signature") || get("x-late-signature"),
    eventId: get("x-zernio-event-id")
  };
}

export function idempotencyKey(eventId) {
  return ("gw:" + String(eventId || "")).slice(0, 180);
}

export function enqueueBody(event, text, conversationRowId) {
  return {
    text: String(text || "").slice(0, 1000),
    accountId: String((event && event.accountId) || ""),
    conversationId: String((event && event.conversationId) || ""),
    conversationRowId: String(conversationRowId || ""),
    postId: String((event && event.postId) || ""),
    commentId: String((event && event.commentId) || ""),
    eventKind: String((event && event.kind) || "message")
  };
}

export function planPayload(event, conversationRowId) {
  return {
    ...enqueueBody(event, "", conversationRowId),
    needsPlan: true,
    inbound: String((event && event.text) || "").slice(0, 4000)
  };
}

export function replyText(plan) {
  if (!plan || plan.noResponse) return "";
  return (plan.bubbles || []).map((item) => String(item || "").trim()).filter(Boolean).join("\n\n").slice(0, 1000);
}

export function outboxWriteStatus(result) {
  if (result && result.status === "sent") return { status: "done", last_error: null };
  if (result && result.status === "not_thread_owner") {
    return { status: "not_thread_owner", last_error: result.error || "Another app owns this Instagram thread." };
  }
  return { status: "failed", last_error: (result && result.error) || "The reply was not sent." };
}

export async function planGatewayReply({ thread, eventKind, text, llm, now }) {
  const { planTurn } = await import("../roleflow-acquisition/ig/engine.js");
  const at = now || Date.now();
  const current = thread || {};
  return planTurn({
    thread: {
      ...current,
      lastUserMessageAt: current.lastUserMessageAt || new Date(at).toISOString()
    },
    eventKind: eventKind || "message",
    kind: "ai",
    dnc: false,
    now: at,
    llm: () => llm({ text, state: current.state || "" })
  });
}

export async function handleWebhook(input) {
  if (!input.secret) return { status: 401, body: { ok: false, error: "Not configured." } };
  if (!verifyWebhook(input.raw, input.signature, input.secret)) return { status: 401, body: { ok: false, error: "Invalid signature." } };
  let payload;
  try { payload = JSON.parse(input.raw); } catch (_error) { return { status: 400, body: { ok: false, error: "JSON required." } }; }
  const event = normalizeEvent(payload, input.eventId);
  if (!event.id) return { status: 400, body: { ok: false, error: "Missing event id." } };
  if (event.ignored) {
    await input.remember(event);
    return { status: 200, body: { ok: true, ignored: true } };
  }
  const account = await input.lookupAccount(event.accountId);
  if (!account) {
    await input.remember(event);
    return { status: 200, body: { ok: true, ignored: true } };
  }
  if (await input.seen(event.id)) return { status: 200, body: { ok: true, duplicate: true } };
  const queued = shouldEnqueue(event, account);
  try {
    await input.ingest({ event, account, queued, kind: queued ? outboxKind(event) : "" });
  } catch (error) {
    if (input.forget) await input.forget(event.id);
    throw error;
  }
  return { status: 200, body: { ok: true, queued } };
}
