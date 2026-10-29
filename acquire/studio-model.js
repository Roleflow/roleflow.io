export const MAX_CHARS = 40000;
export const SETTER_SYNC = false;
export const PAGE_SIZE = 25;

export const CRM_STATES = [
  ["open", "Open"],
  ["discovering", "Discovering"],
  ["qualifying", "Qualifying"],
  ["proposal", "Proposal"],
  ["booked", "Booked"],
  ["paid", "Paid"],
  ["lost", "Lost"],
  ["unqualified", "Unqualified"],
  ["postponed", "Postponed"]
];

export const BRIEF_FIELDS = [
  ["sell", "What you sell"],
  ["credibility", "Credibility"],
  ["who", "Who you help"],
  ["pains", "Pains"],
  ["desires", "Desires"],
  ["beliefs", "False beliefs"],
  ["current", "Current situation"],
  ["transformed", "Transformed situation"],
  ["problem", "Problem solved"],
  ["offer", "Offer"],
  ["service", "Service description"],
  ["guarantee", "Guarantee"],
  ["benefits", "Benefits"],
  ["differentiation", "Differentiation"],
  ["mission", "Mission and values"],
  ["results", "Results and cases"],
  ["risks", "Risks and clarifications"]
];

export const CONTENT_TYPES = ["image", "audio", "video", "link", "button"];
export const PLACEMENTS = [
  ["before", "Before the messages"],
  ["after", "After the messages"],
  ["ai", "The AI decides"]
];
export const SCHEDULE_PROVIDERS = [
  ["calendly", "Calendly"],
  ["gohighlevel", "GoHighLevel"],
  ["custom", "Custom endpoints"]
];

const LIMITS = { image: 8 * 1024 * 1024, audio: 20 * 1024 * 1024, video: 50 * 1024 * 1024 };

export function emptyBrief() {
  return Object.fromEntries(BRIEF_FIELDS.map(([key]) => [key, ""]));
}

export function briefText(brief) {
  const source = brief || {};
  return BRIEF_FIELDS.map(([key]) => String(source[key] || "")).join("\n");
}

export function charCount(brief, cards) {
  const agents = (cards || []).map((card) => [card.name, card.instructions, ...(card.delegations || []).map((item) => item.when + item.to)].join("\n")).join("\n");
  return briefText(brief).length + agents.length;
}

export function versionDelta(current, previous) {
  if (!previous) return null;
  return Number(current.char_count || 0) - Number(previous.char_count || 0);
}

export function formatDelta(delta) {
  if (delta == null) return "First save";
  if (delta === 0) return "Same length";
  const size = Math.abs(delta).toLocaleString("en-US");
  return delta > 0 ? "+" + size + " characters" : "−" + size + " characters";
}

const ES_LABELS = {
  sell: "Qué vendes",
  credibility: "Credibilidad",
  who: "A quién ayudas",
  pains: "Dolores",
  desires: "Deseos",
  beliefs: "Creencias falsas",
  current: "Situación actual",
  transformed: "Situación transformada",
  problem: "Problema que resuelves",
  offer: "Oferta",
  service: "Descripción del servicio",
  guarantee: "Garantía",
  benefits: "Beneficios",
  differentiation: "Diferenciación",
  mission: "Misión y valores",
  results: "Resultados y casos",
  risks: "Riesgos y aclaraciones"
};

export function briefHeading(key, language) {
  const found = BRIEF_FIELDS.find((field) => field[0] === key);
  if (!found) return key;
  return language === "es" ? (ES_LABELS[key] || found[1]) : found[1];
}

export function briefDocument(brief, language) {
  const source = { ...emptyBrief(), ...(brief || {}) };
  return BRIEF_FIELDS.map(([key]) => "## " + briefHeading(key, language) + "\n" + String(source[key] || "")).join("\n\n");
}

export function parseBriefDocument(text) {
  const fields = emptyBrief();
  const headingToKey = new Map();
  BRIEF_FIELDS.forEach(([key, label]) => {
    headingToKey.set(label.toLowerCase(), key);
    const spanish = ES_LABELS[key];
    if (spanish) headingToKey.set(spanish.toLowerCase(), key);
  });
  String(text || "").split(/^## /m).forEach((part) => {
    const clean = part.trim();
    if (!clean) return;
    const breakAt = clean.indexOf("\n");
    const title = (breakAt === -1 ? clean : clean.slice(0, breakAt)).trim().toLowerCase();
    const body = breakAt === -1 ? "" : clean.slice(breakAt + 1).trim();
    const key = headingToKey.get(title);
    if (key) fields[key] = body;
  });
  return fields;
}

