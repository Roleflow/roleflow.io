// Signed-in dashboard API. verify_jwt is true.
// Saves the setter prompt, the try-panel result, agent switches, follow-up
// rules, and the language preference. A tryout never sends an Instagram message.
//
// Secrets this function reads (Supabase function secrets, never the browser):
//   LLM_PROVIDER          optional: xai, openai, or gemini
//   XAI_API_KEY           model key when the provider is xAI
//   XAI_MODEL             optional model name
//   OPENAI_API_KEY        model key when the provider is OpenAI
//   OPENAI_MODEL          optional model name
//   GEMINI_API_KEY        model key when the provider is Gemini
//   GOOGLE_API_KEY        accepted in place of GEMINI_API_KEY
//   GEMINI_MODEL          optional model name
//   ANTHROPIC_API_KEY     platform Claude key for setter replies. If it is missing,
//                         the setter keeps its current model and the fallback is logged.
// SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are injected.
// If no model key is set, the practice thread returns an error and does not invent a reply.
// transcribe_trial turns a practice voice note into text with the same speech-to-text
// path as an inbound voice note. It does not store the audio, write a lead, or send
// a message. The speech key stays in this function.
//
// Access per action (see _shared/team-access.js): testers reach only load
// (prompt only), preview_setter, and transcribe_trial; a "Tester + prompt
// edits" member can also save or restore the prompt; team_* actions are for
// the business owner or an admin. Everything else needs full edit access.
// team_invite emails through Resend when RESEND_API_KEY is set (RESEND_FROM
// optional); otherwise it returns the invite link for the owner to share.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { normalizePolicy, setterMayEnable } from "../_shared/agent-control.js";
import { PROVIDERS, SETTER_MAX_TOKENS, clientReplyView, completeChat, healthView, loadSetterReply, logLlmError, probeClaude, redactSecret } from "../_shared/llm-provider.js";
import { buildInstruction as winningInstruction, draftBrief } from "../_shared/winning-conversations.js";
import { advanceStatus, buildInstruction as intakeInstruction, hashToken, intakeBundle, normalizeDraft, playbookFromSources, textFromDocxXml, textFromUpload } from "../_shared/onboarding-build.js";
import { clientSafeText } from "../_shared/client-safe.js";
import { dropIncompleteTail, trimToSentence } from "../_shared/split-reply.js";
import { VOICE_MAX_CHARS, transcribeTrialVoice, trialVoiceError, voiceRule } from "../_shared/voice-transcribe.js";
import { adminClient, json, userClientFrom } from "../_shared/gateway-http.js";
import { accessView, dedupeInvites, denyMessage, inviteEmail, inviteToken, legacyAccess, mayRemoveMember, mayRun, normalizeAccess, normalizeInvite, reusableInvite, roleLabel, testerLoadView } from "../_shared/team-access.js";
import { PROMPT_MAX } from "../_shared/prompt-history.js";
import { normalizeCap } from "../_shared/comment-voice.js";
import { commentSlotGuide, whenToSendFromRules } from "../_shared/comment-slot.js";
import {
  bookingLinkFor,
  businessBookingLink,
  staleBookingLinks,
  expandPrompt,
  normalizeBookingLink,
  promptVersionLabel,
  resolveOutgoing,
  unwrapModelText,
  tokenGuide,
  trialScenario,
  voiceCatalog,
  voiceToken
} from "../_shared/prompt-tokens.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = new Set(["warmer", "outreacher", "setter", "followup", "comment_voice"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST." });
  const userClient = userClientFrom(req);
  const user = await userClient.auth.getUser();
  if (user.error || !user.data.user) return json(401, { ok: false, error: "Sign in required." });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_error) { body = {}; }
  const action = String(body.action || "load");
  const admin = adminClient();
  if (action === "save_language") return saveLanguage(admin, user.data.user.id, body.language);
  const businessId = String(body.business_id || "");
  if (!UUID.test(businessId)) return json(400, { ok: false, error: "Pick a business first." });
  const access = await accessFor(userClient, businessId);
  if (!mayRun(access, action)) return json(403, { ok: false, error: denyMessage(access, action) });
  if (action === "load") return access.tester ? testerLoad(admin, businessId, user.data.user.id, access) : load(admin, businessId, user.data.user.id, access);
  if (action === "team_list") return teamList(admin, businessId);
  if (action === "team_invite") return teamInvite(admin, businessId, user.data.user.id, body);
  if (action === "team_remove") return teamRemove(admin, businessId, body);
  if (action === "save_prompt") return savePrompt(admin, businessId, user.data.user.id, body.prompt, body.voice);
  if (action === "restore_prompt") return restorePrompt(admin, businessId, user.data.user.id, body.version_id);
  if (action === "preview_setter") return previewSetter(admin, businessId, user.data.user.id, body, access);
  if (action === "transcribe_trial") return transcribeTrial(body);
  if (action === "claude_health") return claudeHealth();
  if (action === "build_setter_prompt") return buildSetterPrompt(admin, businessId);
  if (action === "create_onboarding_link") return createOnboardingLink(admin, businessId, user.data.user.id);
  if (action === "revoke_onboarding_link") return revokeOnboardingLink(admin, businessId, body.link_id);
  if (action === "build_onboarding") return buildOnboarding(admin, businessId, user.data.user.id);
  if (action === "upload_onboarding") return uploadOnboarding(admin, businessId, body);
  if (action === "save_booking_link") return saveBookingLink(admin, businessId, body.booking_link);
  if (action === "save_comment_voice") return saveCommentVoice(admin, businessId, body);
  if (action === "set_agent") return setAgent(admin, businessId, user.data.user.id, body);
  if (action === "save_policy") return savePolicy(admin, businessId, body.policy);
  return json(400, { ok: false, error: "Unknown action." });
});

