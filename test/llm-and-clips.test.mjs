import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PROVIDERS, bookingTool, chatRequest, completeChat, parseChat, redactSecret, resolveRuntime } from "../supabase/functions/_shared/llm-provider.js";
import { completeJson } from "../supabase/functions/roleflow-acquisition/ig/llm.js";
import { planTurn } from "../supabase/functions/roleflow-acquisition/ig/engine.js";
import { bookingBehaviour } from "../supabase/functions/_shared/booking-plan.js";
import { assertInstagramContainer, encodeWav, ffmpegWavCommand, instagramAudioReady, needsAudioConvert, sniffAudio } from "../supabase/functions/_shared/clip-audio.js";
import { chooseClip, clipInstructions, promptForbidsClips, usableClips } from "../supabase/functions/_shared/clip-plan.js";
import { officialReady, postOfficial } from "../supabase/functions/_shared/official-outbox.js";
import { llmChoiceError } from "../acquire/studio-ops-model.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const clipId = "11111111-1111-4111-8111-111111111111";

const openai = chatRequest({
  runtime: { provider: "openai", model: "gpt-4.1-mini", apiKey: "sk-testkeyvalue" },
  system: "reply json",
  messages: [{ role: "user", content: "hello" }],
  json: true
});
assert.equal(openai.url, "https://api.openai.com/v1/chat/completions");
assert.equal(JSON.parse(openai.init.body).response_format.type, "json_object");
assert.equal(openai.init.headers.Authorization, "Bearer sk-testkeyvalue");

const anthropic = chatRequest({
  runtime: { provider: "anthropic", model: "claude-sonnet-4-5", apiKey: "sk-ant-test" },
  system: "reply json",
  messages: [{ role: "user", content: "hello" }],
  json: true
});
assert.equal(anthropic.url, "https://api.anthropic.com/v1/messages");
assert.equal(anthropic.init.headers["x-api-key"], "sk-ant-test");
assert.equal(anthropic.init.headers["anthropic-version"], "2023-06-01");
assert.match(JSON.parse(anthropic.init.body).system, /JSON only/);

const gemini = chatRequest({
  runtime: { provider: "gemini", model: "gemini-2.0-flash", apiKey: "gem-test-key" },
  system: "reply json",
  messages: [{ role: "user", content: "hello" }],
  json: true
});
assert.match(gemini.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.0-flash:generateContent$/);
assert.equal(gemini.init.headers["x-goog-api-key"], "gem-test-key");
assert.equal(gemini.url.includes("gem-test-key"), false);
assert.equal(JSON.parse(gemini.init.body).generationConfig.temperature, 0.4);
assert.equal(JSON.parse(gemini.init.body).generationConfig.thinkingConfig, undefined);

const gemini3 = chatRequest({
  runtime: { provider: "gemini", model: "gemini-3-flash-preview", apiKey: "gem-test-key" },
  system: "You are the setter.",
  messages: [
    { role: "user", content: "hey" },
    { role: "assistant", content: "What do you sell?" },
    { role: "user", content: "coaching" }
  ],
  temperature: 0.2
});
const gemini3Body = JSON.parse(gemini3.init.body);
assert.match(gemini3.url, /models\/gemini-3-flash-preview:generateContent$/);
assert.equal(gemini3Body.generationConfig.thinkingConfig.thinkingLevel, "low");
assert.equal(gemini3Body.generationConfig.temperature, undefined);
assert.match(gemini3Body.systemInstruction.parts[0].text, /You are the setter\./);
assert.deepEqual(gemini3Body.contents.map((item) => item.role), ["user", "model", "user"]);
assert.equal(gemini3Body.contents[1].parts[0].text, "What do you sell?");
assert.equal(PROVIDERS.gemini.defaultModel, "gemini-3-flash-preview");
assert.equal(PROVIDERS.gemini.models.includes("gemini-2.0-flash"), true);
assert.equal(PROVIDERS.openrouter.models.includes("google/gemini-3-flash-preview"), true);

