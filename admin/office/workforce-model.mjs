// Turns TailorTalk and HQ rows into one office view.
// Counts come only from the rows passed in. No task row, no moving token.

import { layoutOffice, routeSummary } from "./workforce-config.mjs";

export const VAM_BUSINESS_ID = "463e2794-cb8f-462e-9325-95a7cb1da65c";
const IDLE = "Idle. No tasks yet.";
const NOT_SET_UP = "Not set up";
const CLOSED = new Set(["done", "cancelled"]);
const STALE_MS = 36 * 60 * 60 * 1000;

export function businessName(row) {
  const name = String((row && (row.agent_name || row.label)) || "").trim();
  return name || "Business";
}

export function pickDefaultBusiness(rows) {
  const open = (rows || []).filter((row) => row && row.id && !row.archived);
  const vam = open.find((row) => row.id === VAM_BUSINESS_ID)
    || open.find((row) => businessName(row).toLowerCase() === "vam");
  if (vam) return vam;
  return open.slice().sort((a, b) => businessName(a).localeCompare(businessName(b)))[0] || null;
}

export function madridStamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

function stamp(value) {
  const n = new Date(value || 0).getTime();
  return Number.isNaN(n) ? 0 : n;
}

function timed(value, now, freshNoun) {
  const label = madridStamp(value);
  if (!label) return "";
  const age = (now instanceof Date ? now.getTime() : stamp(now)) - stamp(value);
  if (!stamp(value) || age > STALE_MS) return "Last activity " + label + " Madrid";
  return (freshNoun || "Updated") + " " + label + " Madrid";
}

function workforceStatus(rows, role) {
  if (!role) return "";
  const row = (rows || []).find((item) => item && item.role === role);
  if (!row || row.status === "not_set_up") return NOT_SET_UP;
  if (row.status === "paused") return "Paused";
  if (row.status === "active") return "Active";
  return NOT_SET_UP;
}

function stationFor(config, task) {
  const key = String((task && task.station) || "");
  if (!key) return "";
  if ((config.overseer.taskStations || []).includes(key)) return config.overseer.id;
  const hit = (config.stations || []).find((station) => (station.taskStations || []).includes(key));
  return hit ? hit.id : "";
}

function openTasks(tasks, businessId) {
  return (tasks || []).filter((task) => (
    task &&
    task.id &&
    task.title &&
    task.business_id === businessId &&
    !CLOSED.has(task.status)
  ));
}

function inboundEdge(config, stationId) {
  const inbound = (config.edges || []).filter((edge) => edge.to === stationId);
  return inbound.find((edge) => edge.kind === "handoff")
    || inbound.find((edge) => edge.kind === "assign")
    || inbound[0]
    || null;
}

export function motionFor(config, tasks, activity, businessId) {
  const open = openTasks(tasks, businessId);
  const known = new Set(open.map((task) => task.id));
  const liveIds = new Set(open.map((task) => task.id));
  (activity || []).forEach((row) => {
    if (!row || !row.task_id || !known.has(row.task_id)) return;
    liveIds.add(row.task_id);
  });
  const edges = [];
  const seen = new Set();
  open.forEach((task) => {
    if (!liveIds.has(task.id)) return;
    const stationId = stationFor(config, task);
    const edge = stationId ? inboundEdge(config, stationId) : null;
    if (!edge) return;
    const key = edge.from + ">" + edge.to;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(Object.assign({}, edge));
  });
  return edges;
}

function leadList(leads, businessId) {
  return (leads || []).filter((lead) => !lead || lead.agent_id == null || lead.agent_id === businessId);
}

