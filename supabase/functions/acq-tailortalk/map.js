// Maps TailorTalk Get Leads / webhook payloads into Roleflow CRM rows.
// Chat history is optional: the public Get Leads example does not include it.
// Webhooks and any extra fields that do include history are accepted.

export const SETTER_ROLES = [
  "comment_to_dm",
  "qualification",
  "conversation_recovery",
  "appointment_booking"
];

export const WEBHOOK_TRIGGERS = [
  "first_message",
  "on_warm",
  "on_hot",
  "on_converted",
  "every_message"
];

const STATUS = new Set(["cold", "warm", "hot", "converted", "dead"]);

export function mapLeadStatus(lead) {
  const row = lead || {};
  if (row.is_converted === true || row.is_converted === "true" || row.is_converted === 1) return "converted";
  const raw = String(row.lead_status || row.status || "").trim().toLowerCase();
  if (STATUS.has(raw)) return raw;
  if (raw === "spam" || raw === "lost" || raw === "unqualified") return "dead";
  return "cold";
}

export function stageForStatus(status) {
  if (status === "converted") return "booked";
  if (status === "dead") return "dead";
  if (status === "hot" || status === "warm") return "qualified";
  return "reply";
}

export function advanceStage(current, incoming) {
  const rank = { target: 1, warmup: 2, outreach: 3, reply: 4, qualified: 5, booked: 6, showed: 7, closed: 8 };
  if (current === "closed") return "closed";
  if (incoming === "dead") return "dead";
  if (incoming === "skipped") return current || "target";
  if ((rank[incoming] || 0) > (rank[current] || 0)) return incoming;
  return current || incoming || "reply";
}

export function roleForStatus(status, followups) {
  if (status === "converted") return "appointment_booking";
  if (status === "hot" || status === "warm") return "qualification";
  if ((status === "cold" || status === "dead") && Number(followups) > 0) return "conversation_recovery";
  return "comment_to_dm";
}

export function roleForTrigger(trigger, status, followups) {
  if (trigger === "first_message") return "comment_to_dm";
  if (trigger === "on_warm" || trigger === "on_hot") return "qualification";
  if (trigger === "on_converted") return "appointment_booking";
  return roleForStatus(status, followups);
}

function bagsOf(lead) {
  const row = lead || {};
  return [row, row.attributes, row.custom_attributes, row.extracted, row.data];
}

export function pickAttr(lead, keys) {
  for (const key of keys) {
    for (const bag of bagsOf(lead)) {
      if (!bag || typeof bag !== "object" || Array.isArray(bag)) continue;
      const value = bag[key];
      if (value == null || value === "") continue;
      if (typeof value === "object") continue;
      return String(value).slice(0, 500);
    }
  }
  return null;
}

export function asBool(value) {
  if (value === true || value === false) return value;
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (raw === "true" || raw === "yes" || raw === "1") return true;
  if (raw === "false" || raw === "no" || raw === "0") return false;
  return null;
}

export function extractAttributes(lead) {
  return {
    budget: pickAttr(lead, ["budget"]),
    timeline: pickAttr(lead, ["timeline"]),
    decision_maker: pickAttr(lead, ["decision_maker", "decisionMaker"]),
    fit: pickAttr(lead, ["fit"]),
    ig_handle: pickAttr(lead, ["ig_handle", "instagram_handle", "instagram", "username"]),
    offer: pickAttr(lead, ["offer"]),
    monthly_revenue: pickAttr(lead, ["monthly_revenue", "monthlyRevenue"])
  };
}

export function normalizeHandle(value) {
  const raw = String(value || "").trim().replace(/^@/, "").toLowerCase();
  if (/^[a-z0-9._]{1,30}$/.test(raw)) return raw;
  return null;
}

export function syntheticHandle(externalId) {
  const clean = String(externalId || "lead").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 28);
  const handle = ("tt" + (clean || "lead")).slice(0, 30);
  return /^[a-z0-9._]{1,30}$/.test(handle) ? handle : "ttlead";
}

export function externalIdOf(lead) {
  const row = lead || {};
  const id = row.id || row.lead_id || row.contact_id;
  if (id == null) return "";
  const text = String(id).trim();
  return text ? text.slice(0, 200) : "";
}

export function messagesFrom(lead) {
  const row = lead || {};
  const lists = [row.chat_history, row.messages, row.conversation, row.history, row.data && row.data.chat_history];
  const list = lists.find((item) => Array.isArray(item)) || [];
  const out = [];
  list.slice(0, 30).forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const roleRaw = String(item.role || item.sender || item.from || "user").toLowerCase();
    const role = /assist|bot|agent|outgoing/.test(roleRaw) ? "assistant" : roleRaw === "system" ? "system" : "user";
    const body = String(item.text || item.content || item.message || item.body || "").slice(0, 4000);
    if (!body) return;
    const sent = item.time || item.timestamp || item.created_at || null;
    const id = String(item.id || item.message_id || `${index}:${sent || ""}:${body.slice(0, 24)}`);
    out.push({
      external_id: id.slice(0, 180),
      role,
      body,
      sent_at: sent ? String(sent) : null
    });
  });
  return out;
}

