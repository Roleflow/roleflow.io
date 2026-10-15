// TailorTalk CRM sync. Redeploy after applying
// supabase/migrations/20261014200000_client_setter.sql.
// The hourly job already caches every lead it pages through, newest messages
// included, so the client setter can read the recent rows. This revision also
// stores a username when the lead payload has one, and counts leads by category.
//
// Secrets (set in the Supabase function secrets UI; do not commit them):
//   TAILORTALK_CRON_SECRET required for the hourly job. Same value as
//                          private.tailortalk_settings key cron_secret.
//   TAILORTALK_TOKEN_KEY   optional. Only used to read a token saved by the
//                          earlier AES-GCM path. New tokens are plaintext in
//                          private.tailortalk_agent_secrets, written by
//                          tailortalk_upsert_agent or tailortalk_put_secret.
// There is no project-wide TailorTalk API key. The registry upsert stores
// one token per agent. The browser never receives it.
// SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are injected.
//
// verify_jwt is false in config.toml so pg_cron can send TAILORTALK_CRON_SECRET.
// This function rejects every other caller. A cron body can only sync.
//
// Get Leads and Get Contacts are JSON POST requests to api.tailortalk.ai,
// header Authorization: Agent <token>. The guide's example lead payload has
// no source, no message history, and no message count. Source is stored only
// when the payload includes source or lead_source.
//
// Admin actions that call the public API with the stored per-agent token:
//   mark_booked    POST /api/v1/mark_converted
//   templates      GET  /api/v1/get_whatsapp_templates
//   template_sends GET  /api/v1/campaign_logs
//   send_template  POST /api/v1/send_whatsapp_template_message
// The public API has no free-text message, no arbitrary stage update, and no
// prompt edit. Those actions are not implemented. A cron body can only sync.
// Error text returned to the browser has the provider name removed.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { usernameOf } from "./lead.js";
import { computeStats } from "./stats.js";

const LEADS_URL = "https://api.tailortalk.ai/api/v1/get_leads";
const CONTACTS_URL = "https://api.tailortalk.ai/api/v1/get_contacts";
const MARK_URL = "https://api.tailortalk.ai/api/v1/mark_converted";
const TEMPLATES_URL = "https://api.tailortalk.ai/api/v1/get_whatsapp_templates";
const LOGS_URL = "https://api.tailortalk.ai/api/v1/campaign_logs";
const SEND_TEMPLATE_URL = "https://api.tailortalk.ai/api/v1/send_whatsapp_template_message";
const PAGE_CAP = 100;

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
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json(500, { error: "Supabase env is not configured." });
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();

  if (body.trigger === "cron") {
    const secret = Deno.env.get("TAILORTALK_CRON_SECRET") || "";
    if (!secret || !timingSafeEqual(bearer, secret)) return json(401, { error: "Unauthorized." });
    if (body.action && body.action !== "sync") return json(403, { error: "The cron job can only sync." });
    const results = await syncAgents(service, null);
    return json(200, { ok: results.every((item) => !item.error), results });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const userRes = await userClient.auth.getUser();
  const user = userRes.data.user;
  if (!user) return json(401, { error: "Sign in required." });
  const adminRes = await service.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (adminRes.error || !adminRes.data) return json(403, { error: "Admin only." });

  const action = String(body.action || "");
  if (action === "save") return saveAgent(service, body);
  if (action === "delete") return deleteAgent(service, body);
  if (action === "sync") {
    const only = body.agent_id ? String(body.agent_id) : null;
    const results = await syncAgents(service, only);
    return json(200, { ok: results.every((item) => !item.error), results });
  }
  if (action === "mark_booked") return markBooked(service, body);
  if (action === "templates") return listTemplates(service, body);
  if (action === "template_sends") return listTemplateSends(service, body);
  if (action === "send_template") return sendTemplate(service, body);
  return json(400, { error: "Unknown action." });
});

