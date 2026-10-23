// HTTP for Roleflow's Instagram Login.
// With META_IG_ENABLED off, or without the app id and secret, these routes do not call Instagram.

import { decryptToken, encryptToken } from "./crypto.mjs";
import {
  DEFAULT_CHANNEL,
  REDIRECT_URI,
  STATE_TTL_MS,
  authorizeUrl,
  deletionStatusBody,
  graphVersion,
  igReady,
  leadEvents,
  needsRefresh,
  outboxDecision,
  parseSignedRequest,
  redirectUri,
  sendCall,
  signState,
  tokenKey,
  verifyChallenge,
  verifySignature,
  verifyState
} from "./core.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function routeStart(req, res, deps) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  if (!igReady(deps.env)) return send(res, 503, { error: "Instagram Login is off." });
  const body = await readBody(req);
  const businessId = String(body.business_id || "");
  if (!UUID.test(businessId)) return send(res, 400, { error: "business_id must be a UUID." });
  const user = await deps.db.userFromBearer(bearer(req));
  if (!user) return send(res, 401, { error: "Sign in to connect Instagram." });
  if (!(await deps.db.canEdit(businessId, user.id))) return send(res, 403, { error: "You can't edit this business." });
  const nonce = deps.nonce ? deps.nonce() : randomNonce();
  const exp = (deps.now ? deps.now() : Date.now()) + STATE_TTL_MS;
  const state = signState({ business_id: businessId, nonce, exp }, deps.env.META_IG_APP_SECRET);
  await deps.db.saveState({ nonce, businessId, userId: user.id, expiresAt: new Date(exp).toISOString() });
  const url = authorizeUrl({
    appId: deps.env.META_IG_APP_ID,
    redirectUri: redirectUri(deps.env),
    state
  });
  return send(res, 200, { ok: true, url });
}

export async function routeCallback(req, res, deps) {
  const query = req.query || {};
  const businessHint = "";
  if (!igReady(deps.env)) return redirect(res, businessHint, "Instagram Login is off.");
  if (query.error) return redirect(res, businessHint, "Instagram did not connect.");
  const parsed = verifyState(query.state, deps.env.META_IG_APP_SECRET, deps.now ? deps.now() : Date.now());
  if (!parsed) return redirect(res, businessHint, "Instagram connect expired. Try again.");
  const row = await deps.db.takeState(parsed.nonce);
  if (!row || row.business_id !== parsed.business_id) return redirect(res, parsed.business_id, "Instagram connect expired. Try again.");
  const key = tokenKey(deps.env);
  if (!key) return redirect(res, parsed.business_id, "Instagram Login is off.");
  const redirectTo = redirectUri(deps.env);
  const short = await postForm(deps.fetch, "https://api.instagram.com/oauth/access_token", {
    client_id: deps.env.META_IG_APP_ID,
    client_secret: deps.env.META_IG_APP_SECRET,
    grant_type: "authorization_code",
    redirect_uri: redirectTo,
    code: String(query.code || "")
  });
  if (!short.ok || !short.json.access_token) return redirect(res, parsed.business_id, "Instagram did not return a token.");
  const longUrl = "https://graph.instagram.com/access_token?" + new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: deps.env.META_IG_APP_SECRET,
    access_token: short.json.access_token
  });
  const long = await getJson(deps.fetch, longUrl);
  const access = long.ok && long.json.access_token ? long.json.access_token : short.json.access_token;
  const expiresIn = Number(long.json && long.json.expires_in) || 60 * 60;
  const profileUrl = "https://graph.instagram.com/" + graphVersion(deps.env) + "/me?fields=user_id,username";
  const profile = await getJson(deps.fetch, profileUrl, access);
  const igUserId = String(profile.json && (profile.json.user_id || profile.json.id) || short.json.user_id || "");
  const username = String(profile.json && profile.json.username || "").replace(/^@/, "").slice(0, 30);
  const cipher = await encryptToken(access, key);
  await deps.db.putToken(parsed.business_id, cipher);
  await deps.db.upsertConnection({
    business_id: parsed.business_id,
    ig_user_id: igUserId || null,
    username: username || null,
    expires_at: new Date((deps.now ? deps.now() : Date.now()) + expiresIn * 1000).toISOString(),
    scopes: grantedScopes(short.json, long.json),
    status: "connected",
    last_error: null,
    connected_at: new Date(deps.now ? deps.now() : Date.now()).toISOString()
  });
  await deps.db.setChannel(parsed.business_id, "meta");
  return redirect(res, parsed.business_id, "");
}

