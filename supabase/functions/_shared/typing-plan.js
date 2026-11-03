// Human-looking pacing around setter replies on Instagram.
// Order for every reply: mark the lead's message seen when we start working on it,
// pause a short length-scaled moment before each bubble, send the bubble.
// No typing indicator is ever shown: the only sender action posted is "read".

import { API_BASE, privateReplyKind } from "./ig-gateway.js";

export const TYPING_MIN_MS = 1500;
export const TYPING_MAX_MS = 6000;
export const TYPING_MS_PER_CHAR = 45;
export const TYPING_EXPIRES_MS = 20000;
export const CLIP_TYPING_MS = 3000;

export function typingLeadMs(row) {
  const payload = row && row.payload && typeof row.payload === "object" ? row.payload : {};
  const text = String(payload.text || "").trim();
  if (!text) return payload.clip || payload.attachmentUrl ? CLIP_TYPING_MS : 0;
  const scaled = text.length * TYPING_MS_PER_CHAR;
  return Math.round(Math.min(TYPING_MAX_MS, Math.max(TYPING_MIN_MS, scaled)));
}

export function textLeadMs(text) {
  return typingLeadMs({ payload: { text } });
}

// Only "read" (mark the conversation seen) is allowed. Typing is never shown.
export function senderActionRequest(row, action) {
  if (action !== "read") return null;
  if (!row || privateReplyKind(row.kind)) return null;
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const conversationId = String(payload.conversationId || "");
  const accountId = String(payload.accountId || "");
  if (!conversationId || !accountId) return null;
  return {
    path: "/inbox/conversations/" + encodeURIComponent(conversationId) + "/" + action,
    body: { accountId }
  };
}

// Best effort: presence never blocks or fails a reply.
export async function postSenderAction(row, apiKey, action, fetchImpl) {
  const request = senderActionRequest(row, action);
  if (!request || !apiKey) return false;
  const fetchFn = fetchImpl || fetch;
  try {
    const response = await fetchFn(API_BASE + request.path, {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(request.body)
    });
    const body = await response.json().catch(() => ({}));
    return response.ok && !(body && body.success === false);
  } catch (_error) {
    return false;
  }
}

export function markSeen(event, accountId, apiKey, fetchImpl) {
  if (!event || event.kind === "comment") return Promise.resolve(false);
  const row = { kind: "reply", payload: { conversationId: event.conversationId, accountId: accountId || event.accountId } };
  return postSenderAction(row, apiKey, "read", fetchImpl);
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A short length-scaled pause before this bubble, then send. No sender action is
// posted here, so the lead never sees a typing indicator. A panel reply a person
// already wrote, and a private reply to a comment, go out at once.
export function pausesBeforeSend(row) {
  if (!row || privateReplyKind(row.kind) || row.kind === "human") return false;
  return true;
}

export async function pauseThenSend(row, _apiKey, send, options) {
  const opts = options || {};
  const sleep = opts.sleep || realSleep;
  if (pausesBeforeSend(row)) {
    const lead = typingLeadMs(row);
    if (lead > 0) await sleep(lead);
  }
  return send();
}

// The inline wait before the first bubble, minus the pause that precedes it,
// so the total wait matches the configured delay.
export function waitBeforeTypingMs(waitSeconds, firstText) {
  const wait = Math.max(0, Number(waitSeconds) || 0) * 1000;
  return Math.max(0, wait - textLeadMs(firstText));
}

// How long to sleep for the next queued bubble of this reply, or null when none is
// due inside the horizon (the one-minute tick sends it instead).
export function nextDueInMs(rows, now, horizonMs) {
  let best = null;
  for (const row of rows || []) {
    const due = Date.parse(row && row.run_at ? row.run_at : "");
    if (!Number.isFinite(due)) continue;
    const delay = Math.max(0, due - now);
    if (delay > horizonMs) continue;
    if (best === null || delay < best) best = delay;
  }
  return best;
}
