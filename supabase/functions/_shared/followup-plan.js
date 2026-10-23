// Decides which saved follow-up or reminder may be sent. No network calls.
// Instagram only accepts a business send inside 24 hours of the lead's last message.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function messageWindow(lastUserMessageAt, now) {
  if (lastUserMessageAt == null || lastUserMessageAt === "") return { allow: false, reason: "no_user_message" };
  const last = new Date(lastUserMessageAt).getTime();
  const at = Number(now);
  if (!Number.isFinite(last) || !Number.isFinite(at)) return { allow: false, reason: "no_user_message" };
  const age = at - last;
  if (age < 0) return { allow: false, reason: "clock_skew" };
  if (age >= DAY) return { allow: false, reason: "outside_24h" };
  return { allow: true, reason: "standard_window", age };
}

export function dueLadderStep({
  steps,
  lastUserMessageAt,
  now,
  sentStepIds,
  state,
  humanLocked,
  systemEnabled,
  aiEnabled
}) {
  if (systemEnabled !== true) return { send: false, reason: "system_off" };
  if (humanLocked === true) return { send: false, reason: "human_locked" };
  if (aiEnabled === false) return { send: false, reason: "ai_paused" };
  const window = messageWindow(lastUserMessageAt, now);
  if (!window.allow) return { send: false, reason: window.reason };
  const sent = new Set(sentStepIds || []);
  const leadState = String(state || "");
  const ordered = (steps || [])
    .filter((step) => step && step.id && !sent.has(step.id))
    .slice()
    .sort((left, right) => Number(left.hours) - Number(right.hours));
  for (const step of ordered) {
    const hours = Number(step.hours);
    if (!Number.isFinite(hours) || hours < 1 || hours > 23) continue;
    if (step.crm_state && step.crm_state !== leadState) continue;
    if (window.age < hours * HOUR) continue;
    const body = String(step.body || "").trim();
    if (!body) continue;
    return {
      send: true,
      reason: "due",
      step: {
        id: step.id,
        hours,
        mode: step.mode === "ai" ? "ai" : "text",
        body: body.slice(0, 1000)
      },
      window
    };
  }
  return { send: false, reason: "nothing_due" };
}

export function cycleStamp(lastUserMessageAt) {
  const at = new Date(lastUserMessageAt).getTime();
  return Number.isFinite(at) ? String(at) : "";
}

export function sentStepIds(rows, { restart, lastUserMessageAt } = {}) {
  const cycle = restart === true ? cycleStamp(lastUserMessageAt) : "";
  const ids = [];
  for (const row of rows || []) {
    const key = String((row && row.idempotency_key) || "");
    const parts = key.split(":");
    if (parts[0] !== "followup" || !parts[2]) continue;
    const keyCycle = parts.slice(3).join(":");
    if (restart === true) {
      if (keyCycle === cycle) ids.push(parts[2]);
    } else {
      ids.push(parts[2]);
    }
  }
  return ids;
}

export function followupOutbox({ decision, businessId, threadId, accountId, conversationId, conversationRowId, cycle }) {
  if (!decision || decision.send !== true) return null;
  if (!accountId || !conversationId || !conversationRowId) return null;
  const step = decision.step;
  const suffix = cycle ? ":" + cycle : "";
  const key = ("followup:" + threadId + ":" + step.id + suffix).slice(0, 180);
  const payload = {
    text: step.mode === "text" ? step.body : "",
    accountId: String(accountId),
    conversationId: String(conversationId),
    conversationRowId: String(conversationRowId),
    eventKind: "message",
    followupStepId: step.id
  };
  if (step.mode !== "text") {
    payload.needsPlan = true;
    payload.instruction = step.body;
  }
  return {
    business_id: businessId,
    thread_id: threadId,
    kind: "recovery",
    transport: "official",
    status: "pending",
    idempotency_key: key,
    payload
  };
}

export function reminderOutbox({ reminderId, title, businessId, threadId, accountId, conversationId, conversationRowId }) {
  const body = String(title || "").trim();
  if (!reminderId || !body || !accountId || !conversationId || !conversationRowId) return null;
  return {
    business_id: businessId,
    thread_id: threadId,
    kind: "recovery",
    transport: "official",
    status: "pending",
    idempotency_key: ("reminder:" + reminderId).slice(0, 180),
    payload: {
      text: body.slice(0, 1000),
      accountId: String(accountId),
      conversationId: String(conversationId),
      conversationRowId: String(conversationRowId),
      eventKind: "message",
      reminderId: String(reminderId)
    }
  };
}

export function remindersToSend({ reminders, contacts, threads, conversations, now, accountId, businessId }) {
  const contactById = new Map((contacts || []).map((contact) => [contact.id, contact]));
  const threadBySender = new Map((threads || []).map((thread) => [thread.igsid, thread]));
  const conversationByContact = new Map((conversations || []).map((conversation) => [conversation.contact_id, conversation]));
  const rows = [];
  for (const reminder of reminders || []) {
    if (!reminder || !reminder.contact_id) continue;
    const contact = contactById.get(reminder.contact_id);
    const thread = contact ? threadBySender.get(contact.external_id) : null;
    const conversation = conversationByContact.get(reminder.contact_id);
    const decision = reminderSend({
      dueAt: reminder.due_at,
      now,
      lastUserMessageAt: thread ? thread.last_user_message_at : null,
      kind: reminder.kind,
      status: reminder.status
    });
    if (!decision.send || !thread || !conversation) continue;
    const row = reminderOutbox({
      reminderId: reminder.id,
      title: reminder.title,
      businessId,
      threadId: thread.id,
      accountId,
      conversationId: conversation.external_id,
      conversationRowId: conversation.id
    });
    if (row) rows.push(row);
  }
  return rows;
}

export function maySendPayload({ payload, lastUserMessageAt, now, humanLocked, systemEnabled }) {
  if (systemEnabled !== true) return { send: false, reason: "system_off" };
  if (humanLocked === true) return { send: false, reason: "human_locked" };
  if (!payload || payload.needsPlan === true || !String(payload.text || "").trim() || !payload.conversationId || !payload.accountId) {
    return { send: false, reason: "not_ready" };
  }
  const window = messageWindow(lastUserMessageAt, now);
  if (!window.allow) return { send: false, reason: window.reason };
  return { send: true, reason: "due", window };
}

export function plannedPayload(payload, text) {
  const body = String(text || "").trim();
  if (!payload || !body) return null;
  const next = { ...payload, text: body.slice(0, 1000), needsPlan: false };
  delete next.instruction;
  return next;
}

export function reminderSend({ dueAt, now, lastUserMessageAt, kind, status }) {
  if (status === "done") return { send: false, reason: "done" };
  if (kind !== "resume") return { send: false, reason: "not_a_message" };
  const due = new Date(dueAt).getTime();
  const at = Number(now);
  if (!Number.isFinite(due) || !Number.isFinite(at) || due > at) return { send: false, reason: "not_due" };
  const window = messageWindow(lastUserMessageAt, now);
  if (!window.allow) return { send: false, reason: window.reason };
  return { send: true, reason: "due", window };
}
