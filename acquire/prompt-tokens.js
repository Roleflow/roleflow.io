// Tokens inside a setter prompt. Expanding them never sends a message.

export const ROLEFLOW_BOOKING_LINK = "https://calendar.app.google/R4wpQ4b8F5J7xnD39";
export const BOOKING_TOKEN = "{{booking_link}}";

const VOICE_TOKEN = /\{\{\s*voice\s*:\s*([a-z0-9_-]+)\s*\}\}/gi;
const BOOKING_TOKEN_RE = /\{\{\s*booking_link\s*\}\}/gi;

export function voiceSlug(name) {
  const slug = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return slug || "voice_note";
}

export function voiceToken(name) {
  return "{{voice:" + voiceSlug(name) + "}}";
}

export function voiceCatalog(notes) {
  const used = new Map();
  const rows = [];
  for (const note of notes || []) {
    if (!note || note.active === false) continue;
    const title = String(note.title || note.label || note.slot || "Voice note").trim();
    let slug = voiceSlug(title);
    const count = used.get(slug) || 0;
    used.set(slug, count + 1);
    if (count > 0) slug = voiceSlug(slug + "_" + (count + 1));
    rows.push({
      id: note.id || "",
      slug,
      title,
      path: note.storage_path || note.path || "",
      mime: note.mime_type || note.mime || "audio/mpeg",
      bucket: note.bucket || "acq-voice",
      slot: note.slot || "",
      when: note.slot === "comment" ? String(note.script_hint || note.when_to_send || "").trim() : ""
    });
  }
  return rows;
}

// A saved https link, or "" when there is none. There is no shared default:
// one business must never send another business's calendar.
export function bookingLinkFor(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!/^https:\/\/[^\s]+$/i.test(text)) return "";
  return text.slice(0, 500);
}

// The booking link written in a business's own setter prompt. That prompt is
// the source of truth: the link it gives is the one the setter sends.
const URL_RE = /https:\/\/[^\s<>"'`()\[\]{}]+/gi;
const BOOKING_URL = /calendar\.app\.google|calendly\.com|cal\.com\/|\/widget\/bookings?\/|\/bookings?\/|\/booking\b|\/book\b|\/schedul|\/appointment|tidycal\.com|acuityscheduling\.com|savvycal\.com|zcal\.co|\/meetings\/|oncehub\.com|youcanbook\.me/i;
const BOOKING_LINE = /\b(book|booking|booked|calendar|calendly|schedule|appointment|demo call|strategy call|discovery call|pick (?:a|the) time|agenda|agendar|cita|reserva)\b/i;

function cleanUrl(raw) {
  return String(raw || "").replace(/[.,;:!?\u201d\u2019*_~]+$/, "").slice(0, 500);
}

export function promptBookingLink(body) {
  const lines = String(body || "").split(/\r?\n/);
  let lineHit = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const urls = line.match(URL_RE) || [];
    for (const raw of urls) {
      const url = cleanUrl(raw);
      if (!/^https:\/\/[^\s]+\.[^\s]+/.test(url)) continue;
      if (BOOKING_URL.test(url)) return url;
      const context = line + " " + (lines[index - 1] || "");
      if (!lineHit && BOOKING_LINE.test(context) && !/thank/i.test(line + " " + url)) lineHit = url;
    }
  }
  return lineHit;
}

// The link the setter sends for one business: the one in its own prompt,
// else that business's saved booking link, else none.
export function businessBookingLink({ prompt, settingsLink } = {}) {
  return promptBookingLink(prompt) || bookingLinkFor(settingsLink);
}

// Other booking links stored for a business (its old settings link, a booking
// tool, the Roleflow site calendar). If one shows up in a reply, it is swapped
// for the business's own link.
export function staleBookingLinks(link, candidates) {
  const own = String(link || "").trim();
  const seen = new Set();
  return [ROLEFLOW_BOOKING_LINK].concat(candidates || [])
    .map((item) => cleanUrl(String(item || "").trim()))
    .filter((item) => item && /^https:\/\//i.test(item) && item !== own && !own.startsWith(item) && !seen.has(item) && seen.add(item));
}

export function pinBookingLink(text, link, stale) {
  const own = String(link || "").trim();
  let out = String(text || "");
  if (!own) return out;
  for (const other of stale || []) {
    if (!other || other === own) continue;
    out = out.split(other).join(own);
  }
  return out;
}

export function normalizeBookingLink(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!/^https:\/\/[^\s]+$/i.test(text) || text.length > 500) return null;
  return text;
}

