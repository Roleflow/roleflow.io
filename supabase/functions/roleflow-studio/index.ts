// Business brief scoring, edits, and the conversation simulator.
// Uses the caller's JWT. The model key stays in the function environment.
// This function never messages a lead and never calls a messaging provider.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { completeChat, loadBusinessRuntime, loadSetterReply, logLlmError, platformDefault } from "../_shared/llm-provider.js";
import { PROMPT_MAX } from "../_shared/prompt-history.js";
import { applyPromptEdits, editBudget, editFailureMessage, editRequest, fetchWithDeadline, retryNote } from "../_shared/prompt-edits.js";

const HOUR_LIMIT = 15;
const XAI_URL = "https://api.x.ai/v1/chat/completions";
const FIELDS = ["sell", "credibility", "who", "pains", "desires", "beliefs", "current", "transformed", "problem", "offer", "service", "guarantee", "benefits", "differentiation", "mission", "results", "risks"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const SYSTEM = [
  "You help a business owner improve the brief their Roleflow agents read.",
  "Reply with JSON only. No markdown.",
  "Do not invent client names, revenue, case studies, or guarantees that are not in the brief.",
  "Do not mention other software brands.",
  "A practice conversation is not a real lead. Do not claim a message was sent."
].join(" ");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !anonKey || !serviceKey) return json(500, { error: "Supabase URL or keys are missing in the function environment." });

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  const caller = userData?.user;
  if (userError || !caller) return json(401, { error: "Sign in required." });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch (_error) {
    body = {};
  }
  const action = String(body.action || "");
  const businessId = String(body.business_id || "");
  if (!["score", "fix", "edit", "simulate", "draft"].includes(action)) return json(400, { error: "Choose score, fix, edit, simulate, or draft." });
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) return json(400, { error: "Choose a business first." });

  const workspace = await userClient.from("acq_workspaces").select("id").eq("id", businessId).maybeSingle();
  if (workspace.error || !workspace.data) return json(403, { error: "That business is not available on this account." });

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await userClient.from("acq_assistant_turns").select("id", { count: "exact", head: true }).eq("user_id", caller.id).eq("kind", "studio").gte("created_at", since);
  if (recent.error) return json(500, { error: "The model could not check the rate limit." });
  if ((recent.count || 0) >= HOUR_LIMIT) return json(429, { error: "Too many model requests this hour. Try again later." });

  const marked = await userClient.from("acq_assistant_turns").insert({ user_id: caller.id, business_id: businessId, kind: "studio" });
  if (marked.error) return json(500, { error: "The model could not record this request." });

  const fields = cleanFields(body.fields);
  const prompt = promptFor(action, fields, body);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const env = Deno.env.toObject();
  const promptEdit = (action === "edit" || action === "score") && String(body.prompt || "").trim();
  const planned = promptEdit ? await loadSetterReply(admin, businessId, env) : null;
  const setter = planned && planned.chain && planned.chain.length ? planned : null;
  const loaded = setter ? null : await loadBusinessRuntime(admin, businessId, "prompt", env);
  const runtime = loaded ? (loaded.runtime || platformDefault(env)) : null;
  if (runtime && runtime.provider === "xai" && !runtime.endpoint) runtime.endpoint = XAI_URL;
  if (!setter && !runtime) return json(503, { error: "The assistant is not available yet. The model key is not set." });
  if (action === "edit" && promptEdit) {
    return await editPrompt({ admin, businessId, setter, runtime, loaded, body });
  }
  let text = "";
  try {
    const result = setter
      ? await completeChat({
        chain: setter.chain,
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
        json: true,
        maxTokens: 8000,
        onError: (info) => logLlmError(admin, { businessId, purpose: "prompt", ...info })
      })
      : await completeChat({
        runtime,
        fallback: loaded && loaded.fallback,
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
        json: true,
        temperature: 0.2,
        onError: (info) => logLlmError(admin, { businessId, purpose: "prompt", ...info })
      });
    text = result.text || "";
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The model did not answer.";
    return json(502, { error: detail.slice(0, 240) });
  }
  const parsed = parseJson(text);
  if (!parsed) return json(502, { error: "The model did not return JSON." });
  if (action === "score") {
    const score = Math.max(0, Math.min(10, Math.round(Number(parsed.score) || 0)));
    const items = Array.isArray(parsed.items) ? parsed.items.map((item) => String(item).slice(0, 180)).slice(0, 8) : [];
    return json(200, { score, items });
  }
  if (action === "simulate" || action === "draft") {
    const reply = String(parsed.reply || "").trim().slice(0, 2000);
    if (!reply) return json(502, { error: "The model returned an empty reply." });
    return json(200, { reply });
  }
  return json(200, { fields: cleanFields(parsed.fields || parsed) });
});

