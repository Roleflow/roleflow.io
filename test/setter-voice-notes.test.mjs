import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  VOICE_FAILED_BODY,
  VOICE_MAX_BYTES,
  VOICE_MAX_CHARS,
  VOICE_MAX_SECONDS,
  downloadVoice,
  inboundText,
  languageName,
  metaVoiceAttachment,
  modelInbound,
  transcribeAudio,
  transcribers,
  understandVoice,
  voiceAttachment,
  voiceBody,
  voiceFailureMessage,
  voiceMetadata,
  voiceRule
} from "../supabase/functions/_shared/voice-transcribe.js";
import { inboundStoreBody, normalizeEvent, planPayload, voiceRefreshRequest } from "../supabase/functions/_shared/ig-gateway.js";
import { extractEvents } from "../supabase/functions/roleflow-acquisition/ig/webhook.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const audioBytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
const okAudio = () => ({ ok: true, status: 200, headers: new Headers({ "content-type": "audio/mp4", "content-length": "8" }), arrayBuffer: async () => audioBytes.buffer });
const sttOk = (body) => ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => body });

// Webhook payload: an Instagram voice note is an audio attachment with no text.
const payload = {
  id: "evt_1",
  event: "message.received",
  account: { accountId: "acct" },
  message: {
    id: "msg_1",
    conversationId: "conv_1",
    platform: "instagram",
    direction: "incoming",
    text: null,
    attachments: [{ type: "audio", url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1" }],
    sender: { id: "lead_1", username: "lead" }
  }
};
const event = normalizeEvent(payload, "");
assert.equal(event.text, "");
assert.deepEqual(event.voice, { url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1", index: 0, mimeType: "", messageId: "msg_1" });
assert.equal(inboundStoreBody(event), "Voice note");
assert.equal(inboundStoreBody({ text: "hola" }), "hola");
assert.equal(planPayload(event, "row").needsPlan, true);
const refresh = voiceRefreshRequest(event, "key");
assert.equal(refresh.url, "https://zernio.com/api/v1/inbox/conversations/conv_1/messages/msg_1/attachments/0?accountId=acct");
assert.equal(refresh.headers.Authorization, "Bearer key");
assert.equal(voiceRefreshRequest(event, ""), null);

// Only real audio counts. Shared reels, posts and stickers are not voice notes.
assert.equal(voiceAttachment([{ type: "video", url: "https://x/a.mp4", originalType: "ig_reel" }]), null);
assert.equal(voiceAttachment([{ type: "share", url: "https://x/p" }]), null);
assert.equal(voiceAttachment([{ type: "audio", url: "https://x/a", originalType: "unsupported_type" }]), null);
assert.equal(voiceAttachment([{ type: "audio", url: "http://insecure/a" }]), null);
assert.equal(voiceAttachment([{ type: "image", url: "https://x/i" }, { type: "audio", url: "https://x/a" }]).index, 1);
assert.equal(normalizeEvent({ ...payload, message: { ...payload.message, text: "hi", attachments: [] } }, "").voice, undefined);

// Meta's own webhook: the audio link no longer becomes the lead's "text".
const metaEvents = extractEvents({ entry: [{ id: "ig", messaging: [{ sender: { id: "lead" }, timestamp: 1, message: { mid: "m1", attachments: [{ type: "audio", payload: { url: "https://cdn.fb/v.mp4" } }] } }] }] });
assert.equal(metaEvents[0].text, "");
assert.equal(metaEvents[0].voice.url, "https://cdn.fb/v.mp4");
assert.equal(metaVoiceAttachment({ attachments: [{ type: "image", payload: { url: "https://cdn.fb/i.jpg" } }] }), null);

// Providers: the existing platform keys, xAI first, OpenAI as fallback.
assert.deepEqual(transcribers({}), []);
assert.deepEqual(transcribers({ XAI_API_KEY: "x", OPENAI_API_KEY: "o" }).map((item) => item.name), ["xai", "openai"]);
assert.deepEqual(transcribers({ OPENAI_API_KEY: "o" }).map((item) => item.name), ["openai"]);

// Happy path: download, transcribe with xAI, keep the language.
const calls = [];
const heard = await understandVoice(event.voice, { XAI_API_KEY: "x" }, {
  fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith("https://lookaside")) return okAudio();
    return sttOk({ text: " Hola, quiero  saber cuánto cuesta el programa. ", language: "es", duration: 6.2 });
  }
});
assert.equal(heard.ok, true);
assert.equal(heard.text, "Hola, quiero saber cuánto cuesta el programa.");
assert.equal(heard.language, "es");
assert.equal(heard.provider, "xai");
assert.equal(calls[1].url, "https://api.x.ai/v1/stt");
assert.equal(calls[1].init.headers.Authorization, "Bearer x");
assert.ok(calls[1].init.body instanceof FormData);
assert.equal(calls[1].init.body.get("model"), "grok-voice-transcribe-2.0");
assert.ok(calls[1].init.body.get("file"));

// xAI down: OpenAI fallback.
const fallback = await transcribeAudio({ bytes: audioBytes, mime: "audio/mp4" }, { XAI_API_KEY: "x", OPENAI_API_KEY: "o" }, {
  fetchImpl: async (url) => url.includes("x.ai") ? { ok: false, status: 503 } : sttOk({ text: "I want to book a call", language: "english", duration: 3 })
});
assert.equal(fallback.ok, true);
assert.equal(fallback.provider, "openai");

// Failures never produce a guessed reply.
const noKey = await understandVoice(event.voice, {}, { fetchImpl: async () => okAudio() });
assert.deepEqual(noKey, { ok: false, reason: "no_provider" });
const gone = await understandVoice(event.voice, { XAI_API_KEY: "x" }, { fetchImpl: async () => ({ ok: false, status: 403 }) });
assert.deepEqual(gone, { ok: false, reason: "download" });
const broken = await understandVoice(event.voice, { XAI_API_KEY: "x" }, { fetchImpl: async (url) => url.startsWith("https://lookaside") ? okAudio() : { ok: false, status: 500 } });
assert.deepEqual(broken, { ok: false, reason: "transcribe" });
const long = await understandVoice(event.voice, { XAI_API_KEY: "x" }, { fetchImpl: async (url) => url.startsWith("https://lookaside") ? okAudio() : sttOk({ text: "hola", language: "es", duration: VOICE_MAX_SECONDS + 1 }) });
assert.deepEqual(long, { ok: false, reason: "too_long" });
const silent = await understandVoice(event.voice, { XAI_API_KEY: "x" }, { fetchImpl: async (url) => url.startsWith("https://lookaside") ? okAudio() : sttOk({ text: "  ", duration: 2 }) });
assert.deepEqual(silent, { ok: false, reason: "empty" });
const wordy = await understandVoice(event.voice, { XAI_API_KEY: "x" }, { fetchImpl: async (url) => url.startsWith("https://lookaside") ? okAudio() : sttOk({ text: "a ".repeat(VOICE_MAX_CHARS), duration: 60 }) });
assert.deepEqual(wordy, { ok: false, reason: "too_long" });
const thrown = await understandVoice(event.voice, { XAI_API_KEY: "x" }, { fetchImpl: async () => { throw new Error("network"); } });
assert.deepEqual(thrown, { ok: false, reason: "download" });

// Too large to download is too long, checked before reading the body.
const huge = await downloadVoice(event.voice, { fetchImpl: async () => ({ ok: true, headers: new Headers({ "content-type": "audio/mp4", "content-length": String(VOICE_MAX_BYTES + 1) }), arrayBuffer: async () => { throw new Error("must not read"); } }) });
assert.deepEqual(huge, { ok: false, reason: "too_long" });

// An expired CDN link is re-minted through the inbox (JSON with a fresh url).
const minted = [];
const renewed = await downloadVoice(event.voice, {
  refresh,
  fetchImpl: async (url, init) => {
    minted.push({ url, auth: init && init.headers && init.headers.Authorization });
    if (url.startsWith("https://lookaside")) return { ok: false, status: 403 };
    if (url.includes("/attachments/0")) return { ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ url: "https://cdn.fresh/a.mp4" }) };
    return okAudio();
  }
});
assert.equal(renewed.ok, true);
assert.deepEqual(minted.map((item) => item.url), ["https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1", refresh.url, "https://cdn.fresh/a.mp4"]);
assert.equal(minted[1].auth, "Bearer key");
assert.equal(minted[2].auth, undefined);

