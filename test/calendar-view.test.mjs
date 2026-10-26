import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CALL_MINUTES,
  addMonths,
  blockGeometry,
  buildEvents,
  callEvents,
  eventsOnDay,
  followEvents,
  monthChips,
  monthMatrix,
  placeEvents,
  shiftCursor,
  startOfWeek,
  viewLabel
} from "../acquire/calendar-view.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const wednesday = new Date(2026, 9, 28, 15, 30, 0);
const monday = startOfWeek(wednesday);
assert.equal(monday.getFullYear(), 2026);
assert.equal(monday.getMonth(), 9);
assert.equal(monday.getDate(), 26);
assert.equal(monday.getDay(), 1);

const weeks = monthMatrix(new Date(2026, 9, 26));
assert.equal(weeks.length, 6);
assert.equal(weeks[0].length, 7);
assert.equal(weeks[0][0].getDay(), 1);
assert.equal(weeks.flat().some((day) => day.getDate() === 1 && day.getMonth() === 9), true);

const next = addMonths(new Date(2026, 0, 31, 9, 0, 0), 1);
assert.equal(next.getMonth(), 1);
assert.equal(next.getDate(), 28);
assert.equal(next.getHours(), 9);

const shifted = shiftCursor(new Date(2026, 9, 26, 15, 0, 0), "month", 1);
assert.equal(shifted.getMonth(), 10);
assert.equal(shifted.getDate(), 26);
assert.equal(shiftCursor(new Date(2026, 9, 26), "day", -1).getDate(), 25);
assert.equal(shiftCursor(new Date(2026, 9, 26), "week", 1).getDate(), 2);
assert.equal(shiftCursor(new Date(2026, 9, 26), "schedule", 1).getDate(), 2);

const untimed = callEvents([{ id: "b-none", target_id: "t9", show_status: "scheduled", scheduled_at: null }], [], [])[0];
assert.equal(untimed.untimed, true);
assert.equal(untimed.start, null);
assert.equal(untimed.end, null);
assert.equal(eventsOnDay([untimed], new Date(2026, 9, 26)).length, 0);
const invalid = callEvents([{ id: "b-bad", show_status: "scheduled", scheduled_at: "not-a-time" }], [], [])[0];
assert.equal(invalid.untimed, true);

const start = new Date(2026, 9, 26, 15, 0, 0);
const timed = callEvents([
  { id: "b1", target_id: "t2", show_status: "scheduled", scheduled_at: start }
], [{ id: "t2", handle: "slowreply" }], [])[0];
assert.equal(timed.untimed, false);
assert.equal(timed.title, "slowreply");
assert.equal(timed.handle, "slowreply");
assert.equal(timed.leadKind, "target");
assert.equal(timed.end.getTime() - timed.start.getTime(), CALL_MINUTES * 60000);
assert.equal(CALL_MINUTES, 30);

const overlapStart = new Date(2026, 9, 26, 15, 0, 0);
const later = new Date(2026, 9, 26, 15, 15, 0);
const placed = placeEvents([
  { id: "a", start: overlapStart, end: new Date(overlapStart.getTime() + 30 * 60000), untimed: false },
  { id: "b", start: later, end: new Date(later.getTime() + 30 * 60000), untimed: false }
]);
assert.equal(placed.length, 2);
assert.equal(placed[0].col, 0);
assert.equal(placed[1].col, 1);
assert.equal(placed[0].cols, 2);
const adjacent = placeEvents([
  { id: "a", start: overlapStart, end: new Date(overlapStart.getTime() + 30 * 60000), untimed: false },
  { id: "b", start: new Date(overlapStart.getTime() + 30 * 60000), end: new Date(overlapStart.getTime() + 60 * 60000), untimed: false }
]);
assert.equal(adjacent[0].col, 0);
assert.equal(adjacent[1].col, 0);

const day = new Date(2026, 9, 26, 12, 0, 0);
const chips = monthChips([
  { id: "1", start: new Date(2026, 9, 26, 9, 0), end: new Date(2026, 9, 26, 9, 30), untimed: false },
  { id: "2", start: new Date(2026, 9, 26, 10, 0), end: new Date(2026, 9, 26, 10, 30), untimed: false },
  { id: "3", start: new Date(2026, 9, 26, 11, 0), end: new Date(2026, 9, 26, 11, 30), untimed: false },
  { id: "4", start: new Date(2026, 9, 26, 12, 0), end: new Date(2026, 9, 26, 12, 30), untimed: false },
  untimed
], day);
assert.equal(chips.visible.length, 3);
assert.equal(chips.more, 1);

const geometry = blockGeometry(timed, start);
assert.ok(geometry.top > 60 && geometry.top < 65);
assert.ok(geometry.height > 1 && geometry.height < 4);

const follows = followEvents([
  { id: "r1", title: "Send the link", due_at: start, status: "open", contact_id: "c1" },
  { id: "r2", title: "Done already", due_at: start, status: "done" },
  { id: "r3", title: "No time", status: "open" }
], [], [{ id: "c1", name: "Ada North", ig_handle: "adanorth" }]);
assert.equal(follows.length, 1);
assert.equal(follows[0].title, "Send the link");
assert.equal(follows[0].name, "Ada North");
assert.equal(follows[0].layer, "followups");

const hidden = buildEvents({
  bookings: [{ id: "b1", show_status: "scheduled", scheduled_at: start }],
  reminders: [{ id: "r1", title: "Send the link", due_at: start, status: "open" }],
  layers: { calls: false, followups: true }
});
assert.equal(hidden.length, 1);
assert.equal(hidden[0].layer, "followups");

assert.match(viewLabel(new Date(2026, 9, 1), "month", "en").toLowerCase(), /october/);
assert.match(viewLabel(new Date(2026, 9, 1), "month", "en"), /2026/);
assert.match(viewLabel(new Date(2026, 9, 1), "month", "es").toLowerCase(), /octubre/);

const pages = read("acquire/client-pages.js");
const view = read("acquire/calendar-view.js");
const page = read("acquire/calendar-page.js");
assert.match(pages, /id: "record-booking"/);
assert.match(pages, /renderRoleflowCalendar/);
assert.match(page, /gcal-now/);
assert.match(page, /calSchedule/);
assert.match(page, /bookedCalls/);
assert.match(page, /followLayer/);
assert.doesNotMatch(pages + view + page, /https?:\/\//);
assert.doesNotMatch(pages + view + page, /zernio|zerochats|tailortalk/i);
assert.equal(/zero chats/i.test(page + view), false);

console.log("calendar view tests passed");
