// Follow-up ladder decisions. No network calls. The same file is copied to
// acquire/followup-ladder.js so the panel and the engine agree.
//
// Automatic steps only go out inside 24 hours of the lead's last message and
// never carry a message tag. A person may answer for up to 7 days from the
// Chats desk; that is the only path that uses the human tag.

export const HOUR_MS = 3600000;
export const WINDOW_MS = 24 * HOUR_MS;
export const HUMAN_WINDOW_MS = 7 * 24 * HOUR_MS;
export const GAP_MS = HOUR_MS;
export const BEFORE_CLOSE_MS = 15 * 60000;
export const WELCOME_LIMIT = 2;
export const NO_FOLLOWUP_STATES = ["lost", "unqualified", "postponed"];
export const STATE_PROMPT_KEYS = ["open", "discovering", "qualifying", "proposal", "booked", "paid"];
export const SUGGESTED_LADDER = [3, 10, 22];

export function suggestedLadder() {
  return SUGGESTED_LADDER.map((hours) => ({ hours, mode: "ai", body: "", crm_state: null, asset_id: null, voice_note_id: null, state_prompts: {}, enabled: false }));
}

export function sortSteps(steps) {
  return (steps || []).slice().sort((a, b) => Number(a.hours) - Number(b.hours) || String(a.id || "").localeCompare(String(b.id || "")));
}

export function halfDayOptions() {
  const list = [];
  for (let half = 2; half <= 13; half += 1) list.push(half);
  return list;
}

export function halfDayLabel(halfDays, lang) {
  const days = Number(halfDays) / 2;
  const text = Number.isInteger(days) ? String(days) : days.toFixed(1);
  if (lang === "es") return "Después de " + text.replace(".", ",") + (days === 1 ? " día" : " días");
  return "After " + text + (days === 1 ? " day" : " days");
}

export function hourLabel(hours, lang) {
  const n = Number(hours);
  if (lang === "es") return "Después de " + n + (n === 1 ? " hora" : " horas");
  return "After " + n + (n === 1 ? " hour" : " hours");
}

export function normalizeStatePrompts(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const out = {};
  STATE_PROMPT_KEYS.forEach((key) => {
    const text = String(source[key] || "").trim();
    if (text) out[key] = text.slice(0, 2000);
  });
  return out;
}

export function statePromptCount(value) {
  return Object.keys(normalizeStatePrompts(value)).length;
}

export function mergeStatePrompts(value) {
  const prompts = normalizeStatePrompts(value);
  const keys = Object.keys(prompts);
  if (!keys.length) return "";
  return keys.map((key) => "If the lead is " + key + ": " + prompts[key]).join("\n");
}

export function ladderStepError(input) {
  const errors = [];
  const hours = Number(input && input.hours);
  if (!Number.isInteger(hours) || hours < 1 || hours > 23) errors.push("Choose a wait from 1 to 23 hours.");
  const mode = input && input.mode;
  if (mode !== "ai" && mode !== "text") errors.push("Choose AI or fixed text.");
  if (mode === "text" && !String(input.body || "").trim()) errors.push("Write the message.");
  if (String(input && input.body || "").length > 4000) errors.push("Keep the text under 4000 characters.");
  return errors;
}

export function manualStepError(input) {
  const errors = [];
  const half = Number(input && input.wait_half_days);
  if (!Number.isInteger(half) || half < 2 || half > 13) errors.push("Choose a wait from 1 to 6.5 days.");
  if (input && input.mode !== "ai" && input.mode !== "text") errors.push("Choose AI or fixed text.");
  if (input && input.mode === "text" && !String(input.body || "").trim()) errors.push("Write the message.");
  return errors;
}

export function welcomeStepError(rows) {
  const list = rows || [];
  if (list.length > WELCOME_LIMIT) return ["Up to 2 welcome steps."];
  const errors = [];
  list.forEach((row, index) => {
    const delay = Number(row.delay_hours);
    if (!Number.isInteger(delay) || delay < 1 || delay > 23) errors.push("Welcome " + (index + 1) + ": choose 1 to 23 hours.");
    if (!String(row.body || "").trim()) errors.push("Welcome " + (index + 1) + " needs text.");
  });
  return errors;
}

