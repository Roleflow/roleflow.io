export function textBody({ recipientId, text, tag }) {
  const body = { recipient: { id: recipientId }, message: { text: String(text || "") } };
  if (tag === "HUMAN_AGENT") body.tag = "HUMAN_AGENT";
  return body;
}

export function quickRepliesBody({ recipientId, text, replies, tag }) {
  const body = textBody({ recipientId, text, tag });
  const quick = (replies || []).slice(0, 13).map((reply) => ({
    content_type: "text",
    title: String(reply.title || "").slice(0, 20),
    payload: String(reply.payload || reply.title || "").slice(0, 1000)
  })).filter((reply) => reply.title);
  if (quick.length) body.message.quick_replies = quick;
  return body;
}

export function audioBody({ recipientId, url, tag }) {
  const body = {
    recipient: { id: recipientId },
    message: { attachment: { type: "audio", payload: { url } } }
  };
  if (tag === "HUMAN_AGENT") body.tag = "HUMAN_AGENT";
  return body;
}

export function privateReplyBody({ commentId, text }) {
  return { recipient: { comment_id: commentId }, message: { text: String(text || "") } };
}

export function typingBody(recipientId) {
  return { recipient: { id: recipientId }, sender_action: "typing_on" };
}

export function seenBody(recipientId) {
  return { recipient: { id: recipientId }, sender_action: "mark_seen" };
}

export function withPolicy(body, decision) {
  if (!decision?.allow) {
    const error = new Error(decision?.reason || "blocked");
    error.code = "window";
    throw error;
  }
  const next = { ...body };
  if (decision.tag === "HUMAN_AGENT") next.tag = "HUMAN_AGENT";
  else delete next.tag;
  if (next.tag && next.tag !== "HUMAN_AGENT") {
    throw new Error("unknown tag");
  }
  if (next.tag === "HUMAN_AGENT" && decision.tag !== "HUMAN_AGENT") {
    throw new Error("HUMAN_AGENT is only for a human reply inside the 7 day window");
  }
  return next;
}

export function retryPlan(status, attempt) {
  const code = Number(status) || 0;
  const n = Number(attempt) || 0;
  if (code === 429 || code >= 500) {
    if (n >= 5) return { retry: false, delayMs: 0 };
    return { retry: true, delayMs: Math.min(60000, 1000 * 2 ** n) };
  }
  return { retry: false, delayMs: 0 };
}

export function underRateLimit(count, limit = 20) {
  return (Number(count) || 0) < limit;
}

export function clampBubbles(bubbles) {
  return (bubbles || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((text) => {
      const words = text.split(/\s+/);
      return words.length > 30 ? words.slice(0, 30).join(" ") : text;
    });
}
