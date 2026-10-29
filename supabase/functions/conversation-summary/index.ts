// Summarises stored chats with Claude. The key stays on the server.

import { parseSummaryText, summaryRequest, SUMMARY_MODEL } from "../_shared/chat-summary.js";
import { adminClient, cors, json, userClientFrom } from "../_shared/gateway-http.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST." });
  const userClient = userClientFrom(req);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(401, { ok: false, error: "Sign in required." });
  let body: { business_id?: string; contact_id?: string; days?: number; regenerate?: boolean } = {};
  try { body = await req.json(); } catch (_error) { body = {}; }
  const businessId = String(body.business_id || "");
  const contactId = String(body.contact_id || "");
  const days = body.days === 30 ? 30 : 7;
  if (!UUID.test(businessId)) return json(400, { ok: false, error: "That business was not found." });
  const allowed = await userClient.rpc("acq_can_read", { p_workspace: businessId });
  if (allowed.error || allowed.data !== true) return json(403, { ok: false, error: "You can't view this business." });
  const admin = adminClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const contacts = await admin.from("acq_contacts").select("id, name, ig_handle, crm_state, ai_enabled, updated_at").eq("business_id", businessId).gte("updated_at", since).limit(200);
  const rows = contacts.error ? [] : contacts.data || [];
  const aggregate = countOutcomes(rows);
  if (!rows.length) return json(200, { ok: true, summary: { empty: true, conversation: null, aggregate } });
  let conversation = null;
  if (UUID.test(contactId) && rows.some((row) => row.id === contactId)) {
    conversation = await conversationSummary(admin, businessId, contactId, days, body.regenerate === true);
    if (conversation && conversation.questions) aggregate.questions = conversation.questions;
    if (conversation && conversation.objections) aggregate.objections = conversation.objections;
  }
  return json(200, { ok: true, summary: { empty: false, conversation, aggregate } });
});

function countOutcomes(rows: Array<{ crm_state?: string; ai_enabled?: boolean }>) {
  const byOutcome = { new: 0, qualified: 0, booked: 0, lost: 0 };
  rows.forEach((row) => {
    const state = row.crm_state || "";
    if (state === "open" || state === "discovering") byOutcome.new += 1;
    else if (state === "qualifying" || state === "proposal") byOutcome.qualified += 1;
    else if (state === "booked" || state === "paid") byOutcome.booked += 1;
    else if (state === "lost" || state === "unqualified") byOutcome.lost += 1;
  });
  return {
    conversations: rows.length,
    byOutcome,
    objections: [] as string[],
    questions: [] as string[],
    booked: byOutcome.booked,
    needsHuman: rows.filter((row) => row.ai_enabled === false).length
  };
}

async function conversationSummary(admin: ReturnType<typeof adminClient>, businessId: string, contactId: string, days: number, regenerate: boolean) {
  if (!regenerate) {
    const cached = await admin.from("acq_chat_summaries").select("body, updated_at").eq("business_id", businessId).eq("contact_id", contactId).eq("period_days", days).maybeSingle();
    if (!cached.error && cached.data && cached.data.body) return cached.data.body;
  }
  const conversation = await admin.from("acq_conversations").select("id").eq("business_id", businessId).eq("contact_id", contactId).maybeSingle();
  if (conversation.error || !conversation.data) return null;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const messages = await admin.from("acq_messages").select("sender, role, body, sent_at").eq("business_id", businessId).eq("conversation_id", conversation.data.id).gte("sent_at", since).order("sent_at", { ascending: true }).limit(80);
  const lines = (messages.error ? [] : messages.data || []).map((row) => (row.sender || row.role) + ": " + row.body).filter((line) => line.trim().length > 2);
  if (!lines.length) return null;
  const key = await claudeKey(admin, businessId);
  if (!key) return null;
  const request = summaryRequest(lines.join("\n"));
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  const payload = await response.json().catch(() => ({}));
  const text = payload && payload.content && payload.content[0] && payload.content[0].text;
  const parsed = parseSummaryText(text);
  if (!response.ok || !parsed) return null;
  await admin.from("acq_chat_summaries").upsert({
    business_id: businessId,
    contact_id: contactId,
    period_days: days,
    body: parsed,
    model: SUMMARY_MODEL,
    updated_at: new Date().toISOString()
  }, { onConflict: "business_id,contact_id,period_days" });
  return parsed;
}

async function claudeKey(admin: ReturnType<typeof adminClient>, businessId: string) {
  const loaded = await admin.rpc("acq_llm_read_key", { p_business: businessId, p_provider: "anthropic" });
  const owned = loaded && !loaded.error && loaded.data && loaded.data.ok === true ? String(loaded.data.api_key || "") : "";
  return owned || String(Deno.env.get("ANTHROPIC_API_KEY") || "");
}
