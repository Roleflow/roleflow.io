// Roleflow conversation engine. verify_jwt is false because Instagram, Google,
// and pg_cron cannot send a user JWT. Each route authenticates itself.
// Outreach workers do not call this function. They call acquisition-bot.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { hubChallenge, verifySignature, extractEvents, eventId } from "./ig/webhook.js";
import { planTurn } from "./ig/engine.js";
import { completeJson, resolveProvider, providerHelp, systemPrompt } from "./ig/llm.js";
import { bookingTool, loadBusinessRuntime, logLlmError } from "../_shared/llm-provider.js";
import { bookingAllows, bookingBehaviour } from "../_shared/booking-plan.js";
import { clipInstructions } from "../_shared/clip-plan.js";
import { seedSections, PROMPT_ROLES, SECTION_KEYS } from "./ig/prompt-seed.js";
import { encryptToken, decryptToken } from "./ig/crypto.js";
import { textBody, audioBody, privateReplyBody, typingBody, seenBody, withPolicy, retryPlan, underRateLimit } from "./ig/send.js";
import { messagingDecision } from "./ig/policy.js";
import { pickSlots } from "./ig/slots.js";
import { agentEnabled, agentKeyForKind, followupDue, followupLead, normalizePolicy, recoveryKey } from "../_shared/agent-control.js";
import { replyDelayMs } from "./ig/delay.js";
import { parseSignedRequest } from "./ig/deletion.js";
import { routeByIgUser } from "./ig/tenant.js";
import { qualifiersPass } from "./ig/qualify.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json"
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRAPH = () => Deno.env.get("GRAPH_API_VERSION") || "v21.0";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const path = url.pathname;
  try {
    if (path.endsWith("/webhook")) return await webhook(req);
    if (path.endsWith("/meta/callback")) return await metaCallback(req, url);
    if (path.endsWith("/google/callback")) return await googleCallback(req, url);
    if (path.endsWith("/deletion")) return await deletion(req, url);
    if (path.endsWith("/tick")) return await tick(req);
    if (req.method !== "POST") return json(405, { error: "POST only." });
    const body = await readJson(req);
    if (path.endsWith("/meta/start")) return await metaStart(req, body);
    if (path.endsWith("/google/start")) return await googleStart(req, body);
    return await engine(req, body);
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : "Request failed." });
  }
});

function json(status, payload, extra = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { ...cors, ...extra } });
}

