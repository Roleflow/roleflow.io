// Setter sync for one business. The per-agent token is read from encrypted
// storage and is never returned. Sync stays off unless studio_setter_sync is
// true. This function does not message leads.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { assertReadOnly, dncHandles, dncSheetCount, sheetReadCall } from "./dnc.js";
import { deliveryRequest, settleDelivery } from "./deliver.js";
import { executePlan, logLine, pullRows, pushPlan, ROLEFLOW_ONLY } from "./plan.js";

const LEADS_URL = "https://api.tailortalk.ai/api/v1/get_leads";
const MARK_CONVERTED_URL = "https://api.tailortalk.ai/api/v1/mark_converted";
const MARK_ORDER_URL = "https://api.tailortalk.ai/api/v1/mark_order";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only." });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json(500, { error: "Supabase env is not configured." });
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "JSON object required." });
  }
  const action = String(body.action || "");
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();

  if (action === "tick") {
    if (!(await cronOk(service, bearer))) return json(401, { error: "Unauthorized." });
    const enabled = await service.from("acq_settings").select("agent_id").eq("studio_setter_sync", true);
    const ids = (enabled.data || []).map((row) => row.agent_id);
    for (const id of ids) {
      await pullBusiness(service, id);
      await pushBusiness(service, id);
    }
    const delivered = await deliverPending(service);
    return json(200, { ok: true, checked: ids.length, delivered });
  }

  const user = await service.auth.getUser(bearer);
  if (user.error || !user.data.user) return json(401, { error: "Unauthorized." });
  const businessId = String(body.business_id || "");
  if (!UUID.test(businessId)) return json(400, { error: "business_id must be a UUID." });
  const allowed = await service.rpc("acq_user_can_edit", { p_business: businessId, p_user: user.data.user.id });
  if (allowed.error || allowed.data !== true) return json(403, { error: "You can't edit this business." });

  if (action === "push") return json(200, await pushBusiness(service, businessId));
  if (action === "pull") return json(200, await pullBusiness(service, businessId));
  if (action === "import_dnc") return json(200, await importDnc(service, businessId));
  if (action === "deliver") return json(200, await deliverBusiness(service, businessId));
  return json(400, { error: "Unknown action." });
});

async function deliverPending(service: ReturnType<typeof createClient>) {
  const rows = await service.from("engine_outbox")
    .select("id, business_id, kind, payload")
    .eq("status", "pending")
    .in("kind", ["update_workflow", "deploy", "create_tool"])
    .order("created_at", { ascending: true })
    .limit(20);
  if (rows.error) return 0;
  let applied = 0;
  for (const row of rows.data || []) {
    if (await deliverRow(service, row)) applied += 1;
  }
  return applied;
}

async function deliverBusiness(service: ReturnType<typeof createClient>, businessId: string) {
  const rows = await service.from("engine_outbox")
    .select("id, business_id, kind, payload")
    .eq("business_id", businessId)
    .eq("status", "pending")
    .in("kind", ["update_workflow", "deploy", "create_tool"])
    .order("created_at", { ascending: true })
    .limit(20);
  if (rows.error) return { ok: false, applied: 0, pending: 0 };
  let applied = 0;
  for (const row of rows.data || []) {
    if (await deliverRow(service, row)) applied += 1;
  }
  const pending = (rows.data || []).length - applied;
  return { ok: true, applied, pending, sync: pending ? "pending" : "applied" };
}

async function deliverRow(service: ReturnType<typeof createClient>, row: { id: string; business_id: string; kind: string; payload: Record<string, unknown> }) {
  const link = await service.from("acq_setter_links").select("external_agent_id").eq("business_id", row.business_id).maybeSingle();
  const request = deliveryRequest({
    kind: row.kind,
    payload: row.payload,
    external_agent_id: link.data && link.data.external_agent_id || ""
  });
  if (!request || !request.body.agent_id) return false;
  const token = await sheetToken(service, row.business_id);
  if (!token) return false;
  const response = await fetch(request.url, {
    method: request.method,
    headers: { Authorization: "Agent " + token, "Content-Type": "application/json" },
    body: JSON.stringify(request.body)
  }).catch(() => null);
  if (!response || settleDelivery(response.status) !== "applied") return false;
  const saved = await service.from("engine_outbox").update({
    status: "applied",
    applied_at: new Date().toISOString(),
    error: null
  }).eq("id", row.id).eq("status", "pending");
  return !saved.error;
}

