const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  const map = {};
  for (const part of fmt.formatToParts(date)) map[part.type] = part.value;
  return {
    weekday: map.weekday,
    hour: Number(map.hour),
    minute: Number(map.minute),
    date: `${map.year}-${map.month}-${map.day}`
  };
}

export function formatSlot(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function pickSlots({ busy = [], now = Date.now(), timeZone = "UTC", count = 2, durationMin = 15, horizonDays = 10 } = {}) {
  const duration = durationMin * 60 * 1000;
  const step = 30 * 60 * 1000;
  const startAt = now + 60 * 60 * 1000;
  const endAt = now + horizonDays * 24 * 60 * 60 * 1000;
  const busyRanges = (busy || []).map((item) => ({
    start: new Date(item.start).getTime(),
    end: new Date(item.end).getTime()
  })).filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end));
  const chosen = [];
  const days = new Set();
  const first = Math.ceil(startAt / step) * step;
  for (let t = first; t < endAt && chosen.length < count; t += step) {
    const when = new Date(t);
    let parts;
    try {
      parts = zonedParts(when, timeZone);
    } catch {
      return chosen;
    }
    if (!WEEKDAYS.has(parts.weekday)) continue;
    if (parts.hour < 10 || parts.hour > 16) continue;
    if (parts.minute !== 0 && parts.minute !== 30) continue;
    if (days.has(parts.date)) continue;
    const end = t + duration;
    if (busyRanges.some((range) => t < range.end && end > range.start)) continue;
    days.add(parts.date);
    chosen.push({ start: when.toISOString(), end: new Date(end).toISOString(), label: formatSlot(when, timeZone) });
  }
  return chosen;
}
