// Practice-thread memory. Undo removes messages from this list. The next setter
// reply is built only from what remains. Nothing here talks to Instagram.

export const TRIAL_VOICE_MAX_BYTES = 10 * 1024 * 1024;
export const TRIAL_VOICE_MAX_MS = 180 * 1000;
const HISTORY_MAX = 8000;

export function canRewindTo(message) {
  if (!message || message.error || message.followup || message.voiceError) return false;
  if (message.role === "user") return true;
  return message.role === "assistant" && message.business === true;
}

function ownerTurn(message) {
  if (!message || message.followup) return false;
  if (message.voiceError) return true;
  if (message.error) return false;
  return canRewindTo(message);
}

// Index of the last exchange: the latest message the owner sent, plus the
// setter replies after it. A simulated follow-up is only those follow-up
// bubbles, so undo does not also delete the question that came before.
export function exchangeStart(messages) {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) return -1;
  let index = list.length - 1;
  if (list[index] && list[index].followup) {
    while (index > 0 && list[index - 1] && list[index - 1].followup) index -= 1;
    return index;
  }
  for (let cursor = list.length - 1; cursor >= 0; cursor -= 1) {
    if (ownerTurn(list[cursor])) return cursor;
  }
  return 0;
}

export function messageDraft(message) {
  if (!canRewindTo(message)) return "";
  const spoken = message.voice && String(message.voice.transcript || "").trim();
  if (spoken) return spoken;
  return String(message.text || "");
}

export function rewindTrial(messages, startIndex) {
  const list = Array.isArray(messages) ? messages.slice() : [];
  const index = Number(startIndex);
  if (!Number.isInteger(index) || index < 0 || index >= list.length) {
    return { messages: list, changed: false, draft: "", sender: "", removed: [] };
  }
  const target = list[index];
  return {
    messages: list.slice(0, index),
    changed: true,
    draft: messageDraft(target),
    sender: target && target.business ? "business" : (target && target.role === "user" && !target.error ? "lead" : ""),
    removed: list.slice(index)
  };
}

export function historyText(message) {
  if (!message || message.error) return "";
  const spoken = message.voice && String(message.voice.transcript || "").trim();
  if (spoken) return spoken;
  return String(message.text || "").trim();
}

// What the setter is allowed to remember. Errors and failed transcriptions
// are left out. A voice note is remembered as its transcript.
export function trialHistory(messages) {
  const out = [];
  for (const item of messages || []) {
    if (!item || item.error) continue;
    if (item.role !== "user" && item.role !== "assistant") continue;
    const content = historyText(item).slice(0, HISTORY_MAX);
    if (!content) continue;
    out.push({ role: item.role === "assistant" ? "assistant" : "user", content });
  }
  return out;
}

// Gate between transcription and the setter. A failed note never becomes a turn.
export function trialVoiceOutcome(result) {
  if (!result || result.ok !== true) return { send: false, reason: (result && result.reason) || "transcribe" };
  const transcript = String(result.transcript || "").replace(/\s+/g, " ").trim();
  if (!transcript) return { send: false, reason: "empty" };
  return {
    send: true,
    transcript,
    language: String(result.language || ""),
    duration: Number(result.duration) || 0
  };
}

export function releaseVoiceUrls(messages) {
  const revoke = typeof URL !== "undefined" && URL.revokeObjectURL;
  if (!revoke) return;
  for (const message of messages || []) {
    const url = message && message.voice && message.voice.playbackUrl;
    if (typeof url === "string" && url.startsWith("blob:")) {
      try { revoke.call(URL, url); } catch (_error) { /* already released */ }
    }
  }
}

// Each business keeps its own practice thread. Switching parks the previous
// one and brings back this business's thread, or starts an empty one. In-flight
// replies are invalidated by bumping the previous thread's epoch.

export function blankTrial(workspaceId, options) {
  const extra = options || {};
  return {
    workspaceId: String(workspaceId || ""),
    scenario: extra.scenario || "follower",
    messages: Array.isArray(extra.messages) ? extra.messages.slice() : [],
    leadState: extra.leadState || "",
    epoch: Number(extra.epoch) || 0
  };
}

export function trialBelongsTo(trial, workspaceId) {
  const id = String(workspaceId || "");
  return Boolean(trial && id && String(trial.workspaceId || "") === id);
}

export function trialIsLive(trial, workspaceId, epoch) {
  if (!trialBelongsTo(trial, workspaceId)) return false;
  if (epoch != null && (trial.epoch || 0) !== epoch) return false;
  return true;
}

export function activateTrial(workspaceId, previous, store) {
  const id = String(workspaceId || "");
  const parked = store && typeof store === "object" ? Object.assign({}, store) : {};
  const previousId = previous ? String(previous.workspaceId || "") : "";
  if (previousId && previousId === id && previous) return { trial: previous, store: parked };
  const epoch = ((previous && previous.epoch) || 0) + 1;
  if (previous) previous.epoch = epoch;
  if (previousId) parked[previousId] = previous;
  const saved = parked[id];
  if (Object.prototype.hasOwnProperty.call(parked, id)) delete parked[id];
  if (saved && String(saved.workspaceId || "") === id) {
    saved.epoch = epoch;
    return { trial: saved, store: parked };
  }
  return { trial: blankTrial(id, { epoch }), store: parked };
}
