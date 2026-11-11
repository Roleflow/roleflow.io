// Business access for testers: who may run which client-dashboard action, what
// the panel shows a tester, and what the migration changes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INVITE_ROLES, accessView, actionNeeds, denyMessage, inviteEmail, inviteToken, legacyAccess,
  mayRemoveMember, mayRun, normalizeAccess, normalizeInvite, roleLabel, testerLoadView
} from "../supabase/functions/_shared/team-access.js";
import {
  ROLE_OPTIONS, isTesterRole, mergeTesterBusinesses, navGroupsFor, panelAbilities, panelRole,
  roleText, shouldOpenOwnWorkspace, testerTab
} from "../acquire/team-access.js";
import { NAV_GROUPS } from "../acquire/client-nav.mjs";
import { inviteDestination } from "../signup/entry.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const dashboard = read("supabase/functions/client-dashboard/index.ts");
const migration = read("supabase/migrations/20261111120000_business_testers.sql");

// Every action client-dashboard dispatches after the business check.
const dispatched = [...dashboard.matchAll(/if \(action === "([a-z_]+)"\) return/g)].map((match) => match[1]).filter((name) => name !== "save_language");
assert.ok(dispatched.length >= 18, "found the dispatch table");
for (const name of ["load", "preview_setter", "transcribe_trial", "save_prompt", "set_agent", "save_policy", "team_invite"]) {
  assert.ok(dispatched.includes(name), name + " is dispatched");
}

const fromRpc = (role, extra) => normalizeAccess({ role, can_edit: false, can_test: false, can_edit_prompt: false, can_manage_team: false, ...extra });
const tester = fromRpc("tester", { can_test: true });
const promptEditor = fromRpc("prompt_editor", { can_test: true, can_edit_prompt: true });
const editor = fromRpc("editor", { can_edit: true, can_test: true, can_edit_prompt: true });
const owner = fromRpc("owner", { can_edit: true, can_test: true, can_edit_prompt: true, can_manage_team: true });
const stranger = fromRpc(null);

// A tester reaches exactly the practice chat and reading the prompt.
const testerAllowed = dispatched.filter((name) => mayRun(tester, name)).sort();
assert.deepEqual(testerAllowed, ["load", "preview_setter", "transcribe_trial"]);
assert.equal(tester.tester, true);

// Live switches, Auto-DM policy, booking link, onboarding, comment voice,
// prompt builds, Claude checks, and team management are all closed to testers.
for (const name of ["set_agent", "save_policy", "save_booking_link", "save_comment_voice", "create_onboarding_link", "revoke_onboarding_link", "build_onboarding", "upload_onboarding", "build_setter_prompt", "claude_health", "save_prompt", "restore_prompt", "team_list", "team_invite", "team_remove"]) {
  assert.equal(mayRun(tester, name), false, "tester may not " + name);
}
// Unknown and future actions default to full edit, never to tester.
assert.equal(actionNeeds("toggle_auto_dm"), "edit");
assert.equal(mayRun(tester, "toggle_auto_dm"), false);
assert.equal(mayRun(tester, "connect_instagram"), false);

// Tester + prompt edits: the tester actions plus saving the prompt.
assert.deepEqual(dispatched.filter((name) => mayRun(promptEditor, name)).sort(), ["load", "preview_setter", "restore_prompt", "save_prompt", "transcribe_trial"]);
assert.equal(mayRun(promptEditor, "set_agent"), false);

// Editors keep the full panel but cannot manage the team. Owners can.
for (const name of dispatched.filter((item) => !item.startsWith("team_"))) assert.equal(mayRun(editor, name), true, "editor may " + name);
for (const name of ["team_list", "team_invite", "team_remove"]) {
  assert.equal(mayRun(editor, name), false);
  assert.equal(mayRun(owner, name), true);
}
for (const name of dispatched) assert.equal(mayRun(stranger, name), false, "stranger may not " + name);
assert.match(denyMessage(tester, "set_agent"), /practice chat only/);
assert.match(denyMessage(editor, "team_invite"), /owner/);

// Before the migration: same behaviour as the old acq_can_edit gate.
const oldEdit = legacyAccess(true);
for (const name of dispatched.filter((item) => !item.startsWith("team_"))) assert.equal(mayRun(oldEdit, name), true);
for (const name of dispatched) assert.equal(mayRun(legacyAccess(false), name), false);
assert.equal(mayRun(oldEdit, "team_invite"), false);

// can_edit implies the rest even if the RPC leaves a flag out.
const loose = normalizeAccess({ role: "owner", can_edit: true });
assert.equal(loose.canTest, true);
assert.equal(loose.canEditPrompt, true);
assert.equal(normalizeAccess(null).canTest, false);
assert.deepEqual(accessView(tester), { role: "tester", can_edit: false, can_test: true, can_edit_prompt: false, can_manage_team: false });

