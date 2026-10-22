import assert from "node:assert/strict";
import {
  attributedCents,
  dropOffs,
  funnel,
  inQuietHours,
  pickVoiceNote,
  shareCents,
  showUpRate,
  voiceRates
} from "../acquire/model.js";

const targets = [
  { stage: "warmup", peak_stage: "warmup" },
  { stage: "dead", peak_stage: "outreach" },
  { stage: "closed", peak_stage: "closed" },
  { stage: "skipped", peak_stage: "skipped" }
];

const steps = funnel(targets);
assert.deepEqual(steps.map((step) => step.count), [3, 3, 2, 1, 1, 1, 1, 1]);
const drops = dropOffs(steps);
assert.equal(drops[1].dropped, 1);
assert.equal(drops[0].dropped, 0);

assert.equal(shareCents(1000000), 100000);
assert.equal(shareCents(10050), 1005);
assert.equal(attributedCents([
  { amount_cents: 50000, attributed: true },
  { amount_cents: 20000, attributed: false }
]), 50000);

const shows = showUpRate([
  { show_status: "showed" },
  { show_status: "no_show" },
  { show_status: "scheduled" }
]);
assert.equal(shows.rate, 0.5);
assert.equal(showUpRate([]).rate, null);

assert.equal(inQuietHours("23:10:00", "22:00:00", "08:00:00"), true);
assert.equal(inQuietHours("09:00:00", "22:00:00", "08:00:00"), false);
assert.equal(inQuietHours("12:00:00", "12:00:00", "13:00:00"), true);
assert.equal(inQuietHours("13:00:00", "12:00:00", "13:00:00"), false);
assert.equal(inQuietHours("10:00:00", "09:00:00", "09:00:00"), false);

const notes = [
  { id: "generic", slot: "outreach_opener", niche: null, variant: null, active: true, updated_at: "2026-10-01" },
  { id: "coach", slot: "outreach_opener", niche: "coaching", variant: "a", active: true, updated_at: "2026-10-02" },
  { id: "off", slot: "outreach_opener", niche: "coaching", variant: null, active: false, updated_at: "2026-10-03" },
  { id: "gap", slot: "gap_building", niche: null, variant: null, active: true, updated_at: "2026-10-04" }
];
assert.equal(pickVoiceNote(notes, "outreach_opener", "coaching", null).id, "coach");
assert.equal(pickVoiceNote(notes, "outreach_opener", "", null).id, "generic");
assert.equal(pickVoiceNote(notes, "gap_building", "coaching", "b").id, "gap");
assert.equal(pickVoiceNote(notes, "reminder", null, null), null);

assert.equal(voiceRates({ sends: 4, replies: 2, bookings: 1 }).replyRate, 0.5);
assert.equal(voiceRates({ sends: 0, replies: 0, bookings: 0 }).bookingRate, null);

const migration = await import("node:fs").then((fs) => fs.readFileSync(new URL("../supabase/migrations/20261021120000_acquisition_pipeline.sql", import.meta.url), "utf8"));
assert.match(migration, /acq-voice/);
assert.match(migration, /ai_voice_future = false/);
assert.match(migration, /share_bps = 1000/);
assert.match(migration, /security_invoker = true/);
assert.match(migration, /acq_bot_ingest/);
assert.match(migration, /acq_bot_queue/);
assert.match(migration, /acq_bot_report/);
assert.match(migration, /acq_bot_pause/);
assert.match(migration, /acq_bot_voice/);
assert.match(migration, /outreach_opener/);
assert.match(migration, /recovery_followup_2/);
assert.match(migration, /recovery_value/);
assert.match(migration, /acq_workspaces/);
assert.match(migration, /"engine":"roleflow"/);
assert.doesNotMatch(migration, /elevenlabs/i);

const bot = await import("node:fs").then((fs) => fs.readFileSync(new URL("../supabase/functions/acquisition-bot/index.ts", import.meta.url), "utf8"));
assert.match(bot, /acq_worker_auth/);
assert.match(bot, /SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(bot, /ACQUISITION_BOT_SECRET/);
assert.match(bot, /createSignedUrl/);
assert.doesNotMatch(bot, /elevenlabs/i);

const panel = await import("node:fs").then((fs) => fs.readFileSync(new URL("../acquire/app.js", import.meta.url), "utf8"));
const account = await import("node:fs").then((fs) => fs.readFileSync(new URL("../account/acquisition/index.html", import.meta.url), "utf8"));
assert.match(panel, /shortTime\(settings\.quiet_end, "08:00"\)/);
assert.match(panel, /acq_open_workspace/);
assert.match(panel, /acq_workspaces/);
assert.doesNotMatch(panel, /from\("client_ai_setters"\)/);
assert.match(account, /data-tab="inbox"/);
assert.match(account, /data-tab="integrations"/);
assert.match(account, /data-tab="billing"/);

const engineSql = await import("node:fs").then((fs) => fs.readFileSync(new URL("../supabase/migrations/20261021140000_conversation_engine.sql", import.meta.url), "utf8"));
assert.match(engineSql, /extensions\.gen_random_bytes/);
assert.match(engineSql, /extensions\.digest/);
assert.doesNotMatch(engineSql, /(?<![.\w])gen_random_bytes/);
assert.doesNotMatch(engineSql, /(?<![.\w])digest\(/);

const tail = await import("node:fs").then((fs) => fs.readFileSync(new URL("../scripts/pages_tail.py", import.meta.url), "utf8"));
assert.doesNotMatch(tail, /cloned-voice|cloned voice/);
for (const page of [
  "for/coaches/index.html",
  "for/consultants/index.html",
  "for/agency-owners/index.html",
  "for/course-creators/index.html",
  "vs/mochi/index.html",
  "vs/ripdrip/index.html"
]) {
  const html = await import("node:fs").then((fs) => fs.readFileSync(new URL("../" + page, import.meta.url), "utf8"));
  assert.doesNotMatch(html, /cloned-voice/, page);
}
