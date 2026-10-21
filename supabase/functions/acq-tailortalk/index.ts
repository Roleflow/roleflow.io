// TailorTalk setter provider for one business.
// verify_jwt is false. This function checks the caller itself:
//   cron bearer (acquisition cron secret, or optional TAILORTALK_CRON_SECRET)
//   a signed-in editor JWT for connect, test, disconnect, sync_one, mark_won
//   a per-business webhook secret on POST /webhook?k=
// The TailorTalk API key never returns to the browser after it is saved.
// Get Leads pagination lives in tailortalk-sync. This function registers the
// business agent into that registry, asks that function to sync one agent,
// and retries Mark Order / Mark Converted. Mark Converted is
// POST https://api.tailortalk.ai/api/v1/mark_converted with Instagram user ids.
// TailorTalk webhooks send User-Agent TailorTalk-Webhook/1.0 and
// X-Webhook-Version v1. There is no signature. The timestamp header is required.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import {
  SETTER_ROLES,
  contactIdFor,
  eventKey,
  externalIdOf,
  leadsFrom,
  orderAmount,
  toSyncRow,
  webhookTimestampFresh
} from "./map.js";

const LEADS_URL = "https://api.tailortalk.ai/api/v1/get_leads";
const MARK_ORDER_URL = "https://api.tailortalk.ai/api/v1/mark_order";
const MARK_CONVERTED_URL = "https://api.tailortalk.ai/api/v1/mark_converted";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json(500, { error: "Supabase env is not configured." });
  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const url = new URL(req.url);
  if (url.pathname.endsWith("/webhook")) return webhook(req, service, url);

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
  if (action === "sync" && await cronOk(service, bearer)) {
    return json(200, await syncAll(service));
  }

  const user = await service.auth.getUser(bearer);
  if (user.error || !user.data.user) return json(401, { error: "Unauthorized." });
  const businessId = String(body.business_id || "");
  if (!UUID.test(businessId)) return json(400, { error: "business_id must be a UUID." });
  const allowed = await service.rpc("acq_user_can_edit", { p_business: businessId, p_user: user.data.user.id });
  if (allowed.error || allowed.data !== true) return json(403, { error: "You can't edit this business." });

  try {
    if (action === "connect") return json(200, await connect(service, supabaseUrl, businessId, body));
    if (action === "test") return json(200, await testConnection(service, supabaseUrl, businessId));
    if (action === "disconnect") return json(200, await disconnect(service, businessId));
    if (action === "sync_one") return json(200, await syncBusiness(service, businessId));
    if (action === "mark_won") return json(200, await markWon(service, businessId, String(body.deal_id || "")));
    if (action === "mark_booked") return json(200, await markBooked(service, businessId, String(body.target_id || "")));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed.";
    return json(400, { error: publicError(message) });
  }
  return json(400, { error: "Unknown action." });
});

function publicError(message: string) {
  return message
    .replace(/https?:\/\/api\.tailortalk\.ai\S*/gi, "the setter engine")
    .replace(/tailortalk/gi, "setter engine")
    .slice(0, 300);
}

