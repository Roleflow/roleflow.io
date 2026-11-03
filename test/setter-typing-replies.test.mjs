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
  pauseThenSend,
  postSenderAction,
  repliesToProspect,
  senderActionRequest,
  textLeadMs,
  typeThenSend,
  typingLeadMs,
  waitBeforeTypingMs
} from "../supabase/functions/_shared/typing-plan.js";
import { postOfficial } from "../supabase/functions/_shared/official-outbox.js";
import { sendWithPresence, typingBody, typingOffBody } from "../supabase/functions/roleflow-acquisition/ig/send.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const row = (text, extra, kind) => ({ kind: kind || "reply", agent_enabled: true, payload: { text, conversationId: "conv 1", accountId: "acct", eventKind: "message", ...(extra || {}) } });

// Typing time scales with the bubble: 1.5 to 6 s, well under Instagram's ~20 s expiry.
assert.equal(textLeadMs("ok"), TYPING_MIN_MS);
assert.equal(textLeadMs("a".repeat(60)), 2700);
assert.equal(textLeadMs("a".repeat(900)), TYPING_MAX_MS);
assert.equal(TYPING_MIN_MS, 1500);
assert.equal(TYPING_MAX_MS, 6000);
assert.ok(TYPING_MAX_MS < TYPING_EXPIRES_MS / 2);
assert.equal(typingLeadMs({ payload: { text: "", attachmentUrl: "https://cdn.example/a.wav" } }), CLIP_TYPING_MS);

// Only a reply to a message the prospect sent may show typing.
assert.equal(repliesToProspect(row("hi")), true);
assert.equal(repliesToProspect({ kind: "reply", payload: { event_kind: "message" } }), true);
for (const kind of ["recovery", "opener", "outreach", "followup", "human", "comment_private", "comment_voice", "cta"]) {
  assert.equal(repliesToProspect(row("hi", {}, kind)), false, kind);
  assert.equal(senderActionRequest(row("hi", {}, kind), "typing"), null, kind);
}
assert.equal(repliesToProspect(row("hi", { eventKind: "comment" })), false);
assert.equal(repliesToProspect({ payload: { text: "hi" } }), false);
assert.deepEqual(senderActionRequest(row("hi"), "typing"), { path: "/inbox/conversations/conv%201/typing", body: { accountId: "acct" } });
assert.deepEqual(senderActionRequest(row("hi"), "read"), { path: "/inbox/conversations/conv%201/read", body: { accountId: "acct" } });
assert.deepEqual(senderActionRequest(row("hi", {}, "recovery"), "read"), { path: "/inbox/conversations/conv%201/read", body: { accountId: "acct" } });
assert.equal(senderActionRequest(row("hi"), "online"), null);

// Presence is best effort.
assert.equal(await postSenderAction(row("hi"), "k", "typing", async () => { throw new Error("down"); }), false);
assert.equal(await postSenderAction(row("hi"), "k", "typing", async () => ({ ok: true, json: async () => ({ success: true }) })), true);

// Seen goes to the conversation the lead wrote in, never for comments.
const seenCalls = [];
await markSeen({ kind: "message", conversationId: "c9" }, "acct", "k", async (url, init) => {
  seenCalls.push({ url, body: JSON.parse(init.body) });
  return { ok: true, json: async () => ({ success: true }) };
});
assert.deepEqual(seenCalls, [{ url: "https://zernio.com/api/v1/inbox/conversations/c9/read", body: { accountId: "acct" } }]);
assert.equal(await markSeen({ kind: "comment", conversationId: "c9" }, "acct", "k", async () => { throw new Error("no"); }), false);