function scrub(text: string) {
  return text
    .replace(/https?:\/\/api\.tailortalk\.ai\S*/gi, "the setter service")
    .replace(/tailortalk/gi, "the setter service");
}

function json(status: number, payload: Record<string, unknown>) {
  const body = { ...payload };
  if (typeof body.error === "string") body.error = scrub(body.error);
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

async function cryptoKey() {
  const material = Deno.env.get("TAILORTALK_TOKEN_KEY") || "";
  if (material.length < 16) throw new Error("TAILORTALK_TOKEN_KEY is not set.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptToken(plain: string) {
  const key = await cryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  const combined = new Uint8Array(iv.length + cipher.length);
  combined.set(iv, 0);
  combined.set(cipher, iv.length);
  return bytesToB64(combined);
}

async function decryptToken(stored: string) {
  const key = await cryptoKey();
  const combined = b64ToBytes(stored);
  const iv = combined.slice(0, 12);
  const cipher = combined.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plain);
}

function bytesToB64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function b64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function saveAgent(service: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const existingId = body.id ? String(body.id) : "";
  if (!existingId) return json(400, { error: "Agents are added by the TailorTalk registry upsert." });
  const requested = body.client_id != null && String(body.client_id) !== ""
    ? String(body.client_id)
    : (body.profile_id ? String(body.profile_id) : "");
  const clientId = requested || null;
  if (clientId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) {
    return json(400, { error: "Choose a client account." });
  }
  const token = String(body.token || "").trim();
  const now = new Date().toISOString();
  if (clientId) {
    const cleared = await service.from("tailortalk_agents").update({
      client_id: null,
      profile_id: null,
      updated_at: now
    }).or("client_id.eq." + clientId + ",profile_id.eq." + clientId).neq("id", existingId);
    if (cleared.error) return json(400, { error: cleared.error.message });
  }
  const updated = await service.from("tailortalk_agents").update({
    client_id: clientId,
    profile_id: clientId,
    updated_at: now
  }).eq("id", existingId).select("id, agent_name, label").maybeSingle();
  if (updated.error || !updated.data) return json(400, { error: updated.error?.message || "Agent not found." });

  if (token) {
    const saved = await service.rpc("tailortalk_put_secret", {
      p_agent_id: existingId,
      p_token_encrypted: token
    });
    if (saved.error) return json(500, { error: saved.error.message });
  }

  return json(200, { ok: true, id: existingId, label: updated.data.agent_name || updated.data.label });
}

async function deleteAgent(service: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const id = String(body.id || "");
  if (!id) return json(400, { error: "Agent id is required." });
  const removed = await service.from("tailortalk_agents").delete().eq("id", id);
  if (removed.error) return json(400, { error: removed.error.message });
  return json(200, { ok: true, id });
}

async function syncAgents(service: ReturnType<typeof createClient>, onlyId: string | null) {
  let query = service.from("tailortalk_agents").select("id, label, agent_name, archived").order("agent_name");
  if (onlyId) query = query.eq("id", onlyId);
  else query = query.eq("archived", false);
  const { data, error } = await query;
  if (error) return [{ id: onlyId, error: error.message }];
  const agents = data || [];
  if (onlyId && !agents.length) return [{ id: onlyId, error: "Agent not found." }];
  const results = [];
  for (const agent of agents) results.push(await syncOne(service, agent));
  return results;
}

async function syncOne(service: ReturnType<typeof createClient>, agent: { id: string; label?: string; agent_name?: string }) {
  const secretRes = await service.rpc("tailortalk_read_secret", { p_agent_id: agent.id });
  if (secretRes.error) return fail(service, agent, secretRes.error.message);
  if (!secretRes.data) return fail(service, agent, "No token stored.");

  let token = "";
  try {
    token = await tokenFromStored(String(secretRes.data));
  } catch {
    return fail(service, agent, "Stored token could not be read.");
  }

  const syncedAt = new Date().toISOString();
  try {
    const leads = await fetchLeads(token);
    const loadedContacts = await loadContacts(token);
    const names = contactNames(loadedContacts.rows);
    const leadRows = dedupe(leads.map((lead) => mapLead(agent.id, lead, names, syncedAt)), "external_id");

    await upsertChunks(service, "tailortalk_leads", leadRows, "agent_id,external_id");
    const staleLeads = await service.from("tailortalk_leads").delete().eq("agent_id", agent.id).lt("synced_at", syncedAt);
    if (staleLeads.error) throw new Error(staleLeads.error.message);

    const stats = computeStats(leads);
    const saved = await service.from("tailortalk_agent_stats").upsert({
      agent_id: agent.id,
      total_leads: stats.total_leads,
      by_status: stats.by_status,
      by_source: stats.by_source,
      by_category: stats.by_category,
      converted_count: stats.converted_count,
      conversion_rate: stats.conversion_rate,
      last_activity_at: stats.last_activity_at,
      leads_per_day: stats.leads_per_day,
      computed_at: syncedAt
    });
    if (saved.error) throw new Error(saved.error.message);
    const marked = await service.from("tailortalk_agents").update({
      last_synced_at: syncedAt,
      last_sync_error: null,
      last_activity_at: stats.last_activity_at,
      updated_at: syncedAt
    }).eq("id", agent.id);
    if (marked.error) throw new Error(marked.error.message);
    if (loadedContacts.ok) await saveContacts(service, agent.id, loadedContacts.rows, syncedAt);
    return {
      id: agent.id,
      label: agent.agent_name || agent.label,
      total_leads: stats.total_leads,
      contacts: loadedContacts.ok ? "saved" : "skipped"
    };
  } catch (error) {
    return fail(service, agent, error instanceof Error ? error.message : "Sync failed.");
  }
}

async function tokenFromStored(stored: string) {
  if (/^[0-9a-f]{32,}$/i.test(stored)) return stored;
  try {
    return await decryptToken(stored);
  } catch {
    return stored;
  }
}

async function fail(service: ReturnType<typeof createClient>, agent: { id: string; label?: string; agent_name?: string }, message: string) {
  const text = scrub(message).slice(0, 500);
  await service.from("tailortalk_agents").update({
    last_sync_error: text,
    updated_at: new Date().toISOString()
  }).eq("id", agent.id);
  return { id: agent.id, label: agent.agent_name || agent.label, error: text };
}

async function fetchLeads(token: string) {
  return paginate(token, LEADS_URL, 200, leadsFrom, (item) => item?.id ? String(item.id) : "", (item) => item?.last_message_time || "");
}

function leadsFrom(payload) {
  if (payload?.success === false) throw new Error("The setter service rejected the lead request.");
  const leads = payload?.data?.leads;
  if (!Array.isArray(leads)) throw new Error("The lead response had no leads array.");
  return leads;
}

function contactsFrom(payload) {
  const contacts = payload?.contacts ?? payload?.data?.contacts;
  if (!Array.isArray(contacts)) {
    const error = new Error("contacts-unavailable");
    error.skipContacts = true;
    throw error;
  }
  return contacts;
}

function usableContact(value: unknown) {
  const text = String(value || "").trim();
  if (!text || text.includes("*") || text.length > 80) return "";
  return text;
}

async function agentToken(service: ReturnType<typeof createClient>, agentId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentId)) {
    return { error: "Setter not found." };
  }
  const agent = await service.from("tailortalk_agents").select("id").eq("id", agentId).maybeSingle();
  if (agent.error || !agent.data) return { error: "Setter not found." };
  const secretRes = await service.rpc("tailortalk_read_secret", { p_agent_id: agentId });
  if (secretRes.error || !secretRes.data) return { error: "No token stored for this setter." };
  try {
    return { token: await tokenFromStored(String(secretRes.data)) };
  } catch {
    return { error: "Stored token could not be read." };
  }
}

