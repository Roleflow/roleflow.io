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
assert.equal(stats.last_activity_at, "2026-10-14T01:00:00.000Z");
assert.equal(stats.leads_per_day.length, 30);
assert.equal(stats.leads_per_day[0].day, "2026-09-15");
assert.equal(stats.leads_per_day.at(-1).day, "2026-10-14");
assert.equal(stats.leads_per_day.at(-1).count, 2);
assert.equal(stats.leads_per_day.find((item) => item.day === "2026-10-01").count, 1);
assert.equal(stats.leads_per_day.filter((item) => item.day < "2026-10-01").every((item) => item.count === 0), true);
assert.equal("message_count" in stats, false);

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
assert.match(fn, /Authorization: "Agent " \+ token/);
assert.match(fn, /method: "POST"/);
assert.match(fn, /JSON\.stringify\(payload\)/);
assert.match(fn, /TAILORTALK_TOKEN_KEY/);
assert.match(fn, /TAILORTALK_CRON_SECRET/);
assert.match(fn, /eq\("archived", false\)/);
assert.doesNotMatch(fn, /service\.tailortalk\.ai/);
assert.doesNotMatch(fn, /message_count/);

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
assert.doesNotMatch(toml, /<<<<<<<|>>>>>>>/);

const adminPage = read("admin/index.html");
assert.match(adminPage, /id="tab-crm"/);
assert.match(adminPage, /id="admin-tabs" hidden/);
assert.match(read("auth/site.css"), /\.admin-tabs\[hidden\]\{display:none !important\}/);
assert.match(read("admin/admin.js"), /renderCrm/);
assert.match(read("admin/crm.js"), /TailorTalk did not return a source on these leads/);
assert.match(read("admin/crm.js"), /Copy section/);
assert.match(read("admin/crm.js"), /Prompt version history/);
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
assert.match(read("admin/index.html"), /id="nav-crm" href="\/admin\/#crm" hidden>CRM</);
assert.match(read("admin/admin.js"), /headerCrm\.hidden = false/);
const migrationNames = [
  "20261010120000_roleflow_accounts.sql",
  "20261011090000_signup_access_code.sql",
  "20261014120000_prompt_generation.sql",
  "20261014140000_prompt_sections.sql",
  "20261014160000_tailortalk_crm.sql",
  "20261014180000_tailortalk_registry.sql"
];
assert.deepEqual(
  migrationNames,
  migrationNames.slice().sort()
);

console.log("tailortalk crm tests passed");
