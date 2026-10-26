import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const statsSource = read("supabase/functions/tailortalk-sync/stats.js");
const { computeStats } = await import("data:text/javascript," + encodeURIComponent(statsSource));

const now = new Date("2026-10-14T15:00:00.000Z");
const stats = computeStats([
  { lead_status: " Hot ", source: "instagram_dm", is_converted: true, last_message_time: "2026-10-14T01:00:00Z", joined: "2026-10-14T01:00:00Z" },
  { lead_status: "warm", lead_source: "whatsapp_dm", is_converted: false, last_message_time: "2026-10-13T01:00:00Z", joined: "2026-10-01T00:00:00Z" },
  { lead_status: "cold", source: "  ", is_converted: "true", last_message_time: "2026-09-01T00:00:00Z", joined: "2026-09-01T00:00:00Z" },
  { lead_status: "", is_converted: false, joined_at: "2026-10-14T23:00:00Z" }
], now);

assert.equal(stats.total_leads, 4);
assert.deepEqual(stats.by_status, { hot: 1, warm: 1, cold: 1 });
assert.deepEqual(stats.by_source, { instagram_dm: 1, whatsapp_dm: 1 });
assert.equal(stats.converted_count, 1);
assert.equal(stats.conversion_rate, 0.25);
assert.deepEqual(stats.by_category, {});
assert.equal(stats.last_activity_at, "2026-10-14T01:00:00.000Z");
assert.equal(stats.leads_per_day.length, 30);
assert.equal(stats.leads_per_day[0].day, "2026-09-15");
assert.equal(stats.leads_per_day.at(-1).day, "2026-10-14");
assert.equal(stats.leads_per_day.at(-1).count, 1);
assert.equal(stats.leads_per_day.find((item) => item.day === "2026-10-13").count, 1);
assert.equal(stats.leads_per_day.find((item) => item.day === "2026-10-01").count, 0);
assert.equal(stats.leads_per_day.filter((item) => item.day < "2026-10-01").every((item) => item.count === 0), true);
assert.equal("message_count" in stats, false);
assert.match(statsSource, /last_message_time/);
assert.doesNotMatch(statsSource, /joined/);

const leadSource = read("supabase/functions/tailortalk-sync/lead.js");
const { usernameOf } = await import("data:text/javascript," + encodeURIComponent(leadSource));
assert.equal(usernameOf({ integration: "instagram", lead_contact: "@maya.lead" }), "maya.lead");
assert.equal(usernameOf({ integration: "Instagram", lead_contact: "handle" }), "handle");
assert.equal(usernameOf({ integration: "instagram", lead_contact: "12maya" }), "12maya");
assert.equal(usernameOf({ integration: "instagram", lead_contact: "555****12" }), null);
assert.equal(usernameOf({ integration: "whatsapp", lead_contact: "+15551212" }), null);
assert.equal(usernameOf({ integration: "instagram", username: "@kept", lead_contact: "other" }), "kept");
assert.equal(usernameOf({ integration: "web", lead_contact: "visitor" }), null);
assert.equal(usernameOf({ integration: "instagram", username: "ada.coach", lead_contact: null }), "ada.coach");
assert.equal(usernameOf({ integration: "instagram", lead_contact: "178414058221234" }), null);
assert.match(leadSource, /often null/);

const empty = computeStats([], now);
assert.equal(empty.conversion_rate, null);
assert.equal(empty.total_leads, 0);
assert.equal(empty.leads_per_day.length, 30);
assert.equal(empty.last_activity_at, null);

const migration = read("supabase/migrations/20261014160000_tailortalk_crm.sql");
assert.match(migration, /private\.tailortalk_agent_secrets/);
assert.match(migration, /revoke all on table private\.tailortalk_agent_secrets from public, anon, authenticated/);
assert.match(migration, /using \(public\.is_admin\(\)\)/);
assert.match(migration, /tailortalk-sync-hourly/);
assert.match(migration, /'0 \* \* \* \*'/);
assert.match(migration, /https:\/\/xrsipofgofvjiskmsgij\.supabase\.co\/functions\/v1\/tailortalk-sync/);
assert.match(migration, /revoke all on function public\.tailortalk_put_secret\(uuid, text\) from public, anon, authenticated/);
assert.match(migration, /revoke all on function public\.tailortalk_read_secret\(uuid\) from public, anon, authenticated/);
assert.match(migration, /grant execute on function public\.tailortalk_put_secret\(uuid, text\) to service_role/);
const agentsTable = migration.match(/create table if not exists public\.tailortalk_agents \([\s\S]*?\);/);
assert.ok(agentsTable, "agents table missing");
assert.doesNotMatch(agentsTable[0], /token/i);