async function readJson(req) {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function service() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) throw new Error("Supabase env is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function anonClient(req) {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
  return createClient(url, key, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function requireBusiness(req, businessId) {
  if (!UUID.test(String(businessId || ""))) return { error: json(400, { error: "business_id is required." }) };
  const userClient = anonClient(req);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return { error: json(401, { error: "Sign in required." }) };
  const { data } = await userClient.from("acq_workspaces").select("id").eq("id", businessId).maybeSingle();
  if (!data) return { error: json(403, { error: "That business is not available on this account." }) };
  return { user: userData.user, db: service() };
}

async function webhook(req) {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const result = hubChallenge({
      mode: url.searchParams.get("hub.mode"),
      verifyToken: url.searchParams.get("hub.verify_token"),
      expected: Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") || "",
      challenge: url.searchParams.get("hub.challenge")
    });
    if (!result.ok) return new Response("forbidden", { status: 403 });
    return new Response(result.body, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  if (req.method !== "POST") return json(405, { error: "POST only." });
  const raw = await req.text();
  const secret = Deno.env.get("META_APP_SECRET") || "";
  if (!verifySignature(raw, req.headers.get("X-Hub-Signature-256"), secret)) {
    return json(401, { error: "Invalid signature." });
  }
  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { error: "JSON required." }); }
  const db = service();
  const { data: connections } = await db.from("ig_connections").select("business_id, ig_user_id, status").eq("status", "connected");
  for (const event of extractEvents(body)) {
    const id = eventId(event);
    const businessId = routeByIgUser(event.igUserId, connections || []);
    const inserted = await db.from("ig_webhook_events").insert({
      event_id: id,
      business_id: businessId,
      kind: event.kind,
      payload: event
    }).select("event_id");
    if (inserted.error) continue;
    if (!businessId) continue;
    if (event.senderId && event.senderId === event.igUserId) continue;
    await acceptInbound(db, businessId, event);
    await db.from("ig_webhook_events").update({ processed_at: new Date().toISOString() }).eq("event_id", id);
  }
  return json(200, { ok: true });
}

async function acceptInbound(db, businessId, event) {
  if (!event.senderId) return;
  const settings = await loadSettings(db, businessId);
  const handle = String(event.username || "").replace(/^@/, "").toLowerCase();
  if (handle && await isDnc(db, businessId, handle)) {
    await escalate(db, businessId, null, "do_not_contact", handle + " is on the do-not-contact list.");
    return;
  }
  const existing = await db.from("ig_threads").select("*").eq("business_id", businessId).eq("igsid", event.senderId).maybeSingle();
  let thread = existing.data;
  const stamp = new Date(Number(event.timestamp) || Date.now()).toISOString();
  if (!thread) {
    const created = await db.from("ig_threads").insert({
      business_id: businessId,
      igsid: event.senderId,
      username: handle || null,
      state: event.kind === "comment" ? "comment_to_dm" : "qualification",
      last_user_message_at: stamp
    }).select("*").single();
    thread = created.data;
  } else if (event.kind === "message" || event.kind === "comment") {
    await db.from("ig_threads").update({
      username: handle || thread.username,
      last_user_message_at: stamp,
      followup_count: 0,
      updated_at: new Date().toISOString()
    }).eq("id", thread.id).eq("business_id", businessId);
    thread.last_user_message_at = stamp;
    thread.followup_count = 0;
  }
  if (!thread) return;
  if (event.mid || event.commentId) {
    await db.from("ig_messages").insert({
      business_id: businessId,
      thread_id: thread.id,
      direction: "in",
      body: event.text || "",
      meta_mid: event.mid || null,
      kind: event.kind
    });
  }
  await db.rpc("acq_log", {
    p_agent: businessId,
    p_target: thread.target_id,
    p_role: event.kind === "comment" ? "comment_to_dm" : "qualification",
    p_action: "instagram." + event.kind,
    p_result: "in",
    p_notes: (event.text || "").slice(0, 500),
    p_actor: "instagram",
    p_payload: { business_id: businessId, thread_id: thread.id },
    p_voice: null
  });
  if (event.kind === "reaction" || event.kind === "mention" || event.kind === "postback") return;
  if (thread.human_locked) return;
  if (!settings?.system_enabled) return;
  if (!await agentEnabled(db, businessId, "setter")) return;
  const delay = replyDelayMs(settings.reply_delay_seconds ?? 60, 0.2, Math.random);
  await db.from("ig_outbox").insert({
    business_id: businessId,
    thread_id: thread.id,
    kind: event.kind === "comment" ? "comment_private" : "reply",
    payload: { text: event.text || "", comment_id: event.commentId || null, event_kind: event.kind },
    run_at: new Date(Date.now() + delay).toISOString(),
    idempotency_key: "job:" + eventId(event)
  });
}

async function tick(req) {
  const db = service();
  const secret = await db.rpc("acq_read_cron_secret");
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!secret.data || bearer !== secret.data) return json(401, { error: "Unauthorized." });
  await refreshDue(db);
  await queueRecovery(db);
  const claimed = await db.rpc("acq_claim_outbox", { p_limit: 10 });
  const rows = claimed.data || [];
  for (const row of rows) {
    await runOutbox(db, row);
  }
  return json(200, { ok: true, claimed: rows.length });
}

