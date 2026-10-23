// Sync plan for one business. The public setter API can read leads and
// mark a lead converted or record an order. It cannot take a workflow,
// personality, tags, notes, or the other settings, so those stay here.
// This module never sends a message.

export const ROUND_TRIP = [
  { id: "lead_id", label: "Lead id" },
  { id: "lead_status", label: "Lead status and converted flag" },
  { id: "chat", label: "Chat history, when the payload includes it" },
  { id: "mark_converted", label: "Paid lead marked converted" },
  { id: "mark_order", label: "Order amount on a paid lead" }
];

export const ROLEFLOW_ONLY = [
  { id: "workflow", label: "Brief sections as the workflow" },
  { id: "personality", label: "Personality" },
  { id: "statuses", label: "Lead status definitions" },
  { id: "tags", label: "Manual tags" },
  { id: "attributes", label: "Attributes to extract" },
  { id: "followups", label: "Follow-up on/off, period, and count" },
  { id: "trigger", label: "Trigger message" },
  { id: "autolock", label: "Autolock and its condition" },
  { id: "delay", label: "Message delay" },
  { id: "quick", label: "Quick responses" },
  { id: "keywords", label: "Comment and story keywords" },
  { id: "notes", label: "Remarks and notes" },
  { id: "owner", label: "Lead owner" },
  { id: "other_status", label: "Lead status other than paid" }
];

const PAID = new Set(["paid", "converted"]);

export function isPaid(row) {
  const state = String(row.crm_state || row.state || row.lead_status || "").toLowerCase();
  return PAID.has(state) || row.is_converted === true;
}

function cleanHandle(value) {
  const raw = String(value || "").trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(raw) ? raw : "";
}

function numericId(value) {
  const text = String(value == null ? "" : value).trim();
  return /^\d{5,20}$/.test(text) ? text : "";
}

export function contactKey(row) {
  const candidates = [row.instagram_user_id, row.ig_user_id, row.igsid, row.contact];
  for (const value of candidates) {
    const id = numericId(value);
    if (id) return id;
  }
  const handle = cleanHandle(row.ig_handle || row.handle || row.username || row.lead_contact);
  if (handle && !handle.startsWith("tt")) return handle;
  return "";
}

function leadExternalId(lead) {
  const id = lead && (lead.id || lead.lead_id || lead.external_id);
  return id == null ? "" : String(id).trim().slice(0, 200);
}

function leadMessages(lead) {
  const lists = [lead.chat_history, lead.messages, lead.conversation, lead.history];
  const list = lists.find((item) => Array.isArray(item)) || [];
  return list.slice(0, 30).map((item, index) => {
    if (!item || typeof item !== "object") return null;
    const roleRaw = String(item.role || item.sender || "user").toLowerCase();
    const role = /assist|bot|agent|outgoing/.test(roleRaw) ? "assistant" : roleRaw === "system" ? "system" : "user";
    const body = String(item.text || item.content || item.body || "").slice(0, 4000);
    if (!body) return null;
    const sent = item.time || item.timestamp || item.created_at || null;
    return {
      external_id: String(item.id || item.message_id || index + ":" + body.slice(0, 24)).slice(0, 180),
      role,
      body,
      sent_at: sent ? String(sent) : null
    };
  }).filter(Boolean);
}

function statusOf(lead) {
  if (lead.is_converted === true) return "converted";
  const raw = String(lead.lead_status || lead.status || "").trim().toLowerCase();
  if (["cold", "warm", "hot", "converted", "dead"].includes(raw)) return raw;
  if (raw === "spam" || raw === "lost" || raw === "unqualified") return "dead";
  return "cold";
}

export function workflowDraft(snapshot) {
  const brief = (snapshot.brief && snapshot.brief.fields) || {};
  const settings = snapshot.settings || {};
  return {
    sections: brief,
    personality: brief.voice || "",
    followups: {
      enabled: (snapshot.followupSteps || []).length > 0,
      period_hours: settings.followup_hours || null,
      count: settings.followup_count || null
    },
    delay_seconds: settings.reply_delay_seconds ?? null,
    autolock: {
      enabled: settings.stop_on_human !== false,
      condition: settings.stop_condition || ""
    },
    trigger_message: (snapshot.commentCtas || []).map((row) => row.dm_text).filter(Boolean)[0] || "",
    keywords: {
      comments: (snapshot.commentCtas || []).map((row) => row.keyword),
      stories: (snapshot.storyCtas || []).map((row) => row.keyword)
    },
    tags: (snapshot.tagRules || []).map((row) => row.name),
    attributes: ["budget", "timeline", "decision_maker", "fit"]
  };
}

