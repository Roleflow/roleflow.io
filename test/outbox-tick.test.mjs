import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { claimOfficial, INLINE_WAIT_SECONDS, officialReady, postOfficial, waitsInline } from "../supabase/functions/_shared/official-outbox.js";
import { outboxWriteStatus } from "../supabase/functions/_shared/ig-gateway.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const due = Date.parse("2026-10-23T10:59:49.000Z");
const pending = {
  id: "f5e0d558-b19c-4e75-8f1c-42dcf59a2973",
  transport: "official",
  status: "pending",
  attempts: 0,
  run_at: "2026-10-23T10:59:48.611Z",
  idempotency_key: "gw:8f8fcc5f-819f-490c-8a82-c5a7d9e0e3f0",
  payload: { text: "What does your AI agency specialize in?", conversationId: "2108532849767337", accountId: "acct" },
  agent_enabled: true
};

assert.equal(INLINE_WAIT_SECONDS, 25);
assert.equal(waitsInline(25), true);
assert.equal(waitsInline(26), false);
assert.equal(waitsInline(95), false);
assert.equal(officialReady(pending, due), true);
assert.equal(officialReady(pending, Date.parse("2026-10-23T10:59:00.000Z")), false);
assert.equal(officialReady({ ...pending, transport: "meta" }, due), false);
assert.equal(officialReady({ ...pending, status: "running" }, due), false);
assert.equal(officialReady({ ...pending, payload: { text: "Hi", needsPlan: true } }, due), false);
assert.equal(officialReady({ ...pending, payload: { text: "  " } }, due), false);

const first = claimOfficial([pending, { ...pending, id: "copy" }], due);
assert.equal(first.length, 1);
assert.equal(first[0].id, pending.id);
assert.equal(first[0].status, "running");
assert.equal(first[0].attempts, 1);
assert.equal(first[0].idempotency_key, pending.idempotency_key);
const second = claimOfficial([{ ...pending, status: "running", attempts: 1 }], due);
assert.equal(second.length, 0);

const calls = [];
const result = await postOfficial(first[0], "test-key", async (url, init) => {
  calls.push({ url, init });
  return { status: 200, json: async () => ({ ok: true }) };
});
assert.equal(result.ok, true);
assert.equal(calls.length, 1);
assert.equal(calls[0].url, "https://zernio.com/api/v1/inbox/conversations/2108532849767337/messages");
assert.equal(calls[0].init.headers.Authorization, "Bearer test-key");
assert.equal(JSON.parse(calls[0].init.body).message, "What does your AI agency specialize in?");
assert.deepEqual(outboxWriteStatus(result), { status: "done", last_error: null });
assert.equal(claimOfficial([{ ...pending, status: "running", attempts: 1 }], due).length, 0);
assert.equal(calls.length, 1);

const tick = read("supabase/functions/ig-outbox-tick/index.ts");
const sql = read("supabase/migrations/20261023160000_ig_outbox_tick.sql");
const hook = read("supabase/functions/zernio-webhook/index.ts");
assert.match(hook, /wait > 25/);
assert.match(tick, /acq_claim_gateway_outbox/);
assert.match(tick, /acq_read_cron_secret/);
assert.match(tick, /eq\("status", "running"\)/);
assert.doesNotMatch(tick, /ZERNIO_API_KEY\s*=/);
assert.match(sql, /transport = 'official'/);
assert.match(sql, /for update skip locked/);
assert.match(sql, /needsPlan/);
assert.match(sql, /cron\.schedule\(\s*'ig-outbox-tick',\s*'\* \* \* \* \*'/);
assert.match(sql, /functions\/v1\/ig-outbox-tick/);
assert.doesNotMatch(sql, /transport = 'meta'/);
assert.match(read("supabase/config.toml"), /\[functions\.ig-outbox-tick\]\nverify_jwt = false/);

console.log("outbox tick tests passed");
