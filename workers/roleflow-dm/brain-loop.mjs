// One outreacher tick. Browser IO, the edge function, and the clock are injected.

import { hashRoll } from "./feed.mjs";
import { normalizeHandle } from "../../acquire/auto-dm.js";
import { checkHandle, checkIcp, effectiveDailyCap, overCap, scorePasses } from "./brain-icp.mjs";
import { authorizeAction, recheckClaim, sendingMode, typeAndMaybeSend } from "./brain-guard.mjs";
import {
  CONFIG_INTERVAL_MS,
  heartbeatDelayMs,
  heartbeatDue,
  inQuietHours,
  pollDelayMs
} from "./brain-health.mjs";
import { classifyHealth } from "./brain-health.mjs";
import { placeRuntimeSecrets } from "./brain-auth.mjs";
import { backupDue, encryptBackup, uploadEncrypted } from "./brain-backup.mjs";

function secondsOr(value, fallback) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readyDelayMs(seed, delayMinS, delayMaxS) {
  const min = secondsOr(delayMinS, 300);
  const max = secondsOr(delayMaxS, 1800);
  const lo = Math.min(min, max);
  const hi = Math.max(lo, max);
  const roll = Math.min(0.999999, Math.max(0, Number(seed) || 0));
  return Math.round((lo + (hi - lo) * roll) * 1000);
}

export function emptyLedger() {
  return { baselined: false, events: [] };
}

export function noteActivity({ ledger, followers, likes, now, ownHandle, delayMinS, delayMaxS }) {
  const current = ledger && Array.isArray(ledger.events) ? ledger.events.map((row) => ({ ...row })) : [];
  const known = new Set(current.map((row) => normalizeHandle(row.handle) + ":" + row.kind));
  const own = normalizeHandle(ownHandle);
  const stamp = (now instanceof Date ? now : new Date(now)).toISOString();
  const incoming = [];
  for (const handle of followers || []) incoming.push({ handle: normalizeHandle(handle), kind: "follow" });
  for (const handle of likes || []) incoming.push({ handle: normalizeHandle(handle), kind: "like" });
  const first = !ledger || ledger.baselined !== true;
  for (const item of incoming) {
    if (!item.handle || item.handle === own || known.has(item.handle + ":" + item.kind)) continue;
    known.add(item.handle + ":" + item.kind);
    if (first) {
      current.push({ handle: item.handle, kind: item.kind, seenAt: stamp, baseline: true });
      continue;
    }
    const seed = hashRoll(item.handle, stamp);
    current.push({
      handle: item.handle,
      kind: item.kind,
      seenAt: stamp,
      readyAt: new Date(new Date(stamp).getTime() + readyDelayMs(seed, delayMinS, delayMaxS)).toISOString(),
      baseline: false,
      skipped: false,
      sent: false
    });
  }
  return { ledger: { baselined: true, events: current }, baseline: first };
}

export function nextReady(ledger, now) {
  const clock = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return ((ledger && ledger.events) || []).find((row) => {
    if (!row || row.baseline || row.skipped || row.sent || !row.profile) return false;
    const ready = new Date(row.readyAt).getTime();
    return Number.isFinite(ready) && ready <= clock;
  }) || null;
}

function counts(ledger, now) {
  const clock = now instanceof Date ? now : new Date(now);
  const day = clock.toISOString().slice(0, 10);
  const hourAgo = clock.getTime() - 60 * 60 * 1000;
  const sends = (ledger && ledger.sends) || [];
  const attempts = (ledger && ledger.attempts) || [];
  const recent = attempts.filter((row) => new Date(row.at).getTime() >= hourAgo);
  const bad = recent.filter((row) => row.ok !== true).length;
  return {
    sendsToday: sends.filter((row) => String(row.at).slice(0, 10) === day).length,
    sendsThisHour: sends.filter((row) => new Date(row.at).getTime() >= hourAgo).length,
    errorRate: recent.length ? bad / recent.length : 0,
    lastSendAt: sends.length ? sends[sends.length - 1].at : null
  };
}