async function runOutbox(db, row) {
  const businessId = row.business_id;
  const threadRes = await db.from("ig_threads").select("*").eq("id", row.thread_id).eq("business_id", businessId).maybeSingle();
  const thread = threadRes.data;
  const settings = await loadSettings(db, businessId);
  const finish = (status, last_error = null) => db.from("ig_outbox").update({ status, last_error }).eq("id", row.id).eq("business_id", businessId);
  if (!thread || !settings) return finish("failed", "missing thread");
  if (!settings.system_enabled && row.kind !== "human") return finish("blocked", "system_off");
  const agentKey = agentKeyForKind(row.kind);
  if (agentKey !== "human" && !await agentEnabled(db, businessId, agentKey)) return finish("blocked", "agent_off");
  const role = row.kind === "recovery" ? "conversation_recovery" : row.kind === "comment_private" ? "comment_to_dm" : "qualification";
  const savedPrompt = agentKey === "human" ? "" : await setterPromptBody(db, businessId);
  if (agentKey === "setter" && !savedPrompt) return finish("blocked", "prompt_missing");
  const quiet = await db.rpc("acq_in_quiet_hours", {
    p_tz: settings.timezone,
    p_start: settings.quiet_start,
    p_end: settings.quiet_end
  });
  if (quiet.data === true && row.kind !== "human") {
    return db.from("ig_outbox").update({
      status: "pending",
      attempts: Math.max(0, row.attempts - 1),
      run_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    }).eq("id", row.id).eq("business_id", businessId);
  }
  const recent = await db.from("ig_send_log").select("id", { count: "exact", head: true }).eq("business_id", businessId).gte("created_at", new Date(Date.now() - 60000).toISOString());
  if (!underRateLimit(recent.count || 0, 20)) {
    return db.from("ig_outbox").update({
      status: "pending",
      run_at: new Date(Date.now() + 30000).toISOString(),
      last_error: "rate_limit"
    }).eq("id", row.id).eq("business_id", businessId);
  }
  if (row.kind === "human") return sendHuman(db, row, thread, settings);
  const prompts = await currentPrompt(db, businessId, role);
  const env = Deno.env.toObject();
  const loaded = await loadBusinessRuntime(db, businessId, "setter", env);
  const booking = await loadBooking(db, businessId, prompts, settings);
  const clipRows = await db.from("acq_owner_clips").select("id, label, when_to_use, kind, storage_path, active, speech_provider").eq("business_id", businessId).eq("active", true);
  const clips = clipRows.error ? [] : (clipRows.data || []);
  let plan;
  try {
    plan = await planTurn({
      thread: toThread(thread),
      eventKind: row.payload?.event_kind || "message",
      kind: "ai",
      dnc: false,
      now: Date.now(),
      booking,
      llm: (input) => completeJson({
        env,
        runtime: loaded.runtime,
        fallback: loaded.fallback,
        onError: (info) => logLlmError(db, { businessId, purpose: "setter", ...info }),
        tools: [bookingTool()],
        system: (savedPrompt ? savedPrompt + "\n\n" : "") + systemPrompt({ ...prompts, notes: prompts.notes + knowledgeBlock(settings) }, booking) + clipInstructions(clips),
        messages: [{ role: "user", content: JSON.stringify({ inbound: row.payload?.text || "", state: input.thread.state, attributes: input.thread.attributes || {} }) }]
      })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "llm failed";
    if (error?.code === "llm_unconfigured" || row.attempts >= 5) {
      await escalate(db, businessId, thread.target_id, "llm", message);
      return finish("blocked", message);
    }
    const planRetry = retryPlan(503, row.attempts);
    return db.from("ig_outbox").update({
      status: "pending",
      run_at: new Date(Date.now() + planRetry.delayMs).toISOString(),
      last_error: message
    }).eq("id", row.id).eq("business_id", businessId);
  }
  await db.from("ig_threads").update({
    state: plan.state,
    score: plan.score,
    attributes: plan.attributes,
    lead_status: plan.state === "booked" ? "converted" : plan.state === "dead" ? "dead" : (plan.score || thread.lead_status),
    human_locked: thread.human_locked || plan.state === "booked" || plan.state === "human",
    updated_at: new Date().toISOString()
  }).eq("id", thread.id).eq("business_id", businessId);
  if (plan.escalate) await escalate(db, businessId, thread.target_id, plan.escalateReason || plan.state, plan.escalateReason || plan.state);
  if (plan.noResponse) return finish("done");
  const bubbles = await maybeBook(db, businessId, thread, settings, plan, booking);
  const decision = messagingDecision({
    lastUserMessageAt: thread.last_user_message_at,
    now: Date.now(),
    kind: "ai",
    humanLocked: false
  });
  if (!decision.allow) return finish("blocked", decision.reason);
  const sent = await deliver(db, businessId, thread, settings, bubbles, plan.voiceNoteSlot, decision, row.kind, row.payload?.comment_id);
  return finish(sent.ok ? "done" : "failed", sent.error || null);
}

async function sendHuman(db, row, thread, settings) {
  const decision = messagingDecision({
    lastUserMessageAt: thread.last_user_message_at,
    now: Date.now(),
    kind: "human",
    humanLocked: true
  });
  if (!decision.allow) {
    return db.from("ig_outbox").update({ status: "blocked", last_error: decision.reason, tag: null }).eq("id", row.id).eq("business_id", row.business_id);
  }
  const sent = await deliver(db, row.business_id, thread, settings, [row.payload?.text || ""], null, decision, "human", null);
  return db.from("ig_outbox").update({
    status: sent.ok ? "done" : "failed",
    last_error: sent.error || null,
    tag: decision.tag
  }).eq("id", row.id).eq("business_id", row.business_id);
}

async function deliver(db, businessId, thread, settings, bubbles, slot, decision, kind, commentId) {
  const token = await readIgToken(db, businessId);
  if (!token) return { ok: false, error: "Instagram is not connected." };
  const texts = (bubbles || []).filter(Boolean);
  let voiceUrl = null;
  if (slot) {
    const picked = await db.rpc("acq_pick_voice_note", { p_agent: businessId, p_slot: slot, p_niche: null, p_variant: null });
    const note = picked.data;
    if (note?.storage_path) {
      const signed = await db.storage.from("acq-voice").createSignedUrl(note.storage_path, 3600);
      voiceUrl = signed.data?.signedUrl || null;
      if (voiceUrl) {
        await postGraph(token, withPolicy(audioBody({ recipientId: thread.igsid, url: voiceUrl }), decision));
        await db.from("acq_voice_sends").insert({
          agent_id: businessId,
          voice_note_id: note.id,
          target_id: thread.target_id,
          slot,
          result: "sent"
        });
      }
    }
  }
  const chunks = texts.length ? texts : [];
  for (const text of chunks) {
    const body = kind === "comment_private" && commentId
      ? privateReplyBody({ commentId, text })
      : withPolicy(textBody({ recipientId: thread.igsid, text }), decision);
    const result = await postGraph(token, body);
    if (!result.ok) return result;
    await db.from("ig_messages").insert({
      business_id: businessId,
      thread_id: thread.id,
      direction: "out",
      body: text,
      kind: voiceUrl ? "audio+text" : "text"
    });
    await db.from("ig_send_log").insert({ business_id: businessId });
  }
  if (settings.public_comment_replies && kind === "comment_private" && commentId && texts[0]) {
    await fetch(`https://graph.instagram.com/${GRAPH()}/${commentId}/replies`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ message: texts[0] })
    });
  }
  return { ok: true };
}

