// Follow-to-DM policy for @roleflow.io. The page and the worker both use this.
// A send is allowed only when every gate below passes.

export const ROLEFLOW_IG = "roleflow.io";
export const DM_CAP_DEFAULT = 20;
export const DM_CAP_MAX = 50;
export const DM_WAIT_MIN = 30;
export const DM_WAIT_MAX = 240;

const PRICE = /(?:\$|€|£)\s?\d|\b\d+\s?%|\bcommission\b|\bcomisi[oó]n\b|\bprecio\b|\bprice\b/gi;

export function normalizeHandle(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

export function isRoleflowAccount(handle) {
  return normalizeHandle(handle) === ROLEFLOW_IG;
}

export function dmModuleVisible(state) {
  const ig = normalizeHandle(state && state.ig && state.ig.username);
  const requested = normalizeHandle(state && state.setterLink && state.setterLink.requested_handle);
  const business = (state && state.businesses || []).find((row) => row.id === (state && state.businessId));
  const name = String(business && (business.agent_name || business.name) || "").trim().toLowerCase();
  return ig === ROLEFLOW_IG || requested === ROLEFLOW_IG || name === "roleflow";
}

export function clampDmCap(value) {
  if (value == null || String(value).trim() === "") return DM_CAP_DEFAULT;
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return DM_CAP_DEFAULT;
  return Math.min(DM_CAP_MAX, Math.max(1, parsed));
}

export function madridMinutes(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(bag.hour) * 60 + Number(bag.minute);
}

export function madridActive(date) {
  const minutes = madridMinutes(date instanceof Date ? date : new Date(date));
  return minutes >= 9 * 60 && minutes < 21 * 60;
}

export function jitterMinutes(random) {
  const roll = typeof random === "function" ? random() : Math.random();
  const span = DM_WAIT_MAX - DM_WAIT_MIN + 1;
  return DM_WAIT_MIN + Math.floor(Math.min(0.999999, Math.max(0, roll)) * span);
}

export function spin(template, random) {
  const roll = typeof random === "function" ? random : Math.random;
  return String(template || "").replace(/\{([^{}]+)\}/g, (_match, group) => {
    const options = String(group).split("|").map((item) => item.trim()).filter(Boolean);
    if (!options.length) return "";
    return options[Math.floor(roll() * options.length) % options.length];
  });
}

export function openerText(template, random) {
  PRICE.lastIndex = 0;
  return spin(template, random).replace(PRICE, "").replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}

export function saidStop(text) {
  return /\b(stop|unsubscribe|don't message|do not message|no me escribas|deja de escribir)\b/i.test(String(text || ""));
}

export function planDm(input) {
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  const handle = normalizeHandle(input.handle);
  if (!isRoleflowAccount(input.account)) return { ok: false, reason: "not_roleflow" };
  if (input.killed) return { ok: false, reason: "killed" };
  if (!input.enabled) return { ok: false, reason: "off" };
  if (input.paused) return { ok: false, reason: "paused" };
  if (!handle) return { ok: false, reason: "missing_handle" };
  if (input.excluded || (input.exclusions || []).some((row) => normalizeHandle(row) === handle)) return { ok: false, reason: "excluded" };
  if (saidStop(input.note) || input.stopped) return { ok: false, reason: "stop" };
  if (input.alreadySent || (input.sentHandles || []).some((row) => normalizeHandle(row) === handle)) return { ok: false, reason: "twice" };
  const cap = clampDmCap(input.cap);
  if (Number(input.sentToday || 0) >= cap) return { ok: false, reason: "cap" };
  if (!madridActive(now)) return { ok: false, reason: "hours" };
  const eventAt = input.followedAt || input.likedAt;
  if (!eventAt) return { ok: false, reason: "no_event" };
  const readyAt = new Date(new Date(eventAt).getTime() + jitterMinutes(input.random) * 60000);
  if (readyAt.getTime() > now.getTime()) return { ok: false, reason: "waiting", readyAt: readyAt.toISOString() };
  const body = openerText(input.template, input.random);
  if (!body) return { ok: false, reason: "empty" };
  if (PRICE.test(body)) return { ok: false, reason: "price" };
  PRICE.lastIndex = 0;
  return { ok: true, reason: "ready", body, cap };
}
