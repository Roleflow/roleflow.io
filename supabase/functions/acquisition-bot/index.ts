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
import { agentEnabled } from "../_shared/agent-control.js";
import { completeChat, loadBusinessRuntime, logLlmError } from "../_shared/llm-provider.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNED_SECONDS = 60 * 60;
const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";
const XAI_MODEL = "grok-4.3";

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
  let editorUser = "";
  const actionEarly = String(body.action || "");
  if (bearer.startsWith("rfw_")) {
    const auth = await service.rpc("acq_worker_auth", { p_key: bearer });
    const payload = auth.data || {};
    if (auth.error || payload.ok !== true) return json(401, { error: "Unauthorized." });
    scopedBusiness = String(payload.business_id || "");
    workerId = String(payload.worker_id || "");
  } else if (serviceKey && timingSafeEqual(bearer, serviceKey)) {
    scopedBusiness = "";
  } else if (actionEarly === "chief_daily" && await cronAuthorized(service, bearer)) {
    scopedBusiness = "";
  } else if (actionEarly === "chief") {
    const user = await service.auth.getUser(bearer);
    editorUser = user.data.user?.id || "";
    if (!editorUser) return json(401, { error: "Unauthorized." });
  } else {
    return json(401, { error: "Unauthorized." });
  }

  const requested = String(body.agent_id || body.business_id || "");
  if (scopedBusiness && requested && requested !== scopedBusiness) {
    return json(403, { error: "That worker key is for a different business." });
  }
  const agentId = scopedBusiness || requested;
  const action = actionEarly;

  if (action === "chief_daily") {
    if (editorUser || workerId) return json(403, { error: "Unauthorized." });
    return json(200, await runChiefDaily(service));
  }
  if (action === "chief") {
    if (!UUID.test(agentId)) return json(400, { error: "agent_id must be a business UUID." });
    if (editorUser) {
      const allowed = await service.rpc("acq_user_can_edit", { p_business: agentId, p_user: editorUser });
      if (allowed.error || allowed.data !== true) return json(403, { error: "You cannot edit this business." });
    }
    const result = await runChiefFor(service, agentId);
    return json(result.ok === false ? 400 : 200, result);
  }
  if (!UUID.test(agentId)) return json(400, { error: "agent_id must be a business UUID." });

  if (action === "ingest") {
    const targets = Array.isArray(body.targets) ? body.targets : null;
    if (!targets) return json(400, { error: "targets must be an array." });
    if (!await agentEnabled(service, agentId, "outreacher")) return json(200, { ok: true, skipped: "agent_off", accepted: [] });
    return ingestScored(service, agentId, targets);
  }
  if (action === "queue" || action === "report" || action === "voice_pick") {
    const warmerOn = await agentEnabled(service, agentId, "warmer");
    const outreachOn = await agentEnabled(service, agentId, "outreacher");
    if (!warmerOn && !outreachOn) return json(200, { ok: true, skipped: "agent_off" });
  }
  if (action === "queue") {
    const limit = body.limit == null ? 30 : Number(body.limit);
    const result = await service.rpc("acq_bot_queue", { p_agent: agentId, p_limit: limit });
    if (result.error) return json(400, { error: result.error.message });
    const payload = result.data || {};
    if (payload.ok === false) return json(payload.status || 400, { error: payload.error || "Request failed." });
    await signQueue(service, payload);
    await addFindTargets(service, agentId, payload);
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

async function addFindTargets(service: ReturnType<typeof createClient>, agentId: string, payload: Record<string, unknown>) {
  if (payload.blocked_reason) return;
  const remaining = Number(payload.cap_remaining);
  if (!Number.isFinite(remaining) || remaining <= 0) return;
  const role = await service.from("business_workforce").select("status").eq("agent_id", agentId).eq("role", "icp_acquisition").maybeSingle();
  if (role.error || !role.data || role.data.status !== "active") return;
  const settings = await service.from("acq_settings").select("niche, follower_min, follower_max, cta_keywords, offer_summary").eq("agent_id", agentId).maybeSingle();
  const icp = (settings.data || {}) as Icp;
  const queue = Array.isArray(payload.queue) ? payload.queue : [];
  queue.unshift({
    kind: "find_targets",
    count: remaining,
    follower_min: Number(icp.follower_min) || 5000,
    follower_max: Number(icp.follower_max) || 200000,
    niche: icp.niche || "",
    cta_keywords: icp.cta_keywords || "",
    rules: "CTA in the bio, 5,000–200,000 followers, inside this business range"
  });
  payload.queue = queue;
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

type Service = ReturnType<typeof createClient>;

async function cronAuthorized(service: Service, bearer: string) {
  if (!bearer) return false;
  const secret = await service.rpc("acq_read_cron_secret");
  const stored = typeof secret.data === "string" ? secret.data : "";
  return Boolean(stored) && timingSafeEqual(bearer, stored);
}

async function ingestScored(service: Service, agentId: string, targets: unknown[]) {
  const settings = await service.from("acq_settings").select("niche, follower_min, follower_max, cta_keywords, offer_summary").eq("agent_id", agentId).maybeSingle();
  if (settings.error) return json(400, { error: settings.error.message });
  const icp = (settings.data || {}) as Icp;
  const speak = (system: string, user: string) => grok(service, agentId, system, user);
  if (!await modelReady(service, agentId)) return json(503, { error: "XAI_API_KEY is not set. Profiles were not stored." });
  const scored = await mapPool(targets.slice(0, 50), 4, (item) => scoreTarget(speak, icp, item));
  const result = await service.rpc("acq_bot_ingest", { p_agent: agentId, p_targets: scored.map((entry) => entry.row) });
  if (result.error) return json(400, { error: result.error.message });
  const payload = (result.data || {}) as Record<string, unknown>;
  if (payload.ok === false) return json(Number(payload.status) || 400, { error: String(payload.error || "Request failed.") });
  const accepted = Array.isArray(payload.accepted) ? payload.accepted : [];
  for (const item of accepted) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.qualified !== true || !row.id) continue;
    const source = scored.find((entry) => entry.row.handle === row.handle);
    if (!source) continue;
    try {
      const opener = await writeOpener(speak, icp, source.row);
      const stored = await service.rpc("acq_store_opener", { p_target: row.id, p_opener: opener });
      const storedPayload = (stored.data || {}) as { stored?: boolean };
      row.opener = opener;
      row.opener_stored = storedPayload.stored === true;
    } catch (error) {
      row.opener_error = error instanceof Error ? error.message : "Opener was not written.";
    }
  }
  return json(200, payload);
}