// The ladder restarts only when the business turned restart on. The cycle is
// part of every send key, so a step is never sent twice inside one cycle.
export function followupCycle(restartOnReply, lastUserMessageAt) {
  if (!restartOnReply) return "0";
  const at = Date.parse(lastUserMessageAt || "");
  return Number.isFinite(at) ? String(at) : "0";
}

export function followupKey(threadId, stepId, cycle) {
  return "followup:" + String(threadId || "") + ":" + String(stepId || "") + ":" + String(cycle || "0");
}

export function textBubbles(body) {
  return String(body || "").split("\n").map((line) => line.trim()).filter(Boolean);
}

function minutesOf(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function localMinutes(now, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timeZone || "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return Number(map.hour) * 60 + Number(map.minute);
  } catch (_error) {
    return null;
  }
}

// Office hours: the same daily window. per_day and always are treated as open
// here; the outbox still applies quiet hours before anything goes out.
export function officeState(now, office) {
  const source = office || {};
  if (source.mode !== "same") return { open: true, minutesToClose: null };
  const start = minutesOf(source.start || "09:00");
  const end = minutesOf(source.end || "18:00");
  const at = localMinutes(now, source.timeZone);
  if (start == null || end == null || at == null || start >= end) return { open: true, minutesToClose: null };
  const open = at >= start && at < end;
  return { open, minutesToClose: open ? end - at : null };
}

const LOST = new Set(NO_FOLLOWUP_STATES);

// Picks the next 24-hour step for one lead. Returns { action, step, reason }.
// action is "send", "skip" (record the step as skipped and move on) or "wait".
export function ladderDecision(input) {
  const source = input || {};
  const lead = source.lead || {};
  const now = Number(source.now);
  const steps = sortSteps(source.steps).filter((step) => step && step.enabled !== false);
  const done = new Set(source.doneStepIds || []);
  if (!steps.length) return { action: "wait", step: null, reason: "no_steps" };
  if (lead.humanLocked) return { action: "wait", step: null, reason: "human" };
  if (lead.automated === false) return { action: "wait", step: null, reason: "manual_lead" };
  const state = String(lead.state || "open").toLowerCase();
  if (LOST.has(state)) return { action: "wait", step: null, reason: "state_" + state };
  const last = Date.parse(lead.lastUserMessageAt || "");
  if (!Number.isFinite(last) || !Number.isFinite(now)) return { action: "wait", step: null, reason: "no_lead_message" };
  if (lead.lastFromLead === true) return { action: "wait", step: null, reason: "lead_waiting" };
  const age = now - last;
  if (age < 0) return { action: "wait", step: null, reason: "clock_skew" };
  if (age >= WINDOW_MS) return { action: "wait", step: null, reason: "window_closed" };
  const lastOut = Date.parse(lead.lastBusinessMessageAt || "");
  if (Number.isFinite(lastOut) && now - lastOut < GAP_MS) return { action: "wait", step: null, reason: "gap" };
  if (source.skipFollowed && lead.weFollow === true) return { action: "wait", step: null, reason: "followed" };
  if (lead.resumeReminderOpen) return { action: "wait", step: null, reason: "resume_reminder" };
  const next = steps.find((step) => !done.has(step.id));
  if (!next) return { action: "wait", step: null, reason: "ladder_done" };
  const prompts = normalizeStatePrompts(next.state_prompts);
  if (next.mode === "ai" && Object.keys(prompts).length && !prompts[state]) return { action: "skip", step: next, reason: "state_empty" };
  if (next.crm_state && next.crm_state !== state) return { action: "skip", step: next, reason: "state_mismatch" };
  const dueAt = last + Number(next.hours) * HOUR_MS;
  const office = officeState(now, source.office);
  if (!office.open) return { action: "wait", step: next, reason: "office_closed" };
  if (now >= dueAt) return { action: "send", step: next, reason: "due" };
  if (source.beforeClose && office.minutesToClose != null && office.minutesToClose * 60000 <= BEFORE_CLOSE_MS) {
    const closeAt = now + office.minutesToClose * 60000;
    if (dueAt >= closeAt) return { action: "send", step: next, reason: "before_close" };
  }
  return { action: "wait", step: next, reason: "too_soon" };
}

