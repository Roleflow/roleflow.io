// Machine API for the per-client outreacher. Callers are edge functions only.
// business_id and machine_id come from the verified session, never from the body.
// Model keys stay in this process. Passwords are rejected and not stored.

import { randomToken, safeEqual, sha256Hex, signMachineToken, verifyJwt } from "./jwt.js";

export const MACHINE_ACTIONS = new Set([
  "bootstrap",
  "refresh",
  "heartbeat",
  "config",
  "qualify",
  "draft",
  "claim",
  "claim_check",
  "report_send",
  "log_event",
  "backup_slot",
  "backup_commit"
]);

export const SESSION_STATES = new Set(["ok", "expired", "checkpoint", "action_block", "unknown"]);
export const CLAIM_KINDS = new Set(["dm", "like", "follow", "view"]);
const LIVE_STATUSES = new Set(["provisioning", "awaiting_login", "running", "paused", "error", "suspended"]);
const TOKEN_WINDOW_MS = 15 * 60 * 1000;
const TOKEN_SKEW_MS = 2 * 60 * 1000;
const CLAIM_TTL_MS = 2 * 60 * 1000;
const DM_STORE_LIMIT = 1000;
const LIST_LIMIT = 5000;

export const QUALIFY_SYSTEM = [
  "Score this Instagram profile for the business described in the user message.",
  "Reply with JSON only: {\"score\": number, \"summary\": string}.",
  "Score 0-100 from the profile text and those business fields.",
  "Do not invent facts, prices, or posts that are not in the user message."
].join("\n");

export function machineActionAllowed(action) {
  return MACHINE_ACTIONS.has(String(action || ""));
}

export function clientIpFromHeaders(headers) {
  const read = (name) => headers && typeof headers.get === "function" ? headers.get(name) || "" : "";
  const forwarded = read("cf-connecting-ip") || read("x-real-ip") || read("x-forwarded-for").split(",")[0];
  return String(forwarded || "").trim();
}

function missingRelation(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const message = String(error.message || "");
  return code === "42P01" || code === "PGRST205" || /does not exist|schema cache/i.test(message);
}

function missingFunction(error) {
  if (!error) return false;
  return String(error.code || "") === "42883" || /does not exist/i.test(String(error.message || ""));
}

function hasPassword(body) {
  return Object.keys(body || {}).some((key) => /password/i.test(key));
}

async function rowsOf(query) {
  const result = await query;
  if (result && result.error) return result;
  const data = result && Array.isArray(result.data) ? result.data : [];
  return { data, error: null };
}

export async function authenticateMachine(service, token, env, now) {
  const verified = await verifyJwt(token, env && env.publicKey, now);
  if (!verified.ok) return { ok: false, status: 401, error: "Unauthorized." };
  const loaded = await service.from("client_machines").select("*").eq("id", verified.claims.machine_id).maybeSingle();
  if (missingRelation(loaded.error)) {
    return { ok: false, status: 503, error: "client_machines is not available.", dependency: "client_machines" };
  }
  if (loaded.error) return { ok: false, status: 503, error: "The machine row could not be read." };
  const row = loaded.data;
  if (!row) return { ok: false, status: 401, error: "Unauthorized." };
  if (String(row.business_id || "") !== String(verified.claims.business_id || "")) {
    return { ok: false, status: 403, error: "That worker key is for a different business." };
  }
  if (row.revoked_at || row.status === "revoked" || row.status === "deleted" || row.status === "deleting") {
    return { ok: false, status: 401, error: "Unauthorized." };
  }
  if (row.status && !LIVE_STATUSES.has(row.status)) return { ok: false, status: 401, error: "Unauthorized." };
  return { ok: true, business_id: String(row.business_id), machine_id: String(row.id), row };
}

export async function callModel({ loadRuntime, completeChat, system, user }) {
  const loaded = await loadRuntime();
  if (!loaded || !loaded.runtime || !loaded.runtime.apiKey) {
    const error = new Error("The model key is not configured.");
    error.code = "no_model";
    throw error;
  }
  const result = await completeChat({
    runtime: loaded.runtime,
    fallback: loaded.fallback,
    system,
    messages: [{ role: "user", content: user }],
    maxTokens: 800,
    omitTemperature: true
  });
  return result && result.text ? result.text : "";
}

