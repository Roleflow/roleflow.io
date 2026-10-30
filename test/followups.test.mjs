import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  followupBrief,
  followupCycle,
  followupKey,
  halfDayLabel,
  hourLabel,
  ladderDecision,
  ladderStepError,
  manualQueue,
  manualStepError,
  mergeStatePrompts,
  normalizeStatePrompts,
  officeState,
  replyRate,
  suggestedLadder,
  textBubbles,
  voiceForStep,
  welcomeDecision,
  welcomeStepError
} from "../acquire/followup-ladder.js";
import { humanWindow, manualSendRequest } from "../supabase/functions/_shared/inbox-send.js";
import { canonicalTab, NAV_GROUPS } from "../acquire/client-nav.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const H = 3600000;
const now = Date.parse("2026-10-24T12:00:00Z");
const ago = (hours) => new Date(now - hours * H).toISOString();

assert.equal(read("acquire/followup-ladder.js"), read("supabase/functions/_shared/followup-ladder.js"));

// Suggested ladder: three AI steps, created off.
assert.deepEqual(suggestedLadder().map((row) => [row.hours, row.mode, row.enabled]), [[3, "ai", false], [10, "ai", false], [22, "ai", false]]);

const steps = [
  { id: "s10", hours: 10, mode: "ai", body: "", enabled: true, state_prompts: {} },
  { id: "s3", hours: 3, mode: "text", body: "Hi\nStill there?", enabled: true },
  { id: "s22", hours: 22, mode: "ai", body: "", enabled: false }
];
const lead = { state: "discovering", lastUserMessageAt: ago(4), lastBusinessMessageAt: ago(3.5), lastFromLead: false };
assert.deepEqual(ladderDecision({ steps, lead, now }).step.id, "s3");
assert.equal(ladderDecision({ steps, lead, now }).action, "send");
assert.equal(ladderDecision({ steps, doneStepIds: ["s3"], lead, now }).reason, "too_soon");
assert.equal(ladderDecision({ steps, doneStepIds: ["s3", "s10"], lead: { ...lead, lastUserMessageAt: ago(23) }, now }).reason, "ladder_done");
assert.equal(ladderDecision({ steps, lead: { ...lead, lastUserMessageAt: ago(24) }, now }).reason, "window_closed");
assert.equal(ladderDecision({ steps, lead: { ...lead, lastBusinessMessageAt: ago(0.5) }, now }).reason, "gap");
assert.equal(ladderDecision({ steps, lead: { ...lead, lastFromLead: true }, now }).reason, "lead_waiting");
for (const state of ["lost", "unqualified", "postponed"]) assert.equal(ladderDecision({ steps, lead: { ...lead, state }, now }).action, "wait");
assert.equal(ladderDecision({ steps, lead: { ...lead, humanLocked: true }, now }).reason, "human");
assert.equal(ladderDecision({ steps, lead: { ...lead, automated: false }, now }).reason, "manual_lead");
assert.equal(ladderDecision({ steps, lead: { ...lead, weFollow: true }, skipFollowed: true, now }).reason, "followed");
assert.equal(ladderDecision({ steps, lead: { ...lead, weFollow: true }, skipFollowed: false, now }).action, "send");
assert.equal(ladderDecision({ steps, lead: { ...lead, resumeReminderOpen: true }, now }).reason, "resume_reminder");
assert.equal(ladderDecision({ steps: [steps[2]], lead, now }).reason, "no_steps");
const byState = [{ id: "b", hours: 2, mode: "ai", body: "", enabled: true, state_prompts: { qualifying: "Ask budget." } }];
assert.deepEqual([ladderDecision({ steps: byState, lead, now }).action, ladderDecision({ steps: byState, lead, now }).reason], ["skip", "state_empty"]);
assert.equal(ladderDecision({ steps: byState, lead: { ...lead, state: "qualifying" }, now }).action, "send");

// Office hours and send before close, one daily window in UTC.
const office = { mode: "same", start: "09:00", end: "18:00", timeZone: "UTC" };
assert.equal(officeState(Date.parse("2026-10-24T20:00:00Z"), office).open, false);
assert.equal(officeState(Date.parse("2026-10-24T17:50:00Z"), office).minutesToClose, 10);
const late = Date.parse("2026-10-24T17:50:00Z");
const lateLead = { state: "open", lastUserMessageAt: new Date(late - 4 * H).toISOString(), lastFromLead: false };
const lateSteps = [{ id: "x", hours: 8, mode: "ai", enabled: true }];
assert.equal(ladderDecision({ steps: lateSteps, lead: lateLead, now: late, office }).reason, "too_soon");
assert.equal(ladderDecision({ steps: lateSteps, lead: lateLead, now: late, office, beforeClose: true }).reason, "before_close");
assert.equal(ladderDecision({ steps: lateSteps, lead: lateLead, now: Date.parse("2026-10-24T20:00:00Z"), office }).reason, "office_closed");

