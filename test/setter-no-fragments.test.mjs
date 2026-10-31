import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DM_CHAR_LIMIT, splitReply, trimToSentence } from "../supabase/functions/_shared/split-reply.js";
import { clampBubbles } from "../supabase/functions/roleflow-acquisition/ig/send.js";
import { enqueueBody, planGatewayReply, replyText } from "../supabase/functions/_shared/ig-gateway.js";
import { completeChat, hitTokenLimit, largerBudget } from "../supabase/functions/_shared/llm-provider.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// The 31 Oct test DM: the sent text was exactly the first 30 words of the
// model's reply, so the old 30-word bubble clamp cut it after "or". The raw
// model output is not stored; the ending used here is illustrative.
const INCIDENT = "hola, mucho gusto. basically, we build bilingual systems that help agents and loan officers connect with more Latino buyers, sellers, and borrowers. are you on the real estate side or the lending side?";

test("the 31 Oct reply reaches Instagram whole, split at sentences", async () => {
  const plan = await planGatewayReply({
    thread: { state: "open", attributes: {} },
    eventKind: "message",
    text: "hola",
    now: Date.parse("2026-10-31T06:15:00Z"),
    llm: async () => JSON.stringify({ reply: INCIDENT, next_state: "open", attributes: {} })
  });
  const text = replyText(plan);
  assert.equal(text, INCIDENT);
  const parts = splitReply(text, 15);
  assert.deepEqual(parts, [
    "hola, mucho gusto.",
    "basically, we build bilingual systems that help agents and loan officers connect with more Latino buyers, sellers, and borrowers.",
    "are you on the real estate side or the lending side?"
  ]);
  assert.equal(parts.join(" "), INCIDENT);
});

test("bubbles are never cut by word count", () => {
  const long = Array.from({ length: 45 }, (_, i) => "word" + i).join(" ") + ".";
  assert.deepEqual(clampBubbles([long]), [long]);
  assert.deepEqual(clampBubbles(["  a.  ", "", null, "b?"]), ["a.", "b?"]);
  assert.equal(clampBubbles(["1", "2", "3", "4", "5"]).length, 4);
  assert.doesNotMatch(read("supabase/functions/roleflow-acquisition/ig/send.js"), /words\.slice\(0, 30\)/);
});

test("splitReply never drops text or halves a sentence to hit the word target", () => {
  const run = "are you on the real estate side or the lending side of the business right now or somewhere in between";
  assert.deepEqual(splitReply(run, 10), [run]);
  const mixed = "Thanks for the note. I can walk through the first part with you. Then I can ask what you want to change?";
  const parts = splitReply(mixed, 8);
  assert.equal(parts.join(" "), mixed);
  assert.ok(parts.every((part) => /[.!?]$/.test(part)));
});

test("every DM fits the Instagram limit and the pieces add back to the full text", () => {
  const long = Array.from({ length: 60 }, (_, i) => "This is sentence number " + i + ".").join(" ");
  for (const words of [0, 15, 400]) {
    const parts = splitReply(long, words);
    assert.ok(parts.every((part) => part.length <= DM_CHAR_LIMIT), "words=" + words);
    assert.equal(parts.join(" "), long);
    assert.ok(parts.every((part) => part.endsWith(".")));
  }
});

test("trimToSentence ends on a complete sentence", () => {
  assert.equal(trimToSentence("Short one.", 1000), "Short one.");
  const text = "First sentence here. Second sentence is a bit longer and runs past the cap";
  assert.equal(trimToSentence(text, 40), "First sentence here.");
  assert.equal(trimToSentence("one two three four five six", 12), "one two");
  const queued = enqueueBody({ kind: "message" }, "A".repeat(10) + ". " + "b ".repeat(600), "row");
  assert.equal(queued.text, "AAAAAAAAAA.");
});

test("replyText no longer slices the joined bubbles at 1000 characters", () => {
  const big = "x".repeat(700) + ".";
  assert.equal(replyText({ bubbles: [big, big] }).length, big.length * 2 + 2);
});

test("token-limit stops are detected for every provider", () => {
  assert.equal(hitTokenLimit({ stop_reason: "max_tokens" }), true);
  assert.equal(hitTokenLimit({ stop_reason: "end_turn" }), false);
  assert.equal(hitTokenLimit({ choices: [{ finish_reason: "length" }] }), true);
  assert.equal(hitTokenLimit({ choices: [{ finish_reason: "stop" }] }), false);
  assert.equal(hitTokenLimit({ candidates: [{ finishReason: "MAX_TOKENS" }] }), true);
  assert.equal(hitTokenLimit(null), false);
  assert.equal(largerBudget(undefined), 4096);
  assert.equal(largerBudget(2000), 8000);
  assert.equal(largerBudget(12000), 16000);
});

function anthropicReply(text, stop) {
  return { ok: true, json: async () => ({ content: [{ type: "text", text }], stop_reason: stop, usage: { input_tokens: 1, output_tokens: 1 } }) };
}

const runtime = { provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "test-key", source: "own" };

test("a Claude reply cut at max_tokens is retried with a larger budget", async () => {
  const budgets = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    budgets.push(body.max_tokens);
    return budgets.length === 1 ? anthropicReply("{\"reply\": \"are you on the real estate side or", "max_tokens") : anthropicReply("{\"reply\": \"done?\"}", "end_turn");
  };
  const result = await completeChat({ runtime, system: "s", messages: [{ role: "user", content: "hi" }], fetchImpl });
  assert.equal(result.text, "{\"reply\": \"done?\"}");
  assert.deepEqual(budgets, [1024, 4096]);
});

test("a reply still cut off after the retry is never returned", async () => {
  let calls = 0;
  const errors = [];
  const fetchImpl = async () => { calls += 1; return anthropicReply("are you on the real estate side or", "max_tokens"); };
  await assert.rejects(
    completeChat({ runtime, system: "s", messages: [{ role: "user", content: "hi" }], fetchImpl, onError: (info) => errors.push(info) }),
    /cut off/
  );
  assert.equal(calls, 2);
  assert.equal(errors.length, 1);
});

test("key checks with a tiny budget still accept a short cut-off answer", async () => {
  const fetchImpl = async () => anthropicReply("pong", "max_tokens");
  const result = await completeChat({ runtime, system: "s", messages: [{ role: "user", content: "ping" }], maxTokens: 16, allowCutOff: true, fetchImpl });
  assert.equal(result.text, "pong");
  assert.match(read("supabase/functions/llm-check/index.ts"), /allowCutOff: true/);
});

test("panel and edge copies of splitReply stay identical", () => {
  assert.equal(read("acquire/split-reply.js"), read("supabase/functions/_shared/split-reply.js"));
});
