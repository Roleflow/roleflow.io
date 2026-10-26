import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadBusinessRuntime, resolveRuntime } from "../supabase/functions/_shared/llm-provider.js";
import { keyHint, modelPatch, previewKeySave, previewKeys, publicKeyView } from "../acquire/model-key.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const businessKey = "sk-businesskey99";

const preferred = resolveRuntime({
  purpose: "setter",
  settings: { llm_setter_provider: "openai", llm_setter_own_key: false, setter_model: "gpt-4.1" },
  secret: { apiKey: businessKey },
  env: { OPENAI_API_KEY: "sk-platformkey", XAI_API_KEY: "xai-platform" }
});
assert.equal(preferred.source, "own");
assert.equal(preferred.provider, "openai");
assert.equal(preferred.apiKey, businessKey);
assert.equal(preferred.model, "gpt-4.1");

const fallback = resolveRuntime({
  purpose: "setter",
  settings: { llm_setter_provider: "gemini", llm_setter_own_key: true, setter_model: "gemini-2.0-flash" },
  secret: null,
  env: { GEMINI_API_KEY: "gem-platform", XAI_API_KEY: "xai-platform" }
});
assert.equal(fallback.source, "platform");
assert.equal(fallback.provider, "gemini");
assert.equal(fallback.apiKey, "gem-platform");
assert.equal(fallback.model, "gemini-2.0-flash");

const emptyGemini = resolveRuntime({
  purpose: "setter",
  settings: { llm_setter_provider: "gemini", setter_model: "" },
  secret: { apiKey: "gem-business-key" },
  env: { XAI_API_KEY: "xai-platform" }
});
assert.equal(emptyGemini.provider, "gemini");
assert.equal(emptyGemini.model, "gemini-3-flash-preview");
assert.notEqual(emptyGemini.model, "grok-4.3");

const wrongModel = resolveRuntime({
  purpose: "setter",
  settings: { llm_setter_provider: "gemini", setter_model: "grok-4.3" },
  secret: { apiKey: "gem-business-key" },
  env: {}
});
assert.equal(wrongModel.model, "gemini-3-flash-preview");

const emptyPrompt = resolveRuntime({
  purpose: "prompt",
  settings: { llm_prompt_provider: "gemini", llm_prompt_model: "   " },
  secret: { apiKey: "gem-business-key" },
  env: { XAI_API_KEY: "xai-platform" }
});
assert.equal(emptyPrompt.provider, "gemini");
assert.equal(emptyPrompt.model, "gemini-3-flash-preview");

const openModel = resolveRuntime({
  purpose: "setter",
  settings: { llm_setter_provider: "openrouter", setter_model: "google/some-new-model" },
  secret: { apiKey: "or-business-key" },
  env: {}
});
assert.equal(openModel.provider, "openrouter");
assert.equal(openModel.model, "google/some-new-model");

const customModel = resolveRuntime({
  purpose: "setter",
  settings: { llm_setter_provider: "custom", setter_model: "my-model", llm_setter_base_url: "https://llm.example.com/v1" },
  secret: { apiKey: "local-key-value" },
  env: { XAI_API_KEY: "xai-platform" }
});
assert.equal(customModel.provider, "custom");
assert.equal(customModel.model, "my-model");

const other = resolveRuntime({
  purpose: "setter",
  settings: { llm_setter_provider: "openai", setter_model: "gpt-4.1" },
  secret: { apiKey: "" },
  env: { XAI_API_KEY: "xai-platform" }
});
assert.equal(other.provider, "xai");
assert.equal(other.source, "platform");
assert.equal(other.apiKey, "xai-platform");

function settingsQuery(row) {
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    maybeSingle: async () => ({ data: row, error: null })
  };
  return chain;
}

const ownedRuntime = await loadBusinessRuntime({
  from() { return settingsQuery({ llm_setter_provider: "openai", llm_setter_own_key: false, setter_model: "gpt-4.1" }); },
  rpc: async (_name, args) => {
    assert.equal(args.p_provider, "openai");
    return { data: { ok: true, api_key: businessKey }, error: null };
  }
}, "11111111-1111-4111-8111-111111111111", "setter", { OPENAI_API_KEY: "sk-platformkey", XAI_API_KEY: "xai-platform" });
assert.equal(ownedRuntime.runtime.source, "own");
assert.equal(ownedRuntime.runtime.apiKey, businessKey);
assert.equal(ownedRuntime.fallback.provider, "xai");

const platformRuntime = await loadBusinessRuntime({
  from() { return settingsQuery({ llm_setter_provider: "openai", llm_setter_own_key: true, setter_model: "gpt-4.1" }); },
  rpc: async () => ({ data: { ok: false }, error: null })
}, "11111111-1111-4111-8111-111111111111", "setter", { OPENAI_API_KEY: "sk-platformkey" });
assert.equal(platformRuntime.runtime.source, "platform");
assert.equal(platformRuntime.runtime.apiKey, "sk-platformkey");

const saved = previewKeySave([], { provider: "openai", apiKey: businessKey });
assert.equal(saved.ok, true);
assert.deepEqual(saved.hints, [{ provider: "openai", last4: businessKey.slice(-4) }]);
assert.equal(JSON.stringify(saved).includes(businessKey), false);
assert.equal(keyHint(saved.hints, "openai"), businessKey.slice(-4));

