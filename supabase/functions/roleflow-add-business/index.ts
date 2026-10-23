// Creates a paused workspace and a first setter prompt from the onboarding answers.
// The caller reviews that prompt in the editor. This function does not deploy it.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { headedSections, SECTION_HEADINGS } from "../_shared/prompt-headings.js";
import { completeChat, logLlmError, platformDefault } from "../_shared/llm-provider.js";
import { flushSyncNotice } from "../_shared/sync-notice.js";

const XAI_URL = "https://api.x.ai/v1/chat/completions";
const KEYS = ["exclusion", "non_negotiables", "role", "guardrails", "knowledge", "workflow", "objections"];
const TITLES = [
  "Highest Priority Rule (Exclusion)",
  "Non-Negotiables",
  "The Role",
  "The Guardrails",
  "Context and Knowledge",
  "Workflow Logic",
  "Objection Handling"
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  const userClient = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_ANON_KEY") || "", {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } }
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(401, { error: "Sign in required." });
  let body: Record<string, string> = {};
  try { body = await req.json(); } catch (_error) { body = {}; }
  const name = String(body.name || "").trim().slice(0, 80);
  const handle = String(body.handle || "").trim().replace(/^@+/, "").toLowerCase().slice(0, 30);
  if (!name) return json(400, { ok: false, error: "Add the business name." });
  const env = Deno.env.toObject();
  const runtime = platformDefault(env);
  if (runtime && runtime.provider === "xai") runtime.endpoint = XAI_URL;
  if (!runtime) return json(200, { ok: false, error: "The prompt could not be written yet. Nothing was created." });
  let sections: Record<string, string>;
  try {
    sections = await draftSections(runtime, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The prompt could not be written.";
    return json(200, { ok: false, error: message });
  }
  const created = await userClient.rpc("acq_create_onboarding_workspace", { p_name: name, p_handle: handle });
  if (created.error || !created.data) return json(200, { ok: false, error: created.error ? created.error.message : "The business was not created." });
  const businessId = String(created.data);
  const version = await userClient.from("acq_prompt_versions").insert({
    business_id: businessId,
    role: "inbound_manager",
    version: 1,
    sections,
    created_by: userData.user.id
  }).select("id").single();
  if (version.error || !version.data) return json(200, { ok: false, error: "The business exists, but the prompt was not saved.", business_id: businessId });
  const current = await userClient.from("acq_prompt_current").upsert({
    business_id: businessId,
    role: "inbound_manager",
    version_id: version.data.id
  });
  if (current.error) return json(200, { ok: false, error: "The business exists, but the prompt was not saved.", business_id: businessId });
  const hours = clamp(body.followup_hours, 1, 23, 6);
  const count = clamp(body.followup_count, 1, 5, 3);
  const queued = await userClient.rpc("acq_enqueue_create_agent", {
    p_business: businessId,
    p_version: version.data.id,
    p_personality: String(body.tone || "").slice(0, 500),
    p_languages: String(body.languages || "").slice(0, 120),
    p_timezone: String(body.timezone || "Europe/Madrid").slice(0, 80),
    p_followup_hours: hours,
    p_followup_count: count,
    p_booking: String(body.booking || "").slice(0, 500)
  });
  if (queued.error || !queued.data) {
    return json(200, { ok: false, error: "The business exists, but the setter was not queued.", business_id: businessId });
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const notice = flushSyncNotice(admin, businessId, {
    apiKey: Deno.env.get("RESEND_API_KEY") || "",
    from: Deno.env.get("RESEND_FROM") || ""
  });
  const edge = (globalThis as { EdgeRuntime?: { waitUntil?: (task: Promise<unknown>) => void } }).EdgeRuntime;
  if (edge && edge.waitUntil) edge.waitUntil(notice);
  else notice.catch(() => {});
  return json(200, { ok: true, business_id: businessId, version: 1, sync: "pending" });
});

function clamp(value: string, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

async function draftSections(runtime: { provider: string; model: string; apiKey: string; baseUrl: string; source: string; endpoint?: string }, answers: Record<string, string>) {
  const result = await completeChat({
    runtime: { ...runtime, model: runtime.model || Deno.env.get("XAI_MODEL") || "grok-4.7" },
    temperature: 0.3,
    maxTokens: 8000,
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "setter_sections",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: KEYS,
          properties: Object.fromEntries(KEYS.map((key) => [key, { type: "string" }]))
        }
      }
    },
    system: "Write a setter prompt as JSON with these keys, in this spirit: " + KEYS.map((key, index) => key + " = " + TITLES[index]).join("; ") + ". The first line of each value must be a markdown heading, exactly one of these and nothing else on that line: " + SECTION_HEADINGS.map((row) => row[1]).join("; ") + ". Use only the facts in the brief. exclusion is the highest priority rule and lists who must never be contacted. non_negotiables are the rules that never bend. role is the job. guardrails are the limits. knowledge is offer, price, ideal client, FAQs and facts. workflow is the conversation, qualification, follow-ups and booking. objections answers the stated objections. Do not invent prices, links or results that the brief does not give. Do not mention any vendor name.",
    messages: [{ role: "user", content: briefOf(answers) }],
    onError: (info) => logLlmError(null, info)
  });
  const payload = { choices: [{ message: { content: result.text } }] };
  if (!result.text) throw new Error("The prompt could not be written.");
  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("The prompt could not be written.");
  const parsed = JSON.parse(text);
  const sections: Record<string, string> = {};
  KEYS.forEach((key) => {
    const value = String(parsed[key] || "").trim();
    sections[key] = value || fallback(key, answers);
  });
  return headedSections(sections);
}

function briefOf(answers: Record<string, string>) {
  const fields = [
    ["Business name", answers.name],
    ["Instagram", answers.handle],
    ["Offer and price", answers.offer],
    ["Ideal client", answers.ideal],
    ["Qualification", answers.criteria],
    ["Objections", answers.objections],
    ["Exclusions", answers.exclusions],
    ["Booking link", answers.booking],
    ["Tone", answers.tone],
    ["Languages", answers.languages],
    ["Timezone", answers.timezone],
    ["Follow-up hours", answers.followup_hours],
    ["Follow-up count", answers.followup_count],
    ["FAQs", answers.faqs]
  ];
  return fields.map(([label, value]) => label + ": " + String(value || "").trim().slice(0, 2000)).join("\n");
}

function fallback(key: string, answers: Record<string, string>) {
  if (key === "exclusion") return String(answers.exclusions || "No exclusions were given.");
  if (key === "role") return "Setter for " + String(answers.name || "this business") + ".";
  if (key === "knowledge") return [answers.offer, answers.ideal, answers.faqs].filter(Boolean).join("\n") || "No extra facts were given.";
  if (key === "workflow") return [answers.criteria, answers.booking].filter(Boolean).join("\n") || "Qualify, then offer the booking link.";
  if (key === "objections") return String(answers.objections || "No objections were given.");
  if (key === "non_negotiables") return "One question at a time. Do not invent facts.";
  return "Stay inside the facts the owner gave.";
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
