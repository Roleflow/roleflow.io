// Team join link is owner-only and least privilege; the roleflow-hooks invite
// action only emails an open invite of a business the caller manages.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inviteMail, inviteRequest, openInvite, rateLimiter } from "../supabase/functions/_shared/hooks-invite.js";
import { JOIN_ROLE_DEFAULT, joinLinkNote, joinLinkUrl, joinRole } from "../acquire/team-access.js";
import { INVITE_ONLY_MESSAGE, joinDestination, linkRoleLabel, signupAllowed, signupClosedReason, signupMetadata, signupNeeds, signupReturnPath } from "../signup/entry.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const BIZ = "840b08a9-869c-4650-8dc7-f78fdfa0e112";
const TOKEN = "a".repeat(64);

// --- roleflow-hooks invite: request shape ---------------------------------
assert.equal(inviteRequest({}).ok, false);
assert.equal(inviteRequest({ token: TOKEN }).ok, false, "business_id is required");
assert.equal(inviteRequest({ business_id: "not-a-uuid", token: TOKEN }).ok, false);
assert.equal(inviteRequest({ business_id: BIZ, token: "short" }).ok, false);
assert.equal(inviteRequest({ business_id: BIZ, token: "has space " + TOKEN }).ok, false);
assert.deepEqual(inviteRequest({ business_id: BIZ, token: TOKEN, email: "victim@example.com" }), { ok: true, businessId: BIZ, token: TOKEN });

// --- open invite checks ------------------------------------------------------
const row = { business_id: BIZ, email: "Invited@Example.com", token: TOKEN, accepted_at: null, expires_at: null };
assert.deepEqual(openInvite(row, BIZ, TOKEN), { ok: true, email: "invited@example.com" });
assert.equal(openInvite(null, BIZ, TOKEN).status, 404, "no row the caller can see");
assert.equal(openInvite({ ...row, business_id: "1351d2ac-79bb-545d-8da0-c49ecff28a47" }, BIZ, TOKEN).status, 404, "invite of another business");
assert.equal(openInvite({ ...row, token: "b".repeat(64) }, BIZ, TOKEN).status, 404);
assert.equal(openInvite({ ...row, accepted_at: "2026-11-11T00:00:00Z" }, BIZ, TOKEN).status, 409);
assert.equal(openInvite({ ...row, expires_at: "2026-11-10T00:00:00Z" }, BIZ, TOKEN, Date.parse("2026-11-11T00:00:00Z")).status, 410);
assert.equal(openInvite({ ...row, expires_at: "2026-11-12T00:00:00Z" }, BIZ, TOKEN, Date.parse("2026-11-11T00:00:00Z")).ok, true);
assert.equal(openInvite({ ...row, email: "nope" }, BIZ, TOKEN).ok, false);

// --- the email goes only to the invite row's address --------------------------
const mail = inviteMail("invited@example.com", TOKEN);
assert.deepEqual(mail.to, ["invited@example.com"]);
assert.match(mail.text, /\/signup\/\?invite=a{64}$/);

// --- rate limit ----------------------------------------------------------------
const allow = rateLimiter(2, 1000);
assert.equal(allow("u1", 0), true);
assert.equal(allow("u1", 10), true);
assert.equal(allow("u1", 20), false, "third send in the window is refused");
assert.equal(allow("u2", 20), true, "other callers are not affected");
assert.equal(allow("u1", 1500), true, "window passes");

// --- roleflow-hooks source wiring ---------------------------------------------
const hooks = read("supabase/functions/roleflow-hooks/index.ts");
const inviteFn = hooks.slice(hooks.indexOf("async function invite("), hooks.indexOf("async function notifyConnect("));
assert.ok(inviteFn.length > 200, "found invite()");
assert.doesNotMatch(inviteFn, /body\.email/, "never emails an address from the request");
const manage = inviteFn.indexOf('rpc("acq_can_manage_team"');
const lookup = inviteFn.indexOf('from("acq_invites")');
const send = inviteFn.indexOf("api.resend.com");
assert.ok(manage > 0 && lookup > manage && send > lookup, "checks team access, then reads the invite, then sends");
assert.match(inviteFn, /userClient\.from\("acq_invites"\)/, "invite is read with the caller's client so RLS applies");
assert.match(inviteFn, /inviteAllowed\(userData\.user\.id\)/);
assert.match(inviteFn, /\.eq\("business_id", request\.businessId\)/);

