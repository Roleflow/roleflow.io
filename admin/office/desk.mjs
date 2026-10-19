// Current desk line for one agent.
//
// Selector (client-side, after the admin HQ reload):
//   supabase.from("hq_agents").select("*")
//   supabase.from("hq_tasks").select("*")
//   supabase.from("hq_activity").select("*")
//   supabase.from("hq_schedules").select("*")
// Open task: status not in done/cancelled. Rank in_progress, then
// blocked and needs_diego, then queued, then any other open status.
// Newest updated_at wins inside a rank. Activity, then an enabled
// schedule, fill an empty desk.

const CLOSED = new Set(["done", "cancelled"]);
const RANK = { in_progress: 0, blocked: 1, needs_diego: 1, queued: 2 };
const CHIP = {
  in_progress: "in progress",
  blocked: "blocked",
  needs_diego: "needs Diego",
  queued: "queued"
};

function stamp(value) {
  const n = new Date(value || 0).getTime();
  return Number.isNaN(n) ? 0 : n;
}

function rank(status) {
  return Object.prototype.hasOwnProperty.call(RANK, status) ? RANK[status] : 3;
}

const VERB = {
  research: "Research",
  writers_room: "Write",
  film_studio: "Film",
  edit_bay: "Edit",
  shipping_dock: "Ship",
  client_floor: "Review",
  chief_of_staff: "Direct",
  mail_room: "Triage",
  sales_desk: "Sell",
  back_office: "Build"
};

export function stationVerb(station) {
  return VERB[station] || "Work";
}

export function clip(text, limit) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  const max = limit > 0 ? limit : 60;
  if (value.length <= max) return value;
  return value.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
}

export function scrubDesk(text) {
  return String(text || "").replace(/rfhq_[0-9a-f]+/gi, "[key]");
}

export function relativeTime(value, now) {
  const then = stamp(value);
  const base = now instanceof Date ? now.getTime() : stamp(now);
  if (!then || !base) return "";
  const delta = Math.max(0, base - then);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.floor(delta / 3600000);
  if (hours < 24) return hours + "h ago";
  const days = Math.floor(delta / 86400000);
  if (days < 14) return days + "d ago";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(then));
}

function nextRunLabel(schedules) {
  const enabled = (schedules || []).filter((item) => item && item.enabled && item.next_run);
  if (!enabled.length) return "";
  enabled.sort((a, b) => stamp(a.next_run) - stamp(b.next_run));
  const when = new Date(enabled[0].next_run);
  if (Number.isNaN(when.getTime())) return "";
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(when);
  return "next " + formatted;
}

function openTasks(tasks) {
  return (tasks || [])
    .filter((task) => task && task.title && !CLOSED.has(task.status))
    .slice()
    .sort((a, b) => rank(a.status) - rank(b.status) || stamp(b.updated_at) - stamp(a.updated_at) || String(a.id || "").localeCompare(String(b.id || "")));
}

function latestActivity(activity) {
  return (activity || [])
    .filter((row) => row && (row.detail || row.action))
    .slice()
    .sort((a, b) => stamp(b.created_at) - stamp(a.created_at))[0] || null;
}

export function deskSummary(desk) {
  const parts = [desk && desk.short];
  if (desk && desk.chip) parts.push(desk.chip);
  if (desk && desk.more > 0) parts.push("+" + desk.more + " more");
  return parts.filter(Boolean).join(" · ");
}

export function currentDesk({ tasks, activity, schedules, now } = {}) {
  const clock = now instanceof Date ? now : new Date();
  const open = openTasks(tasks);
  if (open.length) {
    const task = open[0];
    const full = String(task.title || "").replace(/\s+/g, " ").trim();
    const desk = {
      kind: "task",
      task,
      status: task.status,
      chip: CHIP[task.status] || String(task.status || ""),
      full,
      short: clip(full, 60),
      more: open.length - 1,
      line: ""
    };
    desk.line = deskSummary(desk);
    return desk;
  }
  const row = latestActivity(activity);
  if (row) {
    const detail = clip(scrubDesk(row.detail || row.action).replace(/[.]+$/, ""), 60);
    const rel = relativeTime(row.created_at, clock);
    const full = "Last: " + detail + (rel ? ", " + rel : "");
    return {
      kind: "activity",
      task: null,
      status: "",
      chip: "",
      full,
      short: full,
      more: 0,
      line: full
    };
  }
  const next = nextRunLabel(schedules);
  const full = next ? "Idle · " + next : "Idle";
  return {
    kind: "idle",
    task: null,
    status: "",
    chip: "",
    full,
    short: full,
    more: 0,
    line: full
  };
}
