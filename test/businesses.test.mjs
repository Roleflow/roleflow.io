import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROOF_SLOTS, createdAgo, last7, nameKey, nextProof, uniqueAgentMatch } from "../businesses/model.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

assert.equal(nameKey(" Maya Chen! "), "mayachen");
assert.equal(uniqueAgentMatch([
  { id: "a", agent_name: "Maya Chen", label: "", client_id: null, archived: false },
  { id: "b", agent_name: "Other", label: "", client_id: null, archived: false }
], ["Maya Chen"]), "a");
assert.equal(uniqueAgentMatch([
  { id: "a", agent_name: "Maya Chen", client_id: null, archived: false },
  { id: "b", agent_name: "Maya Chen", client_id: null, archived: false }
], ["Maya Chen"]), null);
assert.equal(uniqueAgentMatch([
  { id: "a", agent_name: "Maya Chen", client_id: "user", archived: false }
], ["Maya Chen"]), null);
assert.equal(uniqueAgentMatch([
  { id: "a", agent_name: "Maya Chen", client_id: null, archived: true }
], ["Maya Chen"]), null);
assert.equal(uniqueAgentMatch([
  { id: "a", agent_name: "Northstar", label: "Maya Chen Studio", client_id: null, archived: false }
], ["maya"]), null);

