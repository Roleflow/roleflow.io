// Decides whether the live setter may answer, which model it uses, and which
// lead fields to store. No network calls.

export const DEFAULT_MODEL = "grok-4.3";
export const ESCALATION_MODEL = "grok-4.7";

const DAYS = { Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun" };

function minutesOf(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function clampDelay(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(300, Math.max(0, Math.round(number)));
}

export function officeOpen({ now, timeZone, mode, start, end, hoursByDay }) {
  if (!mode || mode === "always") return true;
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(now));
  } catch (_error) {
    return true;
  }
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minutes = Number(map.hour) * 60 + Number(map.minute);
  if (!Number.isFinite(minutes)) return true;
  const day = DAYS[map.weekday] || "mon";
  const window = mode === "per_day" ? ((hoursByDay || {})[day] || {}) : { start, end };
  const open = minutesOf(window.start || start || "09:00");
  const close = minutesOf(window.end || end || "18:00");
  if (open == null || close == null || open === close) return true;
  if (open < close) return minutes >= open && minutes < close;
  return minutes >= open || minutes < close;
}

export function delaySeconds(min, max, random) {
  const low = Math.min(clampDelay(min), clampDelay(max));
  const high = Math.max(clampDelay(min), clampDelay(max));
  const roll = typeof random === "function" ? Number(random()) : Math.random();
  const unit = Math.min(1, Math.max(0, Number.isFinite(roll) ? roll : 0));
  return low + Math.floor((high - low) * unit);
}

export function practiceDelaySeconds(min, max, simulate, random) {
  if (simulate !== true) return 0;
  return delaySeconds(min, max, random);
}

export function chooseModel({ preferred, text, state }) {
  const base = preferred === ESCALATION_MODEL ? ESCALATION_MODEL : DEFAULT_MODEL;
  if (base === ESCALATION_MODEL) return base;
  const step = String(state || "");
  if (step === "booking" || step === "booked") return ESCALATION_MODEL;
  const body = String(text || "").toLowerCase();
  if (/\b(too expensive|cannot afford|can't afford|can’t afford|scam|refund|guarantee|not interested)\b/.test(body)) return ESCALATION_MODEL;
  return DEFAULT_MODEL;
}

export function handoverOnSent(stopOnHuman) {
  return stopOnHuman !== false;
}

export function leadPatch({ attributes, tags, extracted, score, inbound, rules }) {
  const nextAttributes = { ...(attributes || {}) };
  Object.entries(extracted || {}).forEach(([key, value]) => {
    const text = String(value || "").trim();
    if (text) nextAttributes[key] = text.slice(0, 240);
  });
  const nextTags = Array.isArray(tags) ? tags.filter((tag) => typeof tag === "string") : [];
  const add = (name) => {
    const tag = String(name || "").trim().slice(0, 40);
    if (tag && !nextTags.includes(tag)) nextTags.push(tag);
  };
  if (score) add(String(score).toLowerCase());
  const haystack = String(inbound || "").toLowerCase();
  (rules || []).forEach((rule) => {
    const needle = String((rule && rule.rule_text) || "").trim().toLowerCase();
    if (needle && haystack.includes(needle)) add(rule.name);
  });
  return { attributes: nextAttributes, tags: nextTags.slice(0, 20) };
}

export function briefKnowledge(fields) {
  const source = fields && typeof fields === "object" ? fields : {};
  const lines = Object.entries(source)
    .map(([key, value]) => [key, String(value || "").trim()])
    .filter(([, value]) => value)
    .map(([key, value]) => key + ": " + value.slice(0, 500));
  if (!lines.length) return "";
  return "\n\nBusiness information\n" + lines.join("\n");
}