function json(status: number, payload: Record<string, unknown>) {
  const body = { ...payload };
  delete body.webhook_url;
  if (typeof body.error === "string") body.error = publicError(body.error);
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function timingSafeEqual(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (!left.length || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

let cronCache = "";

async function cronOk(service: ReturnType<typeof createClient>, bearer: string) {
  const envSecret = Deno.env.get("TAILORTALK_CRON_SECRET") || "";
  if (envSecret && timingSafeEqual(bearer, envSecret)) return true;
  if (!cronCache) {
    const stored = await service.rpc("acq_read_cron_secret");
    if (!stored.error && typeof stored.data === "string") cronCache = stored.data;
  }
  return Boolean(cronCache) && timingSafeEqual(bearer, cronCache);
}

function webhookUrl(supabaseUrl: string, businessId: string, secret: string) {
  const base = supabaseUrl.replace(/\/$/, "");
  return `${base}/functions/v1/acq-tailortalk/webhook?business=${businessId}&k=${encodeURIComponent(secret)}`;
}

function randomSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ttPost(url: string, apiKey: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Agent ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok || payload.success === false) {
    const message = payload.message || payload.error || `The setter engine returned ${response.status}.`;
    throw new Error(String(message).slice(0, 300));
  }
  return payload;
}

async function readSecret(service: ReturnType<typeof createClient>, businessId: string) {
  const result = await service.rpc("acq_read_tt_secret", { p_business: businessId });
  if (result.error) throw new Error(result.error.message);
  const row = result.data || {};
  if (row.ok !== true || !row.api_key) throw new Error("The Instagram DM engine is not connected for this business.");
  return row as { api_key: string; agent_id: string; webhook_secret: string };
}

async function connect(service: ReturnType<typeof createClient>, supabaseUrl: string, businessId: string, body: Record<string, unknown>) {
  const apiKey = String(body.api_key || "").trim();
  const agentId = String(body.agent_id || "").trim();
  if (apiKey.length < 8) throw new Error("Enter the engine access token.");
  if (!agentId) throw new Error("Enter the engine agent id.");
  const probe = await ttPost(LEADS_URL, apiKey, { limit: 1 });
  const sample = leadsFrom(probe)[0] as Record<string, unknown> | undefined;
  const returned = sample && (sample.agent_id || sample.agentId);
  if (returned && String(returned) !== agentId) throw new Error("That access token belongs to a different engine agent.");
  const hook = randomSecret();
  const saved = await service.rpc("acq_put_tt_secret", {
    p_business: businessId,
    p_api_key: apiKey,
    p_agent_id: agentId,
    p_webhook_secret: hook
  });
  if (saved.error) throw new Error(saved.error.message);
  await service.rpc("acq_ensure", { p_agent: businessId });
  const link = await service.from("acq_setter_links").upsert({
    business_id: businessId,
    provider: "engine",
    agent_hint: agentId.slice(-4),
    external_agent_id: agentId,
    status: "connected",
    last_tested_at: new Date().toISOString(),
    last_test_ok: true,
    last_test_error: null,
    webhook_hint: hook.slice(-4),
    updated_at: new Date().toISOString()
  }, { onConflict: "business_id" });
  if (link.error) throw new Error(link.error.message);
  const provider = await service.from("acq_settings").update({ setter_provider: "engine" }).eq("agent_id", businessId);
  if (provider.error) throw new Error(provider.error.message);
  await registerAgent(service, businessId, { api_key: apiKey, agent_id: agentId });
  await kickSync(service, agentId);
  return {
    ok: true,
    status: "connected",
    agent_hint: agentId.slice(-4)
  };
}

async function testConnection(service: ReturnType<typeof createClient>, supabaseUrl: string, businessId: string) {
  const secret = await readSecret(service, businessId);
  try {
    await ttPost(LEADS_URL, secret.api_key, { limit: 1 });
    await registerAgent(service, businessId, secret);
    await service.from("acq_setter_links").update({
      status: "connected",
      last_tested_at: new Date().toISOString(),
      last_test_ok: true,
      last_test_error: null,
      updated_at: new Date().toISOString()
    }).eq("business_id", businessId);
    return {
      ok: true,
      status: "connected",
      agent_hint: String(secret.agent_id || "").slice(-4)
    };
  } catch (error) {
    const message = publicError(error instanceof Error ? error.message : "Connection failed.");
    await service.from("acq_setter_links").update({
      status: "error",
      last_tested_at: new Date().toISOString(),
      last_test_ok: false,
      last_test_error: message,
      updated_at: new Date().toISOString()
    }).eq("business_id", businessId);
    throw new Error(message);
  }
}

async function disconnect(service: ReturnType<typeof createClient>, businessId: string) {
  const removed = await service.rpc("acq_delete_tt_secret", { p_business: businessId });
  if (removed.error) throw new Error(removed.error.message);
  await service.from("acq_setter_links").upsert({
    business_id: businessId,
    provider: "engine",
    status: "disconnected",
    last_test_ok: null,
    last_test_error: null,
    updated_at: new Date().toISOString()
  }, { onConflict: "business_id" });
  await service.from("acq_settings").update({ setter_provider: "roleflow_meta" }).eq("agent_id", businessId);
  return { ok: true, status: "disconnected" };
}

async function activeRoles(service: ReturnType<typeof createClient>, businessId: string) {
  const result = await service.from("business_workforce").select("role, status").eq("agent_id", businessId).in("role", SETTER_ROLES);
  if (result.error) throw new Error(result.error.message);
  return (result.data || []).filter((row) => row.status === "active").map((row) => row.role);
}

async function businessName(service: ReturnType<typeof createClient>, businessId: string, fallback: string) {
  const row = await service.from("acq_workspaces").select("name").eq("id", businessId).maybeSingle();
  const name = String(row.data?.name || "").trim();
  return (name || fallback || "Roleflow").slice(0, 80);
}

async function registerAgent(
  service: ReturnType<typeof createClient>,
  businessId: string,
  secret: { api_key: string; agent_id: string }
) {
  const name = await businessName(service, businessId, secret.agent_id);
  const saved = await service.rpc("tailortalk_register_business_agent", {
    p_tailortalk_agent_id: secret.agent_id,
    p_agent_name: name,
    p_access_token: secret.api_key
  });
  if (saved.error) throw new Error(saved.error.message);
  return saved.data;
}

async function triggerRegistrySync(service: ReturnType<typeof createClient>, tailortalkAgentId: string) {
  const secret = await service.rpc("tailortalk_read_cron_secret");
  if (secret.error || typeof secret.data !== "string" || !secret.data) {
    throw new Error("The setter sync secret is not configured.");
  }
  const urlRes = await service.rpc("tailortalk_read_sync_url");
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const url = (typeof urlRes.data === "string" && urlRes.data) || (base + "/functions/v1/tailortalk-sync");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + secret.data,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ trigger: "cron", tailortalk_agent_id: tailortalkAgentId })
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : "Setter sync failed.";
    throw new Error(message.slice(0, 300));
  }
  return payload;
}