async function postGraph(token, body) {
  await fetch(`https://graph.instagram.com/${GRAPH()}/me/messages`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(typingBody(body.recipient?.id || ""))
  }).catch(() => null);
  const response = await fetch(`https://graph.instagram.com/${GRAPH()}/me/messages`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (response.ok) {
    if (body.recipient?.id) {
      await fetch(`https://graph.instagram.com/${GRAPH()}/me/messages`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify(seenBody(body.recipient.id))
      }).catch(() => null);
    }
    return { ok: true };
  }
  const payload = await response.json().catch(() => ({}));
  const retry = retryPlan(response.status, 1);
  return { ok: false, error: payload?.error?.message || "Instagram send failed.", retry };
}

async function loadBooking(db, businessId, sections, settings) {
  const tools = await db.from("acq_agent_tools").select("kind, name, config").eq("business_id", businessId);
  if (tools.error) throw new Error("tools lookup failed");
  return bookingBehaviour({
    sections,
    tools: tools.data || [],
    settings: { booking_fallback_url: (settings && settings.booking_fallback_url) || "" }
  });
}

async function maybeBook(db, businessId, thread, settings, plan, booking) {
  const bubbles = [...(plan.bubbles || [])];
  if (plan.state !== "booking" && plan.bookingAction !== "book") return bubbles;
  const allowed = booking ? bookingAllows(booking, plan.attributes) : qualifiersPass(plan.attributes);
  if (!allowed) return bubbles;
  const calendar = await db.from("google_connections").select("*").eq("business_id", businessId).maybeSingle();
  if (plan.bookingAction === "book" && plan.slotStart) {
    const offered = Array.isArray(thread.offered_slots) ? thread.offered_slots : [];
    const match = offered.find((slot) => slot.start === plan.slotStart);
    if (!match) {
      bubbles.push("those times are no longer open. want me to look at another day?");
      return bubbles;
    }
    if (calendar.data?.status === "connected") {
      const created = await createEvent(db, businessId, thread, match, plan.email);
      if (created?.hangoutLink || created?.htmlLink) {
        bubbles.push(`locked in for ${match.label}. the invite is on its way.`);
      }
    }
    return bubbles;
  }
  if (calendar.data?.status === "connected") {
    const slots = await freeSlots(db, businessId, thread.timezone || settings.timezone || "Europe/Madrid");
    if (slots.length >= 2) {
      await db.from("ig_threads").update({ offered_slots: slots }).eq("id", thread.id).eq("business_id", businessId);
      bubbles.push(`I've got ${slots[0].label} or ${slots[1].label} your time. which works better?`);
      return bubbles.slice(-2);
    }
  }
  const link = String((plan && plan.link) || (settings && settings.booking_fallback_url) || "").trim();
  if (link.startsWith("https://")) bubbles.push(link);
  return bubbles.slice(-2);
}

async function setterPromptBody(db, businessId) {
  const row = await db.from("acq_agent_prompts").select("body").eq("business_id", businessId).maybeSingle();
  if (!row || row.error || !row.data) return "";
  return String(row.data.body || "").trim();
}

