// Queues the saved 24-hour ladder and resume reminders, then sends rows that
// are still inside Instagram's window. Not attached to the scheduler in this
// change. AI instructions are planned before send and are never sent raw.

import { completeJson, resolveProvider, systemPrompt } from "../roleflow-acquisition/ig/llm.js";
import { API_BASE, interpretSend, outboxWriteStatus, planGatewayReply, replyText, sendRequest } from "../_shared/ig-gateway.js";
import { adminClient, json, loadGatewayConfig } from "../_shared/gateway-http.js";
import { briefKnowledge, chooseModel, officeOpen } from "../_shared/setter-gate.js";
import {
  cycleStamp,
  dueLadderStep,
  followupOutbox,
  maySendPayload,
  plannedPayload,
  remindersToSend,
  sentStepIds
} from "../_shared/followup-plan.js";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST." });
  const admin = adminClient();
  const secret = await admin.rpc("acq_read_cron_secret");
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!secret.data || bearer !== secret.data) return json(401, { ok: false, error: "Unauthorized." });
  const now = Date.now();
  const result = await queueDue(admin, now);
  return json(200, { ok: true, queued: result.queued, sent: result.sent });
});

export async function queueDue(admin, now) {
  const settings = await admin.from("acq_settings").select("agent_id, office_mode, timezone, office_start, office_end, hours_by_day, followup_restart_on_reply, setter_model").eq("system_enabled", true);
  let queued = 0;
  let sent = 0;
  for (const row of settings.data || []) {
    const outcome = await queueBusiness(admin, row, now);
    queued += outcome.queued;
    sent += outcome.sent;
  }
  return { queued, sent };
}

async function queueBusiness(admin, settings, now) {
  const businessId = settings.agent_id;
  if (!officeOpen({
    now,
    timeZone: settings.timezone || "Europe/Madrid",
    mode: settings.office_mode || "always",
    start: settings.office_start,
    end: settings.office_end,
    hoursByDay: settings.hours_by_day || {}
  })) return { queued: 0, sent: 0 };
  const account = await admin.from("ig_gateway_accounts").select("account_id, status").eq("business_id", businessId).eq("status", "connected").maybeSingle();
  if (!account.data || !account.data.account_id) return { queued: 0, sent: 0 };
  const steps = await admin.from("acq_followup_steps").select("id, hours, mode, body, crm_state").eq("business_id", businessId);
  const threads = await admin.from("ig_threads").select("id, state, human_locked, last_user_message_at, igsid, attributes, score").eq("business_id", businessId).eq("human_locked", false).limit(100);
  const contacts = await admin.from("acq_contacts").select("id, external_id, ai_enabled, crm_state").eq("business_id", businessId);
  const conversations = await admin.from("acq_conversations").select("id, contact_id, external_id").eq("business_id", businessId);
  const reminders = await admin.from("acq_reminders").select("id, kind, status, due_at, title, contact_id").eq("business_id", businessId).eq("status", "open").limit(100);
  const contactBySender = new Map((contacts.data || []).map((contact) => [contact.external_id, contact]));
  const conversationByContact = new Map((conversations.data || []).map((conversation) => [conversation.contact_id, conversation]));
  let queued = 0;
  for (const thread of threads.data || []) {
    const contact = contactBySender.get(thread.igsid);
    const conversation = contact ? conversationByContact.get(contact.id) : null;
    if (!conversation || !conversation.external_id) continue;
    const sent = await admin.from("ig_outbox").select("idempotency_key").eq("business_id", businessId).eq("thread_id", thread.id).like("idempotency_key", "followup:%");
    const decision = dueLadderStep({
      steps: steps.data || [],
      lastUserMessageAt: thread.last_user_message_at,
      now,
      sentStepIds: sentStepIds(sent.data || [], { restart: settings.followup_restart_on_reply === true, lastUserMessageAt: thread.last_user_message_at }),
      state: (contact && contact.crm_state) || thread.state,
      humanLocked: thread.human_locked,
      systemEnabled: true,
      aiEnabled: contact ? contact.ai_enabled : true
    });
    const outbox = followupOutbox({
      decision,
      businessId,
      threadId: thread.id,
      accountId: account.data.account_id,
      conversationId: conversation.external_id,
      conversationRowId: conversation.id,
      cycle: settings.followup_restart_on_reply === true ? cycleStamp(thread.last_user_message_at) : ""
    });
    if (!outbox) continue;
    outbox.run_at = new Date(now).toISOString();
    const inserted = await admin.from("ig_outbox").insert(outbox);
    if (!inserted.error) queued += 1;
  }
  const reminderRows = remindersToSend({
    reminders: reminders.data || [],
    contacts: contacts.data || [],
    threads: threads.data || [],
    conversations: conversations.data || [],
    now,
    accountId: account.data.account_id,
    businessId
  });
  for (const reminderRow of reminderRows) {
    reminderRow.run_at = new Date(now).toISOString();
    const saved = await admin.from("ig_outbox").insert(reminderRow);
    if (!saved.error) queued += 1;
    if (!saved.error || duplicateKey(saved.error)) {
      await admin.from("acq_reminders").update({ status: "done" }).eq("id", reminderRow.payload.reminderId).eq("business_id", businessId);
    }
  }
  const config = await loadGatewayConfig(admin);
  const sent = await drainQueued(admin, config.apiKey, businessId, now, settings);
  return { queued, sent };
}

