const FIRST = new Set(["first touch", "firsttouch"]);
const ENGAGED = new Set(["engaged"]);
const QUALIFIED = new Set(["qualified"]);
const BOOKED_STAGE = new Set(["booked", "call booked", "booking"]);

export function finiteCount(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function utcKey(now, offset = 0) {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
  return day.toISOString().slice(0, 10);
}

function seriesRows(series) {
  return (Array.isArray(series) ? series : []).map((item) => {
    const day = String(item && item.day || "").slice(0, 10);
    const count = Number(item && item.count);
    return day && Number.isFinite(count) ? { day, count } : null;
  }).filter(Boolean);
}

export function conversationWindow(series, now = new Date()) {
  const rows = seriesRows(series);
  if (!rows.length) return { today: null, week: null };
  const todayKey = utcKey(now);
  const week = new Set();
  for (let offset = 0; offset < 7; offset += 1) week.add(utcKey(now, offset));
  const todayRow = rows.find((row) => row.day === todayKey);
  const weekRows = rows.filter((row) => week.has(row.day));
  return {
    today: todayRow ? todayRow.count : null,
    week: weekRows.length ? weekRows.reduce((sum, row) => sum + row.count, 0) : null
  };
}

export function activityDays(series, now = new Date()) {
  const rows = new Map(seriesRows(series).map((row) => [row.day, row.count]));
  const days = [];
  for (let offset = 29; offset >= 0; offset -= 1) {
    const day = utcKey(now, offset);
    days.push({ day, count: rows.has(day) ? rows.get(day) : null });
  }
  return days;
}

function stageKey(stage) {
  return String(stage || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function funnelFromLeads(leads, bookedFallback = null) {
  const fallback = finiteCount(bookedFallback);
  if (!Array.isArray(leads)) {
    return { first: null, engaged: null, qualified: null, booked: fallback, vocabulary: false };
  }
  let first = 0;
  let engaged = 0;
  let qualified = 0;
  let booked = 0;
  let named = false;
  leads.forEach((lead) => {
    const key = stageKey(lead && lead.stage);
    const converted = lead && (lead.is_converted === true || BOOKED_STAGE.has(key));
    if (converted) {
      booked += 1;
      if (BOOKED_STAGE.has(key)) named = true;
      return;
    }
    if (QUALIFIED.has(key)) {
      qualified += 1;
      named = true;
    } else if (ENGAGED.has(key)) {
      engaged += 1;
      named = true;
    } else if (FIRST.has(key)) {
      first += 1;
      named = true;
    }
  });
  return {
    first: named ? first : null,
    engaged: named ? engaged : null,
    qualified: named ? qualified : null,
    booked: fallback != null ? fallback : booked,
    vocabulary: named
  };
}

function eventTime(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function activityEvents(leads, now = new Date()) {
  if (!Array.isArray(leads)) return [];
  const cutoff = now.getTime() - 3 * 86400000;
  const events = [];
  leads.forEach((lead) => {
    const name = String(lead && lead.lead_name || "").trim() || "Unnamed lead";
    if (lead && lead.joined_at) events.push({ kind: "new", name, at: lead.joined_at, label: "New lead" });
    if (lead && lead.is_converted === true) {
      events.push({ kind: "booked", name, at: lead.converted_at || null, label: "Booked" });
    }
    const then = eventTime(lead && lead.last_message_time);
    const warm = String(lead && lead.stage || "").trim().toLowerCase() === "warm";
    if (warm && lead && lead.is_converted !== true && then != null && then < cutoff) {
      events.push({ kind: "follow_up", name, at: lead.last_message_time, label: "Follow-up due" });
    }
  });
  events.sort((a, b) => {
    const at = eventTime(a.at);
    const bt = eventTime(b.at);
    if (at == null && bt == null) return 0;
    if (at == null) return 1;
    if (bt == null) return -1;
    return bt - at;
  });
  return events.slice(0, 8);
}

export function warmQuietCount(leads, now = new Date()) {
  if (!Array.isArray(leads)) return null;
  const cutoff = now.getTime() - 3 * 86400000;
  return leads.filter((lead) => {
    const then = eventTime(lead && lead.last_message_time);
    return String(lead && lead.stage || "").trim().toLowerCase() === "warm"
      && lead.is_converted !== true
      && then != null
      && then < cutoff;
  }).length;
}

export function healthScore(input) {
  const now = input.now || new Date();
  const statuses = Array.isArray(input.statuses) ? input.statuses : [];
  const roster = statuses.length || 0;
  const active = statuses.filter((status) => status === "active").length;
  const parts = [];
  if (roster) {
    parts.push({
      label: active + " of " + roster + " agents active",
      weight: 34,
      earned: Math.round((active / roster) * 34)
    });
  } else {
    parts.push({ label: "Agent status is not loaded", weight: 0, earned: 0, skipped: true });
  }
  if (input.syncErrorKnown) {
    const bad = Boolean(String(input.syncError || "").trim());
    parts.push({
      label: bad ? "Last sync reported an error" : "Last sync reported no error",
      weight: 33,
      earned: bad ? 0 : 33
    });
  } else {
    parts.push({ label: "Sync errors are not on this account yet", weight: 0, earned: 0, skipped: true });
  }
  const synced = eventTime(input.syncedAt);
  if (synced != null) {
    const hours = (now.getTime() - synced) / 36e5;
    let earned = 0;
    let label = "Last sync is older than 3 days";
    if (hours <= 6) {
      earned = 33;
      label = "Last sync is within 6 hours";
    } else if (hours <= 24) {
      earned = 22;
      label = "Last sync is within 24 hours";
    } else if (hours <= 72) {
      earned = 10;
      label = "Last sync is within 3 days";
    }
    parts.push({ label, weight: 33, earned });
  } else {
    parts.push({ label: "Sync time is not on this account yet", weight: 0, earned: 0, skipped: true });
  }
  const used = parts.filter((part) => !part.skipped);
  const weight = used.reduce((sum, part) => sum + part.weight, 0);
  const earned = used.reduce((sum, part) => sum + part.earned, 0);
  return {
    score: weight ? Math.round((earned / weight) * 100) : null,
    parts
  };
}
