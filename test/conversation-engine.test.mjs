import assert from "node:assert/strict";
import fs from "node:fs";
import { messagingDecision } from "../supabase/functions/roleflow-acquisition/ig/policy.js";
import { canTransition, resolveNextState } from "../supabase/functions/roleflow-acquisition/ig/state.js";
import { verifySignature, hubChallenge, extractEvents, eventId, signBody } from "../supabase/functions/roleflow-acquisition/ig/webhook.js";
import { withPolicy, textBody, retryPlan, underRateLimit } from "../supabase/functions/roleflow-acquisition/ig/send.js";
import { recoveryDue } from "../supabase/functions/roleflow-acquisition/ig/recovery.js";
import { scopeBusiness, routeByIgUser, connectionHealth } from "../supabase/functions/roleflow-acquisition/ig/tenant.js";
import { planTurn } from "../supabase/functions/roleflow-acquisition/ig/engine.js";
import { qualifiersPass } from "../supabase/functions/roleflow-acquisition/ig/qualify.js";
import { parseSignedRequest, signRequest } from "../supabase/functions/roleflow-acquisition/ig/deletion.js";
import { pickSlots } from "../supabase/functions/roleflow-acquisition/ig/slots.js";
import { completeJson, resolveProvider, DEFAULT_XAI_MODEL } from "../supabase/functions/roleflow-acquisition/ig/llm.js";
import { encryptToken, decryptToken } from "../supabase/functions/roleflow-acquisition/ig/crypto.js";
import { seedSections } from "../supabase/functions/roleflow-acquisition/ig/prompt-seed.js";

const now = Date.parse("2026-10-21T12:00:00Z");
const hour = 60 * 60 * 1000;

const inside = messagingDecision({ lastUserMessageAt: new Date(now - 23 * hour).toISOString(), now, kind: "ai", humanLocked: false });
assert.equal(inside.allow, true);
assert.equal(inside.tag, null);

const lateAi = messagingDecision({ lastUserMessageAt: new Date(now - 25 * hour).toISOString(), now, kind: "ai", humanLocked: true });
assert.equal(lateAi.allow, false);
assert.equal(lateAi.tag, null);

const lateRecovery = messagingDecision({ lastUserMessageAt: new Date(now - 25 * hour).toISOString(), now, kind: "recovery", humanLocked: true });
assert.equal(lateRecovery.allow, false);

const human = messagingDecision({ lastUserMessageAt: new Date(now - 25 * hour).toISOString(), now, kind: "human", humanLocked: true });
assert.equal(human.allow, true);
assert.equal(human.tag, "HUMAN_AGENT");

const unlocked = messagingDecision({ lastUserMessageAt: new Date(now - 25 * hour).toISOString(), now, kind: "human", humanLocked: false });
assert.equal(unlocked.allow, false);

const tooOld = messagingDecision({ lastUserMessageAt: new Date(now - 8 * 24 * hour).toISOString(), now, kind: "human", humanLocked: true });
assert.equal(tooOld.allow, false);
assert.equal(tooOld.reason, "outside_7d");

assert.equal(canTransition("comment_to_dm", "qualification"), true);
assert.equal(canTransition("comment_to_dm", "booking"), false);
assert.equal(canTransition("qualification", "booking"), true);
assert.equal(canTransition("booking", "booked"), true);
assert.equal(canTransition("booked", "qualification"), false);
assert.equal(canTransition("dead", "qualification"), false);
assert.equal(canTransition("dead", "dead"), true);
assert.equal(resolveNextState("comment_to_dm", "comment_to_dm", "message").state, "qualification");
assert.equal(resolveNextState("qualification", "closed", "message").rejected, true);

const secret = "app-secret";
const raw = JSON.stringify({ object: "instagram", entry: [] });
const header = signBody(raw, secret);
assert.equal(verifySignature(raw, header, secret), true);
assert.equal(verifySignature(raw + " ", header, secret), false);
assert.equal(verifySignature(raw, header, "other"), false);
assert.equal(hubChallenge({ mode: "subscribe", verifyToken: "tok", expected: "tok", challenge: "123" }).ok, true);
assert.equal(hubChallenge({ mode: "subscribe", verifyToken: "nope", expected: "tok", challenge: "123" }).ok, false);

