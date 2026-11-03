// Health probe for the logged-in web UI. No private API.

export function classifyHealth({ url, text }) {
  const href = String(url || "");
  const body = String(text || "");
  if (/\/accounts\/login\b/i.test(href)) return "expired";
  if (/\/challenge\//i.test(href)) return "checkpoint";
  if (/action blocked|try again later|we limit how often|we restrict certain activity|feedback_required|confirm it.?s you/i.test(body)) {
    return "action_block";
  }
  return "ok";
}

export function inQuietHours(date, timeZone, start, end) {
  const startMin = clockMinutes(start);
  const endMin = clockMinutes(end);
  if (startMin == null || endMin == null || startMin === endMin) return false;
  const local = zonedMinutes(date instanceof Date ? date : new Date(date), timeZone || "Europe/Madrid");
  if (startMin < endMin) return local >= startMin && local < endMin;
  return local >= startMin || local < endMin;
}

export function clockMinutes(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function zonedMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(bag.hour) * 60 + Number(bag.minute);
}

export function localDate(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date instanceof Date ? date : new Date(date));
}

export const HEARTBEAT_INTERVAL_MS = 60 * 1000;
export const HEARTBEAT_MISSES = 3;
export const HEARTBEAT_FAILURE_MS = HEARTBEAT_INTERVAL_MS * HEARTBEAT_MISSES;
export const FIRST_BOOT_MS = 10 * 60 * 1000;
export const LATER_BOOT_MS = 5 * 60 * 1000;
export const CONFIG_INTERVAL_MS = 5 * 60 * 1000;

export function bootDeadlineMs(hasBootedBefore) {
  return hasBootedBefore ? LATER_BOOT_MS : FIRST_BOOT_MS;
}

export function heartbeatDelayMs(random) {
  const roll = typeof random === "function" ? random() : Math.random();
  const clamped = Math.min(0.999999, Math.max(0, roll));
  return Math.round((50 + 20 * clamped) * 1000);
}

export function pollDelayMs(random) {
  const roll = typeof random === "function" ? random() : Math.random();
  return Math.round((5 + 10 * Math.min(0.999999, Math.max(0, roll))) * 60 * 1000);
}

export function heartbeatDue(last, now, everyMs) {
  if (!last) return true;
  const then = last instanceof Date ? last.getTime() : new Date(last).getTime();
  const clock = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return clock - then >= everyMs;
}
