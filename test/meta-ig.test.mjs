import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decryptToken, encryptToken } from "../api/meta/ig/crypto.mjs";
import {
  REDIRECT_URI,
  authorizeUrl,
  deletionStatusBody,
  igReady,
  leadEvents,
  needsRefresh,
  outboxDecision,
  parseSignedRequest,
  sendCall,
  signState,
  verifyChallenge,
  verifySignature,
  verifyState
} from "../api/meta/ig/core.mjs";
import { routeCallback, routeDeletion, routeDisconnect, routeOutbox, routeRefresh, routeStart, routeWebhook } from "../api/meta/ig/handlers.mjs";

const BUSINESS = "1351d2ac-79bb-545d-8da0-c49ecff28a47";
const USER = "11111111-1111-4111-8111-111111111111";
const SECRET = "app-secret-value";
const NOW = Date.parse("2026-10-23T12:00:00.000Z");

const ON = {
  META_IG_ENABLED: "true",
  META_IG_APP_ID: "178900000000000",
  META_IG_APP_SECRET: SECRET,
  META_VERIFY_TOKEN: "verify-token",
  META_IG_TOKEN_KEY: "0123456789abcdef"
};

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end(body) { if (body !== undefined) this.body = body; return this; }
  };
}

function memory(extra = {}) {
  const state = {
    saved: null,
    token: "",
    connection: null,
    channel: "tailortalk",
    leads: [],
    outbox: extra.outbox || [],
    marked: [],
    deletion: null
  };
  return {
    state,
    async userFromBearer(token) { return token === "user-token" ? { id: USER } : null; },
    async canEdit(businessId) { return businessId === BUSINESS; },
    async saveState(row) { state.saved = row; },
    async takeState(nonce) {
      if (!state.saved || state.saved.nonce !== nonce) return null;
      const row = { business_id: state.saved.businessId, expires_at: state.saved.expiresAt };
      state.saved = null;
      return row;
    },
    async putToken(_businessId, cipher) { state.token = cipher; },
    async readToken() { return state.token; },
    async deleteToken() { state.token = ""; },
    async upsertConnection(row) { state.connection = row; },
    async disconnect() { state.connection = { status: "disconnected", ig_user_id: null }; },
    async touchConnection(_id, patch) { state.connection = { ...(state.connection || {}), ...patch }; },
    async setChannel(_id, provider) { state.channel = provider; },
    async channel() { return state.channel; },
    async connectionByIgUser(id) { return state.connection && state.connection.ig_user_id === id ? state.connection : null; },
    async upsertLead(row) { state.leads.push(row); },
    async listRefresh() { return extra.refresh || []; },
    async pendingDrafts() { return state.outbox.filter((row) => row.status === "pending"); },
    async threadRecipient() { return "178900000000001"; },
    async markOutbox(id, status, error) { state.marked.push({ id, status, error }); },
    async cronSecrets() { return ["cron-secret"]; },
    async deletionStatus(code) { return state.deletion && state.deletion.code === code ? { status: "completed", received_at: "2026-10-23T12:00:00.000Z" } : null; },
    async recordDeletion(row) { state.deletion = row; return { status: "completed" }; }
  };
}

test("the app is inert until the flag and both credentials are set", () => {
  assert.equal(igReady({}), false);
  assert.equal(igReady({ META_IG_ENABLED: "true", META_IG_APP_ID: "1" }), false);
  assert.equal(igReady({ META_IG_APP_ID: "1789", META_IG_APP_SECRET: SECRET }), false);
  assert.equal(igReady(ON), true);
});

test("authorize uses Instagram Login, the Roleflow callback, and the four scopes", () => {
  const state = signState({ business_id: BUSINESS, nonce: "abc123def456ghij", exp: NOW + 60000 }, SECRET);
  const url = new URL(authorizeUrl({ appId: ON.META_IG_APP_ID, redirectUri: REDIRECT_URI, state }));
  assert.equal(url.origin + url.pathname, "https://www.instagram.com/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), ON.META_IG_APP_ID);
  assert.equal(url.searchParams.get("redirect_uri"), "https://www.roleflow.io/api/meta/ig/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.deepEqual(url.searchParams.get("scope").split(","), [
    "instagram_business_basic",
    "instagram_business_manage_messages",
    "instagram_business_manage_comments",
    "instagram_business_content_publish"
  ]);
  assert.deepEqual(verifyState(url.searchParams.get("state"), SECRET, NOW), {
    business_id: BUSINESS,
    nonce: "abc123def456ghij",
    exp: NOW + 60000
  });
  assert.equal(verifyState(url.searchParams.get("state") + "x", SECRET, NOW), null);
  assert.equal(verifyState(state, SECRET, NOW + 120000), null);
});

