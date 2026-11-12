// The "Edit with AI" prompt editor. The model returns only the parts to
// change; this file applies them to the owner's full prompt. Everything the
// owner did not ask to change stays byte-for-byte the same.

export const EDIT_MAX_TOKENS = 4000;
export const REWRITE_MAX_TOKENS = 16000;
export const EDIT_TIMEOUT_MS = 55000;
export const REWRITE_TIMEOUT_MS = 120000;

const REWRITE_ASK = /\b(rewrite|re-write|redo|start over|from scratch)\b.*\b(whole|entire|full|all|complete)\b|\b(whole|entire|full|complete)\b.*\b(rewrite|re-write|redo)\b|reescrib\w*\s+(todo|todo el|el prompt completo|completo)|desde cero/i;

export function wantsRewrite(instruction) {
  return REWRITE_ASK.test(String(instruction || ""));
}

export function editBudget(instruction) {
  return wantsRewrite(instruction)
    ? { maxTokens: REWRITE_MAX_TOKENS, timeoutMs: REWRITE_TIMEOUT_MS }
    : { maxTokens: EDIT_MAX_TOKENS, timeoutMs: EDIT_TIMEOUT_MS };
}

export function editRequest(prompt, instruction, retryNote) {
  const rewrite = wantsRewrite(instruction);
  return [
    "Change this agent prompt the way the owner asks. Change only what the instruction asks for. Leave every other word, price, link, and line exactly as it is.",
    "Return JSON only: {\"summary\": string, \"edits\": [ ... ]}. The summary is one short sentence saying what you changed.",
    "Each edit is one of:",
    "{\"op\": \"replace\", \"find\": \"<text copied exactly from the prompt>\", \"replace\": \"<new text>\"}",
    "{\"op\": \"insert_after\", \"find\": \"<text copied exactly from the prompt>\", \"text\": \"<text to add right after it>\"}",
    "{\"op\": \"delete\", \"find\": \"<text copied exactly from the prompt>\"}",
    "{\"op\": \"append\", \"text\": \"<text to add at the end>\"}",
    rewrite
      ? "The owner asked for a full rewrite, so you may instead return one edit {\"op\": \"rewrite\", \"text\": \"<the whole new prompt>\"}."
      : "Do not return the whole prompt. Return only the edits.",
    "Copy each find string character for character from the prompt, including punctuation. Use a whole line or sentence so it appears only once.",
    "Do not add facts that are not implied by the prompt. If the instruction cannot be applied, return {\"summary\": \"<why>\", \"edits\": []}.",
    retryNote ? "Your last answer could not be applied: " + retryNote + " Copy the find strings exactly from the prompt below." : "",
    "Instruction: " + String(instruction || "").slice(0, 500),
    "Prompt:\n" + String(prompt || "")
  ].filter(Boolean).join("\n");
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Exact match first, then a match that ignores spacing and straight/curly
// quote differences. The match has to be unique.
export function locate(text, find) {
  const needle = String(find || "");
  if (!needle.trim()) return { error: "empty find" };
  const first = text.indexOf(needle);
  if (first >= 0) {
    if (text.indexOf(needle, first + 1) >= 0) return { error: "appears more than once" };
    return { start: first, end: first + needle.length };
  }
  const pattern = escapeRegex(needle.trim())
    .replace(/\s+/g, "\\s+")
    .replace(/['\u2018\u2019]/g, "['\u2018\u2019]")
    .replace(/["\u201c\u201d]/g, "[\"\u201c\u201d]")
    .replace(/[-\u2013\u2014]/g, "[-\u2013\u2014]");
  const all = [...text.matchAll(new RegExp(pattern, "g"))];
  if (all.length === 1) return { start: all[0].index, end: all[0].index + all[0][0].length };
  if (all.length > 1) return { error: "appears more than once" };
  return { error: "not found" };
}

// All edits apply or none do, so a half-applied change never reaches the editor.
export function applyPromptEdits(prompt, edits) {
  const list = Array.isArray(edits) ? edits.slice(0, 40) : [];
  let text = String(prompt || "");
  const failed = [];
  let applied = 0;
  list.forEach((edit, index) => {
    const op = String(edit && edit.op || "replace");
    if (op === "rewrite") {
      const whole = String(edit.text || "").trim();
      if (!whole) failed.push({ index, reason: "empty rewrite" });
      else { text = whole; applied += 1; }
      return;
    }
    if (op === "append") {
      const add = String(edit.text || "").trim();
      if (!add) return;
      text = text.replace(/\s*$/, "") + "\n\n" + add;
      applied += 1;
      return;
    }
    const spot = locate(text, edit && edit.find);
    if (spot.error) {
      failed.push({ index, find: String(edit && edit.find || "").slice(0, 120), reason: spot.error });
      return;
    }
    let insert = "";
    if (op === "replace") insert = String(edit.replace == null ? "" : edit.replace);
    else if (op === "insert_after") insert = text.slice(spot.start, spot.end) + (String(edit.text || "").startsWith("\n") ? "" : "\n") + String(edit.text || "");
    else if (op === "delete") insert = "";
    else { failed.push({ index, reason: "unknown op " + op }); return; }
    text = text.slice(0, spot.start) + insert + text.slice(spot.end);
    applied += 1;
  });
  if (failed.length) return { ok: false, prompt: String(prompt || ""), applied: 0, failed };
  return { ok: true, prompt: text.trim(), applied, failed: [], changed: text.trim() !== String(prompt || "").trim() };
}

export function retryNote(failed) {
  return (failed || []).slice(0, 5).map((item) => "\"" + (item.find || "") + "\" " + item.reason + ".").join(" ");
}

// fetch with a deadline, so a slow model ends with a clear message before the
// platform's own request limit cuts the connection.
export function fetchWithDeadline(ms, fetchFn) {
  const base = fetchFn || fetch;
  return (url, init) => base(url, { ...(init || {}), signal: AbortSignal.timeout(ms) });
}

export function editFailureMessage(error) {
  const name = String(error && (error.name || "") || "");
  const message = String(error && error.message || "");
  if (name === "TimeoutError" || name === "AbortError" || /timed? ?out|aborted/i.test(message)) {
    return "The AI took too long. Nothing was changed. Try a smaller, more specific edit.";
  }
  if (error && error.code === "cut_off" || /cut off/i.test(message)) {
    return "That change was too large for one step. Nothing was changed. Split it into smaller edits.";
  }
  return message.slice(0, 240) || "The model did not answer.";
}
