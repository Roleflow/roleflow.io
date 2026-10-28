import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  advanceStatus,
  buildInstruction,
  gridStageLabel,
  hashToken,
  intakeBundle,
  normalizeDraft,
  publicIntakeView,
  scopeToken,
  textFromDocxXml,
  textFromPdf
} from "../acquire/onboarding-build.js";
import { completeChat } from "../supabase/functions/_shared/llm-provider.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
assert.equal(read("acquire/onboarding-build.js"), read("supabase/functions/_shared/onboarding-build.js"));

const now = Date.parse("2026-10-28T12:00:00Z");
const business = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
assert.deepEqual(scopeToken(null, now), { ok: false, reason: "missing" });
assert.equal(scopeToken({ business_id: business, expires_at: "2026-10-29T00:00:00Z", revoked_at: "2026-10-28T00:00:00Z" }, now).reason, "revoked");
assert.equal(scopeToken({ business_id: business, expires_at: "2026-10-27T00:00:00Z" }, now).reason, "expired");
const open = scopeToken({ business_id: business, expires_at: "2026-10-29T00:00:00Z" }, now);
assert.equal(open.ok, true);
assert.equal(open.business_id, business);
assert.notEqual(open.business_id, other);

const token = "client-token-value-not-stored";
const hash = await hashToken(token);
assert.equal(hash.length, 64);
assert.equal(hash.includes(token), false);
assert.equal(await hashToken(token), hash);

const view = publicIntakeView({
  offer: "Strategy session",
  business_id: business,
  token_hash: hash,
  apiKey: "sk-ant-secret"
}, [{ id: "m1", name: "notes.md", kind: "text", body: "secret body" }]);
assert.equal(JSON.stringify(view).includes(hash), false);
assert.equal(JSON.stringify(view).includes("sk-ant-secret"), false);
assert.equal(JSON.stringify(view).includes(other), false);
assert.equal(view.materials[0].body, undefined);
assert.equal(view.offer, "Strategy session");

assert.equal(textFromDocxXml("<w:p><w:t>Hello &amp; welcome</w:t></w:p>"), "Hello & welcome");
assert.match(textFromPdf("BT (Book a call) Tj ET"), /Book a call/);

const bundle = intakeBundle({
  form: { offer: "Strategy session", ideal: "Agents", price: "", criteria: "", disqualifiers: "stop" },
  materials: [{ text: "We teach a bilingual system. Contact ada@example.com." }],
  conversations: [{ messages: [{ side: "them", label: "Ada", text: "email ada@example.com" }, { side: "me", label: "Me", text: "want a call?" }] }]
});
const instruction = buildInstruction(bundle);
assert.equal(instruction.includes("ada@example.com"), false);
assert.match(instruction, /needs input/);
assert.match(instruction, /Do not guarantee income/);

const invented = normalizeDraft({
  fields: { sell: "A made up $90000 guarantee", credibility: "Invented award", who: "Agents" },
  sources: { sell: "guess", credibility: "sop", who: "form" },
  prompt: "You are the setter.\nDo not guarantee income or results."
}, { ...bundle, materials: "" });
assert.equal(invented.fields.sell, "Strategy session");
assert.equal(invented.sources.sell, "form");
assert.equal(invented.fields.credibility, "needs input");
assert.equal(invented.fields.who, "Agents");
assert.equal(invented.missing.includes("credibility"), true);

const empty = normalizeDraft({ fields: { sell: "Invented" }, sources: { sell: "sop" }, prompt: "Invented prompt" }, { form: {}, materials: "", conversations: "" });
assert.equal(empty.fields.sell, "needs input");
assert.match(empty.prompt, /needs input/);
assert.equal(empty.prompt.includes("Invented prompt"), false);

assert.equal(advanceStatus("materials", "drafted"), "drafted");
assert.equal(advanceStatus("approved", "drafted"), "approved");
assert.equal(advanceStatus("", "live"), "live");
assert.equal(gridStageLabel("drafted", "en"), "Prompt drafted");
assert.equal(gridStageLabel("live", "es"), "IA activa");

let sawEmail = false;
const answered = await completeChat({
  chain: [{ provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "sk-ant-usr-platform", source: "platform" }],
  json: true,
  messages: [{ role: "user", content: instruction }],
  fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    if (JSON.stringify(body).includes("ada@example.com")) sawEmail = true;
    assert.equal(Object.hasOwn(body, "temperature"), false);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: JSON.stringify({
          fields: { who: "Agents", offer: "Strategy session" },
          sources: { who: "form", offer: "form" },
          prompt: "You are the setter. Do not guarantee income or results."
        }) }],
        usage: { input_tokens: 12, output_tokens: 8 }
      })
    };
  }
});
assert.equal(sawEmail, false);
const drafted = normalizeDraft(JSON.parse(answered.text), bundle);
assert.equal(drafted.fields.who, "Agents");
assert.equal(drafted.fields.credibility, "needs input");
assert.equal(JSON.stringify(drafted).includes("sk-ant-usr-platform"), false);

const link = read("supabase/functions/onboarding-link/index.ts");
assert.match(link, /eq\("token_hash", tokenHash\)/);
assert.match(link, /eq\("business_id", businessId\)/);
assert.match(link, /Screenshots are not read/);
assert.doesNotMatch(link, /from\("acq_onboarding"\)\.select\(\)/);
assert.doesNotMatch(link, /zernio/i);
const dashboard = read("supabase/functions/client-dashboard/index.ts");
const build = dashboard.slice(dashboard.indexOf("async function buildOnboarding"), dashboard.indexOf("function parseDraft"));
assert.match(build, /normalizeDraft/);
assert.doesNotMatch(build, /acq_agent_prompts/);
assert.doesNotMatch(build, /set_agent/);
const sql = read("supabase/migrations/20261028080000_onboarding_intake.sql");
assert.match(sql, /NOT APPLIED/);
assert.match(sql, /token_hash text not null unique/);
assert.match(sql, /onboarding-materials/);
assert.match(sql, /revoke all on public\.acq_onboarding from anon/);
assert.match(sql, /public = false/);
assert.match(read("supabase/config.toml"), /\[functions\.onboarding-link\]\nverify_jwt = false/);
assert.match(read("acquire/onboarding-panel.js"), /Build everything/);
assert.match(read("acquire/onboarding-panel.js"), /Crear todo/);
assert.doesNotMatch(read("acquire/onboarding-panel.js"), /zernio/i);
assert.doesNotMatch(read("account/onboarding/app.js"), /zernio/i);
assert.match(read("businesses/app.js"), /gridStageLabel/);
assert.match(read("businesses/app.js"), /AI active/);

console.log("onboarding intake tests passed");