// What the model and the panel get.
assert.equal(inboundText("", "quiero info"), "quiero info");
assert.equal(inboundText("mira", "quiero info"), "mira\n\nquiero info");
assert.equal(voiceBody("", "quiero info"), "Voice note: quiero info");
assert.equal(voiceBody("mira", "quiero info"), "mira\n\nVoice note: quiero info");
assert.deepEqual(voiceMetadata({ text: "t", language: "es", duration: 4, provider: "xai" }), { voice_note: { status: "transcribed", transcript: "t", language: "es", duration: 4, provider: "xai" } });
assert.equal(languageName("es"), "Spanish");
assert.equal(languageName("es-mx"), "Spanish");
assert.equal(languageName("english"), "English");
assert.deepEqual(modelInbound({ inbound: "hola" }, { transcribed: true, language: "es" }), { inbound: "hola", inbound_type: "voice_note", inbound_language: "Spanish" });
assert.deepEqual(modelInbound({ inbound: "hola" }, null), { inbound: "hola" });
assert.match(voiceRule({ transcribed: true, language: "es" }), /Reply in Spanish\./);
assert.match(voiceRule({ transcribed: true, language: "" }), /Reply in the language they spoke\./);
assert.equal(voiceRule(null), "");
assert.equal(VOICE_FAILED_BODY, "Voice note (could not be transcribed)");
for (const reason of ["download", "too_long", "empty", "no_provider", "transcribe", "other"]) {
  assert.match(voiceFailureMessage(reason), /reply yourself\.$/);
  assert.doesNotMatch(voiceFailureMessage(reason), /zernio/i);
}

// Wiring: both paths transcribe first, hand failures to a person, never guess.
const hook = read("supabase/functions/zernio-webhook/index.ts");
assert.match(hook, /p_body: inboundStoreBody\(event\)/);
assert.match(hook, /understandVoice\(job\.event\.voice, env, await voiceOptions\(admin, job\.account\.businessId, \{ refresh: voiceRefreshRequest\(job\.event, apiKey\) \}\)\)/);
const failBlock = hook.slice(hook.indexOf("async function voiceNotUnderstood"), hook.indexOf("async function promptSections"));
assert.match(failBlock, /status: "blocked"/);
assert.match(failBlock, /human_locked: true/);
assert.match(failBlock, /acq_exceptions/);
assert.ok(hook.indexOf("understandVoice(") < hook.indexOf("planGatewayReply({"), "transcribe before planning the reply");
assert.match(hook, /system: promptBody \+ voiceRule\(heardVoice\)/);
const acquisition = read("supabase/functions/roleflow-acquisition/index.ts");
assert.match(acquisition, /understandVoice\(row\.payload\.voice, env/);
assert.match(acquisition, /escalate\(db, businessId, thread\.target_id, "voice_note", message\)/);
assert.ok(acquisition.indexOf("understandVoice(") < acquisition.indexOf("plan = await planTurn("), "transcribe before planning");

console.log("setter voice note tests passed");