export function expandPrompt(body, bookingLink) {
  const link = bookingLinkFor(bookingLink);
  if (!link) return String(body || "");
  return String(body || "").replace(BOOKING_TOKEN_RE, link);
}

export function tokenGuide(catalog, bookingLink) {
  const notes = voiceCatalog(catalog);
  const lines = notes.map((note) => "- " + voiceToken(note.slug) + " plays " + note.title);
  return [
    "Tokens:",
    bookingLinkFor(bookingLink)
      ? "- " + BOOKING_TOKEN + " is " + bookingLinkFor(bookingLink) + ", the booking link in this business's prompt. Share only this booking link, exactly as written."
      : "- No booking link is saved for this business. Do not write " + BOOKING_TOKEN + " and do not invent a link.",
    notes.length
      ? "Voice notes. Put one token in the reply when that note should play. Do not claim a note was sent in words."
      : "No voice notes are saved. Do not invent a voice token.",
    ...lines
  ].join("\n");
}

export function unwrapModelText(raw) {
  const text = String(raw || "").trim();
  if (!text.startsWith("{")) return text;
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data.bubbles)) return data.bubbles.map((item) => String(item || "")).filter(Boolean).join("\n\n");
    if (data.reply) return String(data.reply);
  } catch (_error) {
    return text;
  }
  return text;
}

export function resolveOutgoing(text, input) {
  const source = input || {};
  const catalog = voiceCatalog(source.voices || source.catalog || []);
  const bySlug = new Map(catalog.map((note) => [note.slug, note]));
  const voices = [];
  const seen = new Set();
  const replaced = String(text || "").replace(VOICE_TOKEN, (_match, slug) => {
    const note = bySlug.get(String(slug || "").toLowerCase());
    if (note && !seen.has(note.slug)) {
      seen.add(note.slug);
      voices.push(note);
    }
    return "";
  }).replace(BOOKING_TOKEN_RE, bookingLinkFor(source.bookingLink));
  const pinned = pinBookingLink(replaced, bookingLinkFor(source.bookingLink), source.staleLinks || []);
  return {
    text: pinned.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
    voices
  };
}

export function voiceClipPayload(note) {
  if (!note || !note.path) return null;
  const mime = note.mime || "audio/mpeg";
  const filename = mime.includes("wav") ? "voice.wav" : mime.includes("mpeg") || mime.includes("mp3") ? "voice.mp3" : "voice.m4a";
  return {
    id: note.id || "",
    path: note.path,
    mime,
    kind: "audio",
    label: note.title || "Voice note",
    filename,
    bucket: note.bucket || "acq-voice"
  };
}

export const TRIAL_SCENARIOS = [
  { id: "follower", label: "New follower", context: "This person just followed the business. They have not booked a call." },
  { id: "comment", label: "Comment trigger", context: "This person commented on an Instagram post. Reply as the setter would in the private conversation." },
  { id: "cold", label: "Cold reply", context: "This person replied to a cold opener. They do not know the business yet." }
];

export function trialScenario(id) {
  return TRIAL_SCENARIOS.find((item) => item.id === id) || TRIAL_SCENARIOS[0];
}

export function localTrialText(input) {
  const source = input || {};
  const inbound = String(source.inbound || "").trim();
  const prompt = String(source.prompt || "");
  const scenario = trialScenario(source.scenario);
  if (!prompt.trim()) return "";
  if (!inbound) return "";
  const voice = prompt.match(/\{\{\s*voice\s*:\s*[a-z0-9_-]+\s*\}\}/i);
  const booking = /\{\{\s*booking_link\s*\}\}/i.test(prompt);
  const bits = ["Got it. " + inbound.slice(0, 160)];
  if (scenario.id === "comment" && voice) bits.push(voice[0]);
  else if (voice && /system|sistem|voice|nota/i.test(inbound)) bits.push(voice[0]);
  if (booking) bits.push(BOOKING_TOKEN);
  return bits.join(" ");
}

export function promptVersionLabel(versions, body) {
  const text = String(body || "");
  const list = Array.isArray(versions) ? versions : [];
  const match = list.find((row) => String(row.body || "") === text);
  const latest = list.reduce((best, row) => (Number(row.version) || 0) > (Number(best && best.version) || 0) ? row : best, null);
  if (match) return { draft: false, version: Number(match.version) || 1, id: match.id || "", created_at: match.created_at || "", created_by: match.created_by || null };
  if (latest) return { draft: true, version: Number(latest.version) || 1, id: latest.id || "", created_at: latest.created_at || "", created_by: latest.created_by || null };
  return { draft: true, version: 0, id: "", created_at: "", created_by: null };
}
