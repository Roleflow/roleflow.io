import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  canRewindTo,
  exchangeStart,
  rewindTrial,
  trialHistory,
  trialVoiceOutcome
} from "../acquire/trial-thread.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const thread = [
  { role: "user", text: "hey" },
  { role: "assistant", text: "hi there" },
  { role: "assistant", text: "what do you sell?" },
  { role: "user", text: "coaching", voice: { transcript: "I sell coaching", language: "en" } },
  { role: "assistant", text: "cool" },
  { role: "assistant", text: "which city?" }
];

// Undo removes the last lead message and every setter bubble that answered it.
const start = exchangeStart(thread);
assert.equal(start, 3);
const undone = rewindTrial(thread, start);
assert.deepEqual(undone.messages.map((item) => item.text), ["hey", "hi there", "what do you sell?"]);
assert.equal(undone.draft, "I sell coaching");
assert.equal(undone.sender, "lead");
assert.equal(undone.changed, true);

// The setter's next memory is only what remains, with the voice note as its transcript.
const memory = trialHistory(undone.messages);
assert.deepEqual(memory, [
  { role: "user", content: "hey" },
  { role: "assistant", content: "hi there" },
  { role: "assistant", content: "what do you sell?" }
]);
assert.equal(memory.some((item) => item.content === "I sell coaching"), false);
assert.equal(memory.some((item) => item.content === "which city?"), false);

// Rewind to an earlier message of theirs drops that message and everything after it.
assert.equal(canRewindTo(thread[0]), true);
assert.equal(canRewindTo(thread[1]), false);
const earlier = rewindTrial(thread, 0);
assert.deepEqual(earlier.messages, []);
assert.equal(earlier.draft, "hey");
assert.deepEqual(trialHistory(earlier.messages), []);
const resent = trialHistory(earlier.messages).concat([{ role: "user", content: "hey, again" }]);
assert.deepEqual(resent, [{ role: "user", content: "hey, again" }]);

// A business line the owner inserted is its own exchange.
const withBusiness = thread.slice(0, 3).concat([{ role: "assistant", text: "we are closed today", business: true }]);
assert.equal(exchangeStart(withBusiness), 3);
const businessUndo = rewindTrial(withBusiness, 3);
assert.equal(businessUndo.messages.length, 3);
assert.equal(businessUndo.draft, "we are closed today");
assert.equal(businessUndo.sender, "business");

// A simulated follow-up comes off without deleting the question before it.
const followed = [
  { role: "user", text: "hey" },
  { role: "assistant", text: "hi" },
  { role: "assistant", text: "still there?", followup: true },
  { role: "assistant", text: "one more thing", followup: true }
];
assert.equal(exchangeStart(followed), 2);
const followUndo = rewindTrial(followed, exchangeStart(followed));
assert.deepEqual(followUndo.messages.map((item) => item.text), ["hey", "hi"]);
assert.equal(followUndo.draft, "");
assert.deepEqual(trialHistory(followUndo.messages).map((item) => item.content), ["hey", "hi"]);

// A failed transcription stays in the thread as an error and never enters memory.
const failed = [
  { role: "user", text: "hey" },
  { role: "assistant", text: "hi" },
  { role: "user", error: "That voice note could not be transcribed. Nothing was sent to the setter.", voiceError: true }
];
assert.equal(trialHistory(failed).some((item) => /transcribed/.test(item.content)), false);
assert.deepEqual(trialHistory(failed).map((item) => item.content), ["hey", "hi"]);
const errorUndo = rewindTrial(failed, exchangeStart(failed));
assert.equal(errorUndo.messages.length, 2);
assert.equal(errorUndo.draft, "");
assert.equal(canRewindTo(failed[2]), false);

// Empty and out-of-range rewinds change nothing.
assert.equal(exchangeStart([]), -1);
assert.equal(rewindTrial(thread, -1).changed, false);
assert.equal(rewindTrial(thread, 99).changed, false);
assert.deepEqual(trialHistory([{ role: "user", text: "  " }, { role: "assistant", error: "no" }]), []);

// The gate in front of the setter: only a real transcript is sent.
assert.equal(trialVoiceOutcome({ ok: false, reason: "transcribe" }).send, false);
assert.equal(trialVoiceOutcome({ ok: false, reason: "no_provider" }).reason, "no_provider");
assert.equal(trialVoiceOutcome(null).send, false);
assert.equal(trialVoiceOutcome({ ok: true, transcript: "   " }).send, false);
assert.deepEqual(trialVoiceOutcome({ ok: true, transcript: "  hola   amigo ", language: "es", duration: 4 }), {
  send: true,
  transcript: "hola amigo",
  language: "es",
  duration: 4
});

const app = read("acquire/app.js");
const sendTrial = app.slice(app.indexOf("async function sendTrial"), app.indexOf("function commentWhenForTrial"));
assert.match(sendTrial, /trialHistory\(trial\.messages\)/);
assert.match(sendTrial, /messages: history/);
assert.match(sendTrial, /voice_note: Boolean\(voice && voice\.transcript\)/);
assert.match(sendTrial, /if \(!still\(\)\) return/);
assert.match(sendTrial, /followup: Boolean\(followup\)/);
const workspace = read("acquire/setter-workspace.js");
assert.match(workspace, /setter-trial-undo/);
assert.match(workspace, /undoTrial\(ui, null\)/);
assert.match(workspace, /undoTrial\(ui, index\)/);
assert.doesNotMatch(workspace.slice(workspace.indexOf("function undoTrial"), workspace.indexOf("function voiceFailCopy")), /confirm\(/);
assert.doesNotMatch(workspace, /zernio|grok/i);

console.log("trial rewind tests passed");
