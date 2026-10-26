// Comment voice outreach rules. No network. The private reply is text only.

export const DEFAULT_DAILY_CAP = 30;
export const PRIVATE_REPLY_MS = 7 * 24 * 60 * 60 * 1000;
export const PRIVATE_REPLY_TEXT = "Thanks for the comment.";

const SYSTEM_FAMILY = ["system", "systems", "sistem", "sistema", "sistemas"];
const STOP = new Set([
  "the", "a", "an", "of", "for", "to", "and", "or", "how", "what", "who", "your", "you",
  "this", "that", "with", "from", "about", "someone", "asking", "into", "they", "them",
  "que", "como", "de", "la", "el", "los", "las", "una", "un", "para", "por", "con", "del",
  "quiero", "sobre", "esta", "este"
]);

export function foldText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeCap(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_DAILY_CAP;
  return Math.min(500, Math.max(1, Math.round(number)));
}

export function madridDay(now) {
  const time = Number(now);
  if (!Number.isFinite(time)) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(time));
}

export function madridDayStartIso(now) {
  const day = madridDay(now);
  if (!day) return new Date(0).toISOString();
  const guess = Date.parse(day + "T00:00:00Z");
  for (let offset = -3; offset <= 3; offset += 1) {
    const candidate = guess - offset * 3600000;
    if (madridDay(candidate) === day && madridDay(candidate - 60000) !== day) {
      return new Date(candidate).toISOString();
    }
  }
  return new Date(guess).toISOString();
}

export function classifierSystem(rules) {
  const lines = (rules || []).map((rule) => {
    const keywords = keywordList(rule).join(", ");
    return "rule_id " + String(rule.id || "") + "; keywords: " + keywords + "; intent: " + String(rule.intent || "").slice(0, 500);
  });
  return [
    "Classify one Instagram comment against the rules.",
    "Spanish and English both count. Close spellings count.",
    "Reply with JSON only: {\"matched\":true|false,\"rule_id\":string|null,\"reason\":string}.",
    "Match only a rule listed here. If none fit, matched is false.",
    lines.join("\n")
  ].join("\n");
}

export function parseClassifier(raw, rules) {
  const text = String(raw || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let body;
  try {
    body = JSON.parse(text.slice(start, end + 1));
  } catch (_error) {
    return null;
  }
  const id = String(body.rule_id || body.ruleId || "");
  const rule = (rules || []).find((item) => String(item.id) === id);
  if (!rule || body.matched !== true) {
    return { matched: false, ruleId: null, clipId: null, reason: clipReason(body.reason || "no_match"), via: "model" };
  }
  return {
    matched: true,
    ruleId: rule.id,
    clipId: clipOf(rule),
    reason: "model:" + clipReason(body.reason || "intent"),
    via: "model"
  };
}

export function classifyComment(input) {
  const source = input || {};
  const rules = Array.isArray(source.rules) ? source.rules : [];
  const folded = foldText(source.text);
  for (const rule of rules) {
    for (const keyword of keywordList(rule)) {
      if (keywordHit(folded, keyword)) {
        return { matched: true, ruleId: rule.id, clipId: clipOf(rule), reason: "keyword:" + foldText(keyword), via: "keyword" };
      }
    }
  }
  const model = source.model;
  if (model && model.matched === true && model.ruleId) {
    const rule = rules.find((item) => String(item.id) === String(model.ruleId));
    if (rule) {
      return { matched: true, ruleId: rule.id, clipId: clipOf(rule), reason: model.reason || "model", via: "model" };
    }
  }
  for (const rule of rules) {
    if (intentHit(folded, rule.intent)) {
      return { matched: true, ruleId: rule.id, clipId: clipOf(rule), reason: "intent", via: "intent" };
    }
  }
  return { matched: false, ruleId: null, clipId: null, reason: "no_match", via: "none" };
}

export function decideCommentVoice(input) {
  const source = input || {};
  const now = Number(source.now);
  const clock = Number.isFinite(now) ? now : Date.now();
  if (source.enabled !== true) {
    return { matched: false, queued: false, ruleId: null, clipId: null, reason: "agent_off", via: "none" };
  }
  const match = classifyComment(source);
  if (!match.matched) return { ...match, queued: false };
  const commentAt = Date.parse(source.commentAt || "");
  if (Number.isFinite(commentAt) && clock - commentAt > PRIVATE_REPLY_MS) {
    return { ...match, queued: false, reason: "private_reply_window" };
  }
  const commentId = String(source.commentId || "");
  const commenterId = String(source.commenterId || "");
  const seenComment = source.seenComment === true || seen(source.history, (row) => commentId && String(row.comment_id || "") === commentId);
  if (seenComment) return { ...match, queued: false, reason: "duplicate_comment" };
  const seenCommenter = source.seenCommenter === true || seen(source.history, (row) => row.queued === true && commenterId && String(row.commenter_id || "") === commenterId);
  if (seenCommenter) return { ...match, queued: false, reason: "deduped" };
  const cap = normalizeCap(source.dailyCap);
  const sentToday = source.sentToday != null ? Number(source.sentToday) : countToday(source.history, clock);
  if (sentToday >= cap) return { ...match, queued: false, reason: "daily_cap" };
  return { ...match, queued: true, reason: "queued_text_only" };
}

export function commentVoicePlan(input) {
  const decision = decideCommentVoice(input);
  const match = decision.matched ? classifyComment(input) : null;
  const rule = (input && input.rules || []).find((item) => String(item.id) === String(decision.ruleId));
  const typed = rule ? String(rule.message || "").trim() : "";
  const detail = match && match.reason && match.reason !== decision.reason ? match.reason : "";
  const log = {
    matched: decision.matched === true,
    queued: decision.queued === true,
    reason: detail ? decision.reason + " " + detail : decision.reason,
    rule_id: decision.ruleId || null,
    clip_id: decision.clipId || null,
    comment_id: String(input && input.commentId || ""),
    commenter_id: String(input && input.commenterId || "")
  };
  if (!decision.queued) return { log, send: null };
  return {
    log,
    send: {
      kind: "comment_voice",
      text: (typed || PRIVATE_REPLY_TEXT).slice(0, 1000),
      intendedClipId: decision.clipId || null,
      attachmentUrl: "",
      attachmentType: ""
    }
  };
}

function keywordList(rule) {
  const raw = rule && rule.keywords;
  const list = Array.isArray(raw) ? raw : String(raw || "").split(/[,;\n]/);
  return list.map((item) => String(item || "").trim()).filter(Boolean);
}

function clipOf(rule) {
  if (!rule) return null;
  return rule.clip_id || rule.clipId || null;
}

function clipReason(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 160) || "no_match";
}