// --- join link helpers ----------------------------------------------------------
assert.equal(JOIN_ROLE_DEFAULT, "tester");
assert.equal(joinRole(undefined), "tester");
assert.equal(joinRole("owner"), "tester", "a link can never grant owner");
assert.equal(joinRole("viewer"), "tester");
assert.equal(joinRole("prompt_editor"), "prompt_editor");
assert.equal(joinRole("editor"), "editor");
assert.equal(joinLinkUrl("https://roleflow.io", "0123456789abcdef01234567"), "https://roleflow.io/signup/?join=0123456789abcdef01234567");
assert.equal(joinLinkUrl("https://roleflow.io", "abcd1234"), "", "old 8-character codes are not shown");
assert.equal(joinLinkUrl("https://roleflow.io", ""), "");
assert.match(joinLinkNote("tester", "en"), /joins as Tester\.$/);
assert.match(joinLinkNote(undefined, "en"), /joins as Tester\.$/);
assert.match(joinLinkNote("editor", "es"), /entra como Editor\.$/);

// --- join destination -------------------------------------------------------------
assert.deepEqual(joinDestination({ ok: true, business_id: BIZ, role: "tester" }), { ok: true, href: "/businesses/" });
assert.deepEqual(joinDestination({ ok: true, business_id: BIZ, role: "prompt_editor" }), { ok: true, href: "/businesses/" });
assert.equal(joinDestination({ ok: true, business_id: BIZ, role: "editor" }).href, "/account/acquisition/?business=" + BIZ + "#dashboard");
assert.equal(joinDestination({ ok: false, error: "That join link does not match a business." }).ok, false);

// --- panel: only the owner sees the team link -------------------------------------
const ops = read("acquire/studio-ops.js");
assert.match(ops, /if \(ui\.state\.canManageTeam\) wrap\.append\(joinLinkCard\(ui, es\)\);/);
assert.doesNotMatch(ops, /joins as an Editor with the full panel/);
assert.doesNotMatch(ops, /business\.join_code/);
const app = read("acquire/app.js");
const regen = app.slice(app.indexOf("async function regenerateJoin("), app.indexOf("async function disableJoin("));
assert.match(regen, /if \(!state\.canManageTeam\)/);
assert.match(regen, /p_role: joinRole\(role\)/);
assert.doesNotMatch(read("acquire/engine-ui.js"), /Join code: /);

// --- migration ----------------------------------------------------------------------
const sql = read("supabase/migrations/20261111180000_join_link_least_privilege.sql");
const fn = (name) => {
  const start = sql.indexOf("function public." + name + "(");
  const body = sql.slice(start);
  const open = body.indexOf("$$");
  return body.slice(open + 2, body.indexOf("$$", open + 2));
};
const join = fn("acq_join_workspace");
assert.match(join, /from public\.acq_join_links/);
assert.doesNotMatch(join, /join_code/, "old codes are not read");
assert.doesNotMatch(join, /'editor'/, "joining does not hard-code Editor");
assert.match(join, /on conflict \(business_id, user_id\) do nothing/, "never changes an existing member");
const regenSql = fn("acq_regenerate_join_code");
assert.match(regenSql, /acq_can_manage_team\(p_business\)/, "owner only");
assert.doesNotMatch(regenSql, /acq_can_edit/);
assert.match(sql, /p_role text default 'tester'/);
assert.match(sql, /gen_random_bytes\(12\)/);
assert.match(sql, /update public\.acq_workspaces set join_code = null/);
assert.match(sql, /drop function if exists public\.acq_regenerate_join_code\(uuid\);/);
assert.doesNotMatch(sql, /for (insert|update) to authenticated/, "links are written only through the RPC");
assert.match(sql, /check \(role in \('tester', 'prompt_editor', 'editor'\)\)/);


