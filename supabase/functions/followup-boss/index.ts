// Follow-up tick. verify_jwt is false. pg_cron sends the acquisition
// cron secret (private.acquisition_settings key cron_secret, read with
// acq_read_cron_secret). The 24-hour ladder and welcome steps are queued from
// acq_followup_steps and acq_welcome_steps. Nothing is queued while the
// follow-up agent is off; while DM sending is off a due step is held.
//
// This function does not read ZERNIO_API_KEY. The outbox tick sends the row
// only when the follow-up switch is still on.
// Do not set TAILORTALK_SYNC_ENABLED. Leaving it unset keeps the retired sync off.

import { adminClient, json } from "../_shared/gateway-http.js";
import { queueFollowups } from "../_shared/followup-queue.js";

const FOLLOWUP_SETTINGS = "agent_id, timezone, system_enabled, followup_restart_on_reply, followup_before_close, skip_followed, office_mode, office_start, office_end";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "POST required." });
  const admin = adminClient();
  const secret = await admin.rpc("acq_read_cron_secret");
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!secret.data || bearer !== secret.data) return json(401, { ok: false, error: "Unauthorized." });
  const businesses = await admin.from("acq_settings").select(FOLLOWUP_SETTINGS).eq("system_enabled", true);
  if (businesses.error) return json(500, { ok: false, error: "Could not read businesses." });
  let queued = 0;
  for (const settings of businesses.data || []) {
    queued += await queueBusiness(admin, settings);
  }
  return json(200, { ok: true, queued });
});

async function queueBusiness(admin, settings) {
  const result = await queueFollowups(admin, settings, Date.now());
  return result.queued;
}