let geminiCapture = null;
const geminiAnswer = await completeChat({
  runtime: { provider: "gemini", model: "gemini-3-flash-preview", apiKey: "gem-secret-key", source: "platform" },
  system: "You are the setter.",
  messages: [
    { role: "user", content: "hey" },
    { role: "assistant", content: "What do you sell?" },
    { role: "user", content: "coaching" }
  ],
  fetchImpl: async (url, init) => {
    geminiCapture = { url, body: JSON.parse(init.body), key: init.headers["x-goog-api-key"] };
    return {
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [
              { text: "hidden thought", thought: true },
              { text: "Want to book a call?" }
            ]
          }
        }]
      })
    };
  }
});
assert.equal(geminiAnswer.text, "Want to book a call?");
assert.equal(geminiAnswer.text.includes("hidden thought"), false);
assert.equal(geminiAnswer.provider, "gemini");
assert.equal(geminiAnswer.model, "gemini-3-flash-preview");
assert.equal(geminiAnswer.keySource, "platform");
assert.match(geminiCapture.url, /gemini-3-flash-preview:generateContent$/);
assert.equal(geminiCapture.body.generationConfig.thinkingConfig.thinkingLevel, "low");
assert.equal(Object.hasOwn(geminiCapture.body.generationConfig, "temperature"), false);
assert.equal(geminiCapture.key, "gem-secret-key");
assert.equal(geminiCapture.url.includes("gem-secret-key"), false);

const router = chatRequest({
  runtime: { provider: "openrouter", model: "openai/gpt-4.1-mini", apiKey: "or-test" },
  system: "s",
  messages: [{ role: "user", content: "hello" }]
});
assert.equal(router.url, "https://openrouter.ai/api/v1/chat/completions");
assert.equal(router.init.headers["HTTP-Referer"], "https://roleflow.io");
assert.equal(router.init.headers["X-Title"], "Roleflow");

const custom = chatRequest({
  runtime: { provider: "custom", model: "local", apiKey: "local-key", baseUrl: "https://llm.example.com/v1" },
  system: "s",
  messages: [{ role: "user", content: "hello" }]
});
assert.equal(custom.url, "https://llm.example.com/v1/chat/completions");

const tooled = chatRequest({
  runtime: { provider: "openai", model: "gpt-4.1-mini", apiKey: "sk-testkeyvalue" },
  system: "s",
  messages: [{ role: "user", content: "book Friday" }],
  json: true,
  tools: [bookingTool()]
});
const tooledBody = JSON.parse(tooled.init.body);
assert.equal(tooledBody.response_format, undefined);
assert.equal(tooledBody.tools[0].function.name, "book_call");

function booked(parsed) {
  assert.equal(parsed.toolCalls[0].name, "book_call");
  assert.equal(parsed.toolCalls[0].arguments.action, "book");
  assert.equal(parsed.toolCalls[0].arguments.slot_start, "2026-10-24T10:00:00Z");
}
booked(parseChat("openai", {
  choices: [{ message: { content: "", tool_calls: [{ id: "1", function: { name: "book_call", arguments: "{\"action\":\"book\",\"slot_start\":\"2026-10-24T10:00:00Z\"}" } }] } }]
}));
booked(parseChat("anthropic", {
  content: [{ type: "tool_use", id: "1", name: "book_call", input: { action: "book", slot_start: "2026-10-24T10:00:00Z" } }]
}));
booked(parseChat("gemini", {
  candidates: [{ content: { parts: [{ functionCall: { name: "book_call", args: { action: "book", slot_start: "2026-10-24T10:00:00Z" } } }] } }]
}));

