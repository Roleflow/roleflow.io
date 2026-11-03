import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CLIP_TYPING_MS,
  TYPING_EXPIRES_MS,
  TYPING_MAX_MS,
  TYPING_MIN_MS,
  markSeen,
  nextDueInMs,
  postSenderAction,
  senderActionRequest,
  textLeadMs,
  typeThenSend,
  typingLeadMs,
  waitBeforeTypingMs
} from "../supabase/functions/_shared/typing-plan.js";
import { postOfficial } from "../supabase/functions/_shared/official-outbox.js";
import { sendWithPresence, typingOffBody } from "../supabase/functions/roleflow-acquisition/ig/send.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const row = (text, extra) => ({ kind: "reply", agent_enabled: true, payload: { text, conversationId: "conv 1", accountId: "acct", ...(extra || {}) } });

// Typing time scales with the bubble and stays well under Instagram's ~20 s expiry.
assert.equal(textLeadMs("ok"), TYPING_MIN_MS);
assert.equal(textLeadMs("a".repeat(60)), 2700);
assert.equal(textLeadMs("a".repeat(900)), TYPING_MAX_MS);
assert.ok(TYPING_MAX_MS < TYPING_EXPIRES_MS / 2);
assert.equal(typingLeadMs({ payload: { text: "", attachmentUrl: "https://cdn.example/a.wav" } }), CLIP_TYPING_MS);
assert.equal(typingLeadMs({ payload: {} }), 0);

// Endpoints: typing and read on the conversation, nothing for comment private replies.
assert.deepEqual(senderActionRequest(row("hi"), "typing"), { path: "/inbox/conversations/conv%201/typing", body: { accountId: "acct" } });
assert.deepEqual(senderActionRequest(row("hi"), "read"), { path: "/inbox/conversations/conv%201/read", body: { accountId: "acct" } });
assert.equal(senderActionRequest({ ...row("hi"), kind: "comment_private" }, "typing"), null);
assert.equal(senderActionRequest({ ...row("hi"), kind: "comment_voice" }, "read"), null);
assert.equal(senderActionRequest({ ...row("hi"), kind: "human" }, "typing"), null);
assert.equal(senderActionRequest(row("hi", { conversationId: "" }), "typing"), null);
assert.equal(senderActionRequest(row("hi"), "online"), null);

// Presence is best effort: a failing call never throws.
assert.equal(await postSenderAction(row("hi"), "k", "typing", async () => { throw new Error("down"); }), false);
assert.equal(await postSenderAction(row("hi"), "k", "typing", async () => ({ ok: true, json: async () => ({ success: false }) })), false);
assert.equal(await postSenderAction(row("hi"), "k", "typing", async () => ({ ok: true, json: async () => ({ success: true }) })), true);
assert.equal(await postSenderAction(row("hi"), "", "typing", async () => { throw new Error("no key, no call"); }), false);

// Seen goes to the conversation the lead wrote in, never for comments.
const seenCalls = [];
await markSeen({ kind: "message", conversationId: "c9" }, "acct", "k", async (url, init) => {
  seenCalls.push({ url, body: JSON.parse(init.body) });
  return { ok: true, json: async () => ({ success: true }) };
});
assert.deepEqual(seenCalls, [{ url: "https://zernio.com/api/v1/inbox/conversations/c9/read", body: { accountId: "acct" } }]);
assert.equal(await markSeen({ kind: "comment", conversationId: "c9" }, "acct", "k", async () => { throw new Error("no"); }), false);

// Order per bubble: typing, a short pause, then the message.
const events = [];
const result = await typeThenSend(row("Sounds good, what are you working on right now?"), "k", async () => {
  events.push("send");
  return { ok: true };
}, {
  fetchImpl: async (url) => { events.push(url.split("/").pop()); return { ok: true, json: async () => ({ success: true }) }; },
  sleep: async (ms) => { events.push("wait " + ms); }
});
assert.equal(result.ok, true);
assert.deepEqual(events, ["typing", "wait " + textLeadMs("Sounds good, what are you working on right now?"), "send"]);

