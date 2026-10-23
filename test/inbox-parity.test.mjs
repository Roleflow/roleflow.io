import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { collectLeads, filterLeads } from "../acquire/studio-model.js";
import { leadAllowsAutoReply, manualSendError, manualSendRequest, shouldAutoReply } from "../supabase/functions/_shared/inbox-send.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const leads = collectLeads(
  [
    { id: "c1", name: "Ada", ig_handle: "ada", crm_state: "qualifying", tags: ["hot"], ai_enabled: true, unread_count: 2, message_count: 3 },
    { id: "c2", name: "Sam", ig_handle: "sam", crm_state: "open", tags: [], ai_enabled: false, unread_count: 0, message_count: 1 }
  ],
  []
);
assert.equal(leads[0].unread, 2);
assert.equal(leads[1].ai, false);
assert.deepEqual(filterLeads(leads, { unread: "yes" }).map((lead) => lead.handle), ["ada"]);
assert.deepEqual(filterLeads(leads, { ai: "off" }).map((lead) => lead.handle), ["sam"]);
assert.deepEqual(filterLeads(leads, { state: "qualifying", tag: "hot" }).map((lead) => lead.handle), ["ada"]);
assert.equal(filterLeads(leads, { ai: "on", unread: "no" }).length, 0);

assert.equal(leadAllowsAutoReply(null), true);
assert.equal(leadAllowsAutoReply({ ai_enabled: true }), true);
assert.equal(leadAllowsAutoReply({ ai_enabled: false }), false);
assert.equal(shouldAutoReply(false, { ai_enabled: true }), false);
assert.equal(shouldAutoReply(true, { ai_enabled: false }), false);
assert.equal(shouldAutoReply(true, { ai_enabled: true }), true);

const request = manualSendRequest({ accountId: "acct-1", conversationId: "conv/1", text: "  Hello there  " });
assert.equal(request.path, "/inbox/conversations/" + encodeURIComponent("conv/1") + "/messages");
assert.deepEqual(request.body, { accountId: "acct-1", message: "Hello there" });
assert.equal(manualSendRequest({ accountId: "a", conversationId: "c", text: "x".repeat(1200) }).body.message.length, 1000);
assert.equal(manualSendError(409, { code: "not_thread_owner" }), "Another app owns this Instagram thread.");
assert.equal(manualSendError(409, { error: { code: "not_thread_owner" } }), "Another app owns this Instagram thread.");
assert.equal(manualSendError(200, {}), "");
assert.equal(manualSendError(500, {}), "The reply was not sent.");

const sql = read("supabase/migrations/20261023120000_inbox_live.sql");
assert.match(sql, /unread_count integer not null default 0/);
assert.match(sql, /on conflict \(conversation_id, external_id\) do nothing/);
assert.match(sql, /if v_message is not null then/);
assert.match(sql, /when p_kind = 'sent' then unread_count/);
assert.match(sql, /else unread_count \+ 1/);
assert.doesNotMatch(sql, /net\.http_post|instagram\.com\/v\d+/);

const webhook = read("supabase/functions/zernio-webhook/index.ts");
assert.match(webhook, /shouldAutoReply/);
assert.match(webhook, /if \(!shouldAutoReply\(true, lead\.data\)\) return;/);
assert.doesNotMatch(webhook, /console\.log/);

const sender = read("supabase/functions/inbox-reply/index.ts");
assert.match(sender, /acq_can_edit/);
assert.match(sender, /Instagram is not connected yet/);
assert.match(sender, /manualSendRequest/);
assert.match(sender, /role: "assistant"/);
assert.doesNotMatch(sender, /console\.log/);

const panel = ["acquire/app.js", "acquire/studio-flow.js", "acquire/studio-model.js", "acquire/acquire.css"].map(read).join("\n");
assert.match(panel, /unread_count/);
assert.match(panel, /Send reply/);
assert.match(panel, /Save reminder/);
assert.match(panel, /functions\.invoke\("inbox-reply"/);
assert.doesNotMatch(panel, /zernio|tailortalk|TailorTalk/i);
assert.match(read("supabase/config.toml"), /\[functions\.inbox-reply\]\s+verify_jwt = true/);
