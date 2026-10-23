// Tiny completion so an editor can confirm a provider before saving it.
// A typed key is used once and is not stored. A saved key is read server-side
// and is never returned.

import {
  completeChat,
  logLlmError,
  normalizeProvider,
  platformEnv,
  PROVIDERS,
  redactSecret,
  safeBaseUrl
} from "../_shared/llm-provider.js";
import { adminClient, cors, json, userClientFrom } from "../_shared/gateway-http.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST." });
  const userClient = userClientFrom(req);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(401, { ok: false, error: "Sign in required." });
  let body: { business_id?: string; purpose?: string; provider?: string; model?: string; base_url?: string; api_key?: string } = {};
  try { body = await req.json(); } catch (_error) { body = {}; }
  const businessId = String(body.business_id || "");
  if (!UUID.test(businessId)) return json(400, { ok: false, error: "Choose a business." });
  const allowed = await userClient.rpc("acq_can_edit", { p_workspace: businessId });
  if (allowed.error || allowed.data !== true) return json(403, { ok: false, error: "You can't edit this business." });
  const purpose = body.purpose === "prompt" ? "prompt" : "setter";
  const provider = normalizeProvider(body.provider);
  if (!provider) return json(400, { ok: false, error: "Choose a provider." });
  const model = String(body.model || PROVIDERS[provider].defaultModel || "").trim().slice(0, 120);
  if (!model) return json(400, { ok: false, error: "Enter a model id." });
  const typedBase = safeBaseUrl(body.base_url);
  if (provider === "custom" && !typedBase) return json(400, { ok: false, error: "The custom address has to be https." });
  const admin = adminClient();
  const env = Deno.env.toObject();
  let apiKey = String(body.api_key || "").trim();
  let baseUrl = provider === "custom" ? typedBase : "";
  if (apiKey && (apiKey.length < 8 || apiKey.length > 400)) {
    return json(400, { ok: false, error: "That key is not a usable length." });
  }
  if (!apiKey) {
    const loaded = await admin.rpc("acq_llm_read_key", { p_business: businessId, p_provider: provider });
    const stored = loaded && !loaded.error ? loaded.data : null;
    if (stored && stored.ok === true && stored.api_key) {
      apiKey = String(stored.api_key);
      if (provider === "custom" && !baseUrl) baseUrl = safeBaseUrl(stored.base_url);
    }
  }
  if (!apiKey && provider !== "custom") apiKey = platformEnv(env)[provider] || "";
  if (!apiKey) return json(200, { ok: false, error: "No key is saved for that provider." });
  try {
    const result = await completeChat({
      runtime: { provider, model, apiKey, baseUrl, source: "test" },
      fallback: null,
      system: "Reply with the single word pong.",
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 16,
      temperature: 0,
      onError: (entry) => logLlmError(admin, { ...entry, businessId, purpose: "test" })
    });
    const reply = redactSecret(String(result.text || "").trim(), apiKey).slice(0, 80);
    return json(200, { ok: true, reply: reply || "pong" });
  } catch (error) {
    return json(200, { ok: false, error: redactSecret(error && error.message, apiKey) || "The connection did not answer." });
  }
});