const week = last7([{ day: "2026-10-15", count: 2 }, { day: "2026-10-14", count: "nope" }], new Date("2026-10-15T12:00:00Z"));
assert.equal(week.days.length, 7);
assert.equal(week.days[6].count, 2);
assert.equal(week.days[0].count, 0);
assert.equal(week.total, 2);
assert.match(createdAgo("", Date.now()), /not recorded/i);
assert.match(createdAgo(new Date(Date.now() - 86400000 * 3).toISOString(), Date.now()), /3 days ago/);
assert.equal(PROOF_SLOTS.length, 3);
PROOF_SLOTS.forEach((slot) => {
  assert.match(slot.quote, /\[TESTIMONIAL/);
  assert.match(slot.portrait, /\[PORTRAIT/);
  assert.match(slot.stars, /\[STARS/);
  assert.equal(slot.logos.length, 3);
  assert.match(slot.logos[0], /\[LOGO/);
  assert.doesNotMatch(JSON.stringify(slot), /love|amazing|best|5 stars/i);
});
assert.equal(nextProof(2, 3, 1), 0);

const migration = read("supabase/migrations/20261015120000_businesses.sql");
assert.match(migration, /publish_status/);
assert.match(migration, /match_client_agent/);
assert.match(migration, /link_business/);
assert.match(migration, /client_prompt_versions/);
assert.match(migration, /security_invoker = true/);
assert.match(migration, /leads\.lead_contact/);
assert.match(migration, /grant execute on function public\.match_client_agent\(uuid\) to service_role/);
assert.match(migration, /grant execute on function public\.link_business\(text\) to authenticated/);

const page = read("businesses/index.html");
const app = read("businesses/app.js");
assert.doesNotMatch(page, /tailortalk|zerochats/i);
assert.doesNotMatch(app, /tailortalk|zerochats/i);
assert.match(page, /id="user-chip"/);
assert.match(app, /AI active/);
assert.match(app, /Add business/);
assert.match(app, /link_business/);
assert.doesNotMatch(app, /Simulation|simulator|prompt-simulator|emulator|test chat/i);
assert.match(app, /class: "biz-row"/);
assert.match(app, /\["members", "Members"\]/);
assert.match(app, /\["workflow", "Workflow"\],\n  \["workforce", "Workforce"\],\n  \["assets", "Assets"\]/);
assert.match(app, /leads\|workflow\|workforce\|assets\|stats\|setup\|members/);
assert.match(app, /id: "lead-pager"|id="lead-pager"/);
assert.match(app, /range-control/);
assert.match(app, /class: "ext"/);
assert.match(app, /section-rail/);
assert.match(read("signup/index.html"), /class="or-divider"/);
assert.match(read("signup/index.html"), /href="\/privacy\/"/);
assert.match(read("signup/index.html"), /href="\/terms\/"/);
assert.match(read("privacy/index.html"), /Diego to review/);
assert.match(read("terms/index.html"), /Diego to review/);
assert.doesNotMatch(app, /Campaigns|No campaign feed|Test chat available in admin/);
assert.match(app, /Conversations in the sync/);
assert.match(app, /Not linked/);
assert.match(app, /liveSections/);
assert.match(app, /client_ai_setters/);
assert.match(app, /client_ai_setter_stats/);
assert.match(app, /client_ai_setter_leads/);
assert.match(app, /id: "admin-links"/);
assert.match(app, /agent-client-link/);
assert.match(app, /Pending publish/);
assert.match(app, /\["setup", "Setup"\]/);
assert.doesNotMatch(app, /CRM\/Insights|#clients|#publish|Publish queue/);
assert.doesNotMatch(app, /from\("client_ai_setters"\)[\s\S]{0,180}\.eq\("client_id"/);

const signup = read("signup/index.html");
assert.match(signup, /id="google-btn" disabled/);
assert.match(signup, /id="proof-quote"/);
assert.match(signup, /\[TESTIMONIAL/);
assert.doesNotMatch(signup, /official integration|Meta integration|meta business/i);
assert.match(read("signup/signup.js"), /signInWithOAuth/);
assert.match(read("signup/signup.js"), /GOOGLE_AUTH === true/);
assert.match(read("supabase/config.js"), /GOOGLE_AUTH: false/);

const fn = read("supabase/functions/generate-setter-prompt/index.ts");
assert.match(fn, /publish_status: "pending"/);
assert.match(fn, /match_client_agent/);
assert.doesNotMatch(fn, /update_workflow|send_test_message|get_test_chat/);
assert.match(read("account/account.js"), /\/businesses\//);
assert.match(read("onboarding/app.js"), /location\.assign\("\/businesses\/"\)/);
assert.match(read("admin/publish.js"), /publish_status === "pending"/);
assert.match(read("admin/publish.js"), /Mark published/);
assert.match(read("admin/admin.js"), /location\.replace\("\/businesses\/"\)/);
assert.match(read("account/index.html"), /href="\/businesses\/"/);
assert.doesNotMatch(read("account/index.html"), /#clients|#publish|CRM\/Insights/);
assert.match(read("index.html"), /id="menu-toggle" href="\/signup\/">Access/);

const membersSql = read("supabase/migrations/20261016120000_business_members.sql");
assert.match(membersSql, /create table if not exists public\.business_members/);
assert.match(membersSql, /can_read_business/);
assert.match(membersSql, /can_edit_business/);
assert.match(membersSql, /can_manage_members/);
assert.match(membersSql, /security_invoker = true/);
assert.match(membersSql, /private\.business_invite_secrets/);
assert.match(membersSql, /preview_invite/);
assert.match(membersSql, /accept_invite/);
const membersTable = membersSql.match(/create table if not exists public\.business_members \([\s\S]*?\);/);
assert.ok(membersTable, "members table missing");
assert.doesNotMatch(membersTable[0], /token/i);
assert.doesNotMatch(membersSql, /simulator_sessions|prompt-simulator/);
assert.doesNotMatch(read("businesses/members.js"), /simulation|emulator/i);
assert.match(read("businesses/members.js"), /business-members/);
assert.match(read("businesses/members.js"), /Viewer/);
assert.match(read("businesses/members.js"), /Editor/);
assert.match(read("businesses/members.js"), /Resend/);
assert.match(read("businesses/members.js"), /Revoke/);
assert.match(read("supabase/functions/generate-setter-prompt/index.ts"), /can_edit_business/);
assert.doesNotMatch(read("supabase/config.toml"), /prompt-simulator/);
assert.match(read("supabase/functions/business-members/index.ts"), /https:\/\/api\.resend\.com\/emails/);
assert.match(read("supabase/functions/business-members/index.ts"), /signup\/\?invite=/);
assert.match(read("signup/signup.js"), /preview_invite/);
assert.match(read("signup/signup.js"), /accept_invite/);
assert.match(read("signup/index.html"), /id="access-code"/);

const assetsSql = read("supabase/migrations/20261016140000_business_assets.sql");
assert.match(assetsSql, /create table if not exists public\.business_assets/);
assert.match(assetsSql, /create table if not exists public\.business_workforce/);
assert.match(assetsSql, /business-assets/);
assert.match(assetsSql, /public = false|set public = false/);
assert.match(assetsSql, /business_assets_select/);
assert.match(assetsSql, /business_assets_insert/);
assert.match(assetsSql, /business_assets_update/);
assert.match(assetsSql, /business_assets_delete/);
assert.match(assetsSql, /business_workforce_select/);
assert.match(assetsSql, /business_assets_storage_read/);
assert.match(assetsSql, /business_assets_storage_insert/);
assert.match(assetsSql, /business_assets_storage_delete/);
assert.match(assetsSql, /create or replace view public\.business_agent_assets/);
assert.match(assetsSql, /security_invoker = true/);
assert.match(assetsSql, /available_to_agent/);
assert.match(assetsSql, /when_to_use/);
assert.match(assetsSql, /business_workforce_counts/);
assert.match(assetsSql, /can_read_business/);
assert.match(assetsSql, /can_edit_business/);
for (const file of ["businesses/assets.js", "businesses/workforce.js"]) {
  const literals = [...read(file).matchAll(/"([^"\\]|\\.)*"/g)].map((match) => match[0]);
  assert.deepEqual(literals.filter((text) => /tailortalk|zerochats/i.test(text)), []);
}
assert.match(read("businesses/assets.js"), /Available to agent/);
assert.match(read("businesses/assets.js"), /MediaRecorder/);
assert.match(read("businesses/assets.js"), /createSignedUrl/);
assert.match(read("businesses/workforce.js"), /Outreach Agent/);
assert.match(read("businesses/workforce.js"), /Follow Up Agent/);
assert.match(read("businesses/workforce.js"), /Setting Agent/);
assert.match(read("businesses/workforce.js"), /New-follower messages/);
assert.match(read("auth/site.css"), /office-floor/);

console.log("businesses tests passed");
