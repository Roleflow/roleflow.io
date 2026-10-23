// One-minute tick. Claims due official-transport outbox rows and sends each once.
// pg_cron calls this with the acquisition cron secret. verify_jwt stays off.

import { adminClient, json, loadGatewayConfig } from "../_shared/gateway-http.js";
import { outboxWriteStatus } from "../_shared/ig-gateway.js";
import { postOfficial } from "../_shared/official-outbox.js";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "POST required." });
  const admin = adminClient();
  const secret = await admin.rpc("acq_read_cron_secret");
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!secret.data || bearer !== secret.data) return json(401, { ok: false, error: "Unauthorized." });
  const config = await loadGatewayConfig(admin);
  if (!config.apiKey) return json(200, { ok: true, claimed: 0, sent: 0 });
  const claimed = await admin.rpc("acq_claim_gateway_outbox", { p_limit: 5 });
  if (claimed.error) return json(500, { ok: false, error: "Could not claim the outbox." });
  const rows = claimed.data || [];
  let sent = 0;
  for (const row of rows) {
    const result = await postOfficial(row, config.apiKey, fetch);
    const written = outboxWriteStatus(result);
    await admin.from("ig_outbox").update({ status: written.status, last_error: written.last_error }).eq("id", row.id).eq("status", "running");
    if (!result.ok) continue;
    sent += 1;
    await recordSent(admin, row);
  }
  return json(200, { ok: true, claimed: rows.length, sent });
});

async function recordSent(admin, row) {
  const text = String(row.payload && row.payload.text || "").slice(0, 4000);
  const conversationId = row.payload && row.payload.conversationRowId;
  if (conversationId) {
    await admin.from("acq_messages").insert({
      business_id: row.business_id,
      conversation_id: conversationId,
      external_id: "out:" + row.id,
      role: "assistant",
      body: text,
      sent_at: new Date().toISOString()
    });
  }
  if (row.thread_id) {
    await admin.from("ig_messages").insert({
      business_id: row.business_id,
      thread_id: row.thread_id,
      direction: "out",
      body: text,
      kind: "text"
    });
  }
}
