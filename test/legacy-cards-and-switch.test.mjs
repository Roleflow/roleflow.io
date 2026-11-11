import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { legacyBoardAgents } from "../businesses/model.js";
import { businessReady, businessSwitching, endBusinessSwitch, markBusinessLoaded, startBusinessSwitch } from "../acquire/prompt-scope.js";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const between = (text, start, end) => {
  const from = text.indexOf(start);
  assert.ok(from >= 0, "missing " + start);
  const to = text.indexOf(end, from + start.length);
  return text.slice(from, to < 0 ? undefined : to);
};

test("a panel business is not shown again as its old setter-cache card", () => {
  // Same shape as live: Roleflow runs on "Roleflow Acquisition", Value Add
  // Marketing on "VAM", Caleb Wat has no engine business.
  const workspaces = [
    { id: "w-caleb", name: "Caleb Wat", engine_business_id: null },
    { id: "w-roleflow", name: "Roleflow", engine_business_id: "a-roleflow" },
    { id: "w-vam", name: "Value Add Marketing", engine_business_id: "a-vam" }
  ];
  const agents = [
    { id: "a-roleflow", agent_name: "Roleflow Acquisition" },
    { id: "a-vam", agent_name: "VAM" }
  ];
  const legacy = legacyBoardAgents(agents, workspaces);
  assert.deepEqual(legacy, [], "both old cards are hidden");
  assert.equal(workspaces.length + legacy.length, 3, "three cards in total, not five");
  const other = { id: "a-other", agent_name: "Unlinked client" };
  assert.deepEqual(legacyBoardAgents(agents.concat([other]), workspaces), [other], "a setter-cache business with no panel business still shows");
  assert.deepEqual(legacyBoardAgents(agents, []), agents, "nothing is hidden when no panel business is visible");
  assert.deepEqual(legacyBoardAgents(null, null), []);
});

test("the businesses page reads the engine link and filters the old board", () => {
  const page = read("businesses/app.js");
  assert.match(page, /from\("acq_workspaces"\)\.select\("id, name, owner_id, created_at, engine_business_id"\)/);
  assert.match(page, /paintGrid\(supabase, user, legacyBoardAgents\(agents, panelWorkspaces\),/);
  assert.match(page, /paintDetail\(supabase, user, agents,/, "detail pages still open any business by id");
});

test("business switch state: saves wait until the new business has loaded", () => {
  const state = { supabase: {}, businessId: "a" };
  markBusinessLoaded(state, "a");
  assert.equal(businessReady(state), true);
  startBusinessSwitch(state, "b");
  state.businessId = "b";
  assert.equal(businessReady(state), false, "mid-switch nothing saves");
  assert.equal(businessSwitching(state), true, "mid-switch the loading screen shows");
  markBusinessLoaded(state, "b");
  assert.equal(businessReady(state), true);
  assert.equal(businessSwitching(state), false);
  // A failed switch hides the loading screen but keeps saves off.
  startBusinessSwitch(state, "c");
  state.businessId = "c";
  endBusinessSwitch(state, "c");
  assert.equal(businessSwitching(state), false);
  assert.equal(businessReady(state), false);
  // A replaced switch does not clear the newer one.
  startBusinessSwitch(state, "d");
  state.businessId = "d";
  endBusinessSwitch(state, "c");
  assert.equal(businessSwitching(state), true);
  assert.equal(businessReady({ supabase: null }), true, "local preview always saves locally");
  assert.equal(businessReady(null), false);
});

test("the panel guards the switch", () => {
  const app = read("acquire/app.js");
  const boot = between(app, "async function bootBusiness(", "\nlet editorArmed");
  assert.ok(boot.indexOf("startBusinessSwitch(state, id)") < boot.indexOf("state.businessId = id;"), "switch starts before the id changes");
  assert.ok(boot.indexOf("paintBusinessName();") > boot.indexOf("state.businessId = id;"), "header shows the new name right away");
  const tester = boot.slice(boot.indexOf("const opened = await loadTester(id);"));
  assert.ok(tester.indexOf("markBusinessLoaded(state, id);") < tester.indexOf("paint();"), "tester path marks loaded before painting");
  const loaded = boot.slice(boot.indexOf("if (loaded) {"));
  assert.ok(loaded.indexOf("markBusinessLoaded(state, id);") < loaded.indexOf("paint();"), "owner path marks loaded before painting");
  assert.match(boot, /finally \{\n    if \(token === bootToken\) endBusinessSwitch\(state, id\);/);
  const paint = between(app, "function paint() {", "\n}\n");
  assert.ok(paint.indexOf("businessSwitching(state)") < paint.indexOf("paintTester()"), "paint shows the loading screen first");
  for (const fn of ["async function patchSettings(", "async function saveAgent(", "async function saveBrief(", "async function setAgent("]) {
    const body = between(app, fn, "\n}\n");
    assert.match(body.split("\n").slice(0, 4).join("\n"), /if \(waitForBusiness\(\)\) return;/, fn + " waits for the business");
  }
  assert.match(app, /businessReady: \(\) => businessReady\(state\),/);
  const name = between(app, "function paintBusinessName() {", "\n}\n");
  assert.match(name, /panel-biz-name/);
  assert.match(name, /sub\.textContent = name/);
});

test("simulator and settings controls are locked until the business loads", () => {
  const desk = read("acquire/setter-workspace.js");
  assert.match(desk, /lockUntilLoaded\(ui, ghost\(ui, copy\.saveDelay,/);
  assert.match(desk, /lockUntilLoaded\(ui, ghost\(ui, copy\.save, \(\) => ui\.saveReplySplit\(split\.value\)\)\)/, "the simulator Save is locked");
  assert.match(desk, /lockUntilLoaded\(ui, saveAgent\);/);
  assert.match(desk, /lockUntilLoaded\(ui, toggle\);/);
  assert.match(desk, /lockUntilLoaded\(ui, input\);/, "voice slider");
  assert.match(desk, /if \(!businessIsReady\(ui\)\) return;\n    const nextOn = toggle\.checked;/);
  assert.match(desk, /const ready = prompts \? promptIsReady\(ui\) : businessIsReady\(ui\);/);
});
