// Roleflow Assistant. Answers how-to questions about the signed-in workspace.
// Uses the caller's JWT so database reads stay inside row level security.
// XAI_API_KEY stays in the function environment and is never returned.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { completeChat, loadBusinessRuntime, logLlmError, platformDefault } from "../_shared/llm-provider.js";

const HOUR_LIMIT = 20;
const XAI_URL = "https://api.x.ai/v1/chat/completions";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const MAP = [
  "Dashboard (#dashboard): leads, chats, booked calls, agents that are live, the show-up rate, and the Roleflow share. Show-up is showed calls divided by showed plus no-shows.",
  "Setup (#onboarding): business, offer, Instagram, worker, voice notes, then go live. Go live turns agents on.",
  "SOPs (#sops): the shared brief, per-agent instructions, version history, a quality score, and a conversation simulator. Live setter sync is off, so a save stays in the panel.",
  "Calendar (#calendar): record a booked call by Instagram handle, then set show-up to scheduled, showed, no-show, or cancelled. Connecting Google Calendar is separate and lives in Settings.",
  "Billing (#billing): record cash collected on a deal this system sourced. The share is 10% of that amount. Nothing is owed for a deal that is not recorded.",
  "Chats (#chats): threads stored for this business. Full history appears when the event stream is connected.",
  "Opportunities (#opportunities): the lead list, from Open through Postponed. Filters, notes, and a message queue that does not send while live sync is off.",
  "Performance (#performance): origins such as story, post, reel, ad, or a keyword, plus a 12-month projection from numbers the user types.",
  "Content (#content): files and links an agent can send, plus recordings.",
  "Voice Gen (#voice): the owner's own voice notes by slot. A cloned voice is not used.",
  "Lead Warmer (#warmer) and Outreacher (#outreacher): each stays off until it is turned on. The external sign-in button stays disabled until a real https address is configured.",
  "Agentic Setter (#setter): the system prompt, version restore, reply delay, booking link, and a practice thread. Practice uses the selected model and does not send an Instagram message.",
  "Comment voice (#commentvoice): keyword or intent rules that queue one private reply. It stays off until it is turned on. The reply is text.",
  "Follow Up Boss (#followup): quiet hours, stage, booking, and a cap. It stays off until it is turned on.",
  "Settings (#settings): the model key, Instagram connect, the eight configuration questions, sales links, and team invites.",
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
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !anonKey || !serviceKey) return json(500, { error: "Supabase URL or keys are missing in the function environment." });

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  const caller = userData?.user;
  if (userError || !caller) return json(401, { error: "Sign in required." });

  let body: { business_id?: string; message?: string; mode?: string } = {};
  try {
    body = await req.json();
  } catch (_error) {
    body = {};
  }
  const businessId = String(body.business_id || "");
  const message = String(body.message || "").trim().slice(0, 800);
  const mode = ["ask", "leads", "ai", "report"].includes(String(body.mode || "ask")) ? String(body.mode || "ask") : "ask";
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
    userClient.from("acq_bookings").select("show_status").eq("agent_id", businessId).limit(500),
    userClient.from("acq_deals").select("amount_cents, attributed").eq("agent_id", businessId).limit(200),
    userClient.from("acq_contacts").select("lead_status, is_converted").eq("business_id", businessId).limit(500)
  ]);

  const bookingRows = bookings.error ? [] : (bookings.data || []);
  const showed = bookingRows.filter((row) => row.show_status === "showed").length;
  const noShow = bookingRows.filter((row) => row.show_status === "no_show").length;
  const attributedCents = deals.error ? null : (deals.data || []).reduce((sum, row) => row.attributed === false ? sum : sum + (Number(row.amount_cents) || 0), 0);
  const snapshot = {
    business: workspace.data.name,
    settings: settings.data || null,
    targets_loaded: targets.error ? null : (targets.data || []).length,
    bookings_loaded: bookings.error ? null : bookingRows.length,
    showed: bookings.error ? null : showed,
    no_show: bookings.error ? null : noShow,
    show_up_rate: bookings.error || showed + noShow === 0 ? null : showed / (showed + noShow),
    contacts_loaded: contacts.error ? null : (contacts.data || []).length,
    attributed_cents: attributedCents,
    share_cents: attributedCents == null ? null : Math.round(attributedCents * 0.1)
  };

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const env = Deno.env.toObject();
  const loaded = await loadBusinessRuntime(admin, businessId, "prompt", env);
  const runtime = loaded.runtime || platformDefault(env);
  if (runtime && runtime.provider === "xai" && !runtime.endpoint) runtime.endpoint = XAI_URL;
  if (!runtime) return json(503, { error: "The assistant is not available yet. The model key is not set." });
  let reply = "";
  try {
    const result = await completeChat({
      runtime,
      fallback: loaded.fallback,
      system: SYSTEM + modeNote(mode) + "\n\nWorkspace snapshot JSON:\n" + JSON.stringify(snapshot),
      messages: [{ role: "user", content: message }],
      temperature: 0.2,
      onError: (info) => logLlmError(admin, { businessId, purpose: "assistant", ...info })
    });
    reply = String(result.text || "").trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The model did not answer.";
    return json(502, { error: detail.slice(0, 240) });
  }
  if (!reply) return json(502, { error: "The model returned an empty answer." });
  if (mode === "ask" || mode === "report") return json(200, { reply });
  const parsed = parseProposal(reply);
  return json(200, { reply: parsed.reply, proposal: parsed.proposal });
});

function modeNote(mode: string) {
  if (mode === "ask" || mode === "report") {
    return mode === "report"
      ? "\n\nWrite a short report from the snapshot. Do not invent numbers. Do not propose a change."
      : "";
  }
  return [
    "\n\nReply with JSON only: {\"reply\":\"short explanation\",\"proposal\":null}",
    "For a lead change, proposal is {\"type\":\"lead\",\"handle\":\"name\",\"crm_state\":\"Booked\"}.",
    "crm_state is one of Open, Discovering, Qualifying, Proposal, Booked, Paid, Lost, Unqualified, Postponed.",
    "For a setting change, proposal is {\"type\":\"setting\",\"patch\":{}} with only keys you were asked to change.",
    "Allowed patch keys: system_enabled, office_mode, timezone, reply_delay_seconds, reply_delay_max_seconds, keyword_only, skip_followed, strip_inverted_punct, disclosure_enabled, disclosure_text.",
    "office_mode is always, same, or per_day.",
    "If you are not sure, set proposal to null. Do not claim the change is already saved."
  ].join(" ");
}

function parseProposal(reply: string) {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return { reply, proposal: null };
  try {
    const parsed = JSON.parse(reply.slice(start, end + 1));
    const text = typeof parsed.reply === "string" ? parsed.reply : reply;
    return { reply: text, proposal: parsed.proposal || null };
  } catch (_error) {
    return { reply, proposal: null };
  }
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}