export function scoreBrief(brief) {
  const source = { ...emptyBrief(), ...(brief || {}) };
  const filled = BRIEF_FIELDS.filter(([key]) => String(source[key] || "").trim().length > 0);
  const required = ["sell", "who", "pains", "offer", "guarantee"];
  const missing = required.filter((key) => !String(source[key] || "").trim());
  let score = Math.min(6, filled.length * 0.4);
  if (!missing.length) score += 3;
  if (String(source.offer || "").trim().length >= 40) score += 1;
  score = Math.max(0, Math.min(10, Math.round(score)));
  const items = missing.map((key) => "Add " + labelFor(key).toLowerCase());
  BRIEF_FIELDS.forEach(([key, label]) => {
    if (!required.includes(key) && !String(source[key] || "").trim()) items.push("Consider " + label.toLowerCase());
  });
  return { score, items: items.slice(0, 8) };
}

function labelFor(key) {
  const found = BRIEF_FIELDS.find((field) => field[0] === key);
  return found ? found[1] : key;
}

export function stateFromLegacy(status, stage, converted) {
  const lead = String(status || "").toLowerCase();
  const step = String(stage || "").toLowerCase();
  if (converted || lead === "converted" || step === "closed") return "paid";
  if (step === "booked" || step === "showed") return "booked";
  if (lead === "hot" || step === "qualified") return "qualifying";
  if (lead === "warm" || step === "reply") return "discovering";
  if (lead === "dead" || step === "skipped") return "lost";
  if (CRM_STATES.some(([id]) => id === lead)) return lead;
  return "open";
}

export function contactLead(row) {
  const attributes = row.attributes || {};
  return {
    id: row.id,
    kind: "contact",
    name: row.name || "",
    handle: cleanHandle(row.ig_handle),
    contact: row.contact || "",
    state: row.crm_state || stateFromLegacy(row.lead_status, "", row.is_converted),
    agent: row.assigned_agent || "",
    tags: Array.isArray(row.tags) ? row.tags : [],
    ai: row.ai_enabled !== false,
    automated: row.automated !== false,
    verified: row.is_verified === true,
    followers: numberOrNull(row.follower_count),
    weFollow: row.we_follow === true,
    theyFollow: row.they_follow === true,
    messages: Number(row.message_count) || 0,
    unread: Number(row.unread_count) || 0,
    followups: Number(row.followups) || 0,
    lastMessageAt: row.last_message_at || null,
    updatedAt: row.updated_at || null,
    source: String(row.source || (row.ig_handle ? "instagram" : "")),
    targetId: row.target_id || "",
    salesLinkId: row.sales_link_id || null,
    bio: String(attributes.bio || row.bio || ""),
    report: String(attributes.summary || attributes.ai_report || "")
  };
}

export function targetLead(row) {
  return {
    id: row.id,
    kind: "target",
    name: "",
    handle: cleanHandle(row.handle),
    contact: "",
    state: row.crm_state || stateFromLegacy(row.lead_status, row.stage, false),
    agent: row.assigned_agent || "",
    tags: Array.isArray(row.tags) ? row.tags : [],
    ai: row.ai_enabled !== false,
    automated: true,
    verified: row.is_verified === true,
    followers: numberOrNull(row.follower_count),
    weFollow: row.we_follow === true,
    theyFollow: row.they_follow === true,
    messages: Number(row.message_count) || 0,
    unread: Number(row.unread_count) || 0,
    followups: Number(row.followups) || 0,
    lastMessageAt: row.updated_at || null,
    updatedAt: row.updated_at || null,
    source: String(row.source || ""),
    targetId: row.id,
    bio: String(row.bio || ""),
    report: row.score_summary || ""
  };
}

export function collectLeads(contacts, targets) {
  const linked = new Set((contacts || []).map((row) => row.target_id).filter(Boolean));
  return (contacts || []).map(contactLead).concat((targets || []).filter((row) => !linked.has(row.id)).map(targetLead));
}

