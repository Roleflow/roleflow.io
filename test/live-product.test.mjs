import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const sql = read("supabase/migrations/20261021200000_live_acquisition.sql");
const bot = read("supabase/functions/acquisition-bot/index.ts");
const panel = read("acquire/app.js");
const wizard = read("acquire/engine-ui.js");

assert.match(sql, /follower_min between 5000 and 200000/);
assert.match(sql, /onboarding_step set default 'profile'/);
assert.match(sql, /stage 'target'/);
assert.match(sql, /acq_store_opener/);
assert.match(sql, /acq_build_work_queue/);
assert.match(sql, /decision in \('pending', 'send'\)/);
assert.match(sql, /acq-chief-daily/);
assert.match(sql, /"action":"chief_daily"/);
assert.doesNotMatch(sql, /your bio is clear about the offer/);

assert.match(bot, /grok-4\.3/);
assert.match(bot, /api\.x\.ai\/v1\/chat\/completions/);
assert.match(bot, /acq_store_opener/);
assert.match(bot, /action === "chief_daily"/);
assert.match(bot, /find_targets/);
assert.match(bot, /XAI_API_KEY is not set/);

assert.match(panel, /No contacts in the CRM yet/);
assert.match(panel, /Finish setup/);
assert.match(panel, /owner_notes/);
assert.match(panel, /Roleflow share/);
assert.match(panel, /action: "chief"/);
assert.match(panel, /ICP Target Acquisition/);
assert.match(panel, /Warm-up and outreach/);
assert.match(panel, /Roleflow Setter Engine/);
assert.match(panel, /setSetterBundle/);
assert.doesNotMatch(panel, /ROLES\.forEach/);
assert.doesNotMatch(panel, /Legacy TailorTalk cache/);

assert.match(wizard, /Business and ICP/);
assert.match(wizard, /CTA keywords/);
assert.match(wizard, /Generate worker key/);
assert.match(wizard, /shown once/);
assert.match(wizard, /Upload recording/);
assert.match(wizard, /Connect Instagram/);

const preview = panel.slice(panel.indexOf("function readPreview"));
assert.match(preview, /host !== "localhost"/);

console.log("live product tests passed");
