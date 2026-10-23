import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { gatewayConfigFrom } from "./ig-gateway.js";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}

export function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export function userClientFrom(req) {
  return createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "", {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export async function loadGatewayConfig(admin) {
  const env = {
    ZERNIO_API_KEY: Deno.env.get("ZERNIO_API_KEY") || "",
    ZERNIO_WEBHOOK_SECRET: Deno.env.get("ZERNIO_WEBHOOK_SECRET") || ""
  };
  if (env.ZERNIO_API_KEY && env.ZERNIO_WEBHOOK_SECRET) return gatewayConfigFrom(env, {});
  const stored = await admin.rpc("acq_read_gateway_settings");
  return gatewayConfigFrom(env, stored.error ? {} : stored.data || {});
}