// A failed typing call still sends the reply.
const fallback = await typeThenSend(row("hey"), "k", async () => ({ ok: true }), {
  fetchImpl: async () => { throw new Error("typing down"); },
  sleep: async () => {}
});
assert.equal(fallback.ok, true);

// The shared sender used by the one-minute tick types right before each message.
const tickCalls = [];
const tickSlept = [];
const sent = await postOfficial(row("Got it. How many leads come in per week?"), "k", async (url) => {
  tickCalls.push(url.split("/").pop());
  return { ok: true, status: 200, json: async () => ({ success: true }) };
}, { sleep: async (ms) => { tickSlept.push(ms); } });
assert.equal(sent.ok, true);
assert.deepEqual(tickCalls, ["typing", "messages"]);
assert.equal(tickSlept.length, 1);

// The configured delay is spent silent; typing only covers the last few seconds.
assert.equal(waitBeforeTypingMs(20, "a".repeat(60)), 20000 - 2700);
assert.equal(waitBeforeTypingMs(1, "a".repeat(200)), 0);
assert.equal(waitBeforeTypingMs(0, "hi"), 0);

// Follow-up bubbles due soon go out from the same request; far ones wait for the tick.
const now = Date.parse("2026-11-03T08:47:12.000Z");
assert.equal(nextDueInMs([{ run_at: "2026-11-03T08:47:15.000Z" }, { run_at: "2026-11-03T08:47:13.000Z" }], now, 20000), 1000);
assert.equal(nextDueInMs([{ run_at: "2026-11-03T08:47:00.000Z" }], now, 20000), 0);
assert.equal(nextDueInMs([{ run_at: "2026-11-03T08:48:12.000Z" }], now, 20000), null);
assert.equal(nextDueInMs([], now, 20000), null);

// Meta Graph path: seen, typing on, pause, message, typing off.
const graph = [];
const ok = await sendWithPresence({ recipient: { id: "igsid" }, message: { text: "hey" } }, {
  post: async (payload) => { graph.push(payload.sender_action || "message"); return { ok: true }; },
  sleep: async (ms) => { graph.push("wait " + ms); },
  leadMs: 1500
});
assert.equal(ok.ok, true);
assert.deepEqual(graph, ["mark_seen", "typing_on", "wait 1500", "message", "typing_off"]);
assert.deepEqual(typingOffBody("igsid"), { recipient: { id: "igsid" }, sender_action: "typing_off" });

// Typing off still goes out when the message send throws.
const failed = [];
await assert.rejects(sendWithPresence({ recipient: { id: "igsid" }, message: { text: "hey" } }, {
  post: async (payload) => {
    failed.push(payload.sender_action || "message");
    if (!payload.sender_action) throw new Error("network");
    return { ok: true };
  },
  sleep: async () => {},
  leadMs: 1500
}));
assert.equal(failed[failed.length - 1], "typing_off");

// Comment private replies (no recipient id) get no sender actions.
const privateCalls = [];
await sendWithPresence({ recipient: { comment_id: "c1" }, message: { text: "hey" } }, {
  post: async (payload) => { privateCalls.push(payload.sender_action || "message"); return { ok: true }; },
  sleep: async () => {},
  leadMs: 1500
});
assert.deepEqual(privateCalls, ["message"]);

// Wiring: the webhook marks seen behind the DM gate, types per bubble, and never
// starts typing before the configured wait.
const hook = read("supabase/functions/zernio-webhook/index.ts");
assert.match(hook, /seenGate\.open\) await markSeen\(/);
assert.match(hook, /typeThenSend\(prepared, apiKey/);
assert.match(hook, /waitBeforeTypingMs\(wait, payload\.text\)/);
assert.match(hook, /nextDueInMs\(/);
assert.ok(hook.indexOf("markSeen(") > hook.indexOf("Outside office hours."), "seen only after office hours pass");
const acquisition = read("supabase/functions/roleflow-acquisition/index.ts");
assert.match(acquisition, /sendWithPresence\(body/);
assert.doesNotMatch(acquisition, /typingBody\(|seenBody\(/);

console.log("setter typing tests passed");
