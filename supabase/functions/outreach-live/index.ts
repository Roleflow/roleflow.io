// Ten-minute ticket for one business's browser. verify_jwt stays on.
// The relay checks the ticket and consumes it. This change does not deploy the function.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { LIVE_TICKET_TTL_MS, randomToken } from "../_shared/outreacher-token.js";
import { hmacHex } from "../_shared/outreacher-token.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function b64url(text: string) {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, error: "POST required." });
  const secret = Deno.env.get("OUTREACH_LIVE_SECRET") || "";
  if (!secret) return json(200, { ok: false, error: "The browser is not available right now. Contact Roleflow support." });
  const admin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const userClient = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_ANON_KEY") || "", {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const user = await userClient.auth.getUser();
  if (!user.data.user) return json(401, { ok: false, error: "Sign in again." });
  let body: { business_id?: string } = {};
  try { body = await req.json(); } catch { body = {}; }
  const businessId = String(body.business_id || "");
  const allowed = await userClient.rpc("acq_can_edit", { p_workspace: businessId });
  if (allowed.error || allowed.data !== true) return json(403, { ok: false, error: "You cannot open this browser." });
  const machine = await admin.from("client_machines").select("id, business_id, status, revoked_at").eq("business_id", businessId).neq("status", "deleted").limit(1).maybeSingle();
  const row = machine.data;
  if (!row || row.revoked_at || !["awaiting_login", "running", "paused"].includes(row.status)) {
    return json(409, { ok: false, error: "The outreacher is not ready yet." });
  }
  const now = Date.now();
  const payload = {
    aud: "outreach-live",
    business_id: row.business_id,
    machine_id: row.id,
    jti: randomToken(16),
    exp: Math.floor((now + LIVE_TICKET_TTL_MS) / 1000)
  };
  const bodyText = b64url(JSON.stringify(payload));
  const sig = await hmacHex(secret, bodyText);
  await admin.rpc("outreacher_save_ticket", {
    p_jti: payload.jti,
    p_machine: row.id,
    p_expires: new Date(payload.exp * 1000).toISOString()
  });
  const origin = (Deno.env.get("OUTREACH_RELAY_URL") || "https://live.roleflow.io").replace(/\/$/, "");
  return json(200, {
    ok: true,
    url: origin + "/view#ticket=" + bodyText + "." + sig,
    expires_in: Math.floor(LIVE_TICKET_TTL_MS / 1000)
  });
});
