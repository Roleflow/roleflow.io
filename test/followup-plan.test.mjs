import assert from "node:assert/strict";
import { cycleStamp, dueLadderStep, followupOutbox, maySendPayload, messageWindow, plannedPayload, reminderSend, remindersToSend, sentStepIds } from "../supabase/functions/_shared/followup-plan.js";

const hour = 60 * 60 * 1000;
const last = Date.parse("2026-10-23T08:00:00Z");
const steps = [
  { id: "step-2", hours: 6, mode: "text", body: "Still around?", crm_state: null },
  { id: "step-1", hours: 2, mode: "ai", body: "Ask one short question about their offer.", crm_state: "qualifying" }
];

assert.equal(messageWindow(last, last + 2 * hour).allow, true);
assert.equal(messageWindow(last, last + 24 * hour).reason, "outside_24h");
assert.equal(messageWindow(null, last).reason, "no_user_message");

const early = dueLadderStep({
  steps,
  lastUserMessageAt: last,
  now: last + hour,
  sentStepIds: [],
  state: "qualifying",
  systemEnabled: true
});
assert.equal(early.send, false);
assert.equal(early.reason, "nothing_due");

const due = dueLadderStep({
  steps,
  lastUserMessageAt: last,
  now: last + 3 * hour,
  sentStepIds: [],
  state: "qualifying",
  systemEnabled: true
});
assert.equal(due.send, true);
assert.equal(due.step.id, "step-1");
assert.equal(due.step.mode, "ai");

const skipped = dueLadderStep({
  steps,
  lastUserMessageAt: last,
  now: last + 6 * hour,
  sentStepIds: [],
  state: "open",
  systemEnabled: true
});
assert.equal(skipped.send, true);
assert.equal(skipped.step.id, "step-2");

const closed = dueLadderStep({
  steps,
  lastUserMessageAt: last,
  now: last + 25 * hour,
  sentStepIds: [],
  state: "qualifying",
  systemEnabled: true
});
assert.equal(closed.send, false);
assert.equal(closed.reason, "outside_24h");
assert.equal(followupOutbox({ decision: closed, businessId: "b", threadId: "t", accountId: "a", conversationId: "gateway", conversationRowId: "row" }), null);

const paused = dueLadderStep({
  steps,
  lastUserMessageAt: last,
  now: last + 3 * hour,
  sentStepIds: [],
  state: "qualifying",
  systemEnabled: true,
  aiEnabled: false
});
assert.equal(paused.reason, "ai_paused");

const row = followupOutbox({
  decision: due,
  businessId: "business",
  threadId: "thread",
  accountId: "account",
  conversationId: "gateway-conversation",
  conversationRowId: "conversation-row"
});
assert.equal(row.transport, "official");
assert.equal(row.payload.needsPlan, true);
assert.equal(row.payload.text, "");
assert.equal(row.payload.conversationId, "gateway-conversation");
assert.equal(row.payload.conversationRowId, "conversation-row");
assert.equal(row.idempotency_key, "followup:thread:step-1");
assert.equal(followupOutbox({ decision: due, businessId: "b", threadId: "t", accountId: "", conversationId: "c", conversationRowId: "row" }), null);
assert.equal(followupOutbox({ decision: due, businessId: "b", threadId: "t", accountId: "a", conversationId: "c", conversationRowId: "" }), null);

const restarted = followupOutbox({
  decision: due,
  businessId: "business",
  threadId: "thread",
  accountId: "account",
  conversationId: "gateway-conversation",
  conversationRowId: "conversation-row",
  cycle: cycleStamp(last)
});
assert.equal(restarted.idempotency_key, "followup:thread:step-1:" + String(last));
assert.deepEqual(sentStepIds([{ idempotency_key: restarted.idempotency_key }], { restart: true, lastUserMessageAt: last }), ["step-1"]);
assert.deepEqual(sentStepIds([{ idempotency_key: restarted.idempotency_key }], { restart: true, lastUserMessageAt: last + hour }), []);
assert.deepEqual(sentStepIds([{ idempotency_key: row.idempotency_key }], { restart: false, lastUserMessageAt: last }), ["step-1"]);

const literal = followupOutbox({
  decision: skipped,
  businessId: "business",
  threadId: "thread",
  accountId: "account",
  conversationId: "gateway-conversation",
  conversationRowId: "conversation-row"
});
assert.equal(literal.payload.text, "Still around?");
assert.equal(literal.payload.needsPlan, undefined);

const reminder = reminderSend({
  dueAt: last + hour,
  now: last + 2 * hour,
  lastUserMessageAt: last,
  kind: "resume",
  status: "open"
});
assert.equal(reminder.send, true);
assert.equal(reminderSend({
  dueAt: last + hour,
  now: last + 30 * hour,
  lastUserMessageAt: last,
  kind: "resume",
  status: "open"
}).reason, "outside_24h");
assert.equal(reminderSend({
  dueAt: last + hour,
  now: last + 2 * hour,
  lastUserMessageAt: last,
  kind: "task",
  status: "open"
}).reason, "not_a_message");

const contacts = [{ id: "contact-a", external_id: "sender-a" }, { id: "contact-b", external_id: "sender-b" }];
const threads = [
  { id: "thread-a", igsid: "sender-a", last_user_message_at: new Date(last).toISOString() },
  { id: "thread-b", igsid: "sender-b", last_user_message_at: new Date(last).toISOString() }
];
const conversations = [
  { id: "row-a", contact_id: "contact-a", external_id: "gateway-a" },
  { id: "row-b", contact_id: "contact-b", external_id: "gateway-b" }
];
const reminderRows = remindersToSend({
  reminders: [
    { id: "rem-1", contact_id: "contact-a", kind: "resume", status: "open", due_at: new Date(last + hour).toISOString(), title: "Still with me?" },
    { id: "rem-2", contact_id: "contact-b", kind: "task", status: "open", due_at: new Date(last + hour).toISOString(), title: "Call them" },
    { id: "rem-3", kind: "resume", status: "open", due_at: new Date(last + hour).toISOString(), title: "No contact" }
  ],
  contacts,
  threads,
  conversations,
  now: last + 2 * hour,
  accountId: "account",
  businessId: "business"
});
assert.equal(reminderRows.length, 1);
assert.equal(reminderRows[0].thread_id, "thread-a");
assert.equal(reminderRows[0].idempotency_key, "reminder:rem-1");
assert.equal(reminderRows[0].payload.conversationId, "gateway-a");
assert.equal(reminderRows[0].payload.conversationRowId, "row-a");
assert.equal(reminderRows[0].payload.text, "Still with me?");

const ready = literal.payload;
assert.equal(maySendPayload({ payload: ready, lastUserMessageAt: last, now: last + 3 * hour, systemEnabled: true }).send, true);
assert.equal(maySendPayload({ payload: ready, lastUserMessageAt: last, now: last + 25 * hour, systemEnabled: true }).reason, "outside_24h");
assert.equal(maySendPayload({ payload: row.payload, lastUserMessageAt: last, now: last + 3 * hour, systemEnabled: true }).reason, "not_ready");
const planned = plannedPayload(row.payload, "Roughly how many DMs land after you log off?");
assert.equal(planned.needsPlan, false);
assert.equal(planned.instruction, undefined);
assert.equal(planned.text, "Roughly how many DMs land after you log off?");
assert.equal(plannedPayload(row.payload, "  "), null);

console.log("follow-up plan tests passed");