// --- sign-up from a link needs no access code or Instagram handle ------------------
assert.deepEqual(signupNeeds({}), { instagram: true }, "no link: Instagram, and no access code");
assert.deepEqual(signupNeeds({ inviteOk: true }), { instagram: false });
assert.deepEqual(signupNeeds({ joinOk: true }), { instagram: false });
assert.deepEqual(signupMetadata({ name: "A", instagram: "", inviteToken: "tok", inviteOk: true, accessCode: "x" }), { full_name: "A", instagram: "", invite_token: "tok" });
assert.deepEqual(signupMetadata({ name: "A", instagram: "h", joinCode: "c", joinOk: true }), { full_name: "A", instagram: "h", join_code: "c" });
assert.deepEqual(signupMetadata({ name: "A", instagram: "h", joinCode: "c", joinOk: false, accessCode: "Code" }), { full_name: "A", instagram: "h" }, "a dead link is a normal sign-up; no access code is sent");
assert.deepEqual(signupMetadata({ name: "A", instagram: "h", inviteToken: "t", inviteOk: false }), { full_name: "A", instagram: "h" });
assert.deepEqual(signupMetadata({ name: "A", instagram: "h" }), { full_name: "A", instagram: "h" }, "no link: name and Instagram only");
assert.equal(signupReturnPath({ joinCode: "abc", joinOk: true }), "/signup/?mode=login&join=abc");
assert.equal(signupReturnPath({ inviteToken: "t", inviteOk: true }), "/signup/?mode=login&invite=t");
assert.equal(signupReturnPath({}), "/signup/?mode=login");
assert.equal(linkRoleLabel("tester"), "Tester", "invited testers are no longer called Viewer");
assert.equal(linkRoleLabel("prompt_editor"), "Tester + prompt edits");

const signupJs = read("signup/signup.js");
assert.match(signupJs, /rpc\("acq_preview_join", \{ p_code: joinCode \}\)/);
assert.match(signupJs, /data: signupMetadata\(\{ name, instagram, inviteToken, inviteOk, joinCode, joinOk \}\)/);
assert.match(signupJs, /if \(needs\.instagram && !instagram\) return showError/, "Instagram is optional for link sign-ups");
assert.doesNotMatch(signupJs, /access-code|accessCode|Enter your access code/, "the sign-up page has no access code");
assert.doesNotMatch(signupJs, /if \(!instagram\) return showError/);

const enforce = sql.slice(sql.indexOf("function private.enforce_signup_access_code()"));
assert.match(enforce, /- 'invite_member_id' - 'acq_invite_id' - 'acq_join_business_id' - 'acq_join_role'/, "client-supplied markers are stripped");
assert.match(enforce, /from public\.acq_join_links as l where l\.code = join_code/, "the server checks the join link");
assert.ok(enforce.indexOf("acq_join_links as l") < enforce.indexOf("select access_code into expected"), "a live link is checked before the access code");
assert.match(sql, /grant execute on function public\.acq_preview_join\(text\) to anon, authenticated;/);
const newUser = sql.slice(sql.indexOf("function public.handle_new_user()"));
assert.match(newUser, /join_role in \('tester', 'prompt_editor', 'editor'\)/);
assert.match(newUser, /on conflict \(business_id, user_id\) do nothing;\n    if acq_role is null then acq_role := join_role; end if;/);

