// Signed-in dashboard API. verify_jwt is true.
// Saves the setter prompt, the try-panel result, agent switches, follow-up
// rules, and the language preference. A tryout never sends an Instagram message.
//
// Secrets this function reads (Supabase function secrets, never the browser):
//   LLM_PROVIDER          optional: xai, openai, or gemini
//   XAI_API_KEY           model key when the provider is xAI
//   XAI_MODEL             optional model name
//   OPENAI_API_KEY        model key when the provider is OpenAI
//   OPENAI_MODEL          optional model name
//   GEMINI_API_KEY        model key when the provider is Gemini
//   GOOGLE_API_KEY        accepted in place of GEMINI_API_KEY
//   GEMINI_MODEL          optional model name
// SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are injected.
// If no model key is set, the try panel uses the local preview reply.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { normalizePolicy, previewReply, setterMayEnable } from "../_shared/agent-control.js";
import { completeJson } from "../roleflow-acquisition/ig/llm.js";
import { loadBusinessRuntime, logLlmError } from "../_shared/llm-provider.js";
import { clientSafeText } from "../_shared/client-safe.js";
import { adminClient, json, userClientFrom } from "../_shared/gateway-http.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = new Set(["warmer", "outreacher", "setter", "followup"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST." });
  const userClient = userClientFrom(req);
  const user = await userClient.auth.getUser();
  if (user.error || !user.data.user) return json(401, { ok: false, error: "Sign in required." });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_error) { body = {}; }
  const action = String(body.action || "load");
  const admin = adminClient();
  if (action === "save_language") return saveLanguage(admin, user.data.user.id, body.language);
  const businessId = String(body.business_id || "");
  if (!UUID.test(businessId)) return json(400, { ok: false, error: "Pick a business first." });
  const allowed = await userClient.rpc("acq_can_edit", { p_workspace: businessId });
  if (allowed.error || allowed.data !== true) return json(403, { ok: false, error: "You can't edit this business." });
  if (action === "load") return load(admin, businessId, user.data.user.id);
  if (action === "save_prompt") return savePrompt(admin, businessId, user.data.user.id, body.prompt);
  if (action === "preview_setter") return previewSetter(admin, businessId, user.data.user.id, body);
  if (action === "set_agent") return setAgent(admin, businessId, user.data.user.id, body);
  if (action === "save_policy") return savePolicy(admin, businessId, body.policy);
  return json(400, { ok: false, error: "Unknown action." });
});

async function load(admin, businessId, userId) {
  const [switches, prompt, policy, prefs] = await Promise.all([
    admin.from("acq_agent_switches").select("agent_key, enabled").eq("business_id", businessId),
    admin.from("acq_agent_prompts").select("body, tested_at").eq("business_id", businessId).maybeSingle(),
    admin.from("acq_followup_policy").select("*").eq("business_id", businessId).maybeSingle(),
    admin.from("acq_user_prefs").select("language").eq("user_id", userId).maybeSingle()
  ]);
  if (switches.error || prompt.error || policy.error) return json(200, { ok: false, error: "Apply the client dashboard migration, then refresh." });
  return json(200, {
    ok: true,
    switches: switches.data || [],
    prompt: prompt.data ? prompt.data.body || "" : "",
    tested_at: prompt.data ? prompt.data.tested_at : null,
    policy: normalizePolicy(policy.data || {}),
    language: prefs.data && prefs.data.language === "es" ? "es" : "en"
  });
}

async function savePrompt(admin, businessId, userId, prompt) {
  const body = String(prompt || "").trim().slice(0, 12000);
  const saved = await admin.from("acq_agent_prompts").upsert({
    business_id: businessId,
    agent_key: "setter",
    body,
    tested_at: null,
    updated_at: new Date().toISOString(),
    updated_by: userId
  });
  if (saved.error) return json(200, { ok: false, error: "The prompt was not saved. Apply the client dashboard migration first." });
  return json(200, { ok: true, prompt: body, tested_at: null });
}

async function previewSetter(admin, businessId, userId, body) {
  const prompt = String(body.prompt || "").trim().slice(0, 12000);
  const message = String(body.message || "").trim().slice(0, 500);
  const local = previewReply(prompt, message);
  if (!local.ok) return json(200, local);
  let reply = local.reply;
  let source = "preview";
  const env = Deno.env.toObject();
  try {
    const loaded = await loadBusinessRuntime(admin, businessId, "setter", env);
    const result = await completeJson({
      env,
      runtime: loaded.runtime,
      fallback: loaded.fallback,
      onError: (info) => logLlmError(admin, { businessId, purpose: "setter_preview", ...info }),
      system: prompt + "\n\nReply as the setter would in one short Instagram message. Do not call tools. Do not send anything.",
      messages: [{ role: "user", content: message }],
      responseFormat: { type: "text" }
    });
    const raw = typeof result === "string" ? result : "";
    const text = raw.trim();
    const safe = clientSafeText(text).slice(0, 500);
    if (safe) {
      reply = safe;
      source = "model";
    }
  } catch (error) {
    if (!error || error.code !== "llm_unconfigured") source = "preview";
  }
  const testedAt = new Date().toISOString();
  const saved = await admin.from("acq_agent_prompts").upsert({
    business_id: businessId,
    agent_key: "setter",
    body: prompt,
    tested_at: testedAt,
    updated_at: testedAt,
    updated_by: userId
  });
  if (saved.error) return json(200, { ok: false, error: "The tryout ran, but it was not saved. Apply the client dashboard migration first." });
  return json(200, { ok: true, reply, source, tested_at: testedAt });
}

async function setAgent(admin, businessId, userId, body) {
  const key = String(body.agent_key || "");
  if (!KEYS.has(key)) return json(400, { ok: false, error: "Unknown agent." });
  const enabled = body.enabled === true;
  if (enabled && key === "setter") {
    const prompt = await admin.from("acq_agent_prompts").select("body, tested_at").eq("business_id", businessId).maybeSingle();
    const gate = setterMayEnable({
      prompt: prompt.data && prompt.data.body,
      testedAt: prompt.data && prompt.data.tested_at
    });
    if (!gate.ok) return json(200, gate);
  }
  const saved = await admin.from("acq_agent_switches").upsert({
    business_id: businessId,
    agent_key: key,
    enabled,
    updated_at: new Date().toISOString(),
    updated_by: userId
  });
  if (saved.error) return json(200, { ok: false, error: "The switch was not saved. Apply the client dashboard migration first." });
  return json(200, { ok: true, agent_key: key, enabled });
}

async function savePolicy(admin, businessId, raw) {
  const policy = normalizePolicy(raw);
  const saved = await admin.from("acq_followup_policy").upsert({
    business_id: businessId,
    hours_since_last_message: policy.hoursSinceLastMessage,
    lead_stage: policy.leadStage,
    no_reply_after: policy.noReplyAfter,
    max_followups: policy.maxFollowups,
    booked: policy.booked,
    quiet_start: policy.quietStart,
    quiet_end: policy.quietEnd,
    updated_at: new Date().toISOString()
  });
  if (saved.error) return json(200, { ok: false, error: "The triggers were not saved. Apply the client dashboard migration first." });
  return json(200, { ok: true, policy });
}

async function saveLanguage(admin, userId, language) {
  const next = language === "es" ? "es" : "en";
  const saved = await admin.from("acq_user_prefs").upsert({
    user_id: userId,
    language: next,
    updated_at: new Date().toISOString()
  });
  if (saved.error) return json(200, { ok: false, error: "The language was not saved. Apply the client dashboard migration first." });
  return json(200, { ok: true, language: next });
}