async function queueRecovery(db) {
  const { data: businesses } = await db.from("acq_settings").select("agent_id, system_enabled, timezone").eq("system_enabled", true);
  for (const settings of businesses || []) {
    const businessId = settings.agent_id;
    if (!await agentEnabled(db, businessId, "followup")) continue;
    const policyRow = await db.from("acq_followup_policy").select("*").eq("business_id", businessId).maybeSingle();
    const policy = normalizePolicy(policyRow && policyRow.data);
    const { data: threads } = await db.from("ig_threads").select("*").eq("business_id", businessId).eq("human_locked", false).limit(100);
    for (const thread of threads || []) {
      const decision = followupDue({
        enabled: true,
        policy,
        lead: followupLead(thread),
        now: Date.now(),
        timeZone: settings.timezone
      });
      if (!decision.due) continue;
      const key = recoveryKey(thread.id, thread.followup_count);
      const inserted = await db.from("ig_outbox").insert({
        business_id: businessId,
        thread_id: thread.id,
        kind: "recovery",
        payload: { text: "", event_kind: "message" },
        run_at: new Date().toISOString(),
        idempotency_key: key
      });
      if (!inserted.error) {
        await db.from("ig_threads").update({
          followup_count: thread.followup_count + 1,
          state: thread.state === "comment_to_dm" ? "qualification" : "recovery"
        }).eq("id", thread.id).eq("business_id", businessId);
      }
    }
  }
}

async function engine(req, body) {
  const action = String(body.action || "");
  const businessId = String(body.business_id || body.agent_id || "");
  const auth = await requireBusiness(req, businessId);
  if (auth.error) return auth.error;
  const db = auth.db;
  if (action === "playground") return playground(db, businessId, body);
  if (action === "prompts_get") return json(200, { ok: true, roles: await allPrompts(db, businessId) });
  if (action === "prompts_save") return savePrompt(db, businessId, auth.user.id, body);
  if (action === "seed_prompts") return json(200, await ensurePrompts(db, businessId, auth.user.id));
  if (action === "lock") return lockThread(db, businessId, auth.user.id, body);
  if (action === "inbox_send") return inboxSend(db, businessId, body);
  if (action === "disconnect_instagram") return disconnectIg(db, businessId);
  if (action === "disconnect_google") return disconnectGoogle(db, businessId);
  if (action === "health") return json(200, { ok: true, llm: resolveProvider(Deno.env.toObject()) ? "configured" : providerHelp() });
  return json(400, { error: "Unknown action." });
}

async function playground(db, businessId, body) {
  const role = PROMPT_ROLES.includes(body.role) ? body.role : "qualification";
  await ensurePrompts(db, businessId, null);
  const prompts = await currentPrompt(db, businessId, role);
  const settings = await loadSettings(db, businessId);
  const env = Deno.env.toObject();
  const loaded = await loadBusinessRuntime(db, businessId, "setter", env);
  const booking = await loadBooking(db, businessId, prompts, settings);
  try {
    const plan = await planTurn({
      thread: {
        state: body.state || "qualification",
        lastUserMessageAt: new Date().toISOString(),
        human_locked: false,
        attributes: body.attributes || {}
      },
      eventKind: "message",
      kind: "ai",
      now: Date.now(),
      booking,
      llm: () => completeJson({
        env,
        runtime: loaded.runtime,
        fallback: loaded.fallback,
        onError: (info) => logLlmError(db, { businessId, purpose: "setter", ...info }),
        tools: [bookingTool()],
        system: systemPrompt({ ...prompts, notes: (prompts.notes || "") + knowledgeBlock(settings) }, booking),
        messages: Array.isArray(body.messages) ? body.messages : [{ role: "user", content: String(body.text || "") }]
      })
    });
    return json(200, { ok: true, plan, sent: false });
  } catch (error) {
    return json(400, { error: error instanceof Error ? error.message : "Playground failed.", sent: false });
  }
}

async function savePrompt(db, businessId, userId, body) {
  const role = String(body.role || "");
  if (!PROMPT_ROLES.includes(role)) return json(400, { error: "Unknown agent." });
  const sections = {};
  for (const key of SECTION_KEYS) sections[key] = String(body.sections?.[key] || "");
  const { data: latest } = await db.from("acq_prompt_versions").select("version").eq("business_id", businessId).eq("role", role).order("version", { ascending: false }).limit(1);
  const version = (latest?.[0]?.version || 0) + 1;
  const inserted = await db.from("acq_prompt_versions").insert({
    business_id: businessId, role, version, sections, created_by: userId
  }).select("id").single();
  if (inserted.error) return json(400, { error: inserted.error.message });
  await db.from("acq_prompt_current").upsert({ business_id: businessId, role, version_id: inserted.data.id });
  return json(200, { ok: true, version });
}

async function ensurePrompts(db, businessId, userId) {
  const { data: current } = await db.from("acq_prompt_current").select("role").eq("business_id", businessId);
  const have = new Set((current || []).map((row) => row.role));
  for (const role of PROMPT_ROLES) {
    if (have.has(role)) continue;
    const sections = seedSections(role);
    const inserted = await db.from("acq_prompt_versions").insert({
      business_id: businessId, role, version: 1, sections, created_by: userId
    }).select("id").single();
    if (inserted.data) {
      await db.from("acq_prompt_current").upsert({ business_id: businessId, role, version_id: inserted.data.id });
    }
  }
  return { ok: true };
}