async function runChiefDaily(service: Service) {
  const listed = await service.from("acq_workspaces").select("id").limit(200);
  if (listed.error) return { ok: false, error: listed.error.message };
  const results = [];
  for (const row of listed.data || []) {
    results.push({ business_id: row.id, ...(await runChiefFor(service, row.id)) });
  }
  return { ok: true, businesses: results.length, results };
}

async function runChiefFor(service: Service, agentId: string) {
  const ready = await modelReady(service, agentId);
  const settings = await service.from("acq_settings").select("niche, follower_min, follower_max, cta_keywords, offer_summary").eq("agent_id", agentId).maybeSingle();
  const icp = (settings.data || {}) as Icp;
  const needed = await service.rpc("acq_openers_needed", { p_agent: agentId });
  const drafted = [];
  if (ready) {
    const speak = (system: string, user: string) => grok(service, agentId, system, user);
    for (const row of asArray(needed.data)) {
      try {
        const opener = await writeOpener(speak, icp, row);
        const stored = await service.rpc("acq_store_opener", { p_target: row.id, p_opener: opener });
        const storedPayload = (stored.data || {}) as { stored?: boolean };
        drafted.push({ id: row.id, stored: storedPayload.stored === true });
      } catch (error) {
        drafted.push({ id: row.id, error: error instanceof Error ? error.message : "Opener failed." });
      }
    }
  }
  const report = await service.rpc("acq_run_chief", { p_agent: agentId, p_force_weekly: false });
  if (report.error) return { ok: false, error: report.error.message, openers: drafted };
  return { ...(report.data || { ok: true }), openers: drafted };
}

type Icp = {
  niche?: string;
  follower_min?: number;
  follower_max?: number;
  cta_keywords?: string;
  offer_summary?: string;
};

