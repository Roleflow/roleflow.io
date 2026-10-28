// Inbox webhook. Verifies the signature, stores the inbound message, and
// replies through the official inbox from the outbox. Ack stays under the
// provider's retry window; the setter runs after the response.

import { completeJson, systemPrompt } from "../roleflow-acquisition/ig/llm.js";
import { bookingTool, loadBusinessRuntime, loadSetterReply, logLlmError } from "../_shared/llm-provider.js";
import { splitReply } from "../_shared/split-reply.js";
import { chooseClip, clipFromSlot, clipInstructions } from "../_shared/clip-plan.js";
import { sentMessage, withAttachment } from "../_shared/clip-send.js";
import {
  API_BASE,
  enqueueBody,
  handleWebhook,
  idempotencyKey,
  interpretSend,
  outboxWriteStatus,
  planGatewayReply,
  planPayload,
  readWebhookHeaders,
  privateReplyKind,
  replyText,
  safeWebhookError,
  sendRequest
} from "../_shared/ig-gateway.js";
import { adminClient, json, loadGatewayConfig } from "../_shared/gateway-http.js";
import { shouldAutoReply } from "../_shared/inbox-send.js";
import { bookingBehaviour } from "../_shared/booking-plan.js";
import { agentEnabled, stampAgentEnabled, sendBlocked } from "../_shared/agent-control.js";
import { briefKnowledge, chooseModel, delaySeconds, handoverOnSent, leadPatch, officeOpen } from "../_shared/setter-gate.js";
import { classifierSystem, classifyComment, commentVoicePlan, madridDayStartIso, parseClassifier } from "../_shared/comment-voice.js";
import { bookingLinkFor, expandPrompt, resolveOutgoing, tokenGuide, voiceCatalog, voiceClipPayload } from "../_shared/prompt-tokens.js";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST." });
  const raw = await req.text();
  const headers = readWebhookHeaders(req.headers);
  const admin = adminClient();
  const config = await loadGatewayConfig(admin);
  const jobs = [];
  let businessId: string | null = null;
  let result;
  try {
    result = await handleWebhook({
      raw,
      secret: config.webhookSecret,
      signature: headers.signature,
      eventId: headers.eventId,
      lookupAccount: async (accountId) => {
        const account = await lookupAccount(admin, accountId);
        if (account) businessId = account.businessId;
        return account;
      },
      remember: async (event) => {
        const seen = await admin.rpc("acq_gateway_seen_event", {
          p_event: event.id,
          p_business: businessId,
          p_name: event.event || ""
        });
        if (seen.error) throw new Error("dedupe failed");
      },
      seen: async (eventId) => {
        const seen = await admin.rpc("acq_gateway_seen_event", {
          p_event: eventId,
          p_business: businessId,
          p_name: ""
        });
        if (seen.error) throw new Error("dedupe failed");
        return seen.data === true;
      },
      forget: async (eventId) => {
        await admin.from("ig_gateway_events").delete().eq("event_id", eventId);
      },
      ingest: async ({ event, account, queued, kind }) => {
        businessId = account.businessId;
        const stored = await admin.rpc("acq_gateway_store_inbound", {
          p_business: account.businessId,
          p_sender: event.senderId,
          p_username: event.username,
          p_conversation: event.conversationId || event.commentId || "",
          p_external: event.externalId,
          p_body: event.text,
          p_at: new Date().toISOString(),
          p_kind: event.kind
        });
        if (stored.error || !stored.data || stored.data.ok !== true) {
          const detail = stored.error ? String(stored.error.code || stored.error.message || "rpc") : "rejected";
          throw new Error("store failed: " + detail.slice(0, 120));
        }
        if (event.kind === "sent") {
          const stop = await admin.from("acq_settings").select("stop_on_human").eq("agent_id", account.businessId).maybeSingle();
          if (stop.error) throw new Error("settings lookup failed");
          if (handoverOnSent(stop.data && stop.data.stop_on_human) && stored.data.thread_id) {
            await admin.from("ig_threads").update({ human_locked: true, updated_at: new Date().toISOString() }).eq("id", stored.data.thread_id).eq("business_id", account.businessId);
          }
        }
        if (!queued) return;
        const lead = await admin.from("acq_contacts").select("ai_enabled").eq("business_id", account.businessId).eq("external_id", event.senderId).maybeSingle();
        if (lead.error) throw new Error("lead lookup failed");
        if (!shouldAutoReply(true, lead.data)) return;
        const queuedRow = await admin.rpc("acq_gateway_enqueue", {
          p_business: account.businessId,
          p_thread: stored.data.thread_id,
          p_kind: kind,
          p_payload: planPayload(event, stored.data.conversation_id),
          p_key: idempotencyKey(event.id)
        });
        if (queuedRow.error || !queuedRow.data) throw new Error("queue failed");
        jobs.push({
          id: queuedRow.data,
          event,
          account,
          threadId: stored.data.thread_id
        });
      }
    });
  } catch (error) {
    console.error("webhook_failed", safeWebhookError(error));
    return json(500, { ok: false, error: "Could not store the event." });
  }
  if (result.body && result.body.queued && jobs.length) {
    const task = settle(admin, config.apiKey, jobs).catch(() => {});
    const edge = (globalThis as { EdgeRuntime?: { waitUntil?: (task: Promise<unknown>) => void } }).EdgeRuntime;
    if (edge && edge.waitUntil) edge.waitUntil(task);
  }
  return json(result.status, result.body);
});