// What load returns to a tester: the prompt, no switches or follow-up policy.
const view = testerLoadView("Be brief.", "2026-11-11T10:00:00Z", "es", tester);
assert.equal(view.prompt, "Be brief.");
assert.deepEqual(view.switches, []);
assert.equal("policy" in view, false);
assert.equal(view.language, "es");
assert.equal(view.access.role, "tester");

// Invites.
assert.deepEqual(INVITE_ROLES, ["tester", "prompt_editor", "editor"]);
assert.deepEqual(normalizeInvite({ email: " Maria@Example.COM ", role: "tester" }), { ok: true, email: "maria@example.com", role: "tester" });
assert.equal(normalizeInvite({ email: "nope", role: "tester" }).ok, false);
assert.equal(normalizeInvite({ email: "a@b.co", role: "owner" }).ok, false);
assert.equal(normalizeInvite({ email: "a@b.co", role: "admin" }).ok, false);
assert.equal(mayRemoveMember({ user_id: "u2", role: "tester" }, "u1"), true);
assert.equal(mayRemoveMember({ user_id: "u1", role: "editor" }, "u1"), false);
assert.equal(mayRemoveMember({ user_id: "u3", role: "owner" }, "u1"), false);
assert.equal(roleLabel("prompt_editor"), "Tester + prompt edits");
assert.equal(inviteToken(new Uint8Array([0, 15, 255])), "000fff");
const newMail = inviteEmail("Value Add Marketing", "tester", "https://www.roleflow.io/signup/?invite=x", false);
assert.match(newMail.subject, /Value Add Marketing/);
assert.match(newMail.text, /practice chat/);
assert.match(newMail.text, /never sends anything to Instagram/);
assert.match(newMail.text, /do not need an access code/);
assert.match(newMail.text, /14 days/);
const oldMail = inviteEmail("Roleflow", "prompt_editor", "https://www.roleflow.io/login/", true);
assert.match(oldMail.text, /Log in/);
assert.doesNotMatch(oldMail.text, /14 days/);
for (const text of [newMail.text, newMail.subject, oldMail.text]) assert.doesNotMatch(text, /zernio|grok/i);

// Panel side.
assert.equal(isTesterRole("tester"), true);
assert.equal(isTesterRole("editor"), false);
assert.deepEqual(ROLE_OPTIONS.map((option) => option.id), INVITE_ROLES);
assert.equal(panelRole({ isAdmin: true, userId: "u", business: { tester_role: "tester" } }), "admin");
assert.equal(panelRole({ isAdmin: false, userId: "u", business: { owner_id: "u" } }), "owner");
assert.equal(panelRole({ isAdmin: false, userId: "u", business: { owner_id: null, tester_role: "tester" } }), "tester");
assert.equal(panelRole({ isAdmin: false, userId: "u", business: { owner_id: "o" }, member: { role: "editor", status: "active" } }), "editor");
assert.deepEqual(panelAbilities("tester"), { testerMode: true, canEdit: false, canEditPrompt: false, canManageTeam: false });
assert.deepEqual(panelAbilities("prompt_editor"), { testerMode: true, canEdit: false, canEditPrompt: true, canManageTeam: false });
assert.deepEqual(panelAbilities("editor"), { testerMode: false, canEdit: true, canEditPrompt: true, canManageTeam: false });
assert.deepEqual(panelAbilities("owner"), { testerMode: false, canEdit: true, canEditPrompt: true, canManageTeam: true });
assert.equal(testerTab(), "setter");
const testerNav = navGroupsFor(NAV_GROUPS, true);
assert.deepEqual(testerNav.flatMap((group) => group.items.map((item) => item.tab)), ["setter"]);
assert.equal(navGroupsFor(NAV_GROUPS, false), NAV_GROUPS);
assert.equal(roleText("prompt_editor", "es"), "Tester + editar prompt");

const merged = mergeTesterBusinesses([{ id: "a", owner_id: "u" }], [
  { business_id: "b", name: "VAM", role: "tester" },
  { business_id: "a", name: "dup", role: "tester" },
  { business_id: "c", name: "x", role: "editor" }
]);
assert.deepEqual(merged.map((row) => row.id), ["a", "b"]);
assert.equal(merged[1].tester_role, "tester");
assert.equal(merged[1].owner_id, null);
assert.equal(shouldOpenOwnWorkspace([], "u"), true);
assert.equal(shouldOpenOwnWorkspace([{ id: "a", owner_id: "u" }], "u"), false);
assert.equal(shouldOpenOwnWorkspace([{ id: "b", owner_id: null, tester_role: "tester" }], "u"), false);
assert.equal(shouldOpenOwnWorkspace([{ id: "c", owner_id: "other" }], "u"), true);

