import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { callbackFailure as pageFailure, finishConnect, panelReturn } from "../app/instagram/callback.js";
import { beginInstagramConnect, connectOutcome, connectPlan, disconnectInstagram, scrubChannelCopy } from "../acquire/connect-instagram.js";
import {
  callbackFailure,
  connectQuery,
  instagramAuthUrl,
  enqueueBody,
  gatewayConfigFrom,
  handleWebhook,
  idempotencyKey,
  interpretSend,
  normalizeEvent,
  outboxWriteStatus,
  planGatewayReply,
  planPayload,
  readWebhookHeaders,
  replyText,
  sendRequest,
  shouldEnqueue,
  safeWebhookError,
  signState,
  signWebhook,
  startConnect,
  verifyState,
  verifyWebhook,
  API_BASE,
  CALLBACK_URL
} from "../supabase/functions/_shared/ig-gateway.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const businessId = "840b08a9-869c-4650-8dc7-f78fdfa0e112";
const secret = "test-webhook-secret";
const apiKey = "test-api-key";

assert.deepEqual(gatewayConfigFrom({ ZERNIO_API_KEY: "env-key", ZERNIO_WEBHOOK_SECRET: "" }, { api_key: "db-key", webhook_secret: "db-secret" }), {
  apiKey: "env-key",
  webhookSecret: "db-secret"
});
assert.deepEqual(gatewayConfigFrom({}, { api_key: "db-key", webhook_secret: "db-secret" }), {
  apiKey: "db-key",
  webhookSecret: "db-secret"
});
assert.deepEqual(gatewayConfigFrom({}, {}), { apiKey: "", webhookSecret: "" });