// --- sign-up needs no access code at all (20261111200000) ---------------------------
const noCode = read("supabase/migrations/20261111200000_signup_without_access_code.sql");
const noCodeFn = noCode.slice(noCode.indexOf("create or replace function private.enforce_signup_access_code()"));
assert.doesNotMatch(noCodeFn, /signup_settings|Invalid access code|expected/, "the access code is no longer checked");
assert.match(noCodeFn, /- 'invite_member_id' - 'acq_invite_id' - 'acq_join_business_id' - 'acq_join_role'/, "forged markers are still stripped");
assert.match(noCodeFn, /raise exception 'Invalid invite';/, "a bad invite token still fails");
assert.match(noCodeFn, /from public\.acq_join_links as l where l\.code = join_code/);
assert.match(noCodeFn, /- 'access_code' - 'join_code';\n  return new;\nend;/, "a sent access code is dropped, never stored");
assert.match(noCode, /revoke execute on function private\.enforce_signup_access_code\(\) from public, anon, authenticated;/);
assert.doesNotMatch(noCode, /function public\.handle_new_user/, "account and business creation are unchanged");
const drawer = read("auth/sidebar.js");
assert.doesNotMatch(drawer, /access_code|drawer-access-code|Enter your access code/, "homepage sign-up sends no access code");
assert.doesNotMatch(drawer, /auth\.signUp\(/, "the homepage drawer cannot create accounts (sign-up is by invitation)");
assert.match(signupJs, /if \(needs\.instagram && !instagram\) return showError\("Enter your Instagram handle\."\);/);
assert.match(read("signup/index.html"), /<input id="instagram"[^>]* required>/, "Instagram stays required by default");

// --- sign-up is by invitation only (20261112130000) ---------------------------------
assert.equal(INVITE_ONLY_MESSAGE, "Sign-up is by invitation. Ask the business owner for a team link.");
assert.equal(signupAllowed({}), false, "no link: no sign-up");
assert.equal(signupAllowed({ inviteOk: true }), true);
assert.equal(signupAllowed({ joinOk: true }), true);
assert.equal(signupClosedReason({}), INVITE_ONLY_MESSAGE);
assert.equal(signupClosedReason({ joinCode: "c", joinOk: true }), "");
assert.equal(signupClosedReason({ inviteToken: "t", inviteOk: true }), "");
assert.match(signupClosedReason({ joinCode: "dead" }), /team link is turned off or was replaced/);
assert.match(signupClosedReason({ inviteToken: "bad" }), /invite link is not valid or has expired/);
assert.deepEqual(signupNeeds({ joinOk: true }), { instagram: false }, "Instagram stays optional for link sign-ups");
assert.match(signupJs, /function closeSignup\(\) \{/);
assert.match(signupJs, /\n    closeSignup\(\);\n    const resolved = await resolveSession/, "the form closes once links are checked, before anything else");
assert.match(signupJs, /if \(!signupAllowed\(\{ inviteOk, joinOk \}\)\) return showError\(signupClosedReason\(/, "submit is refused without a link");
assert.match(signupJs, /input\.disabled = true; input\.required = false;/);
const homepageHtml = read("index.html");
assert.match(homepageHtml, /id="drawer-invite-only">Sign-up is by invitation\. Ask the business owner for a team link\.</);
assert.doesNotMatch(homepageHtml, /id="drawer-full-name"|id="drawer-password"|Create account/, "the drawer has no sign-up form");
const inviteOnly = read("supabase/migrations/20261112130000_signup_invite_only.sql");
const inviteOnlyFn = inviteOnly.slice(inviteOnly.indexOf("create or replace function private.enforce_signup_access_code()"));
assert.match(inviteOnlyFn, /raise exception 'Sign-up is by invitation';\nend;/, "no valid link: no account");
assert.match(inviteOnlyFn, /raise exception 'Invalid invite';/);
assert.match(inviteOnlyFn, /- 'invite_member_id' - 'acq_invite_id' - 'acq_join_business_id' - 'acq_join_role'/);
assert.match(inviteOnlyFn, /new\.raw_app_meta_data->>'signup_allowed'/, "admin-made accounts use app_metadata, which the public endpoint cannot set");
assert.doesNotMatch(inviteOnlyFn, /raw_user_meta_data->>'signup_allowed'/, "the bypass is never read from user metadata");
assert.doesNotMatch(inviteOnlyFn, /signup_settings|access_code' *=|Invalid access code/, "no access code anywhere");
assert.doesNotMatch(inviteOnly, /function public\.handle_new_user/);
assert.match(inviteOnly, /revoke execute on function private\.enforce_signup_access_code\(\) from public, anon, authenticated;/);
