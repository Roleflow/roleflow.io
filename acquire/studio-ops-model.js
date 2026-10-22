export const QUESTIONS = [
  { id: "reply", q: "When does the AI answer?" },
  { id: "who", q: "Who does it answer?" },
  { id: "stop", q: "When does it stop?" },
  { id: "write", q: "How does it write?" },
  { id: "file", q: "How is the lead filed?" },
  { id: "notify", q: "Who do we notify?" },
  { id: "connect", q: "Integrations" },
  { id: "business", q: "Business" }
];

export const CRM_STATES = ["Open", "Discovering", "Qualifying", "Proposal", "Booked", "Paid", "Lost", "Unqualified", "Postponed"];
export const OFFICE_MODES = ["always", "same", "per_day"];
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const WEBHOOK_EVENTS = ["lead.created", "tagged", "state_changed", "media_replied", "note_added"];
export const SCOPES = [
  { id: "conversations", label: "Conversations" },
  { id: "configuration", label: "Configuration" },
  { id: "analysis", label: "Analysis" }
];
export const BUILTIN_ORIGINS = ["story", "post", "reel", "ad"];
export const REPLY_BUCKETS = [
  { id: "under_1m", label: "Under 1 minute", max: 60 },
  { id: "1_to_5", label: "1 to 5 minutes", max: 300 },
  { id: "5_to_30", label: "5 to 30 minutes", max: 1800 },
  { id: "30_to_2h", label: "30 minutes to 2 hours", max: 7200 },
  { id: "over_2h", label: "Over 2 hours", max: Infinity }
];

const OUTBOUND = new Set(["competitor_followers", "keyword", "hashtag", "manual"]);
const INBOUND = new Set(["instagram", "comment"]);

export function officeError(mode) {
  if (!OFFICE_MODES.includes(mode)) return "Choose 24 hours, the same hours every day, or hours per day.";
  return "";
}

export function delayError(min, max) {
  const lo = Number(min);
  const hi = Number(max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return "Enter a delay range in seconds.";
  if (lo < 0 || hi > 300 || lo > hi) return "The delay stays between 0 and 300 seconds, with the low end first.";
  return "";
}

export function webhookError(url, events) {
  let parsed;
  try { parsed = new URL(String(url || "")); } catch { return "Enter an https URL."; }
  if (parsed.protocol !== "https:") return "The webhook URL has to be https.";
  const list = (events || []).filter((item) => WEBHOOK_EVENTS.includes(item));
  if (!list.length) return "Choose at least one event.";
  return "";
}

export function tagError(row) {
  const name = String(row.name || "").trim();
  if (!name || name.length > 40) return "Name the tag in 40 characters or fewer.";
  if (!["ai", "text", "attachment"].includes(row.rule_kind)) return "Choose a rule: AI, text, or attachment.";
  if (row.notify_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(row.notify_email))) return "The notify address is not an email.";
  return "";
}

export function scopeError(scopes) {
  const list = (scopes || []).filter((item) => SCOPES.some((scope) => scope.id === item));
  if (!list.length) return "Choose at least one permission.";
  return "";
}

export function within(iso, days, now = Date.now()) {
  if (!days) return true;
  const time = Date.parse(iso || "");
  if (!Number.isFinite(time)) return false;
  return now - time <= days * 86400000;
}

export function inRange(rows, days, field, now) {
  return (rows || []).filter((row) => within(row[field || "created_at"], days, now));
}

export function conversationsPerDay(rows, days, now = Date.now()) {
  const out = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(now - offset * 86400000);
    const key = day.toISOString().slice(0, 10);
    out.push({ day: key, count: (rows || []).filter((row) => String(row.at || "").slice(0, 10) === key).length });
  }
  return out;
}

function isPaid(lead) {
  const state = String(lead.crm_state || lead.state || "").toLowerCase();
  return state === "paid" || lead.lead_status === "converted" || lead.is_converted === true;
}

export function agentPerformance(leads) {
  const map = new Map();
  (leads || []).forEach((lead) => {
    const name = lead.assigned_agent || lead.agent || "Unassigned";
    const row = map.get(name) || { agent: name, leads: 0, paid: 0 };
    row.leads += 1;
    if (isPaid(lead)) row.paid += 1;
    map.set(name, row);
  });
  return [...map.values()].sort((a, b) => b.leads - a.leads);
}

