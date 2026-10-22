import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  exportThread,
  matchKeyword,
  reminderBucket,
  reminderKpis,
  stepError,
  volumeByDay,
  welcomeError
} from "../acquire/studio-flow-model.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const now = new Date("2026-10-22T15:00:00Z");

assert.deepEqual(stepError({ hours: 0, mode: "ai", body: "Ask", state: "any", states: ["open"] }), ["Choose a step from 1 to 23 hours."]);
assert.deepEqual(stepError({ hours: 4, mode: "text", body: "  ", state: "any", states: ["open"] }), ["Write the instruction or the message."]);
assert.deepEqual(stepError({ hours: 4, mode: "text", body: "Hello", state: "any", states: ["open"] }), []);
assert.equal(welcomeError([{ delay_hours: 1, body: "Hi" }, { delay_hours: 20, body: "Still here" }, { delay_hours: 1, body: "Third" }])[0].includes("two"), true);
assert.equal(welcomeError([{ delay_hours: 30, body: "Late" }])[0].includes("24"), true);

assert.equal(reminderBucket({ status: "open", due_at: "2026-10-21T10:00:00Z" }, now), "overdue");
assert.equal(reminderBucket({ status: "open", due_at: "2026-10-22T18:00:00Z" }, now), "today");
assert.equal(reminderBucket({ status: "open", due_at: "2026-10-25T18:00:00Z" }, now), "week");
assert.equal(reminderBucket({ status: "done", due_at: "2026-10-21T10:00:00Z" }, now), "done");
const kpis = reminderKpis([
  { status: "open", due_at: "2026-10-21T10:00:00Z" },
  { status: "open", due_at: "2026-10-22T18:00:00Z" },
  { status: "open", due_at: "2026-10-25T18:00:00Z" }
], now);
assert.equal(kpis.overdue, 1);
assert.equal(kpis.today, 1);
assert.equal(kpis.week, 2);

const volume = volumeByDay([{ created_at: "2026-10-22T12:00:00Z" }], 14, now);
assert.equal(volume.length, 14);
assert.equal(volume[volume.length - 1].count, 1);

assert.equal(matchKeyword("Send the GUIDE", "guide", "contains"), true);
assert.equal(matchKeyword("guide please", "guide", "equals"), false);
assert.equal(matchKeyword("Guide", "guide", "equals"), true);

const thread = [{ role: "user", body: "Price?", at: "2026-10-22T12:00:00Z" }, { role: "assistant", body: "On the call.", at: "" }];
assert.match(exportThread(thread, "txt"), /Lead: Price\?/);
assert.match(exportThread(thread, "csv"), /^role,body,at/);
assert.equal(JSON.parse(exportThread(thread, "json"))[1].body, "On the call.");

["acquire/studio-flow.js", "acquire/studio-flow-model.js"].forEach((file) => {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  assert.equal(/tailortalk|zerochats|topclosers|zero chats/i.test(text), false, file);
});
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261022210000_studio_phase2.sql"), "utf8");
assert.match(migration, /acq_can_read/);
assert.match(migration, /hours between 1 and 23/);
assert.match(migration, /position in \(1, 2\)/);
assert.match(migration, /char_length\(button_label\) <= 20/);
assert.doesNotMatch(migration, /status in \('sent'\)/);

console.log("studio flow tests passed");