function countStatus(leads) {
  const counts = new Map();
  leads.forEach((lead) => {
    const key = String((lead && lead.lead_status) || "").trim();
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function latest(leads, field) {
  let best = "";
  leads.forEach((lead) => {
    const value = lead && lead[field];
    if (stamp(value) > stamp(best)) best = value;
  });
  return best;
}

function sectionCount(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return 0;
}

function joinParts(parts) {
  return parts.filter(Boolean).join(" · ");
}

function desk(parts) {
  const detail = joinParts(parts);
  return {
    short: detail.length > 72 ? detail.slice(0, 71).trimEnd() + "…" : detail,
    detail: detail || IDLE
  };
}

function metricBlock(station, input) {
  const { leads, stats, workforce, now, leadError, statsError, workError } = input;
  const metric = station.metric || "none";
  const setup = workforceStatus(workError ? [] : workforce, station.workforceRole);
  if (metric === "instagram_dm") {
    if (leadError) return desk(["Instagram DMs could not be read.", setup, IDLE]);
    const dms = leads.filter((lead) => lead && lead.source === "instagram_dm");
    const statuses = countStatus(dms).map(([name, count]) => count + " " + name);
    const when = timed(latest(dms, "last_message_time"), now, "Updated");
    return desk([
      dms.length + " Instagram DMs",
      statuses.join(", "),
      setup,
      IDLE,
      when
    ]);
  }
  if (metric === "followups") {
    if (leadError) return desk(["Follow-ups could not be read.", setup, IDLE]);
    const followed = leads.filter((lead) => Number(lead && lead.total_followups) > 0);
    const when = timed(latest(followed, "last_message_time"), now, "Updated");
    return desk([
      followed.length + " leads with follow-ups",
      setup,
      IDLE,
      when
    ]);
  }
  if (metric === "comments_inbound") {
    const note = leadError ? "Comment leads could not be read." : "";
    const comments = leadError ? [] : leads.filter((lead) => lead && lead.source === "instagram_comments");
    const inbound = comments.length
      ? comments.length + " inbound comment leads, not target commenting"
      : "";
    return desk([IDLE, inbound, note]);
  }
  if (metric === "stats") {
    if (statsError) return desk(["Stats could not be read.", IDLE]);
    if (!stats) return desk(["No stats yet.", IDLE]);
    const rate = stats.conversion_rate == null || stats.conversion_rate === "" ? "" : "conversion rate " + stats.conversion_rate;
    const convertedLeads = leads.filter((lead) => lead && (lead.is_converted || String(lead.lead_status || "").toLowerCase() === "converted")).length;
    const picked = (stats.converted_count == null ? 0 : stats.converted_count) + " converted";
    const source = "From tailortalk_agent_stats";
    const when = timed(stats.computed_at, now, "Computed");
    const mismatch = Number(stats.converted_count) !== convertedLeads
      ? "lead_status converted is " + convertedLeads + " in tailortalk_leads; this number is converted_count from tailortalk_agent_stats."
      : "";
    return desk([
      (stats.total_leads == null ? 0 : stats.total_leads) + " leads",
      picked,
      rate,
      source,
      when,
      mismatch,
      IDLE
    ]);
  }
  if (metric === "workforce") {
    if (workError) return desk(["Workforce status could not be read.", IDLE]);
    return desk([setup || NOT_SET_UP, IDLE]);
  }
  return desk([setup, IDLE]);
}

function withTasks(base, stationId, tasks, config) {
  const mine = tasks.filter((task) => stationFor(config, task) === stationId);
  const unplaced = stationId === config.overseer.id
    ? tasks.filter((task) => !stationFor(config, task))
    : [];
  const shown = mine.concat(unplaced);
  if (!shown.length) return Object.assign({}, base, { tasks: [] });
  const kept = String(base.detail || "").split(" · ").filter((part) => part && part !== IDLE);
  const titles = shown.map((task) => task.title).join(", ");
  const detail = joinParts(kept.concat([titles, shown.length + (shown.length === 1 ? " open task" : " open tasks")]));
  return {
    short: detail.length > 72 ? detail.slice(0, 71).trimEnd() + "…" : detail,
    detail,
    tasks: shown
  };
}

export function mapWorkforce({ business, leads, stats, workforce, tasks, activity, config, now, errors } = {}) {
  const clock = now instanceof Date ? now : new Date();
  const businessId = business && business.id;
  const problem = errors || {};
  const rows = leadList(leads, businessId);
  const liveTasks = openTasks(tasks, businessId);
  const input = {
    leads: rows,
    stats: stats || null,
    workforce: workforce || [],
    now: clock,
    leadError: Boolean(problem.leads),
    statsError: Boolean(problem.stats),
    workError: Boolean(problem.workforce)
  };
  const brainSections = sectionCount(business && business.prompt_sections);
  const version = String((business && business.prompt_version_id) || "").trim();
  const brainWhen = timed(business && business.prompt_updated_at, clock, "Updated");
  const brain = desk(version
    ? ["Version " + version, brainSections ? brainSections + " prompt sections" : "", brainWhen]
    : ["No prompt version yet."]);
  const overseerBase = desk([IDLE]);
  const overseer = withTasks(overseerBase, config.overseer.id, liveTasks, config);
  const stations = (config.stations || []).map((station) => {
    const base = metricBlock(station, input);
    const placed = withTasks(base, station.id, liveTasks, config);
    return Object.assign({}, station, placed, {
      idle: placed.tasks.length === 0
    });
  });
  const motions = motionFor(config, tasks, activity, businessId);
  const cards = [];
  liveTasks.forEach((task) => {
    const spot = stationFor(config, task);
    if (!spot) return;
    cards.push({
      id: task.id,
      title: task.title,
      spot,
      glow: task.status === "needs_diego"
    });
  });
  return {
    businessId: businessId || "",
    businessName: businessName(business),
    layout: layoutOffice(config),
    config,
    brain: Object.assign({}, config.brandBrain, brain),
    overseer: Object.assign({}, config.overseer, overseer, { idle: overseer.tasks.length === 0 }),
    stations,
    edges: (config.edges || []).map((edge) => Object.assign({}, edge)),
    motions,
    cards,
    routes: routeSummary(config)
  };
}

function previewId(n) {
  return "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
}

function previewLeads() {
  const leads = [];
  for (let index = 0; index < 159; index += 1) {
    const converted = index < 2;
    leads.push({
      agent_id: VAM_BUSINESS_ID,
      source: "instagram_dm",
      lead_status: converted ? "converted" : "",
      is_converted: converted,
      total_followups: index < 87 ? 1 : 0,
      last_message_time: index === 0 ? "2026-09-29T20:14:00.000Z" : "2026-09-20T10:00:00.000Z",
      category: ""
    });
  }
  for (let index = 0; index < 16; index += 1) {
    leads.push({
      agent_id: VAM_BUSINESS_ID,
      source: "instagram_comments",
      lead_status: "",
      is_converted: false,
      total_followups: 0,
      last_message_time: "2026-09-01T10:00:00.000Z",
      category: ""
    });
  }
  return leads;
}

export function workforcePreviewFixture() {
  const businesses = [
    {
      id: VAM_BUSINESS_ID,
      label: "VAM",
      agent_name: "VAM",
      archived: false,
      client_id: previewId(9),
      profile_id: previewId(9),
      prompt_sections: ["voice", "offer"],
      prompt_version_id: "fixture-v1",
      prompt_updated_at: "2026-10-01T10:00:00.000Z",
      last_synced_at: "2026-10-19T08:00:00.000Z",
      last_activity_at: "2026-09-29T20:14:00.000Z"
    },
    { id: previewId(2), label: "Chad Owens", agent_name: "Chad Owens", archived: false, prompt_sections: [], prompt_version_id: "", prompt_updated_at: null },
    { id: previewId(3), label: "Thomas Miller", agent_name: "Thomas Miller", archived: false, prompt_sections: [], prompt_version_id: "", prompt_updated_at: null },
    { id: previewId(4), label: "Caleb Wat", agent_name: "Caleb Wat", archived: false, prompt_sections: [], prompt_version_id: "", prompt_updated_at: null },
    { id: previewId(5), label: "Dorian", agent_name: "Dorian", archived: false, prompt_sections: [], prompt_version_id: "", prompt_updated_at: null }
  ];
  return {
    agents: [],
    tasks: [],
    comments: [],
    schedules: [],
    activity: [],
    keys: [],
    businesses,
    leads: previewLeads(),
    stats: [{
      agent_id: VAM_BUSINESS_ID,
      total_leads: 175,
      converted_count: 1,
      conversion_rate: 0.0057,
      by_status: {},
      by_source: {},
      by_category: {},
      computed_at: "2026-10-19T08:00:00.000Z",
      last_activity_at: "2026-09-29T20:14:00.000Z"
    }],
    workforce: [{
      agent_id: VAM_BUSINESS_ID,
      role: "outreach",
      status: "not_set_up",
      updated_at: "2026-10-19T08:00:00.000Z"
    }]
  };
}
