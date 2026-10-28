// Remembers who was already on the account, and who is new, without storing a session.

import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { normalizeHandle, readyAtFor } from "../../acquire/auto-dm.js";

export function chooseApiKey(businessKey, platformKey) {
  const owned = String(businessKey || "").trim();
  if (owned) return owned;
  return String(platformKey || "").trim();
}

export function hashRoll(handle, seenAt) {
  const text = normalizeHandle(handle) + "|" + String(seenAt || "");
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

export function emptyLedger() {
  return { baselined: false, events: [] };
}

export function readLedger(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || !Array.isArray(parsed.events)) return emptyLedger();
    return { baselined: parsed.baselined === true, events: parsed.events };
  } catch (_error) {
    return emptyLedger();
  }
}

export function writeLedger(file, ledger) {
  writeFileSync(file, JSON.stringify({ baselined: ledger.baselined === true, events: ledger.events || [] }), { mode: 0o600 });
  chmodSync(file, 0o600);
}

export function claimLock(file, pid, now, staleMs) {
  let existing = null;
  try { existing = JSON.parse(readFileSync(file, "utf8")); } catch (_error) { existing = null; }
  const at = existing && existing.at ? new Date(existing.at).getTime() : 0;
  const fresh = Number.isFinite(at) && now.getTime() - at < staleMs;
  if (existing && fresh && Number(existing.pid) !== Number(pid)) return false;
  writeFileSync(file, JSON.stringify({ pid, at: now.toISOString() }), { mode: 0o600 });
  chmodSync(file, 0o600);
  return true;
}

function incomingRows(followers, likes) {
  const rows = [];
  for (const row of followers || []) rows.push({ handle: normalizeHandle(row && row.handle ? row.handle : row), kind: "follow" });
  for (const row of likes || []) rows.push({ handle: normalizeHandle(row && row.handle ? row.handle : row), kind: "like" });
  return rows.filter((row) => row.handle);
}

export function mergeActivity({ ledger, followers, likes, now, ownHandle }) {
  const current = ledger && Array.isArray(ledger.events) ? ledger.events.map((row) => ({ ...row })) : [];
  const known = new Set(current.map((row) => normalizeHandle(row.handle) + ":" + row.kind));
  const own = normalizeHandle(ownHandle);
  const stamp = (now instanceof Date ? now : new Date(now)).toISOString();
  for (const item of incomingRows(followers, likes)) {
    if (!item.handle || item.handle === own) continue;
    const key = item.handle + ":" + item.kind;
    if (known.has(key)) continue;
    known.add(key);
    if (!ledger || ledger.baselined !== true) {
      current.push({ handle: item.handle, kind: item.kind, seenAt: stamp, baseline: true });
      continue;
    }
    const roll = hashRoll(item.handle, stamp);
    current.push({
      handle: item.handle,
      kind: item.kind,
      seenAt: stamp,
      readyAt: readyAtFor(stamp, () => roll),
      roll,
      baseline: false,
      sent: false
    });
  }
  return { baselined: true, events: current };
}

export function dueEvents(ledger, now, sentHandles) {
  const sent = new Set((sentHandles || []).map((row) => normalizeHandle(row)));
  const clock = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const seen = new Set();
  const due = [];
  for (const row of (ledger && ledger.events) || []) {
    if (!row || row.baseline || row.sent) continue;
    const handle = normalizeHandle(row.handle);
    if (!handle || sent.has(handle) || seen.has(handle)) continue;
    const ready = new Date(row.readyAt).getTime();
    if (!Number.isFinite(ready) || ready > clock) continue;
    seen.add(handle);
    due.push(row);
  }
  return due;
}

export function markHandled(ledger, handle) {
  const name = normalizeHandle(handle);
  return {
    baselined: ledger.baselined === true,
    events: (ledger.events || []).map((row) => normalizeHandle(row.handle) === name ? { ...row, sent: true } : row)
  };
}

export function handlesFromFollowers(payload) {
  const users = payload && Array.isArray(payload.users) ? payload.users : [];
  return users.map((user) => ({ handle: user && user.username })).filter((row) => row.handle);
}

export function mediaIds(payload) {
  const items = payload && Array.isArray(payload.items) ? payload.items : [];
  return items.map((item) => String(item && (item.id || item.pk) || "")).filter(Boolean);
}

export function handlesFromLikers(payload) {
  const users = payload && Array.isArray(payload.users) ? payload.users : [];
  return users.map((user) => ({ handle: user && user.username })).filter((row) => row.handle);
}

export function profileFromInfo(payload) {
  const user = payload && payload.data && payload.data.user;
  if (!user) return {};
  const edges = user.edge_owner_to_timeline_media && Array.isArray(user.edge_owner_to_timeline_media.edges)
    ? user.edge_owner_to_timeline_media.edges
    : [];
  const posts = edges.slice(0, 3).map((edge) => {
    const captions = edge && edge.node && edge.node.edge_media_to_caption && edge.node.edge_media_to_caption.edges;
    return captions && captions[0] && captions[0].node && captions[0].node.text || "";
  }).filter(Boolean);
  return {
    name: user.full_name || "",
    bio: user.biography || "",
    category: user.category_name || "",
    posts
  };
}

export function feedBlocked(status, payload) {
  if (status === 401 || status === 403 || status === 429) return true;
  return /challenge|checkpoint|login_required|feedback_required/i.test(JSON.stringify(payload || {}));
}

export function exclusionList(campaigns) {
  const out = [];
  for (const row of campaigns || []) {
    String(row && row.exclusions || "").split(/[\s,]+/).forEach((item) => {
      const handle = normalizeHandle(item);
      if (handle) out.push(handle);
    });
  }
  return out;
}

export function playbookText(fields, campaigns) {
  const brief = fields && typeof fields === "object" ? JSON.stringify(fields).slice(0, 3000) : "";
  const notes = (campaigns || []).map((row) => String(row && row.template || "").trim()).filter(Boolean).join("\n");
  return [brief, notes].filter(Boolean).join("\n\n").slice(0, 4000);
}