// One RPC answers what this person may do on this business. Before the
// business_testers migration is applied it does not exist, so fall back to the
// old acq_can_edit check and behave exactly as before.
async function accessFor(userClient, businessId) {
  const summary = await userClient.rpc("acq_access", { p_workspace: businessId });
  if (!summary.error && summary.data && typeof summary.data === "object") return normalizeAccess(summary.data);
  const allowed = await userClient.rpc("acq_can_edit", { p_workspace: businessId });
  return legacyAccess(!allowed.error && allowed.data === true);
}

async function testerLoad(admin, businessId, userId, access) {
  const [prompt, prefs] = await Promise.all([
    admin.from("acq_agent_prompts").select("body, tested_at").eq("business_id", businessId).maybeSingle(),
    admin.from("acq_user_prefs").select("language").eq("user_id", userId).maybeSingle()
  ]);
  if (prompt.error) return json(200, { ok: false, error: "The setter prompt could not be loaded." });
  return json(200, testerLoadView(prompt.data && prompt.data.body, prompt.data && prompt.data.tested_at, prefs.data && prefs.data.language, access));
}

async function load(admin, businessId, userId, access) {
  const [switches, prompt, policy, prefs] = await Promise.all([
    admin.from("acq_agent_switches").select("agent_key, enabled").eq("business_id", businessId),
    admin.from("acq_agent_prompts").select("body, tested_at").eq("business_id", businessId).maybeSingle(),
    admin.from("acq_followup_policy").select("*").eq("business_id", businessId).maybeSingle(),
    admin.from("acq_user_prefs").select("language").eq("user_id", userId).maybeSingle()
  ]);
  if (switches.error || prompt.error || policy.error) return json(200, { ok: false, error: "Apply the client dashboard migration, then refresh." });
  return json(200, {
    ok: true,
    switches: switches.data || [],
    prompt: prompt.data ? prompt.data.body || "" : "",
    tested_at: prompt.data ? prompt.data.tested_at : null,
    policy: normalizePolicy(policy.data || {}),
    language: prefs.data && prefs.data.language === "es" ? "es" : "en",
    access: accessView(access)
  });
}

async function savePrompt(admin, businessId, userId, prompt, voice) {
  const written = await writePrompt(admin, businessId, userId, prompt, { tested: false, voice });
  if (written.error) return json(200, { ok: false, error: "The prompt was not saved. Apply the client dashboard migration first." });
  return json(200, { ok: true, prompt: written.prompt, tested_at: written.tested_at, version: written.version, sent: false });
}

async function restorePrompt(admin, businessId, userId, versionId) {
  if (!UUID.test(String(versionId || ""))) return json(200, { ok: false, error: "That version is not on this business." });
  let row = await admin.from("acq_agent_prompt_versions").select("body, setter_voice").eq("id", versionId).eq("business_id", businessId).maybeSingle();
  if (row.error) row = await admin.from("acq_agent_prompt_versions").select("body").eq("id", versionId).eq("business_id", businessId).maybeSingle();
  if (row.error || !row.data) return json(200, { ok: false, error: "That version is not on this business." });
  const written = await writePrompt(admin, businessId, userId, row.data.body, { tested: false, voice: row.data.setter_voice });
  if (written.error) return json(200, { ok: false, error: "The prompt was not restored." });
  return json(200, { ok: true, prompt: written.prompt, tested_at: written.tested_at, version: written.version, voice: row.data.setter_voice, sent: false });
}

async function writePrompt(admin, businessId, userId, prompt, options) {
  const body = String(prompt || "").trim().slice(0, PROMPT_MAX);
  const current = await admin.from("acq_agent_prompts").select("body, tested_at").eq("business_id", businessId).maybeSingle();
  if (current.error) return { error: current.error };
  const previous = current.data ? String(current.data.body || "") : "";
  const changed = previous !== body;
  const markTested = Boolean(options && options.tested);
  if (!changed && !markTested) {
    return { prompt: previous, tested_at: current.data ? current.data.tested_at : null, version: null };
  }
  let version = null;
  if (changed) {
    const latest = await admin.from("acq_agent_prompt_versions").select("version").eq("business_id", businessId).order("version", { ascending: false }).limit(1);
    if (latest.error) return { error: latest.error };
    const number = ((latest.data && latest.data[0] && latest.data[0].version) || 0) + 1;
    const voice = options && options.voice != null && options.voice !== "" ? Math.max(0, Math.min(100, Math.round(Number(options.voice)))) : null;
    const payload = {
      business_id: businessId,
      version: number,
      body,
      created_by: userId
    };
    if (voice != null && Number.isFinite(voice)) payload.setter_voice = voice;
    let inserted = await admin.from("acq_agent_prompt_versions").insert(payload).select("id, version, body, created_at, created_by, setter_voice").single();
    if (inserted.error && payload.setter_voice != null) {
      delete payload.setter_voice;
      inserted = await admin.from("acq_agent_prompt_versions").insert(payload).select("id, version, body, created_at, created_by").single();
    }
    if (inserted.error) return { error: inserted.error };
    version = inserted.data;
  }
  const testedAt = markTested ? new Date().toISOString() : null;
  const saved = await admin.from("acq_agent_prompts").upsert({
    business_id: businessId,
    agent_key: "setter",
    body,
    tested_at: testedAt,
    updated_at: new Date().toISOString(),
    updated_by: userId
  });
  if (saved.error) return { error: saved.error };
  return { prompt: body, tested_at: testedAt, version };
}