async function drainQueued(admin, apiKey, businessId, now, settings) {
  if (!apiKey) return 0;
  const pending = await admin.from("ig_outbox").select("id, business_id, thread_id, kind, payload, attempts, status, idempotency_key").eq("business_id", businessId).eq("transport", "official").eq("kind", "recovery").eq("status", "pending").lte("run_at", new Date(now).toISOString()).order("run_at", { ascending: true }).limit(5);
  let sent = 0;
  for (const row of pending.data || []) {
    const key = String(row.idempotency_key || "");
    if (!key.startsWith("followup:") && !key.startsWith("reminder:")) continue;
    const threadRes = await admin.from("ig_threads").select("state, human_locked, attributes, score, last_user_message_at").eq("id", row.thread_id).eq("business_id", businessId).maybeSingle();
    const thread = threadRes.data;
    if (!thread) continue;
    let payload = row.payload || {};
    if (payload.needsPlan === true) {
      const prepared = await prepareFollowup(admin, businessId, payload, thread, now, settings);
      if (prepared === "leave") continue;
      if (prepared === "failed") {
        await admin.from("ig_outbox").update({ status: "failed", last_error: "The reply was not prepared." }).eq("id", row.id).eq("status", "pending");
        continue;
      }
      if (!prepared) {
        await admin.from("ig_outbox").update({ status: "done", last_error: null }).eq("id", row.id).eq("status", "pending");
        continue;
      }
      payload = prepared;
      await admin.from("ig_outbox").update({ payload }).eq("id", row.id).eq("status", "pending");
    }
    const decision = maySendPayload({
      payload,
      lastUserMessageAt: thread.last_user_message_at,
      now,
      humanLocked: thread.human_locked === true,
      systemEnabled: true
    });
    if (!decision.send) {
      if (decision.reason === "outside_24h" || decision.reason === "no_user_message" || decision.reason === "clock_skew" || decision.reason === "human_locked") {
        const reason = decision.reason === "human_locked" ? "A person has this chat." : "Outside the 24-hour window.";
        await admin.from("ig_outbox").update({ status: "blocked", last_error: reason }).eq("id", row.id).eq("status", "pending");
      }
      continue;
    }
    if (await sendOne(admin, apiKey, { ...row, payload })) sent += 1;
  }
  return sent;
}