async function agentFetch(token: string, url: string, init: RequestInit) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", "Agent " + token);
  const res = await fetch(url, { ...init, headers });
  const raw = await res.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  if (!res.ok || payload.success === false) {
    const message = payload.message || payload.error || ("Request failed (" + res.status + ").");
    throw new Error(typeof message === "string" ? message : "Request failed.");
  }
  return payload;
}

async function markBooked(service: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const agentId = String(body.agent_id || "");
  const contact = usableContact(body.contact_id);
  if (!contact) return json(400, { error: "This lead's contact is hidden, so it can't be marked booked from here." });
  const loaded = await agentToken(service, agentId);
  if ("error" in loaded) return json(400, { error: loaded.error });
  try {
    const result = await agentFetch(loaded.token, MARK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_ids: [contact] })
    });
    const data = (result.data && typeof result.data === "object" ? result.data : result) as Record<string, unknown>;
    const stamped = new Date().toISOString();
    const marked = await service.from("tailortalk_leads").update({
      is_converted: true,
      converted_at: stamped
    }).eq("agent_id", agentId).eq("lead_contact", contact);
    if (marked.error) return json(200, { ok: true, updated_count: data.updated_count ?? null, not_found: data.not_found || [], cache_error: marked.error.message });
    await service.from("tailortalk_leads").update({ lead_status: "converted" })
      .eq("agent_id", agentId).eq("lead_contact", contact).eq("category", "sales");
    return json(200, { ok: true, updated_count: data.updated_count ?? null, not_found: data.not_found || [] });
  } catch (error) {
    return json(502, { error: error instanceof Error ? error.message : "The lead could not be marked booked." });
  }
}