async function previewSetter(admin, businessId, userId, body, access) {
  const prompt = String(body.prompt || "").trim().slice(0, PROMPT_MAX);
  const message = String(body.message || "").trim().slice(0, body.voice_note === true ? VOICE_MAX_CHARS : 500);
  const followup = Math.max(0, Math.min(12, Number(body.followup) || 0));
  if (!prompt) return json(200, { ok: false, error: "Save a system prompt first." });
  if (!message && !followup) return json(200, { ok: false, error: "Write a message to try." });
  const scenario = trialScenario(body.scenario);
  const settings = await admin.from("acq_settings").select("booking_fallback_url").eq("agent_id", businessId).maybeSingle();
  // The booking link written in the prompt being tried is the one sent.
  const settingsLink = (settings.data && settings.data.booking_fallback_url) || "";
  const bookingLink = businessBookingLink({ prompt, settingsLink });
  const staleLinks = staleBookingLinks(bookingLink, [settingsLink]);
  const voiceRows = await admin.from("acq_voice_library").select("id, title, slot, storage_path, mime_type, active").eq("agent_id", businessId).eq("active", true);
  const catalog = voiceCatalog(voiceRows.error ? [] : voiceRows.data || []);
  const history = Array.isArray(body.messages) ? body.messages : [];
  const messages = history.map((item) => ({
    role: item && item.role === "assistant" ? "assistant" : "user",
    content: String(item && (item.content || item.text) || "").trim().slice(0, 8000)
  })).filter((item) => item.content);
  if (followup && !message) {
    messages.push({ role: "user", content: "Simulate follow-up " + followup + ". The lead has not replied. Write only the next follow-up. This is practice and it sends nothing." });
  } else {
    messages.push({ role: "user", content: message });
  }
  const commentWhen = await commentWhenFor(admin, businessId, body);
  const commentNote = catalog.find((note) => note.slot === "comment");
  const commentGuide = commentSlotGuide({
    when: commentWhen,
    token: commentNote ? voiceToken(commentNote.slug) : "",
    title: commentNote ? commentNote.title : "Comment"
  });
  const env = Deno.env.toObject();
  const loaded = await loadSetterReply(admin, businessId, env);
  const runtime = loaded.chain[0];
  if (!runtime || !runtime.apiKey) return json(200, clientReplyView({ ok: false, error: "No model key is configured.", sent: false }));
  let notice = "";
  let result;
  try {
    result = await completeChat({
      chain: loaded.chain,
      voice: body.voice == null || body.voice === "" ? loaded.voice : body.voice,
      onError: async (info) => {
        const authNotice = info.auth && info.source === "own";
        await logLlmError(admin, {
          businessId,
          purpose: "setter",
          ...info,
          message: authNotice ? "This business's Claude API key was rejected. Fell back to the next model." : info.message
        });
        if (authNotice) notice = "This business's Claude API key was rejected. The setter used the next model.";
      },
      system: [
        expandPrompt(prompt, bookingLink),
        tokenGuide(catalog, bookingLink),
        commentGuide,
        scenario.context,
        "Lead state: " + String(body.lead_state || "open") + ".",
        body.voice_note === true ? voiceRule({ transcribed: true, language: String(body.voice_language || "") }) : "",
        "Reply as the setter. Follow the system prompt for length and style. You may include a voice token and the booking token when that prompt calls for them. Do not call tools. This is a practice thread and it sends nothing."
      ].filter(Boolean).join("\n\n"),
      messages,
      maxTokens: SETTER_MAX_TOKENS
    });
  } catch (error) {
    return json(200, clientReplyView({ ok: false, error: practiceError(error, loaded.chain.map((step) => step.apiKey)), sent: false }, loaded.chain.map((step) => step.apiKey)));
  }
  const text = unwrapModelText(result && result.text).trim();
  if (!text) return json(200, { ok: false, error: "The model returned an empty reply.", sent: false });
  const resolved = resolveOutgoing(text, { voices: catalog, bookingLink, staleLinks });
  const reply = trimToSentence(dropIncompleteTail(clientSafeText(resolved.text)), 8000);
  if (!reply) return json(200, { ok: false, error: "The model response was cut off.", sent: false });
  const providerId = String(result.provider || runtime.provider || "");
  const spec = PROVIDERS[providerId];
  const versions = await admin.from("acq_agent_prompt_versions").select("id, version, body, created_at, created_by").eq("business_id", businessId).order("version", { ascending: false }).limit(30);
  const version = promptVersionLabel(versions.error ? [] : versions.data || [], prompt);
  const current = await admin.from("acq_agent_prompts").select("body, tested_at").eq("business_id", businessId).maybeSingle();
  const savedBody = current.data ? String(current.data.body || "") : "";
  let testedAt = current.data ? current.data.tested_at : null;
  if (savedBody === prompt && access && access.canEditPrompt) {
    testedAt = new Date().toISOString();
    await admin.from("acq_agent_prompts").upsert({
      business_id: businessId,
      agent_key: "setter",
      body: prompt,
      tested_at: testedAt,
      updated_at: testedAt,
      updated_by: userId
    });
  }
  return json(200, clientReplyView({
    ok: true,
    reply,
    provider: providerId,
    provider_label: spec ? spec.label : providerId,
    model: String(result.model || runtime.model || ""),
    key_source: result.keySource === "business" ? "business" : "platform",
    voice: result.voice,
    tested_at: testedAt,
    sent: false,
    notice,
    fell_back: result.fellBack === true,
    usage: result.usage || undefined,
    booking_link: bookingLink,
    voices: resolved.voices.map((note) => ({ id: note.id, title: note.title, slug: note.slug, path: note.path, mime: note.mime })),
    version,
    prompt
  }, loaded.chain.map((step) => step.apiKey)));
}