export function tagConversion(leads) {
  const map = new Map();
  (leads || []).forEach((lead) => {
    const tags = Array.isArray(lead.tags) ? lead.tags : [];
    tags.forEach((tag) => {
      const row = map.get(tag) || { tag, leads: 0, paid: 0 };
      row.leads += 1;
      if (isPaid(lead)) row.paid += 1;
      map.set(tag, row);
    });
  });
  return [...map.values()].map((row) => ({ ...row, rate: row.leads ? row.paid / row.leads : null }));
}

export function linkConversions(leads, links) {
  return (links || []).map((link) => {
    const rows = (leads || []).filter((lead) => (lead.sales_link_id || lead.salesLinkId) === link.id);
    const paid = rows.filter((lead) => isPaid(lead)).length;
    return { id: link.id, name: link.name || "Link", leads: rows.length, paid, rate: rows.length ? paid / rows.length : null };
  });
}

export function funnel(targets, mode) {
  const rows = (targets || []).filter((row) => {
    if (mode === "outbound") return OUTBOUND.has(row.source);
    if (mode === "inbound") return INBOUND.has(row.source);
    return true;
  });
  const stages = ["target", "warmup", "outreach", "reply", "qualified", "booked", "closed"];
  return stages.map((stage) => ({ stage, count: rows.filter((row) => row.stage === stage || row.peak_stage === stage).length }));
}

export function followupRate(targets) {
  const sent = (targets || []).filter((row) => Number(row.followups) > 0);
  if (!sent.length) return null;
  const replied = sent.filter((row) => ["reply", "qualified", "booked", "showed", "closed"].includes(row.stage)).length;
  return replied / sent.length;
}

export function replyBuckets(messages) {
  const counts = Object.fromEntries(REPLY_BUCKETS.map((bucket) => [bucket.id, 0]));
  const byThread = new Map();
  (messages || []).forEach((row) => {
    const key = row.conversation_id || row.thread_id || "none";
    const list = byThread.get(key) || [];
    list.push(row);
    byThread.set(key, list);
  });
  let pairs = 0;
  byThread.forEach((list) => {
    const ordered = list.slice().sort((a, b) => Date.parse(a.created_at || a.sent_at || 0) - Date.parse(b.created_at || b.sent_at || 0));
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const role = ordered[i].role || ordered[i].direction;
      const next = ordered[i + 1].role || ordered[i + 1].direction;
      if ((role === "user" || role === "inbound") && (next === "assistant" || next === "outbound")) {
        const seconds = (Date.parse(ordered[i + 1].created_at || ordered[i + 1].sent_at) - Date.parse(ordered[i].created_at || ordered[i].sent_at)) / 1000;
        const bucket = REPLY_BUCKETS.find((item) => seconds <= item.max);
        if (bucket && Number.isFinite(seconds) && seconds >= 0) {
          counts[bucket.id] += 1;
          pairs += 1;
        }
      }
    }
  });
  return { pairs, counts };
}

export function heatmaps(stamps) {
  const weekday = Array(7).fill(0);
  const hour = Array(24).fill(0);
  (stamps || []).forEach((iso) => {
    const time = new Date(iso);
    if (Number.isNaN(time.getTime())) return;
    weekday[time.getUTCDay()] += 1;
    hour[time.getUTCHours()] += 1;
  });
  return { weekday, hour };
}

export function originOf(row, customs) {
  const text = [row.source_detail, row.source, row.first_message, row.body].filter(Boolean).join(" ").toLowerCase();
  for (const custom of customs || []) {
    const keyword = String(custom.keyword || "").trim().toLowerCase();
    if (keyword && text.includes(keyword)) return custom.name || keyword;
  }
  for (const name of BUILTIN_ORIGINS) {
    if (text.includes(name)) return name;
  }
  return "";
}

export function originBreakdown(rows, customs) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const name = originOf(row, customs);
    if (!name) return;
    const item = map.get(name) || { origin: name, leads: 0, paid: 0 };
    item.leads += 1;
    if (isPaid(row)) item.paid += 1;
    map.set(name, item);
  });
  return [...map.values()].sort((a, b) => b.leads - a.leads);
}

export function topOrigins(rows, limit = 10) {
  return rows.slice(0, limit);
}

