import assert from "node:assert/strict";
import { standupPhase, standupReplay } from "./standup.mjs";

function at(iso) {
  return standupPhase(new Date(iso));
}

assert.equal(at("2026-10-16T05:59:00Z").mode, "desk");
assert.equal(at("2026-10-16T05:59:00Z").playing, false);

const start = at("2026-10-16T06:00:00Z");
assert.equal(start.mode, "to");
assert.equal(start.t, 0);

const midWalk = at("2026-10-16T06:01:30Z");
assert.equal(midWalk.mode, "to");
assert.ok(Math.abs(midWalk.t - 0.5) < 0.02, midWalk.t);

assert.equal(at("2026-10-16T06:02:59Z").mode, "to");
assert.equal(at("2026-10-16T06:03:00Z").mode, "meet");
assert.equal(at("2026-10-16T06:11:59Z").mode, "meet");
assert.equal(at("2026-10-16T06:12:00Z").mode, "back");
assert.equal(at("2026-10-16T06:14:59Z").mode, "back");
assert.equal(at("2026-10-16T06:15:00Z").mode, "desk");

const winter = at("2026-11-01T07:00:00Z");
assert.equal(winter.mode, "to");
assert.equal(winter.t, 0);
assert.equal(at("2026-11-01T06:59:00Z").mode, "desk");

assert.equal(standupReplay(0).mode, "to");
assert.equal(standupReplay(0).t, 0);
assert.equal(standupReplay(16).mode, "to");
assert.equal(standupReplay(8).mode, "meet");
assert.equal(standupReplay(15.9).mode, "back");

console.log("standup ok");