const payload = {
  entry: [{
    id: "ig-business",
    messaging: [{ sender: { id: "lead-1" }, timestamp: 1, message: { mid: "m.1", text: "hello" } }]
  }]
};
const events = extractEvents(payload);
assert.equal(events.length, 1);
assert.equal(eventId(events[0]), "mid:m.1");

assert.equal(routeByIgUser("ig-a", [
  { ig_user_id: "ig-a", status: "connected", business_id: "biz-a" },
  { ig_user_id: "ig-b", status: "connected", business_id: "biz-b" }
]), "biz-a");
assert.equal(routeByIgUser("ig-b", [
  { ig_user_id: "ig-a", status: "connected", business_id: "biz-a" },
  { ig_user_id: "ig-b", status: "disconnected", business_id: "biz-b" }
]), null);
assert.equal(scopeBusiness("biz-a", "biz-b").status, 403);
assert.equal(scopeBusiness("biz-a", "biz-a").businessId, "biz-a");
assert.equal(scopeBusiness("", "biz-a").ok, false);

const stripped = withPolicy(textBody({ recipientId: "1", text: "hi", tag: "HUMAN_AGENT" }), { allow: true, tag: null });
assert.equal(stripped.tag, undefined);
const tagged = withPolicy(textBody({ recipientId: "1", text: "hi" }), human);
assert.equal(tagged.tag, "HUMAN_AGENT");
const plain = withPolicy(textBody({ recipientId: "1", text: "hi", tag: "HUMAN_AGENT" }), inside);
assert.equal(plain.tag, undefined);

assert.equal(recoveryDue({ lastUserMessageAt: new Date(now - 5 * hour).toISOString(), followupCount: 0, now }), false);
assert.equal(recoveryDue({ lastUserMessageAt: new Date(now - 6 * hour).toISOString(), followupCount: 0, now }), true);
assert.equal(recoveryDue({ lastUserMessageAt: new Date(now - 11 * hour).toISOString(), followupCount: 1, now }), false);
assert.equal(recoveryDue({ lastUserMessageAt: new Date(now - 18 * hour).toISOString(), followupCount: 2, now }), true);
assert.equal(recoveryDue({ lastUserMessageAt: new Date(now - 18 * hour).toISOString(), followupCount: 3, now }), false);
assert.equal(recoveryDue({ lastUserMessageAt: new Date(now - 25 * hour).toISOString(), followupCount: 0, now }), false);
assert.equal(recoveryDue({ lastUserMessageAt: new Date(now - 6 * hour).toISOString(), followupCount: 0, now, humanLocked: true }), false);
assert.equal(recoveryDue({ lastUserMessageAt: new Date(now - 6 * hour).toISOString(), followupCount: 0, now, state: "booked" }), false);

assert.equal(qualifiersPass({ budget: "open", timeline: "within 30 days", decision_maker: "yes", fit: "high" }), true);
assert.equal(qualifiersPass({ budget: "refuses", timeline: "now", decision_maker: "yes", fit: "high" }), false);

const illegal = await planTurn({
  thread: { state: "qualification", lastUserMessageAt: new Date(now).toISOString(), attributes: {} },
  now,
  llm: async () => ({ bubbles: ["what happens after you log off?"], next_state: "closed", score: "Warm", attributes: {} })
});
assert.equal(illegal.state, "qualification");
assert.equal(illegal.rejectedTransition, true);

const blocked = await planTurn({
  thread: { state: "qualification", lastUserMessageAt: new Date(now - 30 * hour).toISOString() },
  now,
  kind: "ai",
  llm: async () => { throw new Error("should not run"); }
});
assert.equal(blocked.noResponse, true);
assert.equal(blocked.reason, "outside_24h");

const signed = signRequest({ user_id: "99" }, secret);
assert.equal(parseSignedRequest(signed, secret).user_id, "99");
assert.equal(parseSignedRequest(signed, "nope"), null);

const slots = pickSlots({ now: Date.parse("2026-10-21T08:00:00Z"), timeZone: "UTC", horizonDays: 5 });
assert.equal(slots.length, 2);
assert.match(slots[0].label, /Wednesday/);
assert.match(slots[1].label, /Thursday/);
assert.equal(slots[0].start.includes("T10:00:00.000Z"), true);