export function bookingsFrom(lead) {
  const row = lead || {};
  const found = [];
  [row.bookings, row.appointments, row.booking].forEach((item) => {
    if (Array.isArray(item)) found.push(...item);
    else if (item && typeof item === "object") found.push(item);
  });
  return found.slice(0, 10).map((item) => {
    const show = String(item.status || item.show_status || "scheduled").toLowerCase();
    const showStatus = show === "showed" || show === "no_show" || show === "cancelled" ? show : "scheduled";
    return {
      scheduled_at: item.scheduled_at || item.start || item.time || item.datetime || null,
      calendar_ref: String(item.id || item.booking_id || item.event_id || "").slice(0, 200) || null,
      show_status: showStatus
    };
  }).filter((item) => item.scheduled_at || item.calendar_ref);
}

export function recoveryDue(status, followups, last, now = Date.now()) {
  if (status !== "cold" && status !== "warm") return false;
  if (!(Number(followups) > 0)) return false;
  const time = Date.parse(last || "");
  if (!Number.isFinite(time)) return false;
  return now - time > 3 * 24 * 60 * 60 * 1000;
}

const CONTACT_SKIP = new Set(["phone_number", "name", "created_at", "updated_at", "id", "contact_id"]);

export function attributeBag(contact) {
  const bag = {};
  if (!contact || typeof contact !== "object") return bag;
  Object.entries(contact).forEach(([key, value]) => {
    if (CONTACT_SKIP.has(key) || value == null || typeof value === "object") return;
    bag[key] = value;
  });
  if (contact.attributes && typeof contact.attributes === "object" && !Array.isArray(contact.attributes)) {
    Object.assign(bag, contact.attributes);
  }
  return bag;
}

function normKey(value) {
  return String(value || "").replace(/[\s+]/g, "").toLowerCase();
}

export function matchContact(lead, contacts) {
  if (!Array.isArray(contacts) || !contacts.length) return null;
  const attrs = extractAttributes(lead);
  const keys = new Set([
    normKey(lead && lead.lead_contact),
    normKey(lead && lead.id),
    normKey(lead && lead.username),
    normKey(attrs.ig_handle)
  ].filter(Boolean));
  return contacts.find((contact) => {
    const bag = [contact.phone_number, contact.id, contact.contact_id, contact.instagram, contact.ig_handle, contact.username];
    return bag.some((value) => keys.has(normKey(value)));
  }) || null;
}

export function mergeContact(lead, contact) {
  if (!contact) return lead || {};
  const attributes = { ...attributeBag(contact), ...((lead && lead.attributes) || {}) };
  return { ...(lead || {}), attributes };
}

export function leadsFrom(payload) {
  const data = payload && payload.data && !Array.isArray(payload.data) ? payload.data : payload;
  const leads = (data && data.leads) || (payload && payload.leads) || [];
  return Array.isArray(leads) ? leads : [];
}

export function contactsFrom(payload) {
  const data = payload && payload.data && !Array.isArray(payload.data) ? payload.data : payload;
  const rows = (data && data.contacts) || (payload && payload.contacts) || [];
  return Array.isArray(rows) ? rows : [];
}

export function orderAmount(cents) {
  const value = Number(cents);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value) / 100;
}

export function contactIdFor(contact, target) {
  const handle = normalizeHandle(contact && contact.ig_handle) || normalizeHandle(target && target.handle);
  if (handle && !handle.startsWith("tt")) return handle;
  const raw = String((contact && contact.contact) || "").trim();
  if (raw && !raw.includes("*") && raw.length >= 3) return raw.slice(0, 120);
  const ext = String((contact && contact.external_id) || (target && target.tailortalk_external_id) || "").trim();
  if (ext && !ext.includes("*")) return ext.slice(0, 120);
  return handle || "";
}

export function toSyncRow(lead, contact, trigger) {
  const merged = mergeContact(lead, contact);
  const externalId = externalIdOf(merged);
  const attributes = extractAttributes(merged);
  const direct = normalizeHandle(attributes.ig_handle)
    || normalizeHandle(merged.username)
    || normalizeHandle(merged.instagram_username)
    || normalizeHandle(merged.lead_contact);
  const handle = direct || syntheticHandle(externalId);
  const status = mapLeadStatus(merged);
  const followups = Number(merged.total_followups || merged.followups || 0) || 0;
  const last = merged.last_message_time || merged.last_message_at || null;
  return {
    external_id: externalId,
    name: String(merged.lead_name || merged.name || "").slice(0, 200),
    contact: String(merged.lead_contact || merged.phone_number || "").slice(0, 200),
    handle,
    lead_status: status,
    stage: stageForStatus(status),
    category: String(merged.category || "").slice(0, 40),
    source_detail: String(merged.integration || merged.lead_source || merged.source || "").slice(0, 200),
    budget: attributes.budget,
    timeline: attributes.timeline,
    decision_maker: asBool(attributes.decision_maker),
    fit: attributes.fit,
    offer: attributes.offer,
    monthly_revenue: attributes.monthly_revenue,
    ig_handle: attributes.ig_handle,
    attributes,
    last_message_at: last ? String(last) : null,
    followups,
    recovery_due: recoveryDue(status, followups, last),
    role: roleForTrigger(trigger, status, followups),
    messages: messagesFrom(merged),
    bookings: bookingsFrom(merged)
  };
}

export function eventKey(trigger, lead, occurredAt) {
  const id = externalIdOf(lead);
  const messages = messagesFrom(lead);
  const last = messages.length ? messages[messages.length - 1].external_id : "";
  return [trigger || "event", id || "lead", occurredAt || "", last].join(":").slice(0, 300);
}
