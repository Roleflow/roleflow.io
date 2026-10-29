// Named voice notes. A person-specific note wins, then a workflow step.
// A note is used at most once for the same person.

export const SUGGESTED_STEPS = ["Intro", "Qualify", "Booking link"];

const STATE_STEP = {
  open: "Intro",
  discovering: "Intro",
  qualifying: "Qualify",
  proposal: "Qualify",
  booked: "Booking link",
  paid: "Booking link"
};

export function workflowSteps(text) {
  const found = [];
  const add = (name) => {
    const clean = String(name || "").trim();
    if (!clean || clean.length > 40) return;
    if (found.some((item) => item.toLowerCase() === clean.toLowerCase())) return;
    found.push(clean);
  };
  String(text || "").split(/\n/).forEach((line) => {
    const trimmed = line.trim().replace(/^#+\s*/, "").replace(/^\d+[.)]\s*/, "").replace(/:$/, "").trim();
    if (!trimmed || trimmed.length > 40 || trimmed.split(/\s+/).length > 4) return;
    if (/^[A-Za-z][\w' -]{0,38}$/.test(trimmed)) add(trimmed);
  });
  SUGGESTED_STEPS.forEach((name) => {
    if (new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(String(text || ""))) add(name);
  });
  return found;
}

export function stepForState(state) {
  return STATE_STEP[String(state || "").toLowerCase()] || "";
}

function same(left, right) {
  return String(left || "").trim().toLowerCase().replace(/^@/, "") === String(right || "").trim().toLowerCase().replace(/^@/, "");
}

export function pickRoutedNote(input) {
  const source = input || {};
  const sent = new Set(source.sentIds || []);
  const notes = (source.notes || []).filter((note) => note && !note.deleted_at && note.active !== false && !sent.has(note.id));
  const handle = source.handle || "";
  const person = notes.find((note) => note.assignment_kind === "person" && note.lead_handle && same(note.lead_handle, handle));
  if (person) return person;
  const step = source.step || stepForState(source.state);
  if (!step) return null;
  return notes.find((note) => note.assignment_kind === "step" && same(note.step_name, step)) || null;
}

export function usedCounts(sends) {
  const counts = {};
  (sends || []).forEach((row) => {
    if (!row || row.result !== "sent" || !row.voice_note_id) return;
    counts[row.voice_note_id] = (counts[row.voice_note_id] || 0) + 1;
  });
  return counts;
}
