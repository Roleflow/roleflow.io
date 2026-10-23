import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { briefKnowledge, chooseModel, delaySeconds, handoverOnSent, leadPatch, officeOpen } from "../supabase/functions/_shared/setter-gate.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const mondayMorning = Date.parse("2026-10-19T08:30:00Z");
const mondayAfternoon = Date.parse("2026-10-19T16:30:00Z");
assert.equal(officeOpen({ now: mondayMorning, timeZone: "Europe/Madrid", mode: "always" }), true);
assert.equal(officeOpen({ now: mondayMorning, timeZone: "Europe/Madrid", mode: "same", start: "09:00", end: "18:00" }), true);
assert.equal(officeOpen({ now: mondayAfternoon, timeZone: "Europe/Madrid", mode: "same", start: "09:00", end: "18:00" }), false);
assert.equal(officeOpen({
  now: mondayMorning,
  timeZone: "Europe/Madrid",
  mode: "per_day",
  hoursByDay: { mon: { start: "12:00", end: "13:00" } }
}), false);
assert.equal(officeOpen({ now: mondayMorning, timeZone: "Not/AZone", mode: "same", start: "09:00", end: "18:00" }), true);

assert.equal(delaySeconds(30, 90, () => 0), 30);
assert.equal(delaySeconds(30, 90, () => 0.5), 60);
assert.equal(delaySeconds(300, 900, () => 1), 300);
assert.equal(delaySeconds("nope", 10, () => 0), 0);

assert.equal(chooseModel({ preferred: "grok-4.3", text: "What is the price?", state: "qualification" }), "grok-4.3");
assert.equal(chooseModel({ preferred: "grok-4.3", text: "That is too expensive", state: "qualification" }), "grok-4.7");
assert.equal(chooseModel({ preferred: "grok-4.3", text: "ok", state: "booking" }), "grok-4.7");
assert.equal(chooseModel({ preferred: "grok-4.7", text: "hello", state: "qualification" }), "grok-4.7");
assert.equal(chooseModel({ preferred: "", text: "hello", state: "open" }), "grok-4.3");

assert.equal(handoverOnSent(true), true);
assert.equal(handoverOnSent(undefined), true);
assert.equal(handoverOnSent(false), false);

const patched = leadPatch({
  attributes: { budget: "old" },
  tags: ["hot"],
  extracted: { budget: "5000", timeline: "this month" },
  score: "warm",
  inbound: "I need the calendar link",
  rules: [{ name: "booking", rule_text: "calendar" }]
});
assert.equal(patched.attributes.budget, "5000");
assert.equal(patched.attributes.timeline, "this month");
assert.deepEqual(patched.tags, ["hot", "warm", "booking"]);
assert.equal(briefKnowledge({ sell: "Coaching", who: "" }), "\n\nBusiness information\nsell: Coaching");
assert.equal(briefKnowledge(null), "");

const webhook = read("supabase/functions/zernio-webhook/index.ts");
assert.match(webhook, /officeOpen/);
assert.match(webhook, /chooseModel/);
assert.match(webhook, /handoverOnSent/);
assert.match(webhook, /leadPatch/);
assert.match(webhook, /briefKnowledge/);
assert.match(webhook, /Outside office hours/);
assert.doesNotMatch(webhook, /console\.log/);
assert.match(read("acquire/studio-ops.js"), /The live setter uses these hours/);
assert.match(read("acquire/studio-ops.js"), /setter_model/);
assert.doesNotMatch(read("acquire/studio-ops.js"), /zernio|tailortalk/i);
assert.match(read("supabase/migrations/20261023140000_setter_gate.sql"), /setter_model text not null default 'grok-4.3'/);
