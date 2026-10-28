// Split a setter reply into consecutive messages at sentence or clause breaks.

export function splitReply(text, maxWords) {
  const body = String(text || "").trim();
  if (!body) return [];
  const limit = Number(maxWords);
  if (!Number.isFinite(limit) || limit < 1) return [body];
  if (wordCount(body) <= limit) return [body];
  let parts = pack(splitPieces(body, /(?<=[.!?])\s+|\n+/), limit);
  if (parts.length < 2) parts = pack(splitPieces(body, /(?<=[,;:—–])\s+/), limit);
  if (parts.length < 2) {
    const words = body.split(/\s+/);
    const mid = Math.ceil(words.length / 2);
    parts = [words.slice(0, mid).join(" "), words.slice(mid).join(" ")].filter(Boolean);
  }
  return parts;
}

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function splitPieces(text, pattern) {
  return String(text || "").split(pattern).map((part) => part.trim()).filter(Boolean);
}

function pack(chunks, limit) {
  const parts = [];
  let current = [];
  chunks.forEach((chunk) => {
    const next = current.concat(chunk);
    if (current.length && wordCount(next.join(" ")) > limit) {
      parts.push(current.join(" "));
      current = [chunk];
    } else current = next;
  });
  if (current.length) parts.push(current.join(" "));
  return parts.filter(Boolean);
}
