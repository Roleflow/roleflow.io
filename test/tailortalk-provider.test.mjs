import assert from "node:assert/strict";
import fs from "node:fs";
import {
  advanceStage,
  ATTRIBUTE_KEYS,
  contactIdFor,
  contactsFrom,
  eventKey,
  extractAttributes,
  leadsFrom,
  mapLeadStatus,
  matchContact,
  messagesFrom,
  normalizeHandle,
  orderAmount,
  roleForTrigger,
  stageForStatus,
  syntheticHandle,
  toSyncRow,
  webhookTimestampFresh
} from "../supabase/functions/acq-tailortalk/map.js";

const hot = {
  id: "lead-1",
  lead_name: "Ada",
  lead_contact: "9198****",
  lead_status: "warm",
  is_converted: false,
  attributes: { budget: "8k", timeline: "30 days", decision_maker: "yes", fit: "strong", ig_handle: "ada.coach", offer: "group", monthly_revenue: "40000" },
  chat_history: [{ role: "user", text: "What is the price?", id: "m1", time: "2026-10-21T10:00:00Z" }],
  bookings: [{ id: "book-1", start: "2026-10-22T15:00:00Z", status: "scheduled" }]
};

assert.equal(mapLeadStatus({ is_converted: true, lead_status: "cold" }), "converted");
assert.equal(mapLeadStatus({ lead_status: "spam" }), "dead");
assert.equal(mapLeadStatus({ lead_status: "hot" }), "hot");
assert.equal(stageForStatus("converted"), "booked");
assert.equal(stageForStatus("warm"), "qualified");
assert.equal(stageForStatus("cold"), "reply");
assert.equal(advanceStage("closed", "dead"), "closed");
assert.equal(advanceStage("qualified", "reply"), "qualified");
assert.equal(advanceStage("reply", "booked"), "booked");

const attrs = extractAttributes(hot);
assert.equal(attrs.budget, "8k");
assert.equal(attrs.ig_handle, "ada.coach");
assert.equal(attrs.offer, "group");
assert.equal(attrs.monthly_revenue, "40000");
assert.equal(normalizeHandle("9198****"), null);
assert.equal(normalizeHandle("@Ada.Coach"), "ada.coach");
assert.equal(syntheticHandle("lead-1"), "ttlead1");

const row = toSyncRow(hot, null, "on_warm");
assert.equal(row.handle, "ada.coach");
assert.equal(row.role, "qualification");
assert.equal(row.decision_maker, true);
assert.equal(row.messages.length, 1);
assert.equal(row.bookings[0].calendar_ref, "book-1");
assert.equal(roleForTrigger("first_message", "cold", 0), "comment_to_dm");
assert.equal(roleForTrigger("on_converted", "hot", 0), "appointment_booking");
assert.equal(messagesFrom({ conversation: [{ from: "bot", message: "Hello" }] })[0].role, "assistant");

const contacts = contactsFrom({ contacts: [{ phone_number: "91980000", budget: "from-contact" }], count: 1 });
assert.equal(matchContact({ id: "x", lead_contact: "+91980000" }, contacts).budget, "from-contact");
assert.equal(leadsFrom({ success: true, data: { leads: [hot], count: 1 } }).length, 1);
assert.equal(orderAmount(250000), 2500);
assert.equal(orderAmount(0), 0);
assert.equal(contactIdFor({ contact: "9198****", ig_handle: "ada.coach", external_id: "lead-1" }, { handle: "ada.coach" }), "");
assert.equal(contactIdFor({ contact: "178414058221234", ig_handle: "ada.coach", external_id: "lead-1" }, { handle: "ada.coach" }), "178414058221234");
assert.equal(contactIdFor({ instagram_user_id: "178414058221234", ig_handle: "ada.coach" }, {}), "178414058221234");
assert.equal(eventKey(hot, "2026-10-21T10:00:00Z"), "lead-1:2026-10-21T10:00:00Z");

const webhookLead = {
  id: "lead-9",
  lead_attributes: { voice_note_slot: "gap_building", objections: ["price", "timing"], niche: "coaches", budget: "8k" },
  chat_summary: "Wants the group offer.",
  chat_history: [{ role: "assistant", content: "Here is the gap.", message_id: "m9", time: "2026-10-21T12:00:00Z" }]
};
const webhookAttrs = extractAttributes(webhookLead);
assert.equal(ATTRIBUTE_KEYS.length, 17);
assert.equal(webhookAttrs.voice_note_slot, "gap_building");
assert.equal(webhookAttrs.objections, "price; timing");
assert.equal(webhookAttrs.niche, "coaches");
assert.equal(webhookAttrs.budget, "8k");
const webhookRow = toSyncRow(webhookLead, null, "on_hot");
assert.equal(webhookRow.detail, "webhook");
assert.equal(webhookRow.messages[0].body, "Here is the gap.");
assert.equal(webhookRow.messages[0].external_id, "m9");
assert.equal(webhookRow.attributes.chat_summary, "Wants the group offer.");
assert.equal(webhookRow.attributes.voice_note_slot, "gap_building");
const summaryOnly = toSyncRow(webhookLead, null, "every_message", "summary");
assert.equal(summaryOnly.detail, "summary");
assert.equal(summaryOnly.messages, null);
assert.deepEqual(summaryOnly.attributes, {});
const stamp = Date.parse("2026-10-21T12:00:00Z");
assert.equal(webhookTimestampFresh("2026-10-21T12:00:00Z", stamp), true);
assert.equal(webhookTimestampFresh(String(Math.floor(stamp / 1000)), stamp), true);
assert.equal(webhookTimestampFresh(String(stamp), stamp), true);
assert.equal(webhookTimestampFresh("2026-10-21T12:05:00Z", stamp), true);
assert.equal(webhookTimestampFresh("2026-10-21T12:05:01Z", stamp), false);
assert.equal(webhookTimestampFresh("", stamp), false);
assert.equal(webhookTimestampFresh("nope", stamp), false);

