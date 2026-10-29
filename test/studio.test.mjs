import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_CHARS,
  SETTER_SYNC,
  charCount,
  collectLeads,
  emptyBrief,
  exportCsv,
  filterLeads,
  formatDelta,
  paginate,
  paidFromLinks,
  scoreBrief,
  stateFromLegacy,
  validateAsset,
  validateLink,
  validateSchedule,
  versionDelta
} from "../acquire/studio-model.js";
import { SETTER_SYNC as UI_SYNC } from "../acquire/studio.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const banned = /tailortalk|zerochats|topclosers|zero chats/i;

assert.equal(SETTER_SYNC, false);
assert.equal(UI_SYNC, false);

const filled = emptyBrief();
filled.sell = "A 12-week coaching program for founders.";
filled.who = "B2B founders";
filled.pains = "Slow replies";
filled.offer = "Twelve weeks of pipeline work with a weekly review and a written plan.";
filled.guarantee = "A rewrite if the first month misses the agreed activity.";
const scored = scoreBrief(filled);
assert.equal(scored.score, 6);
assert.equal(scoreBrief(emptyBrief()).items.some((item) => item.startsWith("Add ")), true);

const cards = [{ name: "Ada", instructions: "Ask one question.", delegations: [{ when: "budget is clear", to: "appointment_booking" }] }];
assert.equal(charCount(filled, cards) < MAX_CHARS, true);
const huge = { ...emptyBrief(), sell: "x".repeat(MAX_CHARS) };
assert.equal(charCount(huge, []) > MAX_CHARS, true);

assert.equal(versionDelta({ char_count: 10 }, null), null);
assert.equal(versionDelta({ char_count: 12 }, { char_count: 10 }), 2);
assert.equal(formatDelta(null), "First save");
assert.equal(formatDelta(0), "Same length");
assert.equal(formatDelta(12), "+12 characters");
assert.equal(formatDelta(-3), "−3 characters");

assert.equal(stateFromLegacy("converted", "outreach", false), "paid");
assert.equal(stateFromLegacy("warm", "target", false), "discovering");
assert.equal(stateFromLegacy("cold", "booked", false), "booked");
assert.equal(stateFromLegacy("dead", "", false), "lost");
assert.equal(stateFromLegacy("", "", false), "open");
assert.equal(stateFromLegacy("proposal", "", false), "proposal");

const leads = collectLeads(
  [{ id: "c1", target_id: "t1", name: "Ada", ig_handle: "@ada", lead_status: "hot", crm_state: null, sales_link_id: "link-1", tags: ["vip"], ai_enabled: false, follower_count: 1200, message_count: 4, automated: false, is_verified: true, we_follow: true, they_follow: false, last_message_at: "2026-10-20T12:00:00Z", attributes: { summary: "Asked about price." } }],
  [{ id: "t1", handle: "ada", stage: "outreach", lead_status: "warm" }, { id: "t2", handle: "north", stage: "target", lead_status: "cold", crm_state: "open" }]
);
assert.equal(leads.length, 2);
assert.equal(leads[0].salesLinkId, "link-1");
assert.equal(leads[0].state, "qualifying");
assert.equal(leads[0].report, "Asked about price.");
assert.deepEqual(filterLeads(leads, { q: "@ada" }).map((lead) => lead.handle), ["ada"]);
assert.equal(filterLeads(leads, { state: "open" }).length, 1);
assert.equal(filterLeads(leads, { tag: "vip" }).length, 1);
assert.equal(filterLeads(leads, { automated: "no" }).length, 1);
assert.equal(filterLeads(leads, { verified: "yes" }).length, 1);
assert.equal(filterLeads(leads, { weFollow: "yes", theyFollow: "no" }).length, 1);
assert.equal(filterLeads(leads, { minFollowers: 5000 }).length, 0);
assert.equal(filterLeads(leads, { minFollowers: 1000 }).length, 1);
assert.equal(filterLeads(leads, { messageMin: 5 }).length, 0);
assert.equal(filterLeads(leads, { lastFrom: "2026-10-21T00:00:00.000Z" }).length, 0);
assert.equal(filterLeads(leads, { lastTo: "2026-10-19T00:00:00.000Z" }).length, 0);