async function commentWhenFor(admin, businessId, body) {
  if (body && Object.prototype.hasOwnProperty.call(body, "comment_when")) {
    return String(body.comment_when || "").trim().slice(0, 1000);
  }
  const slot = await admin.from("acq_comment_slots").select("when_to_send").eq("business_id", businessId).maybeSingle();
  const saved = slot.data ? String(slot.data.when_to_send || "").trim() : "";
  if (saved) return saved.slice(0, 1000);
  const rules = await admin.from("acq_comment_voice_rules").select("keywords, intent").eq("business_id", businessId);
  return whenToSendFromRules(rules.error ? [] : rules.data || []);
}

function practiceError(error, secrets) {
  let cleaned = String(error && error.message || "");
  (Array.isArray(secrets) ? secrets : [secrets]).forEach((secret) => {
    cleaned = redactSecret(cleaned, secret);
  });
  cleaned = clientSafeText(cleaned).replace(/\s+/g, " ").trim();
  return cleaned || "The model did not answer.";
}

async function saveBookingLink(admin, businessId, value) {
  const link = normalizeBookingLink(value);
  if (link == null) return json(200, { ok: false, error: "Use a full https booking link." });
  const saved = await admin.from("acq_settings").upsert({ agent_id: businessId, booking_fallback_url: link });
  if (saved.error) return json(200, { ok: false, error: "The booking link was not saved." });
  return json(200, { ok: true, booking_link: bookingLinkFor(link), sent: false });
}

async function transcribeTrial(body) {
  const env = {
    XAI_API_KEY: Deno.env.get("XAI_API_KEY") || "",
    OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY") || ""
  };
  const heard = await transcribeTrialVoice({
    base64: typeof body.audio === "string" ? body.audio : "",
    mime: typeof body.mime === "string" ? body.mime : ""
  }, env, { retryMs: 400 });
  if (!heard.ok) {
    return json(200, {
      ok: false,
      reason: heard.reason || "transcribe",
      error: clientSafeText(trialVoiceError(heard.reason)),
      sent: false
    });
  }
  return json(200, {
    ok: true,
    transcript: heard.text,
    language: heard.language || "",
    duration: heard.duration || 0,
    sent: false
  });
}

async function saveCommentVoice(admin, businessId, body) {
  const cap = normalizeCap(body.daily_cap);
  const settings = await admin.from("acq_comment_voice_settings").upsert({
    business_id: businessId,
    daily_cap: cap,
    updated_at: new Date().toISOString()
  });
  if (settings.error) return json(200, { ok: false, error: "Comment voice is not ready. Apply the migration first." });
  const cleared = await admin.from("acq_comment_voice_rules").delete().eq("business_id", businessId);
  if (cleared.error) return json(200, { ok: false, error: "The rules were not saved." });
  const incoming = Array.isArray(body.rules) ? body.rules.slice(0, 30) : [];
  const rows = incoming.map((rule, index) => {
    const keywords = (Array.isArray(rule.keywords) ? rule.keywords : String(rule.keywords || "").split(/[,;\n]/))
      .map((item) => String(item || "").trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 20);
    const intent = String(rule.intent || "").trim().slice(0, 1000);
    if (!keywords.length && !intent) return null;
    const clip = String(rule.clip_id || rule.clipId || "");
    return {
      business_id: businessId,
      keywords,
      intent,
      message: String(rule.message || "").trim().slice(0, 500),
      clip_id: UUID.test(clip) ? clip : null,
      position: index
    };
  }).filter(Boolean);
  if (rows.length) {
    const inserted = await admin.from("acq_comment_voice_rules").insert(rows).select("id, keywords, intent, message, clip_id, position");
    if (inserted.error) return json(200, { ok: false, error: "The rules were not saved." });
    return json(200, { ok: true, daily_cap: cap, rules: inserted.data || [], sent: false });
  }
  return json(200, { ok: true, daily_cap: cap, rules: [], sent: false });
}