export function snapshot(ctx, session) {
  const now = ctx.now();
  const stats = counts(ctx.state.ledger, now);
  return {
    image_version: ctx.env.ROLEFLOW_IMAGE_VERSION || "dev",
    health: session === "ok" || session === "unknown" ? "ok" : "error",
    session_state: session || "unknown",
    sending_mode: sendingMode({ env: ctx.env, config: ctx.config || {} }),
    sends_today: stats.sendsToday,
    sends_per_hour: stats.sendsThisHour,
    error_rate: stats.errorRate,
    last_send_at: stats.lastSendAt,
    last_error: ctx.state.lastError || "",
    uptime_s: Math.max(0, Math.round((now.getTime() - ctx.started) / 1000))
  };
}

async function refreshConfig(ctx, force) {
  const age = ctx.state.configAt ? ctx.now().getTime() - new Date(ctx.state.configAt).getTime() : CONFIG_INTERVAL_MS;
  if (!force && age < CONFIG_INTERVAL_MS) return;
  const next = await ctx.api.config();
  if (!next || next.ok === false || !next.settings) return;
  ctx.config = await placeRuntimeSecrets(next, ctx.secrets || {});
  ctx.state.configAt = ctx.now().toISOString();
  if (next.halt === true) ctx.state.halt = true;
}

function mark(ledger, handle, kind, patch) {
  return {
    ...ledger,
    events: (ledger.events || []).map((row) => row.handle === handle && row.kind === kind ? { ...row, ...patch } : row)
  };
}

async function discover(ctx, mode) {
  const settings = ctx.config.settings || {};
  if (inQuietHours(ctx.now(), settings.timezone, settings.quiet_start, settings.quiet_end)) {
    return { ok: true, reason: "hours", mode };
  }
  const activity = await ctx.browser.listActivity();
  if (!activity || activity.ok === false) {
    if (activity && activity.reason && activity.reason !== "ui") {
      ctx.state.session = activity.reason;
      await ctx.api.heartbeat(snapshot(ctx, activity.reason));
      return { ok: false, reason: activity.reason, mode };
    }
    return { ok: false, reason: "ui", mode };
  }
  const outreach = ctx.config.outreacher || {};
  const noted = noteActivity({
    ledger: ctx.state.ledger,
    followers: activity.followers,
    likes: activity.likes,
    now: ctx.now(),
    ownHandle: ctx.config.controls && ctx.config.controls.ig_handle,
    delayMinS: outreach.delay_min_s,
    delayMaxS: outreach.delay_max_s
  });
  ctx.state.ledger = noted.ledger;
  if (noted.baseline) return { ok: true, reason: "baseline", mode };
  const fresh = noted.ledger.events.filter((row) => !row.baseline && !row.profile && !row.skipped && !row.sent);
  for (const event of fresh) {
    const known = checkHandle(event.handle, ctx.config);
    if (!known.ok) {
      ctx.state.ledger = mark(ctx.state.ledger, event.handle, event.kind, { skipped: true, reason: known.reason });
      await ctx.api.logEvent({ kind: "dm_skip", handle: event.handle, reason: known.reason });
      continue;
    }
    const view = await authorizeAction(ctx.api, { kind: "view", target: event.handle });
    if (!view.ok) {
      ctx.state.ledger = mark(ctx.state.ledger, event.handle, event.kind, { skipped: true, reason: view.reason });
      await ctx.api.logEvent({ kind: "dm_skip", handle: event.handle, reason: view.reason });
      continue;
    }
    const loaded = await ctx.browser.readProfile(event.handle);
    if (!loaded || loaded.ok === false) {
      ctx.state.ledger = mark(ctx.state.ledger, event.handle, event.kind, { skipped: true, reason: loaded && loaded.reason || "no_profile" });
      continue;
    }
    const profile = loaded.profile;
    const gate = checkIcp(profile, ctx.config);
    if (!gate.ok) {
      ctx.state.ledger = mark(ctx.state.ledger, event.handle, event.kind, { skipped: true, reason: gate.reason, profile });
      await ctx.api.logEvent({ kind: "dm_skip", handle: event.handle, reason: gate.reason });
      continue;
    }
    const scored = await ctx.api.qualify(profile, event.kind === "like" ? "post_like" : "new_follower");
    const minScore = ctx.config.workforce && ctx.config.workforce.min_score;
    if (!scored || scored.ok !== true || !scorePasses(scored.score, minScore)) {
      ctx.state.ledger = mark(ctx.state.ledger, event.handle, event.kind, { skipped: true, reason: "score", profile });
      await ctx.api.logEvent({ kind: "dm_skip", handle: event.handle, reason: "score" });
      continue;
    }
    ctx.state.ledger = mark(ctx.state.ledger, event.handle, event.kind, { profile: { ...profile, score: scored.score } });
  }
  save(ctx);
  return { ok: true, reason: "queued", mode };
}