const page = paginate([1, 2, 3], 2, 2);
assert.equal(page.pages, 2);
assert.deepEqual(page.rows, [3]);
const csv = exportCsv([{ name: 'Ada, "A"', handle: "ada", state: "open", agent: "", tags: ["a", "b"], ai: true, messages: 1, followers: null, lastMessageAt: "" }]);
assert.ok(csv.startsWith("name,handle,state"));
assert.ok(csv.includes('"Ada, ""A"""'));

assert.equal(validateLink({ name: "", url: "https://roleflow.io" }).ok, false);
assert.equal(validateLink({ name: "Offer", url: "http://roleflow.io" }).ok, false);
const link = validateLink({ name: "Offer", url: "https://roleflow.io/pay", ticket: "10.5", sendAsButton: true, buttonLabel: "Pay now" });
assert.equal(link.ok, true);
assert.equal(link.cents, 1050);
assert.equal(validateLink({ name: "Offer", url: "https://roleflow.io", sendAsButton: true, buttonLabel: "x".repeat(21) }).ok, false);

assert.equal(validateAsset({ type: "link", placement: "ai", url: "https://roleflow.io/a" }).ok, true);
assert.equal(validateAsset({ type: "image", placement: "before", file: null, storagePath: "" }).ok, false);
assert.equal(validateAsset({ type: "image", placement: "before", file: { size: 9 * 1024 * 1024 } }).ok, false);
assert.equal(validateAsset({ type: "button", placement: "after", url: "https://roleflow.io", label: "x".repeat(21) }).ok, false);
assert.equal(validateSchedule({ provider: "calendly", availability_url: "", booking_url: "" }).ok, false);
assert.equal(validateSchedule({ provider: "custom", availability_url: "https://example.com/free", booking_url: "" }).ok, true);
assert.equal(validateSchedule({ provider: "gohighlevel", availability_url: "http://bad", booking_url: "" }).ok, false);

assert.equal(paidFromLinks(
  [{ state: "paid", salesLinkId: "a" }, { state: "booked", salesLinkId: "a" }, { state: "paid", salesLinkId: "missing" }],
  [{ id: "a", average_ticket_cents: 250000 }]
), 250000);

["acquire/studio.js", "acquire/studio-model.js", "acquire/app.js", "acquire/home.js", "acquire/acquire.css"].forEach((file) => {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  assert.equal(banned.test(text), false, file);
});

const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261022190000_studio_phase1.sql"), "utf8");
assert.match(migration, /acq_can_read/);
assert.match(migration, /acq_can_edit/);
assert.match(migration, /acq_set_schedule_secret/);
assert.match(migration, /revoke all on private\.acq_schedule_secrets from public, anon, authenticated/);
assert.doesNotMatch(migration, /grant select on private\.acq_schedule_secrets to authenticated/i);
assert.match(migration, /studio_setter_sync boolean not null default false/);
assert.match(migration, /status in \('pending', 'cancelled'\)/);

const app = fs.readFileSync(path.join(root, "acquire/app.js"), "utf8");
assert.match(app, /roleflow-studio/);
assert.match(app, /acq_set_schedule_secret/);
assert.doesNotMatch(app, /setter_sync:\s*true/);

const studio = fs.readFileSync(path.join(root, "acquire/studio.js"), "utf8");
const model = fs.readFileSync(path.join(root, "acquire/studio-model.js"), "utf8");
const business = studio.match(/export function renderBusiness[\s\S]*?\n}\n\nfunction proposalCard/);
assert.ok(business);
assert.match(business[0], /renderSopPage/);
assert.doesNotMatch(business[0], /Live setter sync is off|Conversation simulator|Prompt quality|Save business/);
assert.match(studio, /Conversation simulator/);
assert.match(studio, /Export CSV/);
assert.match(studio, /Automatic scheduling/);
assert.match(model, /Calendly/);
assert.match(model, /The AI decides/);

console.log("studio tests passed");
