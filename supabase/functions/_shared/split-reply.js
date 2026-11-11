// Split a setter reply into consecutive messages at sentence or clause breaks.
// A trailing cut-off fragment is dropped so it is never sent. A complete
// sentence is never cut in half to meet a word target. Only a single sentence
// longer than the Instagram DM limit is broken, and then at a word boundary.

export const DM_CHAR_LIMIT = 1000;

const TERMINAL = /[.!?…]["'"')\]]*$/u;
const SHORT_OK = new Set(["i", "a", "ok", "no", "yes", "yo", "hi", "hey", "u", "we", "us", "me", "it", "he", "she", "they", "ya", "nah", "yep", "nope", "hmm", "oh", "wow", "thx", "ty"]);
const DANGLING = new Set(["and", "or", "but", "if", "the", "a", "an", "to", "for", "of", "with", "without", "on", "in", "at", "by", "from", "as", "than", "then", "so", "because", "when", "while", "though", "although", "that", "this", "these", "those", "my", "your", "our", "their", "its", "it's", "whats", "what's", "how's", "hows", "n"]);

export function splitReply(text, maxWords) {
  const body = dropIncompleteTail(String(text || "").trim());
  if (!body) return [];
  const limit = Number(maxWords);
  let parts;
  if (!Number.isFinite(limit) || limit < 1 || wordCount(body) <= limit) parts = [body];
  else {
    parts = pack(splitPieces(body, /(?<=[.!?])\s+|\n+/), limit);
    if (parts.length < 2) parts = pack(splitPieces(body, /(?<=[,;:—–])\s+/), limit);
    if (parts.length < 2) parts = [body];
  }
  const bubbles = parts.flatMap((part) => fitDm(part, DM_CHAR_LIMIT)).filter(Boolean);
  if (!bubbles.length) return [];
  const last = dropIncompleteTail(bubbles[bubbles.length - 1]);
  if (last) bubbles[bubbles.length - 1] = last;
  else bubbles.pop();
  return bubbles;
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

// Drop a trailing cut-off fragment (mid-word, dangling comma, or a hanging
// conjunction) so only complete wording is sent. A short unpunctuated reply
// like "Sounds good" is kept.
export function dropIncompleteTail(text) {
  const body = String(text || "").trim();
  if (!body) return "";
  if (isTerminal(body)) return body;
  const parts = splitSentences(body);
  const last = parts[parts.length - 1] || "";
  // A trailing unpunctuated clause after a complete sentence is a cut-off,
  // even when it ends on a real word ("how are you handling", "the engine sour").
  if (parts.length > 1 && !isTerminal(last)) return parts.slice(0, -1).join(" ").trim();
  if (isFinishedPart(last)) return body;
  return parts.slice(0, -1).join(" ").trim();
}

// After a known token-limit stop, keep only text that ends on a complete
// sentence. A fragment with no sentence end is discarded.
export function salvageCutOffText(text) {
  const body = String(text || "").trim();
  if (!body) return "";
  let end = -1;
  for (const match of body.matchAll(/[.!?…]["'"')\]]*/gu)) {
    end = match.index + match[0].length;
  }
  return end > 0 ? body.slice(0, end).trim() : "";
}

function isTerminal(text) {
  return TERMINAL.test(String(text || "").trim());
}

function isFinishedPart(text) {
  const body = String(text || "").trim();
  if (!body) return false;
  if (isTerminal(body)) return true;
  if (/[,;:—–-]$/.test(body)) return false;
  const words = body.split(/\s+/).filter(Boolean);
  const raw = words[words.length - 1] || "";
  if (/^(https?:\/\/|www\.)/i.test(raw)) return true;
  const token = raw.replace(/^[^A-Za-z0-9$€£]+|[^A-Za-z0-9$€£]+$/g, "");
  if (!token) return false;
  if (DANGLING.has(token.toLowerCase())) return false;
  if (token.length <= 2 && !SHORT_OK.has(token.toLowerCase()) && !/^\d+$/.test(token)) return false;
  return true;
}

function splitSentences(text) {
  const body = String(text || "").trim();
  if (!body) return [];
  const parts = body.split(/(?<=[.!?…])\s+/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : [body];
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