const replaced = previewKeys(saved.hints, [{ provider: "openai", apiKey: "sk-replacedkey1" }]);
assert.deepEqual(replaced.hints, [{ provider: "openai", last4: "key1" }]);
assert.equal(JSON.stringify(replaced).includes("sk-replacedkey1"), false);

const removed = previewKeySave(replaced.hints, { provider: "openai", clear: true, apiKey: businessKey });
assert.deepEqual(removed.hints, []);
assert.equal(JSON.stringify(removed).includes(businessKey), false);

const leaked = publicKeyView([{ provider: "xai", last4: "ab12", apiKey: businessKey }]);
assert.deepEqual(leaked, [{ provider: "xai", last4: "ab12" }]);
assert.equal(JSON.stringify(leaked).includes(businessKey), false);
assert.equal(previewKeySave([], { provider: "openai", apiKey: "short" }).ok, false);
assert.equal(modelPatch("gemini", false).llm_setter_own_key, true);
assert.equal(modelPatch("gemini", false).setter_model, "gemini-3-flash-preview");

const unset = resolveRuntime({
  purpose: "setter",
  settings: {},
  secret: null,
  env: { GEMINI_API_KEY: "gem-platform", XAI_API_KEY: "xai-platform" }
});
assert.equal(unset.provider, "gemini");
assert.equal(unset.model, "gemini-3-flash-preview");
assert.equal(unset.apiKey, "gem-platform");
assert.equal(read("acquire/model-key.js").includes('id: "gemini"'), true);
assert.match(read("supabase/migrations/20261026220000_gemini_default.sql"), /set default 'gemini'/);
assert.match(read("supabase/migrations/20261026230000_target_stage_rank.sql"), /grant execute on function public\.acq_stage_rank\(text\) to authenticated/);
assert.match(read("supabase/functions/roleflow-assistant/index.ts"), /#calendar/);
assert.match(read("supabase/functions/roleflow-assistant/index.ts"), /show_status/);
assert.match(read("acquire/app.js"), /raw === "billing"/);
assert.match(read("acquire/app.js"), /state\.tab !== "billing"/);
assert.match(read("acquire/engine-ui.js"), /id: "record-growth"/);
assert.match(read("acquire/client-nav.mjs"), /billing: "settings"/);
assert.match(read("acquire/client-nav.mjs"), /onboarding: "sops"/);
assert.match(read("acquire/app.js"), /async function recordBooking/);
assert.match(read("acquire/client-pages.js"), /id: "record-booking"/);
assert.equal(modelPatch("xai", true).llm_setter_own_key, false);
assert.equal(Object.hasOwn(modelPatch("openai", false), "apiKey"), false);

const sql = read("supabase/migrations/20261026140000_business_model_keys.sql");
assert.match(sql, /NOT APPLIED/);
assert.match(sql, /acq_can_manage_model_key/);
assert.match(sql, /m\.role = 'owner'/);
assert.match(sql, /public\.is_admin\(\)/);
assert.match(sql, /extensions\.pgp_sym_encrypt/);
assert.match(sql, /revoke all on function public\.acq_llm_read_key\(uuid, text\) from public, anon, authenticated/);
assert.match(sql, /grant execute on function public\.acq_llm_read_key\(uuid, text\) to service_role/);
assert.match(sql, /revoke all on table private\.business_llm_secrets from public, anon, authenticated/);
assert.doesNotMatch(sql, /drop table/i);
assert.doesNotMatch(sql, /sk-[A-Za-z0-9]{8,}/);

const pages = read("acquire/client-pages.js");
assert.match(pages, /Test key/);
assert.match(pages, /Save key/);
assert.match(pages, /Remove key/);
assert.match(pages, /Connect Instagram/);
assert.match(pages, /Instagram connect is not available yet\./);
assert.match(pages, /Try again/);
assert.doesNotMatch(pages, /zernio/i);
assert.match(pages, /#settings\/model/);
assert.match(read("acquire/app.js"), /renderModelKey/);
assert.match(read("acquire/app.js"), /canManageKeys/);
assert.doesNotMatch(read("acquire/app.js"), /zernio|tailortalk/i);
assert.doesNotMatch(read("acquire/model-key.js"), /zernio|tailortalk/i);
assert.doesNotMatch(read("acquire/connect-instagram.js"), /zernio|tailortalk/i);
assert.doesNotMatch(read("account/acquisition/index.html"), /id="next-step"/);
assert.doesNotMatch(read("acquire/studio-ops.js"), /Next step/);
assert.match(read("supabase/functions/llm-check/index.ts"), /Reply with the single word pong/);
assert.match(read("supabase/functions/llm-check/index.ts"), /platformEnv/);
assert.doesNotMatch(read("supabase/functions/client-dashboard/index.ts"), /api_key/);
assert.match(read("docs/client-dashboard.md"), /20261026140000_business_model_keys\.sql/);
assert.match(read("docs/client-dashboard.md"), /NOT APPLIED/);

console.log("model key tests passed");
