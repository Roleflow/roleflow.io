// Human-looking presence around setter replies on Instagram.
// Order for every reply: mark the lead's message seen when we start working on it,
// show typing only a few seconds before each bubble, send the bubble.
// The connected inbox has no typing-off call. Instagram clears the indicator when
// the message lands, and it expires by itself after about 20 seconds, so typing is
// never started before a long wait. The longest lead stays far below that limit.

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

// "typing" shows the indicator, "read" marks the conversation seen.
export function senderActionRequest(row, action) {
  if (action !== "typing" && action !== "read") return null;
  if (!row || privateReplyKind(row.kind)) return null;
  // A person already typed a panel reply; it goes out at once, with no typing pause.
  if (action === "typing" && row.kind === "human") return null;
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

// Typing on right before this bubble, held for a length-scaled moment, then send.
export async function typeThenSend(row, apiKey, send, options) {
  const opts = options || {};
  const sleep = opts.sleep || realSleep;
  if (senderActionRequest(row, "typing")) {
    await postSenderAction(row, apiKey, "typing", opts.fetchImpl);
    const lead = typingLeadMs(row);
    if (lead > 0) await sleep(lead);
  }
  return send();
}

// The inline wait before the first bubble, minus the typing moment that precedes it,
// so the lead never sees typing for the whole configured delay.
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