export function draftUserMessage({ profile, trigger, brief, links, tagRules, settings }) {
  const captions = Array.isArray(profile && profile.captions) ? profile.captions : [];
  const rules = Array.isArray(tagRules) ? tagRules : [];
  const offers = Array.isArray(links) ? links : [];
  const fields = brief && typeof brief === "object" ? brief : {};
  const icp = settings && typeof settings === "object" ? settings : {};
  return [
    "Trigger: " + String(trigger || ""),
    "Handle: " + String(profile && profile.handle || ""),
    "Name: " + String(profile && profile.name || ""),
    "Followers: " + (profile && profile.followers != null ? String(profile.followers) : ""),
    "Bio: " + String(profile && profile.bio || ""),
    "Captions:",
    ...captions.map((line) => "- " + String(line || "")),
    "Business context:",
    "Niche: " + String(icp.niche || ""),
    "Notes: " + String(icp.icp_notes || ""),
    "Offer summary: " + String(icp.offer_summary || ""),
    "Who: " + String(fields.who || ""),
    "Sell: " + String(fields.sell || ""),
    "Offer: " + String(fields.offer || ""),
    "Service: " + String(fields.service || ""),
    "Tag rules:",
    ...rules.map((rule) => "- " + [rule.name, rule.rule_kind, rule.rule_text].filter(Boolean).join(": ")),
    "Booking links:",
    ...offers.map((link) => "- " + String(link.name || "Booking") + " " + String(link.url || ""))
  ].join("\n");
}

function scopeMismatch(body, businessId, machineId) {
  if (!businessId) return null;
  if (body.business_id && String(body.business_id) !== String(businessId)) {
    return { status: 403, body: { error: "That worker key is for a different business." } };
  }
  if (body.agent_id && String(body.agent_id) !== String(businessId)) {
    return { status: 403, body: { error: "That worker key is for a different business." } };
  }
  if (body.machine_id && machineId && String(body.machine_id) !== String(machineId)) {
    return { status: 403, body: { error: "That worker key is for a different business." } };
  }
  return null;
}

async function insertEvent(service, row) {
  const saved = await service.from("client_machine_events").insert({
    business_id: row.business_id,
    machine_id: row.machine_id,
    kind: row.kind,
    severity: row.severity || "info",
    detail: row.detail || {},
    created_at: row.created_at
  });
  return saved && !saved.error;
}

async function raiseAlert(service, row) {
  await insertEvent(service, row);
  const agents = await service.from("hq_agents").select("id").limit(1);
  if (!agents || agents.error || !agents.data || !agents.data[0]) return;
  await service.from("hq_tasks").insert({
    agent_id: agents.data[0].id,
    title: "Outreacher machine needs attention",
    description: row.kind + " for machine " + row.machine_id,
    status: "needs_diego",
    priority: "high"
  });
}

async function revokeMachine(service, row, kind, now) {
  await service.from("client_machines").update({
    status: "revoked",
    revoked_at: now.toISOString(),
    refresh_token_hash: null,
    refresh_prev_hash: null,
    last_error: kind
  }).eq("id", row.id);
  await raiseAlert(service, {
    business_id: row.business_id,
    machine_id: row.id,
    kind,
    severity: "critical",
    detail: { status: "revoked" },
    created_at: now.toISOString()
  });
}

function tokenWindow(expiresAt, now) {
  const expires = new Date(expiresAt || 0).getTime();
  if (!Number.isFinite(expires) || expires <= 0) return "expired";
  if (expires <= now.getTime() - 30000) return "expired";
  if (expires - now.getTime() > TOKEN_WINDOW_MS + TOKEN_SKEW_MS) return "too_long";
  return "ok";
}

