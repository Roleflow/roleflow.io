export function nameKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function uniqueAgentMatch(agents, names) {
  const keys = names.map(nameKey).filter((key) => key.length > 0);
  if (!keys.length) return null;
  const hits = (agents || []).filter((agent) => {
    if (agent.client_id || agent.archived) return false;
    const agentKeys = [nameKey(agent.agent_name), nameKey(agent.label)].filter(Boolean);
    return agentKeys.some((key) => keys.includes(key));
  });
  return hits.length === 1 ? hits[0].id : null;
}

export function last7(series, now = new Date()) {
  const rows = Array.isArray(series) ? series : [];
  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
    const key = day.toISOString().slice(0, 10);
    const found = rows.find((item) => String(item.day || "").slice(0, 10) === key);
    const count = Number(found && found.count);
    days.push({ day: key, count: Number.isFinite(count) ? count : 0 });
  }
  return { days, total: days.reduce((sum, item) => sum + item.count, 0) };
}

export function createdAgo(iso, now = Date.now()) {
  if (!iso) return "Created date not recorded";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Created date not recorded";
  const seconds = Math.max(0, (now - then) / 1000);
  if (seconds < 3600) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    return "Created " + minutes + (minutes === 1 ? " minute ago" : " minutes ago");
  }
  if (seconds < 86400) {
    const hours = Math.max(1, Math.round(seconds / 3600));
    return "Created " + hours + (hours === 1 ? " hour ago" : " hours ago");
  }
  const days = Math.max(1, Math.round(seconds / 86400));
  return "Created " + days + (days === 1 ? " day ago" : " days ago");
}

export function stageChip(stage) {
  const key = String(stage || "").trim().toLowerCase();
  if (key === "hot" || key === "warm" || key === "cold") return key;
  return "other";
}

export function categoryTone(category) {
  const key = String(category || "").trim().toLowerCase();
  if (key === "sales" || key === "support") return key;
  return "other";
}

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function withinDays(iso, days, now = new Date()) {
  if (!days) return true;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return false;
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1));
  return then >= start;
}

export function windowSeries(series, days, now = new Date()) {
  const rows = Array.isArray(series) ? series : [];
  if (!days) {
    return rows
      .map((item) => {
        const count = Number(item && item.count);
        return { day: String(item && item.day || "").slice(0, 10), count: Number.isFinite(count) ? count : 0 };
      })
      .filter((item) => item.day)
      .sort((a, b) => a.day.localeCompare(b.day));
  }
  const out = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
    const key = day.toISOString().slice(0, 10);
    const found = rows.find((item) => String(item.day || "").slice(0, 10) === key);
    const count = Number(found && found.count);
    out.push({ day: key, count: Number.isFinite(count) ? count : 0 });
  }
  return out;
}

export function scrub(message) {
  return String(message || "").replace(/tailortalk|zerochats/ig, "the setter service");
}

const PROOF_PLACEHOLDER = {
  quote: "[TESTIMONIAL — Diego to fill in]",
  name: "[CLIENT NAME]",
  detail: "[ROLE OR RESULT — Diego to fill in]",
  portrait: "[PORTRAIT — Diego to fill in]",
  stars: "[STARS — Diego to fill in]",
  logos: ["[LOGO — Diego to fill in]", "[LOGO — Diego to fill in]", "[LOGO — Diego to fill in]"]
};

export const PROOF_SLOTS = [PROOF_PLACEHOLDER, PROOF_PLACEHOLDER, PROOF_PLACEHOLDER];

export function nextProof(index, length, direction) {
  const size = length || 1;
  return (index + (direction || 1) + size) % size;
}