async function lookupAccount(admin, accountId) {
  if (!accountId) return null;
  const row = await admin.from("ig_gateway_accounts").select("business_id, account_id, status").eq("account_id", accountId).eq("status", "connected").maybeSingle();
  if (row.error || !row.data) return null;
  const settings = await admin.from("acq_settings").select("system_enabled").eq("agent_id", row.data.business_id).maybeSingle();
  const role = await admin.rpc("acq_role_on", { p_agent: row.data.business_id, p_role: "comment_to_dm" });
  const commentVoice = await agentEnabled(admin, row.data.business_id, "comment_voice");
  return {
    businessId: row.data.business_id,
    accountId: row.data.account_id,
    systemEnabled: Boolean(settings.data && settings.data.system_enabled),
    commentToDm: role.data === true,
    commentVoice
  };
}

async function settle(admin, apiKey, jobs) {
  for (const job of jobs) await planJob(admin, job);
  const businesses = [...new Set(jobs.map((job) => job.account.businessId))];
  for (const businessId of businesses) await sendPending(admin, apiKey, businessId);
}

async function planJob(admin, job) {
  const current = await admin.from("ig_outbox").select("id, status, payload, kind").eq("id", job.id).maybeSingle();
  if (!current.data || current.data.status !== "pending" || !current.data.payload || current.data.payload.needsPlan !== true) return;
  if (current.data.kind === "comment_voice") {
    await planCommentVoice(admin, job, current.data);
    return;
  }
  const threadRes = await admin.from("ig_threads").select("state, human_locked, attributes, score, last_user_message_at").eq("id", job.threadId).eq("business_id", job.account.businessId).maybeSingle();
  const row = threadRes.data || {};
  const thread = {
    state: row.state || (job.event.kind === "comment" ? "comment_to_dm" : "qualification"),
    human_locked: row.human_locked === true,
    attributes: row.attributes || {},
    score: row.score || null,
    lastUserMessageAt: row.last_user_message_at || new Date().toISOString()
  };
  const env = {
    LLM_PROVIDER: Deno.env.get("LLM_PROVIDER") || "",
    XAI_API_KEY: Deno.env.get("XAI_API_KEY") || "",
    XAI_MODEL: Deno.env.get("XAI_MODEL") || "",
    OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY") || "",
    OPENAI_MODEL: Deno.env.get("OPENAI_MODEL") || "",
    GEMINI_API_KEY: Deno.env.get("GEMINI_API_KEY") || "",
    GOOGLE_API_KEY: Deno.env.get("GOOGLE_API_KEY") || "",
    GEMINI_MODEL: Deno.env.get("GEMINI_MODEL") || ""
  };
  const role = job.event.kind === "comment" ? "comment_to_dm" : "qualification";
  const setterOn = await agentEnabled(admin, job.account.businessId, "setter");
  if (!setterOn) {
    await admin.from("ig_outbox").update({ status: "blocked", last_error: "The agent is off." }).eq("id", job.id).eq("status", "pending");
    return;
  }
  const savedPrompt = await admin.from("acq_agent_prompts").select("body").eq("business_id", job.account.businessId).maybeSingle();
  const setterPrompt = savedPrompt.error || !savedPrompt.data ? "" : String(savedPrompt.data.body || "").trim();
  if (!setterPrompt) {
    await admin.from("ig_outbox").update({ status: "blocked", last_error: "Save a system prompt before the setter can reply." }).eq("id", job.id).eq("status", "pending");
    return;
  }
  const gate = await admin.from("acq_settings").select("office_mode, timezone, office_start, office_end, hours_by_day, reply_delay_seconds, reply_delay_max_seconds, setter_model, booking_fallback_url").eq("agent_id", job.account.businessId).maybeSingle();
  if (gate.error) {
    await admin.from("ig_outbox").update({ status: "failed", last_error: "The reply was not prepared." }).eq("id", job.id).eq("status", "pending");
    return;
  }
  const prefs = gate.data || {};
  if (!officeOpen({
    now: Date.now(),
    timeZone: prefs.timezone || "Europe/Madrid",
    mode: prefs.office_mode || "always",
    start: prefs.office_start,
    end: prefs.office_end,
    hoursByDay: prefs.hours_by_day || {}
  })) {
    await admin.from("ig_outbox").update({ status: "blocked", last_error: "Outside office hours." }).eq("id", job.id).eq("status", "pending");
    return;
  }
  const loaded = await loadSetterReply(admin, job.account.businessId, env);
  const runtime = loaded.chain[0];
  if (!runtime) {
    await admin.from("ig_outbox").update({ status: "blocked", last_error: "The setter is not configured." }).eq("id", job.id).eq("status", "pending");
    return;
  }
  if (runtime.provider === "xai" && (runtime.model === "grok-4.3" || runtime.model === "grok-4.7")) {
    runtime.model = chooseModel({ preferred: runtime.model, text: job.event.text, state: thread.state });
  }
  let plan;
  try {
    const studio = await promptSections(admin, job.account.businessId, "inbound_manager");
    const roleSections = await promptSections(admin, job.account.businessId, role);
    const sections = { ...roleSections, ...studio };
    const tools = await admin.from("acq_agent_tools").select("kind, name, config").eq("business_id", job.account.businessId);
    if (tools.error) throw new Error("tools lookup failed");
    const settings = await admin.from("acq_settings").select("offer_summary, icp_notes, knowledge_base").eq("agent_id", job.account.businessId).maybeSingle();
    const brief = await admin.from("acq_business_briefs").select("fields").eq("business_id", job.account.businessId).maybeSingle();
    const knowledge = (settings.data
      ? "\n\nBusiness knowledge\nOffer: " + (settings.data.offer_summary || "") + "\nICP: " + (settings.data.icp_notes || "") + "\nNotes: " + (settings.data.knowledge_base || "")
      : "") + briefKnowledge(brief.data && brief.data.fields);
    const booking = bookingBehaviour({
      sections,
      tools: tools.data || [],
      settings: { booking_fallback_url: prefs.booking_fallback_url || "" }
    });
    const clipRows = await admin.from("acq_owner_clips").select("id, label, when_to_use, kind, storage_path, mime_type, delivery_path, delivery_mime, active, speech_provider").eq("business_id", job.account.businessId).eq("active", true);
    const clips = clipRows.error ? [] : (clipRows.data || []);
    const sentRows = await admin.from("acq_clip_sends").select("clip_id").eq("business_id", job.account.businessId).eq("conversation_key", String(job.threadId || ""));
    const alreadySent = sentRows.error ? [] : (sentRows.data || []).map((item) => item.clip_id);
    const bookingLink = bookingLinkFor(prefs.booking_fallback_url || "");
    const voiceRows = await admin.from("acq_voice_library").select("id, title, slot, storage_path, mime_type, active").eq("agent_id", job.account.businessId).eq("active", true);
    const catalog = voiceCatalog(voiceRows.error ? [] : voiceRows.data || []);
    const promptBody = expandPrompt(setterPrompt, bookingLink) + "\n\n" + tokenGuide(catalog, bookingLink) + "\n\n" + systemPrompt({}, booking) + knowledge + clipInstructions(clips);
    plan = await planGatewayReply({
      thread,
      eventKind: job.event.kind,
      text: job.event.text,
      now: Date.now(),
      booking,
      llm: () => completeJson({
        env,
        chain: loaded.chain,
        voice: loaded.voice,
        onError: (info) => logLlmError(admin, {
          businessId: job.account.businessId,
          purpose: "setter",
          ...info,
          message: info.auth && info.source === "own"
            ? "This business's Claude API key was rejected. Fell back to the next model."
            : info.message
        }),
        tools: [bookingTool()],
        system: promptBody,
        messages: [{ role: "user", content: JSON.stringify({ inbound: job.event.text || "", state: thread.state, attributes: thread.attributes || {} }) }]
      })
    });
    plan.clipChoice = chooseClip({
      requestedId: plan.clipId || clipFromSlot(plan.voiceNoteSlot, clips),
      clips,
      alreadySent,
      promptText: promptBody
    });
    plan.voiceCatalog = catalog;
    plan.bookingLink = bookingLink;
  } catch (error) {
    const unconfigured = Boolean(error && typeof error === "object" && "code" in error && error.code === "llm_unconfigured");
    await admin.from("ig_outbox").update({
      status: unconfigured ? "blocked" : "failed",
      last_error: unconfigured ? "The setter is not configured." : "The reply was not prepared."
    }).eq("id", job.id).eq("status", "pending");
    return;
  }
  const patch: { state?: string; score?: string; attributes?: Record<string, string>; updated_at: string } = {
    state: plan.state,
    attributes: plan.attributes || {},
    updated_at: new Date().toISOString()
  };
  if (plan.score) patch.score = plan.score;
  await admin.from("ig_threads").update(patch).eq("id", job.threadId).eq("business_id", job.account.businessId);
  if (job.event.senderId) {
    const contact = await admin.from("acq_contacts").select("id, attributes, tags").eq("business_id", job.account.businessId).eq("external_id", job.event.senderId).maybeSingle();
    const rules = await admin.from("acq_tag_rules").select("name, rule_text").eq("business_id", job.account.businessId);
    if (contact.data) {
      const next = leadPatch({
        attributes: contact.data.attributes,
        tags: contact.data.tags,
        extracted: plan.attributes,
        score: plan.score,
        inbound: job.event.text,
        rules: rules.data || []
      });
      await admin.from("acq_contacts").update({ attributes: next.attributes, tags: next.tags, updated_at: new Date().toISOString() }).eq("id", contact.data.id).eq("business_id", job.account.businessId);
    }
  }
  const spoken = resolveOutgoing(replyText(plan), { voices: plan.voiceCatalog || [], bookingLink: plan.bookingLink });
  const text = spoken.text;
  const tokenVoice = spoken.voices[0] && job.event.kind !== "comment" ? voiceClipPayload(spoken.voices[0]) : null;
  let chosen = tokenVoice || plan.clipChoice || null;
  if (chosen && !tokenVoice) {
    const recorded = await admin.from("acq_clip_sends").insert({
      business_id: job.account.businessId,
      clip_id: chosen.id,
      conversation_key: String(job.threadId || "")
    }).select("id");
    if (recorded.error || !recorded.data || !recorded.data.length) chosen = null;
  }
  if (!text && !chosen) {
    await admin.from("ig_outbox").update({ status: "done", last_error: null, payload: enqueueBody(job.event, "", current.data.payload.conversationRowId) }).eq("id", job.id).eq("status", "pending");
    return;
  }
  const wait = delaySeconds(prefs.reply_delay_seconds, prefs.reply_delay_max_seconds, Math.random);
  const splitLookup = await admin.from("acq_settings").select("reply_split_words").eq("agent_id", job.account.businessId).maybeSingle();
  const splitWords = splitLookup.error || !splitLookup.data || splitLookup.data.reply_split_words == null ? 15 : Number(splitLookup.data.reply_split_words);
  const parts = splitReply(text, splitWords);
  const payload = enqueueBody({ ...job.event, text: parts[0] || text }, parts[0] || text, current.data.payload.conversationRowId);
  for (let index = 1; index < parts.length; index += 1) {
    await admin.from("ig_outbox").insert({
      business_id: job.account.businessId,
      thread_id: job.threadId,
      kind: current.data.kind || "reply",
      transport: "official",
      payload: enqueueBody(job.event, parts[index], current.data.payload.conversationRowId),
      run_at: new Date(Date.now() + (wait + index * 4) * 1000).toISOString(),
      status: "pending",
      idempotency_key: String(job.id) + ":part:" + index
    });
  }
  if (chosen) {
    payload.clip = {
      id: chosen.id,
      path: chosen.delivery_path || chosen.storage_path,
      mime: chosen.delivery_mime || chosen.mime_type,
      kind: chosen.kind || "audio",
      label: chosen.label || "Voice note",
      filename: chosen.filename || clipFileName(chosen),
      bucket: chosen.bucket || "owner-clips"
    };
  }
  if (wait > 25) {
    await admin.from("ig_outbox").update({ payload, run_at: new Date(Date.now() + wait * 1000).toISOString() }).eq("id", job.id).eq("status", "pending");
    return;
  }
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  await admin.from("ig_outbox").update({ payload }).eq("id", job.id).eq("status", "pending");
}