async function pushBusiness(service: ReturnType<typeof createClient>, businessId: string) {
  const snapshot = await loadSnapshot(service, businessId);
  const plan = pushPlan(snapshot);
  if (!plan.enabled) {
    await writeLog(service, businessId, { direction: "push", action: "settings", result: "skipped", detail: "Sync is off. Nothing was sent." });
    return { ok: true, result: "skipped", roleflow_only: ROLEFLOW_ONLY.map((item) => item.label) };
  }
  const secret = await service.rpc("acq_read_tt_secret", { p_business: businessId });
  if (secret.error || !secret.data || secret.data.ok !== true) {
    await writeLog(service, businessId, { direction: "push", action: "settings", result: "error", detail: "No setter key is stored for this business." });
    return { ok: false, result: "error" };
  }
  const token = String(secret.data.api_key || "");
  const results = await executePlan(plan, (call) => postSetter(token, call));
  const failed = results.filter((row) => !row.ok);
  await writeLog(service, businessId, {
    direction: "push",
    action: "leads",
    result: failed.length ? "error" : "ok",
    detail: failed.length ? failed.map((row) => row.error).join("; ") : results.length + " setter writes."
  });
  await writeLog(service, businessId, {
    direction: "push",
    action: "roleflow_only",
    result: "roleflow_only",
    detail: ROLEFLOW_ONLY.map((item) => item.label).join(", ")
  });
  await touchLink(service, businessId, failed[0] ? failed[0].error : null, { pushed: results.length });
  return { ok: failed.length === 0, result: failed.length ? "error" : "ok", roleflow_only: ROLEFLOW_ONLY.map((item) => item.label) };
}

async function pullBusiness(service: ReturnType<typeof createClient>, businessId: string) {
  const settings = await service.from("acq_settings").select("studio_setter_sync").eq("agent_id", businessId).maybeSingle();
  if (!settings.data || settings.data.studio_setter_sync !== true) {
    await writeLog(service, businessId, { direction: "pull", action: "leads", result: "skipped", detail: "Sync is off. Nothing was read." });
    return { ok: true, result: "skipped" };
  }
  const secret = await service.rpc("acq_read_tt_secret", { p_business: businessId });
  if (secret.error || !secret.data || secret.data.ok !== true) {
    await writeLog(service, businessId, { direction: "pull", action: "leads", result: "error", detail: "No setter key is stored for this business." });
    return { ok: false, result: "error" };
  }
  const token = String(secret.data.api_key || "");
  const rows = [];
  let startAfter = "";
  for (let page = 0; page < 3; page += 1) {
    const response = await fetch(LEADS_URL, {
      method: "POST",
      headers: { Authorization: "Agent " + token, "Content-Type": "application/json" },
      body: JSON.stringify(startAfter ? { start_after: startAfter, limit: 200 } : { limit: 200 })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      await writeLog(service, businessId, { direction: "pull", action: "leads", result: "error", detail: "The setter did not return leads." });
      return { ok: false, result: "error" };
    }
    const batch = pullRows(payload);
    rows.push(...batch);
    const last = batch[batch.length - 1];
    if (!last || !last.last_message_at || batch.length < 200) break;
    startAfter = last.last_message_at;
  }
  let applied = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const saved = await service.rpc("acq_tt_apply_batch", {
      p_business: businessId,
      p_rows: rows.slice(i, i + 100),
      p_active_roles: []
    });
    if (saved.error) {
      await writeLog(service, businessId, { direction: "pull", action: "leads", result: "error", detail: saved.error.message });
      return { ok: false, result: "error" };
    }
    applied += Number(saved.data && saved.data.contacts) || 0;
  }
  await writeLog(service, businessId, { direction: "pull", action: "leads", result: "ok", detail: applied + " leads applied by external id." });
  await touchLink(service, businessId, null, { pulled: rows.length });
  return { ok: true, result: "ok", pulled: rows.length };
}