async function setAgent(admin, businessId, userId, body) {
  const key = String(body.agent_key || "");
  if (!KEYS.has(key)) return json(400, { ok: false, error: "Unknown agent." });
  const enabled = body.enabled === true;
  if (enabled && (key === "warmer" || key === "outreacher")) {
    return json(200, { ok: false, error: "Coming soon. This agent cannot be turned on." });
  }
  if (enabled && key === "setter") {
    const prompt = await admin.from("acq_agent_prompts").select("body, tested_at").eq("business_id", businessId).maybeSingle();
    const gate = setterMayEnable({
      prompt: prompt.data && prompt.data.body,
      testedAt: prompt.data && prompt.data.tested_at
    });
    if (!gate.ok) return json(200, gate);
  }
  const saved = await admin.from("acq_agent_switches").upsert({
    business_id: businessId,
    agent_key: key,
    enabled,
    updated_at: new Date().toISOString(),
    updated_by: userId
  });
  if (saved.error) return json(200, { ok: false, error: "The switch was not saved. Apply the client dashboard migration first." });
  return json(200, { ok: true, agent_key: key, enabled });
}

async function savePolicy(admin, businessId, raw) {
  const policy = normalizePolicy(raw);
  const saved = await admin.from("acq_followup_policy").upsert({
    business_id: businessId,
    hours_since_last_message: policy.hoursSinceLastMessage,
    lead_stage: policy.leadStage,
    no_reply_after: policy.noReplyAfter,
    max_followups: policy.maxFollowups,
    booked: policy.booked,
    quiet_start: policy.quietStart,
    quiet_end: policy.quietEnd,
    updated_at: new Date().toISOString()
  });
  if (saved.error) return json(200, { ok: false, error: "The triggers were not saved. Apply the client dashboard migration first." });
  return json(200, { ok: true, policy });
}

async function saveLanguage(admin, userId, language) {
  const next = language === "es" ? "es" : "en";
  const saved = await admin.from("acq_user_prefs").upsert({
    user_id: userId,
    language: next,
    updated_at: new Date().toISOString()
  });
  if (saved.error) return json(200, { ok: false, error: "The language was not saved. Apply the client dashboard migration first." });
  return json(200, { ok: true, language: next });
}

async function fileText(name, bytes) {
  if (String(name || "").toLowerCase().endsWith(".docx")) {
    try {
      const { unzipSync, strFromU8 } = await import("npm:fflate@0.8.2");
      const files = unzipSync(bytes);
      const xml = files["word/document.xml"];
      return xml ? textFromDocxXml(strFromU8(xml)) : "";
    } catch (_error) {
      return "";
    }
  }
  const found = textFromUpload(name, bytes);
  return found.note === "screenshot" ? "" : found.text;
}

async function uploadOnboarding(admin, businessId, body) {
  const name = String(body.name || "notes.txt").slice(0, 180);
  if (/\.(png|jpe?g|webp|gif)$/i.test(name)) return json(200, { ok: false, error: "Paste the conversation. Screenshots are not read.", sent: false });
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(String(body.data || "")), (char) => char.charCodeAt(0)); }
  catch (_error) { return json(200, { ok: false, error: "That file could not be read.", sent: false }); }
  if (!bytes.length || bytes.length > 1500000) return json(200, { ok: false, error: "Use a file under 1.5 MB, or paste the text.", sent: false });
  const text = await fileText(name, bytes);
  if (!text) return json(200, { ok: false, error: "No text could be read from that file. Paste it instead.", sent: false });
  const path = businessId + "/" + crypto.randomUUID() + "/" + name.replace(/[^\w.\- ]+/g, "").slice(0, 80);
  await admin.storage.from("onboarding-materials").upload(path, bytes, { contentType: "application/octet-stream", upsert: false });
  const inserted = await admin.from("acq_onboarding_materials").insert({
    business_id: businessId, kind: "file", name, body: text.slice(0, 80000), storage_path: path
  }).select("id, name, kind").single();
  if (inserted.error) return json(200, { ok: false, error: "The file was not saved.", sent: false });
  const current = await admin.from("acq_onboarding").select("status").eq("business_id", businessId).maybeSingle();
  await admin.from("acq_onboarding").upsert({
    business_id: businessId,
    status: advanceStatus(current.data && current.data.status, "materials"),
    updated_at: new Date().toISOString()
  });
  return json(200, { ok: true, sent: false, material: inserted.data });
}

async function createOnboardingLink(admin, businessId, userId) {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const tokenHash = await hashToken(token);
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const inserted = await admin.from("acq_onboarding_links").insert({
    business_id: businessId,
    token_hash: tokenHash,
    expires_at: expires
  }).select("id, expires_at").single();
  if (inserted.error) return json(200, { ok: false, error: "The client link was not created. Apply the onboarding migration first.", sent: false });
  void userId;
  return json(200, {
    ok: true,
    sent: false,
    link_id: inserted.data.id,
    expires_at: inserted.data.expires_at,
    token,
    path: "/account/onboarding/?token=" + encodeURIComponent(token)
  });
}

