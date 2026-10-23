// Pure planning for per-agent prompts, routines, and runs.
// This module does not call a model and does not message a lead.

export const AGENT_ROLES = [
  "icp_acquisition",
  "engagement_warmup",
  "personalised_outreach",
  "outbound_manager",
  "comment_to_dm",
  "qualification",
  "conversation_recovery",
  "appointment_booking",
  "inbound_manager"
];

export const REASONING_TYPES = ["research", "draft", "crm_update", "score"];
export const BROWSER_TYPES = ["instagram_dm", "follow", "comment"];
export const ACTION_TYPES = REASONING_TYPES.concat(BROWSER_TYPES);

const CRM_STATES = ["open", "discovering", "qualifying", "proposal", "booked", "paid", "lost", "unqualified", "postponed"];
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const TYPE_ALIAS = {
  research: "research",
  draft: "draft",
  drafting: "draft",
  crm_update: "crm_update",
  crm: "crm_update",
  score: "score",
  scoring: "score",
  instagram_dm: "instagram_dm",
  dm: "instagram_dm",
  follow: "follow",
  comment: "comment"
};

const RUNNER_SYSTEM = [
  "You are the Roleflow workforce runner.",
  "Return JSON only, with shape {\"summary\": string, \"actions\": [{\"type\": string, \"target\": string, \"payload\": object}]}.",
  "Allowed types are research, draft, crm_update, score, instagram_dm, follow, and comment.",
  "Do not send a message, follow an account, or post a comment. instagram_dm, follow, and comment are proposals for a separate browser worker.",
  "A draft stays in payload.draft. A crm_update may set crm_state, tags, assigned_agent, icp_score, qual_score, or note.",
  "Do not invent people, revenue, or a guarantee."
].join(" ");

export function agentRole(spec, kind) {
  if (!spec) return "";
  if (spec.kind === "manager" || spec.key === "manager") return kind === "inbound" ? "inbound_manager" : "outbound_manager";
  return AGENT_ROLES.includes(spec.key) ? spec.key : "";
}

export function scorePrompt(text) {
  const body = String(text || "").trim();
  if (!body) {
    return { score: 0, items: ["Write what this agent does", "Name the daily work", "Say what it must not do"] };
  }
  let score = 2;
  const items = [];
  if (body.length >= 80) score += 3;
  else items.push("Say more about the job");
  if (/\d|every|daily/i.test(body)) score += 2;
  else items.push("Name the daily work");
  if (/do not|don't|never|only|must not/i.test(body)) score += 2;
  else items.push("Say what it must not do");
  if (body.length >= 240) score += 1;
  return { score: Math.max(0, Math.min(10, score)), items: items.slice(0, 8) };
}

export function livePrompt(rows, role) {
  const versions = (rows || []).filter((row) => row.agent_role === role);
  versions.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  return versions[0] || null;
}

export function validZone(zone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    return true;
  } catch (_error) {
    return false;
  }
}

export function validCron(expr) {
  const fields = String(expr || "").trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  return fields.every((field, index) => fieldOk(field, ranges[index][0], ranges[index][1]));
}

function fieldOk(field, min, max) {
  return field.split(",").every((part) => {
    if (!part) return false;
    const [range, stepRaw] = part.split("/");
    if (part.split("/").length > 2) return false;
    const step = stepRaw == null ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) return false;
    if (range === "*") return true;
    const bounds = range.split("-");
    if (bounds.length > 2) return false;
    const start = Number(bounds[0]);
    const end = bounds.length === 2 ? Number(bounds[1]) : start;
    return Number.isInteger(start) && Number.isInteger(end) && start >= min && end <= max && start <= end;
  });
}

export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short"
  });
  const map = {};
  fmt.formatToParts(date).forEach((part) => {
    map[part.type] = part.value;
  });
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    minute: Number(map.minute),
    hour,
    day: Number(map.day),
    month: Number(map.month),
    dow: DOW[map.weekday]
  };
}

