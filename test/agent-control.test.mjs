import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { postOfficial } from "../supabase/functions/_shared/official-outbox.js";
import {
  agentEnabled,
  dashboardMetrics,
  dueFollowups,
  followupDue,
  previewReply,
  recoveryKey,
  sendBlocked,
  setterMayEnable
} from "../supabase/functions/_shared/agent-control.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

assert.equal(sendBlocked(null), true);
assert.equal(sendBlocked({ kind: "reply", payload: { text: "Hi" } }), true);
assert.equal(sendBlocked({ kind: "reply", agent_enabled: false }), true);
assert.equal(sendBlocked({ kind: "recovery", agent_enabled: "true" }), true);
assert.equal(sendBlocked({ kind: "reply", agent_enabled: true }), false);
assert.equal(sendBlocked({ kind: "human" }), false);
assert.equal(sendBlocked({ kind: "human", agent_enabled: false }), false);

const blocked = await postOfficial({
  kind: "reply",
  payload: { text: "Hello", conversationId: "1", accountId: "acct" }
}, "test-key", async () => {
  throw new Error("off agents must not reach the network");
});
assert.deepEqual(blocked, { ok: false, status: "blocked", error: "The agent is off." });

const human = await postOfficial({
  kind: "human",
  payload: { text: "Hello", conversationId: "1", accountId: "acct" }
}, "test-key", async () => ({ status: 200, json: async () => ({ ok: true }) }));
assert.equal(human.ok, true);

function switchDb(result) {
  return {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle() { return Promise.resolve(result); }
      };
    }
  };
}

const missing = await agentEnabled(switchDb({ error: { message: "missing" }, data: null }), "biz", "setter");
assert.equal(missing, false);
assert.equal(await agentEnabled(switchDb({ data: null }), "biz", "warmer"), false);
assert.equal(await agentEnabled(switchDb({ data: { enabled: true } }), "biz", "outreacher"), true);
assert.equal(await agentEnabled(null, null, "human"), true);

assert.equal(setterMayEnable({ prompt: "", testedAt: "2026-10-26T00:00:00Z" }).ok, false);
assert.equal(setterMayEnable({ prompt: "Ask one question.", testedAt: "" }).ok, false);
assert.equal(setterMayEnable({ prompt: "Ask one question.", testedAt: "2026-10-26T00:00:00Z" }).ok, true);

const now = Date.parse("2026-10-26T09:00:00Z");
const lead = {
  stage: "qualifying",
  booked: false,
  followupCount: 0,
  lastUserMessageAt: new Date(now - 5 * 3600000).toISOString(),
  humanLocked: false
};
const policy = { hoursSinceLastMessage: 4, leadStage: "any", noReplyAfter: 1, maxFollowups: 3, booked: "any", quietStart: "22:00", quietEnd: "08:00" };
assert.equal(followupDue({ enabled: false, policy, lead, now, timeZone: "Europe/Madrid" }).reason, "off");
assert.equal(followupDue({ enabled: true, policy, lead: { ...lead, humanLocked: true }, now, timeZone: "Europe/Madrid" }).reason, "human");
assert.equal(followupDue({ enabled: true, policy: { ...policy, leadStage: "booked" }, lead, now, timeZone: "Europe/Madrid" }).reason, "stage");
assert.equal(followupDue({ enabled: true, policy: { ...policy, booked: "booked" }, lead, now, timeZone: "Europe/Madrid" }).reason, "not_booked");
assert.equal(followupDue({ enabled: true, policy: { ...policy, booked: "not_booked" }, lead: { ...lead, booked: true }, now, timeZone: "Europe/Madrid" }).reason, "booked");
assert.equal(followupDue({ enabled: true, policy, lead: { ...lead, followupCount: 3 }, now, timeZone: "Europe/Madrid" }).reason, "max");
assert.equal(followupDue({ enabled: true, policy: { ...policy, noReplyAfter: 2 }, lead: { ...lead, unanswered: 1 }, now, timeZone: "Europe/Madrid" }).reason, "waiting");
assert.equal(followupDue({ enabled: true, policy, lead: { ...lead, lastUserMessageAt: new Date(now - 3600000).toISOString() }, now, timeZone: "Europe/Madrid" }).reason, "too_soon");
assert.equal(followupDue({ enabled: true, policy, lead: { ...lead, lastUserMessageAt: new Date(now - 25 * 3600000).toISOString() }, now, timeZone: "Europe/Madrid" }).reason, "window");
assert.equal(followupDue({ enabled: true, policy, lead, now: Date.parse("2026-10-26T22:30:00Z"), timeZone: "Europe/Madrid" }).reason, "quiet");
assert.equal(followupDue({ enabled: true, policy, lead, now: Date.parse("2026-10-26T06:30:00Z"), timeZone: "Europe/Madrid" }).reason, "quiet");
assert.equal(followupDue({ enabled: true, policy, lead, now, timeZone: "Europe/Madrid" }).reason, "due");

