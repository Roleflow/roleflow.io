import assert from "node:assert/strict";
import fs from "node:fs";
import { businessSync, SYNC_LIVE, SYNC_READY, SYNC_SETUP, SYNCING } from "../acquire/sync-state.js";
import { SETTER_SECTION_DEFS } from "../acquire/setter-sections.js";
import { buildSyncNotice, resolveResendConfig, shouldClaim } from "../supabase/functions/_shared/sync-notice.js";
import { headedSections, SECTION_HEADINGS, withHeading } from "../supabase/functions/_shared/prompt-headings.js";

const read = (file) => fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
const live = "840b08a9-869c-4650-8dc7-f78fdfa0e112";

assert.deepEqual(
  SECTION_HEADINGS.map((row) => row[1]),
  SETTER_SECTION_DEFS.map((section) => "# " + section.title)
);
const headed = headedSections({ exclusion: "Do not contact them.", role: "The job." });
assert.equal(headed.exclusion.split("\n")[0], "# Highest Priority Rule (Exclusion)");
assert.equal(withHeading("role", "# The Role\n\nAlready headed."), "# The Role\n\nAlready headed.");
assert.match(headed.workflow, /^# Workflow Logic\n/);

const now = Date.parse("2026-10-23T12:00:00Z");
assert.equal(shouldClaim([{ created_at: "2026-10-23T11:59:30Z" }], now), false);
assert.equal(shouldClaim([
  { created_at: "2026-10-23T11:58:00Z" },
  { created_at: "2026-10-23T11:58:30Z" }
], now), true);

const mail = buildSyncNotice([
  {
    id: "11111111-1111-4111-8111-111111111111",
    op: "update_workflow",
    workspace_id: "22222222-2222-4222-8222-222222222222",
    business_name: "North",
    payload: { workflow_text: "SECRET PROMPT", api_key: "sk-secret" }
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    kind: "deploy",
    business_id: "22222222-2222-4222-8222-222222222222",
    business_name: "North"
  }
]);
assert.equal(mail.subject, "Roleflow sync: update_workflow North");
assert.equal(mail.to, "roleflow+sync@mail.grokbot.com");
assert.equal(
  mail.text,
  "11111111-1111-4111-8111-111111111111 update_workflow 22222222-2222-4222-8222-222222222222\n33333333-3333-4333-8333-333333333333 deploy 22222222-2222-4222-8222-222222222222"
);
assert.doesNotMatch(mail.subject + "\n" + mail.text, /SECRET|sk-secret|workflow_text|api_key/i);
assert.deepEqual(
  resolveResendConfig({ apiKey: "env-key", from: "Env <a@roleflow.io>" }, { api_key: "db-key", from: "Db <a@roleflow.io>" }),
  { apiKey: "env-key", from: "Env <a@roleflow.io>" }
);
assert.equal(resolveResendConfig({ apiKey: "", from: "" }, { api_key: "db-key", from: "Db <a@roleflow.io>" }).apiKey, "db-key");
assert.equal(resolveResendConfig({ apiKey: "", from: "" }, { api_key: "db-key", from: "Db <a@roleflow.io>" }).from, "Db <a@roleflow.io>");
assert.equal(resolveResendConfig({}, {}).from, "Roleflow <notifications@roleflow.io>");

const pendingCreate = [{ kind: "create_agent", status: "pending", created_at: "2026-10-23T11:00:00Z" }];
assert.equal(businessSync({ outbox: pendingCreate, igStatus: "connected", systemEnabled: true }).label, SYNC_SETUP);
assert.equal(businessSync({
  outbox: [{ kind: "create_agent", status: "failed", error: "Missing calendar", created_at: "2026-10-23T11:00:00Z" }]
}).label, "Missing calendar");
assert.equal(businessSync({
  outbox: [{ kind: "update_workflow", status: "pending", created_at: "2026-10-23T11:00:00Z" }],
  igStatus: "connected",
  systemEnabled: true,
  externalAgentId: "agent"
}).label, SYNCING);
assert.equal(businessSync({
  outbox: [{ kind: "deploy", status: "failed", error: "Deploy was rejected", created_at: "2026-10-23T11:00:00Z" }],
  igStatus: "connected",
  systemEnabled: true,
  externalAgentId: "agent"
}).label, "Deploy was rejected");
assert.equal(businessSync({
  outbox: [],
  igStatus: "connected",
  systemEnabled: true,
  externalAgentId: "eujfwcrm"
}).label, SYNC_LIVE);
assert.equal(businessSync({
  outbox: [{ kind: "create_agent", status: "done", created_at: "2026-10-23T11:00:00Z" }],
  igStatus: "disconnected",
  systemEnabled: false,
  externalAgentId: "agent-1"
}).label, SYNC_READY);
assert.equal(businessSync({ outbox: [], igStatus: "disconnected", systemEnabled: false }).label, SYNC_SETUP);
assert.equal(businessSync({ previewSync: "failed", previewError: "The workflow was rejected." }).label, "The workflow was rejected.");

const sql = read("supabase/migrations/20261023080000_engine_sync_notice.sql");
["result_agent_id", "notified_at", "'done'", "create_agent", "update_tool", "resume_agent", "connect_instagram", "acq_engine_outbox_settle", "acq_engine_outbox_pending", "acq_claim_sync_notice", "followup_settings", "workflow_text", "personality", "version_id"].forEach((needle) => {
  assert.match(sql, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
assert.doesNotMatch(sql, /studio_setter_sync = true/);
assert.doesNotMatch(sql, new RegExp(live));
assert.match(sql, /# Highest Priority Rule \(Exclusion\)/);

const creator = read("supabase/functions/roleflow-add-business/index.ts");
assert.match(creator, /acq_enqueue_create_agent/);
assert.match(creator, /headedSections/);
assert.match(creator, /SECTION_HEADINGS/);
assert.doesNotMatch(creator, /tailor\s*talk|tailortalk\.ai/i);

const worker = read("supabase/functions/roleflow-setter-sync/index.ts");
assert.match(worker, /sweepSyncNotices/);
assert.match(worker, /deliverPending/);
assert.doesNotMatch(worker, /from "\.\/deliver\.js"/);
assert.doesNotMatch(worker, /status:\s*"applied"/);
assert.doesNotMatch(worker, /send_message/);

const engine = read("supabase/functions/setter-engine/index.ts");
assert.match(engine, /acq_engine_outbox_settle/);
assert.match(engine, /status must be done or failed/);
assert.match(engine, /outbox_list/);

const resendSql = read("supabase/migrations/20261023090000_resend_settings.sql");
assert.match(resendSql, /acq_read_resend_settings/);
assert.match(resendSql, /resend_api_key/);
assert.match(resendSql, /resend_from/);
assert.match(resendSql, /service_role/);
assert.doesNotMatch(resendSql, /re_[A-Za-z0-9]/);
assert.match(read("supabase/functions/_shared/sync-notice.js"), /acq_read_resend_settings/);
assert.match(worker, /loadResendConfig/);
assert.match(creator, /RESEND_FROM/);

const hooks = read("supabase/functions/roleflow-hooks/index.ts");
assert.match(hooks, /notify_sync/);
assert.match(hooks, /sync_test/);
assert.match(hooks, /loadResendConfig/);
assert.doesNotMatch(hooks, /mail\.grokbot\.com/);
assert.doesNotMatch(hooks, /console\.(log|info|debug)/);

["acquire/app.js", "acquire/home.js", "acquire/setter-workflow.js", "acquire/add-business.js", "acquire/sync-state.js", "acquire/connect-instagram.js", "acquire/engine-ui.js"].forEach((file) => {
  const text = read(file);
  assert.doesNotMatch(text, /mail\.grokbot\.com|tailor\s*talk|tailortalk\.ai/i, file);
});
assert.match(read("acquire/app.js"), /resume_agent/);
assert.match(read("acquire/app.js"), /pause_agent/);
assert.match(read("acquire/sync-state.js"), /Setting up your AI setter…/);
assert.match(read("acquire/sync-state.js"), /Setter ready/);
assert.match(read("acquire/connect-instagram.js"), /notify_sync/);

console.log("engine sync notice tests passed");