// Reply bubble: typing, a 1.5 to 6 s pause, then the message.
const text = "Sounds good, what are you working on right now?";
const run = async (target) => {
  const events = [];
  await pauseThenSend(target, "k", async () => { events.push("send"); return { ok: true }; }, {
    fetchImpl: async (url) => { events.push(url.split("/").pop()); return { ok: true, json: async () => ({ success: true }) }; },
    sleep: async (ms) => { events.push("wait " + ms); }
  });
  return events;
};
assert.deepEqual(await run(row(text)), ["typing", "wait " + textLeadMs(text), "send"]);
assert.equal(typeThenSend, pauseThenSend);
// Messages we start: same pause, no typing.
assert.deepEqual(await run(row(text, {}, "recovery")), ["wait " + textLeadMs(text), "send"]);
assert.deepEqual(await run(row(text, {}, "opener")), ["wait " + textLeadMs(text), "send"]);
// Panel replies a person wrote and comment-triggered DMs: no typing, no pause.
assert.deepEqual(await run(row(text, {}, "human")), ["send"]);
assert.deepEqual(await run(row(text, {}, "comment_private")), ["send"]);
assert.deepEqual(await run(row(text, {}, "comment_voice")), ["send"]);

// A failed typing call still sends the reply.
const fallback = await pauseThenSend(row("hey"), "k", async () => ({ ok: true }), {
  fetchImpl: async () => { throw new Error("typing down"); },
  sleep: async () => {}
});
assert.equal(fallback.ok, true);

// The one-minute tick sender: typing before a reply, none before a follow-up.
const tick = async (target) => {
  const calls = [];
  const sent = await postOfficial(target, "k", async (url) => {
    calls.push(url.split("/").pop());
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  }, { sleep: async () => {} });
  assert.equal(sent.ok, true);
  return calls;
};
assert.deepEqual(await tick(row("Got it. How many leads come in per week?")), ["typing", "messages"]);
assert.deepEqual(await tick(row("Still keen to chat?", {}, "recovery")), ["messages"]);

// Spacing math.
assert.equal(waitBeforeTypingMs(20, "a".repeat(60)), 20000 - 2700);
assert.equal(waitBeforeTypingMs(0, "hi"), 0);
const now = Date.parse("2026-11-03T08:47:12.000Z");
assert.equal(nextDueInMs([{ run_at: "2026-11-03T08:47:15.000Z" }, { run_at: "2026-11-03T08:47:13.000Z" }], now, 20000), 1000);
assert.equal(nextDueInMs([{ run_at: "2026-11-03T08:48:12.000Z" }], now, 20000), null);

// Meta Graph path, replying: seen, typing on, pause, message, typing off.
const graph = async (body, typing, failSend) => {
  const events = [];
  const call = sendWithPresence(body, {
    post: async (payload) => {
      events.push(payload.sender_action || "message");
      if (failSend && !payload.sender_action) throw new Error("network");
      return { ok: true };
    },
    sleep: async (ms) => { events.push("wait " + ms); },
    leadMs: 1500,
    typing
  });
  if (failSend) await assert.rejects(call); else await call;
  return events;
};
const dm = { recipient: { id: "igsid" }, message: { text: "hey" } };
assert.deepEqual(await graph(dm, true), ["mark_seen", "typing_on", "wait 1500", "message", "typing_off"]);
assert.deepEqual(await graph(dm, true, true), ["mark_seen", "typing_on", "wait 1500", "message", "typing_off"]);
// Started by us: seen and pause, never typing.
assert.deepEqual(await graph(dm, false), ["mark_seen", "wait 1500", "message"]);
assert.deepEqual(await graph(dm, undefined), ["mark_seen", "wait 1500", "message"]);
assert.deepEqual(await graph({ recipient: { comment_id: "c1" }, message: { text: "hey" } }, true), ["message"]);
assert.deepEqual(typingBody("igsid"), { recipient: { id: "igsid" }, sender_action: "typing_on" });
assert.deepEqual(typingOffBody("igsid"), { recipient: { id: "igsid" }, sender_action: "typing_off" });

// Wiring.
const hook = read("supabase/functions/zernio-webhook/index.ts");
assert.match(hook, /seenGate\.open\) await markSeen\(/);
assert.match(hook, /pauseThenSend\(prepared, apiKey/);
assert.ok(hook.indexOf("markSeen(") > hook.indexOf("Outside office hours."), "seen only after office hours pass");
const acquisition = read("supabase/functions/roleflow-acquisition/index.ts");
assert.match(acquisition, /postGraph\(token, body, kind === "reply"\)/);
assert.match(acquisition, /typing: replying === true/);
assert.doesNotMatch(acquisition, /typingBody\(|typingOffBody\(/);

console.log("setter typing-on-replies tests passed");
