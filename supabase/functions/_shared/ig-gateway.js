import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { trimToSentence } from "./split-reply.js";

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
  if (!/^[0-9a-f-]{36}$/i.test(businessId) || !nonce || !Number.isFinite(exp)) return { ok: false };
  if (exp < now) return { ok: false, businessId };
  return { ok: true, businessId, nonce };
}

async function listedProfileId(fetchImpl, apiKey, businessId) {
  const listed = await fetchImpl(API_BASE + "/profiles?externalId=" + encodeURIComponent(businessId), {
    headers: authHeaders(apiKey)
  });
  const list = await listed.json().catch(() => ({}));
  const profiles = Array.isArray(list.profiles) ? list.profiles : [];
  const found = profiles.find((profile) => profile && String(profile.externalId || "") === String(businessId));
  return found ? profileIdFrom(found) : "";
}

async function ownedProfileId(fetchImpl, apiKey, profileId, businessId) {
  const id = String(profileId || "");
  if (!id) return "";
  const response = await fetchImpl(API_BASE + "/profiles/" + encodeURIComponent(id), {
    headers: authHeaders(apiKey)
  });
  if (!response.ok) return "";
  const payload = await response.json().catch(() => ({}));
  const profile = payload && payload.profile ? payload.profile : payload;
  if (!profile || String(profile.externalId || "") !== String(businessId)) return "";
  return profileIdFrom(profile) || id;
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
  // welcome=false skips the hosted welcome screen. brandName, logoUrl, and
  // welcomeTheme only apply with welcome=true, and that screen stays
  // co-branded: it keeps a Zernio mark. Headless mode is for a selection step.
  // The default Instagram login has none, and Instagram's own consent screen
  // still names the Zernio app. There is no white-label flag for that screen.
  // The browser is only given an instagram.com URL.
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

const AUTH_FIELDS = ["authUrl", "auth_url", "url", "redirectUrl", "redirect_url", "authorizationUrl", "authorization_url"];

export function authCandidates(payload) {
  const bodies = [];
  if (payload && typeof payload === "object") {
    bodies.push(payload);
    if (payload.data && typeof payload.data === "object") bodies.push(payload.data);
    if (payload.result && typeof payload.result === "object") bodies.push(payload.result);
  }
  const found = [];
  bodies.forEach((body) => {
    AUTH_FIELDS.forEach((field) => {
      const value = body[field];
      if (typeof value === "string" && value) found.push(value);
    });
  });
  return found;
}

export async function resolveInstagramAuth(fetchImpl, value) {
  let current = String(value || "");
  for (let hop = 0; hop < 4; hop += 1) {
    const direct = instagramAuthUrl(current);
    if (direct) return direct;
    let url;
    try { url = new URL(current); } catch (_error) { return ""; }
    if (url.protocol !== "https:") return "";
    const response = await fetchImpl(current, { method: "GET", redirect: "manual" });
    const headers = response && response.headers;
    const location = headers && (typeof headers.get === "function" ? headers.get("location") : headers.location);
    if (!location) return "";
    current = new URL(location, current).toString();
  }
  return instagramAuthUrl(current);
}

export function connectFailure(status, payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const text = [body.code, body.error, body.message, body.detail].filter((item) => typeof item === "string").join(" ").toLowerCase();
  if (status === 402 || /payment|billing/.test(text)) return "Instagram connect needs a billing update before it can continue.";
  if (status === 401 || status === 403) return "Instagram connect is not available yet.";
  if (/redirect|callback|whitelist|not allowed|uri/.test(text)) return "Instagram connect needs its return address allowed before it can open. Try again after that is saved.";
  return "Instagram connect could not start.";
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
  const fetchImpl = input.fetchImpl;
  const businessId = String(input.business && input.business.id || "");
  // A stored id or a 409 id is used only when that profile's external id is
  // this business. Another business's profile, including the first workspace,
  // is never attached here.
  let profileId = await listedProfileId(fetchImpl, apiKey, businessId);
  if (!profileId && input.existingProfileId) {
    profileId = await ownedProfileId(fetchImpl, apiKey, input.existingProfileId, businessId);
  }
  if (!profileId) {
    const created = await fetchImpl(API_BASE + "/profiles", {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify(profileBody(input.business))
    });
    const payload = await created.json().catch(() => ({}));
    if (created.status === 409) {
      profileId = await listedProfileId(fetchImpl, apiKey, businessId);
      if (!profileId) {
        profileId = await ownedProfileId(
          fetchImpl,
          apiKey,
          payload.details && payload.details.existingProfileId,
          businessId
        );
      }
      if (!profileId) return { configured: true, error: "Instagram connect could not start." };
    } else if (!created.ok) return { configured: true, error: "Instagram connect could not start." };
    else {
      profileId = profileIdFrom(payload);
      if (!profileId) return { configured: true, error: "Instagram connect could not start." };
    }
  }
  const state = signState({ b: input.business.id, e: now + STATE_MS, n: nonce }, secret);
  const query = connectQuery({ profileId, state, logoUrl: input.logoUrl });
  const response = await fetchImpl(API_BASE + "/connect/instagram?" + new URLSearchParams(query).toString(), {
    headers: authHeaders(apiKey)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { configured: true, profileId, error: connectFailure(response.status, payload) };
  let authUrl = "";
  for (const candidate of authCandidates(payload)) {
    authUrl = await resolveInstagramAuth(fetchImpl, candidate);
    if (authUrl) break;
  }
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
      commentedAt: String(comment.createdAt || comment.created_at || comment.timestamp || body.timestamp || ""),
      standby: false,
      kind: "comment"
    };
  }
  return { id, event, accountId, profileId, ignored: true, standby: false, kind: "" };
}

export function shouldEnqueue(event, flags) {
  if (!event || event.ignored || event.standby || event.kind === "sent") return false;
  const setterOn = Boolean(flags && flags.setterOn === true);
  const workspaceOn = Boolean(flags && flags.systemEnabled === true);
  if (!setterOn && !workspaceOn) return false;
  if (event.event === "comment.received") {
    const allowed = flags.commentToDm === true || flags.commentVoice === true;
    return allowed && Boolean(event.commentId && event.postId && event.senderId);
  }
  if (event.event === "message.received") return Boolean(event.senderId && event.conversationId);
  return false;
}

export function privateReplyKind(kind) {
  return kind === "comment_private" || kind === "comment_voice";
}

export function outboxKind(event, flags) {
  if (event && event.event === "comment.received") {
    return flags && flags.commentVoice === true ? "comment_voice" : "comment_private";
  }
  return "reply";
}

export function sendRequest(row) {
  const payload = row.payload || {};
  const text = String(payload.text || "");
  const accountId = String(payload.accountId || "");
  if (privateReplyKind(row.kind)) {
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
    text: trimToSentence(text, 1000),
    accountId: String((event && event.accountId) || ""),
    conversationId: String((event && event.conversationId) || ""),
    conversationRowId: String(conversationRowId || ""),
    postId: String((event && event.postId) || ""),
    commentId: String((event && event.commentId) || ""),
    eventKind: String((event && event.kind) || "message"),
    ...(event && event.commentedAt ? { commentedAt: String(event.commentedAt) } : {})
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
  return (plan.bubbles || []).map((item) => String(item || "").trim()).filter(Boolean).join("\n\n");
}

export function outboxWriteStatus(result) {
  if (result && result.status === "blocked") return { status: "blocked", last_error: result.error || "The agent is off." };
  if (result && result.status === "sent") return { status: "done", last_error: null };
  if (result && result.status === "not_thread_owner") {
    return { status: "not_thread_owner", last_error: result.error || "Another app owns this Instagram thread." };
  }
  return { status: "failed", last_error: (result && result.error) || "The reply was not sent." };
}

export async function planGatewayReply({ thread, eventKind, text, llm, now, booking }) {
  const { planTurn } = await import("../roleflow-acquisition/ig/engine.js");
  const at = now || Date.now();
  const current = thread || {};
  const policy = booking || { qualifyBeforeBook: false, required: [], slots: [], confirmation: "", reminder: "", link: "" };
  return planTurn({
    thread: {
      ...current,
      lastUserMessageAt: current.lastUserMessageAt || new Date(at).toISOString()
    },
    eventKind: eventKind || "message",
    kind: "ai",
    dnc: false,
    now: at,
    booking: policy,
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
    await input.ingest({ event, account, queued, kind: queued ? outboxKind(event, account) : "" });
  } catch (error) {
    if (input.forget) await input.forget(event.id);
    throw error;
  }
  return { status: 200, body: { ok: true, queued } };
}