async function allPrompts(db, businessId) {
  await ensurePrompts(db, businessId, null);
  const { data } = await db.from("acq_prompt_current").select("role, version_id").eq("business_id", businessId);
  const ids = (data || []).map((row) => row.version_id);
  const versions = ids.length
    ? await db.from("acq_prompt_versions").select("id, role, version, sections").in("id", ids).eq("business_id", businessId)
    : { data: [] };
  return versions.data || [];
}

async function currentPrompt(db, businessId, role) {
  const rows = await allPrompts(db, businessId);
  return rows.find((row) => row.role === role)?.sections || seedSections(role) || {};
}

async function lockThread(db, businessId, userId, body) {
  const locked = body.locked !== false;
  const updated = await db.from("ig_threads").update({
    human_locked: locked,
    human_locked_by: locked ? userId : null,
    state: locked ? "human" : "qualification",
    updated_at: new Date().toISOString()
  }).eq("id", body.thread_id).eq("business_id", businessId).select("id");
  if (!updated.data?.length) return json(404, { error: "Thread not found." });
  return json(200, { ok: true, human_locked: locked });
}

async function inboxSend(db, businessId, body) {
  const text = String(body.text || "").trim();
  if (!text) return json(400, { error: "Write a reply first." });
  const thread = await db.from("ig_threads").select("*").eq("id", body.thread_id).eq("business_id", businessId).maybeSingle();
  if (!thread.data) return json(404, { error: "Thread not found." });
  await db.from("ig_threads").update({ human_locked: true, state: "human" }).eq("id", thread.data.id).eq("business_id", businessId);
  const key = "human:" + thread.data.id + ":" + crypto.randomUUID();
  await db.from("ig_outbox").insert({
    business_id: businessId,
    thread_id: thread.data.id,
    kind: "human",
    payload: { text },
    run_at: new Date().toISOString(),
    idempotency_key: key,
    tag: null
  });
  return json(200, { ok: true, queued: true });
}

async function metaStart(req, body) {
  const auth = await requireBusiness(req, body.business_id || body.agent_id);
  if (auth.error) return auth.error;
  const appId = Deno.env.get("META_APP_ID") || "";
  if (!appId || !Deno.env.get("META_APP_SECRET")) return json(503, { error: "Set META_APP_ID and META_APP_SECRET." });
  const state = crypto.randomUUID();
  await auth.db.from("acq_oauth_states").insert({
    state,
    provider: "instagram",
    business_id: body.business_id || body.agent_id,
    user_id: auth.user.id,
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
  });
  const redirect = Deno.env.get("META_REDIRECT_URI") || `${Deno.env.get("SUPABASE_URL")}/functions/v1/roleflow-acquisition/meta/callback`;
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirect,
    response_type: "code",
    scope: "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments",
    state
  });
  return json(200, { ok: true, url: "https://www.instagram.com/oauth/authorize?" + params.toString() });
}

async function metaCallback(req, url) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const db = service();
  const found = await db.from("acq_oauth_states").select("*").eq("state", state).eq("provider", "instagram").maybeSingle();
  const row = found.data;
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return redirectAccount("", "Instagram connect expired. Try again.");
  await db.from("acq_oauth_states").delete().eq("state", state);
  const redirectUri = Deno.env.get("META_REDIRECT_URI") || `${Deno.env.get("SUPABASE_URL")}/functions/v1/roleflow-acquisition/meta/callback`;
  const tokenRes = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("META_APP_ID") || "",
      client_secret: Deno.env.get("META_APP_SECRET") || "",
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code: code || ""
    })
  });
  const short = await tokenRes.json();
  if (!tokenRes.ok) return redirectAccount(row.business_id, short?.error_message || "Instagram did not return a token.");
  const longRes = await fetch(`https://graph.instagram.com/access_token?${new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: Deno.env.get("META_APP_SECRET") || "",
    access_token: short.access_token
  })}`);
  const long = await longRes.json();
  const access = long.access_token || short.access_token;
  const profile = await fetch(`https://graph.instagram.com/${GRAPH()}/me?fields=user_id,username`, {
    headers: { Authorization: "Bearer " + access }
  });
  const me = await profile.json();
  const igUserId = String(me.user_id || me.id || "");
  const cipher = await encryptToken(access, Deno.env.get("META_TOKEN_KEY") || "");
  await db.rpc("acq_put_ig_token", { p_business: row.business_id, p_token: cipher });
  await db.from("ig_connections").upsert({
    business_id: row.business_id,
    ig_user_id: igUserId || null,
    username: me.username || null,
    expires_at: new Date(Date.now() + (Number(long.expires_in) || 3600) * 1000).toISOString(),
    scopes: "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments",
    status: "connected",
    last_error: null,
    connected_at: new Date().toISOString()
  });
  return redirectAccount(row.business_id, "");
}

