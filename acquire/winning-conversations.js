// Parses pasted DM transcripts and strips contact details before a prompt is drafted.
// The draft stays a draft until someone saves it. Nothing here turns a setter on.

export const STANDING_RULES = [
  "Do not guarantee income or results.",
  "Do not invent results, clients, or numbers.",
  "Stop when the person asks you to stop.",
  "Share the booking link only after the lead agrees to a call."
];

const ME = /^(me|yo|i|setter|business|negocio|agent|agente)$/i;
const THEM = /^(them|ellos|ellas|tú|tu|you|lead|cliente|client)$/i;

export function parseTranscript(raw) {
  const text = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!text) return { messages: [], labeled: false };
  const lines = text.split("\n");
  const rows = [];
  let current = null;
  let labeled = false;
  for (const line of lines) {
    const match = line.match(/^([^:\n]{1,40}):\s*(.*)$/);
    if (match && speakerLabel(match[1])) {
      labeled = true;
      if (current) rows.push(current);
      current = { label: match[1].trim(), text: match[2] };
    } else if (current) {
      current.text += (current.text ? "\n" : "") + line;
    } else if (line.trim()) {
      rows.push({ label: "", text: line.trim() });
    }
  }
  if (current) rows.push(current);
  if (!labeled) {
    const plain = text.split("\n").map((line) => line.trim()).filter(Boolean);
    return {
      labeled: false,
      messages: plain.map((line, index) => ({
        side: index % 2 === 0 ? "them" : "me",
        label: index % 2 === 0 ? "Them" : "Me",
        text: line
      }))
    };
  }
  const labels = [];
  rows.forEach((row) => {
    const key = row.label.toLowerCase();
    if (row.label && !labels.some((item) => item.toLowerCase() === key)) labels.push(row.label);
  });
  const sideFor = {};
  labels.forEach((label) => {
    if (ME.test(label)) sideFor[label.toLowerCase()] = "me";
    else if (THEM.test(label)) sideFor[label.toLowerCase()] = "them";
  });
  const named = labels.filter((label) => !sideFor[label.toLowerCase()]);
  if (named[0]) sideFor[named[0].toLowerCase()] = "them";
  if (named[1]) sideFor[named[1].toLowerCase()] = "me";
  named.slice(2).forEach((label) => { sideFor[label.toLowerCase()] = "them"; });
  return {
    labeled: true,
    messages: rows.filter((row) => String(row.text || "").trim()).map((row) => ({
      side: sideFor[row.label.toLowerCase()] || "them",
      label: row.label,
      text: String(row.text || "").trim()
    }))
  };
}

export function swapSides(messages) {
  return (Array.isArray(messages) ? messages : []).map((row) => ({
    side: row && row.side === "me" ? "them" : "me",
    label: row && row.label ? row.label : "",
    text: row && row.text ? row.text : ""
  }));
}

function speakerLabel(label) {
  const name = String(label || "").trim();
  if (!name || name.length > 40) return false;
  if (ME.test(name) || THEM.test(name)) return true;
  return /^[A-Za-zÁÉÍÓÚÜáéíóúüÑñ][A-Za-zÁÉÍÓÚÜáéíóúüÑñ .'-]{0,30}$/.test(name);
}

export function stripPii(text, names) {
  let out = String(text || "");
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
  out = out.replace(/(?:\+|00)?\d[\d\s().-]{7,}\d/g, "[phone]");
  out = out.replace(/(^|\s)@[A-Za-z0-9._]{2,}/g, "$1[handle]");
  const seen = new Set();
  (Array.isArray(names) ? names : []).forEach((name) => {
    const clean = String(name || "").trim();
    if (clean.length < 2 || ME.test(clean) || THEM.test(clean)) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const pattern = new RegExp("\\b" + clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi");
    out = out.replace(pattern, "[name]");
  });
  return out;
}

export function transcriptsForModel(conversations) {
  return (Array.isArray(conversations) ? conversations : []).map((row) => {
    const source = row && Array.isArray(row.messages) && row.messages.length
      ? row.messages
      : parseTranscript(row && row.raw_text).messages;
    const names = source.map((item) => item && item.label).filter(Boolean);
    const lines = source.map((item) => {
      const who = item && item.side === "me" ? "Setter" : "Lead";
      return who + ": " + stripPii(item && item.text, names);
    });
    const outcome = row && (row.outcome === "booked" || row.outcome === "closed") ? row.outcome : "";
    return { outcome, notes: stripPii(row && row.notes, names), lines };
  }).filter((row) => row.lines.length);
}

export function draftBrief(fields) {
  const source = fields && typeof fields === "object" ? fields : {};
  return Object.keys(source).map((key) => {
    const value = String(source[key] || "").trim();
    return value ? key + ": " + value : "";
  }).filter(Boolean).join("\n");
}

export function buildInstruction(input) {
  const packed = transcriptsForModel(input && input.conversations);
  const brief = String(input && input.brief || "").slice(0, 8000);
  const current = String(input && input.currentPrompt || "").slice(0, 8000);
  const examples = packed.flatMap((row) => {
    const head = row.outcome ? "Outcome: " + row.outcome : "Outcome: unset";
    const notes = row.notes ? "Notes: " + row.notes : "";
    return [head, notes].filter(Boolean).concat(row.lines);
  }).join("\n");
  return [
    "Write a setter system prompt from these winning DM conversations.",
    "Match their tone, message length, casing, slang, opener, the order of qualifying questions, how they bridge to a call, how they handle objections, and when the booking link appears.",
    "Keep the business facts below. Do not add facts that are not in the business text or the conversations.",
    "Keep these rules word for word:",
    STANDING_RULES.join("\n"),
    "You may include a few short paraphrased example exchanges. The examples must already have names, handles, phone numbers, and emails removed.",
    "Return only the prompt text. Do not turn the setter on.",
    "Business:",
    brief || "(none)",
    "Current prompt:",
    current || "(none)",
    "Conversations:",
    examples || "(none)"
  ].join("\n\n");
}
