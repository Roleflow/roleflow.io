// Plans a manual inbox reply. The edge function performs the HTTP call.

export function leadAllowsAutoReply(row) {
  if (!row) return true;
  return row.ai_enabled !== false;
}

export function shouldAutoReply(queued, row) {
  return Boolean(queued) && leadAllowsAutoReply(row);
}

export function manualSendRequest({ accountId, conversationId, text }) {
  const message = String(text || "").trim().slice(0, 1000);
  return {
    path: "/inbox/conversations/" + encodeURIComponent(String(conversationId || "")) + "/messages",
    body: { accountId: String(accountId || ""), message }
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
