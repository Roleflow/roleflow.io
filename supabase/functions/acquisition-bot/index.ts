// Instagram browser-bot API for the acquisition pipeline.
// verify_jwt is false. This function accepts only:
//   Authorization: Bearer <rfw_...>                  per-business outreach worker key
//   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>  Roleflow ops only
// A worker key is scoped to one business. Instagram passwords are not accepted or stored.
// The publishable key is not accepted. No secret is read from the request body.
//
// Actions: ingest, queue, report, pause, voice_pick, summarize.
// Voice notes are owner recordings. voice_pick and outreach queue items include
// a one-hour signed URL. Picking a note does not count as a send. The bot
// reports voice_send after it actually sends the file.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNED_SECONDS = 60 * 60;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json(500, { error: "Supabase env is not configured." });

  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

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

  let scopedBusiness = "";
  let workerId = "";
  if (bearer.startsWith("rfw_")) {
    const auth = await service.rpc("acq_worker_auth", { p_key: bearer });
    const payload = auth.data || {};
    if (auth.error || payload.ok !== true) return json(401, { error: "Unauthorized." });
    scopedBusiness = String(payload.business_id || "");
    workerId = String(payload.worker_id || "");
  } else if (!(serviceKey && timingSafeEqual(bearer, serviceKey))) {
    return json(401, { error: "Unauthorized." });
  }

  const requested = String(body.agent_id || body.business_id || "");
  if (scopedBusiness && requested && requested !== scopedBusiness) {
    return json(403, { error: "That worker key is for a different business." });
  }
  const agentId = scopedBusiness || requested;
  if (!UUID.test(agentId)) return json(400, { error: "agent_id must be a business UUID." });
  const action = String(body.action || "");

  if (action === "ingest") {
    const targets = Array.isArray(body.targets) ? body.targets : null;
    if (!targets) return json(400, { error: "targets must be an array." });
    return call(service, "acq_bot_ingest", { p_agent: agentId, p_targets: targets });
  }
  if (action === "queue") {
    const limit = body.limit == null ? 30 : Number(body.limit);
    const result = await service.rpc("acq_bot_queue", { p_agent: agentId, p_limit: limit });
    if (result.error) return json(400, { error: result.error.message });
    const payload = result.data || {};
    if (payload.ok === false) return json(payload.status || 400, { error: payload.error || "Request failed." });
    await signQueue(service, payload);
    return json(200, payload);
  }
  if (action === "report") {
    const results = Array.isArray(body.results) ? body.results : null;
    if (!results) return json(400, { error: "results must be an array." });
    return call(service, "acq_bot_report", { p_agent: agentId, p_results: results });
  }
  if (action === "pause") {
    if (workerId) {
      const reason = String(body.reason || "");
      await service.from("acq_workers").update({
        status: "paused",
        pause_reason: ["warning", "challenge", "action_block"].includes(reason) ? reason : "warning"
      }).eq("id", workerId).eq("business_id", agentId);
    }
    return call(service, "acq_bot_pause", {
      p_agent: agentId,
      p_reason: String(body.reason || ""),
      p_notes: String(body.notes || "")
    });
  }
  if (action === "voice_pick") {
    const result = await service.rpc("acq_bot_voice", {
      p_agent: agentId,
      p_slot: String(body.slot || ""),
      p_niche: body.niche == null ? null : String(body.niche),
      p_variant: body.variant == null ? null : String(body.variant)
    });
    if (result.error) return json(400, { error: result.error.message });
    const payload = result.data || {};
    if (payload.ok === false) return json(payload.status || 400, { error: payload.error || "Request failed." });
    payload.voice_note = await signNote(service, payload.voice_note);
    return json(200, payload);
  }
  if (action === "summarize") {
    return call(service, "acq_run_chief", { p_agent: agentId, p_force_weekly: body.weekly === true });
  }
  return json(400, { error: "Unknown action." });
});

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status, headers: cors });
}

function timingSafeEqual(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (!left.length || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function call(service: ReturnType<typeof createClient>, name: string, args: Record<string, unknown>) {
  const result = await service.rpc(name, args);
  if (result.error) return json(400, { error: result.error.message });
  const payload = result.data || {};
  if (payload.ok === false) return json(payload.status || 400, { error: payload.error || "Request failed." });
  return json(200, payload);
}

async function signQueue(service: ReturnType<typeof createClient>, payload: Record<string, unknown>) {
  const queue = Array.isArray(payload.queue) ? payload.queue : [];
  for (const item of queue) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.voice_note) row.voice_note = await signNote(service, row.voice_note);
  }
}

async function signNote(service: ReturnType<typeof createClient>, note: unknown) {
  if (!note || typeof note !== "object") return null;
  const row = { ...(note as Record<string, unknown>) };
  const path = typeof row.storage_path === "string" ? row.storage_path : "";
  delete row.storage_path;
  if (!path) return row;
  const signed = await service.storage.from("acq-voice").createSignedUrl(path, SIGNED_SECONDS);
  if (signed.error || !signed.data?.signedUrl) {
    row.signed_url = null;
    row.signed_error = "The recording could not be signed.";
    return row;
  }
  row.signed_url = signed.data.signedUrl;
  row.expires_in = SIGNED_SECONDS;
  return row;
}