let logged = null;
const seen = [];
const answered = await completeChat({
  runtime: { provider: "openai", model: "gpt-4.1-mini", apiKey: "sk-secretkey99" },
  fallback: { provider: "xai", model: "grok-4.3", apiKey: "xai-platform" },
  system: "s",
  messages: [{ role: "user", content: "hi" }],
  fetchImpl: async (url) => {
    seen.push(url);
    if (seen.length === 1) return { ok: false, json: async () => ({ error: { message: "bad key sk-secretkey99" } }) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
  },
  onError: (info) => { logged = info; }
});
assert.equal(answered.text, "ok");
assert.deepEqual(seen, ["https://api.openai.com/v1/chat/completions", "https://api.x.ai/v1/chat/completions"]);
assert.equal(logged.fellBack, true);
assert.equal(logged.message.includes("sk-secretkey99"), false);
assert.equal(redactSecret("Bearer sk-secretkey99 failed", "sk-secretkey99").includes("sk-secretkey99"), false);

const owned = resolveRuntime({
  purpose: "setter",
  settings: { llm_setter_provider: "openai", llm_setter_own_key: true, setter_model: "gpt-4.1" },
  secret: { apiKey: "sk-ownedkey1" },
  env: { OPENAI_API_KEY: "sk-platform", XAI_API_KEY: "xai-key" }
});
assert.equal(owned.source, "own");
assert.equal(owned.apiKey, "sk-ownedkey1");
assert.equal(owned.model, "gpt-4.1");

const platform = resolveRuntime({
  purpose: "prompt",
  settings: { llm_prompt_provider: "custom", llm_prompt_own_key: true, llm_prompt_model: "local", llm_prompt_base_url: "http://bad.example" },
  secret: { apiKey: "sk-ownedkey1" },
  env: { XAI_API_KEY: "xai-key" }
});
assert.equal(platform.provider, "xai");
assert.equal(platform.source, "platform");

const clips = [
  { id: clipId, label: "Offer", when_to_use: "when they ask the price", storage_path: "biz/a.wav", active: true, speech_provider: "recording", kind: "audio" },
  { id: "22222222-2222-4222-8222-222222222222", label: "Clone", when_to_use: "later", storage_path: "biz/b.wav", active: true, speech_provider: "elevenlabs", kind: "audio" }
];
assert.equal(usableClips(clips).length, 1);
assert.equal(chooseClip({ requestedId: clipId, clips, alreadySent: [], promptText: "Send it when it fits." }).label, "Offer");
assert.equal(chooseClip({ requestedId: clipId, clips, alreadySent: [clipId], promptText: "ok" }), null);
assert.equal(chooseClip({ requestedId: "not-an-id", clips, alreadySent: [], promptText: "ok" }), null);
assert.equal(promptForbidsClips("Never send voice notes in this business."), true);
assert.equal(chooseClip({ requestedId: clipId, clips, alreadySent: [], promptText: "Never send voice notes." }), null);
const catalog = clipInstructions(clips);
assert.match(catalog, new RegExp(clipId));
assert.doesNotMatch(catalog, /Clone/);

const wav = encodeWav([0, 0.5, -0.5], 16000);
assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
assert.equal(sniffAudio(wav), "audio/wav");
assert.equal(assertInstagramContainer(wav, "audio/wav").ok, true);
assert.equal(needsAudioConvert("audio/mpeg", "note.mp3"), true);
assert.equal(instagramAudioReady("audio/mp4", "note.m4a"), true);
assert.equal(sniffAudio(Uint8Array.from([0x49, 0x44, 0x33])), "audio/mpeg");
assert.equal(ffmpegWavCommand("in.mp3", "out.wav")[0], "ffmpeg");
assert.equal(assertInstagramContainer(Uint8Array.from([0x49, 0x44, 0x33, 0x04]), "audio/mpeg").ok, false);

const due = Date.parse("2026-10-23T10:00:01.000Z");
const clipRow = {
  id: "f5e0d558-b19c-4e75-8f1c-42dcf59a2973",
  transport: "official",
  status: "pending",
  run_at: "2026-10-23T10:00:00.000Z",
  payload: {
    text: "",
    accountId: "acct",
    conversationId: "2108532849767337",
    clip: { id: clipId, path: "biz/a.wav", mime: "audio/wav", kind: "audio", filename: "clip.wav" }
  },
  agent_enabled: true
};
assert.equal(officialReady(clipRow, due), true);
assert.equal(officialReady({ ...clipRow, payload: { text: "  " } }, due), false);

const calls = [];
const sent = await postOfficial(clipRow, "test-key", async (url, init) => {
  calls.push({ url, init });
  if (url.endsWith("/media/upload-direct")) return { ok: true, status: 200, json: async () => ({ url: "https://cdn.example/clip.wav" }) };
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
}, {
  download: async () => ({ bytes: wav, mime: "audio/wav", filename: "clip.wav", kind: "audio" })
});
assert.equal(sent.ok, true);
assert.equal(calls[0].url, "https://zernio.com/api/v1/media/upload-direct");
assert.equal(calls[0].init.headers.Authorization, "Bearer test-key");
assert.equal(calls[1].url, "https://zernio.com/api/v1/inbox/conversations/2108532849767337/messages");
const sentBody = JSON.parse(calls[1].init.body);
assert.equal(sentBody.attachmentUrl, "https://cdn.example/clip.wav");
assert.equal(sentBody.attachmentType, "audio");
assert.equal(sentBody.message, undefined);

const sql = read("supabase/migrations/20261023180000_llm_providers_and_clips.sql");
assert.match(sql, /extensions\.pgp_sym_encrypt/);
assert.match(sql, /revoke all on function public\.acq_llm_read_key\(uuid, text\) from public, anon, authenticated/);
assert.match(sql, /grant execute on function public\.acq_llm_read_key\(uuid, text\) to service_role/);
assert.match(sql, /'owner-clips'/);
assert.match(sql, /speech_provider in \('recording', 'elevenlabs'\)/);
assert.match(sql, /drop constraint if exists acq_settings_setter_model_check/);
assert.doesNotMatch(sql, /sk-[A-Za-z0-9]{8,}/);

const ops = read("acquire/studio-ops.js");
assert.match(ops, /Which model answers/);
assert.match(ops, /Test connection/);
assert.match(ops, /setter_model/);
assert.match(ops, /The live setter uses these hours/);
assert.doesNotMatch(ops, /zernio|tailortalk/i);
assert.match(read("acquire/studio.js"), /When to use/);
assert.match(read("acquire/studio-flow.js"), /<audio>|audio/);
assert.match(read("acquire/studio-flow.js"), /playbackUrl/);
assert.doesNotMatch(read("acquire/studio.js") + read("acquire/studio-flow.js") + read("acquire/clip-file.js"), /zernio|tailortalk/i);
assert.match(read("supabase/config.toml"), /\[functions\.llm-check\]\nverify_jwt = true/);
assert.match(read("supabase/functions/llm-check/index.ts"), /Reply with the single word pong/);
assert.doesNotMatch(read("supabase/functions/llm-check/index.ts"), /console\.log/);
assert.match(read("supabase/functions/zernio-webhook/index.ts"), /sendRequest/);

assert.equal(llmChoiceError({ provider: "openai", model: "gpt-4.1", own: false, baseUrl: "", apiKey: "", hasHint: false }), "");
assert.match(llmChoiceError({ provider: "custom", model: "local", own: true, baseUrl: "http://nope", apiKey: "longenough", hasHint: false }), /https/);
assert.match(llmChoiceError({ provider: "openai", model: "gpt-4.1", own: true, baseUrl: "", apiKey: "", hasHint: false }), /Add a key/);
assert.equal(llmChoiceError({ provider: "openai", model: "gpt-4.1", own: true, baseUrl: "", apiKey: "", hasHint: true }), "");

const bookedJson = await completeJson({
  runtime: { provider: "openai", model: "gpt-4.1-mini", apiKey: "sk-testkeyvalue" },
  tools: [bookingTool()],
  system: "book",
  messages: [{ role: "user", content: "Thursday" }],
  fetchImpl: async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: "{\"bubbles\":[\"Thursday works.\"],\"next_state\":\"booking\"}",
          tool_calls: [{ id: "1", function: { name: "book_call", arguments: "{\"action\":\"book\",\"slot_start\":\"2026-10-24T10:00:00Z\",\"email\":\"ada@example.com\"}" } }]
        }
      }]
    })
  })
});
const bookedFields = JSON.parse(bookedJson);
assert.equal(bookedFields.booking_action, "book");
assert.equal(bookedFields.slot_start, "2026-10-24T10:00:00Z");
assert.equal(bookedFields.email, "ada@example.com");
assert.equal(bookedFields.bubbles[0], "Thursday works.");

const cityBooking = bookingBehaviour({
  sections: { workflow: "Required before booking: city.\nConfirmation: City locked." },
  tools: [{ kind: "booking", config: { calendar_link: "https://cal.example/city" } }]
});
const held = await planTurn({
  thread: { state: "qualification", lastUserMessageAt: "2026-10-23T12:00:00Z", attributes: {} },
  now: Date.parse("2026-10-23T12:00:00Z"),
  booking: cityBooking,
  llm: async () => JSON.parse(bookedJson)
});
assert.equal(held.state, "qualification");
assert.equal(held.rejectedTransition, true);
assert.equal(held.link, "https://cal.example/city");
assert.match(read("supabase/functions/zernio-webhook/index.ts"), /bookingBehaviour/);
assert.match(read("supabase/functions/zernio-webhook/index.ts"), /bookingTool\(\)/);
assert.match(read("supabase/functions/roleflow-acquisition/ig/llm.js"), /clip_id/);
assert.match(read("supabase/functions/roleflow-acquisition/ig/llm.js"), /book_call/);

console.log("llm and clips tests passed");