async function exchangeBootstrap(ctx) {
  const machineId = String(ctx.body.machine_id || "").trim();
  const token = String(ctx.body.bootstrap_token || ctx.body.token || "").trim();
  const serverId = String(ctx.body.server_id || "").trim();
  if (!machineId || !token || !serverId) return { status: 400, body: { ok: false, error: "machine_id, token, and server_id are required." } };
  if (!ctx.env || !ctx.env.privateKey) return { status: 500, body: { ok: false, error: "Machine signing key is not configured." } };
  const loaded = await ctx.service.from("client_machines").select("*").eq("id", machineId).maybeSingle();
  if (missingRelation(loaded.error)) {
    return { status: 503, body: { ok: false, error: "client_machines is not available.", dependency: "client_machines" } };
  }
  if (loaded.error || !loaded.data) return { status: 401, body: { ok: false, error: "Bootstrap token was not accepted." } };
  const row = loaded.data;
  const hash = await sha256Hex(token);
  if (row.bootstrap_used_at && safeEqual(hash, row.bootstrap_token_hash || "")) {
    await revokeMachine(ctx.service, row, "bootstrap_replay", ctx.now);
    return { status: 401, body: { ok: false, error: "Bootstrap token was already used." } };
  }
  if (!row.provider_server_id || !row.ipv4) return { status: 425, body: { ok: false, reason: "identity_pending", error: "Retry." } };
  const window = tokenWindow(row.bootstrap_expires_at, ctx.now);
  const matches = safeEqual(hash, row.bootstrap_token_hash || "")
    && window === "ok"
    && serverId === String(row.provider_server_id)
    && String(ctx.ip || "") === String(row.ipv4)
    && row.status === "provisioning"
    && !row.revoked_at;
  if (!matches) return { status: 401, body: { ok: false, error: "Bootstrap token was not accepted." } };
  const refresh = randomToken();
  const family = row.refresh_family_id || crypto.randomUUID();
  const saved = await ctx.service.from("client_machines").update({
    bootstrap_used_at: ctx.now.toISOString(),
    refresh_token_hash: await sha256Hex(refresh),
    refresh_family_id: family,
    refresh_prev_hash: null
  }).eq("id", row.id);
  if (saved && saved.error) return { status: 503, body: { ok: false, error: "The machine session could not be stored." } };
  const access = await signMachineToken({
    privateKey: ctx.env.privateKey,
    businessId: row.business_id,
    machineId: row.id,
    now: ctx.now
  });
  return {
    status: 200,
    body: {
      ok: true,
      access_token: access,
      refresh_token: refresh,
      expires_in: 3600,
      token_type: "Bearer",
      business_id: row.business_id,
      machine_id: row.id,
      role: "outreacher"
    }
  };
}

async function findMachineBy(service, column, value) {
  return service.from("client_machines").select("*").eq(column, value).maybeSingle();
}

async function rotateRefresh(ctx) {
  const token = String(ctx.body.refresh_token || "").trim();
  if (!token) return { status: 400, body: { ok: false, error: "refresh_token is required." } };
  if (!ctx.env || !ctx.env.privateKey) return { status: 500, body: { ok: false, error: "Machine signing key is not configured." } };
  const hash = await sha256Hex(token);
  const current = await findMachineBy(ctx.service, "refresh_token_hash", hash);
  if (missingRelation(current.error)) {
    return { status: 503, body: { ok: false, error: "client_machines is not available.", dependency: "client_machines" } };
  }
  if (current.data) {
    if (current.data.revoked_at || current.data.status === "revoked") return { status: 401, body: { ok: false, error: "Unauthorized." } };
    const next = randomToken();
    await ctx.service.from("client_machines").update({
      refresh_token_hash: await sha256Hex(next),
      refresh_prev_hash: hash
    }).eq("id", current.data.id);
    const access = await signMachineToken({
      privateKey: ctx.env.privateKey,
      businessId: current.data.business_id,
      machineId: current.data.id,
      now: ctx.now
    });
    return {
      status: 200,
      body: {
        ok: true,
        access_token: access,
        refresh_token: next,
        expires_in: 3600,
        token_type: "Bearer",
        business_id: current.data.business_id,
        machine_id: current.data.id,
        role: "outreacher"
      }
    };
  }
  const previous = await findMachineBy(ctx.service, "refresh_prev_hash", hash);
  if (previous.data && !previous.data.revoked_at && previous.data.status !== "revoked") {
    await revokeMachine(ctx.service, previous.data, "refresh_reuse", ctx.now);
  }
  return { status: 401, body: { ok: false, error: "Unauthorized." } };
}

