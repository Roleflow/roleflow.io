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
assert.doesNotMatch(fn, /service\.tailortalk\.ai/);
assert.doesNotMatch(fn, /message_count/);
assert.match(read("supabase/config.toml"), /\[functions\.tailortalk-sync\]\nverify_jwt = false/);

const adminPage = read("admin/index.html");
assert.match(adminPage, /id="tab-crm"/);
assert.match(adminPage, /id="admin-tabs" hidden/);
assert.match(read("auth/site.css"), /\.admin-tabs\[hidden\]\{display:none !important\}/);
assert.match(read("admin/admin.js"), /renderCrm/);
assert.match(read("admin/crm.js"), /TailorTalk did not return a source on these leads/);
assert.doesNotMatch(read("admin/crm.js"), /token_encrypted/);
assert.doesNotMatch(read("admin/crm.js"), /message_count/);
const homepage = read("index.html");
assert.doesNotMatch(homepage, /tab-crm/);
assert.doesNotMatch(homepage, /\/admin\/crm/);
assert.doesNotMatch(homepage, /id="admin-tabs"/);

console.log("tailortalk crm tests passed");