async function listTemplates(service: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const loaded = await agentToken(service, String(body.agent_id || ""));
  if ("error" in loaded) return json(400, { error: loaded.error });
  try {
    const result = await agentFetch(loaded.token, TEMPLATES_URL, { method: "GET" });
    const templates = Array.isArray(result.templates) ? result.templates : [];
    return json(200, {
      ok: true,
      templates: templates.map((item) => ({
        template_name: item?.template_name || "",
        template_status: item?.template_status || "",
        template_type: item?.template_type || "",
        language: item?.language || ""
      }))
    });
  } catch (error) {
    return json(502, { error: error instanceof Error ? error.message : "Templates could not be loaded." });
  }
}

async function listTemplateSends(service: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const loaded = await agentToken(service, String(body.agent_id || ""));
  if ("error" in loaded) return json(400, { error: loaded.error });
  const params = new URLSearchParams({ limit: "200" });
  const cursor = String(body.start_after || "").trim();
  if (cursor) params.set("start_after", cursor);
  try {
    const result = await agentFetch(loaded.token, LOGS_URL + "?" + params.toString(), { method: "GET" });
    const logs = Array.isArray(result.logs) ? result.logs : [];
    return json(200, {
      ok: true,
      logs: logs.map((item) => ({
        message_id: item?.message_id || "",
        contact_number: item?.contact_number || "",
        template_name: item?.template_name || "",
        status: item?.status || "",
        error: item?.error || null
      })),
      next_cursor: result.next_cursor || null
    });
  } catch (error) {
    return json(502, { error: error instanceof Error ? error.message : "Template sends could not be loaded." });
  }
}

