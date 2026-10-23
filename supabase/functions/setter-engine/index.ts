// Roleflow Setter Engine. The browser and the outbox assistant call this function.
// verify_jwt is false. This function checks the caller itself:
//   a signed-in editor JWT for activation, sync, and deal reporting
//   an admin JWT for linking an engine agent and for the registry actions
//   ENGINE_OUTBOX_SECRET (env, else private.acquisition_settings) for the outbox
// Provider hostnames, tokens, and webhook URLs stay on the server.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HANDLE = /^[a-z0-9._]{1,30}$/;
const REGISTRY_ACTIONS = new Set(["save", "delete", "sync", "template_sends", "send_template"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json(500, { error: "Supabase env is not configured." });
  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json(400, { error: "JSON object required." });
    body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: "JSON object required." });
  }

  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const action = String(body.action || "");

  if (action === "outbox_list" || action === "outbox_mark") {
    if (!await outboxOk(service, bearer)) return json(401, { error: "Unauthorized." });
    if (action === "outbox_list") return json(200, await listOutbox(service));
    return json(200, await markOutbox(service, body));
  }

  const user = await service.auth.getUser(bearer);
  if (user.error || !user.data.user) return json(401, { error: "Unauthorized." });
  const userId = user.data.user.id;

  try {
    if (REGISTRY_ACTIONS.has(action) || (action === "mark_booked" && !body.business_id)) {
      if (!await isAdmin(service, userId)) return json(403, { error: "Admin only." });
      return forward(supabaseUrl, "tailortalk-sync", bearer, body);
    }

    const businessId = String(body.business_id || "");
    if (!UUID.test(businessId)) return json(400, { error: "business_id must be a UUID." });
    const allowed = await service.rpc("acq_user_can_edit", { p_business: businessId, p_user: userId });
    if (allowed.error || allowed.data !== true) return json(403, { error: "You can't edit this business." });

    if (action === "request_activation") return json(200, await requestActivation(service, businessId, body));
    if (action === "link_agent") {
      if (!await isAdmin(service, userId)) return json(403, { error: "Admin only." });
      return forward(supabaseUrl, "acq-tailortalk", bearer, {
        action: "connect",
        business_id: businessId,
        api_key: body.api_key,
        agent_id: body.agent_id
      });
    }
    if (action === "mark_won" || action === "sync_one" || action === "mark_booked" || action === "disconnect") {
      return forward(supabaseUrl, "acq-tailortalk", bearer, body);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed.";
    return json(400, { error: message });
  }
  return json(400, { error: "Unknown action." });
});

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(scrubValue(payload)), { status, headers: cors });
}

function scrubText(value: string) {
  return value
    .replace(/https?:\/\/api\.tailortalk\.ai\S*/gi, "the setter engine")
    .replace(/functions\/v1\/acq-tailortalk\S*/gi, "")
    .replace(/functions\/v1\/tailortalk-sync\S*/gi, "")
    .replace(/tailortalk/gi, "setter engine");
}

function scrubValue(value: unknown): unknown {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "webhook_url" || key === "api_key" || key === "access_token" || key === "token") continue;
    if (/tailortalk/i.test(key)) {
      out[key.replace(/tailortalk/gi, "engine")] = scrubValue(item);
      continue;
    }
    out[key] = scrubValue(item);
  }
  return out;
}