export async function routeDisconnect(req, res, deps) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const body = await readBody(req);
  const businessId = String(body.business_id || "");
  if (!UUID.test(businessId)) return send(res, 400, { error: "business_id must be a UUID." });
  const user = await deps.db.userFromBearer(bearer(req));
  if (!user) return send(res, 401, { error: "Sign in to disconnect Instagram." });
  if (!(await deps.db.canEdit(businessId, user.id))) return send(res, 403, { error: "You can't edit this business." });
  await deps.db.deleteToken(businessId);
  await deps.db.disconnect(businessId);
  await deps.db.setChannel(businessId, DEFAULT_CHANNEL);
  return send(res, 200, { ok: true, status: "disconnected" });
}

export async function routeWebhook(req, res, deps) {
  if (req.method === "GET") {
    if (!igReady(deps.env)) return text(res, 403, "off");
    const challenge = verifyChallenge(req.query || {}, deps.env.META_VERIFY_TOKEN);
    if (!challenge) return text(res, 403, "forbidden");
    return text(res, 200, challenge);
  }
  if (req.method !== "POST") return send(res, 405, { error: "Use GET or POST." });
  if (!igReady(deps.env)) return send(res, 403, { error: "Instagram Login is off." });
  const raw = await rawBody(req);
  if (!verifySignature(raw, header(req, "x-hub-signature-256"), deps.env.META_IG_APP_SECRET)) {
    return send(res, 403, { error: "Signature did not match." });
  }
  let payload = {};
  try {
    payload = JSON.parse(raw || "{}");
  } catch (_error) {
    return send(res, 400, { error: "JSON object required." });
  }
  const events = leadEvents(payload);
  let stored = 0;
  for (const event of events) {
    const connection = await deps.db.connectionByIgUser(event.account_id);
    if (!connection || connection.status !== "connected") continue;
    await deps.db.upsertLead({
      business_id: connection.business_id,
      external_id: event.external_id,
      username: event.username,
      message_id: event.message_id,
      body: event.body,
      kind: event.kind,
      sent_at: event.sent_at
    });
    stored += 1;
  }
  return send(res, 200, { ok: true, stored });
}

export async function routeRefresh(req, res, deps) {
  if (req.method !== "POST" && req.method !== "GET") return send(res, 405, { error: "Use GET or POST." });
  if (!(await cronOk(req, deps))) return send(res, 401, { error: "Unauthorized." });
  if (!igReady(deps.env)) return send(res, 200, { ok: true, result: "off", refreshed: 0, sent: 0 });
  const refreshed = await refreshDue(deps);
  const sent = await drainOutbox(deps);
  return send(res, 200, { ok: true, result: "ok", refreshed, sent });
}

export async function routeOutbox(req, res, deps) {
  if (req.method !== "POST" && req.method !== "GET") return send(res, 405, { error: "Use GET or POST." });
  if (!(await cronOk(req, deps))) return send(res, 401, { error: "Unauthorized." });
  if (!igReady(deps.env)) return send(res, 200, { ok: true, result: "off", sent: 0 });
  const sent = await drainOutbox(deps);
  return send(res, 200, { ok: true, result: "ok", sent });
}

export async function routeDeletion(req, res, deps) {
  if (req.method === "GET") {
    const code = String((req.query && req.query.code) || "");
    const row = code ? await deps.db.deletionStatus(code) : null;
    return send(res, 200, deletionStatusBody(row));
  }
  if (req.method !== "POST") return send(res, 405, { error: "Use GET or POST." });
  if (!igReady(deps.env)) return send(res, 503, { error: "Instagram Login is off." });
  const body = await readBody(req);
  const signed = String(body.signed_request || "");
  const data = parseSignedRequest(signed, deps.env.META_IG_APP_SECRET);
  if (!data) return send(res, 400, { error: "Invalid signed_request." });
  const code = (deps.nonce ? deps.nonce() : randomNonce()).slice(0, 12);
  const result = await deps.db.recordDeletion({ code, igUserId: data.user_id });
  return send(res, 200, {
    url: "https://www.roleflow.io/data-deletion/?code=" + encodeURIComponent(code),
    confirmation_code: code,
    status: result && result.status || "completed"
  });
}

async function refreshDue(deps) {
  const key = tokenKey(deps.env);
  if (!key) return 0;
  const now = deps.now ? deps.now() : Date.now();
  const rows = await deps.db.listRefresh(new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString());
  let count = 0;
  for (const row of rows || []) {
    if (!needsRefresh(row.expires_at, now)) continue;
    const stored = await deps.db.readToken(row.business_id);
    let access = "";
    try {
      access = await decryptToken(stored, key);
    } catch (_error) {
      await deps.db.touchConnection(row.business_id, { last_error: "Stored token is unreadable." });
      continue;
    }
    const url = "https://graph.instagram.com/refresh_access_token?" + new URLSearchParams({
      grant_type: "ig_refresh_token",
      access_token: access
    });
    const refreshed = await getJson(deps.fetch, url);
    if (!refreshed.ok || !refreshed.json.access_token) {
      await deps.db.touchConnection(row.business_id, { status: "error", last_error: "Instagram did not refresh the token." });
      continue;
    }
    const cipher = await encryptToken(refreshed.json.access_token, key);
    await deps.db.putToken(row.business_id, cipher);
    const expiresIn = Number(refreshed.json.expires_in) || 60 * 24 * 60 * 60;
    await deps.db.touchConnection(row.business_id, {
      status: "connected",
      last_error: null,
      expires_at: new Date(now + expiresIn * 1000).toISOString()
    });
    count += 1;
  }
  return count;
}