async function sendTemplate(service: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const templateName = String(body.template_name || "").trim();
  if (!/^[A-Za-z0-9_]+$/.test(templateName)) return json(400, { error: "Choose a template." });
  const contact = usableContact(body.lead_contact);
  if (!contact) return json(400, { error: "This lead's contact is hidden, so a template can't be sent from here." });
  const loaded = await agentToken(service, String(body.agent_id || ""));
  if ("error" in loaded) return json(400, { error: loaded.error });
  const payload: Record<string, unknown> = { lead_contact: contact, template_name: templateName };
  const name = textOrNull(body.lead_name);
  if (name) payload.lead_name = name.slice(0, 120);
  if (Array.isArray(body.template_params)) {
    payload.template_params = body.template_params.map((item) => String(item).slice(0, 500)).slice(0, 20);
  }
  try {
    const result = await agentFetch(loaded.token, SEND_TEMPLATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return json(200, { ok: true, message_id: result.message_id || null });
  } catch (error) {
    return json(502, { error: error instanceof Error ? error.message : "The template could not be sent." });
  }
}

async function loadContacts(token: string) {
  try {
    const rows = await fetchContacts(token);
    return { ok: true, rows };
  } catch {
    return { ok: false, rows: [] };
  }
}

async function saveContacts(service, agentId, contacts, syncedAt) {
  try {
    const contactRows = dedupe(contacts.filter((item) => item.phone_number && item.created_at).map((item) => ({
      agent_id: agentId,
      phone_number: String(item.phone_number),
      created_at_remote: stamp(item.created_at),
      name: textOrNull(item.name),
      updated_at_remote: stamp(item.updated_at),
      synced_at: syncedAt
    })).filter((item) => item.created_at_remote), "phone_number", "created_at_remote");
    await upsertChunks(service, "tailortalk_contacts", contactRows, "agent_id,phone_number,created_at_remote");
    await service.from("tailortalk_contacts").delete().eq("agent_id", agentId).lt("synced_at", syncedAt);
  } catch {
    /* Contacts are optional. A contact write never removes leads or stats. */
  }
}

async function fetchContacts(token: string) {
  return paginate(token, CONTACTS_URL, 500, contactsFrom, (item) => item?.phone_number && item?.created_at ? String(item.phone_number) + "\0" + String(item.created_at) : "", (item) => item?.created_at || "");
}

async function paginate(token, url, limit, readBatch, identity, cursorOf) {
  const rows = [];
  const seen = new Set();
  let startAfter = "";
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const payload: Record<string, unknown> = { limit };
    if (startAfter) payload.start_after = startAfter;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Agent " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("TailorTalk " + res.status + " from " + url);
    const jsonBody = await res.json();
    const batch = readBatch(jsonBody);
    if (!batch.length) break;
    let fresh = 0;
    for (const item of batch) {
      const id = identity(item);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      fresh += 1;
      rows.push(item);
    }
    if (fresh === 0) break;
    const cursor = String(cursorOf(batch[batch.length - 1]) || "");
    if (!cursor || cursor === startAfter) break;
    startAfter = cursor;
    if (batch.length < limit) break;
  }
  return rows;
}

function contactNames(contacts) {
  const names = new Map();
  contacts.forEach((contact) => {
    const phone = contact?.phone_number != null ? String(contact.phone_number) : "";
    const name = textOrNull(contact?.name);
    if (phone && name && !names.has(phone)) names.set(phone, name);
  });
  return names;
}

function mapLead(agentId, lead, names, syncedAt) {
  const contact = textOrNull(lead.lead_contact);
  let name = textOrNull(lead.lead_name);
  if (!name && contact && names.has(contact)) name = names.get(contact);
  const source = String(lead.source || lead.lead_source || "").trim();
  return {
    agent_id: agentId,
    external_id: String(lead.id),
    lead_name: name,
    lead_contact: contact,
    lead_status: textOrNull(lead.lead_status),
    category: textOrNull(lead.category),
    is_converted: lead.is_converted === true,
    converted_at: stamp(lead.converted_at),
    last_message_time: stamp(lead.last_message_time),
    joined_at: stamp(lead.joined || lead.joined_at),
    total_followups: followups(lead.total_followups),
    integration: textOrNull(lead.integration),
    source: source || null,
    username: usernameOf(lead),
    synced_at: syncedAt
  };
}

function textOrNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function stamp(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function followups(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function dedupe(rows, ...keys) {
  const map = new Map();
  rows.forEach((row) => map.set(keys.map((key) => row[key]).join("\0"), row));
  return Array.from(map.values());
}

async function upsertChunks(service, table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 200) {
    const saved = await service.from(table).upsert(rows.slice(i, i + 200), { onConflict });
    if (saved.error) throw new Error(saved.error.message);
  }
}