function pauseReason(session) {
  if (session === "checkpoint") return "challenge";
  if (session === "action_block") return "action_block";
  if (session === "expired") return "warning";
  return "";
}

function eventKind(session) {
  if (session === "expired") return "session_expired";
  if (session === "checkpoint") return "checkpoint";
  if (session === "action_block") return "action_block";
  return "";
}

async function writeHeartbeat(ctx) {
  const session = String(ctx.body.session_state || "unknown");
  const mode = String(ctx.body.sending_mode || "off");
  if (!SESSION_STATES.has(session)) return { status: 400, body: { ok: false, error: "Unknown session state." } };
  if (!["off", "dry_run", "live"].includes(mode)) return { status: 400, body: { ok: false, error: "Unknown sending mode." } };
  const loaded = await ctx.service.from("client_machines").select("*").eq("id", ctx.machineId).maybeSingle();
  if (missingRelation(loaded.error)) {
    return { status: 503, body: { ok: false, error: "client_machines is not available.", dependency: "client_machines" } };
  }
  if (!loaded.data || loaded.data.business_id !== ctx.businessId) {
    return { status: 403, body: { error: "That worker key is for a different business." } };
  }
  const previous = String(loaded.data.session_state || "");
  const patch = {
    last_heartbeat_at: ctx.now.toISOString(),
    session_state: session,
    last_error: ctx.body.last_error == null ? null : String(ctx.body.last_error).slice(0, 500),
    image_version: ctx.body.image_version == null ? loaded.data.image_version : String(ctx.body.image_version),
    health: ctx.body.health === "error" ? "error" : "ok",
    sending_mode: mode,
    sends_today: Number(ctx.body.sends_today) || 0,
    sends_per_hour: Number(ctx.body.sends_per_hour) || 0,
    error_rate: Number(ctx.body.error_rate) || 0,
    last_send_at: ctx.body.last_send_at || loaded.data.last_send_at || null,
    uptime_s: Number(ctx.body.uptime_s) || 0,
    last_egress_ip: ctx.body.last_egress_ip ? String(ctx.body.last_egress_ip) : loaded.data.last_egress_ip || null,
    agent_version: ctx.body.image_version == null ? loaded.data.agent_version : String(ctx.body.image_version)
  };
  const saved = await ctx.service.from("client_machines").update(patch).eq("id", ctx.machineId);
  if (saved && saved.error) return { status: 503, body: { ok: false, error: "Heartbeat could not be stored.", dependency: "client_machines" } };
  const kind = eventKind(session);
  if (kind && previous !== session) {
    await insertEvent(ctx.service, {
      business_id: ctx.businessId,
      machine_id: ctx.machineId,
      kind,
      severity: "warning",
      detail: { session_state: session },
      created_at: ctx.now.toISOString()
    });
    const reason = pauseReason(session);
    const paused = await ctx.service.rpc("acq_bot_pause", {
      p_agent: ctx.businessId,
      p_reason: reason,
      p_notes: kind
    });
    if (paused && paused.error) {
      await ctx.service.from("acq_settings").update({
        ig_paused: true,
        ig_pause_reason: reason,
        ig_pause_notes: kind,
        ig_paused_at: ctx.now.toISOString()
      }).eq("agent_id", ctx.businessId);
    }
  }
  const controls = await ctx.service.from("acq_dm_controls").select("killed,enabled").eq("business_id", ctx.businessId).maybeSingle();
  const settings = await ctx.service.from("acq_settings").select("ig_paused,system_enabled").eq("agent_id", ctx.businessId).maybeSingle();
  const halt = Boolean(
    (controls.data && controls.data.killed === true)
    || (settings.data && (settings.data.ig_paused === true || settings.data.system_enabled === false))
    || session === "expired"
    || session === "checkpoint"
    || session === "action_block"
  );
  return { status: 200, body: { ok: true, halt, session_state: session } };
}

function listIncomplete(result, limit) {
  return Boolean(result && Array.isArray(result.data) && result.data.length >= limit);
}

