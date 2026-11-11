import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  activateTrial,
  blankTrial,
  trialBelongsTo,
  trialIsLive
} from "../acquire/trial-thread.js";
import { ensureSimulations } from "../acquire/setter-workspace.js";

const ROLEFLOW = "840b08a9-869c-4650-8dc7-f78fdfa0e112";
const VAM = "1351d2ac-79bb-545d-8da0-c49ecff28a47";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const roleflowTrial = blankTrial(ROLEFLOW, {
  messages: [{ role: "user", text: "how much is it?" }, { role: "assistant", text: "I can walk you through a demo." }],
  leadState: "qualifying",
  epoch: 4
});

assert.equal(trialBelongsTo(roleflowTrial, ROLEFLOW), true);
assert.equal(trialBelongsTo(roleflowTrial, VAM), false);
assert.equal(trialBelongsTo({ messages: [{ role: "user", text: "stale" }] }, VAM), false);
assert.equal(trialBelongsTo(roleflowTrial, ""), false);
assert.equal(trialIsLive(roleflowTrial, ROLEFLOW, 4), true);
assert.equal(trialIsLive(roleflowTrial, ROLEFLOW, 5), false);
assert.equal(trialIsLive(roleflowTrial, VAM, 4), false);

// Switching to another business parks the current thread and starts a fresh one.
const switched = activateTrial(VAM, roleflowTrial, {});
assert.equal(trialBelongsTo(switched.trial, VAM), true);
assert.deepEqual(switched.trial.messages, []);
assert.equal(switched.trial.epoch, 5);
assert.equal(roleflowTrial.epoch, 5);
assert.equal(trialIsLive(roleflowTrial, ROLEFLOW, 4), false);
assert.equal(switched.store[ROLEFLOW], roleflowTrial);
assert.equal(Object.prototype.hasOwnProperty.call(switched.store, VAM), false);

// A late reply from the previous business must not be treated as live on the new one.
assert.equal(trialIsLive(roleflowTrial, VAM, roleflowTrial.epoch), false);
assert.equal(switched.trial === roleflowTrial, false);

// Switching back restores the parked Roleflow thread, not VAM's bubbles.
switched.trial.messages = [{ role: "user", text: "I coach agents in Miami" }];
const back = activateTrial(ROLEFLOW, switched.trial, switched.store);
assert.equal(back.trial, roleflowTrial);
assert.equal(trialBelongsTo(back.trial, ROLEFLOW), true);
assert.equal(back.trial.messages[0].text, "how much is it?");
assert.equal(back.store[VAM].messages[0].text, "I coach agents in Miami");
assert.equal(Object.prototype.hasOwnProperty.call(back.store, ROLEFLOW), false);

// A quiet refresh of the same business keeps the thread and does not bump the epoch.
const same = activateTrial(ROLEFLOW, back.trial, back.store);
assert.equal(same.trial, back.trial);
assert.equal(same.trial.epoch, back.trial.epoch);
assert.equal(trialIsLive(same.trial, ROLEFLOW, same.trial.epoch), true);

// An unscoped leftover thread is dropped, not shown on the next business.
const leftover = { scenario: "follower", messages: [{ role: "user", text: "roleflow leftover" }], epoch: 2 };
const cleaned = activateTrial(VAM, leftover, {});
assert.equal(trialBelongsTo(cleaned.trial, VAM), true);
assert.deepEqual(cleaned.trial.messages, []);
assert.equal(leftover.epoch, 3);
assert.equal(Object.prototype.hasOwnProperty.call(cleaned.store, ""), false);

const loaded = ensureSimulations({
  businessId: VAM,
  simConversations: [{ title: "Roleflow practice", messages: [{ text: "leftover" }] }],
  simConversationsWorkspaceId: ROLEFLOW
});
assert.deepEqual(loaded, []);

const kept = [{ title: "VAM practice", messages: [{ text: "I am a realtor" }] }];
assert.equal(ensureSimulations({
  businessId: VAM,
  simConversations: kept,
  simConversationsWorkspaceId: VAM
}), kept);

const app = read("acquire/app.js");
const bootAt = app.indexOf("async function bootBusiness");
const boot = app.slice(bootAt, app.indexOf("let editorArmed"));
assert.ok(bootAt < app.indexOf("await state.supabase.from(\"acq_members\")"));
assert.ok(boot.indexOf("activateTrial(") < boot.indexOf("await"));
assert.ok(boot.indexOf("Loading this business") < boot.indexOf("await"));
assert.match(boot, /state\.setterTrial = activated\.trial/);
assert.match(boot, /hideBoot\(\)/);
assert.match(boot, /catch \(error\)/);

const sendAt = app.indexOf("async function sendTrial");
const send = app.slice(sendAt, app.indexOf("function commentWhenForTrial"));
assert.match(send, /trialIsLive\(trial, state\.businessId, epoch\)/);
assert.match(app, /if \(state\.businessId !== workspaceId\) return \{ ok: false, reason: "stale" \}/);
assert.match(app, /workspaceId: selected/);

const workspace = read("acquire/setter-workspace.js");
assert.match(workspace, /if \(state\.setterDesk\) stopTrialRecorder\(state\.setterDesk, true\)/);
assert.match(workspace, /state\.simConversationsWorkspaceId === id/);
assert.match(workspace, /blankTrial\(ui\.state\.businessId/);
assert.match(workspace, /trialBelongsTo\(ui\.state\.setterTrial, ui\.state\.businessId\)/);
assert.match(workspace, /const workspaceId = ui\.state\.businessId/);
assert.match(workspace, /if \(stale\(\)\)/);

console.log("trial workspace tests passed");