// Welcome steps run after the business's first message, until the lead
// replies, a person writes, or the chat goes manual. Text only.
export function welcomeDecision(input) {
  const source = input || {};
  const lead = source.lead || {};
  const now = Number(source.now);
  const steps = (source.steps || []).slice().sort((a, b) => Number(a.position) - Number(b.position)).slice(0, WELCOME_LIMIT);
  const done = new Set(source.doneStepIds || []);
  if (!steps.length) return { action: "wait", step: null, reason: "no_steps" };
  if (lead.humanLocked || lead.humanWrote) return { action: "wait", step: null, reason: "human" };
  if (lead.automated === false) return { action: "wait", step: null, reason: "manual_lead" };
  if (lead.leadRepliedAfterFirst) return { action: "wait", step: null, reason: "lead_replied" };
  const first = Date.parse(lead.firstBusinessMessageAt || "");
  const lastLead = Date.parse(lead.lastUserMessageAt || "");
  if (!Number.isFinite(first) || !Number.isFinite(now)) return { action: "wait", step: null, reason: "no_first_message" };
  if (now - first >= WINDOW_MS) return { action: "wait", step: null, reason: "welcome_window_closed" };
  if (!Number.isFinite(lastLead) || now - lastLead >= WINDOW_MS) return { action: "wait", step: null, reason: "window_closed" };
  const next = steps.find((step) => !done.has(step.id));
  if (!next) return { action: "wait", step: null, reason: "welcome_done" };
  if (now < first + Number(next.delay_hours) * HOUR_MS) return { action: "wait", step: next, reason: "too_soon" };
  return { action: "send", step: { ...next, mode: "text" }, reason: "due" };
}

// The follow-up brief added to the setter's system prompt. The setter prompt
// keeps the persona and guardrails; this adds only the step.
export function followupBrief(input) {
  const source = input || {};
  const step = source.step || {};
  const state = String(source.state || "open").toLowerCase();
  const prompts = normalizeStatePrompts(step.state_prompts);
  const lines = [
    "## Follow-up step",
    "The lead has not replied for " + Math.max(1, Math.round(Number(source.hoursSilent) || 0)) + " hours. Write only the next follow-up, short, in the same voice.",
    "Do not repeat a message or link you already sent. Do not mention timers or automation."
  ];
  const own = String(step.body || "").trim();
  if (own) lines.push("Step instructions: " + own);
  if (prompts[state]) lines.push("For a lead in " + state + ": " + prompts[state]);
  if (source.content) lines.push("Content to share in this step: " + source.content);
  return lines.join("\n");
}

export function voiceForStep(step, sentVoiceIds) {
  const id = step && step.voice_note_id;
  if (!id) return null;
  const sent = new Set(sentVoiceIds || []);
  return sent.has(id) ? null : id;
}

// Leads waiting for a person in the 7-day track: Lost, quiet, last lead message
// between 24 hours and 7 days ago. Oldest silence first.
export function manualQueue(input) {
  const source = input || {};
  const now = Number(source.now) || Date.now();
  const steps = (source.steps || []).slice().sort((a, b) => Number(a.wait_half_days) - Number(b.wait_half_days));
  const done = source.done || {};
  const rows = [];
  (source.leads || []).forEach((lead) => {
    if (String(lead.crm_state || "").toLowerCase() !== "lost") return;
    const last = Date.parse(lead.last_message_at || "");
    if (!Number.isFinite(last)) return;
    const quiet = now - last;
    if (quiet < WINDOW_MS || quiet >= HUMAN_WINDOW_MS) return;
    const sent = new Set(done[lead.id] || []);
    const step = steps.find((item) => !sent.has(item.id) && quiet >= Number(item.wait_half_days) * 12 * HOUR_MS);
    if (!step) return;
    rows.push({ lead, step, quietMs: quiet, closesInMs: HUMAN_WINDOW_MS - quiet });
  });
  return rows.sort((a, b) => b.quietMs - a.quietMs);
}

export function quietLabel(ms, lang) {
  const hours = Math.max(0, Math.floor(Number(ms) / HOUR_MS));
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  if (lang === "es") return days ? days + " d " + rest + " h en silencio" : rest + " h en silencio";
  return days ? "Quiet " + days + " d " + rest + " h" : "Quiet " + rest + " h";
}

export function replyRate(sends, track) {
  const rows = (sends || []).filter((row) => row && row.track === track && row.status === "sent");
  const replied = rows.filter((row) => row.replied === true).length;
  return { sent: rows.length, replied, rate: rows.length ? Math.round((replied / rows.length) * 100) : null };
}
