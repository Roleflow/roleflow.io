// Follow-to-DM policy. One control row per workspace. The page and the worker both use this.

export const DM_CAP_DEFAULT = 20;
export const DM_CAP_MAX = 50;
export const DM_WAIT_MIN = 5;
export const DM_WAIT_MAX = 30;
export const OPENER_MODEL = "claude-sonnet-5-5";
export const SIMILARITY_LIMIT = 0.72;

const PRICE = /(?:\$|€|£)\s?\d|\b\d+\s?%|\bcommission\b|\bcomisi[oó]n\b|\bprecio\b|\bprice\b/gi;

export function normalizeHandle(value) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

export function dmModuleVisible() {
  return true;
}

export function sessionPaths(dir, workspaceId) {
  const id = String(workspaceId || "").trim();
  const root = String(dir || "").replace(/\/$/, "");
  return {
    file: root + "/" + id + ".bin",
    keyFile: root + "/" + id + ".key",
    logFile: root + "/" + id + ".sends.jsonl"
  };
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

export function wordSet(text) {
  return new Set(String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 2));
}

export function similarity(leftText, rightText) {
  const left = wordSet(leftText);
  const right = wordSet(rightText);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  left.forEach((word) => { if (right.has(word)) shared += 1; });
  return shared / (left.size + right.size - shared);
}

export function tooSimilar(draft, recent, limit = SIMILARITY_LIMIT) {
  return (recent || []).some((text) => similarity(draft, text) >= limit);
}

export function profileReadable(profile) {
  if (!profile || typeof profile !== "object") return false;
  const posts = Array.isArray(profile.posts) ? profile.posts.map((item) => String(item || "").trim()).filter(Boolean) : [];
  return Boolean(String(profile.name || "").trim() || String(profile.bio || "").trim() || String(profile.category || "").trim() || posts.length);
}

export function openerSystem({ prompt, playbook, voice }) {
  const level = Number.isFinite(Number(voice)) ? Math.max(0, Math.min(100, Math.round(Number(voice)))) : 50;
  return [
    "Write one short Instagram opener for a new follower or liker.",
    "Use the setter prompt and the SOP playbook. Do not invent prices, results, or clients.",
    "Do not mention a price or a commission. Do not use a fixed template.",
    "Voice " + level + " of 100. 0 is more human and varied. 100 is more consistent.",
    "Setter prompt:\n" + String(prompt || "").slice(0, 6000),
    "SOP playbook:\n" + String(playbook || "").slice(0, 4000)
  ].join("\n\n");
}

export function profileBrief(profile) {
  const posts = Array.isArray(profile.posts) ? profile.posts.slice(0, 3) : [];
  return [
    "Name: " + String(profile.name || ""),
    "Category: " + String(profile.category || ""),
    "Bio: " + String(profile.bio || ""),
    posts.length ? "Recent posts:\n" + posts.join("\n") : ""
  ].filter(Boolean).join("\n");
}

export function planDm(input) {
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  const handle = normalizeHandle(input.handle);
  if (!String(input.workspaceId || "").trim()) return { ok: false, reason: "missing_workspace" };
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
  if (!profileReadable(input.profile)) return { ok: false, reason: "no_profile" };
  const body = openerText(input.draft, input.random);
  if (!body) return { ok: false, reason: "empty" };
  PRICE.lastIndex = 0;
  if (PRICE.test(body)) return { ok: false, reason: "price" };
  PRICE.lastIndex = 0;
  if (tooSimilar(body, input.recent || [])) return { ok: false, reason: "similar" };
  return { ok: true, reason: "ready", body, cap, workspaceId: String(input.workspaceId) };
}
