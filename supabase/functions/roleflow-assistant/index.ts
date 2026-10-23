// Roleflow Assistant. Answers how-to questions about the signed-in workspace.
// Uses the caller's JWT so database reads stay inside row level security.
// XAI_API_KEY stays in the function environment and is never returned.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const HOUR_LIMIT = 20;
const XAI_URL = "https://api.x.ai/v1/chat/completions";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const MAP = [
  "Dashboard (#dashboard): accounts, alerts, and whether the system is on.",
  "Onboarding (#onboarding): the questions that build the setter. Saving them updates the business. The prompt preview is #prompts.",
  "Business (#brief): the shared brief, per-agent instructions, version history, a quality score, and a conversation simulator. Live setter sync is off, so a save stays in the panel.",
  "Sales links (#links): named links with text, URL, coupon, average ticket, sending instructions, and an optional button. Scheduling endpoints are Calendly, GoHighLevel, or a custom URL.",
  "Value content (#content): image, audio, video, link, or button, plus voice-note recordings.",
  "Outbound Manager (#outbound): ICP Target Acquisition, Engagement Warm-Up, and Personalised Outreach. Daily cap is 20–30.",
  "Inbound Manager (#inbound): the Roleflow Setter Engine. Comment-to-DM, story DMs, qualification, follow-ups, and booking.",
  "CRM (#pipeline): Open, Discovering, Qualifying, Proposal, Booked, Paid, Lost, Unqualified, and Postponed. List and board, filters, notes, and a message queue that does not send while live sync is off.",
  "Stats (#stats): targets, conversations, qualified, booked, converted, conversion rate, attributed growth, and the 10% share, with a date range.",
  "Performance (#performance): results by source, outbound versus inbound.",
  "Configuration (#configuration): when the AI replies, who it replies to, when it stops, how it writes, lead classification, notifications, and connections.",
  "Team (#team): members and the invite link for this business.",
  "Admin roster (/admin/): one card per business. Open enters that business."
].join("\n");

const SYSTEM = [
  "You are the Roleflow Assistant inside a client's acquisition workspace.",
  "Voice: direct, specific, and calm. Explain the way a founder would want it explained.",
  "Roleflow sells Instagram DM sales systems, paid on commission: 10% of growth generated. No setup fee. No retainer.",
  "Colors you may mention if asked: navy #0A1226, gold #E8B04A, orange #FF8A3D, magenta #C0409A.",
  "Use only the workspace snapshot in this prompt and the page map. If a number is missing, say it is not in this workspace yet. Do not invent counts, revenue, or connections.",
  "When you tell someone where to click, include the hash from the map, such as #outbound.",
  "If someone asks whether a lead is talking to a bot, the setter's line is: Diego's team uses an AI assistant to keep up with conversations. Diego personally reviews them and takes the calls.",
  "Do not mention other software brands, vendors, or panel products.",
  "Page map:",
  MAP
].join("\n");

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

  let body: { business_id?: string; message?: string } = {};
  try {
    body = await req.json();
  } catch (_error) {
    body = {};
  }
  const businessId = String(body.business_id || "");
  const message = String(body.message || "").trim().slice(0, 800);
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) return json(400, { error: "Choose a business first." });
  if (message.length < 2) return json(400, { error: "Ask a question." });

  const workspace = await userClient.from("acq_workspaces").select("id, name").eq("id", businessId).maybeSingle();
  if (workspace.error || !workspace.data) return json(403, { error: "That business is not available on this account." });

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await userClient.from("acq_assistant_turns").select("id", { count: "exact", head: true }).eq("user_id", caller.id).eq("kind", "ask").gte("created_at", since);
  if (recent.error) return json(500, { error: "The assistant could not check the rate limit." });
  if ((recent.count || 0) >= HOUR_LIMIT) return json(429, { error: "Too many questions this hour. Try again later." });

  const marked = await userClient.from("acq_assistant_turns").insert({ user_id: caller.id, business_id: businessId, kind: "ask" });
  if (marked.error) return json(500, { error: "The assistant could not record this question." });

  const [settings, targets, bookings, deals, contacts] = await Promise.all([
    userClient.from("acq_settings").select("system_enabled, daily_cap, onboarding_step, timezone, setter_provider").eq("agent_id", businessId).maybeSingle(),
    userClient.from("acq_targets").select("lead_status, stage").eq("agent_id", businessId).limit(500),
    userClient.from("acq_bookings").select("id").eq("agent_id", businessId).limit(500),
    userClient.from("acq_deals").select("amount_cents, attributed").eq("agent_id", businessId).limit(200),
    userClient.from("acq_contacts").select("lead_status, is_converted").eq("business_id", businessId).limit(500)
  ]);

  const snapshot = {
    business: workspace.data.name,
    settings: settings.data || null,
    targets_loaded: targets.error ? null : (targets.data || []).length,
    bookings_loaded: bookings.error ? null : (bookings.data || []).length,
    contacts_loaded: contacts.error ? null : (contacts.data || []).length,
    attributed_cents: deals.error ? null : (deals.data || []).reduce((sum, row) => row.attributed === false ? sum : sum + (Number(row.amount_cents) || 0), 0)
  };

  const model = Deno.env.get("XAI_MODEL") || "grok-4.3";
  const response = await fetch(XAI_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + xaiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM + "\n\nWorkspace snapshot JSON:\n" + JSON.stringify(snapshot) },
        { role: "user", content: message }
      ]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload && payload.error ? String(payload.error.message || payload.error) : "The model did not answer.";
    return json(502, { error: detail.slice(0, 240) });
  }
  const reply = payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? String(payload.choices[0].message.content || "").trim()
    : "";
  if (!reply) return json(502, { error: "The model returned an empty answer." });
  return json(200, { reply });
});

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}