export function presentConfig(parts) {
  const settings = parts.settings || {};
  const prompt = parts.prompt == null ? "" : String(parts.prompt);
  const links = (parts.offerLinks || []).map((link) => ({ name: link.name || "", url: link.url || "" }));
  const rules = (parts.tagRules || []).map((rule) => ({
    name: rule.name || "",
    rule_kind: rule.rule_kind || "",
    rule_text: rule.rule_text || ""
  }));
  const workforce = parts.workforce || {};
  const parameters = workforce.parameters && typeof workforce.parameters === "object" ? workforce.parameters : {};
  const briefFields = parts.brief && parts.brief.fields && typeof parts.brief.fields === "object" ? parts.brief.fields : {};
  const controls = parts.controls || { enabled: false, killed: false, paused: false, daily_cap: null, ig_handle: "" };
  return {
    ok: true,
    business_id: parts.businessId,
    machine_id: parts.machineId,
    settings: {
      niche: settings.niche || "",
      follower_min: settings.follower_min == null ? null : settings.follower_min,
      follower_max: settings.follower_max == null ? null : settings.follower_max,
      cta_keywords: settings.cta_keywords || "",
      icp_notes: settings.icp_notes || "",
      offer_summary: settings.offer_summary || "",
      daily_cap: settings.daily_cap == null ? null : settings.daily_cap,
      keyword_only: settings.keyword_only === true,
      skip_followed: settings.skip_followed === true,
      timezone: settings.timezone || "Europe/Madrid",
      quiet_start: settings.quiet_start || "22:00",
      quiet_end: settings.quiet_end || "08:00",
      ig_paused: settings.ig_paused === true,
      system_enabled: settings.system_enabled === true
    },
    outreacher: parts.outreacher,
    prompt,
    workforce: {
      min_score: parameters.min_score == null ? 70 : Number(parameters.min_score),
      active: workforce.status === "active" && workforce.enabled !== false
    },
    brief: {
      who: briefFields.who || "",
      sell: briefFields.sell || "",
      offer: briefFields.offer || "",
      service: briefFields.service || ""
    },
    dnc: parts.dnc || [],
    dnc_incomplete: parts.dncIncomplete === true,
    tag_rules: rules,
    offer_links: links,
    controls: {
      enabled: controls.enabled === true,
      killed: controls.killed === true,
      paused: String(controls.paused_reason || "").trim() !== "",
      daily_cap: controls.daily_cap == null ? null : controls.daily_cap,
      ig_handle: controls.ig_handle || ""
    },
    sent_handles: parts.sentHandles || [],
    sent_incomplete: parts.sentIncomplete === true,
    machine: {
      status: parts.machine && parts.machine.status || "",
      session_state: parts.machine && parts.machine.session_state || "unknown"
    },
    halt: controls.killed === true || settings.ig_paused === true || settings.system_enabled === false,
    proxy_url: parts.secrets ? parts.secrets.proxy_url || null : null,
    backup_key: parts.secrets ? parts.secrets.backup_key || null : null,
    volume_key: parts.secrets ? parts.secrets.volume_key || null : null,
    missing: parts.missing || []
  };
}

