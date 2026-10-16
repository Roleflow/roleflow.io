const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function cronFieldsValid(expr) {
  const fields = String(expr || "").trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((field) => /^(\*|(\*\/\d+)|(\d+(-\d+)?))(,(\*|(\*\/\d+)|(\d+(-\d+)?)))*$/.test(field));
}

export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short"
  });
  const bag = {};
  fmt.formatToParts(date).forEach((part) => {
    bag[part.type] = part.value;
  });
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    dow: WEEKDAY[bag.weekday]
  };
}

function matches(field, value) {
  if (field === "*") return true;
  return field.split(",").some((part) => {
    if (part.startsWith("*/")) {
      const step = Number(part.slice(2));
      return step > 0 && value % step === 0;
    }
    const range = part.split("-");
    if (range.length === 2) {
      const start = Number(range[0]);
      const end = Number(range[1]);
      return value >= start && value <= end;
    }
    return Number(part) === value;
  });
}

function matchesDow(field, dow) {
  if (field === "*") return true;
  return field.split(",").some((part) => {
    const range = part.split("-").map(Number);
    const norm = (day) => (day === 7 ? 0 : day);
    if (range.length === 2) return dow >= norm(range[0]) && dow <= norm(range[1]);
    return dow === norm(range[0]);
  });
}

export function nextCron(expr, timeZone, from = new Date()) {
  if (!cronFieldsValid(expr)) return null;
  const zone = timeZone || "Europe/Madrid";
  const [minF, hourF, domF, monF, dowF] = String(expr).trim().split(/\s+/);
  const minuteFixed = /^\d+$/.test(minF) ? Number(minF) : null;
  let cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor = new Date(cursor.getTime() + 60 * 1000);
  const limit = from.getTime() + 370 * 24 * 60 * 60 * 1000;
  while (cursor.getTime() < limit) {
    const parts = zonedParts(cursor, zone);
    if (minuteFixed != null && parts.minute !== minuteFixed) {
      const delta = minuteFixed - parts.minute;
      cursor = new Date(cursor.getTime() + (delta > 0 ? delta : delta + 60) * 60000);
      continue;
    }
    const dayOk = domF === "*" || dowF === "*"
      ? matches(domF, parts.day) && matchesDow(dowF, parts.dow)
      : matches(domF, parts.day) || matchesDow(dowF, parts.dow);
    if (matches(minF, parts.minute) && matches(hourF, parts.hour) && matches(monF, parts.month) && dayOk) {
      return cursor;
    }
    if (minuteFixed != null && !matches(hourF, parts.hour)) {
      cursor = new Date(cursor.getTime() + 60 * 60000);
      continue;
    }
    cursor = new Date(cursor.getTime() + 60000);
  }
  return null;
}