async function promptSections(admin, businessId, role) {
  const current = await admin.from("acq_prompt_current").select("version_id").eq("business_id", businessId).eq("role", role).maybeSingle();
  if (!current.data) return {};
  const version = await admin.from("acq_prompt_versions").select("sections").eq("id", current.data.version_id).eq("business_id", businessId).maybeSingle();
  const sections = version.data && version.data.sections;
  return sections && typeof sections === "object" ? sections : {};
}

async function sendPending(admin, apiKey, businessId) {
  if (!apiKey) return;
  const pending = await admin.from("ig_outbox").select("id, business_id, thread_id, kind, payload, attempts, status").eq("business_id", businessId).eq("transport", "official").eq("status", "pending").lte("run_at", new Date().toISOString()).order("run_at", { ascending: true }).limit(5);
  for (const row of pending.data || []) {
    if (!row.payload || row.payload.needsPlan) continue;
    if (!String(row.payload.text || "").trim() && !(row.payload.clip && row.payload.clip.path)) continue;
    await sendOne(admin, apiKey, row);
  }
}

async function sendOne(admin, apiKey, row) {
  const stamped = await stampAgentEnabled(admin, row);
  if (sendBlocked(stamped)) {
    await admin.from("ig_outbox").update({ status: "blocked", last_error: "The agent is off." }).eq("id", row.id).eq("status", "pending");
    return;
  }
  if (privateReplyKind(row.kind) && row.payload) {
    delete row.payload.clip;
    delete row.payload.attachmentUrl;
    delete row.payload.attachmentType;
  }
  const locked = await admin.from("ig_outbox").update({ status: "running", attempts: (row.attempts || 0) + 1 }).eq("id", row.id).eq("status", "pending").select("id");
  if (!locked.data || !locked.data.length) return;
  let prepared = row;
  try {
    prepared = await withAttachment(row, apiKey, fetch, (clip) => downloadOwnerClip(admin, clip));
  } catch (_error) {
    await admin.from("ig_outbox").update({ status: "failed", last_error: "The voice note was not sent." }).eq("id", row.id);
    return;
  }
  const request = sendRequest(prepared);
  let result;
  try {
    const response = await fetch(API_BASE + request.path, {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(request.body)
    });
    const payload = await response.json().catch(() => ({}));
    result = interpretSend(response.status, payload);
  } catch (_error) {
    result = { ok: false, status: "failed", error: "The reply was not sent." };
  }
  const written = outboxWriteStatus(result);
  await admin.from("ig_outbox").update({ status: written.status, last_error: written.last_error }).eq("id", row.id);
  if (!result.ok) return;
  const recorded = sentMessage(prepared);
  const conversationId = row.payload.conversationRowId;
  if (conversationId) {
    await admin.from("acq_messages").insert({
      business_id: row.business_id,
      conversation_id: conversationId,
      external_id: "out:" + row.id,
      role: "assistant",
      body: recorded.body,
      metadata: recorded.metadata,
      sent_at: new Date().toISOString()
    });
  }
  if (row.thread_id) {
    await admin.from("ig_messages").insert({
      business_id: row.business_id,
      thread_id: row.thread_id,
      direction: "out",
      body: recorded.body,
      kind: recorded.kind === "text" ? "text" : recorded.kind
    });
  }
}