const calls = [];
const fetchImpl = async (url, init) => {
  calls.push({ url: String(url), init });
  const href = String(url);
  if (href.includes("conflict=1")) {
    return { ok: false, status: 409, json: async () => ({ code: "profile_external_id_conflict", details: { existingProfileId: "profile-existing" } }) };
  }
  if (href.includes("/profiles?externalId=")) return { ok: true, status: 200, json: async () => ({ profiles: [] }) };
  if (href.endsWith("/profiles")) {
    return { ok: true, status: 201, json: async () => ({ profile: { _id: "profile-1" } }) };
  }
  const profileRead = href.match(/\/profiles\/([^/?&#]+)$/);
  if (profileRead) {
    const id = decodeURIComponent(profileRead[1]);
    return { ok: true, status: 200, json: async () => ({ profile: { _id: id, externalId: businessId } }) };
  }
  if (href.includes("billing=1")) {
    return { ok: false, status: 402, json: async () => ({ code: "PAYMENT_REQUIRED", dashboard_url: "https://billing.example/pay" }) };
  }
  return { ok: true, status: 200, json: async () => ({ authUrl: "https://www.instagram.com/oauth/authorize?welcome=1" }) };
};

const missing = await startConnect({ apiKey: "", business: { id: businessId, name: "Roleflow" }, fetchImpl });
assert.deepEqual(missing, { configured: false });
assert.equal(calls.length, 0);

const started = await startConnect({
  apiKey,
  webhookSecret: secret,
  business: { id: businessId, name: "Roleflow\nDemo" },
  fetchImpl,
  now: 1_700_000_000_000,
  nonce: "abc123"
});
assert.equal(started.configured, true);
assert.equal(started.profileId, "profile-1");
assert.equal(started.authUrl, "https://www.instagram.com/oauth/authorize?welcome=1");
assert.equal(calls.length, 3);
assert.equal(calls[1].init.method, "POST");
assert.equal(JSON.parse(calls[1].init.body).externalId, businessId);
assert.equal(calls[1].init.headers.Authorization, "Bearer " + apiKey);
const connectUrl = new URL(calls[2].url);
assert.equal(connectUrl.origin + connectUrl.pathname, API_BASE + "/connect/instagram");
assert.equal(connectUrl.searchParams.get("profileId"), "profile-1");
assert.equal(connectUrl.searchParams.get("scopes"), "messaging,comments");
assert.equal(connectUrl.searchParams.get("welcome"), "false");
assert.equal(connectUrl.searchParams.get("brandName"), null);
assert.equal(connectUrl.searchParams.get("logoUrl"), null);
assert.equal(connectUrl.searchParams.get("username"), null);
assert.equal(connectUrl.searchParams.get("handle"), null);
assert.equal(instagramAuthUrl(started.authUrl).startsWith("https://www.instagram.com/"), true);
const redirect = new URL(connectUrl.searchParams.get("redirect_url"));
assert.equal(redirect.origin + redirect.pathname, CALLBACK_URL);
assert.equal(verifyState(redirect.searchParams.get("state"), secret, 1_700_000_000_000).businessId, businessId);
assert.equal(connectQuery({ profileId: "profile-1", state: "state" }).scopes, "messaging,comments");

calls.length = 0;
const again = await startConnect({
  apiKey,
  webhookSecret: secret,
  existingProfileId: "profile-1",
  business: { id: businessId, name: "Roleflow" },
  fetchImpl,
  nonce: "abc123"
});
assert.equal(again.profileId, "profile-1");
assert.equal(calls.length, 3);
assert.match(calls[2].url, /\/v1\/connect\/instagram/);
assert.equal(new URL(calls[2].url).searchParams.get("profileId"), "profile-1");

const billed = await startConnect({
  apiKey,
  existingProfileId: "profile-1",
  business: { id: businessId },
  fetchImpl: async (url, init) => {
    const href = String(url);
    if (href.includes("/connect/instagram")) return fetchImpl(href + "&billing=1", init);
    return fetchImpl(url, init);
  },
  nonce: "abc123"
});
assert.equal(billed.error, "Instagram connect needs a billing update before it can continue.");
assert.equal(billed.profileId, "profile-1");
assert.equal(billed.dashboard_url, undefined);
assert.doesNotMatch(JSON.stringify(billed), /zernio|dashboard_url/i);

const insecure = await startConnect({
  apiKey,
  existingProfileId: "profile-1",
  business: { id: businessId },
  fetchImpl: async (url) => {
    const href = String(url);
    if (href.includes("/profiles?externalId=")) return { ok: true, status: 200, json: async () => ({ profiles: [] }) };
    if (href.includes("/profiles/")) return { ok: true, status: 200, json: async () => ({ profile: { _id: "profile-1", externalId: businessId } }) };
    return { ok: true, status: 200, json: async () => ({ authUrl: "http://instagram.example/allow" }) };
  },
  nonce: "abc123"
});
assert.equal(insecure.error, "Instagram connect could not start.");

const reused = await startConnect({
  apiKey,
  business: { id: businessId, name: "Roleflow" },
  fetchImpl: async (url, init) => fetchImpl(String(url).includes("/profiles") && init && init.method === "POST" ? String(url) + "?conflict=1" : url, init),
  nonce: "abc123"
});
assert.equal(reused.profileId, "profile-existing");

const otherBusiness = "1351d2ac-79bb-545d-8da0-c49ecff28a47";
const otherCalls = [];
const other = await startConnect({
  apiKey,
  webhookSecret: secret,
  business: { id: otherBusiness, name: "Value Add Marketing" },
  fetchImpl: async (url, init) => {
    otherCalls.push({ url: String(url), init });
    return fetchImpl(url, init);
  },
  nonce: "other-nonce"
});
assert.equal(other.profileId, "profile-1");
assert.equal(JSON.parse(otherCalls[1].init.body).externalId, otherBusiness);
assert.equal(other.authUrl.startsWith("https://www.instagram.com/"), true);

const kept = [];
const isolated = await startConnect({
  apiKey,
  webhookSecret: secret,
  existingProfileId: "roleflow-profile",
  business: { id: otherBusiness, name: "North studio" },
  fetchImpl: async (url, init) => {
    const href = String(url);
    kept.push(href);
    if (href.includes("/profiles?externalId=")) {
      return { ok: true, status: 200, json: async () => ({ profiles: [{ _id: "profile-north", externalId: otherBusiness }, { _id: "roleflow-profile", externalId: businessId }] }) };
    }
    if (href.includes("/connect/instagram")) {
      return { ok: true, status: 200, json: async () => ({ authUrl: "https://www.instagram.com/oauth/authorize?client_id=north" }) };
    }
    if (init && init.method === "POST") throw new Error("should not create when this business already has a profile");
    throw new Error("should not read the other business profile");
  },
  now: 1_700_000_000_000,
  nonce: "north-nonce"
});
assert.equal(isolated.profileId, "profile-north");
assert.equal(isolated.authUrl.startsWith("https://www.instagram.com/"), true);
assert.equal(kept.some((href) => href.includes("roleflow-profile")), false);
const isolatedState = verifyState(new URL(new URL(kept.find((href) => href.includes("/connect/instagram"))).searchParams.get("redirect_url")).searchParams.get("state"), secret, 1_700_000_000_000);
assert.equal(isolatedState.businessId, otherBusiness);

const foreignStored = await startConnect({
  apiKey,
  webhookSecret: secret,
  existingProfileId: "roleflow-profile",
  business: { id: otherBusiness, name: "North studio" },
  fetchImpl: async (url, init) => {
    const href = String(url);
    if (href.includes("/profiles?externalId=")) return { ok: true, status: 200, json: async () => ({ profiles: [] }) };
    if (href.includes("/profiles/roleflow-profile")) {
      return { ok: true, status: 200, json: async () => ({ profile: { _id: "roleflow-profile", externalId: businessId } }) };
    }
    if (href.endsWith("/profiles") && init && init.method === "POST") {
      assert.equal(JSON.parse(init.body).externalId, otherBusiness);
      return { ok: true, status: 201, json: async () => ({ profile: { _id: "profile-second", externalId: otherBusiness } }) };
    }
    if (href.includes("/connect/instagram")) {
      assert.equal(new URL(href).searchParams.get("profileId"), "profile-second");
      return { ok: true, status: 200, json: async () => ({ authUrl: "https://www.instagram.com/oauth/authorize?client_id=second" }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  },
  nonce: "second-nonce"
});
assert.equal(foreignStored.profileId, "profile-second");
assert.notEqual(foreignStored.profileId, "roleflow-profile");

const foreignConflict = await startConnect({
  apiKey,
  business: { id: otherBusiness, name: "North studio" },
  fetchImpl: async (url, init) => {
    const href = String(url);
    if (href.includes("/profiles?externalId=")) return { ok: true, status: 200, json: async () => ({ profiles: [] }) };
    if (init && init.method === "POST") {
      return { ok: false, status: 409, json: async () => ({ code: "profile_external_id_conflict", details: { existingProfileId: "roleflow-profile" } }) };
    }
    if (href.includes("/profiles/roleflow-profile")) {
      return { ok: true, status: 200, json: async () => ({ profile: { _id: "roleflow-profile", externalId: businessId } }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  },
  nonce: "conflict-nonce"
});
assert.equal(foreignConflict.profileId, undefined);
assert.equal(foreignConflict.authUrl, undefined);
assert.equal(foreignConflict.error, "Instagram connect could not start.");

const vendorPage = await startConnect({
  apiKey,
  existingProfileId: "profile-1",
  business: { id: otherBusiness, name: "Value Add Marketing" },
  fetchImpl: async (url) => {
    const href = String(url);
    if (href.includes("/profiles?externalId=")) return { ok: true, status: 200, json: async () => ({ profiles: [{ _id: "profile-1", externalId: otherBusiness }] }) };
    return { ok: true, status: 200, json: async () => ({ authUrl: "https://vendor.example/connect/welcome" }) };
  },
  nonce: "other-nonce"
});
assert.equal(vendorPage.error, "Instagram connect could not start.");
assert.equal(vendorPage.authUrl, undefined);

const raw = JSON.stringify({
  id: "evt-1",
  event: "message.received",
  account: { accountId: "acct-1", profileId: "profile-1" },
  message: { id: "mid-1", text: "Hello", conversationId: "conv-1", sender: { id: "sender-1", username: "ada" } },
  conversation: { id: "conv-1" }
});
assert.equal(verifyWebhook(raw, signWebhook(raw, secret), secret), true);
assert.match(read("supabase/functions/_shared/ig-gateway.js"), /from "node:buffer"/);
assert.equal(safeWebhookError({ name: "ReferenceError", message: "Buffer is not defined" }), "ReferenceError: Buffer is not defined");
assert.equal(safeWebhookError({ message: "Bearer abcdefghijklmnopqrstuvwxyz012345" }), "Error: Bearer [redacted]");
assert.doesNotMatch(safeWebhookError({ message: "Bearer abcdefghijklmnopqrstuvwxyz012345" }), /abcdefghijklmnopqrstuvwxyz012345/);
assert.equal(verifyWebhook(raw, "deadbeef", secret), false);
assert.equal(verifyWebhook(raw, signWebhook(raw, secret), ""), false);
const headers = readWebhookHeaders({ "X-Zernio-Signature": "abc", "X-Zernio-Event-Id": "evt-1" });
assert.equal(headers.signature, "abc");
assert.equal(headers.eventId, "evt-1");
assert.equal(readWebhookHeaders({ "X-Late-Signature": "legacy" }).signature, "legacy");

const message = normalizeEvent(JSON.parse(raw));
assert.equal(message.conversationId, "conv-1");
assert.equal(message.senderId, "sender-1");
assert.equal(message.externalId, "mid-1");
assert.equal(message.standby, false);
const standby = normalizeEvent({ ...JSON.parse(raw), metadata: { standby: true } });
assert.equal(standby.standby, true);
assert.equal(shouldEnqueue(standby, { systemEnabled: true, commentToDm: true }), false);
assert.equal(shouldEnqueue(message, { systemEnabled: false, commentToDm: true }), false);
assert.equal(shouldEnqueue(message, { systemEnabled: true, commentToDm: false }), true);
const inbound = normalizeEvent({
  id: "evt-live",
  event: "message.received",
  message: {
    id: "msg-1",
    conversationId: "conv-live",
    text: "Hey boss",
    direction: "incoming",
    sender: { id: "2108532849767337", username: "diegocastanedo.g" }
  },
  account: { accountId: "acct-1" }
});
assert.equal(inbound.senderId, "2108532849767337");
assert.equal(inbound.conversationId, "conv-live");
assert.equal(inbound.kind, "message");
assert.equal(shouldEnqueue(inbound, { systemEnabled: true, commentToDm: false }), true);
const sent = normalizeEvent({
  id: "evt-sent",
  event: "message.sent",
  account: { accountId: "acct-1" },
  message: { id: "mid-out", text: "Sent", conversationId: "conv-1", recipient: { id: "sender-1" } }
});
assert.equal(sent.kind, "sent");
assert.equal(sent.senderId, "sender-1");
assert.equal(shouldEnqueue(sent, { systemEnabled: true, commentToDm: true }), false);
assert.equal(normalizeEvent({ id: "evt-echo", event: "message.sent", account: { accountId: "acct-1" }, message: { id: "mid-echo" } }).ignored, true);

const comment = normalizeEvent({
  id: "evt-2",
  event: "comment.received",
  account: { accountId: "acct-1" },
  comment: { id: "comment-9", postId: "post-3", text: "price?", author: { id: "sender-2", username: "@Ada" } }
});
assert.equal(comment.postId, "post-3");
assert.equal(comment.commentId, "comment-9");
assert.equal(comment.externalId, "comment:comment-9");
assert.equal(shouldEnqueue(comment, { systemEnabled: true, commentToDm: false }), false);
assert.equal(shouldEnqueue(comment, { systemEnabled: true, commentToDm: true }), true);
assert.equal(shouldEnqueue(comment, { systemEnabled: true, commentToDm: false, commentVoice: true }), true);
const commentSend = sendRequest({ kind: "comment_private", payload: planPayload(comment, "row-1") });
assert.equal(commentSend.path, "/inbox/comments/post-3/comment-9/private-reply");
assert.deepEqual(commentSend.body, { accountId: "acct-1", message: "" });
const voiceSend = sendRequest({
  kind: "comment_voice",
  payload: { ...planPayload(comment, "row-1"), text: "Thanks for the comment.", attachmentUrl: "https://cdn.example/voice.m4a", attachmentType: "audio" }
});
assert.equal(voiceSend.path, "/inbox/comments/post-3/comment-9/private-reply");
assert.deepEqual(voiceSend.body, { accountId: "acct-1", message: "Thanks for the comment." });
assert.equal("attachmentUrl" in voiceSend.body, false);
const replySend = sendRequest({ kind: "reply", payload: enqueueBody(message, "Thanks", "row-1") });
assert.equal(replySend.path, "/inbox/conversations/conv-1/messages");
assert.deepEqual(replySend.body, { accountId: "acct-1", message: "Thanks" });

const owned = interpretSend(409, { code: "not_thread_owner", details: { ownerAppId: "other-app" } });
assert.equal(owned.status, "not_thread_owner");
assert.equal(owned.error, "Another app owns this Instagram thread.");
assert.doesNotMatch(JSON.stringify(owned), /other-app|zernio/i);
assert.deepEqual(outboxWriteStatus(owned), {
  status: "not_thread_owner",
  last_error: "Another app owns this Instagram thread."
});
assert.equal(interpretSend(200, { id: "sent-1" }).status, "sent");
assert.equal(outboxWriteStatus(interpretSend(500, {})).status, "failed");

const seen = new Set();
const stored = [];
async function drive(body, signature) {
  return handleWebhook({
    raw: JSON.stringify(body),
    secret,
    signature,
    lookupAccount: async () => ({ businessId, systemEnabled: true, commentToDm: false }),
    remember: async (event) => { seen.add(event.id); },
    seen: async (id) => seen.has(id) ? true : (seen.add(id), false),
    forget: async (id) => { seen.delete(id); },
    ingest: async (row) => { stored.push(row); }
  });
}
const first = await drive(JSON.parse(raw), signWebhook(raw, secret));
assert.equal(first.body.queued, true);
assert.equal(stored[0].kind, "reply");
assert.equal(idempotencyKey("evt-1"), "gw:evt-1");
const second = await drive(JSON.parse(raw), signWebhook(raw, secret));
assert.equal(second.body.duplicate, true);
assert.equal(stored.length, 1);
const bad = await drive(JSON.parse(raw), "nope");
assert.equal(bad.status, 401);
const quiet = await handleWebhook({ raw, secret: "", signature: signWebhook(raw, secret) });
assert.equal(quiet.status, 401);

const state = signState({ b: businessId, e: Date.now() + 1000, n: "nonce-1" }, secret);
assert.equal(verifyState(state, secret, Date.now()).ok, true);
assert.equal(verifyState(state, "other", Date.now()).ok, false);
assert.equal(verifyState(state, secret, Date.now() + 5000).ok, false);
assert.equal(verifyState(state, secret, Date.now() + 5000).businessId, businessId);

const params = new URLSearchParams("error=oauth_denied&platform_error_reason=user_denied&error_message=denied%20by%20gateway");
assert.equal(callbackFailure(params), pageFailure(params));
assert.match(callbackFailure(params), /didn't allow the connection/);
assert.doesNotMatch(callbackFailure(params), /gateway|zernio/i);
assert.equal(callbackFailure(new URLSearchParams("error=connection_failed")), pageFailure(new URLSearchParams("error=connection_failed")));
assert.equal(panelReturn(businessId), "/account/acquisition/?business=" + businessId + "&ig=connected&connect=1#integrations");

const finished = await finishConnect({
  params: new URLSearchParams("state=signed&accountId=acct-1&username=roleflow.io"),
  config: { url: "https://example.supabase.co", key: "publishable" },
  fetchImpl: async (_url, init) => {
    assert.equal(JSON.parse(init.body).account_id, "acct-1");
    return { json: async () => ({ ok: true, business_id: businessId }) };
  }
});
assert.equal(finished.redirect, panelReturn(businessId));
const denied = await finishConnect({
  params,
  config: { url: "https://example.supabase.co", key: "publishable" },
  fetchImpl: async () => { throw new Error("should not be called"); }
});
assert.match(denied.error, /didn't allow/);

assert.equal(connectOutcome(null).mode, "error");
assert.equal(connectOutcome({ configured: false }).mode, "error");
assert.equal(connectPlan({ configured: false }).mode, "manual");
assert.equal(connectPlan({ configured: true, authUrl: "https://www.instagram.com/oauth/authorize" }).mode, "redirect");
assert.equal(connectPlan(null).mode, "error");
assert.equal(connectOutcome({ configured: true, authUrl: "https://www.instagram.com/oauth/authorize" }).mode, "redirect");
assert.equal(connectOutcome({ configured: true, authUrl: "https://vendor.example/connect/welcome" }).mode, "error");
assert.equal(connectOutcome({ configured: true, error: "Instagram connect could not start." }).mode, "error");
const began = await beginInstagramConnect({
  businessId: otherBusiness,
  state: {
    businessId,
    supabase: { functions: { invoke: async (_name, init) => {
      assert.equal(init.body.business_id, otherBusiness);
      return { data: { configured: true, authUrl: "https://www.instagram.com/oauth/authorize?client_id=1" } };
    } } }
  }
});
assert.equal(began.mode, "redirect");
assert.equal(began.authUrl.startsWith("https://www.instagram.com/"), true);
const slow = await beginInstagramConnect({
  businessId,
  timeoutMs: 20,
  state: {
    businessId,
    supabase: { functions: { invoke: () => new Promise(() => {}) } }
  }
});
assert.equal(slow.mode, "error");
assert.match(slow.error, /try again/i);
const unavailable = await beginInstagramConnect({
  state: {
    businessId,
    supabase: { functions: { invoke: async () => ({ error: { message: "failed" }, data: null }) } }
  }
});
assert.equal(unavailable.mode, "error");
assert.doesNotMatch(unavailable.error, /username|handle/i);
const disconnected = await disconnectInstagram({
  state: {
    businessId,
    supabase: { functions: { invoke: async (_name, init) => {
      assert.equal(init.body.action, "disconnect");
      assert.equal(init.body.business_id, businessId);
      return { data: { ok: true } };
    } } }
  }
});
assert.equal(disconnected.ok, true);
assert.equal(scrubChannelCopy("TailorTalk"), "Instagram channel");

const plan = await planGatewayReply({
  thread: { state: "qualification", lastUserMessageAt: new Date().toISOString() },
  text: "Are you a bot?",
  now: Date.now(),
  llm: async () => JSON.stringify({ bubbles: ["I can help with that."], next_state: "qualification", score: "warm" })
});
assert.equal(replyText(plan), "I can help with that.");
assert.equal(planPayload(message, "row-1").needsPlan, true);
assert.equal(planPayload(message, "row-1").text, "");

const sql = read("supabase/migrations/20261023100000_ig_gateway.sql");
assert.match(sql, /create table if not exists public\.ig_gateway_accounts/);
assert.match(sql, /create table if not exists public\.ig_gateway_states/);
assert.match(sql, /create table if not exists public\.ig_gateway_events/);
assert.match(sql, /enable row level security/);
assert.match(sql, /acq_can_read\(business_id\)/);
assert.match(sql, /acq_read_gateway_settings/);
assert.match(sql, /zernio_api_key/);
assert.match(sql, /zernio_webhook_secret/);
assert.match(sql, /transport = 'meta'/);
assert.match(sql, /transport = 'official'/);
assert.match(sql, /not_thread_owner/);
assert.match(sql, /acq_claim_gateway_outbox/);
assert.match(sql, /acq_gateway_store_inbound/);
assert.doesNotMatch(sql, /insert into private\.acquisition_settings/i);
assert.doesNotMatch(sql, /ig_user_id =/);

const toml = read("supabase/config.toml");
assert.match(toml, /\[functions\.ig-connect-start\]\nverify_jwt = true/);
assert.match(toml, /\[functions\.ig-connect-finish\]\nverify_jwt = false/);
assert.match(toml, /\[functions\.zernio-webhook\]\nverify_jwt = false/);
const startFn = read("supabase/functions/ig-connect-start/index.ts");
const finishFn = read("supabase/functions/ig-connect-finish/index.ts");
const hookFn = read("supabase/functions/zernio-webhook/index.ts");
assert.match(startFn, /acq_can_edit/);
assert.match(startFn, /acq_read_gateway_settings|loadGatewayConfig/);
assert.match(finishFn, /acq_gateway_connect_account/);
assert.match(hookFn, /message\.received|handleWebhook/);
assert.match(hookFn, /private-reply|sendRequest/);
assert.match(hookFn, /planGatewayReply/);
assert.doesNotMatch(startFn + finishFn + hookFn, /console\.log/);
assert.match(read("acquire/app.js"), /Instagram connected\./);
assert.match(read("acquire/connect-instagram.js"), /ig-connect-start/);
assert.match(read("acquire/connect-instagram.js"), /action: "disconnect"/);
assert.doesNotMatch(read("acquire/connect-instagram.js"), /Instagram Business username|notify_sync|we'll finish this for you/);
const openSql = read("supabase/migrations/20261023170000_ig_connect_any_account.sql");
assert.match(openSql, /acq_gateway_disconnect/);
assert.match(openSql, /when unique_violation/);
assert.match(openSql, /'taken'/);
assert.doesNotMatch(openSql, /roleflow\.io|requested_handle/);
assert.match(read("supabase/functions/ig-connect-finish/index.ts"), /taken/);
assert.match(read("supabase/functions/ig-connect-finish/index.ts"), /connect", "1"/);
assert.match(read("acquire/client-pages.js"), /data-connect-instagram/);
assert.match(read("acquire/client-pages.js"), /Disconnect/);
assert.match(read("acquire/client-pages.js"), /Opening Instagram/);
assert.match(read("acquire/app.js"), /instagram-connect/);
assert.match(read("acquire/app.js"), /bootToken/);
assert.match(read("acquire/add-business.js"), /connect=1#settings/);
assert.doesNotMatch(read("acquire/client-pages.js") + read("acquire/connect-instagram.js") + read("acquire/add-business.js") + read("app/instagram/callback.js"), /zernio/i);
assert.match(read("acquire/app.js"), /Instagram: not connected/);
assert.doesNotMatch(read("acquire/app.js"), /we'll finish this for you/);
assert.match(read("vercel.json"), /account\|admin\|reset\|acquire\|app/);

const ignore = read(".vercelignore").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
function served(rel) {
  const norm = rel.split(path.sep).join("/");
  let skip = false;
  for (const rule of ignore) {
    const neg = rule.startsWith("!");
    const body = neg ? rule.slice(1) : rule;
    const pattern = body.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
    const re = new RegExp("^" + pattern + (body.endsWith("/") ? "" : "($|/)") );
    const dir = new RegExp("^" + pattern + "(/|$)");
    const hit = body.includes("*") ? re.test(norm) || dir.test(norm) : norm === body || norm.startsWith(body.endsWith("/") ? body : body + "/");
    if (hit) skip = !neg;
  }
  return !skip;
}
const named = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (!served(rel)) continue;
    if (entry.isDirectory()) walk(full);
    else if (/\.(html|js|css|mjs|json|md|txt)$/i.test(entry.name) && /zernio/i.test(fs.readFileSync(full, "utf8"))) named.push(rel);
  }
}
walk(root);
assert.deepEqual(named, []);

console.log("ig gateway tests passed");