async function loadConfig(ctx) {
  const missing = [];
  const settings = await ctx.service.from("acq_settings").select("niche,follower_min,follower_max,cta_keywords,icp_notes,offer_summary,daily_cap,keyword_only,skip_followed,timezone,quiet_start,quiet_end,ig_paused,system_enabled").eq("agent_id", ctx.businessId).maybeSingle();
  const controls = await ctx.service.from("acq_dm_controls").select("enabled,killed,paused_reason,daily_cap,ig_handle").eq("business_id", ctx.businessId).maybeSingle();
  const prompts = await rowsOf(ctx.service.from("acq_agent_prompt_versions").select("body,version").eq("business_id", ctx.businessId).order("version", { ascending: false }).limit(1));
  const workforce = await ctx.service.from("business_workforce").select("status,enabled,parameters").eq("agent_id", ctx.businessId).eq("role", "personalised_outreach").maybeSingle();
  const brief = await ctx.service.from("acq_business_briefs").select("fields").eq("business_id", ctx.businessId).maybeSingle();
  const dnc = await rowsOf(ctx.service.from("acq_dnc").select("handle").eq("business_id", ctx.businessId).limit(LIST_LIMIT));
  const rules = await rowsOf(ctx.service.from("acq_tag_rules").select("name,rule_kind,rule_text").eq("business_id", ctx.businessId).limit(200));
  const links = await rowsOf(ctx.service.from("acq_offer_links").select("name,url").eq("business_id", ctx.businessId).limit(50));
  const sent = await rowsOf(ctx.service.from("acq_dm_sends").select("handle").eq("business_id", ctx.businessId).limit(LIST_LIMIT));
  const machine = await ctx.service.from("client_machines").select("status,session_state").eq("id", ctx.machineId).maybeSingle();
  let outreacher = { dry_run: true, missing: true };
  const outreach = await ctx.service.from("acq_outreacher_config").select("*").eq("business_id", ctx.businessId).maybeSingle();
  if (missingRelation(outreach.error)) {
    missing.push("acq_outreacher_config");
  } else if (outreach.data) {
    outreacher = outreach.data;
  }
  const secrets = await ctx.service.schema("private").from("outreach_machine_secrets").select("proxy_url,backup_key,volume_key").eq("machine_id", ctx.machineId).maybeSingle();
  if (missingRelation(secrets.error)) missing.push("outreach_machine_secrets");
  if (missingRelation(machine.error)) missing.push("client_machines");
  const promptBody = prompts.data && prompts.data[0] ? prompts.data[0].body : "";
  return {
    status: 200,
    body: presentConfig({
      businessId: ctx.businessId,
      machineId: ctx.machineId,
      settings: settings.data || {},
      prompt: promptBody,
      workforce: workforce.data || {},
      brief: brief.data || {},
      dnc: (dnc.data || []).map((row) => row.handle),
      dncIncomplete: listIncomplete(dnc, LIST_LIMIT),
      tagRules: rules.data || [],
      offerLinks: links.data || [],
      controls: controls.data || null,
      sentHandles: (sent.data || []).map((row) => row.handle),
      sentIncomplete: listIncomplete(sent, LIST_LIMIT),
      machine: machine.data || {},
      outreacher,
      secrets: secrets.data || {},
      missing
    })
  };
}

async function qualify(ctx) {
  const config = await loadConfig(ctx);
  const settings = config.body.settings;
  const user = draftUserMessage({
    profile: ctx.body.profile || {},
    trigger: ctx.body.trigger,
    brief: config.body.brief,
    links: [],
    tagRules: [],
    settings
  });
  try {
    const text = await ctx.complete(QUALIFY_SYSTEM, user);
    const parsed = JSON.parse(String(text || "").slice(String(text || "").indexOf("{"), String(text || "").lastIndexOf("}") + 1));
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
    if (!Number.isFinite(score)) return { status: 200, body: { ok: false, reason: "no_score" } };
    return { status: 200, body: { ok: true, score, summary: String(parsed.summary || ""), min_score: config.body.workforce.min_score } };
  } catch (error) {
    if (error && error.code === "cut_off") return { status: 200, body: { ok: false, reason: "truncated" } };
    if (error && error.code === "no_model") return { status: 503, body: { ok: false, reason: "no_model" } };
    return { status: 200, body: { ok: false, reason: "no_score" } };
  }
}

async function draft(ctx) {
  const config = await loadConfig(ctx);
  const prompt = config.body.prompt;
  if (!prompt) return { status: 200, body: { ok: false, reason: "no_prompt" } };
  const user = draftUserMessage({
    profile: ctx.body.profile || {},
    trigger: ctx.body.trigger,
    brief: config.body.brief,
    links: config.body.offer_links,
    tagRules: config.body.tag_rules,
    settings: config.body.settings
  });
  try {
    const text = await ctx.complete(prompt, user);
    if (typeof text !== "string" || !text.trim()) return { status: 200, body: { ok: false, reason: "empty" } };
    return { status: 200, body: { ok: true, text } };
  } catch (error) {
    if (error && error.code === "cut_off") return { status: 200, body: { ok: false, reason: "truncated" } };
    if (error && error.code === "no_model") return { status: 503, body: { ok: false, reason: "no_model" } };
    return { status: 502, body: { ok: false, reason: "draft_failed" } };
  }
}