test("tokens encrypt and the send helper is only for a meta workspace", async () => {
  const cipher = await encryptToken("IGQV-long-lived-token", ON.META_IG_TOKEN_KEY);
  assert.equal(cipher.includes("IGQV-long-lived-token"), false);
  assert.equal(await decryptToken(cipher, ON.META_IG_TOKEN_KEY), "IGQV-long-lived-token");
  const call = sendCall({ version: "v23.0", recipientId: "178900000000001", text: "See you Thursday." });
  assert.equal(call.url, "https://graph.instagram.com/v23.0/me/messages");
  assert.deepEqual(call.body.recipient, { id: "178900000000001" });
  assert.equal(outboxDecision({ kind: "message_lead_draft", payload: { text: "Hi", recipient_id: "178900000000001" } }, "tailortalk", true).action, "skip");
  assert.equal(outboxDecision({ kind: "message_lead_draft", payload: { text: "Hi", recipient_id: "178900000000001" } }, "meta", false).action, "skip");
  assert.equal(outboxDecision({ kind: "message_lead_draft", payload: { text: "Hi", recipient_id: "178900000000001" } }, "meta", true).action, "send");
  assert.equal(needsRefresh(new Date(NOW + 50 * 24 * 60 * 60 * 1000).toISOString(), NOW), false);
  assert.equal(needsRefresh(new Date(NOW + 10 * 24 * 60 * 60 * 1000).toISOString(), NOW), true);
});

test("connect stays off and does not call Instagram", async () => {
  let called = 0;
  const res = response();
  await routeStart({ method: "POST", body: { business_id: BUSINESS }, headers: { authorization: "Bearer user-token" } }, res, {
    env: {},
    db: memory(),
    fetch: async () => { called += 1; return { ok: true, json: async () => ({}) }; },
    now: () => NOW
  });
  assert.equal(res.statusCode, 503);
  assert.equal(called, 0);
});

test("connect returns a signed Instagram URL and the callback stores a long-lived token", async () => {
  const db = memory();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("api.instagram.com/oauth/access_token")) {
      return { ok: true, json: async () => ({ access_token: "short-token", user_id: "178411111111111" }) };
    }
    if (String(url).includes("grant_type=ig_exchange_token")) {
      return { ok: true, json: async () => ({ access_token: "long-token", expires_in: 5184000 }) };
    }
    return { ok: true, json: async () => ({ user_id: "178411111111111", username: "roleflowdemo" }) };
  };
  const started = response();
  await routeStart({ method: "POST", body: { business_id: BUSINESS }, headers: { authorization: "Bearer user-token" } }, started, {
    env: ON, db, fetch: fetchImpl, now: () => NOW, nonce: () => "abc123def456ghij"
  });
  assert.equal(started.statusCode, 200);
  const url = new URL(started.body.url);
  assert.equal(url.origin, "https://www.instagram.com");
  const back = response();
  await routeCallback({ method: "GET", query: { code: "auth-code", state: url.searchParams.get("state") } }, back, {
    env: ON, db, fetch: fetchImpl, now: () => NOW
  });
  assert.equal(back.statusCode, 302);
  assert.equal(back.headers.Location.includes("long-token"), false);
  assert.equal(back.headers.Location.includes("short-token"), false);
  assert.equal(db.state.channel, "meta");
  assert.equal(db.state.connection.username, "roleflowdemo");
  assert.equal(db.state.connection.ig_user_id, "178411111111111");
  assert.equal(await decryptToken(db.state.token, ON.META_IG_TOKEN_KEY), "long-token");
  assert.equal(calls.some((item) => item.startsWith("https://api.instagram.com/oauth/access_token")), true);
  assert.equal(calls.some((item) => item.includes("ig_exchange_token")), true);
});

