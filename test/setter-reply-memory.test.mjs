import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  MEMORY_MIN,
  closeDuplicate,
  loadMemory,
  memoryFromRows,
  memoryRule,
  ourRecentBubbles,
  repeatedBubble,
  retryRule
} from "../supabase/functions/_shared/reply-memory.js";
import { modelInbound } from "../supabase/functions/_shared/voice-transcribe.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// Regression: a test thread on 2026-11-03 from 15:09 Madrid, acq_messages rows, newest first as loaded.
const thread = [
  ["user", "2026-11-03T14:09:37Z", "What's your name btw?"],
  ["assistant", "2026-11-03T14:11:05Z", "i'm on Diego's team at Value Add Marketing, un placer."],
  ["assistant", "2026-11-03T14:11:10Z", "where would you like to take over?"],
  ["user", "2026-11-03T14:11:56Z", "So who are you?"],
  ["assistant", "2026-11-03T14:13:14Z", "un placer, i'm with the Value Add Marketing team."],
  ["assistant", "2026-11-03T14:13:20Z", "we build bilingual systems that help latino agents and loan officers dominate their market."],
  ["user", "2026-11-03T14:13:45Z", "Yes but who are you specifically, are you AI?"],
  ["assistant", "2026-11-03T14:14:03Z", "where would you like to take over?"],
  ["user", "2026-11-03T14:20:47Z", "Mas informacion"],
  ["assistant", "2026-11-03T14:22:06Z", "hola, un placer."],
  ["user", "2026-11-03T14:22:45Z", "Voice note: I'd like to take over Texas and California specifically.", { voice_note: { status: "transcribed", transcript: "I'd like to take over Texas and California specifically.", language: "en" } }],
  ["user", "2026-11-03T14:23:44Z", "Texas and Cali"],
  ["assistant", "2026-11-03T14:24:00Z", "Texas and California are two massive markets, Hispanic demand out there is huge."],
  ["assistant", "2026-11-03T14:24:05Z", "any specific counties or cities you want to start with?"],
  ["user", "2026-11-03T14:24:18Z", "Not really, I'm an LO"]
].map(([role, at, body, metadata]) => ({ role, body, created_at: at, metadata: metadata || {} })).reverse();
const queued = [{ id: "q1", payload: { text: "Diego personally reviews them and takes the calls." }, run_at: "2026-11-03T14:24:30Z" }];

const memory = memoryFromRows(thread, queued);
// Oldest first, both sides, every split bubble on its own, queued text last.
assert.equal(memory.length, 16);
assert.ok(memory.length >= MEMORY_MIN);
assert.equal(memory[0].text, "What's your name btw?");
assert.equal(memory[0].from, "lead");
assert.equal(memory[1].from, "us");
assert.equal(memory[14].text, "Not really, I'm an LO");
assert.deepEqual(memory[15], { from: "us", at: "2026-11-03T14:24:30Z", text: "Diego personally reviews them and takes the calls.", queued: true });
assert.equal(memory[10].voice_transcript, "I'd like to take over Texas and California specifically.");
for (let index = 1; index < 15; index += 1) assert.ok(Date.parse(memory[index].at) >= Date.parse(memory[index - 1].at));

// Meta path rows (ig_messages) map the same way.
const meta = memoryFromRows([{ direction: "in", body: "hey", created_at: "2026-11-03T10:00:00Z" }, { direction: "out", body: "hi there", created_at: "2026-11-03T10:01:00Z" }], []);
assert.deepEqual(meta.map((item) => item.from), ["lead", "us"]);

// Keeps the newest 20 when the thread is longer, never fewer than 10.
const long = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", body: "m" + index, created_at: new Date(Date.UTC(2026, 10, 3, 10, index)).toISOString() }));
const trimmed = memoryFromRows(long, []);
assert.equal(trimmed.length, 20);
assert.equal(trimmed[19].text, "m29");
assert.equal(memoryFromRows(long, [], { limit: 3 }).length, 10);