async function planCommentVoice(admin, job, row) {
  const businessId = job.account.businessId;
  const enabled = await agentEnabled(admin, businessId, "comment_voice");
  const rulesRes = await admin.from("acq_comment_voice_rules").select("id, keywords, intent, message, clip_id, position").eq("business_id", businessId).order("position", { ascending: true });
  const capRes = await admin.from("acq_comment_voice_settings").select("daily_cap").eq("business_id", businessId).maybeSingle();
  if (rulesRes.error || capRes.error) {
    await admin.from("ig_outbox").update({ status: "blocked", last_error: "Comment voice is not ready." }).eq("id", job.id).eq("status", "pending");
    return;
  }
  const rules = rulesRes.data || [];
  const commentId = String(job.event.commentId || "");
  const commenterId = String(job.event.senderId || "");
  const priorComment = commentId
    ? await admin.from("acq_comment_voice_log").select("id").eq("business_id", businessId).eq("comment_id", commentId).limit(1)
    : { data: [] };
  const priorPerson = commenterId
    ? await admin.from("acq_comment_voice_log").select("id").eq("business_id", businessId).eq("commenter_id", commenterId).eq("queued", true).limit(1)
    : { data: [] };
  const today = await admin.from("acq_comment_voice_log").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("queued", true).gte("created_at", madridDayStartIso(Date.now()));
  let model = null;
  if (enabled && rules.some((rule) => String(rule.intent || "").trim())) {
    const quick = classifyComment({ text: job.event.text, rules });
    if (!quick.matched) model = await classifyWithModel(admin, businessId, job.event.text, rules);
  }
  const plan = commentVoicePlan({
    enabled,
    text: job.event.text,
    rules,
    model,
    commentId,
    commenterId,
    commentAt: job.event.commentedAt || (row.payload && row.payload.commentedAt) || new Date().toISOString(),
    now: Date.now(),
    dailyCap: capRes.data && capRes.data.daily_cap,
    seenComment: Boolean(priorComment.data && priorComment.data.length),
    seenCommenter: Boolean(priorPerson.data && priorPerson.data.length),
    sentToday: today.count || 0
  });
  const logged = await admin.from("acq_comment_voice_log").insert({
    business_id: businessId,
    comment_id: commentId,
    commenter_id: commenterId,
    commenter_username: String(job.event.username || "").slice(0, 80),
    comment_text: String(job.event.text || "").slice(0, 1000),
    matched: plan.log.matched,
    queued: false,
    reason: plan.log.reason,
    rule_id: plan.log.rule_id,
    clip_id: plan.log.clip_id
  });
  if (logged.error || !plan.send) {
    await admin.from("ig_outbox").update({
      status: enabled ? "done" : "blocked",
      last_error: enabled ? null : "The agent is off.",
      payload: { ...(row.payload || {}), needsPlan: false, decision: plan.log.reason }
    }).eq("id", job.id).eq("status", "pending");
    return;
  }
  const payload = enqueueBody(job.event, plan.send.text, row.payload && row.payload.conversationRowId);
  payload.needsPlan = false;
  payload.intendedClipId = plan.send.intendedClipId || "";
  const marked = await admin.from("acq_comment_voice_log").update({ queued: true }).eq("business_id", businessId).eq("comment_id", commentId);
  if (marked.error) payload.intendedClipId = payload.intendedClipId || "";
  await admin.from("ig_outbox").update({ payload }).eq("id", job.id).eq("status", "pending");
}

