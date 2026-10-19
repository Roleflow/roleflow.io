import assert from "node:assert/strict";
import { clip, currentDesk, scrubDesk } from "./desk.mjs";

const now = new Date("2026-10-19T08:00:00.000Z");

const mixed = currentDesk({
  now,
  tasks: [
    { id: "done", status: "done", title: "Finished yesterday", updated_at: "2026-10-19T07:50:00.000Z" },
    { id: "cancelled", status: "cancelled", title: "Dropped", updated_at: "2026-10-19T07:55:00.000Z" },
    { id: "queued-new", status: "queued", title: "Newer queued work", updated_at: "2026-10-19T07:40:00.000Z" },
    { id: "need-new", status: "needs_diego", title: "Newer ask for Diego", updated_at: "2026-10-19T07:30:00.000Z" },
    { id: "running", status: "in_progress", title: "Agentic HQ office: new org hierarchy with brain rockets (DIEGO-DIRECT)", updated_at: "2026-10-19T05:40:53.000Z" }
  ],
  activity: [{ detail: "logged digest run", created_at: "2026-10-19T06:00:00.000Z" }],
  schedules: [{ enabled: true, next_run: "2026-10-20T07:00:00.000Z" }]
});
assert.equal(mixed.kind, "task");
assert.equal(mixed.task.id, "running");
assert.equal(mixed.chip, "in progress");
assert.equal(mixed.more, 2);
assert.equal(mixed.full, "Agentic HQ office: new org hierarchy with brain rockets (DIEGO-DIRECT)");
assert.ok(mixed.short.length <= 60, mixed.short);
assert.match(mixed.short, /^Agentic HQ office: new org hierarchy with brain rockets/);
assert.match(mixed.line, /in progress/);
assert.match(mixed.line, /\+2 more/);

const blocked = currentDesk({
  now,
  tasks: [
    { id: "q", status: "queued", title: "Queued later", updated_at: "2026-10-19T07:00:00.000Z" },
    { id: "b", status: "blocked", title: "Meta Business Manager / ad account / Pixel not set up", updated_at: "2026-10-18T13:11:46.000Z" }
  ]
});
assert.equal(blocked.task.id, "b");
assert.equal(blocked.chip, "blocked");
assert.equal(blocked.more, 1);

const sameRank = currentDesk({
  now,
  tasks: [
    { id: "b-old", status: "blocked", title: "Older block", updated_at: "2026-10-18T10:00:00.000Z" },
    { id: "n-new", status: "needs_diego", title: "Newer need", updated_at: "2026-10-18T13:11:46.000Z" },
    { id: "q", status: "queued", title: "Queue", updated_at: "2026-10-19T01:00:00.000Z" }
  ]
});
assert.equal(sameRank.task.id, "n-new");
assert.equal(sameRank.chip, "needs Diego");

const tie = currentDesk({
  now,
  tasks: [
    { id: "b", status: "needs_diego", title: "Beta", updated_at: "2026-10-18T13:11:46.000Z" },
    { id: "a", status: "needs_diego", title: "Alpha", updated_at: "2026-10-18T13:11:46.000Z" }
  ]
});
assert.equal(tie.task.id, "a");

const queued = currentDesk({
  now,
  tasks: [{ id: "q", status: "queued", title: "Weekly client reports", updated_at: "2026-10-18T13:11:46.000Z" }]
});
assert.equal(queued.chip, "queued");
assert.equal(queued.more, 0);
assert.equal(queued.short, "Weekly client reports");

const activity = currentDesk({
  now,
  tasks: [{ id: "old", status: "done", title: "Already done", updated_at: "2026-10-19T07:00:00.000Z" }],
  activity: [
    { detail: "older note", created_at: "2026-10-19T04:00:00.000Z" },
    { detail: "Issued an API key (rfhq_abc123def).", created_at: "2026-10-19T06:00:00.000Z" }
  ],
  schedules: [{ enabled: false, next_run: "2026-10-20T07:00:00.000Z" }]
});
assert.equal(activity.kind, "activity");
assert.equal(activity.task, null);
assert.equal(activity.chip, "");
assert.equal(scrubDesk("rfhq_abc"), "[key]");
assert.equal(activity.full, "Last: Issued an API key ([key]), 2h ago");

const idleRun = currentDesk({
  now,
  tasks: [],
  activity: [],
  schedules: [
    { enabled: false, next_run: "2026-10-19T09:00:00.000Z" },
    { enabled: true, next_run: "2026-10-20T07:00:00.000Z" }
  ]
});
assert.equal(idleRun.kind, "idle");
assert.match(idleRun.full, /^Idle · next /);
assert.match(idleRun.full, /09:00/);

const idle = currentDesk({ now, tasks: [], activity: [], schedules: [] });
assert.equal(idle.full, "Idle");
assert.equal(idle.short, "Idle");

assert.equal(clip("short", 60), "short");
assert.equal(clip("x".repeat(80), 60).length, 60);

console.log("desk ok");