async function revokeOnboardingLink(admin, businessId, linkId) {
  const id = String(linkId || "");
  if (!UUID.test(id)) return json(200, { ok: false, error: "That link is not on this business.", sent: false });
  const revoked = await admin.from("acq_onboarding_links").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("business_id", businessId);
  if (revoked.error) return json(200, { ok: false, error: "The link was not revoked.", sent: false });
  return json(200, { ok: true, sent: false });
}

async function buildOnboarding(admin, businessId, userId) {
  const [form, materials, wins] = await Promise.all([
    admin.from("acq_onboarding").select("offer, price, ideal, booking_link, criteria, disqualifiers, status").eq("business_id", businessId).maybeSingle(),
    admin.from("acq_onboarding_materials").select("name, body").eq("business_id", businessId).order("created_at", { ascending: false }).limit(20),
    admin.from("acq_winning_conversations").select("raw_text, messages, outcome, notes").eq("business_id", businessId).order("created_at", { ascending: false }).limit(20)
  ]);
  if (form.error || materials.error) return json(200, { ok: false, error: "Onboarding is not ready. Apply the migration first.", sent: false, draft: true });
  const bundle = intakeBundle({
    form: form.data || {},
    materials: (materials.data || []).map((item) => ({ text: item.body, name: item.name })),
    conversations: wins.error ? [] : wins.data || []
  });
  if (!bundle.materials && !bundle.conversations && !String((form.data && form.data.offer) || "").trim()) {
    return json(200, { ok: false, error: "Add an SOP or a conversation before building the setter.", sent: false, draft: true });
  }
  const env = Deno.env.toObject();
  const loaded = await loadSetterReply(admin, businessId, env);
  const runtime = loaded.chain[0];
  if (!runtime || !runtime.apiKey) return json(200, clientReplyView({ ok: false, error: "No model key is configured.", sent: false, draft: true }));
  let parsed = null;
  let result = null;
  try {
    result = await completeChat({
      chain: loaded.chain,
      voice: loaded.voice,
      maxTokens: 4000,
      json: true,
      onError: (info) => logLlmError(admin, { businessId, purpose: "prompt", ...info }),
      system: "You extract a setter playbook and draft a prompt. Return JSON only with fields, sources, playbook, and prompt. Do not invent facts. If a section is not in the sources, leave it empty. Do not save it and do not turn the setter on.",
      messages: [{ role: "user", content: intakeInstruction(bundle) }]
    });
    parsed = parseDraft(result && result.text);
  } catch (error) {
    return json(200, clientReplyView({
      ok: false,
      error: practiceError(error, loaded.chain.map((step) => step.apiKey)),
      sent: false,
      draft: true
    }, loaded.chain.map((step) => step.apiKey)));
  }
  const draft = normalizeDraft(parsed, bundle);
  const playbook = playbookFromSources(bundle, parsed && parsed.playbook);
  draft.playbook = playbook.sections;
  draft.checklist = playbook.missing;
  draft.prompt = playbook.prompt;
  const status = advanceStatus(form.data && form.data.status, "drafted");
  await admin.from("acq_onboarding").upsert({
    business_id: businessId,
    offer: form.data ? form.data.offer || "" : "",
    price: form.data ? form.data.price || "" : "",
    ideal: form.data ? form.data.ideal || "" : "",
    booking_link: form.data ? form.data.booking_link || "" : "",
    criteria: form.data ? form.data.criteria || "" : "",
    disqualifiers: form.data ? form.data.disqualifiers || "" : "",
    status,
    sources: draft.sources,
    draft,
    updated_at: new Date().toISOString(),
    updated_by: userId
  });
  const providerId = String(result && result.provider || "");
  const spec = PROVIDERS[providerId];
  const secrets = loaded.chain.map((step) => step.apiKey);
  return json(200, clientReplyView({
    ok: true,
    draft: true,
    sent: false,
    reply: draft.prompt,
    provider: providerId,
    provider_label: spec ? spec.label : providerId,
    model: String(result && result.model || ""),
    notice: playbook.missing.length ? "needs input" : "",
    prompt: JSON.stringify({ fields: draft.fields, sources: draft.sources, missing: playbook.missing, playbook: playbook.sections })
  }, secrets));
}

function parseDraft(text) {
  const trimmed = String(text || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(trimmed); } catch (_error) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch (_again) { return null; }
  }
}

