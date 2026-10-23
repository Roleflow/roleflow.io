import assert from "node:assert/strict";
import fs from "node:fs";
import { mapLivePrompt, missingSource, SETTER_SECTION_DEFS } from "../acquire/setter-sections.js";
import { deliveryRequest, settleDelivery } from "../supabase/functions/roleflow-setter-sync/deliver.js";

const read = (file) => fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
const payload = JSON.parse(read("test/fixtures/eujfwcrm_live_prompt.json"));
const sections = mapLivePrompt(payload);

assert.deepEqual(SETTER_SECTION_DEFS.map((section) => section.title), [
  "Highest Priority Rule (Exclusion)",
  "Non-Negotiables",
  "The Role",
  "The Guardrails",
  "Context and Knowledge",
  "Workflow Logic",
  "Objection Handling"
]);
assert.deepEqual(missingSource(payload, sections), []);
assert.match(sections.exclusion, /\*\*Step 0\./);
assert.match(sections.exclusion, /Exclusion/);
assert.match(sections.objections, /FAQ answers/);
assert.match(sections.workflow, /Comment-to-DM Logic|Path A/);

const workflow = read("acquire/setter-workflow.js");
assert.match(workflow, /Saved, syncing/);
assert.match(workflow, /Nothing is sent to a lead/);
assert.match(workflow, /Add tool/);
assert.match(workflow, /send voice note/);
assert.match(workflow, /acq_save_inbound_prompt/);
assert.match(workflow, /acq_save_agent_tool/);
assert.doesNotMatch(workflow, /node graph|react-flow/i);

const add = read("acquire/add-business.js");
assert.match(add, /Business name/);
assert.match(add, /Instagram handle/);
assert.match(add, /Offer and price/);
assert.match(add, /Ideal client/);
assert.match(add, /Qualification criteria/);
assert.match(add, /Objections/);
assert.match(add, /Exclusions/);
assert.match(add, /Booking link/);
assert.match(add, /roleflow-add-business/);
assert.match(add, /editor=1#inbound/);
assert.doesNotMatch(add, /\/pricing/);

const sql = read("supabase/migrations/20261023070000_setter_studio.sql");
assert.match(sql, /840b08a9-869c-4650-8dc7-f78fdfa0e112/);
assert.match(sql, /inbound_manager/);
assert.match(sql, /update_workflow/);
assert.match(sql, /'deploy'/);
assert.match(sql, /create_tool/);
assert.match(sql, /\*\*Step 0\./);
assert.match(sql, /"exclusion"/);
assert.doesNotMatch(sql, /studio_setter_sync = true/);
assert.doesNotMatch(sql, /engine_outbox[\s\S]{0,200}840b08a9/);
assert.match(sql, /status = 'paused'/);
assert.match(sql, /where agent_id = v_id/);

const worker = read("supabase/functions/roleflow-setter-sync/index.ts");
assert.match(worker, /deliverPending/);
assert.match(worker, /action === "deliver"/);
assert.doesNotMatch(worker, /send_message/);
assert.equal(settleDelivery(200), "applied");
assert.equal(settleDelivery(404), "pending");
assert.equal(settleDelivery(500), "pending");
const voice = deliveryRequest({
  kind: "create_tool",
  external_agent_id: "eujfwcrm",
  payload: { name: "Gap building", kind: "media", media_type: "voice", config: { media_type: "voice" } }
});
assert.equal(voice.body.tool_type, "media");
assert.equal(voice.body.media_type, "voice");
assert.equal(voice.body.agent_id, "eujfwcrm");
const draft = deliveryRequest({ kind: "update_workflow", external_agent_id: "eujfwcrm", payload: { role: "inbound_manager" } });
assert.match(draft.url, /update_workflow$/);
const deploy = deliveryRequest({ kind: "deploy", external_agent_id: "eujfwcrm", payload: {} });
assert.match(deploy.url, /deploy$/);

const creator = read("supabase/functions/roleflow-add-business/index.ts");
assert.match(creator, /acq_create_onboarding_workspace/);
assert.match(creator, /api\.x\.ai/);
assert.doesNotMatch(creator, /\/pricing/);
assert.match(read("admin/acquisition-admin.js"), /add-business/);
assert.match(read("admin/acquisition-admin.js"), /id: "add-business"/);
assert.match(read("acquire/office.js"), /renderSetterStudio/);

console.log("setter studio tests passed");