async function classifyWithModel(admin, businessId, text, rules) {
  const env = Deno.env.toObject();
  try {
    const loaded = await loadBusinessRuntime(admin, businessId, "setter", env);
    if (!loaded.runtime && !loaded.fallback) return null;
    const raw = await completeJson({
      env,
      runtime: loaded.runtime,
      fallback: loaded.fallback,
      onError: (info) => logLlmError(admin, { businessId, purpose: "comment_voice", ...info }),
      system: classifierSystem(rules),
      messages: [{ role: "user", content: String(text || "").slice(0, 2000) }],
      responseFormat: { type: "text" },
      maxTokens: 200,
      temperature: 0
    });
    return parseClassifier(typeof raw === "string" ? raw : "", rules);
  } catch (_error) {
    return null;
  }
}

async function downloadOwnerClip(admin, clip) {
  const file = await admin.storage.from(clip.bucket || "owner-clips").download(clip.path);
  if (file.error || !file.data) throw new Error("The voice note could not be read.");
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  return { bytes, mime: clip.mime || "audio/wav", filename: clip.filename || "clip.wav" };
}

function clipFileName(clip) {
  const mime = String(clip.delivery_mime || clip.mime_type || "");
  const kind = clip.kind || "audio";
  if (kind === "image") return mime.includes("png") ? "clip.png" : "clip.jpg";
  if (kind === "video") return "clip.mp4";
  if (mime.includes("wav")) return "clip.wav";
  if (mime.includes("aac")) return "clip.aac";
  return "clip.m4a";
}
