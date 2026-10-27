import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activityDays, activityEvents, conversationWindow, funnelFromLeads, healthScore } from "../businesses/console-model.js";
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
assert.match(app, /class: "biz-board"/);
const siteCss = read("auth/site.css");
assert.match(siteCss, /\.biz-row\{[^}]*display:flex;flex-direction:row;flex-wrap:nowrap[^}]*overflow-x:auto[^}]*scroll-snap-type:x mandatory/);
assert.match(siteCss, /\.biz-row \.biz-card\{[^}]*min-width:min\(320px,78vw\)/);
assert.match(siteCss, /@media\(max-width:860px\)\{[\s\S]*?\.biz-arrow\{display:none\}/);
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
const privacy = read("privacy/index.html");
assert.match(privacy, /does not ask for or store Instagram passwords/);
assert.match(privacy, /roleflow-acquisition\/deletion/);
assert.match(privacy, /show that customer their pipeline and reports/);
assert.doesNotMatch(privacy, /Diego to review/);
const terms = read("terms/index.html");
assert.match(terms, /Draft for review/);
assert.match(terms, /not finished legal text/);
assert.match(terms, /The fee is 10%/);
assert.match(terms, /does not ask for the Instagram password/);
assert.doesNotMatch(app, /Campaigns|No campaign feed|Test chat available in admin/);
assert.match(app, /Leads · last 7 days/);
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
assert.match(signup, /id="proof"/);
assert.match(signup, /Value Add Marketing/);
assert.match(signup, /Results vary; not a guarantee/);
assert.doesNotMatch(signup, /\[TESTIMONIAL/);
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
assert.match(read("admin/admin.js"), /renderAcquisitionRoster/);
assert.match(read("admin/admin.js"), /href: "\/businesses\/"/);
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
for (const file of ["businesses/assets.js", "businesses/workforce.js", "businesses/console-model.js"]) {
  const literals = [...read(file).matchAll(/"([^"\\]|\\.)*"/g)].map((match) => match[0]);
  assert.deepEqual(literals.filter((text) => /tailortalk|zerochats/i.test(text)), []);
}
assert.match(read("businesses/assets.js"), /Available to agent/);
assert.match(read("businesses/assets.js"), /MediaRecorder/);
assert.match(read("businesses/assets.js"), /createSignedUrl/);
const workforce = read("businesses/workforce.js");
assert.match(workforce, /Onboarding & Client Success/);
assert.match(workforce, /client_ai_setter_leads/);
assert.match(workforce, /setter_id/);
assert.match(workforce, /business_id/);
assert.match(workforce, /No agents are assigned to this business yet/);
assert.match(workforce, /No tasks yet/);
assert.match(workforce, /admin\/office\/scene\.js/);
assert.match(workforce, /DM setter/);
assert.doesNotMatch(workforce, /Outreach Agent|Follow Up Agent|Setting Agent|three@|showModal/);
assert.match(read("auth/site.css"), /\.state\[hidden\]\{display:none !important\}/);
assert.match(read("businesses/app.js"), /boot\.remove\(\)/);
assert.match(read("businesses/app.js"), /await boot\(supabase, resolved\.session\.user\)/);
assert.doesNotMatch(read("businesses/app.js"), /adminRes\.data \? "\/admin\/" : "\/account\/acquisition\/#dashboard"/);
assert.match(read("auth/site.css"), /wf-drawer/);
assert.match(read("auth/site.css"), /wf-grid/);
assert.match(read("auth/site.css"), /\.brain-simple\{display:block\}/);
assert.doesNotMatch(read("auth/site.css"), /office-stage|agent-pill/);
assert.match(read("businesses/workforce.css"), /#wf-panel\{top:auto/);
assert.match(read("businesses/workforce.css"), /#biz-switch > \.app-nav\{position:fixed/);
assert.match(read("supabase/migrations/20261016160000_workforce_console.sql"), /last_synced_at/);
assert.match(read("supabase/migrations/20261016160000_workforce_console.sql"), /joined_at/);

const consoleNow = new Date("2026-10-16T12:00:00Z");
assert.deepEqual(conversationWindow([], consoleNow), { today: null, week: null });
assert.deepEqual(conversationWindow([
  { day: "2026-10-16", count: 1 },
  { day: "2026-10-14", count: 2 },
  { day: "2026-09-01", count: 9 }
], consoleNow), { today: 1, week: 3 });
assert.equal(conversationWindow([{ day: "2026-09-01", count: 4 }], consoleNow).week, null);
const days = activityDays([{ day: "2026-10-16", count: 2 }], consoleNow);
assert.equal(days.length, 30);
assert.equal(days[29].count, 2);
assert.equal(days[0].count, null);
const namedFunnel = funnelFromLeads([
  { stage: "hot", is_converted: true },
  { stage: "Qualified", is_converted: false }
], 2);
assert.equal(namedFunnel.booked, 2);
assert.equal(namedFunnel.qualified, 1);
assert.equal(namedFunnel.engaged, 0);
assert.equal(namedFunnel.first, 0);
const plainFunnel = funnelFromLeads([
  { stage: "hot", is_converted: false },
  { stage: "warm", is_converted: true }
], null);
assert.equal(plainFunnel.booked, 1);
assert.equal(plainFunnel.first, null);
assert.equal(plainFunnel.vocabulary, false);
assert.equal(funnelFromLeads(null, null).booked, null);
const events = activityEvents([
  { lead_name: "Eva", stage: "warm", is_converted: false, last_message_time: "2026-10-09T18:00:00Z" },
  { lead_name: "Alex", stage: "hot", is_converted: false, last_message_time: "2026-10-14T18:00:00Z", joined_at: "2026-10-14T16:00:00Z" },
  { lead_name: "Sam", stage: "warm", is_converted: true, last_message_time: "2026-10-12T18:00:00Z", converted_at: "2026-10-12T19:00:00Z" }
], consoleNow);
assert.ok(events.some((event) => event.label === "Follow-up due" && event.name === "Eva"));
assert.ok(events.some((event) => event.label === "New lead" && event.name === "Alex"));
assert.ok(events.some((event) => event.label === "Booked" && event.name === "Sam"));
assert.equal(events.filter((event) => event.name === "Alex" && event.label === "Follow-up due").length, 0);
assert.equal(healthScore({
  statuses: ["active", "paused", "not_set_up"],
  syncedAt: "2026-10-16T09:00:00Z",
  syncErrorKnown: true,
  syncError: "",
  now: consoleNow
}).score, 77);
assert.equal(healthScore({
  statuses: ["active", "not_set_up", "not_set_up"],
  syncErrorKnown: false,
  syncedAt: null,
  now: consoleNow
}).score, 32);
assert.equal(healthScore({
  statuses: ["active", "active", "active"],
  syncedAt: "2026-10-01T00:00:00Z",
  syncErrorKnown: true,
  syncError: "timeout",
  now: consoleNow
}).score, 34);
assert.doesNotMatch(read("businesses/index.html"), /Loading/);
assert.doesNotMatch(read("businesses/app.js"), /Loading/);

console.log("businesses tests passed");