// Cycles: restart off never repeats; restart on keys the cycle on the lead's last message.
assert.equal(followupCycle(false, ago(2)), "0");
assert.equal(followupCycle(true, ago(2)), String(now - 2 * H));
assert.equal(followupKey("t", "s", "0"), "followup:t:s:0");
assert.deepEqual(textBubbles("Hi\n\n Still there? "), ["Hi", "Still there?"]);

// Voice notes: attached once per lead.
assert.equal(voiceForStep({ voice_note_id: "v1" }, []), "v1");
assert.equal(voiceForStep({ voice_note_id: "v1" }, ["v1"]), null);
assert.equal(voiceForStep({}, []), null);

// Per-state instructions.
assert.deepEqual(normalizeStatePrompts({ open: " a ", lost: "x", paid: "" }), { open: "a" });
assert.match(mergeStatePrompts({ qualifying: "Ask budget." }), /If the lead is qualifying: Ask budget\./);
const brief = followupBrief({ step: { body: "Be brief.", state_prompts: { open: "Say hi." } }, state: "open", hoursSilent: 5, content: "Case study https://roleflow.io" });
assert.match(brief, /Step instructions: Be brief\./);
assert.match(brief, /For a lead in open: Say hi\./);
assert.match(brief, /Case study/);

// Welcome steps: text only, after our first message, stop on a reply.
const welcome = [{ id: "w1", position: 1, delay_hours: 2, mode: "ai", body: "Hi" }, { id: "w2", position: 2, delay_hours: 6, body: "Again" }];
const wLead = { firstBusinessMessageAt: ago(3), lastUserMessageAt: ago(3.1) };
const firstWelcome = welcomeDecision({ steps: welcome, lead: wLead, now });
assert.equal(firstWelcome.step.id, "w1");
assert.equal(firstWelcome.step.mode, "text");
assert.equal(welcomeDecision({ steps: welcome, doneStepIds: ["w1"], lead: wLead, now }).reason, "too_soon");
assert.equal(welcomeDecision({ steps: welcome, lead: { ...wLead, leadRepliedAfterFirst: true }, now }).reason, "lead_replied");
assert.equal(welcomeDecision({ steps: welcome, lead: { ...wLead, humanWrote: true }, now }).reason, "human");
assert.equal(welcomeDecision({ steps: welcome, lead: { ...wLead, firstBusinessMessageAt: ago(25) }, now }).reason, "welcome_window_closed");
assert.deepEqual(welcomeStepError([{ delay_hours: 1, body: "a" }, { delay_hours: 2, body: "b" }, { delay_hours: 3, body: "c" }]), ["Up to 2 welcome steps."]);
assert.equal(welcomeStepError([{ delay_hours: 0, body: "a" }]).length, 1);

// Validation.
assert.deepEqual(ladderStepError({ hours: 4, mode: "ai", body: "" }), []);
assert.equal(ladderStepError({ hours: 24, mode: "ai", body: "" }).length, 1);
assert.equal(ladderStepError({ hours: 4, mode: "text", body: " " }).length, 1);
assert.deepEqual(manualStepError({ wait_half_days: 13, mode: "text", body: "x" }), []);
assert.equal(manualStepError({ wait_half_days: 14, mode: "text", body: "x" }).length, 1);
assert.equal(halfDayLabel(3, "en"), "After 1.5 days");
assert.equal(halfDayLabel(3, "es"), "Después de 1,5 días");
assert.equal(hourLabel(1, "en"), "After 1 hour");

// 7-day queue: Lost leads only, between 24 hours and 7 days, oldest first.
const queue = manualQueue({
  now,
  steps: [{ id: "m2", wait_half_days: 2 }, { id: "m5", wait_half_days: 5 }],
  done: { b: ["m2"] },
  leads: [
    { id: "a", crm_state: "lost", last_message_at: ago(30) },
    { id: "b", crm_state: "lost", last_message_at: ago(70) },
    { id: "c", crm_state: "open", last_message_at: ago(30) },
    { id: "d", crm_state: "lost", last_message_at: ago(200) },
    { id: "e", crm_state: "lost", last_message_at: ago(10) }
  ]
});
assert.deepEqual(queue.map((row) => [row.lead.id, row.step.id]), [["b", "m5"], ["a", "m2"]]);
assert.deepEqual(replyRate([{ track: "auto", status: "sent", replied: true }, { track: "auto", status: "sent", replied: false }, { track: "auto", status: "held" }], "auto"), { sent: 2, replied: 1, rate: 50 });
assert.equal(replyRate([], "manual").rate, null);

