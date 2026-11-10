import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TRIAL_VOICE_MAX_BYTES, TRIAL_VOICE_MAX_MS, trialVoiceOutcome } from "../acquire/trial-thread.js";
import {
  VOICE_MAX_BYTES,
  VOICE_MAX_SECONDS,
  judgeTranscript,
  transcribeAudio,
  transcribeTrialVoice,
  trialVoiceError
} from "../supabase/functions/_shared/voice-transcribe.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const audioBytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32]);
const sttOk = (body) => ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => body });

assert.equal(TRIAL_VOICE_MAX_BYTES, VOICE_MAX_BYTES);
assert.equal(TRIAL_VOICE_MAX_MS, VOICE_MAX_SECONDS * 1000);

// Practice audio uses the same speech-to-text request as a downloaded Instagram note.
const calls = [];
const heard = await transcribeTrialVoice({
  base64: Buffer.from(audioBytes).toString("base64"),
  mime: "application/octet-stream"
}, { XAI_API_KEY: "xai-secretvalue123" }, {
  retryMs: 0,
  fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return sttOk({ text: "  I want the Texas  plan. ", language: "en", duration: 3.5 });
  }
});
assert.equal(heard.ok, true);
assert.equal(heard.text, "I want the Texas plan.");
assert.equal(heard.language, "en");
assert.equal(heard.provider, "xai");
assert.equal(calls.length, 1);
assert.equal(calls[0].url, "https://api.x.ai/v1/stt");
assert.equal(calls[0].init.headers.Authorization, "Bearer xai-secretvalue123");
assert.equal(calls[0].init.body.get("model"), "grok-voice-transcribe-2.0");
const direct = await transcribeAudio({ bytes: audioBytes, mime: "audio/mp4" }, { XAI_API_KEY: "xai-secretvalue123" }, {
  retryMs: 0,
  fetchImpl: async () => sttOk({ text: "I want the Texas plan.", language: "en", duration: 3.5 })
});
assert.equal(judgeTranscript(direct).text, heard.text);

// Failures produce no transcript, so the setter is not called.
let fetched = false;
const noFetch = async () => { fetched = true; return sttOk({ text: "should not run" }); };
const tooBig = await transcribeTrialVoice({ bytes: new Uint8Array(32), mime: "audio/webm" }, { XAI_API_KEY: "x" }, { maxBytes: 8, fetchImpl: noFetch });
assert.deepEqual(tooBig, { ok: false, reason: "too_long" });
assert.equal(fetched, false);
const garbage = await transcribeTrialVoice({ base64: "!!!!", mime: "audio/webm" }, { XAI_API_KEY: "x" }, { fetchImpl: noFetch });
assert.deepEqual(garbage, { ok: false, reason: "transcribe" });
const silent = await transcribeTrialVoice({ bytes: audioBytes, mime: "audio/mp4" }, { XAI_API_KEY: "x" }, {
  retryMs: 0,
  fetchImpl: async () => sttOk({ text: "   ", duration: 1 })
});
assert.deepEqual(silent, { ok: false, reason: "empty" });
const missing = await transcribeTrialVoice({ bytes: audioBytes, mime: "audio/mp4" }, {}, { fetchImpl: noFetch });
assert.deepEqual(missing, { ok: false, reason: "no_provider" });
const broken = await transcribeTrialVoice({ bytes: audioBytes, mime: "audio/mp4" }, { XAI_API_KEY: "x" }, {
  retryMs: 0,
  fetchImpl: async () => ({ ok: false, status: 500, text: async () => "no" })
});
assert.deepEqual(broken, { ok: false, reason: "transcribe" });
for (const reason of ["empty", "too_long", "no_provider", "transcribe", "other"]) {
  const line = trialVoiceError(reason);
  assert.match(line, /Nothing was sent to the setter\./);
  assert.doesNotMatch(line, /grok|zernio|xai|api\.x\.ai/i);
}
assert.equal(trialVoiceOutcome(silent).send, false);
const clientResult = { ok: true, transcript: heard.text, language: heard.language, duration: heard.duration };
assert.equal(trialVoiceOutcome(clientResult).send, true);
assert.equal(trialVoiceOutcome(clientResult).transcript, "I want the Texas plan.");

const dashboard = read("supabase/functions/client-dashboard/index.ts");
const trialFn = dashboard.slice(dashboard.indexOf("async function transcribeTrial"), dashboard.indexOf("async function saveCommentVoice"));
assert.match(trialFn, /transcribeTrialVoice\(/);
assert.match(trialFn, /Deno\.env\.get\("XAI_API_KEY"\)/);
assert.match(trialFn, /sent: false/);
assert.doesNotMatch(trialFn, /ig_outbox|acq_contacts|acq_messages|instagram|zernio|graph\.facebook/i);
assert.doesNotMatch(trialFn, /provider:|heard\.provider/);
assert.match(dashboard, /action === "transcribe_trial"/);
assert.match(dashboard, /body\.voice_note === true \? VOICE_MAX_CHARS : 500/);
assert.match(dashboard, /voiceRule\(\{ transcribed: true/);
const live = read("supabase/functions/zernio-webhook/index.ts");
assert.match(live, /understandVoice\(job\.event\.voice/);
assert.match(read("supabase/functions/_shared/voice-transcribe.js"), /return judgeTranscript\(heard\)/);

const app = read("acquire/app.js");
const client = app.slice(app.indexOf("async function transcribeTrial"), app.indexOf("async function sendTrial"));
assert.match(client, /action: "transcribe_trial"/);
assert.doesNotMatch(client, /x\.ai|XAI_|grok|zernio/i);
const workspace = read("acquire/setter-workspace.js");
const accept = workspace.slice(workspace.indexOf("async function acceptTrialVoice"), workspace.indexOf("function showTrialVoiceError"));
assert.match(accept, /trialVoiceOutcome\(result\)/);
assert.ok(accept.indexOf("if (!outcome.send)") < accept.indexOf("ui.sendTrial"), "a failed transcript never reaches the setter");
assert.match(workspace, /setter-trial-mic/);
assert.match(workspace, /setter-trial-file/);
assert.match(workspace, /MediaRecorder/);
assert.match(workspace, /dm-transcript/);
assert.doesNotMatch(workspace, /zernio|grok|api\.x\.ai|XAI_API_KEY/i);

console.log("trial voice tests passed");
