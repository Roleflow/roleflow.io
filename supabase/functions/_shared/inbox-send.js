// Plans a manual inbox reply. The edge function performs the HTTP call.

export function leadAllowsAutoReply(row) {
  if (!row) return true;
  return row.ai_enabled !== false;
}

export function shouldAutoReply(queued, row) {
  return Boolean(queued) && leadAllowsAutoReply(row);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// A person's reply from the Chats desk. Inside 24 hours it is a plain reply.
// Between 24 hours and 7 days it may carry the human agent tag, and only when
// the person pressed Send on a 7-day follow-up. Automatic sends never use it.
export function humanWindow(lastLeadMessageAt, now, humanFollowup) {
  const last = Date.parse(lastLeadMessageAt || "");
  if (!Number.isFinite(last)) return { allow: false, tag: false, reason: "no_lead_message" };
  const age = Number(now) - last;
  if (age < 0) return { allow: true, tag: false, reason: "standard_window" };
  if (age <= DAY_MS) return { allow: true, tag: false, reason: "standard_window" };
  if (age <= 7 * DAY_MS && humanFollowup === true) return { allow: true, tag: true, reason: "human_agent_window" };
  if (age <= 7 * DAY_MS) return { allow: false, tag: false, reason: "outside_24h" };
  return { allow: false, tag: false, reason: "outside_7d" };
}

export function manualSendRequest({ accountId, conversationId, text, humanTag }) {
  const message = String(text || "").trim().slice(0, 1000);
  const body = { accountId: String(accountId || ""), message };
  if (humanTag === true) {
    body.messageTag = "HUMAN_AGENT";
    body.messagingType = "MESSAGE_TAG";
  }
  return {
    path: "/inbox/conversations/" + encodeURIComponent(String(conversationId || "")) + "/messages",
    body
  };
}

export function manualSendError(status, payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const nested = body.error && typeof body.error === "object" ? body.error : {};
  const code = String(body.code || nested.code || "");
  if (status === 409 && code === "not_thread_owner") return "Another app owns this Instagram thread.";
  if (status >= 200 && status < 300) return "";
  return "The reply was not sent.";
}
