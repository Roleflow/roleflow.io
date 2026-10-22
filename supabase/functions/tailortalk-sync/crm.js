// Summary rows for the per-business CRM.
// Get Leads returns status and summary fields only: no chat history and no
// extracted attributes. detail "summary" tells acq_tt_apply_batch to keep
// any webhook attributes and messages already stored.

import { usernameOf } from "./lead.js";

const STATUS = new Set(["cold", "warm", "hot", "converted", "dead"]);

function leadStatus(lead) {
  const row = lead || {};
  if (row.is_converted === true) return "converted";
  const raw = String(row.lead_status || "").trim().toLowerCase();
  if (STATUS.has(raw)) return raw;
  if (raw === "spam" || raw === "lost" || raw === "unqualified") return "dead";
  return "cold";
}

function stageFor(status) {
  if (status === "converted") return "booked";
  if (status === "dead") return "dead";
  if (status === "hot" || status === "warm") return "qualified";
  return "reply";
}

function roleFor(status, followups) {
  if (status === "converted") return "appointment_booking";
  if (status === "hot" || status === "warm") return "qualification";
  if ((status === "cold" || status === "dead") && Number(followups) > 0) return "conversation_recovery";
  return "comment_to_dm";
}

function handleFor(lead, externalId) {
  const name = String(usernameOf(lead) || "").trim().toLowerCase();
  if (/^[a-z0-9._]{1,30}$/.test(name)) return name;
  const clean = String(externalId || "lead").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 28);
  const handle = ("tt" + (clean || "lead")).slice(0, 30);
  return /^[a-z0-9._]{1,30}$/.test(handle) ? handle : "ttlead";
}

function recoveryDue(status, followups, last, now) {
  if (status !== "cold" && status !== "warm") return false;
  if (!(Number(followups) > 0)) return false;
  const time = Date.parse(last || "");
  if (!Number.isFinite(time)) return false;
  return now - time > 3 * 24 * 60 * 60 * 1000;
}

export function summaryRow(lead, now = Date.now()) {
  const row = lead || {};
  const externalId = String(row.id || "").trim().slice(0, 200);
  const status = leadStatus(row);
  const followups = Number(row.total_followups || row.followups || 0) || 0;
  const last = row.last_message_time || row.last_message_at || null;
  const contact = String(row.lead_contact || "").trim().slice(0, 200);
  return {
    external_id: externalId,
    name: String(row.lead_name || row.name || "").slice(0, 200),
    contact,
    handle: handleFor(row, externalId),
    lead_status: status,
    stage: stageFor(status),
    category: String(row.category || "").slice(0, 40),
    source_detail: String(row.integration || row.lead_source || row.source || "").slice(0, 200),
    detail: "summary",
    attributes: {},
    last_message_at: last ? String(last) : null,
    followups,
    recovery_due: recoveryDue(status, followups, last, now),
    role: roleFor(status, followups),
    messages: null,
    bookings: null
  };
}