export function cronMatches(expr, parts) {
  if (!validCron(expr) || !parts) return false;
  const [minute, hour, day, month, dow] = String(expr).trim().split(/\s+/);
  if (!fieldMatches(minute, parts.minute, 0, 59)) return false;
  if (!fieldMatches(hour, parts.hour, 0, 23)) return false;
  if (!fieldMatches(month, parts.month, 1, 12)) return false;
  const dayMatch = fieldMatches(day, parts.day, 1, 31);
  const dowValue = parts.dow === 0 ? [0, 7] : [parts.dow];
  const dowMatch = dowValue.some((value) => fieldMatches(dow, value, 0, 7));
  if (day === "*" && dow === "*") return true;
  if (day === "*") return dowMatch;
  if (dow === "*") return dayMatch;
  return dayMatch || dowMatch;
}

function fieldMatches(field, value, min, max) {
  return field.split(",").some((part) => {
    const [range, stepRaw] = part.split("/");
    const step = stepRaw == null ? 1 : Number(stepRaw);
    let start = min;
    let end = max;
    if (range !== "*") {
      const bounds = range.split("-");
      start = Number(bounds[0]);
      end = bounds.length === 2 ? Number(bounds[1]) : start;
    }
    if (value < start || value > end) return false;
    return (value - start) % step === 0;
  });
}

export function latestSlot(cron, zone, now, lookbackMinutes = 360) {
  if (!validCron(cron) || !validZone(zone || "UTC")) return null;
  const origin = new Date(now.getTime());
  origin.setUTCSeconds(0, 0);
  for (let ago = 0; ago <= lookbackMinutes; ago += 1) {
    const when = new Date(origin.getTime() - ago * 60000);
    if (cronMatches(cron, zonedParts(when, zone || "UTC"))) return when;
  }
  return null;
}

export function isDue(routine, now) {
  if (!routine || routine.enabled === false) return false;
  const slot = latestSlot(routine.cron, routine.timezone || "UTC", now instanceof Date ? now : new Date(now));
  if (!slot) return false;
  if (!routine.last_run_at) return true;
  return new Date(routine.last_run_at).getTime() < slot.getTime();
}

export function deskStatus(runs, actions, role) {
  const mine = (runs || []).filter((row) => row.agent_role === role);
  const proposed = (actions || []).some((row) => row.agent_role === role && row.status === "proposed");
  const running = mine.some((row) => row.status === "running" && !row.ended_at);
  const latest = mine.slice().sort((a, b) => String(b.started_at || "").localeCompare(String(a.started_at || "")))[0];
  if (running) return { mode: "working", status: "working" };
  if (proposed) return { mode: "waiting", status: "waiting for approval" };
  if (latest && latest.status === "error") return { mode: "error", status: "error" };
  return { mode: "idle", status: "idle" };
}

export function normalizeType(value) {
  return TYPE_ALIAS[String(value || "").trim().toLowerCase()] || "";
}

export function executorFor(type) {
  if (REASONING_TYPES.includes(type)) return "model";
  if (BROWSER_TYPES.includes(type)) return "browser";
  return "";
}

export function sanitizePayload(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const payload = {};
  ["crm_state", "assigned_agent", "note", "draft", "reason", "contact_id", "target_id"].forEach((key) => {
    if (source[key] != null && source[key] !== "") payload[key] = String(source[key]).slice(0, 2000);
  });
  if (Array.isArray(source.tags)) payload.tags = source.tags.map((tag) => String(tag).slice(0, 40)).slice(0, 20);
  ["icp_score", "qual_score", "score"].forEach((key) => {
    if (source[key] != null && source[key] !== "" && Number.isFinite(Number(source[key]))) payload[key] = Number(source[key]);
  });
  return payload;
}

export function parseModelActions(text) {
  const parsed = readJson(text);
  if (!parsed || typeof parsed !== "object") return { summary: "", actions: [], skipped: ["unreadable"] };
  const summary = String(parsed.summary || "").slice(0, 500);
  const actions = [];
  const skipped = [];
  const list = Array.isArray(parsed.actions) ? parsed.actions.slice(0, 20) : [];
  list.forEach((raw) => {
    const type = normalizeType(raw && raw.type);
    const payload = raw && raw.payload;
    if (!type || wantsSend(payload)) {
      skipped.push(type || String(raw && raw.type || "unknown"));
      return;
    }
    actions.push({
      type,
      target: String(raw.target || "").slice(0, 200),
      payload: sanitizePayload(payload)
    });
  });
  return { summary, actions, skipped };
}