const fn = read("supabase/functions/tailortalk-sync/index.ts");
assert.match(fn, /https:\/\/api\.tailortalk\.ai\/api\/v1\/get_leads/);
assert.match(fn, /https:\/\/api\.tailortalk\.ai\/api\/v1\/get_contacts/);
assert.match(fn, /https:\/\/api\.tailortalk\.ai\/api\/v1\/mark_converted/);
assert.doesNotMatch(fn, /send_whatsapp_template_message|get_whatsapp_templates|campaign_logs/);
assert.match(fn, /action === "mark_booked"/);
assert.match(fn, /The cron job can only sync/);
assert.doesNotMatch(fn, /update_leads|message_lead|deploy_workflow/);
assert.match(fn, /Authorization: "Agent " \+ token/);
assert.match(fn, /method: "POST"/);
assert.match(fn, /JSON\.stringify\(payload\)/);
assert.match(fn, /TAILORTALK_TOKEN_KEY/);
assert.match(fn, /TAILORTALK_CRON_SECRET/);
assert.match(fn, /eq\("archived", false\)/);
assert.match(fn, /client_id: clientId/);
assert.match(fn, /username: usernameOf\(lead\)/);
assert.match(fn, /from "\.\/lead\.js"/);
assert.match(fn, /by_category: stats\.by_category/);
assert.match(fn, /async function loadContacts/);
assert.match(fn, /if \(loadedContacts\.ok\) await saveContacts/);
assert.match(fn, /contacts: loadedContacts\.ok \? "saved" : "skipped"/);
assert.doesNotMatch(fn, /The contact response had no contacts array/);
assert.doesNotMatch(fn, /get_contacts response had no contacts array/);
assert.doesNotMatch(fn, /username:\s*name/);
assert.doesNotMatch(fn, /service\.tailortalk\.ai/);
assert.doesNotMatch(fn, /message_count/);
assert.match(fn, /acq_tt_apply_batch/);
assert.match(fn, /acq_tt_businesses_for_tt_agent/);
assert.match(fn, /tailortalk_agent_id/);
assert.match(fn, /limit 200 is the API maximum/);
assert.match(fn, /detail: "summary"/);

const facts = read("supabase/migrations/20261021220000_tailortalk_facts.sql");
assert.match(facts, /'\*\/5 \* \* \* \*'/);
assert.match(facts, /tailortalk-sync-hourly/);

const { summaryRow } = await import("../supabase/functions/tailortalk-sync/crm.js");
const summary = summaryRow({
  id: "lead-2",
  lead_name: "Ada",
  lead_contact: null,
  username: "ada.coach",
  integration: "instagram",
  lead_status: "warm",
  is_converted: false,
  category: "sales",
  last_message_time: "2026-10-21T12:00:00Z",
  total_followups: 1,
  chat_history: [{ role: "user", content: "hidden" }],
  lead_attributes: { budget: "8k", voice_note_slot: "gap_building" }
}, Date.parse("2026-10-21T12:00:00Z"));
assert.equal(summary.detail, "summary");
assert.equal(summary.handle, "ada.coach");
assert.equal(summary.contact, "");
assert.equal(summary.messages, null);
assert.deepEqual(summary.attributes, {});
assert.equal(summary.lead_status, "warm");
assert.equal(summary.stage, "qualified");
assert.equal(summaryRow({ id: "lead-3", is_converted: true, integration: "instagram" }).lead_status, "converted");

const registry = read("supabase/migrations/20261014180000_tailortalk_registry.sql");
assert.match(registry, /tailortalk_agent_id/);
assert.match(registry, /prompt_sections jsonb/);
assert.match(registry, /prompt_version_id/);
assert.match(registry, /public\.tailortalk_prompt_versions/);
assert.match(registry, /create unique index if not exists tailortalk_agents_tt_id/);
assert.match(registry, /revoke all on function public\.tailortalk_upsert_agent\(text, text, jsonb, text, timestamptz, jsonb, timestamptz, text, boolean\) from public, anon, authenticated/);
assert.match(registry, /access_token/);
assert.match(registry, /ntrtnxfad/);
const upsertSql = read("supabase/tailortalk_registry_upsert.sql");
for (const id of ["afwbuhnx", "bsojvzgf", "rojkojbk", "taongeti", "udnnperp"]) {
  assert.match(upsertSql, new RegExp(id));
}
assert.match(upsertSql, /paste-access-token/);
assert.doesNotMatch(upsertSql, /[0-9a-f]{40,}/i);
const toml = read("supabase/config.toml");
assert.match(toml, /\[functions\.generate-setter-prompt\]\nverify_jwt = true/);
assert.match(toml, /\[functions\.tailortalk-sync\]\nverify_jwt = false/);
assert.doesNotMatch(toml, /prompt-simulator/);
assert.match(toml, /\[functions\.business-members\]\nverify_jwt = true/);
assert.doesNotMatch(toml, /<<<<<<<|>>>>>>>/);