async function sendOne(ctx, event, mode) {
  await refreshConfig(ctx, true);
  const liveMode = sendingMode({ env: ctx.env, config: ctx.config });
  if (liveMode === "off") return { ok: true, reason: "off", mode: liveMode };
  const settings = ctx.config.settings || {};
  if (inQuietHours(ctx.now(), settings.timezone, settings.quiet_start, settings.quiet_end)) {
    return { ok: true, reason: "hours", mode: liveMode };
  }
  const again = checkIcp(event.profile, ctx.config);
  if (!again.ok) {
    ctx.state.ledger = mark(ctx.state.ledger, event.handle, event.kind, { skipped: true, reason: again.reason });
    await ctx.api.logEvent({ kind: "dm_skip", handle: event.handle, reason: again.reason });
    return { ok: true, reason: again.reason, mode: liveMode };
  }
  const stats = counts(ctx.state.ledger, ctx.now());
  const cap = overCap({
    sentToday: stats.sendsToday,
    sentThisHour: stats.sendsThisHour,
    dailyCap: effectiveDailyCap(ctx.config.settings, ctx.config.controls),
    hourlyCap: ctx.config.outreacher && ctx.config.outreacher.hourly_cap != null ? Number(ctx.config.outreacher.hourly_cap) : null
  });
  if (cap) return { ok: true, reason: cap, mode: liveMode };
  const claim = await authorizeAction(ctx.api, { kind: "dm", target: event.handle });
  if (!claim.ok) {
    await ctx.api.logEvent({ kind: "dm_skip", handle: event.handle, reason: claim.reason });
    return { ok: false, reason: claim.reason, mode: liveMode };
  }
  const trigger = event.kind === "like" ? "post_like" : "new_follower";
  const drafted = await ctx.api.draft(event.profile, trigger);
  if (!drafted || drafted.ok !== true || typeof drafted.text !== "string") {
    await ctx.api.logEvent({ kind: "dm_skip", handle: event.handle, reason: drafted && drafted.reason || "no_draft" });
    return { ok: false, reason: drafted && drafted.reason || "no_draft", mode: liveMode };
  }
  const ui = await ctx.browser.openDm(event.handle);
  const delivered = await typeAndMaybeSend(ui, {
    text: drafted.text,
    live: liveMode === "live",
    claim,
    recheck: () => recheckClaim(ctx.api, claim, ctx.now())
  });
  ctx.state.ledger.attempts = (ctx.state.ledger.attempts || []).concat([{ at: ctx.now().toISOString(), ok: delivered.ok === true && delivered.reason !== "bubble_mismatch" }]);
  if (!delivered.ok) {
    ctx.state.lastError = delivered.reason;
    await ctx.api.report({ claim_id: claim.claim_id, result: "failed", handle: event.handle, body: drafted.text, reason: delivered.reason, kind: "dm" });
    return { ok: false, reason: delivered.reason, mode: liveMode };
  }
  const result = delivered.reason === "sent" ? "sent" : "dry_run";
  const reported = await ctx.api.report({
    claim_id: claim.claim_id,
    result,
    handle: event.handle,
    body: delivered.body,
    kind: "dm"
  });
  if (result === "sent") {
    ctx.state.ledger.sends = (ctx.state.ledger.sends || []).concat([{ handle: event.handle, at: ctx.now().toISOString(), body: delivered.body }]);
  }
  ctx.state.ledger = mark(ctx.state.ledger, event.handle, event.kind, { sent: true, body: delivered.body, result });
  save(ctx);
  return { ok: reported.ok !== false, reason: result, mode: liveMode, body: delivered.body, claim_id: claim.claim_id };
}

