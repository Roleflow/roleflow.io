// SQL check for 20261111200000_signup_without_access_code.sql, in an in-memory
// Postgres (PGlite). Loads the same stand-in as join-link-sql-check.mjs,
// applies 20261111120000, 20261111180000 and then this migration, and signs
// people up with and without links. Nothing touches the hosted database.
//
//   npm i --no-save @electric-sql/pglite
//   node scripts/signup-no-code-sql-check.mjs
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
let failures = 0;
const ok = (cond, label) => { console.log((cond ? "PASS " : "FAIL ") + label); if (!cond) failures++; };
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const fails = async (fn) => { try { await fn(); return false; } catch (_e) { return true; } };
const signup = (email, meta) => one("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id, raw_user_meta_data m", [email, JSON.stringify(meta)]);

// Before this migration: no code, no account.
ok(await fails(() => signup("before@x.co", { full_name: "B", instagram: "b" })), "before: sign-up without a code is rejected");
await load("supabase/migrations/20261111200000_signup_without_access_code.sql");

const O = (await signup("owner@x.co", { full_name: "Owner", instagram: "owner" })).id;
const W = (await one("select id from public.acq_workspaces where owner_id = $1", [O]) || {}).id;
ok(Boolean(W), "no link, no code: account created with its own business");
const prof = await one("select instagram from public.profiles where id = $1", [O]);
ok(prof && prof.instagram === "owner", "Instagram handle is saved on the profile");
const memberRole = async (uid, biz = W) => ((await one("select role from public.acq_members where business_id = $1 and user_id = $2", [biz, uid])) || {}).role;
const ownBiz = async (uid) => (await one("select count(*)::int n from public.acq_workspaces where owner_id = $1", [uid])).n;

const old = await signup("oldpage@x.co", { full_name: "P", instagram: "p", access_code: "Code2026" });
ok(!("access_code" in old.m) && await ownBiz(old.id) === 1, "an old page's access code is dropped; normal sign-up");
const wrong = await signup("wrong@x.co", { full_name: "W", instagram: "w", access_code: "nope" });
ok(await ownBiz(wrong.id) === 1, "a wrong code no longer matters");

// Join links, same as before.
const link = async (role) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${O}', false), set_config('request.jwt.claim.role', 'authenticated', false); set role authenticated;`);
  try { return (await one("select public.acq_regenerate_join_code($1, $2) r", [W, role])).r.join_code; }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);"); }
};
const tCode = await link("tester");
const t = await signup("tester@x.co", { full_name: "T", join_code: tCode });
ok(await memberRole(t.id) === "tester" && await ownBiz(t.id) === 0, "Tester link: joins as Tester, no business of their own");
ok(!("join_code" in t.m), "join code is not kept");
const eCode = await link("editor");
const e = await signup("editor@x.co", { full_name: "E", join_code: eCode });
ok(await memberRole(e.id) === "editor" && await ownBiz(e.id) === 1, "Editor link: joins as Editor and keeps their own business, as before");
const dead = await signup("dead@x.co", { full_name: "D", instagram: "d", join_code: tCode });
ok(await memberRole(dead.id) === undefined && await ownBiz(dead.id) === 1, "replaced link: normal sign-up, no membership");
const forged = await signup("forge@x.co", { full_name: "F", instagram: "f", acq_join_business_id: W, acq_join_role: "editor", acq_invite_id: W });
ok(await memberRole(forged.id) === undefined && !("acq_join_business_id" in forged.m) && !("acq_invite_id" in forged.m), "forged markers are stripped: no membership");

// Email invites, same as before.
const IT = "f".repeat(64), XT = "9".repeat(64);
await db.query("insert into public.acq_invites (business_id, email, scopes, token, role, expires_at) values ($1, 'inv@x.co', '{}', $2, 'prompt_editor', now() + interval '14 days'), ($1, 'old@x.co', '{}', $3, 'tester', now() - interval '1 day')", [W, IT, XT]);
const i = await signup("inv@x.co", { full_name: "I", invite_token: IT });
ok(await memberRole(i.id) === "prompt_editor" && await ownBiz(i.id) === 0, "email invite: joins with the invited role, no business of their own");
ok(await fails(() => signup("old@x.co", { full_name: "X", invite_token: XT })), "expired invite token: still rejected");
ok(await fails(() => signup("other@x.co", { full_name: "Y", invite_token: IT })), "invite token for another email: still rejected");

console.log(failures ? failures + " FAILED" : "ALL PASS");
process.exit(failures ? 1 : 0);
