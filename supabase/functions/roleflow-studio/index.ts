// Business brief scoring, edits, and the conversation simulator.
// Uses the caller's JWT. The model key stays in the function environment.
// This function never messages a lead and never calls a messaging provider.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";

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
  const xaiKey = Deno.env.get("XAI_API_KEY") || "";
  if (!supabaseUrl || !anonKey) return json(500, { error: "Supabase URL or keys are missing in the function environment." });
  if (!xaiKey) return json(503, { error: "The assistant is not available yet. The model key is not set." });

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
  const model = Deno.env.get("XAI_MODEL") || "grok-4.3";
  const response = await fetch(XAI_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + xaiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt }
      ]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload && payload.error ? String(payload.error.message || payload.error) : "The model did not answer.";
    return json(502, { error: detail.slice(0, 240) });
  }
  const text = payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? String(payload.choices[0].message.content || "")
    : "";
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