export async function bootMachine(ctx) {
  const deadline = ctx.started + ctx.bootWindow();
  let session = { ok: false, reason: "boot" };
  while (ctx.now().getTime() < deadline) {
    session = await ctx.auth.ensure();
    if (session.ok) break;
    if (session.reason === "identity_pending") {
      await ctx.sleep(5000);
      continue;
    }
    return session;
  }
  if (!session.ok) return { ok: false, reason: "heartbeat_window" };
  let beat = null;
  while (ctx.now().getTime() < deadline) {
    beat = await ctx.api.heartbeat(snapshot(ctx, "unknown"));
    if (beat && beat.ok !== false && beat.status !== 503) break;
    await ctx.sleep(5000);
  }
  if (!beat || beat.ok === false) return { ok: false, reason: "heartbeat_failed" };
  ctx.state.booted = true;
  ctx.state.lastHeartbeatAt = ctx.now().toISOString();
  ctx.state.session = "unknown";
  await refreshConfig(ctx, true);
  save(ctx);
  return { ok: true, mode: sendingMode({ env: ctx.env, config: ctx.config || {} }) };
}

export async function tickMachine(ctx) {
  const mode = sendingMode({ env: ctx.env, config: ctx.config || {} });
  if (ctx.state.halt || (ctx.config && ctx.config.halt)) return { ok: true, reason: "halt", mode: "off" };
  const health = classifyHealth(await ctx.browser.health());
  ctx.state.session = health;
  if (health !== "ok") {
    ctx.state.lastError = health;
    await ctx.api.heartbeat(snapshot(ctx, health));
    ctx.state.halt = true;
    return { ok: false, reason: health, mode };
  }
  if (mode === "off") return { ok: true, reason: "off", mode };
  await maybeBackup(ctx);
  if (!ctx.state.nextPollAt || ctx.now().getTime() >= new Date(ctx.state.nextPollAt).getTime()) {
    const found = await discover(ctx, mode);
    ctx.state.nextPollAt = new Date(ctx.now().getTime() + pollDelayMs(ctx.random)).toISOString();
    save(ctx);
    if (!found.ok || found.reason === "baseline" || found.reason === "hours" || found.reason === "ui") return found;
  }
  const due = nextReady(ctx.state.ledger, ctx.now());
  if (!due) return { ok: true, reason: "idle", mode };
  return sendOne(ctx, due, mode);
}

async function maybeBackup(ctx) {
  const settings = (ctx.config && ctx.config.settings) || {};
  if (!backupDue(ctx.state.lastBackupDate, ctx.now(), settings.timezone)) return;
  if (!ctx.backup || !ctx.backup.key) {
    ctx.state.lastBackupDate = ctx.state.lastBackupDate || "";
    return;
  }
  const bytes = await ctx.backup.readProfile();
  const cipher = await encryptBackup(bytes, ctx.backup.key);
  const uploaded = await uploadEncrypted({ api: ctx.api, bytes: cipher, fetchImpl: ctx.backup.fetchImpl });
  if (uploaded.ok) {
    ctx.state.lastBackupDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: settings.timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(ctx.now());
  }
}

function save(ctx) {
  if (typeof ctx.persist === "function") ctx.persist();
}

export function heartbeatEvery(random) {
  return heartbeatDelayMs(random);
}

export { heartbeatDue };
