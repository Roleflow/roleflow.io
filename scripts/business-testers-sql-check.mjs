// SQL check for 20261111120000_business_testers.sql, in an in-memory Postgres
// (PGlite). It loads a small stand-in for the live tables and functions it
// touches (test/fixtures/business-testers-stub.sql, copied from the live
// definitions on 11 Nov 2026), applies the migration, then signs up and acts
// as owner, editor, tester, prompt editor, admin, and signed-out users.
// Nothing here touches the hosted database.
//
//   npm i --no-save @electric-sql/pglite
//   node scripts/business-testers-sql-check.mjs
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(fs.readFileSync(path.join(root, "test/fixtures/business-testers-stub.sql"), "utf8"));
await db.exec(fs.readFileSync(path.join(root, "supabase/migrations/20261111120000_business_testers.sql"), "utf8"));
let failures = 0;
const ok = (cond, label) => { console.log((cond ? "PASS " : "FAIL ") + label); if (!cond) failures++; };
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const as = async (uid, fn) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ""}', false), set_config('request.jwt.claim.role', '${uid ? "authenticated" : ""}', false); ${uid ? "set role authenticated;" : ""}`);
  try { return await fn(); } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);"); }
};
const fails = async (fn) => { try { await fn(); return false; } catch (_e) { return true; } };
const O = "11111111-1111-1111-1111-111111111111", E = "22222222-2222-2222-2222-222222222222", A = "33333333-3333-3333-3333-333333333333";
await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'owner@x.co', '{"access_code":"Code2026"}'), ($2, 'editor@x.co', '{"access_code":"Code2026"}'), ($3, 'diego@roleflow.io', '{"access_code":"Code2026"}')`, [O, E, A]);
const W = (await one("select id from public.acq_workspaces where owner_id = $1", [O])).id;
ok(Boolean(W), "owner sign-up still opens their own business");
ok((await one("select count(*)::int n from public.admins where user_id = $1", [A])).n === 1, "diego@roleflow.io is still made admin");
await db.query("insert into public.acq_members (business_id, user_id, role) values ($1, $2, 'editor')", [W, E]);
await db.query("insert into public.acq_settings (agent_id) values ($1)", [W]);
await db.query("insert into public.acq_agent_prompts (business_id, body) values ($1, 'Live prompt')", [W]);
ok(await fails(() => db.query("insert into auth.users (email, raw_user_meta_data) values ('nocode@x.co', '{}')")), "sign-up without code or invite is rejected");
const T = "a".repeat(64);
await db.query("insert into public.acq_invites (business_id, email, scopes, token, role, expires_at) values ($1, 'Tester@X.co', '{}', $2, 'tester', now() + interval '14 days')", [W, T]);
const preview = (await one("select public.preview_invite($1) p", [T])).p;
ok(preview && preview.email === "Tester@X.co" && preview.role === "tester", "preview_invite shows the acq invite email and role");
ok(await fails(() => db.query("insert into auth.users (email, raw_user_meta_data) values ('other@x.co', $1)", [JSON.stringify({ invite_token: T })])), "invite token for a different email is rejected");
ok(await fails(() => db.query("insert into auth.users (email, raw_user_meta_data) values ('tester@x.co', $1)", [JSON.stringify({ invite_token: "b".repeat(64) })])), "unknown invite token is rejected");
const TU = (await one("insert into auth.users (email, raw_user_meta_data) values ('tester@x.co', $1) returning id, raw_user_meta_data m", [JSON.stringify({ invite_token: T, full_name: "Tess" })]));
ok(!("invite_token" in TU.m) && !("access_code" in TU.m), "invite token is not kept on the user");
const tester = TU.id;
ok((await one("select role from public.acq_members where business_id = $1 and user_id = $2", [W, tester]))?.role === "tester", "tester sign-up adds the tester membership");
ok((await one("select count(*)::int n from public.acq_workspaces where owner_id = $1", [tester])).n === 0, "tester sign-up does not open an empty business of their own");
ok((await one("select accepted_at is not null a from public.acq_invites where token = $1", [T])).a, "invite is marked accepted");
await as(tester, async () => {
  ok((await one("select public.acq_can_read($1) v", [W])).v === false, "tester: acq_can_read is false");
  ok((await one("select public.acq_can_edit($1) v", [W])).v === false, "tester: acq_can_edit is false");
  const acc = (await one("select public.acq_access($1) a", [W])).a;
  ok(acc.role === "tester" && acc.can_test === true && acc.can_edit === false && acc.can_edit_prompt === false && acc.can_manage_team === false, "tester: acq_access = test only " + JSON.stringify(acc));
  const mine = (await db.query("select * from public.acq_my_tester_businesses()")).rows;
  ok(mine.length === 1 && mine[0].business_id === W && mine[0].role === "tester", "tester: acq_my_tester_businesses lists the one business");
  ok((await db.query("select * from public.acq_workspaces")).rows.length === 0, "tester: acq_workspaces RLS shows nothing (function gates stay closed)");
  ok((await db.query("select * from public.acq_settings")).rows.length === 0, "tester: cannot read settings");
  ok((await db.query("select * from public.acq_agent_prompts")).rows.length === 0, "tester: cannot read prompt rows directly");
  ok((await db.query("update public.acq_settings set system_enabled = true returning agent_id")).rows.length === 0, "tester: cannot flip the live switch");
  ok((await db.query("update public.acq_agent_prompts set body = 'hacked' returning business_id")).rows.length === 0, "tester: cannot write the prompt");
  ok((await db.query("select * from public.acq_invites")).rows.length === 0, "tester: cannot read invite tokens");
  ok(await fails(() => db.query("insert into public.acq_invites (business_id, email, scopes, token, role) values ($1, 'x@y.co', '{}', $2, 'editor')", [W, "c".repeat(64)])), "tester: cannot create invites");
  const again = (await one("select public.acq_accept_invite($1) r", [T])).r;
  ok(again.ok === true && again.role === "tester" && again.business_id === W, "tester: accepting the same invite again is ok and keeps the role");
});
ok((await one("select body from public.acq_agent_prompts where business_id = $1", [W])).body === "Live prompt", "live prompt unchanged");
ok((await one("select system_enabled from public.acq_settings where agent_id = $1", [W])).system_enabled === false, "live switch unchanged");
await as(E, async () => {
  const acc = (await one("select public.acq_access($1) a", [W])).a;
  ok(acc.role === "editor" && acc.can_edit && acc.can_test && !acc.can_manage_team, "editor: full edit, no team " + JSON.stringify(acc));
  ok((await one("select public.acq_can_read($1) v", [W])).v === true, "editor: still reads");
  ok((await db.query("select * from public.acq_invites")).rows.length === 0, "editor: cannot read invite tokens any more");
  ok(await fails(() => db.query("insert into public.acq_invites (business_id, email, scopes, token) values ($1, 'x@y.co', '{}', $2)", [W, "d".repeat(64)])), "editor: cannot create invites any more");
});
await as(O, async () => {
  const acc = (await one("select public.acq_access($1) a", [W])).a;
  ok(acc.role === "owner" && acc.can_manage_team && acc.can_edit, "owner: manages team " + JSON.stringify(acc));
  ok((await db.query("select * from public.acq_invites")).rows.length === 1, "owner: sees invites");
  await db.query("insert into public.acq_invites (business_id, email, scopes, token, role) values ($1, 'editor@x.co', '{}', $2, 'prompt_editor')", [W, "e".repeat(64)]);
  ok(true, "owner: can create invites");
});
await as(E, async () => {
  const r = (await one("select public.acq_accept_invite($1) r", ["e".repeat(64)])).r;
  ok(r.role === "prompt_editor", "existing account accepting a prompt_editor invite gets that role");
  const acc = (await one("select public.acq_access($1) a", [W])).a;
  ok(acc.can_edit === false && acc.can_test && acc.can_edit_prompt, "prompt_editor: test + prompt, no edit " + JSON.stringify(acc));
});
await as(A, async () => {
  const acc = (await one("select public.acq_access($1) a", [W])).a;
  ok(acc.role === "admin" && acc.can_manage_team && acc.can_edit, "admin: everything");
});
await as(O, async () => {
  ok((await db.query("select public.acq_access($1) a", ["44444444-4444-4444-4444-444444444444"])).rows[0].a.can_test === false, "unknown business: nothing");
});
await db.query("insert into public.acq_invites (business_id, email, scopes, token, role, expires_at) values ($1, 'late@x.co', '{}', $2, 'tester', now() - interval '1 day')", [W, "f".repeat(64)]);
ok(await fails(() => db.query("insert into auth.users (email, raw_user_meta_data) values ('late@x.co', $1)", [JSON.stringify({ invite_token: "f".repeat(64) })])), "expired invite cannot sign up");
ok((await one("select public.preview_invite($1) p", ["f".repeat(64)])).p === null, "expired invite has no preview");
await as(null, async () => {
  ok((await one("select public.acq_access($1) a", [W])).a.can_test === false, "signed out: nothing");
});
console.log(failures ? failures + " FAILED" : "ALL PASSED");
process.exit(failures ? 1 : 0);