const adminPage = read("admin/index.html");
assert.match(adminPage, /href="\/businesses\/">Businesses/);
assert.match(adminPage, /href="\/account\/#profile">Your account/);
assert.doesNotMatch(adminPage, /#clients|#publish|CRM\/Insights/);
assert.match(read("auth/site.css"), /\.admin-tabs\[hidden\]\{display:none !important\}/);
assert.match(read("admin/admin.js"), /renderAcquisitionRoster/);
assert.match(read("admin/acquisition-admin.js"), /Roleflow Setter Engine/);
assert.doesNotMatch(read("admin/acquisition-admin.js"), /tailortalk/i);
assert.match(read("admin/crm.js"), /No source was returned for these leads/);
assert.match(read("admin/crm.js"), /Copy section/);
assert.match(read("admin/crm.js"), /Prompt version history/);
assert.match(read("admin/crm.js"), /id: "crm-tab-" \+ name/);
assert.match(read("admin/crm.js"), /leads: "Leads", prompt: "Prompt", channels: "Channels", sends: "Template sends"/);
assert.match(read("admin/crm.js"), /id: "crm-confirm"/);
assert.match(read("admin/crm.js"), /action: "mark_booked"/);
assert.match(read("admin/crm.js"), /action: "send_template"/);
assert.match(read("admin/crm.js"), /Message history is not included/);
assert.doesNotMatch(read("admin/crm.js"), /tailortalk/i);
assert.match(read("admin/crm.js"), /engine_registry/);
assert.match(read("admin/crm.js"), /setter-engine/);
assert.match(read("admin/crm.js"), /id: "crm-link-" \+ agent\.id/);
assert.match(read("admin/crm.js"), /client_id: select\.value \|\| null/);
assert.doesNotMatch(read("admin/crm.js"), /token_encrypted/);
assert.doesNotMatch(read("admin/crm.js"), /access_token/);
assert.doesNotMatch(read("admin/crm.js"), /message_count/);
const homepage = read("index.html");
assert.doesNotMatch(homepage, /tab-crm/);
assert.doesNotMatch(homepage, /\/admin\/crm/);
assert.doesNotMatch(homepage, /id="admin-tabs"/);
assert.match(homepage, /id="drawer-crm" href="\/admin\/#crm" hidden>CRM</);
assert.match(homepage, /id="drawer-admin" href="\/admin\/" hidden>Client tracking</);
assert.match(homepage, /href="\/resources\/">Resources</);
assert.match(read("auth/sidebar.js"), /crmLink\.hidden = !isAdmin/);
assert.doesNotMatch(read("admin/index.html"), /id="nav-crm"/);
assert.match(read("businesses/app.js"), /id: "admin-links"/);
assert.doesNotMatch(read("businesses/app.js"), /CRM\/Insights|#clients|#publish/);
const migrationNames = [
  "20261010120000_roleflow_accounts.sql",
  "20261011090000_signup_access_code.sql",
  "20261014120000_prompt_generation.sql",
  "20261014140000_prompt_sections.sql",
  "20261014160000_tailortalk_crm.sql",
  "20261014180000_tailortalk_registry.sql",
  "20261014200000_client_setter.sql",
  "20261015120000_businesses.sql",
  "20261015120000_setter_applications.sql",
  "20261016120000_business_members.sql",
  "20261016140000_business_assets.sql",
  "20261016160000_workforce_console.sql",
  "20261016180000_agent_hq.sql",
  "20261017050000_agentic_hq_roster.sql",
  "20261017060000_hq_task_timing.sql",
  "20261017070000_hq_task_create.sql",
  "20261018130000_hq_task_station.sql",
  "20261018133520_hq_station_revenue_back_office.sql",
  "20261018140000_workforce_stations.sql",
  "20261019103000_workforce_office_stations.sql",
  "20261019140000_office_editor.sql",
  "20261021120000_acquisition_pipeline.sql",
  "20261021140000_conversation_engine.sql",
  "20261021160000_pgcrypto_schema.sql",
  "20261021180000_tailortalk_provider.sql",
  "20261021200000_live_acquisition.sql",
  "20261021220000_tailortalk_facts.sql",
  "20261021230000_engine_outbox.sql",
  "20261021240000_diego_setter.sql",
  "20261022060000_assistant_turns.sql",
  "20261022190000_studio_phase1.sql",
  "20261022210000_studio_phase2.sql",
  "20261022230000_studio_phase3.sql",
  "20261022240000_studio_phase4.sql",
  "20261023040000_vam_chats_dnc.sql",
  "20261023050000_studio_phase5.sql",
  "20261023060000_channel_connect_requests.sql",
  "20261023061000_acq_outbound_worker_pipeline.sql",
  "20261023070000_setter_studio.sql",
  "20261023080000_engine_sync_notice.sql",
  "20261023090000_resend_settings.sql",
  "20261023100000_ig_gateway.sql",
  "20261023120000_inbox_live.sql",
  "20261023140000_setter_gate.sql",
  "20261023150000_booking_link_default.sql",
  "20261023160000_ig_outbox_tick.sql",
  "20261023170000_ig_connect_any_account.sql",
  "20261023180000_llm_providers_and_clips.sql",
  "20261026120000_client_dashboard_agents.sql",
  "20261026140000_business_model_keys.sql"
];
assert.deepEqual(
  migrationNames,
  migrationNames.slice().sort()
);
assert.deepEqual(
  fs.readdirSync(path.join(root, "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort(),
  migrationNames
);

console.log("tailortalk crm tests passed");
