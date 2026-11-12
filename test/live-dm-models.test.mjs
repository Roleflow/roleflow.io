import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bookingTool, chatRequest, geminiSchema } from "../supabase/functions/_shared/llm-provider.js";

// Gemini rejected every live DM reply that carried the booking tool:
// "Unknown name additionalProperties at tools[0].function_declarations[0].parameters".
const request = chatRequest({
  runtime: { provider: "gemini", model: "gemini-3-flash-preview", apiKey: "k" },
  system: "s",
  messages: [{ role: "user", content: "hi" }],
  json: true,
  tools: [bookingTool()],
  maxTokens: 500
});
const body = JSON.parse(request.init.body);
const params = body.tools[0].functionDeclarations[0].parameters;
assert.equal(JSON.stringify(body).includes("additionalProperties"), false);
assert.deepEqual(params.required, ["action"]);
assert.deepEqual(params.properties.action.enum, ["offer", "book", "reschedule", "cancel"]);
assert.equal(params.type, "object");

// Nested schemas are cleaned too; other providers keep the strict schema.
assert.deepEqual(geminiSchema({ type: "object", additionalProperties: false, properties: { a: { type: "object", additionalProperties: true, properties: { b: { type: "string", default: "x" } } } } }),
  { type: "object", properties: { a: { type: "object", properties: { b: { type: "string" } } } } });
const openai = JSON.parse(chatRequest({ runtime: { provider: "openai", model: "gpt-test", apiKey: "k" }, system: "s", messages: [{ role: "user", content: "hi" }], tools: [bookingTool()] }).init.body);
assert.equal(JSON.stringify(openai).includes("additionalProperties"), true);

// The live DM path passes the Claude key, so a business set to Claude uses Claude
// instead of logging "ANTHROPIC_API_KEY is not set" and falling back.
const webhook = readFileSync(new URL("../supabase/functions/zernio-webhook/index.ts", import.meta.url), "utf8");
const envBlock = webhook.slice(webhook.indexOf("const env = {"), webhook.indexOf("};", webhook.indexOf("const env = {")));
for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "XAI_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) {
  assert.match(envBlock, new RegExp(key + ": Deno\\.env\\.get\\(\"" + key + "\"\\)"));
}
console.log("live DM models: ok");
