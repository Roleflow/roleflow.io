// Pure helpers for the client AI setter. No provider names in this file.

export const SETTER_SECTIONS = [
  { id: "high_priority_rule", title: "HIGH PRIORITY RULE" },
  { id: "identity", title: "IDENTITY & MISSION" },
  { id: "nonnegotiables", title: "NON-NEGOTIABLES" },
  { id: "style", title: "STYLE, FORMATTING & TONE" },
  { id: "context", title: "CONTEXT & OUTREACH" },
  { id: "qualification", title: "QUALIFICATION LOGIC" },
  { id: "links", title: "LINK ASSETS" },
  { id: "workflow", title: "WORKFLOW LOGIC" },
  { id: "objections", title: "OBJECTION HANDLING" }
];

const MATCHERS = [
  ["high_priority_rule", /high\w*[\s_-]*priority/],
  ["nonnegotiables", /non[-_\s]?negotiable|guardrail/],
  ["qualification", /qualif/],
  ["objections", /objection/],
  ["workflow", /workflow|conversation[\s_-]*(flow|logic)|follow[\s_-]*up|route[\s_-]*template|verification|comment response/],
  ["identity", /identity|mission|persona|\brole\b/],
  ["style", /style|format|\btone\b/],
  ["context", /context|outreach|knowledge/],
  ["links", /\blinks?\b|assets/]
];

export function setterStatus(status) {
  return String(status || "").toLowerCase() === "paused" ? "Paused" : "Active";
}

export function isQualified(lead) {
  const stage = String(lead?.stage || lead?.lead_status || "").trim().toLowerCase();
  return stage === "hot" || stage === "qualified";
}

export function isBooked(lead) {
  return lead?.is_converted === true;
}

export function leadTitle(lead) {
  const name = String(lead?.lead_name || "").trim();
  const username = String(lead?.username || "").trim().replace(/^@+/, "");
  if (name && username) return name + " (@" + username + ")";
  if (username) return "@" + username;
  return name || "Unknown";
}

function asObject(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value : {};
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function setterFigures(row) {
  const total = num(row?.total_leads);
  const categories = asObject(row?.by_category);
  const counted = Object.values(categories).reduce((sum, count) => sum + num(count), 0);
  return {
    conversations: total,
    leads: counted > 0 ? num(categories.sales) : total,
    booked: num(row?.converted_count),
    rate: row?.conversion_rate == null || row?.conversion_rate === "" ? null : row.conversion_rate,
    byStatus: asObject(row?.by_status),
    bySource: asObject(row?.by_source),
    last: row?.last_activity_at || null,
    perDay: asSeries(row?.leads_per_day)
  };
}

function asSeries(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseSections(raw) {
  if (!raw) return [];
  let value = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (Array.isArray(value)) {
    return value.map((item) => ({
      node: String(item?.node || item?.title || item?.id || "").trim(),
      instruction: String(item?.instruction ?? item?.text ?? "").trim()
    })).filter((item) => item.node || item.instruction);
  }
  if (typeof value === "object") {
    return SETTER_SECTIONS.map((section) => ({
      node: section.id,
      instruction: value[section.id] == null ? "" : String(value[section.id]).trim()
    })).filter((item) => item.instruction);
  }
  return [];
}

function matchId(node) {
  const text = String(node || "").replace(/^#+\s*/, "").trim();
  if (!text) return "";
  const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (SETTER_SECTIONS.some((section) => section.id === id)) return id;
  const hit = MATCHERS.find(([, pattern]) => pattern.test(text.toLowerCase()));
  return hit ? hit[0] : "";
}

function addText(slot, item, showNode) {
  const body = String(item.instruction || "").trim();
  if (!body) return;
  const block = showNode && item.node ? item.node + "\n" + body : body;
  slot.text = slot.text ? slot.text + "\n\n" + block : block;
}

export function liveSections(raw) {
  const slots = SETTER_SECTIONS.map((section) => ({ id: section.id, title: section.title, text: "" }));
  const items = parseSections(raw);
  const unmatched = [];
  items.forEach((item) => {
    const id = matchId(item.node);
    const slot = slots.find((entry) => entry.id === id);
    if (!slot) {
      unmatched.push(item);
      return;
    }
    addText(slot, item, Boolean(slot.text));
  });
  if (items.length && slots.every((slot) => !slot.text)) {
    items.forEach((item, index) => {
      const slot = slots[Math.min(index, slots.length - 1)];
      addText(slot, item, index >= slots.length);
    });
    return slots;
  }
  unmatched.forEach((item) => addText(slots[slots.length - 1], item, true));
  return slots;
}