function promptFor(action: string, fields: Record<string, string>, body: Record<string, unknown>) {
  if (action === "score") {
    const prompt = String(body.prompt || "").trim();
    if (prompt) {
      return "Score this agent prompt from 0 to 10. Return {\"score\": number, \"items\": string[] } with at most 8 short improvements. Prompt:\n" + prompt.slice(0, PROMPT_MAX);
    }
    return "Score this business brief from 0 to 10. Return {\"score\": number, \"items\": string[] } with at most 8 short improvements. Brief JSON:\n" + JSON.stringify(fields);
  }
  if (action === "fix") {
    const items = Array.isArray(body.items) ? body.items.map((item) => String(item)).slice(0, 8) : [];
    return "Rewrite the brief so the listed gaps are filled with questions or tighter wording already implied by the text. Return {\"fields\": {same keys}}. Do not add facts that are not in the brief. Gaps: " + JSON.stringify(items) + "\nBrief JSON:\n" + JSON.stringify(fields);
  }
  if (action === "edit") {
    const instruction = String(body.instruction || "").slice(0, 500);
    return "Apply this edit to the brief and return {\"fields\": {same keys}}. Edit: " + instruction + "\nBrief JSON:\n" + JSON.stringify(fields);
  }
  const lines = Array.isArray(body.lines) ? body.lines.slice(-12) : [];
  if (action === "draft") {
    return "Draft one reply a person can edit. Do not claim it was sent. Return {\"reply\": string}. Lead state: " + String(body.lead_state || "open") + ". Thread JSON:\n" + JSON.stringify(lines) + "\nBrief JSON:\n" + JSON.stringify(fields);
  }
  return "Practice reply only. The user is playing " + String(body.as || "lead") + ". Lead state: " + String(body.lead_state || "open") + ". Return {\"reply\": string}. Thread JSON:\n" + JSON.stringify(lines) + "\nBrief JSON:\n" + JSON.stringify(fields);
}

// "Edit with AI" on the setter prompt. The whole prompt goes to the model, but
// the model sends back only the edits, which are applied here. Unasked parts
// stay exactly as the owner wrote them, the reply is small and fast, and a
// long prompt is never cut off or truncated.
async function editPrompt({ admin, businessId, setter, runtime, loaded, body }) {
  const original = String(body.prompt || "").trim();
  if (original.length > PROMPT_MAX) return json(400, { error: "This prompt is longer than " + PROMPT_MAX + " characters." });
  const instruction = String(body.instruction || "").trim().slice(0, 500);
  if (!instruction) return json(400, { error: "Write what to change." });
  const budget = editBudget(instruction);
  const started = Date.now();
  const ask = async (note) => {
    const input = {
      system: SYSTEM,
      messages: [{ role: "user", content: editRequest(original, instruction, note) }],
      json: true,
      maxTokens: budget.maxTokens,
      fetchImpl: fetchWithDeadline(budget.timeoutMs),
      onError: (info) => logLlmError(admin, { businessId, purpose: "prompt", ...info })
    };
    return setter
      ? await completeChat({ ...input, chain: setter.chain.slice(0, 2) })
      : await completeChat({ ...input, runtime, fallback: loaded && loaded.fallback, temperature: 0.2 });
  };
  let note = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let result;
    try {
      result = await ask(note);
    } catch (error) {
      return json(502, { error: editFailureMessage(error) });
    }
    const parsed = parseJson(result.text || "");
    if (!parsed) {
      const cut = result.trimmedCutOff ? { code: "cut_off" } : { message: "The model did not return JSON." };
      return json(502, { error: editFailureMessage(cut) });
    }
    const edits = Array.isArray(parsed.edits) ? parsed.edits : [];
    const summary = String(parsed.summary || "").trim().slice(0, 300);
    if (!edits.length) return json(200, { ok: false, error: summary || "The AI made no change.", prompt: "" });
    const applied = applyPromptEdits(original, edits);
    if (applied.ok) {
      if (!applied.changed) return json(200, { ok: false, error: "The AI made no change.", prompt: "" });
      console.log(JSON.stringify({ event: "prompt_edit", business_id: businessId, chars_in: original.length, chars_out: applied.prompt.length, edits: applied.applied, attempts: attempt + 1, ms: Date.now() - started }));
      return json(200, { ok: true, prompt: applied.prompt.slice(0, PROMPT_MAX), summary, edits: applied.applied });
    }
    note = retryNote(applied.failed);
  }
  return json(502, { error: "The AI could not match the text to change. Nothing was changed. Try quoting the line you want edited." });
}

function cleanFields(input: unknown) {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const fields: Record<string, string> = {};
  FIELDS.forEach((key) => {
    fields[key] = String(source[key] == null ? "" : source[key]).slice(0, 8000);
  });
  return fields;
}

function parseJson(text: string) {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch (_again) {
      return null;
    }
  }
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}