test("webhook verifies the token and stores a lead message, comment, and postback", async () => {
  const db = memory();
  db.state.connection = { business_id: BUSINESS, ig_user_id: "178411111111111", status: "connected" };
  const off = response();
  await routeWebhook({ method: "GET", query: { "hub.mode": "subscribe", "hub.verify_token": "verify-token", "hub.challenge": "challenge-1" } }, off, { env: {}, db });
  assert.equal(off.statusCode, 403);
  const handshake = response();
  await routeWebhook({ method: "GET", query: { "hub.mode": "subscribe", "hub.verify_token": "verify-token", "hub.challenge": "challenge-1" } }, handshake, { env: ON, db });
  assert.equal(handshake.body, "challenge-1");
  assert.equal(verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "challenge-1" }, "verify-token"), "");
  const payload = {
    entry: [{
      id: "178411111111111",
      messaging: [
        { sender: { id: "178411111111111" }, message: { mid: "echo", text: "our reply", is_echo: true } },
        { sender: { id: "178900000000001" }, timestamp: 1761206400, message: { mid: "m-1", text: "Can I book a call?" } },
        { sender: { id: "178900000000001" }, timestamp: 1761206401, postback: { mid: "p-1", title: "Book", payload: "BOOK" } }
      ],
      changes: [{ field: "comments", value: { id: "c-1", text: "What is the price?", from: { id: "178900000000002", username: "ada.coach" } } }]
    }]
  };
  const raw = JSON.stringify(payload);
  const signature = "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
  const bad = response();
  await routeWebhook({ method: "POST", rawBody: raw, headers: { "x-hub-signature-256": "sha256=00" } }, bad, { env: ON, db });
  assert.equal(bad.statusCode, 403);
  assert.equal(verifySignature(raw, signature, SECRET), true);
  const good = response();
  await routeWebhook({ method: "POST", rawBody: raw, headers: { "x-hub-signature-256": signature } }, good, { env: ON, db });
  assert.equal(good.body.stored, 3);
  assert.deepEqual(db.state.leads.map((row) => row.kind), ["message", "postback", "comment"]);
  assert.equal(db.state.leads.every((row) => row.message_id), true);
  const events = leadEvents(payload);
  assert.equal(events[0].external_id, "ig:178900000000001");
  assert.equal(events[2].username, "ada.coach");
});

test("the outbox sends only when the workspace channel is meta", async () => {
  const db = memory({
    outbox: [
      { id: "o-tailor", business_id: BUSINESS, kind: "message_lead_draft", status: "pending", payload: { text: "Leave this", recipient_id: "178900000000001" } },
      { id: "o-meta", business_id: BUSINESS, kind: "message_lead_draft", status: "pending", payload: { text: "See you Thursday.", thread_id: "22222222-2222-4222-8222-222222222222" } }
    ]
  });
  db.state.token = await encryptToken("long-token", ON.META_IG_TOKEN_KEY);
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), authorization: options && options.headers && options.headers.Authorization, body: options && options.body });
    return { ok: true, json: async () => ({ message_id: "sent-1" }) };
  };
  const skipped = response();
  await routeOutbox({ method: "POST", headers: { authorization: "Bearer cron-secret" } }, skipped, { env: ON, db, fetch: fetchImpl, now: () => NOW });
  assert.equal(skipped.body.sent, 0);
  assert.equal(calls.length, 0);
  db.state.channel = "meta";
  db.state.outbox = db.state.outbox.filter((row) => row.id === "o-meta");
  const sent = response();
  await routeOutbox({ method: "POST", headers: { authorization: "Bearer cron-secret" } }, sent, { env: ON, db, fetch: fetchImpl, now: () => NOW });
  assert.equal(sent.body.sent, 1);
  assert.equal(calls[0].url, "https://graph.instagram.com/v23.0/me/messages");
  assert.equal(calls[0].authorization, "Bearer long-token");
  assert.equal(JSON.parse(calls[0].body).message.text, "See you Thursday.");
  assert.equal(db.state.marked.some((row) => row.id === "o-meta" && row.status === "applied"), true);
  assert.equal(db.state.marked.some((row) => row.id === "o-tailor"), false);
});

