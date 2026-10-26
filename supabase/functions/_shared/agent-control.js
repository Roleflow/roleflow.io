// Pure rules for the client dashboard agents. No network, no secrets.
// An agent with no saved switch is off. Human replies from the CRM are not agent actions.

export const AGENT_KEYS = ["warmer", "outreacher", "setter", "followup"];

export const DEFAULT_POLICY = {
  hoursSinceLastMessage: 4,
  leadStage: "any",
  noReplyAfter: 1,
  maxFollowups: 3,
  booked: "any",
  quietStart: "22:00",
  quietEnd: "08:00"
};

const STAGES = ["any", "open", "discovering", "qualifying", "proposal", "booked", "paid", "lost", "unqualified", "postponed"];

export function agentKeyForKind(kind) {
  const name = String(kind || "");
  if (name === "human") return "human";
  if (name === "recovery" || name === "followup") return "followup";
  if (name === "warmup" || name === "warmer") return "warmer";
  if (name === "outreach" || name === "opener" || name === "ingest") return "outreacher";
  return "setter";
}

export function sendBlocked(row) {
  if (!row) return true;
  if (agentKeyForKind(row.kind) === "human") return false;
  return row.agent_enabled !== true;
}

export async function agentEnabled(db, businessId, key) {
  if (key === "human") return true;
  if (!db || !businessId || !AGENT_KEYS.includes(key)) return false;
  try {
    const row = await db.from("acq_agent_switches").select("enabled").eq("business_id", businessId).eq("agent_key", key).maybeSingle();
    if (!row || row.error || !row.data) return false;
    return row.data.enabled === true;
  } catch (_error) {
    return false;
  }
}

export async function stampAgentEnabled(db, row) {
  if (!row) return row;
  const key = agentKeyForKind(row.kind);
  if (key === "human") return { ...row, agent_enabled: true };
  return { ...row, agent_enabled: await agentEnabled(db, row.business_id, key) };
}

export function setterMayEnable(input) {
  const prompt = String(input && input.prompt || "").trim();
  if (!prompt) return { ok: false, error: "Save a system prompt before turning the setter on." };
  if (!(input && input.testedAt)) return { ok: false, error: "Try the prompt in the test panel before turning the setter on." };
  return { ok: true };
}

export function normalizePolicy(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const hours = clamp(source.hoursSinceLastMessage ?? source.hours_since_last_message, 1, 23, DEFAULT_POLICY.hoursSinceLastMessage);
  const stage = String(source.leadStage || source.lead_stage || "any");
  const booked = String(source.booked || "any");
  return {
    hoursSinceLastMessage: hours,
    leadStage: STAGES.includes(stage) ? stage : "any",
    noReplyAfter: clamp(source.noReplyAfter ?? source.no_reply_after, 1, 20, DEFAULT_POLICY.noReplyAfter),
    maxFollowups: clamp(source.maxFollowups ?? source.max_followups, 1, 10, DEFAULT_POLICY.maxFollowups),
    booked: booked === "booked" || booked === "not_booked" ? booked : "any",
    quietStart: clock(source.quietStart || source.quiet_start, DEFAULT_POLICY.quietStart),
    quietEnd: clock(source.quietEnd || source.quiet_end, DEFAULT_POLICY.quietEnd)
  };
}

export function followupLead(thread) {
  const row = thread || {};
  const raw = String(row.crm_state || row.stage || row.state || "open").toLowerCase();
  const map = { qualification: "qualifying", comment_to_dm: "discovering", recovery: "qualifying", booking: "proposal" };
  const stage = map[raw] || raw || "open";
  const lead = {
    stage,
    booked: Boolean(row.booked) || stage === "booked" || stage === "paid" || row.lead_status === "converted",
    followupCount: Number(row.followup_count != null ? row.followup_count : row.followupCount) || 0,
    lastUserMessageAt: row.last_user_message_at || row.lastUserMessageAt || "",
    humanLocked: row.human_locked === true || row.humanLocked === true
  };
  if (row.unanswered != null) lead.unanswered = row.unanswered;
  return lead;
}

export function followupDue(input) {
  const enabled = Boolean(input && input.enabled);
  if (!enabled) return { due: false, reason: "off" };
  const policy = normalizePolicy(input && input.policy);
  const lead = input && input.lead ? input.lead : {};
  if (lead.humanLocked) return { due: false, reason: "human" };
  const stage = String(lead.stage || "open");
  if (policy.leadStage !== "any" && stage !== policy.leadStage) return { due: false, reason: "stage" };
  const booked = Boolean(lead.booked) || stage === "booked" || stage === "paid";
  if (policy.booked === "booked" && !booked) return { due: false, reason: "not_booked" };
  if (policy.booked === "not_booked" && booked) return { due: false, reason: "booked" };
  const sent = Number(lead.followupCount) || 0;
  if (sent >= policy.maxFollowups) return { due: false, reason: "max" };
  const unanswered = lead.unanswered == null ? sent + 1 : Number(lead.unanswered);
  if (!Number.isFinite(unanswered) || unanswered < policy.noReplyAfter) return { due: false, reason: "waiting" };
  const now = Number(input && input.now);
  if (inQuietHours(now, input && input.timeZone, policy.quietStart, policy.quietEnd)) return { due: false, reason: "quiet" };
  const last = Date.parse(lead.lastUserMessageAt || "");
  if (!Number.isFinite(last) || !Number.isFinite(now)) return { due: false, reason: "no_message" };
  const age = now - last;
  if (age < policy.hoursSinceLastMessage * 3600000) return { due: false, reason: "too_soon" };
  if (age >= 24 * 3600000) return { due: false, reason: "window" };
  return { due: true, reason: "due" };
}

export function dueFollowups(input) {
  const leads = input && input.leads || [];
  return leads.map((lead) => ({ lead, ...followupDue({ ...input, lead }) })).filter((row) => row.due);
}

export function recoveryKey(threadId, count) {
  return "recovery:" + String(threadId || "") + ":" + String(Number(count) || 0);
}

export function previewReply(prompt, message) {
  const instructions = String(prompt || "").trim();
  const text = String(message || "").trim();
  if (!instructions) return { ok: false, error: "Save a system prompt first." };
  if (!text) return { ok: false, error: "Write a message to try." };
  const guide = instructions.split("\n").map((line) => line.trim()).find((line) => line && !line.startsWith("#")) || "Ask one clear next question.";
  const reply = "Got it. " + text.slice(0, 120) + " I'll stay inside the saved instructions: " + guide.slice(0, 160);
  return { ok: true, reply, source: "preview" };
}

export function dashboardMetrics(input) {
  const source = input || {};
  const leads = source.targets || source.leads || [];
  const chats = source.threads || source.contacts || [];
  const bookings = source.bookings || [];
  const switches = source.switches || [];
  return {
    leads: leads.length,
    chats: chats.length,
    booked: bookings.filter((row) => row && row.show_status !== "cancelled").length,
    liveAgents: switches.filter((row) => row && row.enabled === true).length
  };
}

export function inQuietHours(now, timeZone, start, end) {
  if (!Number.isFinite(Number(now))) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(Number(now)));
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const current = hour * 60 + minute;
  const from = minutes(start);
  const to = minutes(end);
  if (from === to) return false;
  if (from < to) return current >= from && current < to;
  return current >= from || current < to;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function clock(value, fallback) {
  const text = String(value || "");
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : fallback;
}

function minutes(value) {
  const [hour, minute] = String(value || "00:00").split(":");
  return (Number(hour) || 0) * 60 + (Number(minute) || 0);
}
