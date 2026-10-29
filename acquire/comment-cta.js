// Comment keyword matching for the CTAs page.
// The short-keyword length is not stated in the public docs. See SHORT_KEYWORD_MAX.

import { readyAtFor } from "./auto-dm.js";

export const SHORT_KEYWORD_MAX = 4;

export function cleanComment(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/@[\p{L}\p{N}._]+/gu, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function distance(left, right) {
  if (Math.abs(left.length - right.length) > 1) return 2;
  const rows = Array.from({ length: left.length + 1 }, (_, index) => [index]);
  for (let col = 1; col <= right.length; col += 1) rows[0][col] = col;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[left.length][right.length];
}

function closeEnough(hay, needle) {
  if (needle.length <= SHORT_KEYWORD_MAX) return false;
  if (hay === needle) return true;
  return distance(hay, needle) === 1;
}

export function keywordHits(comment, keyword, mode) {
  const hay = cleanComment(comment);
  const needle = cleanComment(keyword);
  if (!hay || !needle) return false;
  if (mode === "equals") {
    if (hay === needle) return true;
    return !hay.includes(" ") && closeEnough(hay, needle);
  }
  if (hay.includes(needle)) return true;
  return hay.split(" ").some((word) => closeEnough(word, needle));
}

export function pickWinningCta(comment, ctas, publicationRef) {
  const ref = String(publicationRef || "").trim();
  const hits = (ctas || []).filter((row) => {
    if (!row) return false;
    const scope = row.scope === "post" ? "post" : "any";
    const target = String(row.publication_ref || "").trim();
    if (scope === "post") {
      if (!target || !ref || target !== ref) return false;
    }
    return keywordHits(comment, row.keyword, row.match_mode === "equals" ? "equals" : "contains");
  });
  hits.sort((left, right) => {
    const specific = (right.scope === "post" ? 1 : 0) - (left.scope === "post" ? 1 : 0);
    if (specific) return specific;
    const exact = (right.match_mode === "equals" ? 1 : 0) - (left.match_mode === "equals" ? 1 : 0);
    if (exact) return exact;
    return cleanComment(right.keyword).length - cleanComment(left.keyword).length;
  });
  return hits[0] || null;
}

export function pickPublicReply(replies, random) {
  const lines = (replies || []).map((line) => String(line || "").trim()).filter(Boolean);
  if (!lines.length) return "";
  const roll = typeof random === "function" ? random() : Math.random();
  const index = Math.floor(Math.min(0.999999, Math.max(0, roll)) * lines.length);
  return lines[index];
}

export function keywordConflict(rows, next) {
  const needle = cleanComment(next && next.keyword);
  if (!needle) return "Add a keyword.";
  const same = (rows || []).filter((row) => row && row.id !== next.id && cleanComment(row.keyword) === needle);
  if (!same.length) return "";
  const scoped = next.scope === "post" && String(next.publication_ref || "").trim();
  if (!scoped) return "Each copy of this keyword has to point at one post or reel.";
  if (same.some((row) => row.scope !== "post" || !String(row.publication_ref || "").trim())) {
    return "A keyword on all posts blocks the same word on one post.";
  }
  if (same.some((row) => String(row.publication_ref || "").trim() === String(next.publication_ref || "").trim())) {
    return "That post already has this keyword.";
  }
  return "";
}

export function buttonError(label, url) {
  const text = String(label || "").trim();
  const link = String(url || "").trim();
  const hasText = Boolean(text);
  const hasLink = Boolean(link);
  if (hasText !== hasLink) return "Add both the button text and the link, or leave both empty.";
  if (text.length > 20) return "Button text is 20 characters at most.";
  if (hasLink && !/^https?:\/\//i.test(link)) return "The button link has to start with http:// or https://.";
  return "";
}

export function dmSendBadge(controls) {
  const on = Boolean(controls && controls.enabled === true && controls.killed !== true);
  return on ? { label: "Live", tone: "on" } : { label: "Sending off", tone: "wait" };
}

export function prepareCommentPlan(input) {
  const source = input || {};
  const settings = source.settings || {};
  const controls = source.controls || {};
  const cta = pickWinningCta(source.comment, source.ctas, source.publicationRef);
  const replies = (settings.public_replies || []).length ? settings.public_replies : (cta && cta.public_replies) || [];
  if (!cta && !settings.dm_without_keyword) return { action: "ignore", sent: false };
  if (!cta && settings.dm_without_keyword && !settings.auto_reply) return { action: "ignore", sent: false };
  const profile = source.profile || {};
  const voice = cta && cta.reply_kind === "voice";
  const dm = voice
    ? {
        kind: "voice",
        verbatim: false,
        voice_path: cta.voice_path || "",
        voice_mime: cta.voice_mime || "",
        note: "Use the stored voice note. Do not replace it with one fixed sentence."
      }
    : {
        kind: "text",
        verbatim: false,
        instruction: cta ? String(cta.dm_text || "") : "Continue from the comment in this business's voice.",
        profile: {
          handle: String(profile.handle || ""),
          name: String(profile.name || ""),
          bio: String(profile.bio || "")
        }
      };
  const enabled = controls.enabled === true && controls.killed !== true;
  return {
    action: "hold",
    sent: false,
    status: "held",
    hold_reason: enabled ? "" : "dm_disabled",
    cta_id: cta ? cta.id || null : null,
    public_reply: settings.auto_reply ? pickPublicReply(replies, source.random) : "",
    dm,
    button_label: cta ? String(cta.button_label || "") : "",
    button_url: cta ? String(cta.button_url || "") : "",
    send_after: readyAtFor(source.now || new Date(), source.random)
  };
}
