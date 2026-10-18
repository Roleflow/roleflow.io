// Agent HQ integration API.
// An agent authenticates with the key Diego issued on the Agents page.
// Send it in X-Agent-Key. The gateway still wants the project publishable key
// in the apikey header. verify_jwt is false because the agent key is not a JWT.
//
// This function never sends email, DMs, or posts. Results are drafts.
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY are injected. No other secrets.
//
// Every action is forwarded to hq_agent_dispatch. create adds a queued task
// for this key's own agent. Optional business_id links it to a business.
// Optional station places the card. Omitted station uses the agent's home station.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-agent-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json(500, { error: "Supabase env is not configured." });

  const agentKey = (req.headers.get("X-Agent-Key") || "").trim();
  if (!/^rfhq_[0-9a-f]{64}$/i.test(agentKey)) return json(401, { error: "Unauthorized." });

  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json(400, { error: "JSON object required." });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: "JSON object required." });
  }

  const action = String(body.action || "").trim().toLowerCase();
  const payload: Record<string, unknown> = { ...body };
  delete payload.action;

  const hash = await sha256Hex(agentKey);
  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await service.rpc("hq_agent_dispatch", {
    p_key_hash: hash,
    p_action: action,
    p_payload: payload
  });
  if (error) return json(500, { error: "Could not complete that request." });
  const result = (data || {}) as { ok?: boolean; status?: number; error?: string };
  if (!result.ok) return json(Number(result.status) || 400, { error: result.error || "Request failed." });
  return json(200, result);
});

async function sha256Hex(value: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(status: number, payload: Record<string, unknown>) {
  const body = { ...payload };
  if (typeof body.error === "string") body.error = body.error.replace(/rfhq_[0-9a-f]+/gi, "[key]");
  return new Response(JSON.stringify(body), { status, headers: cors });
}
