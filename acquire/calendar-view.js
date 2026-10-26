export const CALL_MINUTES = 30;
export const MONTH_CHIP_LIMIT = 3;

export function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function addDays(date, count) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

export function addMonths(date, count) {
  const next = new Date(date);
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + count);
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, last));
  return next;
}

export function startOfWeek(date) {
  const day = startOfDay(date);
  const offset = (day.getDay() + 6) % 7;
  return addDays(day, -offset);
}

export function sameDay(a, b) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function parseWhen(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function monthMatrix(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = startOfWeek(first);
  const weeks = [];
  for (let week = 0; week < 6; week += 1) {
    const days = [];
    for (let day = 0; day < 7; day += 1) days.push(addDays(start, week * 7 + day));
    weeks.push(days);
  }
  return weeks;
}

export function visibleDays(cursor, view) {
  if (view === "day") return [startOfDay(cursor)];
  if (view === "month") return monthMatrix(cursor).flat();
  return Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(cursor), index));
}

export function shiftCursor(cursor, view, direction) {
  if (view === "month") return addMonths(cursor, direction);
  if (view === "day") return addDays(cursor, direction);
  return addDays(cursor, direction * 7);
}

export function weekdayLabels(language, style) {
  const locale = language === "es" ? "es" : "en";
  const monday = new Date(2026, 0, 5);
  return Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(locale, { weekday: style || "short" }).format(addDays(monday, index)));
}

export function viewLabel(cursor, view, language) {
  const locale = language === "es" ? "es" : "en";
  if (view === "day") return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(cursor);
  if (view === "month") return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(cursor);
  const start = view === "schedule" ? startOfDay(cursor) : startOfWeek(cursor);
  const end = addDays(start, view === "schedule" ? 13 : 6);
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(start);
  }
  const left = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(start);
  const right = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(end);
  return left + " – " + right;
}

export function formatClock(date, language) {
  const locale = language === "es" ? "es" : "en";
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
}

export function formatHourLabel(hour, language) {
  const locale = language === "es" ? "es" : "en";
  return new Intl.DateTimeFormat(locale, { hour: "numeric" }).format(new Date(2026, 0, 5, hour, 0, 0, 0));
}

export function formatRange(event, language) {
  if (!event || !event.start || event.untimed) return "";
  const end = event.end || new Date(event.start.getTime() + CALL_MINUTES * 60000);
  return formatClock(event.start, language) + " – " + formatClock(end, language);
}

function cleanHandle(value) {
  return String(value || "").trim().replace(/^@+/, "");
}

function personFor(row, targets, contacts) {
  const target = (targets || []).find((item) => item && item.id && item.id === row.target_id);
  const contact = (contacts || []).find((item) => item && item.id && (item.id === row.contact_id || (row.target_id && item.target_id === row.target_id)));
  const handle = cleanHandle(target && target.handle) || cleanHandle(contact && (contact.ig_handle || contact.handle));
  const name = String((contact && contact.name) || (target && target.name) || "").trim();
  let kind = "";
  let id = "";
  if (contact && row.contact_id && contact.id === row.contact_id) {
    kind = "contact";
    id = contact.id;
  } else if (target) {
    kind = "target";
    id = target.id;
  } else if (contact) {
    kind = "contact";
    id = contact.id;
  }
  return { name, handle, kind, id };
}

export function callEvents(bookings, targets, contacts) {
  return (bookings || []).map((row, index) => {
    const start = parseWhen(row && row.scheduled_at);
    const person = personFor(row || {}, targets, contacts);
    return {
      id: "call:" + ((row && row.id) || ("row-" + index)),
      layer: "calls",
      start,
      end: start ? new Date(start.getTime() + CALL_MINUTES * 60000) : null,
      untimed: !start,
      title: person.name || person.handle || "Booking",
      handle: person.handle,
      name: person.name,
      status: (row && row.show_status) || "scheduled",
      leadKind: person.kind,
      leadId: person.id,
      sourceId: (row && row.id) || ""
    };
  });
}

export function followEvents(reminders, targets, contacts) {
  return (reminders || []).map((row, index) => {
    if (!row || row.status === "done" || row.status === "cancelled") return null;
    const start = parseWhen(row.due_at);
    if (!start) return null;
    const person = personFor(row, targets, contacts);
    const title = String(row.title || "").trim() || person.name || person.handle || "Follow-up";
    return {
      id: "follow:" + (row.id || ("row-" + index)),
      layer: "followups",
      start,
      end: new Date(start.getTime() + CALL_MINUTES * 60000),
      untimed: false,
      title,
      handle: person.handle,
      name: person.name,
      status: "followup",
      leadKind: person.kind,
      leadId: person.id,
      sourceId: row.id || ""
    };
  }).filter(Boolean);
}

export function buildEvents(source) {
  const data = source || {};
  const layers = data.layers || { calls: true, followups: true };
  const calls = layers.calls === false ? [] : callEvents(data.bookings, data.targets, data.contacts);
  const follows = layers.followups === false ? [] : followEvents(data.reminders, data.targets, data.contacts);
  return calls.concat(follows);
}

export function eventsOnDay(events, day) {
  return (events || []).filter((event) => event.start && !event.untimed && sameDay(event.start, day));
}

export function placeEvents(events) {
  const timed = (events || []).filter((event) => event && event.start && !event.untimed).slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const placed = timed.map((event) => ({ ...event, col: 0, cols: 1 }));
  const clusters = [];
  let cluster = [];
  let clusterEnd = 0;
  placed.forEach((event) => {
    const start = event.start.getTime();
    if (!cluster.length || start < clusterEnd) {
      cluster.push(event);
      clusterEnd = Math.max(clusterEnd, event.end.getTime());
    } else {
      clusters.push(cluster);
      cluster = [event];
      clusterEnd = event.end.getTime();
    }
  });
  if (cluster.length) clusters.push(cluster);
  clusters.forEach((group) => {
    const columns = [];
    group.forEach((event) => {
      let col = columns.findIndex((end) => end <= event.start.getTime());
      if (col < 0) {
        col = columns.length;
        columns.push(event.end.getTime());
      } else columns[col] = event.end.getTime();
      event.col = col;
    });
    group.forEach((event) => {
      event.cols = columns.length;
    });
  });
  return placed;
}

export function blockGeometry(event, day) {
  const start = startOfDay(day).getTime();
  const span = 86400000;
  const from = Math.max(event.start.getTime(), start);
  const to = Math.min(event.end.getTime(), start + span);
  return {
    top: ((from - start) / span) * 100,
    height: Math.max(((to - from) / span) * 100, 1.8)
  };
}

export function monthChips(events, day, limit) {
  const cap = limit || MONTH_CHIP_LIMIT;
  const rows = eventsOnDay(events, day).slice().sort((a, b) => a.start - b.start);
  return { visible: rows.slice(0, cap), more: Math.max(0, rows.length - cap) };
}

export function scheduleDays(cursor) {
  const start = startOfDay(cursor);
  return Array.from({ length: 14 }, (_, index) => addDays(start, index));
}
