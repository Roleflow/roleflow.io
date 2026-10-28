import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { clampVoice, claudeVoiceGuide, prepareVoice, voiceFooter, voiceTemperature } from "../acquire/setter-voice.js";
import { chatRequest, completeChat } from "../supabase/functions/_shared/llm-provider.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
assert.equal(read("acquire/setter-voice.js"), read("supabase/functions/_shared/setter-voice.js"));

assert.equal(clampVoice("nope"), 50);
assert.equal(clampVoice(-4), 0);
assert.equal(clampVoice(140), 100);
assert.equal(voiceTemperature(0), 1);
assert.equal(voiceTemperature(50), 0.6);
assert.equal(voiceTemperature(100), 0.2);
assert.equal(voiceFooter(0, "en"), "Human 0");
assert.equal(voiceFooter(0, "es"), "Humano 0");
assert.equal(voiceFooter(100, "en"), "AI 100");
assert.equal(voiceFooter(100, "es"), "IA 100");
assert.match(claudeVoiceGuide(0), /casual/);
assert.match(claudeVoiceGuide(100), /predictable/);

function bodyFor(prepared, provider, model) {
  const request = chatRequest({
    runtime: { provider, model, apiKey: "voice-test-key" },
    system: prepared.system,
    messages: [{ role: "user", content: "hey" }],
    temperature: prepared.temperature,
    omitTemperature: prepared.omitTemperature
  });
  return JSON.parse(request.init.body);
}

const humanClaude = prepareVoice({ provider: "anthropic", model: "claude-sonnet-5-5", system: "Be the setter.", voice: 0 });
const humanBody = bodyFor(humanClaude, "anthropic", "claude-sonnet-5-5");
assert.equal(Object.hasOwn(humanBody, "temperature"), false);
assert.equal(Object.hasOwn(humanBody, "top_p"), false);
assert.equal(Object.hasOwn(humanBody, "top_k"), false);
assert.match(humanBody.system, /casual/);

const aiClaude = prepareVoice({ provider: "anthropic", model: "claude-sonnet-5-5", system: "Be the setter.", voice: 100 });
const aiBody = bodyFor(aiClaude, "anthropic", "claude-sonnet-5-5");
assert.equal(Object.hasOwn(aiBody, "temperature"), false);
assert.match(aiBody.system, /predictable/);

const older = prepareVoice({ provider: "anthropic", model: "claude-sonnet-4-5", system: "Be the setter.", voice: 0 });
assert.equal(older.temperature, 1);
assert.equal(bodyFor(older, "anthropic", "claude-sonnet-4-5").temperature, 1);

const gemini = prepareVoice({ provider: "gemini", model: "gemini-2.0-flash", system: "Be the setter.", voice: 100 });
assert.equal(gemini.temperature, 0.2);
assert.equal(bodyFor(gemini, "gemini", "gemini-2.0-flash").generationConfig.temperature, 0.2);

const gemini3 = prepareVoice({ provider: "gemini", model: "gemini-3-flash-preview", system: "Be the setter.", voice: 0 });
assert.equal(gemini3.temperature, 1);
assert.equal(bodyFor(gemini3, "gemini", "gemini-3-flash-preview").generationConfig.temperature, 1);
const gemini3Quiet = prepareVoice({ provider: "gemini", model: "gemini-3-flash-preview", system: "Be the setter.", voice: 100 });
assert.equal(bodyFor(gemini3Quiet, "gemini", "gemini-3-flash-preview").generationConfig.temperature, undefined);

const openai = prepareVoice({ provider: "openai", model: "gpt-4.1-mini", system: "Be the setter.", voice: 100 });
assert.equal(bodyFor(openai, "openai", "gpt-4.1-mini").temperature, 0.2);

let sawTemperature = false;
const answered = await completeChat({
  chain: [{ provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "sk-ant-usr-voice", source: "platform" }],
  voice: 0,
  system: "Be the setter.",
  messages: [{ role: "user", content: "hey" }],
  fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    if (Object.hasOwn(body, "temperature") || Object.hasOwn(body, "top_p") || Object.hasOwn(body, "top_k")) sawTemperature = true;
    assert.match(body.system, /casual/);
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "hey" }], usage: { input_tokens: 4, output_tokens: 1 } }) };
  }
});
assert.equal(sawTemperature, false);
assert.equal(answered.text, "hey");
assert.equal(answered.voice, 0);
assert.equal(JSON.stringify(answered).includes("sk-ant-usr-voice"), false);

const sql = read("supabase/migrations/20261028093000_setter_voice.sql");
assert.match(sql, /NOT APPLIED/);
assert.match(sql, /setter_voice integer not null default 50/);
assert.match(sql, /setter_voice between 0 and 100/);
assert.match(read("acquire/setter-workspace.js"), /Human ↔ AI/);
assert.match(read("acquire/setter-workspace.js"), /Humano ↔ IA/);
assert.match(read("acquire/app.js"), /voice: clampVoice\(state\.setterVoice\)/);
assert.match(read("supabase/functions/client-dashboard/index.ts"), /voice: body\.voice == null \|\| body\.voice === "" \? loaded\.voice : body\.voice/);
assert.doesNotMatch(read("acquire/setter-workspace.js"), /zernio/i);

console.log("setter voice tests passed");