async function kickSync(service: ReturnType<typeof createClient>, tailortalkAgentId: string) {
  const job = triggerRegistrySync(service, tailortalkAgentId);
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === "function") {
    runtime.waitUntil(job.catch(() => {}));
    return;
  }
  await job;
}

async function syncAll(service: ReturnType<typeof createClient>) {
  const settings = await service.from("acq_settings").select("agent_id").in("setter_provider", ["engine", "tailortalk"]);
  const links = await service.from("acq_setter_links").select("business_id").eq("status", "connected");
  const connected = new Set((links.data || []).map((row) => row.business_id));
  const ids = (settings.data || []).map((row) => row.agent_id).filter((id) => connected.has(id));
  const results = [];
  for (const id of ids) {
    try {
      const secret = await readSecret(service, id);
      await registerAgent(service, id, secret);
      const reported = await reportPendingDeals(service, id, secret);
      results.push({ business_id: id, ok: true, deals_reported: reported });
    } catch (error) {
      const message = publicError(error instanceof Error ? error.message : "Sync failed.");
      await service.from("acq_setter_links").update({
        last_synced_at: new Date().toISOString(),
        last_sync_error: message
      }).eq("business_id", id);
      results.push({ business_id: id, ok: false, error: message });
    }
  }
  return { ok: true, businesses: ids.length, results };
}

