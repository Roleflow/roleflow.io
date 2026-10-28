import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import {
  clampDmCap,
  dmModuleVisible,
  jitterMinutes,
  madridActive,
  openerSystem,
  openerText,
  planDm,
  sessionPaths,
  tooSimilar
} from "../acquire/auto-dm.js";
import { draftOpener } from "../workers/roleflow-dm/opener.mjs";

const noon = new Date("2026-06-15T10:00:00Z");
const night = new Date("2026-06-15T22:30:00Z");
assert.equal(madridActive(noon), true);
assert.equal(madridActive(night), false);

for (let i = 0; i < 20; i += 1) {
  const wait = jitterMinutes(() => i / 20);
  assert.ok(wait >= 5 && wait <= 30);
}
assert.equal(clampDmCap(""), 20);
assert.equal(clampDmCap(80), 50);
assert.equal(clampDmCap(0), 1);

const workspace = "1351d2ac-79bb-545d-8da0-c49ecff28a47";
const base = {
  workspaceId: workspace,
  enabled: true,
  killed: false,
  paused: false,
  handle: "coach",
  cap: 20,
  sentToday: 0,
  followedAt: "2026-06-15T08:00:00Z",
  draft: "saw your latest post about listings",
  profile: { name: "Ada", bio: "Real estate in Austin", category: "Agent", posts: ["New listing"] },
  now: noon,
  random: () => 0
};

assert.equal(planDm({ ...base, enabled: false }).reason, "off");
assert.equal(planDm({ ...base, killed: true }).reason, "killed");
assert.equal(planDm({ ...base, workspaceId: "" }).reason, "missing_workspace");
assert.equal(planDm({ ...base, paused: true }).reason, "paused");
assert.equal(planDm({ ...base, sentToday: 20 }).reason, "cap");
assert.equal(planDm({ ...base, now: night }).reason, "hours");
assert.equal(planDm({ ...base, alreadySent: true }).reason, "twice");
assert.equal(planDm({ ...base, exclusions: ["coach"] }).reason, "excluded");
assert.equal(planDm({ ...base, note: "please stop" }).reason, "stop");
assert.equal(planDm({ ...base, followedAt: noon.toISOString() }).reason, "waiting");
assert.equal(planDm({ ...base, profile: {} }).reason, "no_profile");
assert.equal(planDm({ ...base, recent: ["saw your latest post about listings"] }).reason, "similar");
assert.equal(tooSimilar("hello there friend", ["a different note about kitchens"]), false);

const ready = planDm(base);
assert.equal(ready.ok, true);
assert.equal(ready.body, "saw your latest post about listings");
assert.equal(ready.workspaceId, workspace);
assert.equal(openerText("our fee is $500 and 10% commission", () => 0).includes("$"), false);
assert.doesNotMatch(openerSystem({ prompt: "Ask one question.", playbook: "Offer: calls", voice: 20 }), /temperature/);

assert.equal(dmModuleVisible(), true);
assert.equal(sessionPaths("/sessions", workspace).file, "/sessions/" + workspace + ".bin");

const page = fs.readFileSync(new URL("../acquire/auto-dm-page.js", import.meta.url), "utf8");
assert.match(page, /Kill switch/);
assert.match(page, /Interruptor de parada/);
assert.doesNotMatch(page, /zernio|type="password"/i);
assert.match(fs.readFileSync(new URL("../supabase/migrations/20261028170000_dm_every_business.sql", import.meta.url), "utf8"), /enabled, killed, daily_cap/);
const deletion = fs.readFileSync(new URL("../supabase/migrations/20261028180000_delete_four_businesses.sql", import.meta.url), "utf8");
assert.match(deletion, /a01eb1d4-645d-4bd8-bcc5-538aca888eb6/);
assert.match(deletion, /refusing to delete Roleflow or Value Add Marketing/);

const worker = spawnSync(process.execPath, ["workers/roleflow-dm/run.mjs"], {
  env: { ...process.env, ROLEFLOW_DM_ENABLED: "1" },
  encoding: "utf8"
});
assert.match(worker.stdout, /missing_workspace/);

const recorded = [];
const drafted = await draftOpener({
  apiKey: "test-key",
  profile: base.profile,
  prompt: "Ask one question.",
  playbook: "Offer: calls",
  voice: 40,
  fetchImpl: async (_url, init) => {
    recorded.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ content: [{ text: "hey ada, the austin listing stood out" }] }) };
  }
});
assert.equal(drafted.ok, true);
assert.equal(recorded[0].model, "claude-sonnet-5-5");
assert.equal(Object.prototype.hasOwnProperty.call(recorded[0], "temperature"), false);

console.log("auto dm tests passed");