async function claim(ctx) {
  const kind = String(ctx.body.action_kind || "");
  const target = String(ctx.body.target || "").trim();
  if (!CLAIM_KINDS.has(kind) || !target) return { status: 400, body: { ok: false, reason: "claim_invalid" } };
  const result = await ctx.service.rpc("outreacher_can_send", {
    business_id: ctx.businessId,
    action_kind: kind,
    target
  });
  if (result && result.error) {
    if (missingFunction(result.error)) return { status: 503, body: { ok: false, reason: "claim_unavailable" } };
    return { status: 503, body: { ok: false, reason: "claim_failed" } };
  }
  const payload = result && result.data || {};
  if (payload.ok !== true || !payload.claim_id) return { status: 200, body: { ok: false, reason: payload.reason || "refused" } };
  return {
    status: 200,
    body: {
      ok: true,
      claim_id: payload.claim_id,
      expires_at: payload.expires_at || new Date(ctx.now.getTime() + CLAIM_TTL_MS).toISOString()
    }
  };
}

async function claimCheck(ctx) {
  const claimId = String(ctx.body.claim_id || "");
  if (!claimId) return { status: 400, body: { ok: false, reason: "claim_required" } };
  const result = await ctx.service.rpc("outreacher_claim_check", { claim_id: claimId });
  if (result && result.error) {
    if (missingFunction(result.error)) return { status: 503, body: { ok: false, reason: "claim_unavailable" } };
    return { status: 503, body: { ok: false, reason: "claim_failed" } };
  }
  const payload = result && result.data || {};
  if (payload.ok !== true) return { status: 200, body: { ok: false, reason: payload.reason || "refused" } };
  return { status: 200, body: { ok: true, claim_id: claimId, expires_at: payload.expires_at || null } };
}

async function logActivity(ctx, action, result, notes) {
  await ctx.service.from("acq_activity").insert({
    agent_id: ctx.businessId,
    role: "personalised_outreach",
    action,
    result,
    notes: String(notes || result || "").slice(0, 200),
    actor: "outreacher",
    payload: {
      handle: ctx.body.handle || ctx.body.target || "",
      body: ctx.body.body == null ? "" : String(ctx.body.body),
      claim_id: ctx.body.claim_id || "",
      kind: ctx.body.kind || ctx.body.action_kind || ""
    }
  });
}

async function reportSend(ctx) {
  const claimId = String(ctx.body.claim_id || "");
  const resultName = String(ctx.body.result || "");
  if (!claimId) return { status: 400, body: { ok: false, reason: "claim_required" } };
  if (!["sent", "dry_run", "failed", "skipped"].includes(resultName)) {
    return { status: 400, body: { ok: false, reason: "result_invalid" } };
  }
  const text = ctx.body.body == null ? "" : String(ctx.body.body);
  if (resultName === "sent" && text.length > DM_STORE_LIMIT) {
    await logActivity(ctx, "dm.refused", "skipped", "will_not_truncate");
    return { status: 200, body: { ok: false, reason: "will_not_truncate" } };
  }
  const reported = await ctx.service.rpc("outreacher_report_send", {
    claim_id: claimId,
    result: resultName,
    detail: { handle: ctx.body.handle || "", body: text, kind: ctx.body.kind || "dm" }
  });
  if (reported && reported.error) {
    if (missingFunction(reported.error)) return { status: 503, body: { ok: false, reason: "report_unavailable" } };
    return { status: 503, body: { ok: false, reason: "report_failed" } };
  }
  if (reported && reported.data && reported.data.ok === false) {
    return { status: 200, body: { ok: false, reason: reported.data.reason || "refused" } };
  }
  if (resultName === "sent") {
    await ctx.service.from("acq_dm_sends").insert({
      business_id: ctx.businessId,
      handle: String(ctx.body.handle || "").replace(/^@+/, "").toLowerCase(),
      body: text
    });
  }
  await logActivity(ctx, "dm." + resultName, resultName, ctx.body.reason || resultName);
  return { status: 200, body: { ok: true, result: resultName } };
}

