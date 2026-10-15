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
assert.match(app, /Test chat available in admin/);
assert.match(app, /id: "lead-pager"|id="lead-pager"/);
assert.match(app, /range-control/);
assert.match(app, /class: "ext"/);
assert.match(app, /section-rail/);
assert.match(read("signup/index.html"), /class="or-divider"/);
assert.match(read("signup/index.html"), /href="\/privacy\/"/);
assert.match(read("signup/index.html"), /href="\/terms\/"/);
assert.match(read("privacy/index.html"), /Diego to review/);
assert.match(read("terms/index.html"), /Diego to review/);
assert.match(app, /No campaign feed/);
assert.match(app, /Conversations in the sync/);
assert.match(app, /Not linked/);
assert.match(app, /liveSections/);
assert.match(app, /client_ai_setters/);
assert.match(app, /client_ai_setter_stats/);
assert.match(app, /client_ai_setter_leads/);
assert.match(app, /CRM\/Insights/);
assert.match(app, /#publish/);
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
assert.match(read("admin/admin.js"), /publish_status", "pending"|publish_status", "pending"/);
assert.match(read("admin/admin.js"), /Mark published/);
assert.match(read("index.html"), /id="menu-toggle" href="\/signup\/">Access/);

console.log("businesses tests passed");