const sql = fs.readFileSync(new URL("../supabase/migrations/20261021180000_tailortalk_provider.sql", import.meta.url), "utf8");
assert.match(sql, /setter_provider in \('roleflow_meta', 'tailortalk'\)/);
assert.match(sql, /extensions\.pgp_sym_encrypt/);
assert.match(sql, /extensions\.pgp_sym_decrypt/);
assert.match(sql, /private\.tt_business_secrets/);
assert.match(sql, /acq_mint_worker_key/);
assert.match(sql, /acq-tailortalk-sync/);
assert.match(sql, /\*\/5 \* \* \* \*/);
assert.doesNotMatch(sql, /using \(true\)/);
assert.match(sql, /revoke all on function public\.acq_mint_worker_key\(uuid\) from public, anon, authenticated/);
assert.doesNotMatch(sql, /cron\.unschedule\('acquisition-tick'\)/);
assert.doesNotMatch(sql, /cron\.unschedule\('tailortalk-sync-hourly'\)/);

const fn = fs.readFileSync(new URL("../supabase/functions/acq-tailortalk/index.ts", import.meta.url), "utf8");
assert.match(fn, /https:\/\/api\.tailortalk\.ai\/api\/v1\/mark_converted/);
assert.doesNotMatch(fn, /service\.tailortalk\.ai/);
assert.match(fn, /https:\/\/api\.tailortalk\.ai\/api\/v1\/mark_order/);
assert.match(fn, /https:\/\/api\.tailortalk\.ai\/api\/v1\/get_leads/);
assert.match(fn, /Authorization: `Agent \$\{apiKey\}`/);
assert.match(fn, /acq_read_cron_secret/);
assert.match(fn, /tailortalk_read_cron_secret/);
assert.match(fn, /tailortalk_register_business_agent/);
assert.match(fn, /X-Webhook-Timestamp/);
assert.match(fn, /TailorTalk-Webhook\/1.0/);
assert.match(fn, /searchParams\.get\("k"\)/);
assert.match(fn, /mark_converted needs the Instagram user id/);
assert.doesNotMatch(fn, /X-Roleflow-Webhook-Secret/);
assert.doesNotMatch(fn, /get_contacts/);

const facts = fs.readFileSync(new URL("../supabase/migrations/20261021220000_tailortalk_facts.sql", import.meta.url), "utf8");
assert.match(facts, /detail_source in \('pull', 'webhook'\)/);
assert.match(facts, /webhook_seen_at/);
assert.match(facts, /acq_tt_businesses_for_tt_agent/);
assert.match(facts, /tailortalk_register_business_agent/);
assert.match(facts, /tailortalk_read_cron_secret/);
assert.match(facts, /'\*\/5 \* \* \* \*'/);
assert.match(facts, /cron\.unschedule\('tailortalk-sync-hourly'\)/);
assert.match(facts, /when coalesce\(v_row->>'detail', ''\) = 'summary' then public\.acq_contacts\.attributes/);
assert.doesNotMatch(facts, /cron\.unschedule\('acquisition-tick'\)/);
assert.doesNotMatch(facts, /cron\.unschedule\('acq-tailortalk-sync'\)/);

const bot = fs.readFileSync(new URL("../supabase/functions/acquisition-bot/index.ts", import.meta.url), "utf8");
assert.match(bot, /find_targets/);
assert.match(bot, /5,000–200,000 followers/);

const doc = fs.readFileSync(new URL("../docs/acquisition-bot-api.md", import.meta.url), "utf8");
assert.match(doc, /curl -sS -X POST/);
assert.match(doc, /acq_mint_worker_key/);
assert.match(doc, /find_targets/);
assert.match(doc, /daily_cap/);

const panel = fs.readFileSync(new URL("../acquire/app.js", import.meta.url), "utf8");
const engine = fs.readFileSync(new URL("../acquire/engine-ui.js", import.meta.url), "utf8");
assert.match(panel, /Powered by TailorTalk/);
assert.match(panel, /setter_provider/);
assert.match(panel, /mark_won/);
assert.match(panel, /detail_source/);
assert.match(panel, /voice_note_slot/);
assert.match(panel, /Voice notes to record and send/);
assert.match(panel, /Starter pulls status and a summary every 5 minutes/);
assert.match(panel, /is_converted === true/);
assert.match(engine, /TailorTalk API key/);
assert.match(engine, /functions\/v1\/acq-tailortalk/);
assert.match(engine, /Starter pulls status and a summary every 5 minutes/);
assert.match(engine, /paid-plan webhook/);
assert.doesNotMatch(fs.readFileSync(new URL("../account/account.js", import.meta.url), "utf8"), /tailortalk/i);

const toml = fs.readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
assert.match(toml, /\[functions\.acq-tailortalk\]\nverify_jwt = false/);

console.log("tailortalk provider tests passed");