async function googleStart(req, body) {
  const auth = await requireBusiness(req, body.business_id || body.agent_id);
  if (auth.error) return auth.error;
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID") || "";
  if (!clientId || !Deno.env.get("GOOGLE_CLIENT_SECRET")) return json(503, { error: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." });
  const state = crypto.randomUUID();
  await auth.db.from("acq_oauth_states").insert({
    state,
    provider: "google",
    business_id: body.business_id || body.agent_id,
    user_id: auth.user.id,
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
  });
  const redirect = Deno.env.get("GOOGLE_REDIRECT_URI") || `${Deno.env.get("SUPABASE_URL")}/functions/v1/roleflow-acquisition/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
    state
  });
  return json(200, { ok: true, url: "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString() });
}

async function googleCallback(_req, url) {
  const db = service();
  const state = url.searchParams.get("state");
  const found = await db.from("acq_oauth_states").select("*").eq("state", state).eq("provider", "google").maybeSingle();
  const row = found.data;
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return redirectAccount("", "Google connect expired. Try again.");
  await db.from("acq_oauth_states").delete().eq("state", state);
  const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI") || `${Deno.env.get("SUPABASE_URL")}/functions/v1/roleflow-acquisition/google/callback`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: url.searchParams.get("code") || "",
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") || "",
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") || "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });
  const token = await tokenRes.json();
  if (!tokenRes.ok || !token.refresh_token) return redirectAccount(row.business_id, token.error_description || "Google did not return a refresh token.");
  const key = Deno.env.get("GOOGLE_TOKEN_KEY") || Deno.env.get("META_TOKEN_KEY") || "";
  await db.rpc("acq_put_google_token", {
    p_business: row.business_id,
    p_refresh: await encryptToken(token.refresh_token, key),
    p_access: await encryptToken(token.access_token, key)
  });
  await db.from("google_connections").upsert({
    business_id: row.business_id,
    calendar_id: "primary",
    expires_at: new Date(Date.now() + (Number(token.expires_in) || 3600) * 1000).toISOString(),
    status: "connected",
    last_error: null,
    connected_at: new Date().toISOString()
  });
  return redirectAccount(row.business_id, "");
}

async function deletion(req, url) {
  if (req.method === "GET") {
    const db = service();
    const status = await db.rpc("meta_deletion_status", { p_code: url.searchParams.get("code") || "" });
    return json(200, status.data || { ok: false });
  }
  const form = await req.formData().catch(() => null);
  const signed = form?.get("signed_request") || (await readJson(req)).signed_request;
  const data = parseSignedRequest(String(signed || ""), Deno.env.get("META_APP_SECRET") || "");
  if (!data?.user_id) return json(400, { error: "Invalid signed_request." });
  const db = service();
  const code = crypto.randomUUID().slice(0, 12);
  const igUserId = String(data.user_id);
  const connection = await db.from("ig_connections").select("business_id").eq("ig_user_id", igUserId).maybeSingle();
  await db.from("meta_deletion_requests").insert({
    confirmation_code: code,
    ig_user_id: igUserId,
    business_id: connection.data?.business_id || null,
    status: "received"
  });
  const threads = await db.from("ig_threads").select("id, business_id").eq("igsid", igUserId);
  for (const thread of threads.data || []) {
    await db.from("ig_messages").delete().eq("thread_id", thread.id).eq("business_id", thread.business_id);
    await db.from("ig_threads").delete().eq("id", thread.id).eq("business_id", thread.business_id);
  }
  if (connection.data?.business_id) {
    await db.rpc("acq_delete_ig_token", { p_business: connection.data.business_id });
    await db.from("ig_connections").update({ status: "disconnected", ig_user_id: null, last_error: "Data deletion request" }).eq("business_id", connection.data.business_id);
  }
  await db.from("meta_deletion_requests").update({ status: "completed" }).eq("confirmation_code", code);
  return json(200, {
    url: `https://www.roleflow.io/data-deletion/?code=${code}`,
    confirmation_code: code
  });
}

function redirectAccount(businessId, message) {
  const next = new URL("https://www.roleflow.io/account/acquisition/");
  if (businessId) next.searchParams.set("business", businessId);
  next.hash = "integrations";
  if (message) next.searchParams.set("notice", message.slice(0, 180));
  return Response.redirect(next.toString(), 302);
}

