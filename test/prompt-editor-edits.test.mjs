import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EDIT_MAX_TOKENS,
  REWRITE_MAX_TOKENS,
  applyPromptEdits,
  editBudget,
  editFailureMessage,
  editRequest,
  fetchWithDeadline,
  locate,
  retryNote,
  wantsRewrite
} from "../supabase/functions/_shared/prompt-edits.js";
import { completeChat } from "../supabase/functions/_shared/llm-provider.js";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

// A prompt as long as the longest live one (Value Add Marketing, 30,718 chars).
const filler = Array.from({ length: 500 }, (_, i) => "Rule " + i + ": keep it short, one question at a time, and stay lowercase.").join("\n");
const tail = "## SECTION 11: PRE-FLIGHT AUDIT MATRIX\n1. Does the message contain one question mark?";
const long = "# ROLE\nYou are the setter. Price is $997 per month.\nBooking: https://link.example.com/widget/bookings/call\n" + filler + "\n" + tail;
assert.ok(long.length > 30718);

// The whole prompt goes to the model (the old editor cut it at 30,000 chars and lost the end).
const request = editRequest(long, "make the tone warmer");
assert.ok(request.includes(tail));
assert.ok(request.includes("Do not return the whole prompt"));
assert.match(request, /Leave every other word, price, link, and line exactly as it is/);

// A targeted edit changes only the asked part; everything else is byte-for-byte the same.
const edited = applyPromptEdits(long, [{ op: "replace", find: "You are the setter.", replace: "You are the friendly setter." }]);
assert.equal(edited.ok, true);
assert.equal(edited.changed, true);
assert.equal(edited.prompt, long.replace("You are the setter.", "You are the friendly setter."));
assert.ok(edited.prompt.includes("Price is $997 per month."));
assert.ok(edited.prompt.endsWith(tail));

// insert_after, delete, append.
const more = applyPromptEdits(long, [
  { op: "insert_after", find: "Price is $997 per month.", text: "Never discount." },
  { op: "delete", find: "Rule 7: keep it short, one question at a time, and stay lowercase.\n" },
  { op: "append", text: "Always sign off with the first name." }
]);
assert.equal(more.ok, true);
assert.ok(more.prompt.includes("Price is $997 per month.\nNever discount."));
assert.ok(!more.prompt.includes("Rule 7:"));
assert.ok(more.prompt.endsWith("Always sign off with the first name."));
assert.ok(more.prompt.includes("Rule 70:"));

// Tolerant match for spacing and curly quotes, but it must be unique.
assert.deepEqual(locate("Say \u201chi\u201d   there.", "Say \"hi\" there."), { start: 0, end: 17 });
assert.equal(locate("a b a b", "a b").error, "appears more than once");
assert.equal(locate("abc", "zzz").error, "not found");

// All or nothing: one bad find means no change at all.
const partial = applyPromptEdits(long, [
  { op: "replace", find: "You are the setter.", replace: "X" },
  { op: "replace", find: "text that is not in the prompt", replace: "Y" }
]);
assert.equal(partial.ok, false);
assert.equal(partial.prompt, long);
assert.match(retryNote(partial.failed), /not found/);
assert.equal(applyPromptEdits(long, [{ op: "replace", find: "keep it short", replace: "x" }]).ok, false);

// A no-op is reported as no change.
assert.equal(applyPromptEdits("abc", [{ op: "replace", find: "abc", replace: "abc" }]).changed, false);

// Full rewrites only when the owner asks for one, with a bigger budget.
assert.equal(wantsRewrite("make the opener warmer"), false);
assert.equal(wantsRewrite("rewrite the whole prompt"), true);
assert.equal(wantsRewrite("reescribe todo el prompt desde cero"), true);
assert.deepEqual(editBudget("fix the typo in stage 2"), { maxTokens: EDIT_MAX_TOKENS, timeoutMs: 55000 });
assert.equal(editBudget("rewrite the entire prompt").maxTokens, REWRITE_MAX_TOKENS);
assert.match(editRequest(long, "rewrite the whole prompt"), /"op": "rewrite"/);
assert.equal(applyPromptEdits("old", [{ op: "rewrite", text: "new whole prompt" }]).prompt, "new whole prompt");

// Clear messages for timeouts and cut-offs.
assert.match(editFailureMessage({ name: "TimeoutError", message: "signal timed out" }), /took too long/);
assert.match(editFailureMessage({ code: "cut_off" }), /too large for one step/);

// The deadline reaches the model request through completeChat's fetchImpl.
let seenSignal = null;
const fakeFetch = async (_url, init) => {
  seenSignal = init.signal;
  return new Response(JSON.stringify({ choices: [{ message: { content: "{\"summary\":\"ok\",\"edits\":[]}" }, finish_reason: "stop" }] }), { status: 200 });
};
await completeChat({
  runtime: { provider: "openai", model: "gpt-test", apiKey: "k" },
  system: "s",
  messages: [{ role: "user", content: "u" }],
  json: true,
  maxTokens: EDIT_MAX_TOKENS,
  fetchImpl: fetchWithDeadline(1000, fakeFetch)
});
assert.ok(seenSignal && typeof seenSignal.aborted === "boolean");

// The function: edits only, full prompt in, no 30,000-char cut, budget and deadline used.
const studio = read("supabase/functions/roleflow-studio/index.ts");
assert.doesNotMatch(studio, /prompt\.slice\(0, 30000\)/);
assert.doesNotMatch(studio, /full rewritten prompt/);
assert.match(studio, /applyPromptEdits\(original, edits\)/);
assert.match(studio, /maxTokens: budget\.maxTokens/);
assert.match(studio, /fetchImpl: fetchWithDeadline\(budget\.timeoutMs\)/);
assert.match(studio, /chain: setter\.chain\.slice\(0, 2\)/);
assert.match(studio, /event: "prompt_edit"/);

// The panel: one request at a time, locked prompt box, elapsed time, business guard.
const desk = read("acquire/setter-workspace.js");
assert.match(desk, /if \(desk\.aiBusy\) return;/);
assert.match(desk, /area\.readOnly = true/);
assert.match(desk, /send\.disabled = true/);
assert.match(desk, /Math\.round\(\(Date\.now\(\) - started\) \/ 1000\) \+ "s"/);
assert.match(desk, /ui\.state\.businessId !== target/);
const app = read("acquire/app.js");
assert.match(app, /callStudio\("edit", \{ prompt, instruction \}, \{ quiet: true \}\)/);
assert.match(app, /if \(!stillOn\(state, target\)\) return \{ error: "", stale: true \};/);
console.log("prompt editor edits: ok");