export function filterLeads(leads, query) {
  const q = query || {};
  const text = String(q.q || "").trim().toLowerCase().replace(/^@/, "");
  return (leads || []).filter((lead) => {
    if (text && !(lead.name || "").toLowerCase().includes(text) && !(lead.handle || "").toLowerCase().includes(text)) return false;
    if (q.state && q.state !== "all" && lead.state !== q.state) return false;
    if (q.desk && q.desk !== "all") {
      const groups = { new: ["open", "discovering"], qualified: ["qualifying", "proposal"], booked: ["booked", "paid"], lost: ["lost", "unqualified"] };
      if (q.desk === "ai" && !lead.ai) return false;
      if (q.desk === "manual" && lead.ai) return false;
      if (groups[q.desk] && !groups[q.desk].includes(lead.state)) return false;
    }
    if (q.ai === "on" && !lead.ai) return false;
    if (q.ai === "off" && lead.ai) return false;
    if (q.unread === "yes" && !(Number(lead.unread) > 0)) return false;
    if (q.unread === "no" && Number(lead.unread) > 0) return false;
    if (q.agent && lead.agent !== q.agent) return false;
    if (q.tag && !(lead.tags || []).includes(q.tag)) return false;
    if (q.source && String(lead.source || "") !== q.source) return false;
    if (q.automated === "yes" && !lead.automated) return false;
    if (q.automated === "no" && lead.automated) return false;
    if (q.verified === "yes" && !lead.verified) return false;
    if (q.verified === "no" && lead.verified) return false;
    if (q.weFollow === "yes" && !lead.weFollow) return false;
    if (q.weFollow === "no" && lead.weFollow) return false;
    if (q.theyFollow === "yes" && !lead.theyFollow) return false;
    if (q.theyFollow === "no" && lead.theyFollow) return false;
    if (q.minFollowers && (lead.followers == null || lead.followers < Number(q.minFollowers))) return false;
    if (q.messageMin && lead.messages < Number(q.messageMin)) return false;
    if (q.lastFrom && (!lead.lastMessageAt || lead.lastMessageAt < q.lastFrom)) return false;
    if (q.lastTo && (!lead.lastMessageAt || lead.lastMessageAt > q.lastTo)) return false;
    return true;
  });
}

export function paginate(rows, page, size) {
  const pageSize = size || PAGE_SIZE;
  const total = (rows || []).length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  const start = (current - 1) * pageSize;
  return { rows: (rows || []).slice(start, start + pageSize), page: current, pages, total, start };
}

export function exportCsv(leads) {
  const header = ["name", "handle", "state", "agent", "tags", "ai", "messages", "followers", "last_message_at"];
  const lines = [header.join(",")];
  (leads || []).forEach((lead) => {
    lines.push([lead.name, lead.handle, lead.state, lead.agent, (lead.tags || []).join("|"), lead.ai ? "on" : "off", lead.messages, lead.followers == null ? "" : lead.followers, lead.lastMessageAt || ""].map(csvCell).join(","));
  });
  return lines.join("\n");
}

export function exportJson(leads) {
  return JSON.stringify(leads || [], null, 2);
}

function csvCell(value) {
  const text = String(value == null ? "" : value);
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function validateLink(input) {
  const name = String(input.name || "").trim();
  const url = String(input.url || "").trim();
  const errors = [];
  if (!name) errors.push("Name is required.");
  if (!/^https:\/\//i.test(url)) errors.push("URL must start with https://");
  const ticket = String(input.ticket || "").trim();
  let cents = null;
  if (ticket) {
    const amount = Number(ticket);
    if (!Number.isFinite(amount) || amount < 0) errors.push("Average ticket must be a number.");
    else cents = Math.round(amount * 100);
  }
  if (input.sendAsButton && String(input.buttonLabel || "").trim().length > 20) errors.push("Button label is 20 characters at most.");
  return { ok: !errors.length, errors, cents };
}

export function validateAsset(input) {
  const type = input.type;
  const errors = [];
  if (!CONTENT_TYPES.includes(type)) errors.push("Choose a content type.");
  if (!["before", "after", "ai"].includes(input.placement)) errors.push("Choose when it is sent.");
  if ((type === "link" || type === "button") && !/^https:\/\//i.test(String(input.url || ""))) errors.push("URL must start with https://");
  if (type === "button" && String(input.label || "").trim().length > 20) errors.push("Button label is 20 characters at most.");
  if (input.file && LIMITS[type] && input.file.size > LIMITS[type]) errors.push("File is over the " + Math.round(LIMITS[type] / (1024 * 1024)) + " MB limit for " + type + ".");
  if ((type === "image" || type === "audio" || type === "video") && !input.file && !input.storagePath) errors.push("Upload a file.");
  return { ok: !errors.length, errors };
}

export function validateSchedule(input) {
  const errors = [];
  if (!SCHEDULE_PROVIDERS.some(([id]) => id === input.provider)) errors.push("Choose a scheduler.");
  ["availability_url", "booking_url"].forEach((key) => {
    const value = String(input[key] || "").trim();
    if (value && !/^https:\/\//i.test(value)) errors.push("URLs must start with https://");
  });
  if (!String(input.availability_url || "").trim() && !String(input.booking_url || "").trim()) errors.push("Add an availability URL or a booking URL.");
  return { ok: !errors.length, errors };
}

export function paidFromLinks(leads, links) {
  const byId = new Map((links || []).map((link) => [link.id, Number(link.average_ticket_cents) || 0]));
  return (leads || []).filter((lead) => lead.state === "paid" && lead.salesLinkId && byId.has(lead.salesLinkId)).reduce((sum, lead) => sum + byId.get(lead.salesLinkId), 0);
}

function cleanHandle(value) {
  return String(value || "").replace(/^@/, "").trim();
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