function wantsSend(payload) {
  if (!payload || typeof payload !== "object") return false;
  return ["send", "message", "dm", "dm_text"].some((key) => payload[key]);
}

function readJson(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (_error) {
    return null;
  }
}

export function actionStatus(type, autoApprove) {
  if (!ACTION_TYPES.includes(type)) return "";
  return autoApprove === true ? "approved" : "proposed";
}

export function runnerMessages(context) {
  return [
    { role: "system", content: RUNNER_SYSTEM },
    {
      role: "user",
      content: JSON.stringify({
        agent_role: context.agent_role,
        routine: context.name,
        instructions: context.instructions,
        prompt: context.prompt || "",
        brief: context.brief || {},
        sales_links: context.sales_links || [],
        crm: context.crm || []
      })
    }
  ];
}

export function dueContext(routine, library) {
  const role = routine.agent_role;
  const prompt = livePrompt((library.prompts || []).filter((row) => row.business_id === routine.business_id), role);
  const brief = (library.briefs || []).find((row) => row.business_id === routine.business_id);
  const links = (library.links || []).filter((row) => row.business_id === routine.business_id).slice(0, 20);
  const people = (library.crm || []).filter((row) => row.business_id === routine.business_id).slice(0, 8);
  return {
    id: routine.id,
    business_id: routine.business_id,
    agent_role: role,
    name: routine.name,
    cron: routine.cron,
    timezone: routine.timezone || "UTC",
    instructions: routine.instructions || "",
    prompt: prompt ? prompt.body : "",
    prompt_id: prompt ? prompt.id : null,
    brief: brief && brief.fields ? brief.fields : {},
    sales_links: links.map((row) => ({
      id: row.id,
      name: row.name || "",
      url: row.url || "",
      body: row.body || ""
    })),
    crm: people.map((row) => ({
      id: row.id,
      kind: row.kind || (row.handle ? "target" : "contact"),
      name: row.name || "",
      handle: row.handle || row.ig_handle || "",
      state: row.crm_state || row.lead_status || "",
      tags: Array.isArray(row.tags) ? row.tags.slice(0, 12) : [],
      summary: String(row.score_summary || row.summary || "").slice(0, 240)
    }))
  };
}

export function crmWrite(action) {
  const payload = action && action.payload ? action.payload : {};
  if (wantsSend(payload)) return { error: "This action would message a lead." };
  const patch = {};
  if (payload.crm_state && CRM_STATES.includes(String(payload.crm_state))) patch.crm_state = String(payload.crm_state);
  if (Array.isArray(payload.tags)) patch.tags = payload.tags;
  if (payload.assigned_agent) patch.assigned_agent = String(payload.assigned_agent).slice(0, 80);
  const score = payload.icp_score != null ? Number(payload.icp_score) : payload.score != null ? Number(payload.score) : null;
  if (action.type === "score" && score != null && Number.isFinite(score)) patch.icp_score = score;
  if (payload.qual_score != null && Number.isFinite(Number(payload.qual_score))) patch.qual_score = Number(payload.qual_score);
  const note = payload.note ? String(payload.note).slice(0, 2000) : "";
  const contactId = payload.contact_id || "";
  const targetId = payload.target_id || "";
  if (action.type === "score" && score != null && Number.isFinite(score) && !contactId && !targetId) {
    return { result: { score } };
  }
  if (action.type === "crm_update" || action.type === "score") {
    if (!contactId && !targetId && !note) return { error: "No CRM record was named." };
    return {
      table: contactId ? "acq_contacts" : targetId ? "acq_targets" : "",
      id: contactId || targetId || "",
      patch,
      note,
      contact_id: contactId,
      target_id: targetId
    };
  }
  if (action.type === "draft") {
    const draft = payload.draft ? String(payload.draft).slice(0, 2000) : "";
    if (!draft) return { error: "The draft is empty." };
    return { result: { draft } };
  }
  if (action.type === "research") {
    const text = payload.draft || payload.note || payload.reason || "";
    if (!text) return { error: "The research note is empty." };
    return { result: { research: String(text).slice(0, 2000) } };
  }
  return { error: "This action is for the browser worker." };
}

export function bearerMatches(header, secrets) {
  const bearer = String(header || "").replace(/^Bearer\s+/i, "").trim();
  return (secrets || []).some((secret) => safeEqual(bearer, secret));
}

export function safeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
