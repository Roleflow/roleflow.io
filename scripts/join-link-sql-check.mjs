// SQL check for 20261111180000_join_link_least_privilege.sql, in an in-memory
// Postgres (PGlite). Loads the same stand-in as business-testers-sql-check.mjs,
// applies 20261111120000_business_testers.sql and then this migration, and
// acts as owner, editor, stranger, and admin. Nothing touches the hosted
// database.
//
//   npm i --no-save @electric-sql/pglite
//   node scripts/join-link-sql-check.mjs
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(fs.readFileSync(path.join(root, "test/fixtures/business-testers-stub.sql"), "utf8"));
// The old live functions this migration replaces (copied from live, 11 Nov 2026).
await db.exec(`
create or replace function public.acq_join_workspace(p_code text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  select id into v_id from public.acq_workspaces where join_code = lower(btrim(coalesce(p_code, '')));
  if v_id is null then return jsonb_build_object('ok', false, 'error', 'That join code does not match a business.'); end if;
  insert into public.acq_members (business_id, user_id, role, status) values (v_id, auth.uid(), 'editor', 'active')
  on conflict (business_id, user_id) do update set status = 'active', role = case when public.acq_members.role = 'owner' then 'owner' else 'editor' end;
  return jsonb_build_object('ok', true, 'business_id', v_id);
end; $$;
create or replace function public.acq_regenerate_join_code(p_business uuid) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_code text;
begin
  if auth.uid() is null or not public.acq_can_edit(p_business) then raise exception 'You cannot change this invite link'; end if;
  v_code := lower(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
  update public.acq_workspaces set join_code = v_code where id = p_business;
  return jsonb_build_object('ok', true, 'join_code', v_code);
end; $$;
grant execute on function public.acq_join_workspace(text) to authenticated;
grant execute on function public.acq_regenerate_join_code(uuid) to authenticated;
`);
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
const S = "44444444-4444-4444-4444-444444444444", S2 = "55555555-5555-5555-5555-555555555555", V = "66666666-6666-6666-6666-666666666666";
await db.query(`insert into auth.users (id, email, raw_user_meta_data) values
  ($1, 'owner@x.co', '{"access_code":"Code2026"}'), ($2, 'editor@x.co', '{"access_code":"Code2026"}'), ($3, 'diego@roleflow.io', '{"access_code":"Code2026"}'),
  ($4, 'stranger@x.co', '{"access_code":"Code2026"}'), ($5, 'stranger2@x.co', '{"access_code":"Code2026"}'), ($6, 'viewer@x.co', '{"access_code":"Code2026"}')`, [O, E, A, S, S2, V]);
const W = (await one("select id from public.acq_workspaces where owner_id = $1", [O])).id;
await db.query("insert into public.acq_members (business_id, user_id, role) values ($1, $2, 'editor'), ($1, $3, 'viewer')", [W, E, V]);
await db.query("update public.acq_workspaces set join_code = 'abcd1234' where id = $1", [W]);

// Before: the old code made a stranger an Editor.
await as(S2, async () => {
  const r = (await one("select public.acq_join_workspace('abcd1234') r")).r;
  ok(r.ok === true, "before: old code joins");
});
ok((await one("select role from public.acq_members where business_id = $1 and user_id = $2", [W, S2])).role === "editor", "before: old code granted Editor (the hole)");
await db.query("delete from public.acq_members where user_id = $1", [S2]);

await db.exec(fs.readFileSync(path.join(root, "supabase/migrations/20261111180000_join_link_least_privilege.sql"), "utf8"));

ok((await one("select count(*)::int n from public.acq_workspaces where join_code is not null")).n === 0, "old join codes are cleared");
await as(S, async () => {
  const r = (await one("select public.acq_join_workspace('abcd1234') r")).r;
  ok(r.ok === false, "old code no longer joins");
});
ok(!(await one("select 1 x from public.acq_members where business_id = $1 and user_id = $2", [W, S])), "stranger did not get in with the old code");

// Editors and viewers can't create, read, or remove the link.
await as(E, async () => {
  ok(await fails(() => db.query("select public.acq_regenerate_join_code($1)", [W])), "editor cannot create a link");
  ok(await fails(() => db.query("insert into public.acq_join_links (business_id, code, role) values ($1, '0123456789abcdef01234567', 'editor')", [W])), "editor cannot insert a link row");
});
await as(V, async () => {
  ok(await fails(() => db.query("select public.acq_regenerate_join_code($1, 'editor')", [W])), "viewer cannot create a link");
});
await as(S, async () => {
  ok(await fails(() => db.query("select public.acq_regenerate_join_code($1)", [W])), "stranger cannot create a link");
});
ok(await fails(() => as(null, () => db.query("select public.acq_regenerate_join_code($1)", [W]))), "signed out cannot create a link");