async function claudeHealth() {
  const report = await probeClaude({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") || "", fetchImpl: fetch });
  return json(200, healthView(report));
}

async function buildSetterPrompt(admin, businessId) {
  const [wins, brief, current] = await Promise.all([
    admin.from("acq_winning_conversations").select("raw_text, messages, outcome, notes").eq("business_id", businessId).order("created_at", { ascending: false }).limit(20),
    admin.from("acq_business_briefs").select("fields").eq("business_id", businessId).maybeSingle(),
    admin.from("acq_agent_prompts").select("body").eq("business_id", businessId).maybeSingle()
  ]);
  if (wins.error) return json(200, { ok: false, error: "Winning conversations are not ready. Apply the migration first.", sent: false });
  const conversations = wins.data || [];
  if (!conversations.length) return json(200, { ok: false, error: "Paste a winning conversation first.", sent: false });
  const env = Deno.env.toObject();
  const loaded = await loadSetterReply(admin, businessId, env);
  const runtime = loaded.chain[0];
  if (!runtime || !runtime.apiKey) return json(200, clientReplyView({ ok: false, error: "No model key is configured.", sent: false, draft: true }));
  const instruction = winningInstruction({
    brief: draftBrief(brief.data && brief.data.fields),
    currentPrompt: current.data ? current.data.body : "",
    conversations
  });
  let result;
  try {
    result = await completeChat({
      chain: loaded.chain,
      voice: loaded.voice,
      maxTokens: 4000,
      onError: async (info) => {
        const authNotice = info.auth && info.source === "own";
        await logLlmError(admin, {
          businessId,
          purpose: "prompt",
          ...info,
          message: authNotice ? "This business's Claude API key was rejected. Fell back to the next model." : info.message
        });
      },
      system: "You draft a setter system prompt. Return only the prompt. Do not save it and do not turn the setter on.",
      messages: [{ role: "user", content: instruction }]
    });
  } catch (error) {
    return json(200, clientReplyView({
      ok: false,
      error: practiceError(error, loaded.chain.map((step) => step.apiKey)),
      sent: false,
      draft: true
    }, loaded.chain.map((step) => step.apiKey)));
  }
  const text = String(result && result.text || "").trim().replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();
  if (!text) return json(200, { ok: false, error: "The model returned an empty prompt.", sent: false, draft: true });
  const providerId = String(result.provider || "");
  const spec = PROVIDERS[providerId];
  return json(200, clientReplyView({
    ok: true,
    reply: text.slice(0, 80000),
    draft: true,
    sent: false,
    provider: providerId,
    provider_label: spec ? spec.label : providerId,
    model: String(result.model || ""),
    key_source: result.keySource === "business" ? "business" : "platform"
  }, loaded.chain.map((step) => step.apiKey)));
}


// Team access. Only the business owner or an admin reaches these (mayRun).
// Invites are app-level codes on acq_invites, never Supabase sessions or
// sign-in links. The person signs up or logs in through the normal flow.

const SITE = "https://www.roleflow.io";
const INVITE_DAYS = 14;

async function teamList(admin, businessId) {
  const [workspace, members, invites] = await Promise.all([
    admin.from("acq_workspaces").select("id, owner_id").eq("id", businessId).maybeSingle(),
    admin.from("acq_members").select("user_id, role, status, created_at").eq("business_id", businessId).eq("status", "active"),
    admin.from("acq_invites").select("id, email, role, token, created_at, expires_at").eq("business_id", businessId).is("accepted_at", null).order("created_at", { ascending: false }).limit(50)
  ]);
  if (workspace.error || !workspace.data) return json(200, { ok: false, error: "Business not found." });
  if (members.error) return json(200, { ok: false, error: "Access could not be loaded." });
  const ownerId = workspace.data.owner_id;
  const rows = members.data || [];
  const ids = [...new Set(rows.map((row) => row.user_id).concat(ownerId ? [ownerId] : []))];
  const profiles = ids.length ? await admin.from("profiles").select("id, email, full_name").in("id", ids) : { data: [] };
  const byId = new Map(((profiles.data) || []).map((row) => [row.id, row]));
  const people = rows.map((row) => {
    const profile = byId.get(row.user_id) || {};
    const role = row.user_id === ownerId ? "owner" : row.role;
    return {
      user_id: row.user_id,
      email: profile.email || "",
      name: profile.full_name || "",
      role,
      role_label: roleLabel(role),
      removable: mayRemoveMember({ ...row, role }, ownerId)
    };
  });
  if (ownerId && !people.some((row) => row.user_id === ownerId)) {
    const profile = byId.get(ownerId) || {};
    people.unshift({ user_id: ownerId, email: profile.email || "", name: profile.full_name || "", role: "owner", role_label: "Owner", removable: false });
  }
  const now = Date.now();
  const pending = dedupeInvites(invites.error ? [] : invites.data || [], now)
    .map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role || "editor",
      role_label: roleLabel(row.role || "editor"),
      expires_at: row.expires_at,
      link: SITE + "/signup/?invite=" + encodeURIComponent(row.token)
    }));
  return json(200, { ok: true, people, invites: pending, sent: false });
}

