import { normalizeScore } from "./qualify.js";

const SLOTS = new Set([
  "outreach_opener", "gap_building", "recovery_followup_1", "recovery_followup_2",
  "recovery_value", "booking_confirmation", "pre_call_value", "pre_call", "reminder"
]);

export function parseEngineOutput(raw, options) {
  let data = raw;
  if (typeof raw === "string") {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("The model did not return JSON.");
    data = JSON.parse(raw.slice(start, end + 1));
  }
  if (!data || typeof data !== "object") throw new Error("The model did not return JSON.");
  const attributes = {};
  const source = data.attributes && typeof data.attributes === "object" ? data.attributes : {};
  const allowed = options && Array.isArray(options.slots) ? new Set(options.slots) : SLOTS;
  for (const [key, value] of Object.entries(source)) {
    if (!/^[a-z][a-z0-9_]{0,40}$/i.test(key)) continue;
    if (value != null && String(value).trim()) attributes[key] = String(value).trim().slice(0, 240);
  }
  const slot = allowed.has(data.voice_note_slot) ? data.voice_note_slot : null;
  const bubbles = Array.isArray(data.bubbles) ? data.bubbles : [data.reply, data.reply_text].filter(Boolean);
  return {
    bubbles,
    voiceNoteSlot: slot,
    attributes,
    score: normalizeScore(data.score),
    nextState: String(data.next_state || "").trim(),
    escalate: data.escalate === true,
    escalateReason: String(data.escalate_reason || data.escalateReason || "").slice(0, 500),
    noResponse: data.no_response === true || String(data.reply || "").trim() === "no_response",
    bookingAction: ["offer", "book", "reschedule", "cancel"].includes(data.booking_action) ? data.booking_action : null,
    slotStart: data.slot_start ? String(data.slot_start) : null,
    email: data.email ? String(data.email).slice(0, 200) : ""
  };
}
