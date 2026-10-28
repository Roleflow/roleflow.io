import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import {
  clampDmCap,
  dmModuleVisible,
  jitterMinutes,
  madridActive,
  openerText,
  planDm
} from "../acquire/auto-dm.js";

const noon = new Date("2026-06-15T10:00:00Z");
const night = new Date("2026-06-15T22:30:00Z");
assert.equal(madridActive(noon), true);
assert.equal(madridActive(night), false);

for (let i = 0; i < 20; i += 1) {
  const wait = jitterMinutes(() => i / 20);
  assert.ok(wait >= 30 && wait <= 240);
}
assert.equal(clampDmCap(""), 20);
assert.equal(clampDmCap(80), 50);
assert.equal(clampDmCap(0), 1);

const base = {
  account: "roleflow.io",
  enabled: true,
  killed: false,
  paused: false,
  handle: "coach",
  cap: 20,
  sentToday: 0,
  followedAt: "2026-06-15T08:00:00Z",
  template: "{hi|hey} there",
  now: noon,
  random: () => 0
};

assert.equal(planDm({ ...base, enabled: false }).reason, "off");
assert.equal(planDm({ ...base, killed: true }).reason, "killed");
assert.equal(planDm({ ...base, account: "other" }).reason, "not_roleflow");
assert.equal(planDm({ ...base, paused: true }).reason, "paused");
assert.equal(planDm({ ...base, sentToday: 20 }).reason, "cap");
assert.equal(planDm({ ...base, now: night }).reason, "hours");
assert.equal(planDm({ ...base, alreadySent: true }).reason, "twice");
assert.equal(planDm({ ...base, exclusions: ["coach"] }).reason, "excluded");
assert.equal(planDm({ ...base, note: "please stop" }).reason, "stop");
assert.equal(planDm({ ...base, followedAt: noon.toISOString() }).reason, "waiting");

const ready = planDm(base);
assert.equal(ready.ok, true);
assert.equal(ready.body, "hi there");
assert.equal(openerText("our fee is $500 and 10% commission {today|now}", () => 0).includes("$"), false);
assert.equal(/commission|10%|\$/.test(openerText("fee $500 and 10% commission", () => 0)), false);

assert.equal(dmModuleVisible({ businesses: [{ id: "a", agent_name: "Roleflow" }], businessId: "a" }), true);
assert.equal(dmModuleVisible({ ig: { username: "valueaddmarketing" }, businesses: [{ id: "b", agent_name: "Value Add Marketing" }], businessId: "b" }), false);

const page = fs.readFileSync(new URL("../acquire/auto-dm-page.js", import.meta.url), "utf8");
assert.match(page, /Kill switch/);
assert.match(page, /Interruptor de parada/);
assert.doesNotMatch(page, /zernio|password input|type="password"/i);
assert.match(fs.readFileSync(new URL("../supabase/migrations/20261028160000_roleflow_auto_dm.sql", import.meta.url), "utf8"), /enabled boolean not null default false/);
assert.doesNotMatch(fs.readFileSync(new URL("../supabase/migrations/20261028160000_roleflow_auto_dm.sql", import.meta.url), "utf8"), /password\s+(text|bytea)/i);

const worker = spawnSync(process.execPath, ["workers/roleflow-dm/run.mjs", "coach"], {
  env: { ...process.env, ROLEFLOW_DM_ACCOUNT: "other", ROLEFLOW_DM_ENABLED: "1" },
  encoding: "utf8"
});
assert.match(worker.stdout, /not_roleflow/);

console.log("auto dm tests passed");
