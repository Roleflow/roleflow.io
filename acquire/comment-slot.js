// Comment recording slot. No network. The when-to-send line is plain text.

export const COMMENT_SLOT = "comment";

export function whenToSendFromRules(rules) {
  const parts = [];
  for (const rule of rules || []) {
    const intent = String(rule && rule.intent || "").trim();
    const keywords = (Array.isArray(rule && rule.keywords) ? rule.keywords : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    if (intent) parts.push(intent);
    else if (keywords.length) parts.push("When a comment includes " + keywords.join(", "));
  }
  return parts.join("\n").slice(0, 1000);
}

export function commentSlotView(saved, rules) {
  const row = saved && typeof saved === "object" ? saved : null;
  const savedWhen = row ? String(row.when_to_send || "").trim() : "";
  const derived = whenToSendFromRules(rules);
  return {
    when: (savedWhen || derived).slice(0, 1000),
    source: savedWhen ? "saved" : (derived ? "rules" : "empty"),
    voiceNoteId: row && row.voice_note_id ? String(row.voice_note_id) : ""
  };
}

export function commentSlotGuide(input) {
  const source = input || {};
  const when = String(source.when || "").trim();
  const token = String(source.token || "").trim();
  const title = String(source.title || "Comment").trim() || "Comment";
  if (!when && !token) return "";
  const lines = ["Comment recording:"];
  if (when) lines.push("Send it when: " + when);
  if (token) lines.push("Play " + token + " (" + title + ") for that comment. Do not claim the note was sent in words.");
  else lines.push("No comment recording is saved. Do not invent a voice token for comments.");
  return lines.join("\n");
}