// What the model received before (latest message only) and now.
const before = { inbound: "Not really, I'm an LO", state: "qualification", attributes: {} };
const now = modelInbound({ ...before, recent_messages: memory }, null);
assert.equal(Object.keys(before).includes("recent_messages"), false);
assert.equal(now.recent_messages.length, 16);
assert.equal(now.inbound, "Not really, I'm an LO");

// The explicit instruction.
const rule = memoryRule();
assert.match(rule, /Answer the lead's latest message directly/);
assert.match(rule, /Do not repeat any question, phrase, greeting/);
assert.match(rule, /un placer/);
assert.match(rule, /Do not re-ask anything the lead already answered/);
assert.match(rule, /language of the lead's latest message/);

// Duplicate check against our last 5 bubbles (sent or queued).
const ours = ourRecentBubbles(memory);
assert.equal(ours.length, 5);
assert.equal(ours[4], "Diego personally reviews them and takes the calls.");
// The repeat sent at 15:24:38 Madrid is caught.
assert.equal(repeatedBubble("Texas and California are massive markets, Hispanic demand in both is huge.\n\nany particular cities or counties you want to focus on first?", ours), "Texas and California are massive markets, Hispanic demand in both is huge.");
assert.equal(closeDuplicate("un placer, i'm with the Value Add Marketing team.", "i'm on Diego's team at Value Add Marketing, un placer."), true);
assert.equal(closeDuplicate("where would you like to take over?", "Where would you like to take over"), true);
// A fresh answer passes; short acknowledgements only match when identical.
assert.equal(repeatedBubble("got it, LO side. which city are you originating most of your loans in?", ours), "");
assert.equal(closeDuplicate("got it", "got it, thanks"), false);
assert.equal(repeatedBubble("", ours), "");
assert.match(retryRule("hola, un placer."), /repeated something we already sent: "hola, un placer\."/);

// Loader: acq_messages for the gateway path, ig_messages for the Meta path, queued rows minus the job.
function fakeDb(tables) {
  const calls = [];
  const from = (table) => {
    const query = { table, filters: [] };
    const chain = {
      select: () => chain,
      eq: (key, value) => { query.filters.push([key, value]); return chain; },
      in: (key, value) => { query.filters.push([key, value]); return chain; },
      order: () => chain,
      limit: (count) => { query.limit = count; calls.push(query); return Promise.resolve({ data: tables[table] || [], error: null }); }
    };
    return chain;
  };
  return { from, calls };
}
const db = fakeDb({ acq_messages: thread, ig_outbox: [{ id: "job", payload: { text: "" } }, ...queued] });
const loaded = await loadMemory(db, { businessId: "b", conversationRowId: "c", threadId: "t", excludeId: "job" });
assert.equal(loaded.length, 16);
assert.deepEqual(db.calls.map((call) => call.table), ["acq_messages", "ig_outbox"]);
assert.equal(db.calls[0].limit, 20);
const metaDb = fakeDb({ ig_messages: [{ direction: "in", body: "hey", created_at: "2026-11-03T10:00:00Z" }] });
assert.equal((await loadMemory(metaDb, { businessId: "b", threadId: "t", excludeId: "x" })).length, 1);
assert.deepEqual(metaDb.calls.map((call) => call.table), ["ig_messages", "ig_outbox"]);

// Wiring in both setter paths: memory in the model input, the rule in the system
// prompt, and one regeneration when a draft repeats us.
for (const file of ["supabase/functions/zernio-webhook/index.ts", "supabase/functions/roleflow-acquisition/index.ts"]) {
  const source = read(file);
  assert.match(source, /recent_messages: memory/, file);
  assert.match(source, /memoryRule\(\) \+ \(extra \|\| ""\)/, file);
  assert.match(source, /ourRecentBubbles\(memory\)/, file);
  assert.match(source, /retryRule\(repeated\)/, file);
  assert.equal((source.match(/retryRule\(repeated\)/g) || []).length, 1, file);
}

console.log("setter reply memory tests passed");
