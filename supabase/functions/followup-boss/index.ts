// Follow Up Boss tick. verify_jwt is false. pg_cron sends the acquisition
// cron secret (private.acquisition_settings key cron_secret, read with
// acq_read_cron_secret). An agent that is off, inside quiet hours, or past
// the max follow-up count is not queued.
//
// This function does not read ZERNIO_API_KEY. The outbox tick sends the row
// only when the follow-up switch is still on.
// Do not set TAILORTALK_SYNC_ENABLED. Leaving it unset keeps the retired sync off.

import { adminClient, json } from "../_shared/gateway-http.js";
import { agentEnabled, followupDue, followupLead, normalizePolicy, recoveryKey } from "../_shared/agent-control.js";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "POST required." });
  const admin = adminClient();
  const secret = await admin.rpc("acq_read_cron_secret");
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!secret.data || bearer !== secret.data) return json(401, { ok: false, error: "Unauthorized." });
  const businesses = await admin.from("acq_settings").select("agent_id, timezone, system_enabled").eq("system_enabled", true);
  if (businesses.error) return json(500, { ok: false, error: "Could not read businesses." });
  let queued = 0;
  for (const settings of businesses.data || []) {
    queued += await queueBusiness(admin, settings);
  }
  return json(200, { ok: true, queued });
});

async function queueBusiness(admin, settings) {
  const businessId = settings.agent_id;
  if (!await agentEnabled(admin, businessId, "followup")) return 0;
  const policyRow = await admin.from("acq_followup_policy").select("*").eq("business_id", businessId).maybeSingle();
  const policy = normalizePolicy(policyRow.data || {});
  const threads = await admin.from("ig_threads").select("*").eq("business_id", businessId).eq("human_locked", false).limit(100);
  if (threads.error) return 0;
  let queued = 0;
  const now = Date.now();
  for (const thread of threads.data || []) {
    const decision = followupDue({
      enabled: true,
      policy,
      lead: followupLead(thread),
      now,
      timeZone: settings.timezone
    });
    if (!decision.due) continue;
    const inserted = await admin.from("ig_outbox").insert({
      business_id: businessId,
      thread_id: thread.id,
      kind: "recovery",
      payload: { text: "", event_kind: "message" },
      run_at: new Date(now).toISOString(),
      idempotency_key: recoveryKey(thread.id, thread.followup_count)
    });
    if (inserted.error) continue;
    queued += 1;
    await admin.from("ig_threads").update({
      followup_count: (Number(thread.followup_count) || 0) + 1,
      state: thread.state === "comment_to_dm" ? "qualification" : "recovery"
    }).eq("id", thread.id).eq("business_id", businessId);
  }
  return queued;
}
