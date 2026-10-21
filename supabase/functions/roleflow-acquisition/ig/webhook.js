import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ""), "utf8");
  const right = Buffer.from(String(b ?? ""), "utf8");
  if (!left.length || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function signBody(raw, secret) {
  const body = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

export function verifySignature(raw, header, secret) {
  if (!secret || !header) return false;
  return safeEqual(String(header).trim(), signBody(raw, secret));
}

export function hubChallenge({ mode, verifyToken, expected, challenge }) {
  if (mode !== "subscribe") return { ok: false };
  if (!safeEqual(verifyToken, expected)) return { ok: false };
  if (challenge == null || challenge === "") return { ok: false };
  return { ok: true, body: String(challenge) };
}

export function eventId(event) {
  if (!event) return "";
  if (event.mid) return "mid:" + event.mid;
  if (event.commentId) return "comment:" + event.commentId + ":" + (event.field || "comments");
  if (event.kind === "reaction" && event.reactionMid) return "reaction:" + event.reactionMid + ":" + (event.reaction || "");
  if (event.kind === "postback" && event.postbackMid) return "postback:" + event.postbackMid;
  return "hash:" + createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

export function extractEvents(body) {
  const events = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const igUserId = String(entry?.id || "");
    const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const item of messaging) {
      const sender = String(item?.sender?.id || "");
      const timestamp = Number(item?.timestamp) || Date.now();
      if (item?.message) {
        const text = String(item.message.text || item.message.attachments?.[0]?.payload?.url || "").slice(0, 4000);
        events.push({
          kind: "message",
          igUserId,
          senderId: sender,
          timestamp,
          mid: String(item.message.mid || ""),
          text,
          username: ""
        });
      } else if (item?.postback) {
        events.push({
          kind: "postback",
          igUserId,
          senderId: sender,
          timestamp,
          postbackMid: String(item.postback.mid || item.postback.payload || ""),
          text: String(item.postback.title || item.postback.payload || "")
        });
      } else if (item?.reaction) {
        events.push({
          kind: "reaction",
          igUserId,
          senderId: sender,
          timestamp,
          reactionMid: String(item.reaction.mid || ""),
          reaction: String(item.reaction.reaction || item.reaction.emoji || "")
        });
      }
    }
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const field = String(change?.field || "");
      const value = change?.value || {};
      if (field === "comments" || field === "live_comments") {
        events.push({
          kind: "comment",
          field,
          igUserId,
          senderId: String(value.from?.id || ""),
          username: String(value.from?.username || ""),
          timestamp: Number(value.created_time || entry.time || Date.now()),
          commentId: String(value.id || ""),
          text: String(value.text || "").slice(0, 4000),
          mediaId: String(value.media?.id || "")
        });
      } else if (field === "mentions") {
        events.push({
          kind: "mention",
          field,
          igUserId,
          senderId: String(value.from?.id || ""),
          username: String(value.from?.username || ""),
          timestamp: Number(entry.time || Date.now()),
          commentId: String(value.comment_id || value.media_id || ""),
          text: String(value.text || "").slice(0, 4000)
        });
      }
    }
  }
  return events.filter((event) => event.igUserId && (event.senderId || event.commentId || event.mid));
}
