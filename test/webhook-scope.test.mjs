import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  SCOPE_EXCEPTION_COPY,
  ensureWebhookScope,
  inboundWebhookUrl,
  matchingHooks,
  scopePatch
} from "../supabase/functions/_shared/webhook-scope.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const fn = inboundWebhookUrl("https://xrsipofgofvjiskmsgij.supabase.co/");
assert.equal(fn, "https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/zernio-webhook");
assert.equal(inboundWebhookUrl(""), "");

const ours = { _id: "w1", url: fn, events: ["message.received"], accountIds: ["acc_roleflow"], profileIds: [] };
const other = { _id: "w2", url: "https://elsewhere.example/hook", accountIds: ["x"] };
assert.deepEqual(matchingHooks([ours, other], fn).map((hook) => hook._id), ["w1"]);
assert.deepEqual(matchingHooks([{ ...ours, url: fn + "/" }], fn).length, 1);
assert.deepEqual(matchingHooks([ours], ""), []);

// Only appends; never resends url, events or secret.
assert.deepEqual(scopePatch(ours, "acc_vam"), { webhookId: "w1", accountIds: ["acc_roleflow", "acc_vam"] });
assert.equal(scopePatch(ours, "acc_roleflow"), null);
assert.equal(scopePatch({ ...ours, accountIds: [] }, "acc_vam"), null, "unscoped already hears every account");
assert.equal(scopePatch(ours, ""), null);

function fakeApi(hooks, options) {
  const opts = options || {};
  const calls = [];
  let state = hooks.map((hook) => ({ ...hook }));
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (init.method === "GET") return { ok: true, status: 200, json: async () => ({ webhooks: state }) };
    if (opts.failPut) return { ok: false, status: 500, json: async () => ({}) };
    const body = JSON.parse(init.body);
    if (!opts.ignorePut) state = state.map((hook) => hook._id === body.webhookId ? { ...hook, accountIds: body.accountIds } : hook);
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  return { calls, fetchImpl, state: () => state };
}

// Adds the new account and confirms it on read back.
const api = fakeApi([ours, other]);
const added = await ensureWebhookScope({ apiKey: "k", accountId: "acc_vam", functionUrl: fn, fetchImpl: api.fetchImpl });
assert.deepEqual(added, { ok: true, reason: "added", changed: ["w1"] });
const put = api.calls.find((call) => call.method === "PUT");
assert.equal(put.url, "https://zernio.com/api/v1/webhooks/settings");
assert.deepEqual(Object.keys(put.body).sort(), ["accountIds", "webhookId"]);
assert.deepEqual(api.state()[0].accountIds, ["acc_roleflow", "acc_vam"]);
assert.deepEqual(api.state()[1].accountIds, ["x"], "other webhooks untouched");

// Idempotent: a second connect of the same account changes nothing.
const again = await ensureWebhookScope({ apiKey: "k", accountId: "acc_vam", functionUrl: fn, fetchImpl: api.fetchImpl });
assert.deepEqual(again, { ok: true, reason: "already_listed", changed: [] });
assert.equal(api.calls.filter((call) => call.method === "PUT").length, 1);

// Failures are reported, never thrown.
assert.equal((await ensureWebhookScope({ apiKey: "k", accountId: "a", functionUrl: fn, fetchImpl: fakeApi([ours], { failPut: true }).fetchImpl })).reason, "update_failed");
assert.equal((await ensureWebhookScope({ apiKey: "k", accountId: "a", functionUrl: fn, fetchImpl: fakeApi([ours], { ignorePut: true }).fetchImpl })).reason, "not_confirmed");
assert.equal((await ensureWebhookScope({ apiKey: "k", accountId: "a", functionUrl: fn, fetchImpl: fakeApi([other]).fetchImpl })).reason, "no_webhook");
assert.equal((await ensureWebhookScope({ apiKey: "k", accountId: "a", functionUrl: fn, fetchImpl: async () => { throw new Error("down"); } })).reason, "request_failed");
assert.equal((await ensureWebhookScope({ apiKey: "", accountId: "a", functionUrl: fn })).reason, "not_configured");
const profiled = await ensureWebhookScope({ apiKey: "k", accountId: "a", functionUrl: fn, fetchImpl: fakeApi([{ ...ours, profileIds: ["p1"] }]).fetchImpl });
assert.equal(profiled.ok, false);
assert.equal(profiled.reason, "profile_scoped");

// The connect flow calls it after a successful save and flags failures without failing the connect.
const finish = read("supabase/functions/ig-connect-finish/index.ts");
assert.ok(finish.indexOf("acq_gateway_connect_account") < finish.indexOf("await listenToAccount("));
assert.match(finish, /kind: SCOPE_EXCEPTION_KIND/);
assert.match(finish, /from\("acq_exceptions"\)\.insert/);
assert.doesNotMatch(SCOPE_EXCEPTION_COPY, /zernio/i);

console.log("webhook scope tests passed");
