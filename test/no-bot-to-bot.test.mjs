import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONNECTED_SENDER_MAX_OUT, connectedSenderAllowed, fromConnectedAccount } from "../supabase/functions/_shared/ig-gateway.js";

const connected = ["valueaddmarketing", "roleflow.io", null];
assert.equal(fromConnectedAccount("valueaddmarketing", connected), true);
assert.equal(fromConnectedAccount("@RoleFlow.io ", connected), true);
assert.equal(fromConnectedAccount("some_real_lead", connected), false);
assert.equal(fromConnectedAccount("", connected), false);

// Real leads: always answered. Connected accounts (an owner testing): answered,
// until the setter has sent 8 messages to that thread in 30 minutes.
assert.equal(connectedSenderAllowed(false, 999), true);
assert.equal(connectedSenderAllowed(true, 0), true);
assert.equal(connectedSenderAllowed(true, CONNECTED_SENDER_MAX_OUT - 1), true);
assert.equal(connectedSenderAllowed(true, CONNECTED_SENDER_MAX_OUT), false);

const webhook = readFileSync(new URL("../supabase/functions/zernio-webhook/index.ts", import.meta.url), "utf8");
const ingest = webhook.slice(webhook.indexOf("ingest: async"), webhook.indexOf("acq_gateway_enqueue"));
assert.ok(ingest.indexOf("acq_gateway_store_inbound") < ingest.indexOf("connectedSenderOk"));
assert.match(ingest, /!await connectedSenderOk\(admin, account\.businessId, stored\.data\.thread_id, event\.username\)/);
assert.match(webhook, /from\("ig_gateway_accounts"\)\.select\("username"\)\.eq\("status", "connected"\)/);
assert.match(webhook, /\.eq\("direction", "out"\)\.gte\("created_at", since\)/);
console.log("no bot-to-bot loop: ok");
