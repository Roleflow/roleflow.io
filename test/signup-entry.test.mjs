import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inviteDestination, joinDestination } from "../signup/entry.js";

const root = path.resolve(import.meta.dirname, "..");
const signup = fs.readFileSync(path.join(root, "signup/signup.js"), "utf8");

assert.deepEqual(inviteDestination("agent-1", null, ""), {
  ok: true,
  href: "/account/acquisition/#dashboard"
});
assert.equal(inviteDestination(null, { business_id: "biz 1" }, "").href, "/account/acquisition/?business=biz%201#dashboard");
assert.equal(inviteDestination(null, null, "That invite is no longer open").ok, false);
assert.match(inviteDestination(null, null, "").message, /could not be accepted/);
assert.equal(joinDestination({ ok: true, business_id: "biz" }, "").href, "/account/acquisition/?business=biz#dashboard");
assert.match(joinDestination({ ok: false, error: "That join code does not match a business." }, "").message, /does not match/);
assert.match(signup, /acq_accept_invite/);
assert.match(signup, /acq_join_workspace/);
assert.match(signup, /inviteDestination/);
assert.doesNotMatch(signup, /supabase\.auth\.getUser\(\)/);
assert.match(signup, /inviteOk && inviteEmail\(\)\.toLowerCase\(\) === sessionEmail/);

console.log("signup entry tests passed");
