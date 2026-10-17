import assert from "node:assert/strict";
import { activeTask, leftLabel, openQueue, progressOf, taskSpot, timeline } from "./queue.mjs";

const tasks = [
  { id: "a", title: "Research the ICP list", status: "queued", priority: "normal", created_at: "2026-10-16T10:00:00Z" },
  { id: "b", title: "Review the call notes", status: "in_progress", priority: "low", created_at: "2026-10-16T09:00:00Z", started_at: "2026-10-17T05:00:00Z", estimate_minutes: 20 },
  { id: "c", title: "Send the draft to Diego", status: "needs_diego", priority: "high", created_at: "2026-10-16T08:00:00Z" },
  { id: "d", title: "Blocked pixel", status: "blocked", priority: "high", created_at: "2026-10-16T07:00:00Z" },
  { id: "e", title: "Old homepage", status: "done", priority: "high", created_at: "2026-10-15T07:00:00Z", completed_at: "2026-10-16T12:00:00Z" }
];

assert.deepEqual(openQueue(tasks).map((task) => task.id), ["d", "c", "a", "b"]);
assert.equal(activeTask(tasks).id, "c");
assert.equal(taskSpot(tasks[0]), "board");
assert.equal(taskSpot(tasks[1]), "meeting");
assert.equal(taskSpot(tasks[2]), "outbox");
assert.equal(activeTask([{ id: "only", title: "Sit", status: "blocked", priority: "high", created_at: "2026-10-16T07:00:00Z" }]), null);

const now = new Date("2026-10-17T05:10:00Z");
const started = progressOf(tasks[1], now);
assert.equal(started.ratio, 0.5);
assert.equal(started.left, 10);
assert.equal(leftLabel(started), "~10 min left");
const unestimated = progressOf(tasks[0], now);
assert.equal(unestimated.estimated, true);
assert.match(leftLabel(unestimated), /est\.$/);
const overtime = progressOf({ ...tasks[1], started_at: "2026-10-17T04:00:00Z" }, now);
assert.equal(overtime.ratio, 0.95);
assert.equal(leftLabel(overtime), "over est.");

const rows = timeline(tasks, now);
assert.equal(rows.find((row) => row.task.id === "c").lane, "now");
assert.equal(rows.find((row) => row.task.id === "d").lane, "later");
assert.equal(rows.find((row) => row.task.id === "a").lane, "next");
assert.equal(rows.find((row) => row.task.id === "b").lane, "later");
assert.equal(rows.some((row) => row.task.id === "e"), false);

console.log("queue ok");