async function syncBusiness(service: ReturnType<typeof createClient>, businessId: string) {
  const settings = await service.from("acq_settings").select("setter_provider").eq("agent_id", businessId).maybeSingle();
  if (settings.data?.setter_provider !== "engine" && settings.data?.setter_provider !== "tailortalk") {
    return { ok: true, skipped: true, reason: "provider" };
  }
  const secret = await readSecret(service, businessId);
  await registerAgent(service, businessId, secret);
  await triggerRegistrySync(service, secret.agent_id);
  const reported = await reportPendingDeals(service, businessId, secret);
  return { ok: true, synced: true, deals_reported: reported };
}

async function webhook(req: Request, service: ReturnType<typeof createClient>, url: URL) {
  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json(400, { error: "JSON object required." });
    body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: "JSON object required." });
  }
  const businessId = url.searchParams.get("business") || "";
  if (!UUID.test(businessId)) return json(401, { error: "Unauthorized." });
  const stamped = req.headers.get("X-Webhook-Timestamp") || "";
  if (!webhookTimestampFresh(stamped)) return json(401, { error: "Unauthorized." });
  const token = url.searchParams.get("k") || "";
  let secret: { api_key: string; agent_id: string; webhook_secret: string };
  try {
    secret = await readSecret(service, businessId);
  } catch {
    return json(401, { error: "Unauthorized." });
  }
  if (!timingSafeEqual(token, secret.webhook_secret)) return json(401, { error: "Unauthorized." });
  const eventType = String(body.event_type || "lead");
  if (eventType !== "lead") return json(200, { ok: true, ignored: true });
  const trigger = String(body.webhook_trigger || "custom").toLowerCase();
  const lead = (body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : body) as Record<string, unknown>;
  const occurredAt = String(body.occurred_at || "");
  if (!externalIdOf(lead) || !occurredAt) return json(400, { error: "Lead id and occurred_at are required." });
  const key = eventKey(lead, occurredAt);
  const existing = await service.from("acq_tt_events").select("id, applied").eq("business_id", businessId).eq("event_key", key).maybeSingle();
  if (existing.error) return json(500, { error: "Could not store that lead." });
  if (existing.data?.applied) return json(200, { ok: true, duplicate: true });
  const roles = await activeRoles(service, businessId);
  const summary = {
    trigger,
    external_id: externalIdOf(lead),
    lead_status: String((lead as { lead_status?: string }).lead_status || ""),
    occurred_at: body.occurred_at || null
  };
  if (!roles.length) {
    const paused = await service.from("acq_tt_events").upsert({
      business_id: businessId,
      event_key: key,
      trigger,
      payload: summary,
      applied: false
    }, { onConflict: "business_id,event_key" });
    if (paused.error) return json(500, { error: "Could not store that lead." });
    return json(200, { ok: true, skipped: "paused" });
  }
  const row = toSyncRow(lead, null, trigger, "webhook");
  if (row.external_id) {
    const applied = await service.rpc("acq_tt_apply_batch", {
      p_business: businessId,
      p_rows: [row],
      p_active_roles: roles
    });
    if (applied.error) return json(500, { error: "Could not store that lead." });
  }
  const stored = await service.from("acq_tt_events").upsert({
    business_id: businessId,
    event_key: key,
    trigger,
    payload: summary,
    applied: true
  }, { onConflict: "business_id,event_key" });
  if (stored.error) return json(500, { error: "Could not store that lead." });
  return json(200, { ok: true });
}

async function markWon(service: ReturnType<typeof createClient>, businessId: string, dealId: string) {
  if (!UUID.test(dealId)) throw new Error("deal_id must be a UUID.");
  const deal = await service.from("acq_deals").select("id, agent_id, amount_cents, currency, target_id, tt_report_status").eq("id", dealId).eq("agent_id", businessId).maybeSingle();
  if (deal.error || !deal.data) throw new Error("Deal not found.");
  const settings = await service.from("acq_settings").select("setter_provider").eq("agent_id", businessId).maybeSingle();
  if (settings.data?.setter_provider !== "engine" && settings.data?.setter_provider !== "tailortalk") {
    await service.from("acq_deals").update({ tt_report_status: "skipped", tt_report_error: null }).eq("id", dealId);
    return { ok: true, status: "skipped" };
  }
  const secret = await readSecret(service, businessId);
  await reportDeal(service, businessId, secret, deal.data);
  return { ok: true, status: "reported" };
}