async function disconnectIg(db, businessId) {
  await db.rpc("acq_delete_ig_token", { p_business: businessId });
  await db.from("ig_connections").upsert({
    business_id: businessId,
    ig_user_id: null,
    status: "disconnected",
    last_error: null
  });
  return json(200, { ok: true });
}

async function disconnectGoogle(db, businessId) {
  await db.rpc("acq_delete_google_token", { p_business: businessId });
  await db.from("google_connections").upsert({ business_id: businessId, status: "disconnected", last_error: null });
  return json(200, { ok: true });
}

async function loadSettings(db, businessId) {
  const { data } = await db.from("acq_settings").select("*").eq("agent_id", businessId).maybeSingle();
  return data;
}

async function isDnc(db, businessId, handle) {
  const { data } = await db.from("acq_dnc").select("handle").eq("business_id", businessId).eq("handle", handle).maybeSingle();
  return Boolean(data);
}

async function escalate(db, businessId, targetId, kind, message) {
  await db.from("acq_exceptions").insert({
    agent_id: businessId,
    kind: String(kind || "escalation").slice(0, 80),
    message: String(message || "Needs a look.").slice(0, 500),
    target_id: targetId
  });
}

function toThread(row) {
  return {
    state: row.state,
    lastUserMessageAt: row.last_user_message_at,
    human_locked: row.human_locked,
    attributes: row.attributes || {},
    score: row.score
  };
}

function knowledgeBlock(settings) {
  if (!settings) return "";
  return `\n\nBusiness knowledge\nOffer: ${settings.offer_summary || ""}\nICP: ${settings.icp_notes || ""}\nNotes: ${settings.knowledge_base || ""}`;
}

async function readIgToken(db, businessId) {
  const { data } = await db.rpc("acq_read_ig_token", { p_business: businessId });
  if (!data) return null;
  return decryptToken(data, Deno.env.get("META_TOKEN_KEY") || "");
}

async function refreshDue(db) {
  const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await db.from("ig_connections").select("business_id, expires_at, status").eq("status", "connected").lt("expires_at", soon);
  for (const row of rows || []) {
    try {
      const token = await readIgToken(db, row.business_id);
      if (!token) continue;
      const response = await fetch(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({
        grant_type: "ig_refresh_token",
        access_token: token
      })}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || "refresh failed");
      await db.rpc("acq_put_ig_token", {
        p_business: row.business_id,
        p_token: await encryptToken(payload.access_token, Deno.env.get("META_TOKEN_KEY") || "")
      });
      await db.from("ig_connections").update({
        expires_at: new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString(),
        status: "connected",
        last_error: null
      }).eq("business_id", row.business_id);
    } catch (error) {
      await db.from("ig_connections").update({
        status: "error",
        last_error: error instanceof Error ? error.message : "refresh failed"
      }).eq("business_id", row.business_id);
    }
  }
}

async function freeSlots(db, businessId, timeZone) {
  const access = await googleAccess(db, businessId);
  if (!access) return [];
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: "Bearer " + access, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: "primary" }] })
  });
  const payload = await response.json();
  const busy = payload?.calendars?.primary?.busy || [];
  return pickSlots({ busy, now: Date.now(), timeZone, count: 2 });
}

async function createEvent(db, businessId, thread, slot, email) {
  const access = await googleAccess(db, businessId);
  if (!access) return null;
  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1", {
    method: "POST",
    headers: { Authorization: "Bearer " + access, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: "Roleflow call",
      start: { dateTime: slot.start },
      end: { dateTime: slot.end },
      attendees: email ? [{ email }] : [],
      conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } }
    })
  });
  const event = await response.json();
  if (!response.ok) return null;
  await db.from("ig_threads").update({
    calendar_event_id: event.id,
    meet_link: event.hangoutLink || null,
    state: "booked",
    human_locked: true,
    lead_status: "converted"
  }).eq("id", thread.id).eq("business_id", businessId);
  if (thread.target_id) {
    await db.from("acq_bookings").insert({
      agent_id: businessId,
      target_id: thread.target_id,
      scheduled_at: slot.start,
      show_status: "scheduled",
      calendar_ref: event.id,
      source: "instagram"
    });
  }
  return event;
}

async function googleAccess(db, businessId) {
  const { data } = await db.rpc("acq_read_google_token", { p_business: businessId });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.refresh_encrypted) return null;
  const key = Deno.env.get("GOOGLE_TOKEN_KEY") || Deno.env.get("META_TOKEN_KEY") || "";
  const refresh = await decryptToken(row.refresh_encrypted, key);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") || "",
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") || "",
      refresh_token: refresh,
      grant_type: "refresh_token"
    })
  });
  const payload = await response.json();
  return payload.access_token || null;
}