const due = dueFollowups({ enabled: true, policy, leads: [lead, { ...lead, humanLocked: true }], now, timeZone: "Europe/Madrid" });
assert.equal(due.length, 1);
assert.equal(recoveryKey("thread-1", 2), "recovery:thread-1:2");

assert.equal(previewReply("", "Hi").ok, false);
assert.equal(previewReply("Ask one question.", "").ok, false);
const preview = previewReply("Ask one question.", "What is the price?");
assert.equal(preview.ok, true);
assert.match(preview.reply, /What is the price/);
assert.equal(preview.source, "preview");

assert.deepEqual(dashboardMetrics({
  targets: [{ id: "a" }, { id: "b" }],
  threads: [{ id: "c" }],
  bookings: [{ show_status: "scheduled" }, { show_status: "cancelled" }],
  switches: [{ enabled: true }, { enabled: false }, { enabled: true }]
}), { leads: 2, chats: 1, booked: 1, liveAgents: 2 });

const shared = read("supabase/functions/_shared/agent-control.js");
assert.equal(read("acquire/agent-control.js"), shared);
const sql = read("supabase/migrations/20261026120000_client_dashboard_agents.sql");
assert.match(sql, /NOT APPLIED/);
assert.match(sql, /enable row level security/);
assert.match(sql, /acq_can_read\(business_id\)/);
assert.match(sql, /acq_can_edit\(business_id\)/);
assert.match(sql, /enabled boolean not null default false/);
assert.match(sql, /cron\.unschedule\('tailortalk-sync-hourly'\)/);
assert.match(sql, /cron\.unschedule\('acq-tailortalk-sync'\)/);
assert.match(sql, /followup-boss/);
assert.doesNotMatch(sql, /drop table/i);

for (const file of [
  "supabase/functions/tailortalk-sync/index.ts",
  "supabase/functions/acq-tailortalk/index.ts",
  "supabase/functions/roleflow-setter-sync/index.ts",
  "supabase/functions/setter-engine/index.ts"
]) {
  assert.match(read(file), /TAILORTALK_SYNC_ENABLED/);
}
assert.match(read("supabase/functions/acq-tailortalk/index.ts"), /This engine agent is not used for acquisition/);
assert.match(read("supabase/functions/followup-boss/index.ts"), /followupDue/);
assert.match(read("supabase/functions/followup-boss/index.ts"), /agentEnabled/);
assert.match(read("supabase/functions/zernio-webhook/index.ts"), /sendBlocked/);
assert.match(read("supabase/functions/ig-outbox-tick/index.ts"), /stampAgentEnabled/);
assert.match(read("supabase/functions/roleflow-acquisition/index.ts"), /agentEnabled/);
assert.match(read("supabase/functions/acquisition-bot/index.ts"), /agent_off/);
assert.match(read("supabase/functions/client-dashboard/index.ts"), /preview_setter/);
assert.match(read("supabase/functions/client-dashboard/index.ts"), /setterMayEnable/);
assert.match(read("supabase/config.toml"), /\[functions\.client-dashboard\]\nverify_jwt = true/);
assert.match(read("supabase/config.toml"), /\[functions\.followup-boss\]\nverify_jwt = false/);
assert.match(read("docs/client-dashboard.md"), /ZERNIO_API_KEY/);
assert.match(read("docs/client-dashboard.md"), /XAI_API_KEY/);
assert.match(read("docs/client-dashboard.md"), /NOT APPLIED/);

console.log("agent control tests passed");