async function importDnc(service: ReturnType<typeof createClient>, businessId: string) {
  const token = await sheetToken(service, businessId);
  if (!token) {
    await writeLog(service, businessId, { direction: "pull", action: "dnc", result: "skipped", detail: "No setter key is stored for this business." });
    return { ok: true, result: "skipped", detail: "No setter key is stored for this business.", imported: 0 };
  }
  const call = assertReadOnly(sheetReadCall());
  const response = await fetch(call.url, {
    method: call.method,
    headers: { Authorization: "Agent " + token, "Content-Type": "application/json" },
    body: JSON.stringify(call.body || {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    await writeLog(service, businessId, { direction: "pull", action: "dnc", result: "error", detail: "The setter did not return a sheet list." });
    return { ok: false, result: "error", imported: 0 };
  }
  if (!dncSheetCount(payload)) {
    await writeLog(service, businessId, { direction: "pull", action: "dnc", result: "error", detail: "The setter did not return a sheet list." });
    return { ok: false, result: "error", imported: 0 };
  }
  const handles = dncHandles(payload);
  let imported = 0;
  for (let i = 0; i < handles.length; i += 100) {
    const rows = handles.slice(i, i + 100).map((handle) => ({
      business_id: businessId,
      handle,
      reason: "Instagram channel"
    }));
    const saved = await service.from("acq_dnc").upsert(rows, { onConflict: "business_id,handle", ignoreDuplicates: true });
    if (saved.error) {
      await writeLog(service, businessId, { direction: "pull", action: "dnc", result: "error", detail: "The do-not-contact list did not save." });
      return { ok: false, result: "error", imported };
    }
    imported += rows.length;
  }
  await writeLog(service, businessId, { direction: "pull", action: "dnc", result: "ok", detail: imported + " handles read from the sheet." });
  return { ok: true, result: "ok", imported };
}

async function sheetToken(service: ReturnType<typeof createClient>, businessId: string) {
  const secret = await service.rpc("acq_read_tt_secret", { p_business: businessId });
  if (!secret.error && secret.data && secret.data.ok === true && secret.data.api_key) return String(secret.data.api_key);
  const linked = await service.rpc("acq_read_linked_agent_token", { p_business: businessId });
  if (!linked.error && typeof linked.data === "string" && linked.data.length >= 8) return linked.data;
  return "";
}

async function loadSnapshot(service: ReturnType<typeof createClient>, businessId: string) {
  const [settings, brief, contacts, deals, followups, comments, stories, tags, link] = await Promise.all([
    service.from("acq_settings").select("studio_setter_sync, followup_hours, followup_count, reply_delay_seconds, stop_on_human, stop_condition").eq("agent_id", businessId).maybeSingle(),
    service.from("acq_business_briefs").select("fields").eq("business_id", businessId).maybeSingle(),
    service.from("acq_contacts").select("id, external_id, ig_handle, contact, lead_status, crm_state, is_converted").eq("business_id", businessId).limit(500),
    service.from("acq_deals").select("id, amount_cents, currency").eq("agent_id", businessId).limit(200),
    service.from("acq_followup_steps").select("id").eq("business_id", businessId),
    service.from("acq_comment_ctas").select("keyword, dm_text").eq("business_id", businessId),
    service.from("acq_story_ctas").select("keyword").eq("business_id", businessId),
    service.from("acq_tag_rules").select("name").eq("business_id", businessId),
    service.from("acq_setter_links").select("external_agent_id").eq("business_id", businessId).maybeSingle()
  ]);
  return {
    settings: settings.data || {},
    brief: brief.data || null,
    leads: contacts.data || [],
    deals: deals.data || [],
    followupSteps: followups.data || [],
    commentCtas: comments.data || [],
    storyCtas: stories.data || [],
    tagRules: tags.data || [],
    agentId: link.data && link.data.external_agent_id || ""
  };
}

async function postSetter(token: string, call: { op: string; body?: Record<string, unknown> }) {
  const url = call.op === "mark_order" ? MARK_ORDER_URL : call.op === "mark_converted" ? MARK_CONVERTED_URL : "";
  if (!url) return { ok: false, error: "That setter write is not available." };
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Agent " + token, "Content-Type": "application/json" },
    body: JSON.stringify(call.body || {})
  });
  if (!response.ok) return { ok: false, error: "The setter rejected the update." };
  return { ok: true };
}

async function writeLog(service: ReturnType<typeof createClient>, businessId: string, row: { direction: string; action: string; result: string; detail: string }) {
  const safe = logLine(row);
  await service.from("acq_sync_log").insert({ business_id: businessId, ...safe });
}

async function touchLink(service: ReturnType<typeof createClient>, businessId: string, error: string | null, counts: Record<string, number>) {
  await service.from("acq_setter_links").update({
    last_synced_at: new Date().toISOString(),
    last_sync_error: error,
    last_sync_counts: counts
  }).eq("business_id", businessId);
}

let cronCache = "";

async function cronOk(service: ReturnType<typeof createClient>, bearer: string) {
  if (!cronCache) {
    const stored = await service.rpc("acq_read_cron_secret");
    if (!stored.error && typeof stored.data === "string") cronCache = stored.data;
  }
  if (!cronCache || !bearer || cronCache.length !== bearer.length) return false;
  let diff = 0;
  for (let i = 0; i < cronCache.length; i += 1) diff |= cronCache.charCodeAt(i) ^ bearer.charCodeAt(i);
  return diff === 0;
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