async function logEvent(ctx) {
  const kind = String(ctx.body.kind || "dm_skip");
  await logActivity(ctx, kind, "skipped", ctx.body.reason || kind);
  await insertEvent(ctx.service, {
    business_id: ctx.businessId,
    machine_id: ctx.machineId,
    kind,
    severity: "info",
    detail: {
      handle: ctx.body.handle || "",
      reason: ctx.body.reason || "",
      body: ctx.body.body == null ? "" : String(ctx.body.body)
    },
    created_at: ctx.now.toISOString()
  });
  return { status: 200, body: { ok: true } };
}

async function backupSlot(ctx) {
  const stamp = ctx.now.toISOString().replace(/[:.]/g, "-");
  const path = ctx.businessId + "/" + ctx.machineId + "/" + stamp + ".bin";
  if (!ctx.service.storage) return { status: 503, body: { ok: false, reason: "backup_unavailable" } };
  const signed = await ctx.service.storage.from("outreacher-profiles").createSignedUploadUrl(path);
  if (!signed || signed.error || !signed.data || !signed.data.signedUrl) {
    return { status: 503, body: { ok: false, reason: "backup_unavailable", dependency: "outreacher-profiles" } };
  }
  return {
    status: 200,
    body: { ok: true, upload_url: signed.data.signedUrl, token: signed.data.token || "", path }
  };
}

export function pruneNames(entries, keep = 7) {
  const sorted = [...(entries || [])].sort((left, right) => String(right.created_at || right.name).localeCompare(String(left.created_at || left.name)));
  return { keep: sorted.slice(0, keep), drop: sorted.slice(keep) };
}

async function backupCommit(ctx) {
  const path = String(ctx.body.path || "");
  if (!path.startsWith(ctx.businessId + "/")) return { status: 403, body: { error: "That worker key is for a different business." } };
  const listed = await ctx.service.storage.from("outreacher-profiles").list(ctx.businessId + "/" + ctx.machineId);
  const names = listed && listed.data ? listed.data : [];
  const decision = pruneNames(names, 7);
  if (decision.drop.length) {
    await ctx.service.storage.from("outreacher-profiles").remove(decision.drop.map((item) => item.name));
  }
  await insertEvent(ctx.service, {
    business_id: ctx.businessId,
    machine_id: ctx.machineId,
    kind: "backup_stored",
    severity: "info",
    detail: { path, kept: decision.keep.length },
    created_at: ctx.now.toISOString()
  });
  return { status: 200, body: { ok: true, kept: decision.keep.length, dropped: decision.drop.length } };
}

export async function handleMachineAction(ctx) {
  const body = ctx.body && typeof ctx.body === "object" ? ctx.body : {};
  if (hasPassword(body)) return { status: 400, body: { ok: false, error: "Passwords are not accepted." } };
  const action = String(body.action || ctx.action || "");
  if (!MACHINE_ACTIONS.has(action)) return { status: 403, body: { error: "That action is not available to this machine." } };
  const next = { ...ctx, body, action, now: ctx.now instanceof Date ? ctx.now : new Date(ctx.now || Date.now()) };
  if (action === "bootstrap") return exchangeBootstrap(next);
  if (action === "refresh") return rotateRefresh(next);
  const mismatch = scopeMismatch(body, next.businessId, next.machineId);
  if (mismatch) return mismatch;
  if (!next.businessId || !next.machineId) return { status: 401, body: { error: "Unauthorized." } };
  if (action === "heartbeat") return writeHeartbeat(next);
  if (action === "config") return loadConfig(next);
  if (action === "qualify") return qualify(next);
  if (action === "draft") return draft(next);
  if (action === "claim") return claim(next);
  if (action === "claim_check") return claimCheck(next);
  if (action === "report_send") return reportSend(next);
  if (action === "log_event") return logEvent(next);
  if (action === "backup_slot") return backupSlot(next);
  if (action === "backup_commit") return backupCommit(next);
  return { status: 400, body: { error: "Unknown action." } };
}