// Chats desk: the human tag only on an explicit 7-day follow-up click.
assert.deepEqual(humanWindow(ago(2), now, false), { allow: true, tag: false, reason: "standard_window" });
assert.deepEqual(humanWindow(ago(30), now, false), { allow: false, tag: false, reason: "outside_24h" });
assert.deepEqual(humanWindow(ago(30), now, true), { allow: true, tag: true, reason: "human_agent_window" });
assert.equal(humanWindow(ago(24 * 8), now, true).allow, false);
assert.equal(manualSendRequest({ accountId: "a", conversationId: "c", text: "hi" }).body.messageTag, undefined);
assert.deepEqual(manualSendRequest({ accountId: "a", conversationId: "c", text: "hi", humanTag: true }).body, { accountId: "a", message: "hi", messageTag: "HUMAN_AGENT", messagingType: "MESSAGE_TAG" });

// Automatic paths never set a tag.
const queueSource = read("supabase/functions/_shared/followup-queue.js");
assert.doesNotMatch(queueSource, /HUMAN_AGENT/);
assert.match(queueSource, /readDmGate\(db, businessId\)/);
assert.match(queueSource, /status: "held"/);
assert.ok(queueSource.indexOf("readDmGate(") < queueSource.indexOf('from("ig_outbox").insert'));
assert.doesNotMatch(read("supabase/functions/_shared/followup-ladder.js"), /tag:\s*"HUMAN_AGENT"/);
const engine = read("supabase/functions/roleflow-acquisition/index.ts");
assert.match(engine, /async function sendStepText/);
assert.match(engine, /kind: "ai",\n    humanLocked: false/);
assert.match(engine, /voiceForStep\(step/);
assert.doesNotMatch(read("supabase/functions/followup-boss/index.ts"), /acq_followup_policy/);

// Migration: additive only, not applied, no webhook.
const sql = read("supabase/migrations/20261030090000_followups_ladder.sql");
assert.match(sql, /NOT APPLIED/);
assert.doesNotMatch(sql, /drop\s+(table|column)/i);
assert.doesNotMatch(sql, /alter\s+column/i);
assert.doesNotMatch(sql, /delete\s+from|truncate|update\s+public\./i);
assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /webhook|net\.http_post|cron\.schedule/i);
assert.match(sql, /add column if not exists voice_note_id uuid references public\.acq_voice_library/);
assert.match(sql, /add column if not exists enabled boolean not null default true/);
assert.match(sql, /create table if not exists public\.acq_followup_sends/);
assert.match(sql, /create table if not exists public\.acq_manual_followup_steps/);
assert.match(sql, /wait_half_days between 2 and 13/);
assert.match(sql, /alter table public\.acq_followup_sends enable row level security/);
assert.match(sql, /alter table public\.acq_manual_followup_steps enable row level security/);

// Panel: one Follow-ups page with four tabs, the old policy form is gone.
const nav = NAV_GROUPS.flatMap((group) => group.items).find((item) => item.tab === "followup");
assert.deepEqual(nav.label, { en: "Follow-ups", es: "Seguimientos" });
assert.equal(canonicalTab("reminders"), "followup");
assert.equal(canonicalTab("followup/manual"), "followup");
const page = read("acquire/followups-page.js");
const app = read("acquire/app.js");
const pages = read("acquire/client-pages.js");
assert.match(app, /renderFollowupsPage\(ui\)/);
assert.doesNotMatch(app + pages, /renderFollowBoss|Save triggers|saveFollowupPolicy/);
for (const label of ["24-hour ladder", "7-day manual", "Welcome", "Reminders", "Escalera 24 h", "Manual 7 días", "Bienvenida", "Recordatorios", "Use suggested ladder (3h / 10h / 22h)", "When are follow-ups sent?", "Send from Chats", "Sent from Instagram"]) {
  assert.ok(page.includes(label), label);
}
assert.match(page, /cta-tabs/);
assert.match(page, /cta-table/);
assert.match(page, /cta-dialog/);
assert.match(page, /mountSendBadge/);
assert.doesNotMatch(page + read("acquire/followup-ladder.js") + read("acquire/acquire.css"), /zernio|zerochats|#2f7dff|#0c0f15/i);
assert.doesNotMatch(read("supabase/functions/_shared/followup-queue.js") + read("supabase/functions/_shared/followup-ladder.js"), /zernio/i);
assert.match(app, /function previewFollowups\(params\)/);
assert.match(app, /params\.get\("followups"\) === "empty"/);

console.log("followups tests passed");
