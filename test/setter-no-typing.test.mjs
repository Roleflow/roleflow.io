import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CLIP_TYPING_MS,
  TYPING_MAX_MS,
  TYPING_MIN_MS,
  markSeen,
  nextDueInMs,
  pauseThenSend,
  pausesBeforeSend,
  postSenderAction,
  senderActionRequest,
  textLeadMs,
  typingLeadMs,
  waitBeforeTypingMs
} from "../supabase/functions/_shared/typing-plan.js";
import { postOfficial } from "../supabase/functions/_shared/official-outbox.js";
import * as igSend from "../supabase/functions/roleflow-acquisition/ig/send.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const row = (text, extra) => ({ kind: "reply", agent_enabled: true, payload: { text, conversationId: "conv 1", accountId: "acct", ...(extra || {}) } });

// The pause before each bubble still scales with its length.
assert.equal(textLeadMs("ok"), TYPING_MIN_MS);
assert.equal(textLeadMs("a".repeat(60)), 2700);
assert.equal(textLeadMs("a".repeat(900)), TYPING_MAX_MS);
assert.equal(typingLeadMs({ payload: { text: "", attachmentUrl: "https://cdn.example/a.wav" } }), CLIP_TYPING_MS);
assert.equal(typingLeadMs({ payload: {} }), 0);

// Typing can never be requested; only "read" maps to an endpoint.
assert.equal(senderActionRequest(row("hi"), "typing"), null);
assert.equal(senderActionRequest(row("hi"), "typing_on"), null);
assert.deepEqual(senderActionRequest(row("hi"), "read"), { path: "/inbox/conversations/conv%201/read", body: { accountId: "acct" } });
assert.equal(senderActionRequest({ ...row("hi"), kind: "comment_voice" }, "read"), null);
assert.equal(await postSenderAction(row("hi"), "k", "typing", async () => { throw new Error("must not call"); }), false);

// Seen still goes to the conversation the lead wrote in, never for comments.
const seenCalls = [];
await markSeen({ kind: "message", conversationId: "c9" }, "acct", "k", async (url, init) => {
  seenCalls.push({ url, body: JSON.parse(init.body) });
  return { ok: true, json: async () => ({ success: true }) };
});
assert.deepEqual(seenCalls, [{ url: "https://zernio.com/api/v1/inbox/conversations/c9/read", body: { accountId: "acct" } }]);
assert.equal(await markSeen({ kind: "comment", conversationId: "c9" }, "acct", "k", async () => { throw new Error("no"); }), false);

// Per bubble: a short silent pause, then the message. No network call besides the send.
const text = "Sounds good, what are you working on right now?";
const events = [];
const result = await pauseThenSend(row(text), "k", async () => { events.push("send"); return { ok: true }; }, {
  fetchImpl: async (url) => { events.push("call " + url); return { ok: true, json: async () => ({}) }; },
  sleep: async (ms) => { events.push("wait " + ms); }
});
assert.equal(result.ok, true);
assert.deepEqual(events, ["wait " + textLeadMs(text), "send"]);

// Panel replies a person wrote and comment private replies go out at once.
assert.equal(pausesBeforeSend({ ...row("hi"), kind: "human" }), false);
assert.equal(pausesBeforeSend({ ...row("hi"), kind: "comment_private" }), false);
const humanEvents = [];
await pauseThenSend({ ...row("hi"), kind: "human" }, "k", async () => { humanEvents.push("send"); return { ok: true }; }, { sleep: async (ms) => { humanEvents.push("wait " + ms); } });
assert.deepEqual(humanEvents, ["send"]);

// The one-minute tick sender: pause, then only the message call.
const tickCalls = [];
const tickSlept = [];
const sent = await postOfficial(row("Got it. How many leads come in per week?"), "k", async (url) => {
  tickCalls.push(url.split("/").pop());
  return { ok: true, status: 200, json: async () => ({ success: true }) };
}, { sleep: async (ms) => { tickSlept.push(ms); } });
assert.equal(sent.ok, true);
assert.deepEqual(tickCalls, ["messages"]);
assert.equal(tickSlept.length, 1);

// Spacing math is unchanged.
assert.equal(waitBeforeTypingMs(20, "a".repeat(60)), 20000 - 2700);
assert.equal(waitBeforeTypingMs(0, "hi"), 0);
const now = Date.parse("2026-11-03T08:47:12.000Z");
assert.equal(nextDueInMs([{ run_at: "2026-11-03T08:47:15.000Z" }, { run_at: "2026-11-03T08:47:13.000Z" }], now, 20000), 1000);
assert.equal(nextDueInMs([{ run_at: "2026-11-03T08:48:12.000Z" }], now, 20000), null);

// Meta Graph path: seen, pause, message. No typing_on or typing_off.
assert.equal(igSend.typingBody, undefined);
assert.equal(igSend.typingOffBody, undefined);
const graph = [];
const ok = await igSend.sendWithPresence({ recipient: { id: "igsid" }, message: { text: "hey" } }, {
  post: async (payload) => { graph.push(payload.sender_action || "message"); return { ok: true }; },
  sleep: async (ms) => { graph.push("wait " + ms); },
  leadMs: 1500
});
assert.equal(ok.ok, true);
assert.deepEqual(graph, ["mark_seen", "wait 1500", "message"]);
const privateCalls = [];
await igSend.sendWithPresence({ recipient: { comment_id: "c1" }, message: { text: "hey" } }, {
  post: async (payload) => { privateCalls.push(payload.sender_action || "message"); return { ok: true }; },
  sleep: async () => {},
  leadMs: 1500
});
assert.deepEqual(privateCalls, ["message"]);

// No send path in the functions can post a typing action.
const files = [
  "supabase/functions/_shared/typing-plan.js",
  "supabase/functions/_shared/official-outbox.js",
  "supabase/functions/zernio-webhook/index.ts",
  "supabase/functions/ig-outbox-tick/index.ts",
  "supabase/functions/roleflow-acquisition/index.ts",
  "supabase/functions/roleflow-acquisition/ig/send.js"
];
for (const file of files) {
  const source = read(file);
  assert.doesNotMatch(source, /typing_on|typing_off|"typing"\)|\/typing"/, file);
  assert.doesNotMatch(source, /typeThenSend/, file);
}
const hook = read("supabase/functions/zernio-webhook/index.ts");
assert.match(hook, /seenGate\.open\) await markSeen\(/);
assert.match(hook, /pauseThenSend\(prepared, apiKey/);

console.log("setter no-typing tests passed");