async function drainOutbox(deps) {
  const ready = igReady(deps.env);
  const key = tokenKey(deps.env);
  const rows = await deps.db.pendingDrafts();
  let sent = 0;
  for (const row of rows || []) {
    const provider = await deps.db.channel(row.business_id);
    const decision = outboxDecision(row, provider, ready);
    if (decision.action === "skip") continue;
    if (decision.action === "fail") {
      await deps.db.markOutbox(row.id, "failed", decision.error);
      continue;
    }
    let recipient = decision.recipient;
    if (decision.action === "lookup") {
      recipient = await deps.db.threadRecipient(row.business_id, decision.threadId);
      if (!/^\d{5,20}$/.test(String(recipient || ""))) {
        await deps.db.markOutbox(row.id, "failed", "The draft has no Instagram recipient.");
        continue;
      }
    }
    if (!key) {
      await deps.db.markOutbox(row.id, "failed", "Instagram Login is off.");
      continue;
    }
    const stored = await deps.db.readToken(row.business_id);
    let access = "";
    try {
      access = stored ? await decryptToken(stored, key) : "";
    } catch (_error) {
      access = "";
    }
    if (!access) {
      await deps.db.markOutbox(row.id, "failed", "Instagram is not connected.");
      continue;
    }
    const call = sendCall({ version: graphVersion(deps.env), recipientId: recipient, text: decision.text });
    const response = await deps.fetch(call.url, {
      method: call.method,
      headers: { Authorization: "Bearer " + access, "Content-Type": "application/json" },
      body: JSON.stringify(call.body)
    });
    if (!response.ok) {
      await deps.db.markOutbox(row.id, "failed", "Instagram did not accept the message.");
      continue;
    }
    await deps.db.markOutbox(row.id, "applied", null);
    sent += 1;
  }
  return sent;
}

async function cronOk(req, deps) {
  const secrets = await deps.db.cronSecrets();
  const headerValue = bearer(req);
  return secrets.some((secret) => sameText(headerValue, secret));
}

async function postForm(fetchImpl, url, fields) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields)
  });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, json: json || {} };
}

async function getJson(fetchImpl, url, token) {
  const headers = token ? { Authorization: "Bearer " + token } : {};
  const response = await fetchImpl(url, { headers });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, json: json || {} };
}

function grantedScopes(short, long) {
  const list = short && (short.permissions || short.scopes) || long && (long.permissions || long.scopes);
  if (Array.isArray(list) && list.length) return list.join(",");
  return "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish";
}

function redirect(res, businessId, message) {
  const next = new URL("https://www.roleflow.io/account/acquisition/");
  if (businessId) next.searchParams.set("business", businessId);
  next.hash = "integrations";
  if (message) next.searchParams.set("notice", message.slice(0, 180));
  res.statusCode = 302;
  if (typeof res.setHeader === "function") res.setHeader("Location", next.toString());
  if (typeof res.end === "function") res.end();
  res.body = { location: next.toString() };
  return res.body;
}

function bearer(req) {
  const value = header(req, "authorization");
  return value.replace(/^Bearer\s+/i, "").trim();
}

function header(req, name) {
  const headers = req.headers || {};
  const found = headers[name] || headers[name.toLowerCase()] || "";
  return Array.isArray(found) ? String(found[0] || "") : String(found || "");
}

function sameText(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (!a.length || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Buffer.from(bytes).toString("hex");
}

async function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const raw = await rawBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_error) {
    const params = new URLSearchParams(raw);
    return Object.fromEntries(params.entries());
  }
}

async function rawBody(req) {
  if (typeof req.rawBody === "string") return req.rawBody;
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (typeof req[Symbol.asyncIterator] !== "function") return "";
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return "";
  return Buffer.concat(chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))).toString("utf8");
}

function send(res, status, body) {
  res.statusCode = status;
  if (typeof res.status === "function") res.status(status);
  if (typeof res.json === "function") res.json(body);
  else res.body = body;
  return body;
}

function text(res, status, body) {
  res.statusCode = status;
  if (typeof res.setHeader === "function") res.setHeader("Content-Type", "text/plain; charset=utf-8");
  if (typeof res.status === "function") res.status(status);
  if (typeof res.end === "function") res.end(body);
  res.body = body;
  return body;
}

export { REDIRECT_URI };