async function scoreTarget(speak: (system: string, user: string) => Promise<string>, icp: Icp, item: unknown) {
  const row = item && typeof item === "object" ? { ...(item as Record<string, unknown>) } : { handle: "" };
  const followers = Number(row.followers);
  const min = Number(icp.follower_min) || 5000;
  const max = Number(icp.follower_max) || 200000;
  const keywords = String(icp.cta_keywords || "").split(/[,|\n]/).map((part) => part.trim().toLowerCase()).filter(Boolean);
  const hay = `${row.bio || ""}\n${row.recent_posts || ""}`.toLowerCase();
  const keywordHit = !keywords.length || keywords.some((word) => hay.includes(word));
  const inRange = Number.isFinite(followers) && followers >= min && followers <= max;
  if (!inRange || !keywordHit) {
    row.qualified = false;
    row.icp_score = 0;
    row.score_summary = !inRange
      ? "Followers are outside this business's range."
      : "The bio does not include one of this business's CTA keywords.";
    row.score_model = XAI_MODEL;
    return { row };
  }
  const content = await speak(`You qualify an Instagram account for this business. Reply with JSON only: {"score": number, "qualified": boolean, "summary": string}.
Score 0-100. Set qualified true only when the account fits the niche and the bio asks the reader to take a next step.
Niche: ${icp.niche || "not set"}
Offer: ${icp.offer_summary || "not set"}
CTA keywords: ${keywords.join(", ") || "a clear call to action"}
The follower count is already inside the range. Do not invent facts.`, JSON.stringify({
    handle: row.handle,
    followers,
    bio: row.bio || "",
    recent_posts: row.recent_posts || ""
  }));
  const parsed = parseJson(content);
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
  row.qualified = parsed.qualified === true && score >= 70;
  row.icp_score = score;
  row.score_summary = String(parsed.summary || "").slice(0, 500);
  row.score_model = XAI_MODEL;
  return { row };
}

async function writeOpener(speak: (system: string, user: string) => Promise<string>, icp: Icp, row: Record<string, unknown>) {
  const content = await speak(`Write one Instagram opener DM. Reply with JSON only: {"opener": string}.
Maximum 40 words. No emoji. No exclamation marks. Use one specific detail from the bio or recent posts. Do not invent metrics, mutual friends, or posts that are not in the profile. Sound like a peer. End with one question.
Niche: ${icp.niche || ""}
Offer: ${icp.offer_summary || ""}`, JSON.stringify({
    handle: row.handle,
    bio: row.bio || "",
    recent_posts: row.recent_posts || ""
  }));
  const opener = String(parseJson(content).opener || "").replace(/\s+/g, " ").trim();
  if (!opener) throw new Error("The model returned an empty opener.");
  return opener.slice(0, 1000);
}

async function modelReady(service: Service, agentId: string) {
  const loaded = await loadBusinessRuntime(service, agentId, "setter", modelEnv());
  return Boolean(loaded.runtime && loaded.runtime.apiKey);
}

function modelEnv() {
  return {
    XAI_API_KEY: Deno.env.get("XAI_API_KEY") || "",
    XAI_MODEL,
    OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY") || "",
    GEMINI_API_KEY: Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY") || "",
    ANTHROPIC_API_KEY: Deno.env.get("ANTHROPIC_API_KEY") || "",
    OPENROUTER_API_KEY: Deno.env.get("OPENROUTER_API_KEY") || ""
  };
}

async function grok(service: Service, agentId: string, system: string, user: string) {
  const loaded = await loadBusinessRuntime(service, agentId, "setter", modelEnv());
  if (!loaded.runtime) throw new Error("XAI_API_KEY is not set. Profiles were not stored.");
  const runtime = loaded.runtime;
  if (runtime.provider === "xai") runtime.endpoint = XAI_CHAT_URL;
  const result = await completeChat({
    runtime: { ...runtime, model: runtime.model || XAI_MODEL },
    fallback: loaded.fallback,
    system,
    messages: [{ role: "user", content: user }],
    json: true,
    temperature: 0.2,
    onError: (info) => logLlmError(service, { businessId: agentId, purpose: "setter", ...info })
  });
  return result.text || "";
}

function parseJson(text: string) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The model did not return JSON.");
  return JSON.parse(raw.slice(start, end + 1));
}

function asArray(value: unknown) {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]);
    }
  }
  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: width }, () => worker()));
  return out;
}