export function projectRevenue(ticketCents, dealsPerMonth) {
  const ticket = Math.max(0, Number(ticketCents) || 0);
  const deals = Math.max(0, Number(dealsPerMonth) || 0);
  const year = Math.round(ticket * deals * 12);
  return { yearCents: year, shareCents: Math.round(year * 0.1), monthlyCents: Math.round(ticket * deals) };
}

export function checklist(snapshot) {
  const settings = snapshot.settings || {};
  return [
    { id: "brief", label: "Save the business brief", done: Boolean(snapshot.brief && snapshot.brief.fields), tab: "brief" },
    { id: "agent", label: "Write instructions for an agent", done: (snapshot.agentCards || []).length > 0, tab: "brief" },
    { id: "link", label: "Add a sales link", done: (snapshot.offerLinks || []).length > 0, tab: "links" },
    { id: "content", label: "Add value content", done: (snapshot.valueAssets || []).length > 0 || (snapshot.voices || []).length > 0, tab: "content" },
    { id: "hours", label: "Choose when the AI answers", done: Boolean(settings.office_mode), tab: "configuration", key: "reply" },
    { id: "instagram", label: "Connect Instagram", done: Boolean(snapshot.ig && snapshot.ig.username), tab: "configuration", key: "connect" }
  ];
}

export function nextStep(items) {
  return (items || []).find((item) => !item.done) || null;
}

export function commandItems() {
  const screens = [
    ["Dashboard", "dashboard"],
    ["Business", "brief"],
    ["Sales links", "links"],
    ["Value content", "content"],
    ["Outbound Manager", "outbound"],
    ["Inbound Manager", "inbound"],
    ["CRM", "pipeline"],
    ["Follow-ups", "followups"],
    ["Reminders", "reminders"],
    ["Calls to action", "ctas"],
    ["Chats", "chats"],
    ["Stats", "stats"],
    ["Performance", "performance"],
    ["Team", "team"]
  ].map(([label, tab]) => ({ label, tab, hint: "Screen" }));
  const settings = QUESTIONS.map((item) => ({
    label: item.q,
    tab: "configuration",
    key: item.id,
    highlight: "cfg-" + item.id,
    hint: "Setting"
  }));
  return screens.concat(settings);
}

export function filterCommands(items, query) {
  const text = String(query || "").trim().toLowerCase();
  if (!text) return items;
  return items.filter((item) => item.label.toLowerCase().includes(text) || item.hint.toLowerCase().includes(text));
}

export function proposalOf(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.type === "lead") {
    const handle = String(payload.handle || "").replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(handle)) return null;
    if (!CRM_STATES.includes(payload.crm_state)) return null;
    return { type: "lead", handle, crm_state: payload.crm_state };
  }
  if (payload.type === "setting" && payload.patch && typeof payload.patch === "object") {
    const allowed = ["system_enabled", "office_mode", "timezone", "reply_delay_seconds", "reply_delay_max_seconds", "keyword_only", "skip_followed", "strip_inverted_punct", "disclosure_enabled", "disclosure_text"];
    const patch = {};
    allowed.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(payload.patch, key)) patch[key] = payload.patch[key];
    });
    if (!Object.keys(patch).length) return null;
    if (patch.office_mode && officeError(patch.office_mode)) return null;
    return { type: "setting", patch };
  }
  return null;
}

export function originCsv(rows) {
  const lines = ["Origin,Leads,Paid"];
  rows.forEach((row) => lines.push([row.origin, row.leads, row.paid].join(",")));
  return lines.join("\n");
}

export function snippet(param, target, endpoint) {
  const key = String(param || "lead").replace(/[^a-z0-9_]/gi, "") || "lead";
  const state = target === "Paid" ? "Paid" : "Booked";
  const url = endpoint || "YOUR_CONVERT_URL";
  return [
    "<!-- Roleflow conversion. Links should include ?" + key + "=LEAD_ID. A visit moves that lead to " + state + ". -->",
    "<script>",
    "(function () {",
    "  var params = new URLSearchParams(location.search);",
    "  var lead = params.get('" + key + "');",
    "  if (!lead) return;",
    "  fetch('" + url + "', {",
    "    method: 'POST',",
    "    headers: { 'content-type': 'application/json', authorization: 'Bearer YOUR_WORKSPACE_KEY' },",
    "    body: JSON.stringify({ lead: lead, state: '" + state + "' })",
    "  });",
    "})();",
    "</script>"
  ].join("\n");
}
