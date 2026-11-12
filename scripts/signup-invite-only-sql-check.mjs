// SQL check for 20261112130000_signup_invite_only.sql, in an in-memory
// Postgres (PGlite). Loads the same stand-in as join-link-sql-check.mjs and
// applies the sign-up migrations in order, then signs people up with and
// without links. Nothing touches the hosted database.
//
//   npm i --no-save @electric-sql/pglite
//   node scripts/signup-invite-only-sql-check.mjs
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new PGlite({ extensions: { pgcrypto } });
const load = (file) => db.exec(fs.readFileSync(path.join(root, file), "utf8"));
await load("test/fixtures/business-testers-stub.sql");
await load("supabase/migrations/20261111120000_business_testers.sql");
await load("supabase/migrations/20261111180000_join_link_least_privilege.sql");
await load("supabase/migrations/20261111200000_signup_without_access_code.sql");
let failures = 0;
const ok = (cond, label) => { console.log((cond ? "PASS " : "FAIL ") + label); if (!cond) failures++; };
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const fails = async (fn) => { try { await fn(); return false; } catch (_e) { return true; } };
const signup = (email, meta, app) => one("insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3) returning id, raw_user_meta_data m", [email, JSON.stringify(meta), JSON.stringify(app || { provider: "email" })]);
const ownBiz = async (uid) => (await one("select count(*)::int n from public.acq_workspaces where owner_id = $1", [uid])).n;

const before = await signup("before@x.co", { full_name: "B", instagram: "b" });
ok(await ownBiz(before.id) === 1, "before (live today): a no-link sign-up gets an account");
await load("supabase/migrations/20261112130000_signup_invite_only.sql");

ok(await fails(() => signup("nolink@x.co", { full_name: "N", instagram: "n" })), "no link: rejected");
ok(await fails(() => signup("oldcode@x.co", { full_name: "C", instagram: "c", access_code: "Code2026" })), "no link with the old access code: rejected (no code anywhere)");
ok(await fails(() => signup("forge-flag@x.co", { full_name: "F", instagram: "f", signup_allowed: true })), "signup_allowed in user metadata does nothing");
ok(await fails(() => signup("forge-app@x.co", { full_name: "F", instagram: "f" }, { provider: "email", signup_allowed: false })), "app_metadata signup_allowed=false: rejected");

const O = (await signup("owner@x.co", { full_name: "Owner", instagram: "owner" }, { provider: "email", signup_allowed: true })).id;
const W = (await one("select id from public.acq_workspaces where owner_id = $1", [O]) || {}).id;
ok(Boolean(W), "admin-made account (app_metadata.signup_allowed, service key only): created with its own business");
const memberRole = async (uid) => ((await one("select role from public.acq_members where business_id = $1 and user_id = $2", [W, uid])) || {}).role;
const link = async (role) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${O}', false), set_config('request.jwt.claim.role', 'authenticated', false); set role authenticated;`);
  try { return (await one("select public.acq_regenerate_join_code($1, $2) r", [W, role])).r.join_code; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);"); }
};

const tCode = await link("tester");
const t = await signup("tester@x.co", { full_name: "T", instagram: "", join_code: tCode });
ok(await memberRole(t.id) === "tester" && await ownBiz(t.id) === 0, "Tester team link, no Instagram: joins as Tester, no business of their own");
ok(!("join_code" in t.m), "join code is not kept on the user");
const pCode = await link("prompt_editor");
ok(await fails(() => signup("late@x.co", { full_name: "L", instagram: "l", join_code: tCode })), "replaced team link: rejected");
const p = await signup("pe@x.co", { full_name: "P", join_code: pCode.toUpperCase() });
ok(await memberRole(p.id) === "prompt_editor" && await ownBiz(p.id) === 0, "Tester + prompt edits link: joins with that role");
const eCode = await link("editor");
const e = await signup("editor@x.co", { full_name: "E", join_code: eCode });
ok(await memberRole(e.id) === "editor" && await ownBiz(e.id) === 1, "Editor link: joins as Editor and gets their own business, as before");
await db.query("delete from public.acq_join_links where business_id = $1", [W]);
ok(await fails(() => signup("off@x.co", { full_name: "O", instagram: "o", join_code: eCode })), "turned-off team link: rejected");
ok(await fails(() => signup("forge@x.co", { full_name: "F", instagram: "f", acq_join_business_id: W, acq_join_role: "editor", acq_invite_id: W })), "forged membership markers without a link: rejected");

const IT = "f".repeat(64), XT = "9".repeat(64);
await db.query("insert into public.acq_invites (business_id, email, scopes, token, role, expires_at) values ($1, 'inv@x.co', '{}', $2, 'tester', now() + interval '14 days'), ($1, 'old@x.co', '{}', $3, 'tester', now() - interval '1 day')", [W, IT, XT]);
ok(await fails(() => signup("someone@x.co", { full_name: "S", invite_token: IT })), "invite token for another email: rejected");
const i = await signup("inv@x.co", { full_name: "I", invite_token: IT });
ok(await memberRole(i.id) === "tester" && await ownBiz(i.id) === 0, "email invite, no Instagram: joins as Tester");
ok(await fails(() => signup("old@x.co", { full_name: "X", invite_token: XT })), "expired email invite: rejected");

console.log(failures ? failures + " FAILED" : "ALL PASS");
process.exit(failures ? 1 : 0);
