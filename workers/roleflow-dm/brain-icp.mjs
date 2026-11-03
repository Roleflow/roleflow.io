// Per-business ICP check. Follower fallback applies only when the stored value is null.
// Empty CTA keywords pass the keyword gate. Nothing here is hardcoded to one client.

import { normalizeHandle } from "../../acquire/auto-dm.js";

export const FOLLOWER_MIN_FALLBACK = 5000;
export const FOLLOWER_MAX_FALLBACK = 200000;

export function splitList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "").split(/[,|\n]/).map((item) => item.trim()).filter(Boolean);
}

export function followerBounds(settings) {
  const source = settings || {};
  return {
    min: source.follower_min == null ? FOLLOWER_MIN_FALLBACK : Number(source.follower_min),
    max: source.follower_max == null ? FOLLOWER_MAX_FALLBACK : Number(source.follower_max)
  };
}

export function effectiveDailyCap(settings, controls) {
  const values = [settings && settings.daily_cap, controls && controls.daily_cap]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return Math.min(...values);
}

export function overCap({ sentToday, sentThisHour, dailyCap, hourlyCap }) {
  if (dailyCap != null && sentToday >= dailyCap) return "daily_cap";
  if (hourlyCap != null && sentThisHour >= hourlyCap) return "hourly_cap";
  return "";
}

function haystack(profile) {
  const captions = Array.isArray(profile.captions) ? profile.captions : (Array.isArray(profile.posts) ? profile.posts : []);
  return [profile.bio, profile.category, profile.name, ...captions].join("\n").toLowerCase();
}

function listed(value) {
  return splitList(value).map((item) => item.toLowerCase());
}

export function checkHandle(handle, config) {
  const source = config || {};
  const name = normalizeHandle(handle);
  if (!name) return { ok: false, reason: "missing_handle" };
  if (source.dnc_incomplete || source.sent_incomplete) return { ok: false, reason: "list_incomplete" };
  if ((source.dnc || []).some((row) => normalizeHandle(row) === name)) return { ok: false, reason: "dnc" };
  if ((source.sent_handles || []).some((row) => normalizeHandle(row) === name)) return { ok: false, reason: "already" };
  if (normalizeHandle(source.controls && source.controls.ig_handle) === name) return { ok: false, reason: "self" };
  return { ok: true };
}

export function checkIcp(profile, config) {
  const source = config || {};
  const settings = source.settings || {};
  const outreach = source.outreacher || {};
  const handle = normalizeHandle(profile && profile.handle);
  if (!handle) return { ok: false, reason: "missing_handle" };
  if (source.dnc_incomplete || source.sent_incomplete) return { ok: false, reason: "list_incomplete" };
  const bounds = followerBounds(settings);
  const followers = Number(profile.followers);
  if (!Number.isFinite(followers) || followers < bounds.min || followers > bounds.max) return { ok: false, reason: "follower_range" };
  const keywords = splitList(settings.cta_keywords);
  const text = haystack(profile || {});
  if (keywords.length && !keywords.some((word) => text.includes(word.toLowerCase()))) return { ok: false, reason: "keywords" };
  if (listed(outreach.exclude_keywords).some((word) => text.includes(word))) return { ok: false, reason: "exclude" };
  if ((source.dnc || []).some((row) => normalizeHandle(row) === handle)) return { ok: false, reason: "dnc" };
  if ((source.sent_handles || []).some((row) => normalizeHandle(row) === handle)) return { ok: false, reason: "already" };
  if (settings.skip_followed === true && profile.following === true) return { ok: false, reason: "followed" };
  const countries = listed(outreach.countries);
  if (profile.country && countries.length && !countries.includes(String(profile.country).toLowerCase())) return { ok: false, reason: "country" };
  const languages = listed(outreach.languages);
  if (profile.language && languages.length && !languages.includes(String(profile.language).toLowerCase())) return { ok: false, reason: "language" };
  return { ok: true };
}

export function scorePasses(score, minScore) {
  const threshold = minScore == null ? 70 : Number(minScore);
  return Number.isFinite(Number(score)) && Number(score) >= threshold;
}