async function teamInvite(admin, businessId, userId, body) {
  const asked = normalizeInvite(body);
  if (!asked.ok) return json(200, { ok: false, error: asked.error });
  const workspace = await admin.from("acq_workspaces").select("id, name, owner_id").eq("id", businessId).maybeSingle();
  if (workspace.error || !workspace.data) return json(200, { ok: false, error: "Business not found." });
  const name = workspace.data.name || "a business";
  const pattern = asked.email.replace(/[\\%_]/g, (char) => "\\" + char);
  const found = await admin.from("profiles").select("id, email").ilike("email", pattern).limit(2);
  if (found.error) return json(200, { ok: false, error: "Access could not be saved." });
  const account = (found.data || []).find((row) => String(row.email || "").toLowerCase() === asked.email);
  if (account) {
    if (account.id === workspace.data.owner_id) return json(200, { ok: false, error: "That person owns this business." });
    const current = await admin.from("acq_members").select("role").eq("business_id", businessId).eq("user_id", account.id).maybeSingle();
    if (current.data && current.data.role === "owner") return json(200, { ok: false, error: "That person owns this business." });
    const saved = await admin.from("acq_members").upsert({
      business_id: businessId,
      user_id: account.id,
      role: asked.role,
      status: "active",
      scopes: scopesFor(asked.role)
    }, { onConflict: "business_id,user_id" });
    if (saved.error) return json(200, { ok: false, error: "Access was not saved. Apply the business testers migration first." });
    await admin.from("acq_invites").delete().eq("business_id", businessId).ilike("email", pattern).is("accepted_at", null);
    const mail = inviteEmail(name, asked.role, SITE + "/login/", true);
    const emailed = await sendTeamEmail(asked.email, mail);
    return json(200, { ok: true, added: true, emailed: emailed.ok, email_error: emailed.error || "", sent: false });
  }
  // One open invite per email: reuse the newest open one (new role, fresh
  // expiry) instead of adding a duplicate. Existing rows are not deleted.
  const open = await admin.from("acq_invites").select("id, email, token, created_at, expires_at, accepted_at").eq("business_id", businessId).ilike("email", pattern).is("accepted_at", null).order("created_at", { ascending: false }).limit(20);
  const reuse = open.error ? null : reusableInvite(open.data || [], asked.email);
  if (reuse) {
    const updated = await admin.from("acq_invites").update({
      role: asked.role,
      scopes: scopesFor(asked.role),
      invited_by: userId,
      expires_at: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000).toISOString()
    }).eq("id", reuse.id).eq("business_id", businessId).select("id").single();
    if (updated.error) return json(200, { ok: false, error: "The invite was not saved. Apply the business testers migration first." });
    const reusedLink = SITE + "/signup/?invite=" + encodeURIComponent(reuse.token);
    const resent = await sendTeamEmail(asked.email, inviteEmail(name, asked.role, reusedLink, false));
    return json(200, { ok: true, added: false, reused: true, invite_id: reuse.id, link: reusedLink, emailed: resent.ok, email_error: resent.error || "", sent: false });
  }
  const token = inviteToken(crypto.getRandomValues(new Uint8Array(32)));
  const created = await admin.from("acq_invites").insert({
    business_id: businessId,
    email: asked.email,
    role: asked.role,
    scopes: scopesFor(asked.role),
    token,
    invited_by: userId,
    expires_at: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  }).select("id").single();
  if (created.error) return json(200, { ok: false, error: "The invite was not saved. Apply the business testers migration first." });
  const link = SITE + "/signup/?invite=" + encodeURIComponent(token);
  const emailed = await sendTeamEmail(asked.email, inviteEmail(name, asked.role, link, false));
  return json(200, { ok: true, added: false, invite_id: created.data.id, link, emailed: emailed.ok, email_error: emailed.error || "", sent: false });
}

async function teamRemove(admin, businessId, body) {
  const inviteId = String(body.invite_id || "");
  if (inviteId) {
    if (!UUID.test(inviteId)) return json(200, { ok: false, error: "That invite is not on this business." });
    // Cancel removes only this one invite row; other invites stay as they are.
    const removed = await admin.from("acq_invites").delete().eq("id", inviteId).eq("business_id", businessId).is("accepted_at", null).select("id");
    if (removed.error || !(removed.data || []).length) return json(200, { ok: false, error: "That invite is not on this business." });
    return json(200, { ok: true, sent: false, removed: removed.data.length });
  }
  const memberId = String(body.user_id || "");
  if (!UUID.test(memberId)) return json(200, { ok: false, error: "Pick a person to remove." });
  const [workspace, member] = await Promise.all([
    admin.from("acq_workspaces").select("owner_id").eq("id", businessId).maybeSingle(),
    admin.from("acq_members").select("user_id, role").eq("business_id", businessId).eq("user_id", memberId).maybeSingle()
  ]);
  if (workspace.error || !workspace.data) return json(200, { ok: false, error: "Business not found." });
  if (member.error || !member.data) return json(200, { ok: false, error: "That person is not on this business." });
  if (!mayRemoveMember(member.data, workspace.data.owner_id)) return json(200, { ok: false, error: "The owner can't be removed." });
  const removed = await admin.from("acq_members").delete().eq("business_id", businessId).eq("user_id", memberId);
  if (removed.error) return json(200, { ok: false, error: "Access was not removed." });
  return json(200, { ok: true, sent: false });
}

function scopesFor(role) {
  return role === "editor" ? ["conversations", "configuration", "analysis"] : [];
}

async function sendTeamEmail(to, mail) {
  const key = Deno.env.get("RESEND_API_KEY") || "";
  if (!key) return { ok: false, error: "Email is not set up, so share the link yourself." };
  const from = Deno.env.get("RESEND_FROM") || "Roleflow <notifications@roleflow.io>";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: mail.subject, text: mail.text })
    });
    if (!response.ok) return { ok: false, error: "The email was not sent, so share the link yourself." };
    return { ok: true, error: "" };
  } catch (_error) {
    return { ok: false, error: "The email was not sent, so share the link yourself." };
  }
}
