const RANK = { high: 0, normal: 1, low: 2 };

export function taskSpot(task) {
  const text = ((task && task.title) || "") + " " + ((task && task.description) || "");
  const hay = text.toLowerCase();
  if (!task) return "desk";
  if (task.status === "needs_diego" || /approv|outbox|send to diego|for diego/.test(hay)) return "outbox";
  if (/call|review|meet|standup/.test(hay)) return "meeting";
  if (/research|file|brief|draft|write|look/.test(hay)) return "board";
  return "desk";
}

export function defaultEstimate(task) {
  const spot = taskSpot(task);
  if (spot === "meeting") return 25;
  if (spot === "board") return 40;
  if (spot === "outbox") return 15;
  return 30;
}

function stamp(value) {
  const n = new Date(value || 0).getTime();
  return Number.isNaN(n) ? 0 : n;
}

export function compareTasks(a, b) {
  const rank = (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1);
  if (rank) return rank;
  return stamp(a.created_at) - stamp(b.created_at);
}

export function openQueue(tasks) {
  return (tasks || []).filter((task) => task && task.status !== "done").slice().sort(compareTasks);
}

export function activeTask(tasks) {
  return openQueue(tasks).find((task) => task.status !== "blocked") || null;
}

const LAUNCH_STATUS = new Set(["queued", "in_progress", "blocked", "needs_diego"]);

export function launchHeat(tasks) {
  const ids = [];
  const seen = new Set();
  (tasks || []).forEach((task) => {
    if (!task || !task.agent_id || !LAUNCH_STATUS.has(task.status) || seen.has(task.agent_id)) return;
    seen.add(task.agent_id);
    ids.push(task.agent_id);
  });
  return ids;
}

export function recentDone(tasks) {
  return (tasks || [])
    .filter((task) => task && task.status === "done")
    .slice()
    .sort((a, b) => stamp(b.completed_at || b.updated_at) - stamp(a.completed_at || a.updated_at))
    .slice(0, 6);
}

export function progressOf(task, now) {
  const estimate = Number(task && task.estimate_minutes) > 0 ? Number(task.estimate_minutes) : defaultEstimate(task);
  const estimated = !(Number(task && task.estimate_minutes) > 0);
  if (!task || task.status === "done") return { estimate, estimated, ratio: 1, left: 0, overtime: false };
  const started = stamp(task.started_at);
  if (!started) return { estimate, estimated, ratio: 0, left: estimate, overtime: false };
  const elapsed = Math.max(0, (now.getTime() - started) / 60000);
  if (elapsed >= estimate) return { estimate, estimated, ratio: 0.95, left: 0, overtime: true };
  return {
    estimate,
    estimated,
    ratio: Math.min(0.95, elapsed / estimate),
    left: Math.max(1, Math.ceil(estimate - elapsed)),
    overtime: false
  };
}

export function leftLabel(progress) {
  if (!progress) return "";
  if (progress.overtime) return "over est.";
  const suffix = progress.estimated ? " est." : "";
  return "~" + progress.left + " min left" + suffix;
}

export function madridTime(date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

export function timeline(tasks, now) {
  const open = openQueue(tasks);
  const current = activeTask(tasks);
  const rows = [];
  let cursor = now.getTime();
  let passedCurrent = !current;
  let nextUsed = false;
  open.forEach((task) => {
    const blocked = task.status === "blocked";
    const progress = progressOf(task, now);
    const estimate = Number(task.estimate_minutes) > 0 ? Number(task.estimate_minutes) : defaultEstimate(task);
    let lane = "later";
    if (current && task.id === current.id) {
      lane = "now";
      passedCurrent = true;
    } else if (passedCurrent && !blocked && !nextUsed) {
      lane = "next";
      nextUsed = true;
    }
    const minutes = blocked ? 0 : lane === "now" ? progress.left : estimate;
    const finish = new Date(cursor + minutes * 60000);
    rows.push({
      lane,
      task,
      estimate,
      estimated: !(Number(task.estimate_minutes) > 0),
      progress,
      finish
    });
    if (!blocked) cursor = finish.getTime();
  });
  return rows;
}
