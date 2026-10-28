import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CLAUDE_SONNET_MODEL, anthropicAcceptsTemperature, chatRequest, clientReplyView, completeChat, healthView, loadSetterReply, setterReplyPlan } from "../supabase/functions/_shared/llm-provider.js";
import { CLAUDE_SONNET_MODEL as clientModel, maskedKey, publicKeyView } from "../acquire/model-key.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const businessKey = "sk-ant-businesskey99";
const platformKey = "sk-ant-platformkey1";
const current = { provider: "gemini", model: "gemini-3-flash-preview", apiKey: "gem-platform", source: "platform" };

assert.equal(CLAUDE_SONNET_MODEL, "claude-sonnet-5-5");
assert.equal(clientModel, CLAUDE_SONNET_MODEL);

const own = setterReplyPlan({ mode: "own", businessKey, env: { ANTHROPIC_API_KEY: platformKey }, current });
assert.equal(own.fellBack, false);
assert.equal(own.chain[0].provider, "anthropic");
assert.equal(own.chain[0].model, CLAUDE_SONNET_MODEL);
assert.equal(own.chain[0].source, "own");
assert.equal(own.chain[0].apiKey, businessKey);
assert.equal(own.chain[1].source, "platform");
assert.equal(own.chain[1].apiKey, platformKey);
assert.equal(own.chain[2].provider, "gemini");
assert.equal(own.chain[2].model, "gemini-3-flash-preview");
assert.equal(own.reason.includes(businessKey), false);

const preferred = setterReplyPlan({ mode: "default", businessKey, env: { ANTHROPIC_API_KEY: platformKey }, current });
assert.equal(preferred.chain[0].apiKey, platformKey);
assert.equal(preferred.chain.some((step) => step.apiKey === businessKey), false);
assert.equal(preferred.chain[1].provider, "gemini");

const missing = setterReplyPlan({ mode: "default", businessKey: "", env: {}, current });
assert.equal(missing.fellBack, true);
assert.equal(missing.reason, "anthropic_missing");
assert.equal(missing.chain.length, 1);
assert.equal(missing.chain[0].provider, "gemini");
assert.equal(missing.chain[0].apiKey, "gem-platform");

const empty = setterReplyPlan({ mode: "own", businessKey: "   ", env: {}, current: null });
assert.deepEqual(empty.chain, []);

let calls = 0;
const errors = [];
const answered = await completeChat({
  chain: own.chain,
  onError: async (info) => { errors.push(info); },
  system: "Reply with the single word pong.",
  messages: [{ role: "user", content: "ping" }],
  fetchImpl: async (_url, init) => {
    calls += 1;
    const key = init.headers["x-api-key"] || "";
    assert.equal(JSON.stringify(init).includes("gem-platform") && calls === 1, false);
    if (key === businessKey) {
      return { ok: false, status: 401, json: async () => ({ error: { type: "authentication_error", message: "invalid x-api-key " + businessKey } }) };
    }
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "pong" }], usage: { input_tokens: 8, output_tokens: 1 } }) };
  }
});
assert.equal(calls, 2);
assert.equal(answered.text, "pong");
assert.equal(answered.model, CLAUDE_SONNET_MODEL);
assert.equal(answered.keySource, "platform");
assert.equal(answered.fellBack, true);
assert.equal(answered.authFallback, true);
assert.equal(answered.usage.input, 8);
assert.equal(answered.usage.output, 1);
assert.equal(errors.length, 1);
assert.equal(errors[0].source, "own");
assert.equal(errors[0].auth, true);
assert.equal(String(errors[0].message).includes(businessKey), false);

const view = clientReplyView({
  ok: true,
  reply: "pong " + businessKey,
  apiKey: businessKey,
  api_key: platformKey,
  runtime: { apiKey: platformKey },
  usage: answered.usage,
  notice: "rejected"
}, [businessKey, platformKey]);
assert.equal(JSON.stringify(view).includes(businessKey), false);
assert.equal(JSON.stringify(view).includes(platformKey), false);
assert.equal(view.usage.input, 8);
assert.equal(Object.hasOwn(view, "apiKey"), false);
assert.equal(Object.hasOwn(view, "api_key"), false);
assert.equal(view.reply.includes("[redacted]"), true);

const leaked = publicKeyView([{ provider: "anthropic", last4: "cd99", apiKey: businessKey, api_key: platformKey }]);
assert.deepEqual(leaked, [{ provider: "anthropic", last4: "cd99" }]);
assert.equal(JSON.stringify(leaked).includes(businessKey), false);
assert.equal(maskedKey("cd99"), "sk-ant-...cd99");
assert.equal(maskedKey("cd99").includes(businessKey), false);

function settingsQuery(row) {
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    maybeSingle: async () => ({ data: row, error: null })
  };
  return chain;
}

const loaded = await loadSetterReply({
  from() {
    return settingsQuery({
      setter_claude_mode: "own",
      llm_setter_provider: "gemini",
      llm_setter_own_key: false,
      setter_model: "gemini-3-flash-preview"
    });
  },
  rpc: async (_name, args) => {
    assert.equal(args.p_business, "11111111-1111-4111-8111-111111111111");
    if (args.p_provider === "anthropic") return { data: { ok: true, api_key: businessKey }, error: null };
    return { data: { ok: false }, error: null };
  }
}, "11111111-1111-4111-8111-111111111111", { ANTHROPIC_API_KEY: platformKey, GEMINI_API_KEY: "gem-platform" });
assert.equal(loaded.chain[0].apiKey, businessKey);
assert.equal(loaded.chain[1].apiKey, platformKey);
assert.equal(loaded.chain[2].provider, "gemini");
assert.equal(JSON.stringify({ reason: loaded.reason, fellBack: loaded.fellBack }).includes(businessKey), false);