test("refresh runs before the 60 day expiry and disconnect clears the local token", async () => {
  const db = memory({ refresh: [{ business_id: BUSINESS, expires_at: new Date(NOW + 5 * 24 * 60 * 60 * 1000).toISOString() }] });
  db.state.token = await encryptToken("long-token", ON.META_IG_TOKEN_KEY);
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => ({ access_token: "refreshed-token", expires_in: 5184000 }) };
  };
  const off = response();
  await routeRefresh({ method: "GET", headers: { authorization: "Bearer cron-secret" } }, off, { env: {}, db, fetch: fetchImpl, now: () => NOW });
  assert.equal(off.body.result, "off");
  assert.equal(urls.length, 0);
  const on = response();
  await routeRefresh({ method: "GET", headers: { authorization: "Bearer cron-secret" } }, on, { env: ON, db, fetch: fetchImpl, now: () => NOW });
  assert.equal(on.body.refreshed, 1);
  assert.equal(urls[0].includes("grant_type=ig_refresh_token"), true);
  assert.equal(on.body.access_token, undefined);
  assert.equal(await decryptToken(db.state.token, ON.META_IG_TOKEN_KEY), "refreshed-token");
  const gone = response();
  await routeDisconnect({ method: "POST", body: { business_id: BUSINESS }, headers: { authorization: "Bearer user-token" } }, gone, { env: {}, db, fetch: fetchImpl });
  assert.equal(gone.body.status, "disconnected");
  assert.equal(db.state.token, "");
  assert.equal(db.state.channel, "tailor" + "talk");
});

test("deletion checks a signature and the status body hides the Instagram user", async () => {
  const payload = base64url(Buffer.from(JSON.stringify({ user_id: "178900000000001" })));
  const sig = base64url(createHmac("sha256", SECRET).update(payload).digest());
  const db = memory();
  const res = response();
  await routeDeletion({ method: "POST", body: { signed_request: sig + "." + payload } }, res, { env: ON, db, nonce: () => "abc123def456" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user_id, undefined);
  assert.match(res.body.url, /^https:\/\/www\.roleflow\.io\/data-deletion\/\?code=/);
  assert.equal(deletionStatusBody({ status: "completed", received_at: "2026-10-23T12:00:00.000Z", user_id: "178900000000001" }).user_id, undefined);
  const status = response();
  await routeDeletion({ method: "GET", query: { code: db.state.deletion.code } }, status, { env: {}, db });
  assert.deepEqual(status.body, { ok: true, status: "completed", received_at: "2026-10-23T12:00:00.000Z" });
  assert.equal(parseSignedRequest("nope.nope", SECRET), null);
});

test("the panel, public pages, and review notes are in place", () => {
  const engine = readFileSync(new URL("../acquire/engine-ui.js", import.meta.url), "utf8");
  const ops = readFileSync(new URL("../acquire/studio-ops.js", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../supabase/migrations/20261023060000_meta_ig_channel.sql", import.meta.url), "utf8");
  const privacy = readFileSync(new URL("../privacy/index.html", import.meta.url), "utf8");
  const terms = readFileSync(new URL("../terms/index.html", import.meta.url), "utf8");
  const deletion = readFileSync(new URL("../data-deletion/index.html", import.meta.url), "utf8");
  const review = readFileSync(new URL("../docs/meta-app-review.md", import.meta.url), "utf8");
  assert.match(engine, /Connect Instagram/);
  assert.match(engine, /\/api\/meta\/ig\/start/);
  assert.doesNotMatch(engine, /channel_provider/);
  assert.match(ops, /Connect Instagram/);
  assert.doesNotMatch(ops, /channel_provider/);
  assert.match(sql, /default 'tailortalk'/);
  assert.match(sql, /channel_provider in \('tailortalk', 'meta'\)/);
  assert.match(privacy, /https:\/\/www\.roleflow\.io\/privacy\/|Privacy/);
  assert.match(privacy, /https:\/\/www\.roleflow\.io\/api\/meta\/ig\/deletion/);
  assert.match(terms, /Terms/);
  assert.match(deletion, /\/api\/meta\/ig\/deletion/);
  assert.match(review, /instagram_business_manage_messages/);
  assert.match(review, /Screencast/);
  assert.match(review, /https:\/\/www\.roleflow\.io\/api\/meta\/ig\/callback/);
  assert.match(review, /https:\/\/www\.roleflow\.io\/api\/meta\/ig\/webhook/);
});

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
