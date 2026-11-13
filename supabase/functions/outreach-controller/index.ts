// Disabled command callback for a future worker session.
// Do not deploy this function. Do not set OUTREACH_CONTROLLER_ENABLED.
// While that flag is unset, every call returns 503 before a database client,
// a network delivery, or a message send exists.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { readWorkerJwt } from "../_shared/outreacher-controller.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, error: "POST required." });
  if (Deno.env.get("OUTREACH_CONTROLLER_ENABLED") !== "1") {
    return json(503, { ok: false, status: "disabled", error: "Controller delivery is off." });
  }
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const verified = await readWorkerJwt(bearer, Deno.env.get("OUTREACHER_JWT_PUBLIC_KEY") || "", Date.now());
  if (!verified.ok) return json(401, { ok: false, error: "Unauthorized." });
  let body: { action?: string; profile_id?: string; command_id?: string; outcome?: string; result_key?: string; activity?: unknown } = {};
  try { body = await req.json(); } catch { body = {}; }
  const action = String(body.action || "");
  if (action !== "pickup" && action !== "ack" && action !== "result") {
    return json(400, { ok: false, error: "That action is not available." });
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const workerId = verified.claims.worker_id;
  const profileId = String(body.profile_id || "");
  const commandId = String(body.command_id || "");
  const result = action === "result"
    ? await admin.rpc("outreacher_record_result", {
      p_worker: workerId,
      p_profile: profileId,
      p_command: commandId,
      p_outcome: String(body.outcome || ""),
      p_result_key: String(body.result_key || ""),
      p_activity: Array.isArray(body.activity) ? body.activity : []
    })
    : await admin.rpc(action === "pickup" ? "outreacher_pickup" : "outreacher_ack", {
      p_worker: workerId,
      p_profile: profileId,
      p_command: commandId
    });
  if (result.error) return json(503, { ok: false, status: "offline", error: "The controller could not be reached." });
  const payload = result.data || { ok: false, reason: "offline" };
  return json(payload.ok === true ? 200 : 409, payload);
});
