// Conversation memory for setter replies.
// The model sees the latest thread messages (both sides, oldest first, each split
// bubble counted on its own), voice-note transcripts, and bubbles still queued to
// go out, so it does not repeat itself. A cheap check regenerates once when a draft
// bubble closely repeats one of our last sent bubbles.

export const MEMORY_MIN = 10;
export const MEMORY_LIMIT = 20;
export const DUPLICATE_WINDOW = 5;
export const DUPLICATE_OVERLAP = 0.75;

const clip = (value, max) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);

function transcriptOf(metadata) {
  const voice = metadata && typeof metadata === "object" ? metadata.voice_note || metadata : null;
  if (!voice || typeof voice !== "object") return "";
  return clip(voice.transcript || "", 1000);
}

// acq_messages rows (role user/assistant) or ig_messages rows (direction in/out).
export function memoryFromRows(rows, queued, options) {
  const opts = options || {};
  const limit = Math.max(MEMORY_MIN, Number(opts.limit) || MEMORY_LIMIT);
  const items = [];
  for (const row of rows || []) {
    if (!row) continue;
    const inbound = row.role ? row.role === "user" : row.direction === "in";
    const text = clip(row.body, 1000);
    const transcript = transcriptOf(row.metadata);
    if (!text && !transcript) continue;
    const item = { from: inbound ? "lead" : "us", at: String(row.sent_at || row.created_at || ""), text };
    if (transcript) item.voice_transcript = transcript;
    items.push(item);
  }
  items.sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
  const recent = items.slice(-limit);
  const pending = [];
  for (const row of queued || []) {
    const text = clip(row && row.payload && row.payload.text, 1000);
    if (!text) continue;
    pending.push({ from: "us", at: String(row.run_at || ""), text, queued: true });
  }
  pending.sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
  return [...recent, ...pending];
}

// Our bubbles, newest last, sent or queued, for the duplicate check.
export function ourRecentBubbles(memory, count) {
  return (memory || []).filter((item) => item.from === "us").map((item) => item.text).slice(-(count || DUPLICATE_WINDOW));
}

export function memoryRule() {
  return "\n\nConversation memory\n\"recent_messages\" is this chat so far, oldest first: \"lead\" is the prospect, \"us\" is what we already sent, \"queued\": true is what we are about to send. \"inbound\" is the lead's latest message. Before you write:\n" +
    "- Answer the lead's latest message directly first. If they asked a question, answer it.\n" +
    "- Do not repeat any question, phrase, greeting or sign-off we already used in recent_messages (for example \"un placer\" or \"hola\" again). Never re-send a line we already sent or queued.\n" +
    "- Do not re-ask anything the lead already answered; use what they told you.\n" +
    "- Reply in the language of the lead's latest message. Do not mix languages.";
}

function tokens(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

function bubblesOf(text) {
  return String(text || "").split(/\n+|(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
}

// True when two bubbles say the same thing: identical once normalised, or, for
// bubbles of 4+ words, most of the shorter one's words appear in the other.
export function closeDuplicate(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.length || !right.length) return false;
  if (left.join(" ") === right.join(" ")) return true;
  const small = Math.min(left.length, right.length);
  if (small < 4) return false;
  const other = new Set(left.length <= right.length ? right : left);
  const shorter = new Set(left.length <= right.length ? left : right);
  let shared = 0;
  for (const word of shorter) if (other.has(word)) shared += 1;
  return shared / shorter.size >= DUPLICATE_OVERLAP;
}

// The first draft bubble that repeats one of our last bubbles, or "".
export function repeatedBubble(draft, previous) {
  const recent = (previous || []).slice(-DUPLICATE_WINDOW);
  for (const bubble of bubblesOf(draft)) {
    if (recent.some((sent) => closeDuplicate(bubble, sent))) return bubble;
  }
  return "";
}

export function retryRule(repeated) {
  return "\n\nYour previous draft repeated something we already sent: \"" + clip(repeated, 300) + "\". Write a different reply that answers the lead's latest message and does not reuse that wording.";
}

// Loads memory for one reply. conversationRowId selects acq_messages (gateway
// path); otherwise threadId selects ig_messages (Meta path). Queued bubbles come
// from this thread's pending outbox rows, except the row being answered.
export async function loadMemory(db, { businessId, conversationRowId, threadId, excludeId }) {
  let rows = [];
  if (conversationRowId) {
    const found = await db.from("acq_messages").select("role, body, metadata, sent_at, created_at").eq("business_id", businessId).eq("conversation_id", conversationRowId).order("created_at", { ascending: false }).limit(MEMORY_LIMIT);
    rows = found.error ? [] : found.data || [];
  } else if (threadId) {
    const found = await db.from("ig_messages").select("direction, body, created_at").eq("business_id", businessId).eq("thread_id", threadId).order("created_at", { ascending: false }).limit(MEMORY_LIMIT);
    rows = found.error ? [] : found.data || [];
  }
  let queued = [];
  if (threadId) {
    const found = await db.from("ig_outbox").select("id, payload, run_at").eq("business_id", businessId).eq("thread_id", threadId).in("status", ["pending", "running"]).order("run_at", { ascending: true }).limit(10);
    queued = found.error ? [] : (found.data || []).filter((row) => row.id !== excludeId);
  }
  return memoryFromRows(rows, queued);
}