function timingSafeEqual(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (!left.length || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

let outboxCache = "";

async function outboxOk(service: ReturnType<typeof createClient>, bearer: string) {
  const envSecret = Deno.env.get("ENGINE_OUTBOX_SECRET") || "";
  if (envSecret && timingSafeEqual(bearer, envSecret)) return true;
  if (!outboxCache) {
    const stored = await service.rpc("acq_read_engine_outbox_secret");
    if (!stored.error && typeof stored.data === "string") outboxCache = stored.data;
  }
  return Boolean(outboxCache) && timingSafeEqual(bearer, outboxCache);
}

async function isAdmin(service: ReturnType<typeof createClient>, userId: string) {
  const row = await service.from("admins").select("user_id").eq("user_id", userId).maybeSingle();
  return !row.error && Boolean(row.data);
}

async function forward(supabaseUrl: string, name: string, bearer: string, body: Record<string, unknown>) {
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const response = await fetch(supabaseUrl.replace(/\/$/, "") + "/functions/v1/" + name, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + bearer,
      apikey: anon,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const clean = scrubValue(payload) as Record<string, unknown>;
  return json(response.status, clean && typeof clean === "object" ? clean : { error: "Request failed." });
}

async function requestActivation(service: ReturnType<typeof createClient>, businessId: string, body: Record<string, unknown>) {
  const handle = String(body.ig_handle || body.handle || "").trim().replace(/^@/, "").toLowerCase();
  if (!HANDLE.test(handle)) throw new Error("Enter an Instagram handle.");
  await service.rpc("acq_ensure", { p_agent: businessId });
  const existing = await service.from("acq_setter_links").select("status").eq("business_id", businessId).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  const connected = existing.data?.status === "connected";
  const saved = await service.from("acq_setter_links").upsert({
    business_id: businessId,
    provider: "engine",
    status: connected ? "connected" : "pending",
    requested_handle: handle,
    updated_at: new Date().toISOString()
  }, { onConflict: "business_id" });
  if (saved.error) throw new Error(saved.error.message);
  const provider = await service.from("acq_settings").update({ setter_provider: "engine" }).eq("agent_id", businessId);
  if (provider.error) throw new Error(provider.error.message);
  return { ok: true, status: connected ? "connected" : "pending", handle };
}

function cleanPayload(payload: unknown) {
  const value = scrubValue(payload);
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const copy = { ...(value as Record<string, unknown>) };
  delete copy.api_key;
  delete copy.token;
  delete copy.access_token;
  delete copy.webhook_secret;
  delete copy.authorization;
  return copy;
}

async function listOutbox(service: ReturnType<typeof createClient>) {
  const rows = await service.from("engine_outbox")
    .select("id, business_id, kind, payload, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(50);
  if (rows.error) return { ok: false, error: "Could not list pending items." };
  const ids = [...new Set((rows.data || []).map((row) => row.business_id))];
  const links = ids.length
    ? await service.from("acq_setter_links").select("business_id, external_agent_id").in("business_id", ids)
    : { data: [] };
  const agents = new Map((links.data || []).map((row) => [row.business_id, row.external_agent_id || ""]));
  return {
    ok: true,
    items: (rows.data || []).map((row) => ({
      id: row.id,
      business_id: row.business_id,
      workspace_id: row.business_id,
      kind: row.kind,
      op: row.kind,
      payload: cleanPayload(row.payload),
      created_at: row.created_at,
      external_agent_id: agents.get(row.business_id) || ""
    }))
  };
}

async function markOutbox(service: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const id = String(body.id || "");
  const status = String(body.status || "");
  if (!UUID.test(id)) return { ok: false, error: "id must be a UUID." };
  if (status !== "done" && status !== "applied" && status !== "failed") {
    return { ok: false, error: "status must be done or failed." };
  }
  const saved = await service.rpc("acq_engine_outbox_settle", {
    p_id: id,
    p_status: status === "applied" ? "done" : status,
    p_agent_id: String(body.agent_id || body.result_agent_id || ""),
    p_error: status === "failed" ? scrubText(String(body.error || "Could not apply.")).slice(0, 500) : null
  });
  if (saved.error) return { ok: false, error: "Could not update that item." };
  const payload = saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : {};
  if (payload.ok !== true) return { ok: false, error: String(payload.error || "That item is not pending.") };
  return { ok: true, id, status: payload.status || "done", result_agent_id: payload.result_agent_id || "" };
}