async function reportPendingDeals(service: ReturnType<typeof createClient>, businessId: string, secret: { api_key: string }) {
  const deals = await service.from("acq_deals").select("id, amount_cents, currency, target_id").eq("agent_id", businessId).in("tt_report_status", ["pending", "error"]).limit(20);
  if (deals.error) return 0;
  let reported = 0;
  for (const deal of deals.data || []) {
    try {
      await reportDeal(service, businessId, secret, deal);
      reported += 1;
    } catch {
      reported += 0;
    }
  }
  return reported;
}

async function reportDeal(
  service: ReturnType<typeof createClient>,
  businessId: string,
  secret: { api_key: string },
  deal: { id: string; amount_cents: number; currency: string; target_id: string | null }
) {
  const target = deal.target_id
    ? await service.from("acq_targets").select("handle, tailortalk_external_id").eq("id", deal.target_id).maybeSingle()
    : { data: null };
  const contact = deal.target_id
    ? await service.from("acq_contacts").select("contact, external_id, ig_handle").eq("business_id", businessId).eq("target_id", deal.target_id).limit(1)
    : { data: [] };
  const contactId = contactIdFor((contact.data || [])[0], target.data);
  if (!contactId) {
    await service.from("acq_deals").update({
      tt_report_status: "error",
      tt_report_error: "mark_converted needs the Instagram user id."
    }).eq("id", deal.id);
    throw new Error("mark_converted needs the Instagram user id.");
  }
  const amount = orderAmount(deal.amount_cents);
  try {
    if (amount > 0) {
      await ttPost(MARK_ORDER_URL, secret.api_key, {
        contact_id: contactId,
        amount,
        currency: deal.currency || "USD",
        order_id: deal.id
      });
    }
    await ttPost(MARK_CONVERTED_URL, secret.api_key, { contact_ids: [contactId] });
    await service.from("acq_deals").update({
      tt_report_status: "reported",
      tt_report_error: null,
      tt_order_id: amount > 0 ? deal.id : null
    }).eq("id", deal.id);
  } catch (error) {
    const message = publicError(error instanceof Error ? error.message : "The setter engine report failed.");
    await service.from("acq_deals").update({
      tt_report_status: "error",
      tt_report_error: message
    }).eq("id", deal.id);
    throw new Error(message);
  }
}

function usesEngineProvider(value: string | null | undefined) {
  return value === "engine" || value === "tailortalk";
}

async function markBooked(service: ReturnType<typeof createClient>, businessId: string, targetId: string) {
  if (!UUID.test(targetId)) throw new Error("target_id must be a UUID.");
  const settings = await service.from("acq_settings").select("setter_provider").eq("agent_id", businessId).maybeSingle();
  if (!usesEngineProvider(settings.data?.setter_provider)) return { ok: true, status: "skipped" };
  const secret = await readSecret(service, businessId);
  const target = await service.from("acq_targets").select("handle, tailortalk_external_id").eq("id", targetId).maybeSingle();
  const contact = await service.from("acq_contacts").select("contact, external_id, ig_handle").eq("business_id", businessId).eq("target_id", targetId).limit(1);
  const contactId = contactIdFor((contact.data || [])[0], target.data);
  if (!contactId) throw new Error("mark_converted needs the Instagram user id.");
  await ttPost(MARK_CONVERTED_URL, secret.api_key, { contact_ids: [contactId] });
  return { ok: true, status: "reported" };
}