// Sign-up lands a tester on the businesses page.
assert.deepEqual(inviteDestination(null, { business_id: "b1", role: "tester" }, ""), { ok: true, href: "/businesses/" });
assert.deepEqual(inviteDestination(null, { business_id: "b1", role: "prompt_editor" }, ""), { ok: true, href: "/businesses/" });
assert.match(inviteDestination(null, { business_id: "b1", role: "editor" }, "").href, /\/account\/acquisition\/\?business=b1#dashboard/);

// client-dashboard checks access per action before it dispatches anything.
const gate = dashboard.indexOf("const access = await accessFor(userClient, businessId);");
const deny = dashboard.indexOf("if (!mayRun(access, action))");
const firstAction = dashboard.indexOf('if (action === "load")');
assert.ok(gate > 0 && deny > gate && firstAction > deny, "access check runs before every business action");
assert.match(dashboard, /rpc\("acq_access"/);
assert.match(dashboard, /rpc\("acq_can_edit"/, "falls back to the old gate before the migration");
assert.match(dashboard, /access\.tester \? testerLoad/);
assert.match(dashboard, /savedBody === prompt && access && access\.canEditPrompt/, "a tester's practice run does not mark the prompt tested");
assert.doesNotMatch(dashboard, /generateLink|signInWithOtp|admin\.createUser|inviteUserByEmail/, "no sessions or sign-in links are minted");

// Panel: testers get only the setter, and the server decides.
const panel = read("acquire/app.js");
assert.match(panel, /if \(state\.testerMode\) \{\n    paintTester\(\);\n    return;\n  \}/);
assert.match(panel, /acq_my_tester_businesses/);
assert.match(panel, /if \(state\.testerMode\) \{\n        delete request\.comment_when;\n        delete request\.voice;/);
const setter = read("acquire/setter-workspace.js");
assert.match(setter, /if \(!ui\.state\.testerMode\) sim\.append\(delayFields\(ui, copy\)\);/);
assert.match(setter, /if \(ui\.state\.testerMode\) return sim;/);
const biz = read("businesses/app.js");
assert.match(biz, /acq_my_tester_businesses/);
assert.match(biz, /panelBusinessHref\(workspace\.id, "setter"\)/);
const ops = read("acquire/studio-ops.js");
assert.match(ops, /ui\.teamInvite/);
assert.match(ops, /ui\.teamRemove/);
const teamUi = ops.slice(ops.indexOf("export function renderTeam"), ops.indexOf("export function bindOps"));
assert.ok(teamUi.length > 1000);
assert.doesNotMatch(teamUi + read("acquire/team-access.js"), /zernio|grok/i);

// Migration: testers are out of acq_can_read; nothing is applied from here.
assert.match(migration, /NOT APPLIED/);
const readFn = migration.slice(migration.indexOf("create or replace function public.acq_can_read"), migration.indexOf("-- 3. Per-business access summary"));
assert.match(readFn, /m\.role in \('owner', 'editor', 'viewer'\)/);
assert.doesNotMatch(readFn, /tester/);
assert.doesNotMatch(migration, /create or replace function public\.acq_can_edit\b/, "acq_can_edit is unchanged and already excludes testers");
assert.match(migration, /check \(role in \('owner', 'editor', 'viewer', 'tester', 'prompt_editor'\)\)/);
for (const verb of ["read", "insert", "update", "delete"]) {
  assert.match(migration, new RegExp("create policy acq_invites_" + verb + "[\\s\\S]*?acq_can_manage_team\\(business_id\\)"));
}
assert.doesNotMatch(migration, /policy acq_workspaces_select/, "acq_workspaces RLS is unchanged, so function gates that select it keep testers out");
assert.match(migration, /create or replace function public\.acq_my_tester_businesses\(\)/);
assert.match(migration, /grant execute on function public\.acq_access\(uuid\) to authenticated/);
const signupFn = migration.slice(migration.indexOf("create or replace function private.enforce_signup_access_code"));
assert.match(signupFn, /raise exception 'Invalid access code'/);
assert.match(signupFn, /raise exception 'Invalid invite'/);
const newUser = migration.slice(migration.indexOf("create or replace function public.handle_new_user"));
assert.match(newUser, /'diego@roleflow\.io'/);
assert.match(newUser, /perform public\.acq_ensure_owned_workspace\(new\.id, null\)/);
assert.match(newUser, /acq_role not in \('tester', 'prompt_editor'\)/);

console.log("business tester tests passed");
