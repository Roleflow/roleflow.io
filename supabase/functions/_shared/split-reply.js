// Split a setter reply into consecutive messages at sentence or clause breaks.
// Text is never dropped and a sentence is never cut in half to meet a word
// target. Only a single sentence longer than the Instagram DM limit is broken,
// and then at a word boundary.

export const DM_CHAR_LIMIT = 1000;

export function splitReply(text, maxWords) {
  const body = String(text || "").trim();
  if (!body) return [];
  const limit = Number(maxWords);
  let parts;
  if (!Number.isFinite(limit) || limit < 1 || wordCount(body) <= limit) parts = [body];
  else {
    parts = pack(splitPieces(body, /(?<=[.!?])\s+|\n+/), limit);
    if (parts.length < 2) parts = pack(splitPieces(body, /(?<=[,;:—–])\s+/), limit);
    if (parts.length < 2) parts = [body];
  }
  return parts.flatMap((part) => fitDm(part, DM_CHAR_LIMIT));
}

// Shorten text to at most maxChars, ending on the last complete sentence.
// Falls back to the last clause break, then the last whole word.
export function trimToSentence(text, maxChars) {
  const body = String(text || "").trim();
  const cap = Number.isFinite(Number(maxChars)) && Number(maxChars) > 0 ? Math.floor(Number(maxChars)) : DM_CHAR_LIMIT;
  if (body.length <= cap) return body;
  const head = body.slice(0, cap + 1);
  const sentence = lastBreak(head, /[.!?…]+(?=\s|$)|\n/g, cap);
  if (sentence > 0) return head.slice(0, sentence).trim();
  const clause = lastBreak(head, /[,;:](?=\s)/g, cap);
  if (clause > 0) return head.slice(0, clause - 1).trim();
  const space = head.lastIndexOf(" ");
  return (space > 0 ? head.slice(0, space) : body.slice(0, cap)).trim();
}

function lastBreak(text, pattern, cap) {
  let end = -1;
  for (const match of text.matchAll(pattern)) {
    const stop = match.index + match[0].length;
    if (stop <= cap) end = stop;
  }
  return end;
}

function fitDm(text, cap) {
  const out = [];
  let rest = String(text || "").trim();
  while (rest.length > cap) {
    const piece = trimToSentence(rest, cap);
    if (!piece) break;
    out.push(piece);
    rest = rest.slice(piece.length).replace(/^[\s,;:]+/, "").trim();
  }
  if (rest) out.push(rest);
  return out;
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