function tokens(folded) {
  return folded ? folded.split(" ").filter(Boolean) : [];
}

function keywordHit(foldedComment, keyword) {
  const key = foldText(keyword);
  if (!key) return false;
  const wanted = tokens(key);
  const comment = tokens(foldedComment);
  if (!wanted.length || !comment.length) return false;
  if (wanted.length > 1) return phraseHit(comment, wanted);
  const family = SYSTEM_FAMILY.includes(wanted[0]) ? SYSTEM_FAMILY : [wanted[0]];
  return comment.some((token) => family.some((candidate) => tokenClose(token, candidate)));
}

function phraseHit(comment, wanted) {
  for (let start = 0; start <= comment.length - wanted.length; start += 1) {
    const window = comment.slice(start, start + wanted.length);
    if (window.every((token, index) => tokenClose(token, wanted[index]))) return true;
  }
  return false;
}

function tokenClose(token, candidate) {
  if (token === candidate) return true;
  const limit = candidate.length >= 6 ? 2 : 1;
  if (candidate.length < 4 || token.length < 4) return false;
  if (Math.abs(token.length - candidate.length) > limit) return false;
  return distance(token, candidate) <= limit;
}

function intentHit(foldedComment, intent) {
  const words = tokens(foldText(intent)).filter((word) => word.length >= 4 && !STOP.has(word));
  if (!words.length) return false;
  const comment = tokens(foldedComment);
  let hits = 0;
  for (const word of words) {
    const family = SYSTEM_FAMILY.includes(word) ? SYSTEM_FAMILY : [word];
    if (comment.some((token) => family.some((candidate) => tokenClose(token, candidate)))) hits += 1;
  }
  const need = words.length === 1 ? 1 : Math.min(2, words.length);
  return hits >= need;
}

function distance(left, right) {
  const a = String(left);
  const b = String(right);
  const row = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) row[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = a[i - 1] === b[j - 1] ? previous : Math.min(previous, row[j - 1], row[j]) + 1;
      previous = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

function seen(history, test) {
  return (history || []).some((row) => row && test(row));
}

function countToday(history, now) {
  const day = madridDay(now);
  return (history || []).filter((row) => row && row.queued === true && madridDay(Date.parse(row.created_at || "")) === day).length;
}