export function pushPlan(snapshot, options = {}) {
  const enabled = snapshot.settings && snapshot.settings.studio_setter_sync === true;
  const roleflowOnly = ROLEFLOW_ONLY.map((item) => item.id);
  if (!enabled) {
    return { enabled: false, calls: [], roleflowOnly, draft: null };
  }
  const calls = [];
  const allowWorkflow = options.allowWorkflow === true;
  const draft = workflowDraft(snapshot);
  if (allowWorkflow) {
    calls.push({ op: "update_draft", body: { draft } });
    calls.push({ op: "deploy", body: { agent_id: snapshot.agentId || "" } });
  }
  const seen = new Set();
  (snapshot.leads || []).forEach((lead) => {
    if (!isPaid(lead)) return;
    const contactId = contactKey(lead);
    const externalId = String(lead.external_id || "").slice(0, 200);
    if (!contactId || !externalId || seen.has(externalId)) return;
    seen.add(externalId);
    calls.push({
      op: "mark_converted",
      external_id: externalId,
      body: { contact_ids: [contactId] }
    });
  });
  (snapshot.deals || []).forEach((deal) => {
    const amount = Number(deal.amount_cents) / 100;
    const lead = (snapshot.leads || []).find((row) => row.id === deal.contact_id || row.external_id === deal.external_id);
    const contactId = lead ? contactKey(lead) : "";
    if (!(amount > 0) || !contactId || !deal.id) return;
    calls.push({
      op: "mark_order",
      external_id: String(deal.external_id || lead.external_id || ""),
      body: {
        contact_id: contactId,
        amount,
        currency: deal.currency || "USD",
        order_id: String(deal.id)
      }
    });
  });
  return { enabled: true, calls, roleflowOnly: allowWorkflow ? roleflowOnly.filter((id) => !["workflow", "personality", "followups", "delay", "autolock", "trigger", "keywords", "tags", "attributes"].includes(id)) : roleflowOnly, draft };
}

export function pullRows(payload) {
  const data = payload && payload.data && !Array.isArray(payload.data) ? payload.data : payload;
  const leads = (data && data.leads) || (payload && payload.leads) || [];
  const seen = new Set();
  const rows = [];
  (Array.isArray(leads) ? leads : []).forEach((lead) => {
    const externalId = leadExternalId(lead);
    if (!externalId || seen.has(externalId)) return;
    seen.add(externalId);
    const messages = [];
    const seenMessage = new Set();
    leadMessages(lead).forEach((message) => {
      if (seenMessage.has(message.external_id)) return;
      seenMessage.add(message.external_id);
      messages.push(message);
    });
    const status = statusOf(lead);
    const handle = cleanHandle(lead.username || lead.lead_contact || lead.ig_handle) || ("tt" + externalId.replace(/[^a-z0-9]/g, "").slice(0, 28));
    rows.push({
      external_id: externalId,
      name: String(lead.lead_name || lead.name || "").slice(0, 200),
      contact: String(lead.lead_contact || "").slice(0, 200),
      handle: handle.slice(0, 30),
      ig_handle: cleanHandle(lead.ig_handle || lead.username || ""),
      lead_status: status,
      stage: status === "converted" ? "booked" : status === "dead" ? "dead" : status === "hot" || status === "warm" ? "qualified" : "reply",
      category: String(lead.category || "").slice(0, 40),
      source_detail: String(lead.integration || lead.lead_source || "").slice(0, 200),
      detail: "pull",
      attributes: {},
      last_message_at: lead.last_message_time || null,
      followups: Number(lead.total_followups || 0) || 0,
      messages
    });
  });
  return rows;
}

export function newExternalIds(existing, rows) {
  const have = new Set(existing || []);
  return (rows || []).filter((row) => row.external_id && !have.has(row.external_id)).map((row) => row.external_id);
}

export async function executePlan(plan, transport) {
  const results = [];
  for (const call of plan.calls) {
    if (call.op === "send_message") throw new Error("Refusing to message a lead.");
    const result = await transport(call);
    const error = result && result.error ? String(result.error).replace(/Agent\s+\S+/gi, "Agent [redacted]").slice(0, 300) : "";
    results.push({ op: call.op, external_id: call.external_id || "", ok: Boolean(result && result.ok), error });
  }
  return results;
}

export function logLine(result) {
  return {
    direction: result.direction,
    action: result.action,
    result: result.result,
    detail: String(result.detail || "").replace(/[A-Za-z0-9_\-]{20,}/g, "[redacted]").slice(0, 500)
  };
}

export function externalIdOfLead(lead) {
  return leadExternalId(lead);
}