async function prepareFollowup(admin, businessId, payload, thread, now, settings) {
  const env = modelEnv(settings, thread, payload.instruction || "");
  if (!resolveProvider(env)) return "leave";
  let plan;
  try {
    const sections = await promptSections(admin, businessId, "conversation_recovery");
    const knowledge = await businessKnowledge(admin, businessId);
    plan = await planGatewayReply({
      thread: {
        state: thread.state || "qualification",
        human_locked: thread.human_locked === true,
        attributes: thread.attributes || {},
        score: thread.score || null,
        lastUserMessageAt: thread.last_user_message_at || new Date(now).toISOString()
      },
      eventKind: "message",
      text: String(payload.instruction || ""),
      now,
      llm: () => completeJson({
        env,
        system: systemPrompt(sections) + knowledge + "\n\nFollow-up instruction\n" + String(payload.instruction || ""),
        messages: [{ role: "user", content: JSON.stringify({ followup: true, instruction: payload.instruction || "", state: thread.state || "", attributes: thread.attributes || {} }) }]
      })
    });
  } catch (error) {
    const unconfigured = Boolean(error && typeof error === "object" && "code" in error && error.code === "llm_unconfigured");
    return unconfigured ? "leave" : "failed";
  }
  return plannedPayload(payload, replyText(plan));
}

function modelEnv(settings, thread, instruction) {
  return {
    LLM_PROVIDER: Deno.env.get("LLM_PROVIDER") || "",
    XAI_API_KEY: Deno.env.get("XAI_API_KEY") || "",
    XAI_MODEL: chooseModel({ preferred: settings.setter_model, text: instruction, state: thread.state }),
    OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY") || "",
    OPENAI_MODEL: Deno.env.get("OPENAI_MODEL") || "",
    GEMINI_API_KEY: Deno.env.get("GEMINI_API_KEY") || "",
    GOOGLE_API_KEY: Deno.env.get("GOOGLE_API_KEY") || "",
    GEMINI_MODEL: Deno.env.get("GEMINI_MODEL") || ""
  };
}

async function promptSections(admin, businessId, role) {
  const current = await admin.from("acq_prompt_current").select("version_id").eq("business_id", businessId).eq("role", role).maybeSingle();
  if (!current.data) return {};
  const version = await admin.from("acq_prompt_versions").select("sections").eq("id", current.data.version_id).eq("business_id", businessId).maybeSingle();
  const sections = version.data && version.data.sections;
  return sections && typeof sections === "object" ? sections : {};
}

async function businessKnowledge(admin, businessId) {
  const settings = await admin.from("acq_settings").select("offer_summary, icp_notes, knowledge_base").eq("agent_id", businessId).maybeSingle();
  const brief = await admin.from("acq_business_briefs").select("fields").eq("business_id", businessId).maybeSingle();
  const stored = settings.data
    ? "\n\nBusiness knowledge\nOffer: " + (settings.data.offer_summary || "") + "\nICP: " + (settings.data.icp_notes || "") + "\nNotes: " + (settings.data.knowledge_base || "")
    : "";
  return stored + briefKnowledge(brief.data && brief.data.fields);
}

async function sendOne(admin, apiKey, row) {
  const locked = await admin.from("ig_outbox").update({ status: "running", attempts: (row.attempts || 0) + 1 }).eq("id", row.id).eq("status", "pending").select("id");
  if (!locked.data || !locked.data.length) return false;
  const request = sendRequest(row);
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
  if (!result.ok) return false;
  const text = String(row.payload.text || "").slice(0, 4000);
  const conversationId = row.payload.conversationRowId;
  if (conversationId) {
    await admin.from("acq_messages").insert({
      business_id: row.business_id,
      conversation_id: conversationId,
      external_id: "out:" + row.id,
      role: "assistant",
      body: text,
      sent_at: new Date().toISOString()
    });
  }
  if (row.thread_id) {
    await admin.from("ig_messages").insert({
      business_id: row.business_id,
      thread_id: row.thread_id,
      direction: "out",
      body: text,
      kind: "text"
    });
  }
  return true;
}

function duplicateKey(error) {
  const code = String((error && error.code) || "");
  const message = String((error && error.message) || "");
  return code === "23505" || /duplicate key|idempotency_key/i.test(message);
}