const sql = read("supabase/migrations/20261027190000_setter_claude.sql");
assert.match(sql, /NOT APPLIED/);
assert.match(sql, /setter_claude_mode/);
assert.match(sql, /check \(setter_claude_mode in \('default', 'own'\)\)/);
assert.match(sql, /revoke all on table private\.business_llm_secrets from public, anon, authenticated/);
assert.match(sql, /revoke all on function public\.acq_llm_read_key\(uuid, text\) from public, anon, authenticated/);
assert.match(sql, /grant execute on function public\.acq_llm_read_key\(uuid, text\) to service_role/);
assert.doesNotMatch(sql, /sk-ant-[A-Za-z0-9]{8,}/);
assert.doesNotMatch(sql, /drop table/i);

const hints = read("supabase/migrations/20261023180000_llm_providers_and_clips.sql");
assert.match(hints, /jsonb_build_object\('provider', provider, 'last4', key_last4\)/);
const hintStart = hints.indexOf("function public.acq_llm_key_hints");
const hintEnd = hints.indexOf("function public.acq_llm_read_key");
assert.doesNotMatch(hints.slice(hintStart, hintEnd), /api_key/);

const pages = read("acquire/client-pages.js");
assert.match(pages, /AI model/);
assert.match(pages, /Roleflow default/);
assert.match(pages, /Use my own Claude API key/);
assert.match(pages, /Save key/);
assert.match(pages, /Test key/);
assert.match(pages, /Remove key/);
assert.match(pages, /Replace/);
assert.match(pages, /Modelo de IA/);
assert.match(pages, /Predeterminado de Roleflow/);
assert.match(pages, /Usar mi propia clave de Claude/);
assert.doesNotMatch(pages, /zernio/i);
assert.match(read("acquire/app.js"), /setter_claude_mode/);
assert.match(read("supabase/functions/client-dashboard/index.ts"), /info\.auth && info\.source === "own"/);
assert.match(read("supabase/functions/roleflow-hooks/index.ts"), /info\.auth && info\.source === "own"/);
assert.match(read("supabase/functions/roleflow-acquisition/index.ts"), /info\.auth && info\.source === "own"/);
assert.match(read("supabase/functions/zernio-webhook/index.ts"), /info\.auth && info\.source === "own"/);
assert.match(read("supabase/functions/client-dashboard/index.ts"), /clientReplyView/);
assert.match(read("supabase/functions/client-dashboard/index.ts"), /loadSetterReply/);
assert.doesNotMatch(read("supabase/functions/client-dashboard/index.ts"), /api_key: runtime\.apiKey|apiKey: runtime\.apiKey/);
assert.match(read("supabase/functions/llm-check/index.ts"), /clientReplyView/);
assert.match(read("docs/client-dashboard.md"), /20261027190000_setter_claude\.sql/);
assert.match(read("docs/client-dashboard.md"), /ANTHROPIC_API_KEY/);
assert.match(read("docs/client-dashboard.md"), /NOT APPLIED/);

assert.equal(anthropicAcceptsTemperature("claude-sonnet-5-5"), false);
assert.equal(anthropicAcceptsTemperature("claude-sonnet-4-5"), true);
const sonnet5 = JSON.parse(chatRequest({
  runtime: { provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "sk-ant-usr-testkey" },
  messages: [{ role: "user", content: "ping" }]
}).init.body);
assert.equal(Object.hasOwn(sonnet5, "temperature"), false);
const older = JSON.parse(chatRequest({
  runtime: { provider: "anthropic", model: "claude-sonnet-4-5", apiKey: "sk-ant-api-testkey" },
  messages: [{ role: "user", content: "ping" }]
}).init.body);
assert.equal(older.temperature, 0.4);

let heatCalls = 0;
const recovered = await completeChat({
  chain: [
    { provider: "anthropic", model: "claude-sonnet-4-5", apiKey: platformKey, source: "platform" },
    current
  ],
  messages: [{ role: "user", content: "ping" }],
  fetchImpl: async (_url, init) => {
    heatCalls += 1;
    const body = JSON.parse(init.body);
    if (body.temperature != null) {
      return { ok: false, status: 400, json: async () => ({ error: { type: "invalid_request_error", message: "`temperature` is deprecated for this model." } }) };
    }
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "pong" }], usage: { input_tokens: 3, output_tokens: 1 } }) };
  }
});
assert.equal(recovered.text, "pong");
assert.equal(recovered.provider, "anthropic");
assert.equal(recovered.fellBack, false);
assert.equal(heatCalls, 2);
assert.equal(JSON.stringify(recovered).includes(platformKey), false);

const health = healthView({ ok: true, model: CLAUDE_SONNET_MODEL, key_present: true, key_kind: "usr", status: 200, apiKey: platformKey, error: "bad " + platformKey });
assert.equal(JSON.stringify(health).includes(platformKey), false);
assert.equal(health.key_kind, "usr");
assert.equal(health.provider, "anthropic");
assert.equal(Object.hasOwn(health, "apiKey"), false);

console.log("setter claude tests passed");