assert.equal(DEFAULT_XAI_MODEL, "grok-4.3");
assert.equal(resolveProvider({ XAI_API_KEY: "x" }), "xai");
assert.equal(resolveProvider({ XAI_API_KEY: "x", OPENAI_API_KEY: "sk", GEMINI_API_KEY: "g" }), "xai");
assert.equal(resolveProvider({ LLM_PROVIDER: "xai", OPENAI_API_KEY: "sk" }), null);
assert.equal(resolveProvider({ LLM_PROVIDER: "openai", XAI_API_KEY: "x", OPENAI_API_KEY: "sk" }), "openai");
assert.equal(resolveProvider({ LLM_PROVIDER: "gemini", XAI_API_KEY: "x", GEMINI_API_KEY: "g" }), "gemini");
assert.equal(resolveProvider({ OPENAI_API_KEY: "sk" }), "openai");
assert.equal(resolveProvider({ GEMINI_API_KEY: "g" }), "gemini");
assert.equal(resolveProvider({}), null);
const xaiCalls = [];
const xaiText = await completeJson({
  env: { XAI_API_KEY: "xai-test", OPENAI_API_KEY: "sk" },
  system: "reply json",
  messages: [{ role: "user", content: "hello" }],
  fetchImpl: async (url, init) => {
    xaiCalls.push({ url, init });
    return { ok: true, json: async () => ({ choices: [{ message: { content: "{\"bubbles\":[\"ok\"]}" } }] }) };
  }
});
assert.equal(xaiText, "{\"bubbles\":[\"ok\"]}");
assert.equal(xaiCalls.length, 1);
assert.equal(xaiCalls[0].url, "https://api.x.ai/v1/chat/completions");
const xaiBody = JSON.parse(xaiCalls[0].init.body);
assert.equal(xaiBody.model, "grok-4.3");
assert.equal(xaiBody.response_format.type, "json_object");
assert.equal(xaiCalls[0].init.headers.Authorization, "Bearer xai-test");
assert.equal(retryPlan(429, 1).retry, true);
assert.equal(retryPlan(400, 1).retry, false);
assert.equal(underRateLimit(19), true);
assert.equal(underRateLimit(20), false);

const round = await encryptToken("long-lived-token", "0123456789abcdef");
assert.equal(await decryptToken(round, "0123456789abcdef"), "long-lived-token");
assert.equal(connectionHealth({ status: "connected", ig_user_id: "1", username: "roleflow", expires_at: new Date(now + 30 * 24 * hour).toISOString() }, now).status, "connected");

const seed = seedSections("qualification");
assert.match(seed.guardrails, /Diego's team uses an AI assistant/);
assert.match(seed.booking_logic, /calendar\.app\.google\/8i1gomkozavqYU5b8/);

const engineSql = fs.readFileSync(new URL("../supabase/migrations/20261021140000_conversation_engine.sql", import.meta.url), "utf8");
for (const table of ["ig_connections", "ig_threads", "ig_messages", "ig_outbox", "acq_workers", "acq_dnc", "acq_prompt_versions"]) {
  assert.match(engineSql, new RegExp(`create table if not exists public\\.${table}[\\s\\S]*business_id uuid`));
  assert.match(engineSql, new RegExp(`alter table public\\.${table} enable row level security`));
}
assert.match(engineSql, /acq_can_read\(business_id\)/);
assert.doesNotMatch(engineSql, /instagram_password/i);
assert.match(engineSql, /key_hash/);
assert.doesNotMatch(engineSql, /using \(true\)/);
assert.match(engineSql, /ig_connections_user_idx/);

const bot = fs.readFileSync(new URL("../supabase/functions/acquisition-bot/index.ts", import.meta.url), "utf8");
assert.match(bot, /acq_worker_auth/);
assert.match(bot, /different business/);
assert.doesNotMatch(bot, /ACQUISITION_BOT_SECRET/);
assert.doesNotMatch(bot, /instagram_password/i);

const hook = fs.readFileSync(new URL("../supabase/functions/roleflow-acquisition/index.ts", import.meta.url), "utf8");
const policy = fs.readFileSync(new URL("../supabase/functions/roleflow-acquisition/ig/policy.js", import.meta.url), "utf8");
assert.match(hook, /X-Hub-Signature-256/);
assert.match(policy, /HUMAN_AGENT/);
assert.match(hook, /business_id/);
assert.doesNotMatch(hook, /tailortalk/i);
