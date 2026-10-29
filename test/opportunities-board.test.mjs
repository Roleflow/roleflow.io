import assert from "node:assert/strict";
import fs from "node:fs";
import { applyStage, columnSummary, daysInStage, messageSnippet, presentLeads, valueCentsFor } from "../acquire/pipeline.js";
import { filterLeads } from "../acquire/studio-model.js";

const lead = { id: "c1", kind: "contact", state: "discovering", targetId: "t2", handle: "ada", name: "Ada", source: "instagram", ai: true, tags: ["warm"], lastMessageAt: "2026-10-25T18:00:00Z" };
assert.equal(valueCentsFor(lead, [{ target_id: "t2", amount_cents: 1000000 }]), 1000000);
assert.equal(valueCentsFor({ id: "c2", kind: "contact" }, [{ target_id: "t2", amount_cents: 50 }]), null);
assert.equal(messageSnippet(lead, [{ id: "cv", contact_id: "c1" }], [{ conversation_id: "cv", body: "How does the offer work?", sent_at: "2026-10-25T18:00:00Z" }]), "How does the offer work?");
assert.equal(daysInStage("2026-10-24T12:00:00Z", new Date("2026-10-29T12:00:00Z")), 5);

const presented = presentLeads([lead], {
  deals: [{ target_id: "t2", amount_cents: 250000 }],
  conversations: [{ id: "cv", contact_id: "c1" }],
  messages: [{ conversation_id: "cv", body: "Hello there", sent_at: "2026-10-25T18:00:00Z" }],
  events: [{ contact_id: "c1", to_state: "discovering", created_at: "2026-10-24T12:00:00Z" }],
  now: new Date("2026-10-29T12:00:00Z")
});
assert.equal(presented[0].valueCents, 250000);
assert.equal(presented[0].days, 5);
assert.equal(presented[0].snippet, "Hello there");
const summary = columnSummary(presented, "discovering");
assert.equal(summary.count, 1);
assert.equal(summary.valueCents, 250000);
assert.equal(summary.hasValue, true);
assert.equal(columnSummary(presented, "lost").hasValue, false);
assert.equal(applyStage([{ id: "c1", crm_state: "open" }], "c1", "booked")[0].crm_state, "booked");
assert.deepEqual(filterLeads(presented, { source: "instagram", ai: "on", tag: "warm" }).map((row) => row.id), ["c1"]);
assert.deepEqual(filterLeads(presented, { source: "keyword" }), []);
assert.deepEqual(filterLeads(presented, { lastFrom: "2026-10-26T00:00:00.000Z" }), []);

const root = new URL("../", import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), "utf8");
const ui = read("acquire/studio.js") + read("acquire/app.js") + read("acquire/acquire.css");
assert.match(ui, /export function renderCrm/);
assert.match(ui, /pipe-board/);
assert.match(ui, /pointerdown/);
assert.match(ui, /moveOpportunity/);
assert.match(ui, /Open chat/);
assert.match(ui, /eq\("business_id", state\.businessId\)/);
assert.match(ui, /eq\("agent_id", state\.businessId\)/);
assert.match(ui, /--gold:#E8B04A/);
assert.match(ui, /--grad:linear-gradient/);
assert.doesNotMatch(ui, /zernio|tailortalk/i);
const sql = read("supabase/migrations/20261029140000_opportunity_stages.sql");
assert.match(sql, /acq_stage_events/);
assert.match(sql, /acq_record_crm_stage/);
assert.match(sql, /acq_contacts_stage_event/);
assert.match(sql, /acq_targets_stage_event/);
assert.match(sql, /actor in \('human', 'ai'\)/);
assert.match(sql, /supabase_realtime/);
assert.doesNotMatch(sql, /drop table/i);
assert.doesNotMatch(sql, /password/i);

console.log("opportunities board tests passed");
