export const WELCOME_LIMIT = 2;
export const WINDOW_HOURS = 24;

export function stepError(input) {
  const hours = Number(input.hours);
  const errors = [];
  if (!Number.isInteger(hours) || hours < 1 || hours > 23) errors.push("Choose a step from 1 to 23 hours.");
  if (input.mode !== "ai" && input.mode !== "text") errors.push("Choose AI instructions or literal text.");
  if (!String(input.body || "").trim()) errors.push("Write the instruction or the message.");
  if (input.state && input.state !== "any" && !input.states.includes(input.state)) errors.push("Choose a lead state.");
  if (String(input.buttonLabel || "").trim().length > 20) errors.push("Button label is 20 characters at most.");
  return errors;
}

export function welcomeError(rows) {
  const list = rows || [];
  if (list.length > WELCOME_LIMIT) return ["A welcome sequence is two messages at most, inside 24 hours."];
  const errors = [];
  list.forEach((row, index) => {
    const delay = Number(row.delay_hours);
    if (!Number.isFinite(delay) || delay < 0 || delay > WINDOW_HOURS) errors.push("Welcome " + (index + 1) + " must be inside 24 hours.");
    if (!String(row.body || "").trim()) errors.push("Welcome " + (index + 1) + " needs text.");
  });
  return errors;
}

export function reminderBucket(reminder, now) {
  if (!reminder || reminder.status === "done") return "done";
  const due = new Date(reminder.due_at).getTime();
  const clock = now || new Date();
  const start = new Date(clock.getFullYear(), clock.getMonth(), clock.getDate()).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  if (Number.isNaN(due)) return "later";
  if (due < start) return "overdue";
  if (due < end) return "today";
  if (due < end + 6 * 24 * 60 * 60 * 1000) return "week";
  return "later";
}

export function reminderKpis(reminders, now) {
  const counts = { overdue: 0, today: 0, week: 0 };
  (reminders || []).forEach((reminder) => {
    const bucket = reminderBucket(reminder, now);
    if (bucket === "overdue") counts.overdue += 1;
    if (bucket === "today") counts.today += 1;
    if (bucket === "today" || bucket === "week") counts.week += 1;
  });
  return counts;
}

export function volumeByDay(reminders, days, now) {
  const clock = now || new Date();
  const span = days || 14;
  const buckets = [];
  for (let offset = span - 1; offset >= 0; offset -= 1) {
    const day = new Date(clock.getFullYear(), clock.getMonth(), clock.getDate() - offset);
    const key = day.toISOString().slice(0, 10);
    buckets.push({ day: key, count: 0 });
  }
  const index = new Map(buckets.map((bucket) => [bucket.day, bucket]));
  (reminders || []).forEach((reminder) => {
    const key = String(reminder.created_at || "").slice(0, 10);
    const bucket = index.get(key);
    if (bucket) bucket.count += 1;
  });
  return buckets;
}

export function matchKeyword(text, keyword, mode) {
  const hay = String(text || "").trim().toLowerCase();
  const needle = String(keyword || "").trim().toLowerCase();
  if (!needle) return false;
  if (mode === "equals") return hay === needle;
  return hay.includes(needle);
}

export const THREAD_PAGE = 40;

export function senderLabel(row) {
  const sender = String((row && row.sender) || "").toLowerCase();
  if (sender === "human" || sender === "team") return "Team";
  if (sender === "ai") return "AI";
  if (sender === "lead") return "Lead";
  if (row && row.role === "assistant") return "AI";
  if (row && row.role === "system") return "System";
  return "Lead";
}

export function chatIntro(messageCount) {
  if (Number(messageCount) > 0) return "The threads stored for this business.";
  return "The threads stored for this business. Full history appears when the event stream is connected. Status and a summary are what sync today.";
}

export function prependThread(current, olderNewestFirst) {
  const older = (olderNewestFirst || []).slice().reverse();
  return older.concat(current || []);
}

export function exportThread(messages, format) {
  const rows = messages || [];
  if (format === "json") return JSON.stringify(rows, null, 2);
  if (format === "csv") {
    const lines = ["sender,body,at"];
    rows.forEach((row) => lines.push([senderLabel(row), row.body, row.at || ""].map(csvCell).join(",")));
    return lines.join("\n");
  }
  return rows.map((row) => senderLabel(row) + ": " + row.body).join("\n");
}

function csvCell(value) {
  const text = String(value == null ? "" : value);
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
