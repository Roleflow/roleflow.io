import assert from "node:assert/strict";
import fs from "node:fs";
import { roleflowSections, sectionBucket } from "../acquire/setter-sections.js";

const legacy = {
  objective: "You qualify this offer.",
  personality: "Short lines.",
  guardrails: "Do not invent a price.",
  notes: "The offer is a strategy session.",
  workflow: "Ask one question.",
  qualification_rules: "Budget, timeline, decision maker.",
  booking_logic: "Send the booking link after they qualify."
};

const shaped = roleflowSections(legacy);
assert.equal(shaped.role, "You qualify this offer.");
assert.equal(shaped.non_negotiables, "Short lines.");
assert.equal(shaped.guardrails, "Do not invent a price.");
assert.equal(shaped.knowledge, "The offer is a strategy session.");
assert.match(shaped.workflow, /Ask one question/);
assert.match(shaped.workflow, /Budget, timeline/);
assert.match(shaped.workflow, /booking link/);
assert.equal(shaped.exclusion, "");
assert.equal(Object.keys(shaped).join(","), "exclusion,non_negotiables,role,guardrails,knowledge,workflow,objections");

const kept = roleflowSections({
  exclusion: "Stop when they say stop.",
  role: "Setter for this business.",
  objective: "Do not replace the role."
});
assert.equal(kept.exclusion, "Stop when they say stop.");
assert.match(kept.role, /Setter for this business/);
assert.match(kept.role, /Do not replace the role/);

const nodes = roleflowSections([
  { node: "Highest Priority Rule", instruction: "Check the sheet before you reply." },
  { node: "The Role", instruction: "You book strategy sessions." },
  { node: "Route Templates", instruction: "Use the owner's routes." }
]);
assert.match(nodes.exclusion, /Check the sheet/);
assert.match(nodes.role, /strategy sessions/);
assert.match(nodes.workflow, /owner's routes/);
assert.equal(sectionBucket("Style, Format and Tone"), "non_negotiables");
assert.doesNotMatch(JSON.stringify(nodes), /10%|Roleflow takes/);

const app = fs.readFileSync(new URL("../acquire/app.js", import.meta.url), "utf8");
assert.match(app, /tailortalk_agent_id/);
assert.match(app, /roleflowSections/);
assert.doesNotMatch(app, /step !== "live" && !location.hash/);

const sql = fs.readFileSync(new URL("../supabase/migrations/20261028150000_uniform_panel.sql", import.meta.url), "utf8");
assert.match(sql, /acq_roleflow_sections/);
assert.match(sql, /onboarding_step = 'live'/);
assert.match(sql, /system_enabled = false/);
assert.doesNotMatch(sql, /drop table /i);

const crm = fs.readFileSync(new URL("../admin/crm.js", import.meta.url), "utf8");
assert.match(crm, /\/account\/acquisition\/\?business=/);

console.log("panel layout tests passed");