// Owner creates a default link: Tester.
let code;
await as(O, async () => {
  const r = (await one("select public.acq_regenerate_join_code($1) r", [W])).r;
  code = r.join_code;
  ok(r.ok && r.role === "tester" && /^[0-9a-f]{24}$/.test(code), "owner: default link is Tester with a 24-hex code " + JSON.stringify(r));
  ok((await db.query("select * from public.acq_join_links")).rows.length === 1, "owner: sees the link");
  ok(await fails(() => db.query("select public.acq_regenerate_join_code($1, 'owner')", [W])), "owner: cannot make an owner link");
  ok(await fails(() => db.query("select public.acq_regenerate_join_code($1, 'viewer')", [W])), "owner: unknown link role is refused");
  ok(await fails(() => db.query("update public.acq_join_links set role = 'editor'")) || (await db.query("select role from public.acq_join_links")).rows[0].role === "tester", "owner: cannot edit the row directly");
});
await as(E, async () => {
  ok((await db.query("select * from public.acq_join_links")).rows.length === 0, "editor: cannot read the link");
  ok((await db.query("delete from public.acq_join_links returning business_id")).rows.length === 0, "editor: cannot remove the link");
});
await as(S, async () => {
  ok((await db.query("select * from public.acq_join_links")).rows.length === 0, "stranger: cannot read links");
  const r = (await one("select public.acq_join_workspace($1) r", [code.toUpperCase() + " "])).r;
  ok(r.ok === true && r.role === "tester" && r.business_id === W, "stranger joins with the link as Tester " + JSON.stringify(r));
  const acc = (await one("select public.acq_access($1) a", [W])).a;
  ok(acc.can_edit === false && acc.can_manage_team === false && acc.can_test === true, "joined tester: no edit, no team, practice chat only");
  ok((await one("select public.acq_can_edit($1) v", [W])).v === false, "joined tester: cannot reach the live switch (acq_can_edit false)");
});
// Joining never changes an existing member's role.
await as(V, async () => {
  const r = (await one("select public.acq_join_workspace($1) r", [code])).r;
  ok(r.ok && r.role === "viewer", "viewer who joins keeps Viewer");
});
await as(E, async () => {
  const r = (await one("select public.acq_join_workspace($1) r", [code])).r;
  ok(r.ok && r.role === "editor", "editor who joins keeps Editor (not downgraded)");
});
await as(O, async () => {
  const r = (await one("select public.acq_join_workspace($1) r", [code])).r;
  ok(r.ok && r.role === "owner", "owner opening their own link stays owner");
});
ok(((await one("select role from public.acq_members where business_id = $1 and user_id = $2", [W, O])) || { role: "owner" }).role === "owner", "owner's member row (if any) is still owner");

// Owner picks Editor explicitly; the old link stops working.
let editorCode;
await as(O, async () => {
  const r = (await one("select public.acq_regenerate_join_code($1, 'editor') r", [W])).r;
  editorCode = r.join_code;
  ok(r.role === "editor" && editorCode !== code, "owner: explicit Editor link replaces the old one");
});
await as(S2, async () => {
  ok((await one("select public.acq_join_workspace($1) r", [code])).r.ok === false, "replaced link no longer joins");
  const r = (await one("select public.acq_join_workspace($1) r", [editorCode])).r;
  ok(r.ok && r.role === "editor", "explicit Editor link joins as Editor");
});
// Owner turns the link off.
await as(O, async () => {
  ok((await db.query("delete from public.acq_join_links where business_id = $1 returning business_id", [W])).rows.length === 1, "owner: turns the link off");
});
await as(S, async () => {
  ok((await one("select public.acq_join_workspace($1) r", [editorCode])).r.ok === false, "turned-off link no longer joins");
});
// Admin can manage any business's link.
await as(A, async () => {
  const r = (await one("select public.acq_regenerate_join_code($1, 'prompt_editor') r", [W])).r;
  ok(r.ok && r.role === "prompt_editor", "admin: can create a link");
});
ok(await fails(() => as(null, () => db.query("select public.acq_join_workspace($1)", [editorCode]))), "signed out cannot join");

console.log(failures ? failures + " FAILED" : "ALL PASS");
process.exit(failures ? 1 : 0);
