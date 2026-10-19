import { getSupabase, isConfigured, logout } from "../../auth/supabase.js";
import { clearAuthParams, clearCallbackMemory, rememberCallback, resolveSession } from "../../auth/callback.js";
import { bindShell, toast } from "../../auth/ui.js";
import { cronFieldsValid, nextCron, zonedParts } from "./cron.mjs";
import { STATION_OPTIONS, STATIONS, cardSpot, homeStation, hqPlan, taskStation } from "../office/factory.mjs";
import { clip, currentDesk, deskSummary, stationVerb } from "../office/desk.mjs";
import { bindRoster, orgPreviewFixture, rosterCounts, stackModel, unmatchedRoster } from "../office/org.mjs";
import { leftLabel, madridTime, progressOf, recentDone, timeline } from "../office/queue.mjs";
import { standupPhase } from "../office/standup.mjs";

bindShell();
const STATUSES = [
  ["queued", "Queued"],
  ["in_progress", "In progress"],
  ["blocked", "Blocked"],
  ["needs_diego", "Needs Diego"],
  ["done", "Done"]
];
const PRIORITIES = [["low", "Low"], ["normal", "Normal"], ["high", "High"]];
const DOT = { needs: "#ef4444", typing: "#22c55e", blocked: "#e8b04a", idle: "#64748b", paused: "#64748b" };
const WORK_LABEL = { needs: "Needs Diego", typing: "In progress", blocked: "Blocked", idle: "Idle", paused: "Paused" };
const DRAFT = "Outputs are drafts for Diego. Nothing here sends a DM, post, or email.";
const SECTIONS = ["overview", "office", "tasks", "needs", "schedule", "agents", "activity"];
const TITLES = {
  overview: "Overview",
  office: "Office",
  tasks: "Tasks",
  needs: "Needs Diego",
  schedule: "Schedule",
  agents: "Agents",
  activity: "Activity"
};
const SUBS = {
  overview: "The team, open work, and what is waiting on you.",
  office: "Brand Brain sends rockets to the chiefs. Each chief sends them on to its specialists.",
  tasks: "Drag a card between columns, or change its status from the menu.",
  needs: "Answer every pending item here. Nothing is sent until you use it somewhere else.",
  schedule: "Recurring task templates. Europe/Madrid unless you set another timezone.",
  agents: "Add, edit, or retire agents. Retired names can be used again.",
  activity: "What changed in Agentic HQ."
};
const MARK = {
  active: "Active",
  queued: "Queued",
  blocked: "Blocked",
  needs: "Needs Diego",
  paused: "Paused"
};
const FIXTURE_USER = {
  id: "00000000-0000-4000-8000-0000000000d1",
  email: "diego@roleflow.io",
  user_metadata: { full_name: "Diego Castanedo" }
};

const app = document.getElementById("hq-app");
const panel = document.getElementById("hq-panel");
const panelBody = document.getElementById("hq-panel-body");
const panelTitle = document.getElementById("hq-panel-title");
const heading = document.getElementById("page-heading");
const sub = document.getElementById("page-sub");

const state = {
  ready: false,
  fixture: false,
  saving: false,
  stale: false,
  supabase: null,
  user: null,
  agents: [],
  tasks: [],
  comments: [],
  schedules: [],
  activity: [],
  keys: [],
  filters: { agent: "", priority: "", search: "" },
  confirmDelete: "",
  confirmRetire: "",
  pendingKey: "",
  channel: null,
  timer: 0,
  poll: 0
};

let officeHandle = null;
let officeToken = 0;
let officeMounting = false;
let brainToken = 0;
let brandBrainText = "";
const officeBadges = new Map();
const seenStatus = new Map();
const flashes = new Map();

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (key === "class") {
      node.className = value || "";
      return;
    }
    if (key === "text") {
      node.textContent = value == null ? "" : String(value);
      return;
    }
    if (key === "value") {
      node.value = value == null ? "" : String(value);
      return;
    }
    if (key === "checked") {
      node.checked = Boolean(value);
      return;
    }
    if (key === "selected") {
      node.selected = Boolean(value);
      if (value) node.setAttribute("selected", "");
      return;
    }
    if (value == null || value === false) return;
    node.setAttribute(key, value === true ? "" : String(value));
  });
  (children || []).forEach((child) => {
    if (child == null || child === false) return;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return node;
}

function hideBoot() {
  const boot = document.getElementById("boot-state");
  if (boot) boot.hidden = true;
}

function showState(title, message, extra) {
  hideBoot();
  app.replaceChildren(el("div", { class: "state" }, [
    el("h2", { text: title }),
    el("p", { text: message }),
    extra || null
  ]));
}

function scrub(error) {
  const message = String((error && (error.message || error.details)) || error || "Something went wrong.");
  const code = error && error.code;
  if (code === "23505" || /23505|duplicate key/i.test(message)) {
    if (/hq_schedules_template|task_template/i.test(message)) return "That agent already has a schedule with this template.";
    return "An agent with that name already exists.";
  }
  if (/cannot report to itself/i.test(message)) return "An agent cannot report to itself.";
  if (/PGRST205|schema cache|does not exist/i.test(message)) return "Apply the Agentic HQ migration, then refresh.";
  return message.replace(/rfhq_[0-9a-f]+/gi, "[key]").slice(0, 280);
}

function missingRelation(error) {
  return error && /schema cache|does not exist|PGRST205/i.test(error.message || "");
}

function route() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, "")) || "office";
  if (raw === "standup") return { section: "office", id: "" };
  if (raw === "meeting") return { section: "office", id: "meeting" };
  const [section, id] = raw.split("/");
  if (section === "chat") return { section: "office", id: "" };
  if (section === "agent" && id) return { section: "office", id };
  if (section === "task" && id) return { section: "tasks", id };
  if (!SECTIONS.includes(section)) return { section: "office", id: "" };
  return { section, id: id || "" };
}

function go(hash) {
  if (location.hash === hash) paint();
  else location.hash = hash;
}

function time(value) {
  const n = new Date(value || 0).getTime();
  return Number.isNaN(n) ? 0 : n;
}

function formatMadrid(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function madridInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = zonedParts(date, "Europe/Madrid");
  const pad = (n) => String(n).padStart(2, "0");
  return parts.year + "-" + pad(parts.month) + "-" + pad(parts.day) + "T" + pad(parts.hour) + ":" + pad(parts.minute);
}

function zonedInputToDate(value, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || "");
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  let utc = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 4; i += 1) {
    const parts = zonedParts(new Date(utc), timeZone || "Europe/Madrid");
    const got = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const want = Date.UTC(year, month - 1, day, hour, minute);
    if (want === got) return new Date(utc).toISOString();
    utc += want - got;
  }
  return new Date(utc).toISOString();
}

function zoneOk(zone) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
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

function agentById(id) {
  return state.agents.find((agent) => agent.id === id) || null;
}

function taskById(id) {
  return state.tasks.find((task) => task.id === id) || null;
}

function agentName(id) {
  return agentById(id)?.name || "Unassigned";
}

function rosterAgent(agent) {
  return Boolean(agent) && agent.status !== "retired" && agent.status !== "archived";
}

function activeAgents() {
  return state.agents.filter(rosterAgent);
}

function workOf(agent) {
  if (!agent || agent.status === "paused" || agent.status === "retired") return agent && agent.status === "paused" ? "paused" : "idle";
  const mine = state.tasks.filter((task) => task.agent_id === agent.id);
  if (mine.some((task) => task.status === "needs_diego")) return "needs";
  if (mine.some((task) => task.status === "in_progress")) return "typing";
  if (mine.some((task) => task.status === "blocked")) return "blocked";
  return "idle";
}

function shownTask(task) {
  return rosterAgent(agentById(task.agent_id));
}

function openTasks(agentId) {
  return state.tasks.filter((task) => shownTask(task) && task.status !== "done" && (!agentId || task.agent_id === agentId));
}

function statusBubble(work, title) {
  if (work === "paused") return "Idle";
  const text = String(title || "").trim();
  if (text) return /[.!?…]$/.test(text) ? text : text + "...";
  if (work === "clear" || !work) return "Idle";
  return "Active";
}

function sceneWork(agent) {
  if (!agent || agent.status === "paused") return "paused";
  const mine = openTasks(agent.id);
  if (mine.some((task) => task.status === "needs_diego")) return "needs";
  if (mine.some((task) => task.status === "blocked")) return "blocked";
  if (mine.some((task) => task.status === "in_progress")) return "active";
  if (mine.some((task) => task.status === "queued")) return "queued";
  return "clear";
}

function agentTasks(agentId) {
  return state.tasks.filter((task) => task.agent_id === agentId && shownTask(task));
}

function noteTaskChanges() {
  state.tasks.forEach((task) => {
    const prev = seenStatus.get(task.id);
    if (prev && prev !== "done" && task.status === "done") flashes.set(task.id, Date.now());
    seenStatus.set(task.id, task.status);
  });
}

function flashFor(agentId) {
  const now = Date.now();
  flashes.forEach((at, id) => {
    if (now - at > 1600) flashes.delete(id);
  });
  return state.tasks.find((task) => task.agent_id === agentId && flashes.has(task.id)) || null;
}

function markerOf(work) {
  return work === "clear" ? "active" : work;
}

function lockSvg() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("d", "M8 1.2a3 3 0 0 0-3 3V6H4.2A1.2 1.2 0 0 0 3 7.2v6.1A1.2 1.2 0 0 0 4.2 14.5h7.6a1.2 1.2 0 0 0 1.2-1.2V7.2A1.2 1.2 0 0 0 11.8 6H11V4.2a3 3 0 0 0-3-3zm-1.6 3a1.6 1.6 0 0 1 3.2 0V6H6.4V4.2z");
  svg.append(path);
  return svg;
}

function peopleSvg() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("d", "M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zm7.2.6a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3.4 18.6c.5-2.8 2.9-4.4 5.6-4.4s5.1 1.6 5.6 4.4a.9.9 0 0 1-.9 1.1H4.3a.9.9 0 0 1-.9-1.1zm9.2-1c.2-1.5 1.1-2.7 2.5-3.3 1.6.2 3.1.9 3.8 2.4.3.6-.2 1.3-.9 1.3h-4.8a1 1 0 0 1-.6-.4z");
  svg.append(path);
  return svg;
}

function diamond(kind) {
  return el("i", { class: "diamond " + kind, title: MARK[kind] || "Meeting Room" }, [
    kind === "blocked" ? lockSvg() : el("span", { text: kind === "needs" ? "!" : "" })
  ]);
}

function statusLabel(status) {
  return STATUSES.find((item) => item[0] === status)?.[1] || status;
}

function selectEl(attrs, options, current) {
  const node = el("select", attrs);
  options.forEach(([value, label]) => {
    const option = el("option", { value, text: label });
    if (String(value) === String(current)) option.selected = true;
    node.append(option);
  });
  return node;
}

function field(label, control) {
  return el("label", { class: "hq-field" }, [label, control]);
}

function sortState() {
  state.agents.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  state.tasks.sort((a, b) => time(b.updated_at) - time(a.updated_at));
  state.comments.sort((a, b) => time(a.created_at) - time(b.created_at));
  state.schedules.sort((a, b) => agentName(a.agent_id).localeCompare(agentName(b.agent_id)) || time(a.next_run) - time(b.next_run));
  state.activity.sort((a, b) => time(b.created_at) - time(a.created_at));
  state.keys.sort((a, b) => time(b.created_at) - time(a.created_at));
}

function needsItems() {
  return state.tasks
    .filter((task) => shownTask(task) && task.status === "needs_diego")
    .sort((a, b) => time(b.updated_at) - time(a.updated_at) || a.title.localeCompare(b.title));
}

function filteredTasks() {
  const query = state.filters.search.trim().toLowerCase();
  return state.tasks.filter((task) => {
    if (!shownTask(task)) return false;
    if (state.filters.agent && task.agent_id !== state.filters.agent) return false;
    if (state.filters.priority && task.priority !== state.filters.priority) return false;
    if (!query) return true;
    return (task.title + " " + (task.description || "")).toLowerCase().includes(query);
  });
}

function typing() {
  const node = document.activeElement;
  if (!node || node === document.body) return false;
  const tag = node.tagName;
  const editing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  return editing && (app.contains(node) || panel.contains(node));
}

async function reload() {
  const names = ["hq_agents", "hq_tasks", "hq_task_comments", "hq_schedules", "hq_activity", "hq_agent_keys"];
  const results = await Promise.all(names.map((name) => state.supabase.from(name).select("*")));
  const failed = results.find((result) => result.error);
  if (failed) {
    const error = failed.error;
    if (missingRelation(error)) error.message = error.message || "schema cache";
    throw error;
  }
  state.agents = results[0].data || [];
  state.tasks = results[1].data || [];
  state.comments = results[2].data || [];
  state.schedules = results[3].data || [];
  state.activity = results[4].data || [];
  state.keys = results[5].data || [];
  sortState();
}

function scheduleReload() {
  window.clearTimeout(state.timer);
  state.timer = window.setTimeout(async () => {
    try {
      await reload();
    } catch (error) {
      toast(scrub(error), "bad");
      return;
    }
    if (typing()) {
      state.stale = true;
      return;
    }
    paint();
  }, 250);
}

function subscribe() {
  if (state.fixture || state.channel) return;
  const channel = state.supabase.channel("agent-hq");
  ["hq_agents", "hq_tasks", "hq_task_comments", "hq_schedules", "hq_activity", "hq_agent_keys"].forEach((table) => {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, () => scheduleReload());
  });
  channel.subscribe();
  state.channel = channel;
}

function startDeskPoll() {
  if (state.fixture || state.poll) return;
  state.poll = window.setInterval(() => {
    if (document.hidden || !state.ready) return;
    scheduleReload();
  }, 60000);
}

async function commit(run, okMessage) {
  if (state.saving) return false;
  state.saving = true;
  try {
    const result = await run();
    if (result && result.error) {
      toast(scrub(result.error), "bad");
      return false;
    }
    await reload();
    if (okMessage) toast(okMessage);
    paint();
    return true;
  } catch (error) {
    toast(scrub(error), "bad");
    return false;
  } finally {
    state.saving = false;
  }
}

function readFixture() {
  const host = location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") return null;
  const fixture = window.__HQ_FIXTURE;
  if (!fixture || !Array.isArray(fixture.agents)) return null;
  return fixture;
}

function memoryClient(seed) {
  const db = {
    profiles: [{ id: FIXTURE_USER.id, full_name: "Diego Castanedo", email: FIXTURE_USER.email }],
    admins: [{ user_id: FIXTURE_USER.id }],
    hq_agents: structuredClone(seed.agents || []),
    hq_tasks: structuredClone(seed.tasks || []),
    hq_task_comments: structuredClone(seed.comments || []),
    hq_schedules: structuredClone(seed.schedules || []),
    hq_activity: structuredClone(seed.activity || []),
    hq_agent_keys: structuredClone(seed.keys || [])
  };

  function rows(name) {
    if (!db[name]) db[name] = [];
    return db[name];
  }

  function clash(name, row) {
    if (name === "hq_agents" && row.status !== "retired") {
      const key = String(row.name || "").trim().toLowerCase();
      if (rows(name).some((item) => item.id !== row.id && item.status !== "retired" && String(item.name).trim().toLowerCase() === key)) {
        const error = new Error('duplicate key value violates unique constraint "hq_agents_name_active_idx"');
        error.code = "23505";
        throw error;
      }
    }
    if (name === "hq_schedules") {
      if (rows(name).some((item) => item.id !== row.id && item.agent_id === row.agent_id && item.task_template === row.task_template)) {
        const error = new Error('duplicate key value violates unique constraint "hq_schedules_template_idx"');
        error.code = "23505";
        throw error;
      }
    }
  }

  function query(name) {
    const builder = {
      filters: [],
      op: "select",
      payload: null,
      one: "",
      select() { return this; },
      insert(payload) { this.op = "insert"; this.payload = payload; return this; },
      update(payload) { this.op = "update"; this.payload = payload; return this; },
      delete() { this.op = "delete"; return this; },
      eq(column, value) { this.filters.push([column, value]); return this; },
      order() { return this; },
      maybeSingle() { this.one = "maybe"; return this; },
      single() { this.one = "single"; return this; },
      then(resolve) {
        try {
          resolve({ data: builder.run(), error: null });
        } catch (error) {
          resolve({ data: null, error: { message: error.message, code: error.code || "" } });
        }
      },
      run() {
        const list = rows(name).filter((row) => builder.filters.every(([column, value]) => row[column] === value));
        if (builder.op === "select") {
          const data = structuredClone(list);
          if (builder.one) return data[0] || null;
          return data;
        }
        if (builder.op === "delete") {
          db[name] = rows(name).filter((row) => !builder.filters.every(([column, value]) => row[column] === value));
          return null;
        }
        if (builder.op === "insert") {
          const row = { ...builder.payload, id: builder.payload.id || crypto.randomUUID() };
          const now = new Date().toISOString();
          row.created_at = row.created_at || now;
          row.updated_at = now;
          if (name === "hq_tasks" && row.status === "needs_diego" && !row.decision) row.decision = "pending";
          if (name === "hq_tasks" && row.status === "done") row.completed_at = row.completed_at || now;
          if (name === "hq_task_comments") {
            row.author_kind = "diego";
            row.author_id = FIXTURE_USER.id;
          }
          clash(name, row);
          rows(name).push(row);
          return structuredClone(row);
        }
        list.forEach((row) => {
          const next = { ...row, ...builder.payload, id: row.id, updated_at: new Date().toISOString() };
          if (name === "hq_tasks" && next.status === "needs_diego" && !next.decision) next.decision = "pending";
          if (name === "hq_tasks" && next.status === "done" && row.status !== "done") next.completed_at = new Date().toISOString();
          if (name === "hq_agents" && next.reports_to && next.reports_to === next.id) {
            throw new Error("an agent cannot report to itself");
          }
          clash(name, next);
          Object.assign(row, next);
        });
        return null;
      }
    };
    return builder;
  }

  return {
    from: query,
    rpc() {
      return Promise.resolve({ data: null, error: { message: "API keys are issued on the live admin site." } });
    },
    channel() {
      return { on() { return this; }, subscribe() { return this; } };
    },
    removeChannel() {},
    auth: {
      getSession: async () => ({ data: { session: { user: FIXTURE_USER } }, error: null }),
      getUser: async () => ({ data: { user: FIXTURE_USER }, error: null }),
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => ({ error: null })
    }
  };
}

function paintChrome() {
  const current = route();
  heading.textContent = TITLES[current.section];
  document.title = TITLES[current.section] + " · Agentic HQ · Roleflow";
  sub.textContent = SUBS[current.section] + " " + DRAFT;
  document.querySelectorAll("#hq-nav a").forEach((link) => {
    const href = link.getAttribute("href") || "";
    if (!href.startsWith("#")) {
      link.removeAttribute("aria-current");
      return;
    }
    const section = href.replace(/^#/, "").split("/")[0];
    if (section === current.section) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const count = needsItems().length;
  const badge = document.getElementById("needs-count");
  badge.hidden = count === 0;
  badge.textContent = String(count);
  paintTree();
}

function seatWork(seat) {
  return seat && seat.live ? workOf(seat.live) : "idle";
}

function paintTree() {
  const root = document.getElementById("hq-tree");
  const current = route();
  root.replaceChildren(el("p", { class: "hq-dept-label", text: "Organization" }));
  root.append(personButton({ id: "diego", name: "Diego Castanedo", title: "CEO", work: "typing" }, current));
  const model = stackModel(activeAgents());
  root.append(personButton({ id: model.cos.id, name: model.cos.name, title: "Chief of Staff · L1", work: seatWork(model.cos) }, current));
  model.zones.forEach((zone) => {
    const block = el("div", { class: "hq-dept" }, [el("p", { class: "hq-dept-label", text: zone.label })]);
    const addSeat = (seat) => {
      block.append(personButton({
        id: seat.id,
        name: seat.name,
        title: seat.level + " · reports to " + seat.reportsToLabel,
        work: seatWork(seat)
      }, current));
    };
    addSeat(zone.chief);
    const walk = (people) => {
      people.forEach((person) => {
        addSeat(person.seat);
        walk(person.reports);
      });
    };
    walk(zone.people);
    root.append(block);
  });
  const extra = unmatchedRoster(activeAgents());
  const outside = extra.filter((agent) => agent.outside_org || agent.department === "Outside");
  const other = extra.filter((agent) => !agent.outside_org && agent.department !== "Outside");
  const addExtra = (label, members) => {
    if (!members.length) return;
    const block = el("div", { class: "hq-dept" }, [el("p", { class: "hq-dept-label", text: label })]);
    members.forEach((agent) => {
      block.append(personButton({ id: agent.id, name: agent.name, title: agent.title || agent.department, work: workOf(agent) }, current));
    });
    root.append(block);
  };
  addExtra("Also on the roster", other);
  addExtra("Outside", outside);
}

function personButton(person, current) {
  const button = el("button", {
    type: "button",
    class: "hq-person",
    "data-action": person.id === "diego" ? "open-diego" : "open-agent",
    "data-id": person.id
  }, [
    el("i", { class: "dot", style: "background:" + (DOT[person.work] || DOT.idle) }),
    el("span", { class: "who" }, [
      el("strong", { text: person.name }),
      el("small", { text: person.title })
    ])
  ]);
  if (current.section === "office" && current.id === person.id) button.setAttribute("aria-current", "true");
  return button;
}

function paintPanel() {
  const current = route();
  let target = null;
  if (current.id && (current.section === "office" || current.section === "tasks" || current.section === "needs")) {
    if (current.section === "office" && current.id === "meeting") target = { kind: "meeting" };
    else if (current.section === "office" && current.id === "brand-brain") target = { kind: "brain" };
    else if (current.section === "office" && current.id.startsWith("task:")) target = { kind: "task", id: current.id.slice(5) };
    else target = current.id === "diego" ? { kind: "diego" } : (
      current.section === "office" ? { kind: "agent", id: current.id } : { kind: "task", id: current.id }
    );
  }
  if (!target) {
    panel.hidden = true;
    panelBody.replaceChildren();
    return;
  }
  panel.hidden = false;
  if (target.kind === "meeting") {
    panelTitle.textContent = "Meeting Room";
    panelBody.replaceChildren(meetingPanel());
    return;
  }
  if (target.kind === "brain") {
    paintBrain();
    return;
  }
  if (target.kind === "diego") {
    panelTitle.textContent = "Diego Castanedo";
    const waiting = needsItems().length;
    panelBody.replaceChildren(
      el("p", { class: "hq-note", text: "CEO. You assign work and answer the team from here." }),
      el("p", { text: waiting + (waiting === 1 ? " item needs you." : " items need you.") }),
      el("a", { class: "btn sm", href: "#needs" }, ["Open Needs Diego"])
    );
    return;
  }
  if (target.kind === "agent") {
    const agent = agentById(target.id);
    const seat = bindRoster(activeAgents()).find((item) => item.id === target.id);
    if (!agent && seat) {
      panelTitle.textContent = seat.name;
      panelBody.replaceChildren(
        el("p", { class: "hq-note", text: seat.level + " · " + seat.department }),
        el("p", { text: "Reports to " + seat.reportsToLabel + "." }),
        el("p", { class: "hq-note", text: "This seat is in the 19 Oct org. It is not on the live roster yet, so there is no task history to open." })
      );
      return;
    }
    panelTitle.textContent = agent ? agent.name : "Agent";
    panelBody.replaceChildren(agent ? agentPanel(agent) : el("p", { text: "That agent is not on the roster." }));
    return;
  }
  const task = taskById(target.id);
  panelTitle.textContent = task ? task.title : "Task";
  panelBody.replaceChildren(task ? taskPanel(task) : el("p", { text: "That task is no longer here." }));
}

function stationLabel(value) {
  return STATION_OPTIONS.find((item) => item[0] === value)?.[1] || "";
}

function renderMarkdown(text) {
  const wrap = el("div", { class: "hq-md" });
  let list = null;
  let para = [];
  const flushPara = () => {
    if (!para.length) return;
    wrap.append(el("p", { text: para.join(" ") }));
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    wrap.append(list);
    list = null;
  };
  String(text || "").replace(/\r\n/g, "\n").split("\n").forEach((line) => {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
      return;
    }
    if (heading) {
      flushPara();
      flushList();
      const tag = heading[1].length === 1 ? "h2" : heading[1].length === 2 ? "h3" : "h4";
      wrap.append(el(tag, { text: heading[2] }));
      return;
    }
    if (item) {
      flushPara();
      if (!list) list = el("ul");
      list.append(el("li", { text: item[1] }));
      return;
    }
    flushList();
    para.push(line.trim());
  });
  flushPara();
  flushList();
  return wrap;
}

async function paintBrain() {
  const token = ++brainToken;
  panelTitle.textContent = "Brand Brain";
  if (!brandBrainText) panelBody.replaceChildren(el("p", { class: "hq-note", text: "Loading Brand Brain…" }));
  let text = brandBrainText;
  if (!text) {
    try {
      const res = await fetch("/docs/brand-brain.md", { cache: "no-store" });
      text = res.ok ? await res.text() : "";
    } catch {
      text = "";
    }
    if (token !== brainToken || route().id !== "brand-brain") return;
    if (String(text || "").trim()) brandBrainText = text;
  }
  if (!String(text || "").trim()) {
    panelBody.replaceChildren(el("p", { text: "Brand Brain is ready for Diego to fill in docs/brand-brain.md." }));
    return;
  }
  panelBody.replaceChildren(renderMarkdown(text));
}

function estimateLine(row) {
  const minutes = row.estimated ? row.estimate + " min est." : row.estimate + " min";
  const finish = row.task.status === "blocked" ? "waiting" : "finishes " + madridTime(row.finish) + " Madrid";
  return minutes + " · " + finish;
}

function queueBlock(tasks) {
  const wrap = el("div", { class: "hq-queue" });
  const rows = timeline(tasks, new Date());
  const lanes = [["now", "Now"], ["next", "Next"], ["later", "Later"]];
  if (!rows.length) wrap.append(el("p", { class: "hq-note", text: "Queue is empty. This agent is idle." }));
  lanes.forEach(([lane, label]) => {
    const items = rows.filter((row) => row.lane === lane);
    if (!items.length) return;
    wrap.append(el("h4", { text: label }));
    items.forEach((row) => {
      wrap.append(el("div", { class: "hq-card" }, [
        el("button", { type: "button", class: "hq-card-title", "data-action": "open-task", "data-id": row.task.id }, [row.task.title]),
        el("p", { class: "hq-note", text: estimateLine(row) }),
        selectEl({ "data-action": "set-status", "data-id": row.task.id, "aria-label": "Status for " + row.task.title }, STATUSES, row.task.status)
      ]));
    });
  });
  const done = recentDone(tasks);
  wrap.append(el("h3", { text: "Recent" }));
  if (!done.length) wrap.append(el("p", { class: "hq-note", text: "Nothing finished yet." }));
  done.forEach((task) => {
    wrap.append(el("div", { class: "hq-card" }, [
      el("button", { type: "button", class: "hq-card-title", "data-action": "open-task", "data-id": task.id }, [task.title]),
      el("p", { class: "hq-note", text: "Done · " + formatMadrid(task.completed_at || task.updated_at) })
    ]));
  });
  return wrap;
}

function agentPanel(agent) {
  const wrap = el("div", {}, [
    el("p", { class: "hq-note", text: [agent.title, agent.department, agent.status].filter(Boolean).join(" · ") }),
    agent.role ? el("p", { text: agent.role }) : null,
    agent.standing_need ? el("p", {}, [el("strong", { text: "Standing need. " }), agent.standing_need]) : null,
    el("p", { class: "hq-note", text: "Last active " + formatMadrid(agent.last_active_at) }),
    el("div", { class: "hq-row" }, [
      el("a", { class: "btn ghost sm", href: "#agents/" + agent.id }, ["Edit agent"])
    ]),
    el("h3", { text: "Queue" })
  ]);
  wrap.append(queueBlock(agentTasks(agent.id)));
  wrap.append(el("h3", { text: "Assign a task" }));
  wrap.append(taskForm(agent.id));
  wrap.append(el("p", { class: "hq-note", text: DRAFT }));
  return wrap;
}

function taskForm(agentId) {
  return el("form", { class: "hq-form", "data-form": "create-task" }, [
    agentId
      ? el("input", { type: "hidden", name: "agent_id", value: agentId })
      : field("Agent", selectEl({ name: "agent_id", required: true }, activeAgents().map((agent) => [agent.id, agent.name]), state.filters.agent || activeAgents()[0]?.id || "")),
    field("Title", el("input", { name: "title", required: true, maxlength: "240" })),
    field("Description", el("textarea", { name: "description", maxlength: "8000" })),
    field("Priority", selectEl({ name: "priority" }, PRIORITIES, "normal")),
    field("Status", selectEl({ name: "status" }, STATUSES.filter((item) => item[0] !== "done"), "queued")),
    field("Station", selectEl({ name: "station" }, STATION_OPTIONS, "")),
    field("Due (Madrid)", el("input", { type: "datetime-local", name: "due" })),
    el("button", { class: "btn sm", type: "submit" }, ["Assign task"])
  ]);
}

function taskPanel(task) {
  const comments = state.comments.filter((comment) => comment.task_id === task.id);
  const wrap = el("div", {}, [
    el("p", { class: "hq-note", text: [agentName(task.agent_id), statusLabel(task.status), stationLabel(task.station)].filter(Boolean).join(" · ") }),
    el("form", { class: "hq-form", "data-form": "save-task", "data-id": task.id }, [
      field("Title", el("input", { name: "title", required: true, maxlength: "240", value: task.title })),
      field("Description", el("textarea", { name: "description", maxlength: "8000", value: task.description || "" })),
      field("Status", selectEl({ name: "status" }, STATUSES, task.status)),
      field("Station", selectEl({ name: "station" }, STATION_OPTIONS, task.station || "")),
      field("Priority", selectEl({ name: "priority" }, PRIORITIES, task.priority || "normal")),
      field("Due (Madrid)", el("input", { type: "datetime-local", name: "due", value: madridInputValue(task.due) })),
      field("Output draft", el("textarea", { name: "result", maxlength: "20000", value: task.result || "" })),
      el("p", { class: "hq-note", text: "This output is a draft for you. Saving it does not send, post, or email anything." }),
      el("button", { class: "btn sm", type: "submit" }, ["Save task"])
    ])
  ]);
  if (task.status === "needs_diego") {
    wrap.append(el("div", { class: "hq-row" }, [
      el("button", { type: "button", class: "btn sm", "data-action": "approve", "data-id": task.id }, ["Approve"]),
      el("button", { type: "button", class: "btn ghost sm", "data-action": "reject", "data-id": task.id }, ["Reject"])
    ]));
  }
  wrap.append(el("h3", { text: "Thread" }));
  const thread = el("div", { class: "hq-thread" });
  if (!comments.length) thread.append(el("p", { class: "hq-note", text: "No comments yet." }));
  comments.forEach((comment) => {
    thread.append(el("div", { class: "hq-bubble" + (comment.author_kind === "diego" ? " diego" : "") }, [
      el("strong", { text: comment.author_kind === "diego" ? "Diego" : agentName(task.agent_id) }),
      el("p", { text: comment.body }),
      el("p", { class: "hq-note", text: formatMadrid(comment.created_at) })
    ]));
  });
  wrap.append(thread);
  wrap.append(el("form", { class: "hq-form", "data-form": "comment", "data-id": task.id }, [
    field("Comment", el("textarea", { name: "body", required: true, maxlength: "8000", placeholder: "Reply stays in Agentic HQ." })),
    el("button", { class: "btn sm", type: "submit" }, ["Comment"])
  ]));
  return wrap;
}

function stat(label, value, href) {
  const body = [el("span", { text: label }), el("b", { text: String(value) })];
  return el("article", { class: "hq-stat" }, [href ? el("a", { href }, body) : el("div", {}, body)]);
}

function renderOverview() {
  const open = openTasks().length;
  const needs = needsItems().length;
  const blocked = state.tasks.filter((task) => shownTask(task) && task.status === "blocked").length;
  const enabled = state.schedules.filter((item) => item.enabled && rosterAgent(agentById(item.agent_id))).length;
  const wrap = el("div", {}, [
    el("div", { class: "hq-stats" }, [
      stat("Agents", activeAgents().length, "#agents"),
      stat("Open tasks", open, "#tasks"),
      stat("Needs Diego", needs, "#needs"),
      stat("Blocked", blocked, "#tasks"),
      stat("Schedules on", enabled, "#schedule")
    ]),
    el("p", { text: "Diego runs the team from here. Agents leave drafts. You decide what happens next." }),
    el("h2", { text: "Recent activity" })
  ]);
  wrap.append(activityList(state.activity.slice(0, 8)));
  return wrap;
}

function rosterList(agents) {
  const list = el("div", { class: "hq-roster" });
  if (!agents.length) list.append(el("p", { text: "No agents to show." }));
  agents.forEach((agent) => {
    const full = agentById(agent.id) || agent;
    const work = workOf(full);
    list.append(el("button", { type: "button", "data-action": "open-agent", "data-id": agent.id }, [
      el("span", { text: agent.name }),
      el("span", { class: "hq-note", text: WORK_LABEL[work] || work })
    ]));
  });
  const diego = el("button", { type: "button", "data-action": "open-diego" }, ["Diego Castanedo"]);
  list.prepend(diego);
  return list;
}

function meetingPanel() {
  const phase = standupPhase(new Date());
  const when = phase.playing
    ? "Standup is happening now. Agents walk to the meeting room at 08:00 Madrid."
    : "Next standup is 08:00 Europe/Madrid. Agents walk in and gather around the orb.";
  const wrap = el("div", {}, [
    el("p", { text: when }),
    el("p", { class: "hq-note", text: DRAFT }),
    el("h3", { text: "Needs Diego" })
  ]);
  const needs = needsItems();
  if (!needs.length) wrap.append(el("p", { class: "hq-note", text: "Nothing is waiting on you." }));
  needs.forEach((task, index) => {
    wrap.append(el("article", { class: "hq-need" }, [
      el("span", { class: "num", text: String(index + 1) }),
      el("div", {}, [
        el("button", { type: "button", class: "hq-card-title", "data-action": "open-task", "data-id": task.id }, [task.title]),
        el("p", { class: "hq-note", text: agentName(task.agent_id) }),
        task.result ? el("p", { text: task.result }) : null,
        el("div", { class: "hq-row" }, [
          el("button", { type: "button", class: "btn sm", "data-action": "approve", "data-id": task.id }, ["Approve"]),
          el("button", { type: "button", class: "btn ghost sm", "data-action": "reject", "data-id": task.id }, ["Reject"])
        ])
      ])
    ]));
  });
  wrap.append(el("p", {}, [el("a", { href: "#needs" }, ["Open the full Needs Diego inbox"])]));
  wrap.append(el("h3", { text: "Today's standup" }));
  activeAgents().forEach((agent) => {
    const mine = openTasks(agent.id);
    const block = el("article", { class: "hq-card" }, [
      el("button", { type: "button", class: "hq-card-title", "data-action": "open-agent", "data-id": agent.id }, [agent.name]),
      el("p", { class: "hq-note", text: (MARK[markerOf(sceneWork(agent))] || "Active") + " · " + mine.length + " open" })
    ]);
    if (!mine.length) block.append(el("p", { class: "hq-note", text: "Clear." }));
    mine.slice(0, 4).forEach((task) => {
      block.append(el("button", { type: "button", class: "office-task", "data-action": "open-task", "data-id": task.id }, [
        el("strong", { text: task.title }),
        el("small", { text: statusLabel(task.status) })
      ]));
    });
    wrap.append(block);
  });
  return wrap;
}

function deskOf(agent) {
  if (!agent) return currentDesk({ tasks: [], activity: [], schedules: [], now: new Date() });
  return currentDesk({
    tasks: state.tasks.filter((task) => task.agent_id === agent.id),
    activity: state.activity.filter((row) => row.agent_id === agent.id),
    schedules: state.schedules.filter((row) => row.agent_id === agent.id),
    now: new Date()
  });
}

function personCard(seat) {
  const desk = deskOf(seat.live);
  return el("button", {
    type: "button",
    class: "org-person" + (seat.level === "L1" ? " org-chief" : ""),
    "data-action": "open-agent",
    "data-id": seat.id,
    title: desk.full
  }, [
    el("strong", { text: seat.name }),
    el("em", { class: "org-desk", text: deskSummary(desk) }),
    el("span", { text: seat.level + " · reports to " + seat.reportsToLabel })
  ]);
}

function nestList(people) {
  const list = el("div", { class: "org-nested" });
  people.forEach((person) => {
    const wrap = el("div", {});
    wrap.append(personCard(person.seat));
    if (person.reports.length) wrap.append(nestList(person.reports));
    list.append(wrap);
  });
  return list;
}

function orgStackNodes() {
  const model = stackModel(activeAgents());
  const counts = rosterCounts(state.agents);
  const nodes = [
    el("p", { class: "org-kicker", text: "Organization" }),
    el("h2", { class: "org-headline", text: counts.headline }),
    el("button", { type: "button", class: "org-person org-brain", "data-action": "open-brain" }, [
      el("strong", { text: "Brand Brain" }),
      el("span", { text: "Launches rockets to every chief" })
    ]),
    el("p", { class: "org-flow", text: "Rockets to the chiefs" }),
    personCard(model.cos),
    el("p", { class: "org-flow", text: "Each chief sends them on to its specialists" })
  ];
  model.zones.forEach((zone) => {
    const block = el("section", { class: "org-zone" }, [
      el("h3", { text: zone.label }),
      personCard(zone.chief)
    ]);
    if (zone.people.length) block.append(nestList(zone.people));
    nodes.push(block);
  });
  return nodes;
}

function closeOfficePanels() {
  document.querySelectorAll(".office-manage, .office-tracker").forEach((panel) => {
    panel.hidden = true;
  });
  document.querySelectorAll(".office-launch").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
}

function toggleOfficePanel(kind) {
  const panel = document.getElementById(kind === "manage" ? "hq-manage-panel" : "hq-tracker-panel");
  const button = document.querySelector(kind === "manage" ? "[data-action=toggle-manage]" : "[data-action=toggle-tasks]");
  if (!panel || !button) return;
  const willOpen = panel.hidden;
  closeOfficePanels();
  if (!willOpen) return;
  panel.hidden = false;
  button.setAttribute("aria-expanded", "true");
}

function parkOfficeLaunches() {
  const bar = document.querySelector("body.hq-office .app-top");
  const manage = document.querySelector(".office-launch-manage");
  const tasks = document.querySelector(".office-launch-tasks");
  const view = document.querySelector(".hq-office-view");
  if (!manage || !tasks || !view) return;
  const phone = window.matchMedia("(max-width: 760px)").matches;
  if (phone && bar) {
    if (manage.parentElement !== bar) bar.append(manage);
    if (tasks.parentElement !== bar) bar.append(tasks);
    return;
  }
  if (manage.parentElement !== view) view.append(manage);
  if (tasks.parentElement !== view) view.append(tasks);
}

function paintOrgStack() {
  const stack = document.getElementById("hq-org-stack");
  if (stack) stack.replaceChildren(...orgStackNodes());
}

function renderOffice() {
  return el("div", { class: "hq-office-view" }, [
    el("div", { id: "hq-org-stack", class: "org-stack", "aria-label": "Organization" }),
    el("div", { class: "office-stage" }, [
      el("div", { id: "hq-stage", class: "hq-stage", role: "application", "aria-label": "Organization floor. The Brand Brain launches rockets to the chiefs, and each chief sends them on to its specialists." }),
      el("div", { id: "hq-labels" }),
      el("div", { class: "hq-zoom" }, [
        el("button", { type: "button", "data-action": "zoom-in", "aria-label": "Zoom in" }, ["+"]),
        el("button", { type: "button", "data-action": "zoom-out", "aria-label": "Zoom out" }, ["−"])
      ])
    ]),
    camBar(hqPlan(activeAgents()), "hq-cam"),
    el("button", {
      type: "button",
      class: "office-launch office-launch-tasks",
      "data-action": "toggle-tasks",
      "aria-expanded": "false",
      "aria-controls": "hq-tracker-panel"
    }, ["Tasks ", el("b", { id: "hq-task-count", text: "0" })]),
    el("aside", { class: "office-float office-tracker", id: "hq-tracker-panel", hidden: true, "aria-label": "Task Tracker" }, [
      el("div", { class: "office-float-bar" }, [
        el("h2", { text: "Task Tracker" }),
        el("button", { type: "button", class: "office-float-close", "data-action": "close-office-panels", "aria-label": "Close task tracker" }, ["×"])
      ]),
      el("p", { class: "office-pending", id: "hq-pending" }, ["0 ", el("span", { text: "pending" })]),
      el("div", { id: "hq-tracker" })
    ]),
    el("button", {
      type: "button",
      class: "office-launch office-launch-manage",
      "data-action": "toggle-manage",
      "aria-expanded": "false",
      "aria-controls": "hq-manage-panel"
    }, [peopleSvg(), "Management"]),
    el("aside", { class: "office-float office-manage", id: "hq-manage-panel", hidden: true, "aria-label": "Management" }, [
      el("div", { class: "office-float-bar" }, [
        el("h2", { text: "Management" }),
        el("button", { type: "button", class: "office-float-close", "data-action": "close-office-panels", "aria-label": "Close management" }, ["×"])
      ]),
      el("div", { id: "hq-manage" })
    ]),
    el("div", { class: "office-tools" }, [
      el("span", { id: "hq-clock" }),
      el("button", { type: "button", class: "btn ghost sm", "data-action": "replay-standup" }, ["Replay standup"]),
      el("p", { id: "hq-standup-line" })
    ])
  ]);
}

function camBar(plan, id) {
  const tabs = [{ id: "overview", label: "Overview" }];
  (plan.pipeline || []).forEach((station) => tabs.push({ id: station.id, label: station.tab || station.title }));
  if (plan.side) tabs.push({ id: plan.side.id, label: plan.side.tab || plan.side.title });
  (plan.groups || []).forEach((group) => tabs.push({ id: group.id, label: group.tab || group.title }));
  return el("div", { class: "cam-tabs", id, role: "tablist", "aria-label": "Fly the camera" }, tabs.map((tab, index) => el("button", {
    type: "button",
    role: "tab",
    "data-action": "cam",
    "data-id": tab.id,
    "aria-current": index === 0 ? "true" : null
  }, [tab.label])));
}

const floorById = new Map();

function seatedRoster() {
  const bound = bindRoster(activeAgents());
  const live = bound.filter((seat) => seat.live);
  return live.length ? live : bound;
}

function officeAgents() {
  const rows = seatedRoster().map((seat) => {
    const agent = seat.live;
    const desk = agent ? deskOf(agent) : currentDesk({ now: new Date() });
    const current = desk.task;
    return {
      id: seat.id,
      name: seat.name,
      badge: seat.badge,
      title: seat.name,
      reports: seat.reportsToLabel,
      level: seat.level,
      color: seat.color,
      outside: false,
      work: agent ? sceneWork(agent) : "clear",
      home: seat.station,
      errand: "",
      orgKey: seat.key,
      zone: seat.zone,
      pulse: Boolean(current && current.status === "in_progress"),
      taskId: current ? current.id : "",
      desk,
      packet: desk.kind === "task" ? clip(desk.full, 28) : stationVerb((agent && agent.station) || seat.station)
    };
  });
  floorById.clear();
  rows.forEach((row) => floorById.set(row.id, row));
  return rows;
}

function shippingCount() {
  return (state.tasks || []).filter((task) => task && task.status !== "done" && taskStation(task, agentById(task.agent_id)) === "shipping_dock").length;
}

function factoryCards() {
  return [];
}

function paintOfficeHud() {
  const manage = document.getElementById("hq-manage");
  const tracker = document.getElementById("hq-tracker");
  const pending = document.getElementById("hq-pending");
  const clock = document.getElementById("hq-clock");
  if (!manage || !tracker || !pending) return;
  const open = openTasks();
  pending.replaceChildren(document.createTextNode(String(open.length) + " "), el("span", { text: "pending" }));
  const taskCount = document.getElementById("hq-task-count");
  if (taskCount) taskCount.textContent = String(open.length);
  if (clock) {
    clock.textContent = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Madrid",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(new Date()) + " Madrid";
  }
  const current = route();
  manage.replaceChildren();
  officeAgents().forEach((seat) => {
    const work = seat.work;
    const button = el("button", { type: "button", class: "office-count", "data-action": "open-agent", "data-id": seat.id }, [
      diamond(markerOf(work)),
      el("span", { class: "who", text: seat.name }),
      el("b", { text: String(seat.id.startsWith("org:") ? 0 : openTasks(seat.id).length) })
    ]);
    if (current.section === "office" && current.id === seat.id) button.setAttribute("aria-current", "true");
    manage.append(button);
  });
  tracker.replaceChildren();
  const shown = open.slice(0, 6);
  if (!shown.length) tracker.append(el("p", { class: "office-quiet", text: "Nothing open." }));
  shown.forEach((task) => {
    tracker.append(el("button", { type: "button", class: "office-task", "data-action": "open-task", "data-id": task.id }, [
      el("strong", { text: task.title }),
      el("small", { text: agentName(task.agent_id) + " · " + statusLabel(task.status) })
    ]));
  });
}

function separateBadges(nodes) {
  const items = [];
  nodes.forEach((node) => {
    if (!node || node.hidden) return;
    const x = parseFloat(node.style.left) || 0;
    const y = parseFloat(node.style.top) || 0;
    items.push({
      node,
      x,
      y,
      ox: x,
      oy: y,
      w: Math.max(node.offsetWidth || 0, 72),
      h: Math.max(node.offsetHeight || 0, 22)
    });
  });
  const phone = window.matchMedia("(max-width: 760px)").matches;
  if (!phone) {
    const limit = 18;
    for (let pass = 0; pass < 8; pass += 1) {
      let moved = false;
      for (let i = 0; i < items.length; i += 1) {
        for (let j = 0; j < i; j += 1) {
          const a = items[i];
          const b = items[j];
          const overlapX = (a.w + b.w) / 2 + 6 - Math.abs(a.x - b.x);
          const overlapY = (a.h + b.h) / 2 + 4 - Math.abs(a.y - b.y);
          if (overlapX <= 0 || overlapY <= 0) continue;
          if (overlapY <= overlapX) a.y += (a.y >= b.y ? 1 : -1) * Math.min(overlapY, 6);
          else a.x += (a.x >= b.x ? 1 : -1) * Math.min(overlapX, 6);
          a.x = Math.max(a.ox - limit, Math.min(a.ox + limit, a.x));
          a.y = Math.max(a.oy - limit, Math.min(a.oy + limit, a.y));
          moved = true;
        }
      }
      if (!moved) break;
    }
    items.forEach((item) => {
      item.node.style.left = item.x + "px";
      item.node.style.top = item.y + "px";
    });
    return;
  }
  const labels = document.getElementById("hq-labels");
  const pad = 8;
  const gap = 3;
  const boxW = labels ? labels.clientWidth : 0;
  const boxH = labels ? labels.clientHeight : 0;
  const limit = 36;
  items.forEach((item) => {
    item.w = item.node.offsetWidth || item.w;
    item.h = item.node.offsetHeight || item.h;
  });
  function bounds(item) {
    const minX = boxW ? pad + item.w / 2 : item.ox - limit;
    const maxX = boxW ? Math.max(minX, boxW - pad - item.w / 2) : item.ox + limit;
    const minY = boxH ? pad + item.h * 1.3 : item.oy - limit;
    const maxY = boxH ? Math.max(minY, boxH - pad + item.h * 0.3) : item.oy + limit;
    return {
      minX: Math.max(item.ox - limit, minX),
      maxX: Math.min(item.ox + limit, maxX),
      minY: Math.max(item.oy - limit, minY),
      maxY: Math.min(item.oy + limit, maxY)
    };
  }
  function room(item, axis, sign) {
    const box = bounds(item);
    if (axis === "x") return Math.max(0, sign > 0 ? box.maxX - item.x : item.x - box.minX);
    return Math.max(0, sign > 0 ? box.maxY - item.y : item.y - box.minY);
  }
  function visualOverlap(a, b) {
    const aTop = a.y - a.h * 1.3;
    const bTop = b.y - b.h * 1.3;
    return {
      x: (a.w + b.w) / 2 + gap - Math.abs(a.x - b.x),
      y: gap + Math.min(aTop + a.h, bTop + b.h) - Math.max(aTop, bTop)
    };
  }
  function separatePair(a, b) {
    const hit = visualOverlap(a, b);
    if (hit.x <= 0 || hit.y <= 0) return false;
    const axes = hit.y <= hit.x ? ["y", "x"] : ["x", "y"];
    for (let n = 0; n < axes.length; n += 1) {
      const axis = axes[n];
      const amount = axis === "y" ? hit.y : hit.x;
      let sign = Math.sign(a[axis] - b[axis]);
      if (!sign) sign = 1;
      const roomA = room(a, axis, sign);
      const roomB = room(b, axis, -sign);
      let giveA = Math.min(amount / 2, roomA);
      let giveB = Math.min(amount - giveA, roomB);
      const leftover = amount - giveA - giveB;
      if (leftover > 0) giveA = Math.min(giveA + leftover, roomA);
      if (giveA + giveB < 0.5) continue;
      a[axis] += sign * giveA;
      b[axis] -= sign * giveB;
      return true;
    }
    return false;
  }
  for (let pass = 0; pass < 12; pass += 1) {
    let moved = false;
    for (let i = 0; i < items.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        if (separatePair(items[i], items[j])) moved = true;
      }
    }
    if (!moved) break;
  }
  items.forEach((item) => {
    const box = bounds(item);
    item.x = Math.max(box.minX, Math.min(box.maxX, item.x));
    item.y = Math.max(box.minY, Math.min(box.maxY, item.y));
    item.node.style.left = item.x + "px";
    item.node.style.top = item.y + "px";
  });
}

function dotKind(desk) {
  if (!desk || desk.kind !== "task") return "idle";
  if (desk.status === "in_progress" || desk.status === "blocked" || desk.status === "needs_diego" || desk.status === "queued") return desk.status;
  return "idle";
}

function placeOfficeBadges(items, focus, distance) {
  const labels = document.getElementById("hq-labels");
  if (!labels) return;
  const zoneFocus = focus && focus !== "overview" ? focus : "";
  const close = Number(distance) > 0 && Number(distance) < 26;
  const reveal = new Set();
  if (zoneFocus) {
    items.filter((item) => {
      const seated = floorById.get(item.id);
      if (!seated) return false;
      if (zoneFocus === "chief_of_staff") return seated.orgKey === "cos";
      return seated.zone === zoneFocus;
    }).slice(0, 6).forEach((item) => reveal.add(item.id));
  } else if (close) {
    const width = labels.clientWidth || 1;
    const height = labels.clientHeight || 1;
    items.filter((item) => item.id !== "brand-brain" && item.id !== "meeting")
      .slice()
      .sort((a, b) => {
        const da = Math.hypot((a.x || 0) - width / 2, (a.y || 0) - height / 2);
        const db = Math.hypot((b.x || 0) - width / 2, (b.y || 0) - height / 2);
        return da - db;
      })
      .slice(0, 6)
      .forEach((item) => reveal.add(item.id));
  }
  const seen = new Set();
  items.forEach((item) => {
    seen.add(item.id);
    let node = officeBadges.get(item.id);
    if (!node) {
      const brain = item.id === "brand-brain";
      node = el("button", {
        type: "button",
        class: "office-badge",
        "data-action": item.id === "meeting" ? "open-meeting" : brain ? "open-brain" : "open-agent",
        "data-id": item.id === "meeting" || brain ? "" : item.id
      });
      labels.append(node);
      officeBadges.set(item.id, node);
    }
    const brain = item.id === "brand-brain";
    const seated = floorById.get(item.id);
    const agent = item.id === "meeting" || brain ? null : agentById(item.id);
    const name = item.id === "meeting" ? "Meeting Room" : brain ? "Brand Brain" : (seated ? seated.badge : (agent ? agent.name : ""));
    const full = seated ? seated.name : name;
    const desk = seated && seated.desk ? seated.desk : (agent ? deskOf(agent) : null);
    const kind = brain || item.id === "meeting" ? "meet" : dotKind(desk);
    const card = desk && desk.kind === "task" ? deskSummary(desk) : (desk ? desk.short : "");
    const sig = [name, kind, card, reveal.has(item.id) ? "1" : "0"].join("|");
    node.classList.toggle("show-card", reveal.has(item.id) && !brain && item.id !== "meeting");
    if (node.dataset.sig !== sig) {
      node.dataset.sig = sig;
      const kids = [
        el("span", { class: "office-tag" }, [
          el("i", { class: "office-dot " + kind }),
          el("span", { class: "office-pill", text: name })
        ])
      ];
      if (card) kids.push(el("span", { class: "office-card", text: card }));
      node.replaceChildren(...kids);
      node.title = desk && desk.full ? desk.full : full;
      node.setAttribute("aria-label", full + (desk && desk.full ? ", " + desk.full : ""));
    }
    node.style.left = item.x + "px";
    node.style.top = item.y + "px";
    node.hidden = !item.visible || !name;
  });
  officeBadges.forEach((node, id) => {
    if (!seen.has(id)) {
      node.remove();
      officeBadges.delete(id);
    }
  });
  separateBadges([...officeBadges.values()]);
}

function phaseLine(phase) {
  const line = document.getElementById("hq-standup-line");
  const button = document.querySelector("[data-action=replay-standup]");
  if (line) {
    const text = phase && phase.playing
      ? "Standup is in progress. Agents are walking to the meeting room."
      : "Daily standup is 08:00 Europe/Madrid. Agents walk to the meeting room.";
    if (line.textContent !== text) line.textContent = text;
  }
  if (button) {
    const label = phase && phase.playing && location.hash !== "#standup" ? "Standup playing" : "Replay standup";
    if (button.textContent !== label) button.textContent = label;
  }
}

function cancelOffice() {
  officeToken += 1;
  officeMounting = false;
  if (officeHandle) {
    officeHandle.destroy();
    officeHandle = null;
  }
}

async function mountOffice() {
  const token = ++officeToken;
  officeMounting = true;
  const host = document.getElementById("hq-stage");
  const agents = officeAgents();
  try {
    if (!host) return;
    const mod = await import("../office/scene.js");
    if (token !== officeToken || !document.body.contains(host)) return;
    officeHandle = await mod.createScene(host, {
      layout: "factory",
      plan: hqPlan(activeAgents()),
      posts: shippingCount(),
      onSelect(id) {
        if (id === "meeting") go("#office/meeting");
        else if (id === "brand-brain") go("#office/brand-brain");
        else if (id === "diego") go("#office/diego");
        else go("#office/" + id);
      },
      onFrame(payload) {
        placeOfficeBadges(payload.labels || [], payload.focus, payload.distance);
        phaseLine(payload.phase);
      }
    });
    if (token !== officeToken) {
      officeHandle.destroy();
      officeHandle = null;
      return;
    }
    officeHandle.setLoop(() => location.hash === "#standup");
    officeHandle.update(agents, factoryCards());
    const zone = new URLSearchParams(location.search).get("zone");
    if (zone && officeHandle.focus) officeHandle.focus(zone);
    window.__hqOfficeReady = true;
    if (window.__officeProject) window.__hqProject = window.__officeProject;
  } catch {
    if (token !== officeToken || !host.isConnected) return;
    host.replaceChildren(
      el("p", { class: "hq-note", text: "This browser could not start the 3D office, so the roster is listed instead." }),
      rosterList(agents)
    );
    window.__hqOfficeReady = true;
  } finally {
    if (token === officeToken) officeMounting = false;
  }
}

function renderTasks() {
  const wrap = el("div", {}, [
    el("div", { class: "hq-tools", id: "hq-filters" }, [
      selectEl({ "data-filter": "agent", "aria-label": "Filter by agent" }, [["", "All agents"]].concat(activeAgents().map((agent) => [agent.id, agent.name])), state.filters.agent),
      selectEl({ "data-filter": "priority", "aria-label": "Filter by priority" }, [["", "All priorities"]].concat(PRIORITIES), state.filters.priority),
      el("input", { "data-filter": "search", type: "search", placeholder: "Search tasks", "aria-label": "Search tasks", value: state.filters.search })
    ]),
    el("details", { class: "hq-create" }, [
      el("summary", { text: "Assign a task" }),
      taskForm("")
    ])
  ]);
  wrap.append(boardEl());
  return wrap;
}

function boardEl() {
  const tasks = filteredTasks();
  const board = el("div", { class: "hq-board", id: "hq-board" });
  STATUSES.forEach(([status, label]) => {
    let cards = tasks.filter((task) => task.status === status);
    const extra = status === "done" ? Math.max(0, cards.length - 30) : 0;
    if (status === "done") cards = cards.slice(0, 30);
    const column = el("section", { class: "hq-col", "data-drop": status }, [
      el("header", {}, [el("h2", { text: label }), el("span", { text: String(cards.length + extra) })])
    ]);
    if (!cards.length) column.append(el("p", { class: "hq-note", text: "Drop a task here" }));
    cards.forEach((task) => column.append(taskCard(task)));
    if (extra) column.append(el("p", { class: "hq-note", text: extra + " older done tasks are hidden." }));
    board.append(column);
  });
  return board;
}

function taskCard(task) {
  return el("article", { class: "hq-card" }, [
    el("button", { type: "button", class: "hq-drag", draggable: "true", "data-drag": task.id, "aria-label": "Drag " + task.title }, ["⋮⋮"]),
    el("button", { type: "button", class: "hq-card-title", "data-action": "open-task", "data-id": task.id }, [task.title]),
    el("p", { class: "hq-meta", text: agentName(task.agent_id) }),
    el("span", { class: "hq-pill " + (task.priority || ""), text: task.priority || "normal" }),
    selectEl({ "data-action": "set-status", "data-id": task.id, "aria-label": "Status for " + task.title }, STATUSES, task.status)
  ]);
}

function replaceBoard() {
  const current = document.getElementById("hq-board");
  if (!current) return;
  current.replaceWith(boardEl());
}

function renderNeeds() {
  const items = needsItems();
  const wrap = el("div", {}, [
    el("p", { text: items.length ? "Reply with the number, then yes or no. Example: 1 yes, ship the draft." : "Nothing is waiting on Diego." })
  ]);
  items.forEach((task, index) => {
    wrap.append(el("article", { class: "hq-need" }, [
      el("div", { class: "num", text: String(index + 1) }),
      el("div", {}, [
        el("button", { type: "button", class: "hq-card-title", "data-action": "open-task", "data-id": task.id }, [task.title]),
        el("p", { class: "hq-meta", text: agentName(task.agent_id) + (task.description ? " · " + task.description : "") }),
        el("div", { class: "hq-row" }, [
          el("button", { type: "button", class: "btn sm", "data-action": "approve", "data-id": task.id }, ["Yes"]),
          el("button", { type: "button", class: "btn ghost sm", "data-action": "reject", "data-id": task.id }, ["No"])
        ])
      ])
    ]));
  });
  if (items.length) {
    wrap.append(el("form", { class: "hq-form", "data-form": "needs-batch" }, [
      field("Batch answers", el("textarea", { name: "batch", placeholder: "1 yes\n2 no, wait for the call notes" })),
      el("button", { class: "btn sm", type: "submit" }, ["Apply answers"])
    ]));
  }
  return wrap;
}

function renderSchedule() {
  const current = route();
  const editing = state.schedules.find((item) => item.id === current.id) || null;
  const wrap = el("div", {}, [
    el("h2", { text: editing ? "Edit schedule" : "New schedule" }),
    scheduleForm(editing)
  ]);
  const list = el("div", { class: "hq-list" });
  const schedules = state.schedules.filter((item) => rosterAgent(agentById(item.agent_id)));
  if (!schedules.length) list.append(el("p", { class: "hq-note", text: "No recurring tasks yet." }));
  schedules.forEach((item) => {
    const confirm = state.confirmDelete === item.id;
    list.append(el("article", {}, [
      el("strong", { text: agentName(item.agent_id) }),
      el("p", { text: item.task_template }),
      el("p", { class: "hq-meta", text: item.cron + " · " + item.timezone + " · next " + formatMadrid(item.next_run) }),
      el("div", { class: "hq-row" }, [
        el("button", { type: "button", class: "btn ghost sm", "data-action": "toggle-schedule", "data-id": item.id }, [item.enabled ? "Turn off" : "Turn on"]),
        el("a", { class: "btn ghost sm", href: "#schedule/" + item.id }, ["Edit"]),
        el("button", {
          type: "button",
          class: "btn ghost sm",
          "data-action": confirm ? "confirm-delete-schedule" : "delete-schedule",
          "data-id": item.id
        }, [confirm ? "Confirm delete" : "Delete"])
      ])
    ]));
  });
  wrap.append(list);
  return wrap;
}

function scheduleForm(editing) {
  return el("form", { class: "hq-form", "data-form": "schedule", "data-id": editing ? editing.id : "" }, [
    field("Agent", selectEl({ name: "agent_id", required: true }, activeAgents().map((agent) => [agent.id, agent.name]), editing ? editing.agent_id : activeAgents()[0]?.id || "")),
    field("Task template", el("input", { name: "task_template", required: true, maxlength: "500", value: editing ? editing.task_template : "" })),
    field("Cron", el("input", { name: "cron", required: true, value: editing ? editing.cron : "0 8 * * *", placeholder: "0 8 * * *" })),
    field("Timezone", el("input", { name: "timezone", required: true, value: editing ? editing.timezone : "Europe/Madrid" })),
    field("Enabled", el("input", { type: "checkbox", name: "enabled", checked: editing ? editing.enabled : true })),
    el("button", { class: "btn sm", type: "submit" }, [editing ? "Save schedule" : "Add schedule"])
  ]);
}

function renderAgents() {
  const current = route();
  const editing = current.id && current.id !== "new" ? agentById(current.id) : null;
  const wrap = el("div", {}, [
    el("div", { class: "hq-row" }, [
      el("a", { class: "btn sm", href: "#agents/new" }, ["Add agent"])
    ]),
    el("h2", { text: editing ? "Edit " + editing.name : "New agent" }),
    agentForm(editing)
  ]);
  const list = el("div", { class: "hq-list" });
  activeAgents().forEach((agent) => list.append(agentCard(agent)));
  wrap.append(list);
  return wrap;
}

function agentCard(agent) {
  const confirm = state.confirmRetire === agent.id;
  return el("article", {}, [
    el("strong", { text: agent.name }),
    el("p", { class: "hq-meta", text: agent.title + " · " + agent.department }),
    el("span", { class: "hq-pill " + agent.status, text: agent.status }),
    el("div", { class: "hq-row" }, [
      el("a", { class: "btn ghost sm", href: "#agents/" + agent.id }, ["Edit"]),
      agent.status === "retired" ? null : el("button", {
        type: "button",
        class: "btn ghost sm",
        "data-action": confirm ? "confirm-retire" : "retire",
        "data-id": agent.id
      }, [confirm ? "Confirm retire" : "Retire"])
    ])
  ]);
}

function agentForm(agent) {
  const avatar = asObject(agent && agent.avatar);
  const reports = [["", "Diego (CEO)"]].concat(
    activeAgents().filter((item) => !agent || item.id !== agent.id).map((item) => [item.id, item.name])
  );
  const wrap = el("form", { class: "hq-form", "data-form": "agent", "data-id": agent ? agent.id : "" }, [
    field("Name", el("input", { name: "name", required: true, maxlength: "80", value: agent ? agent.name : "" })),
    field("Title", el("input", { name: "title", required: true, maxlength: "120", value: agent ? agent.title : "" })),
    field("Department", el("input", { name: "department", required: true, maxlength: "80", value: agent ? agent.department : "Growth" })),
    field("Reports to", selectEl({ name: "reports_to" }, reports, agent && agent.reports_to ? agent.reports_to : "")),
    field("Status", selectEl({ name: "status" }, [["active", "Active"], ["paused", "Paused"], ["retired", "Retired"]], agent ? agent.status : "active")),
    field("Role", el("textarea", { name: "role", value: agent ? agent.role || "" : "" })),
    field("Notes", el("textarea", { name: "notes", value: agent ? agent.notes || "" : "" })),
    field("Standing need", el("textarea", { name: "standing_need", value: agent ? agent.standing_need || "" : "" })),
    field("Color", el("input", { name: "color", value: avatar.color || "#ff7a18", pattern: "#[0-9a-fA-F]{6}" })),
    field("Initials", el("input", { name: "initials", maxlength: "3", value: avatar.initials || "" })),
    field("Team lead", el("input", { type: "checkbox", name: "is_lead", checked: Boolean(agent && agent.is_lead) })),
    field("Outside the org", el("input", { type: "checkbox", name: "outside_org", checked: Boolean(agent && agent.outside_org) })),
    el("button", { class: "btn sm", type: "submit" }, [agent ? "Save agent" : "Add agent"])
  ]);
  if (agent) wrap.append(keyBlock(agent));
  return wrap;
}

function keyBlock(agent) {
  const block = el("section", {}, [
    el("h3", { text: "API key" }),
    el("p", { class: "hq-note", text: "The agent uses this key to fetch tasks and post drafts. The full key is shown once." })
  ]);
  const keys = state.keys.filter((item) => item.agent_id === agent.id);
  if (!keys.length) block.append(el("p", { class: "hq-note", text: "No key yet." }));
  keys.forEach((item) => {
    block.append(el("p", { text: item.key_prefix + "… · " + (item.revoked_at ? "revoked " + formatMadrid(item.revoked_at) : "active") }));
    if (!item.revoked_at) {
      block.append(el("button", { type: "button", class: "btn ghost sm", "data-action": "revoke-key", "data-id": item.id }, ["Revoke"]));
    }
  });
  const pending = state.pendingKey === agent.id;
  block.append(el("button", {
    type: "button",
    class: "btn sm",
    "data-action": pending ? "confirm-issue-key" : "issue-key",
    "data-id": agent.id
  }, [pending ? "Confirm new key" : "Issue API key"]));
  return block;
}

function activityList(rows) {
  if (!rows.length) return el("p", { class: "hq-note", text: "No activity yet." });
  const list = el("ol", { class: "hq-feed" });
  rows.forEach((row) => {
    const actor = row.actor === "diego" ? "Diego" : row.actor === "system" ? "System" : row.actor;
    const item = el("li", {}, [
      el("time", { datetime: row.created_at || "", text: formatMadrid(row.created_at) }),
      el("p", { text: actor + " — " + (row.detail || row.action) })
    ]);
    if (row.task_id && taskById(row.task_id)) item.append(el("a", { href: "#tasks/" + row.task_id }, ["Open task"]));
    list.append(item);
  });
  return list;
}

function renderActivity() {
  return activityList(state.activity.slice(0, 80));
}

function renderSection(section) {
  if (section === "overview") return renderOverview();
  if (section === "office") return renderOffice();
  if (section === "tasks") return renderTasks();
  if (section === "needs") return renderNeeds();
  if (section === "schedule") return renderSchedule();
  if (section === "agents") return renderAgents();
  return renderActivity();
}

function paint() {
  noteTaskChanges();
  const current = route();
  document.body.classList.toggle("hq-office", current.section === "office");
  document.body.dataset.hqReady = current.section;
  paintChrome();
  paintPanel();
  if (current.section === "tasks" && document.getElementById("hq-filters")) {
    replaceBoard();
    window.__hqPainted = current.section;
    return;
  }
  if (current.section === "office" && (officeHandle || officeMounting) && document.getElementById("hq-stage")) {
    if (officeHandle) {
      officeHandle.update(officeAgents(), factoryCards());
      if (officeHandle.setPosts) officeHandle.setPosts(shippingCount());
      officeHandle.setLoop(() => location.hash === "#standup");
      window.__hqOfficeReady = true;
    }
    paintOfficeHud();
    paintOrgStack();
    parkOfficeLaunches();
    window.__hqPainted = current.section;
    return;
  }
  if (current.section !== "office") {
    officeBadges.clear();
    cancelOffice();
    document.querySelectorAll(".app-top .office-launch").forEach((node) => node.remove());
  }
  app.replaceChildren(renderSection(current.section));
  hideBoot();
  if (current.section === "office") {
    paintOfficeHud();
    paintOrgStack();
    parkOfficeLaunches();
    mountOffice();
  }
  window.__hqPainted = current.section;
}

async function setTaskStatus(id, status) {
  const task = taskById(id);
  if (!task || task.status === status) return;
  const patch = { status };
  if (status === "needs_diego") patch.decision = "pending";
  await commit(() => state.supabase.from("hq_tasks").update(patch).eq("id", id), "Status updated.");
}

async function decide(items, okMessage) {
  const pending = items.filter((item) => {
    const task = taskById(item.id);
    return task && task.status === "needs_diego";
  });
  if (!pending.length) {
    toast("Those items are no longer waiting.", "bad");
    return;
  }
  await commit(async () => {
    for (const item of pending) {
      const updated = await state.supabase.from("hq_tasks").update({ status: "done", decision: item.decision }).eq("id", item.id);
      if (updated.error) return updated;
      const note = item.note ? " " + item.note : "";
      const body = (item.decision === "approved" ? "Approved." : "Rejected.") + note;
      const comment = await state.supabase.from("hq_task_comments").insert({ task_id: item.id, author_kind: "diego", body });
      if (comment.error) return comment;
    }
    return { error: null };
  }, okMessage);
}

function parseBatch(text) {
  const items = needsItems();
  const decisions = [];
  const errors = [];
  String(text || "").split(/\n/).forEach((line, index) => {
    const raw = line.trim();
    if (!raw) return;
    const match = /^(\d+)\s*[.):-]?\s*(yes|approve|y|no|reject|n)\b\s*(.*)$/i.exec(raw);
    if (!match) {
      errors.push("Line " + (index + 1) + " needs a number and yes or no.");
      return;
    }
    const number = Number(match[1]);
    const task = items[number - 1];
    if (!task) {
      errors.push("No item " + number + ".");
      return;
    }
    const yes = /^(yes|approve|y)$/i.test(match[2]);
    decisions.push({ id: task.id, decision: yes ? "approved" : "rejected", note: match[3].trim() });
  });
  return { decisions, errors };
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function wouldCycle(id, reportsTo) {
  let cursor = reportsTo;
  const seen = new Set();
  while (cursor) {
    if (cursor === id || seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = agentById(cursor)?.reports_to || "";
  }
  return false;
}

function initialsOf(name, given) {
  const custom = String(given || "").trim().toUpperCase();
  if (custom) return custom.slice(0, 3);
  return String(name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "AG";
}

async function onCreateTask(form) {
  const data = formData(form);
  const title = String(data.title || "").trim();
  const agentId = String(data.agent_id || "");
  if (!title || !agentById(agentId)) {
    toast("Choose an agent and a title.", "bad");
    return;
  }
  const status = STATUSES.some((item) => item[0] === data.status) ? data.status : "queued";
  const agent = agentById(agentId);
  const station = STATIONS.includes(data.station) ? data.station : homeStation(agent);
  const payload = {
    agent_id: agentId,
    title: title.slice(0, 240),
    description: String(data.description || ""),
    status,
    priority: data.priority || "normal",
    due: data.due ? zonedInputToDate(data.due, "Europe/Madrid") : null,
    result: ""
  };
  if (station) payload.station = station;
  if (status === "needs_diego") payload.decision = "pending";
  const ok = await commit(() => state.supabase.from("hq_tasks").insert(payload), "Task assigned.");
  if (ok) form.reset();
}

async function onSaveTask(form) {
  const data = formData(form);
  const id = form.dataset.id;
  const title = String(data.title || "").trim();
  if (!title) {
    toast("A title is required.", "bad");
    return;
  }
  const task = taskById(id);
  const station = STATIONS.includes(data.station) ? data.station : homeStation(task ? agentById(task.agent_id) : null);
  const payload = {
    title: title.slice(0, 240),
    description: String(data.description || ""),
    status: data.status,
    priority: data.priority || "normal",
    due: data.due ? zonedInputToDate(data.due, "Europe/Madrid") : null,
    result: String(data.result || "").slice(0, 20000)
  };
  if (station) payload.station = station;
  if (payload.status === "needs_diego") payload.decision = "pending";
  await commit(() => state.supabase.from("hq_tasks").update(payload).eq("id", id), "Task saved.");
}

async function onComment(form) {
  const body = String(formData(form).body || "").trim();
  if (!body) {
    toast("Write a comment first.", "bad");
    return;
  }
  const ok = await commit(
    () => state.supabase.from("hq_task_comments").insert({ task_id: form.dataset.id, author_kind: "diego", body: body.slice(0, 8000) }),
    "Comment added."
  );
  if (ok) form.reset();
}

async function onSchedule(form) {
  const data = formData(form);
  const template = String(data.task_template || "").trim();
  const cron = String(data.cron || "").trim().replace(/\s+/g, " ");
  const timezone = String(data.timezone || "").trim() || "Europe/Madrid";
  if (!template || !agentById(data.agent_id)) {
    toast("Choose an agent and a task template.", "bad");
    return;
  }
  if (!cronFieldsValid(cron)) {
    toast("Use a 5-field cron expression, like 0 8 * * *.", "bad");
    return;
  }
  if (!zoneOk(timezone)) {
    toast("That timezone is not recognized.", "bad");
    return;
  }
  const duplicate = state.schedules.some((item) => item.agent_id === data.agent_id && item.task_template === template && item.id !== form.dataset.id);
  if (duplicate) {
    toast("That agent already has a schedule with this template.", "bad");
    return;
  }
  const enabled = form.querySelector('[name="enabled"]').checked;
  const next = nextCron(cron, timezone);
  const payload = {
    agent_id: data.agent_id,
    task_template: template,
    cron,
    timezone,
    enabled,
    next_run: next ? next.toISOString() : null
  };
  const id = form.dataset.id;
  await commit(
    () => id
      ? state.supabase.from("hq_schedules").update(payload).eq("id", id)
      : state.supabase.from("hq_schedules").insert(payload),
    id ? "Schedule saved." : "Schedule added."
  );
}

async function onAgent(form) {
  const data = formData(form);
  const name = String(data.name || "").trim();
  const title = String(data.title || "").trim();
  const department = String(data.department || "").trim();
  const id = form.dataset.id;
  if (!name || !title || !department) {
    toast("Name, title, and department are required.", "bad");
    return;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(data.color || "")) {
    toast("Color needs a hex value like #ff7a18.", "bad");
    return;
  }
  const reportsTo = data.reports_to || null;
  const outside = form.querySelector('[name="outside_org"]').checked;
  if (id && reportsTo === id) {
    toast("An agent cannot report to itself.", "bad");
    return;
  }
  if (id && reportsTo && wouldCycle(id, reportsTo)) {
    toast("That reporting line loops.", "bad");
    return;
  }
  const status = data.status || "active";
  if (status !== "retired" && activeAgents().some((agent) => agent.id !== id && agent.name.trim().toLowerCase() === name.toLowerCase())) {
    toast("An agent with that name already exists.", "bad");
    return;
  }
  const manager = reportsTo ? agentById(reportsTo) : null;
  const payload = {
    name,
    title,
    department: outside && !department ? "Outside" : department,
    reports_to: outside ? null : reportsTo,
    reports_to_label: outside ? "Outside the org" : (manager ? manager.name : "Diego (CEO)"),
    status,
    role: data.role || "",
    notes: data.notes || "",
    standing_need: data.standing_need || "",
    outside_org: outside,
    is_lead: form.querySelector('[name="is_lead"]').checked,
    avatar: { color: data.color, initials: initialsOf(name, data.initials) }
  };
  if (!id) {
    const maxSort = state.agents.reduce((max, agent) => Math.max(max, Number(agent.sort_order) || 0), 0);
    payload.sort_order = maxSort + 10;
  }
  const ok = await commit(async () => {
    const write = id
      ? await state.supabase.from("hq_agents").update(payload).eq("id", id)
      : await state.supabase.from("hq_agents").insert(payload);
    if (write.error) return write;
    if (status === "retired") {
      const targetId = id;
      for (const item of state.schedules.filter((schedule) => schedule.agent_id === targetId && schedule.enabled)) {
        const off = await state.supabase.from("hq_schedules").update({ enabled: false }).eq("id", item.id);
        if (off.error) return off;
      }
    }
    return { error: null };
  }, id ? "Agent saved." : "Agent added.");
  if (ok && !id) {
    const created = state.agents.find((agent) => agent.name.trim().toLowerCase() === name.toLowerCase() && agent.status !== "retired");
    if (created) go("#agents/" + created.id);
  }
}

async function onNeedsBatch(form) {
  const parsed = parseBatch(formData(form).batch);
  if (parsed.errors.length) {
    toast(parsed.errors[0], "bad");
    return;
  }
  if (!parsed.decisions.length) {
    toast("Add a numbered yes or no.", "bad");
    return;
  }
  const approved = parsed.decisions.filter((item) => item.decision === "approved").length;
  const rejected = parsed.decisions.length - approved;
  await decide(parsed.decisions, "Approved " + approved + ", rejected " + rejected + ".");
}

async function issueKey(id) {
  const result = await state.supabase.rpc("hq_issue_agent_key", { p_agent_id: id });
  state.pendingKey = "";
  if (result.error) {
    toast(scrub(result.error), "bad");
    paint();
    return;
  }
  const key = result.data && (result.data.api_key || result.data.key);
  document.getElementById("hq-key-value").textContent = key || "";
  document.getElementById("hq-key").showModal();
  try { await reload(); } catch (error) { toast(scrub(error), "bad"); }
  paint();
}

document.getElementById("nav-logout").addEventListener("click", () => logout());

document.addEventListener("click", async (event) => {
  if (document.body.classList.contains("hq-office") && !event.target.closest(".office-launch, .office-float")) {
    closeOfficePanels();
  }
  const trigger = event.target.closest("[data-action]");
  if (!trigger) return;
  const action = trigger.dataset.action;
  const id = trigger.dataset.id || "";
  if (action === "close-office-panels") closeOfficePanels();
  else if (action === "toggle-manage") toggleOfficePanel("manage");
  else if (action === "toggle-tasks") toggleOfficePanel("tasks");
  else if (action === "close-panel") closePanel();
  else if (action === "open-meeting") go("#office/meeting");
  else if (action === "open-brain") go("#office/brand-brain");
  else if (action === "open-diego") go("#office/diego");
  else if (action === "open-agent") go("#office/" + id);
  else if (action === "open-task") {
    const here = route();
    go(here.section === "office" ? "#office/task:" + id : "#" + (here.section === "needs" ? "needs" : "tasks") + "/" + id);
  }
  else if (action === "replay-standup") officeHandle && officeHandle.replay();
  else if (action === "cam") {
    if (officeHandle && officeHandle.focus) officeHandle.focus(id || "overview");
    document.querySelectorAll("#hq-cam button").forEach((button) => {
      if (button.dataset.id === (id || "overview")) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
  }
  else if (action === "zoom-in") officeHandle && officeHandle.zoom(1.12);
  else if (action === "zoom-out") officeHandle && officeHandle.zoom(0.88);
  else if (action === "approve") decide([{ id, decision: "approved", note: "" }], "Approved. The draft stays here.");
  else if (action === "reject") decide([{ id, decision: "rejected", note: "" }], "Rejected. The draft stays here.");
  else if (action === "delete-schedule") {
    state.confirmDelete = id;
    paint();
  } else if (action === "confirm-delete-schedule") {
    state.confirmDelete = "";
    const ok = await commit(() => state.supabase.from("hq_schedules").delete().eq("id", id), "Schedule deleted.");
    if (ok && route().id === id) go("#schedule");
  } else if (action === "toggle-schedule") {
    const item = state.schedules.find((schedule) => schedule.id === id);
    if (!item) return;
    const enabled = !item.enabled;
    const next = enabled ? nextCron(item.cron, item.timezone) : null;
    await commit(
      () => state.supabase.from("hq_schedules").update({ enabled, next_run: next ? next.toISOString() : item.next_run }).eq("id", id),
      enabled ? "Schedule on." : "Schedule off."
    );
  } else if (action === "retire") {
    state.confirmRetire = id;
    paint();
  } else if (action === "confirm-retire") {
    state.confirmRetire = "";
    await commit(async () => {
      const updated = await state.supabase.from("hq_agents").update({ status: "retired" }).eq("id", id);
      if (updated.error) return updated;
      for (const item of state.schedules.filter((schedule) => schedule.agent_id === id && schedule.enabled)) {
        const off = await state.supabase.from("hq_schedules").update({ enabled: false }).eq("id", item.id);
        if (off.error) return off;
      }
      return { error: null };
    }, "Agent retired. Their schedules are off.");
  } else if (action === "issue-key") {
    state.pendingKey = id;
    paint();
  } else if (action === "confirm-issue-key") {
    await issueKey(id);
  } else if (action === "revoke-key") {
    const result = await state.supabase.rpc("hq_revoke_agent_key", { p_key_id: id });
    if (result.error) {
      toast(scrub(result.error), "bad");
      return;
    }
    toast("Key revoked.");
    try { await reload(); } catch (error) { toast(scrub(error), "bad"); }
    paint();
  } else if (action === "copy-key") {
    const value = document.getElementById("hq-key-value").textContent;
    try {
      await navigator.clipboard.writeText(value);
      toast("Copied.");
    } catch {
      toast("Select the key and copy it.", "bad");
    }
  } else if (action === "close-key") {
    document.getElementById("hq-key").close();
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.dataset.form) return;
  event.preventDefault();
  const kind = form.dataset.form;
  if (kind === "create-task") onCreateTask(form);
  else if (kind === "save-task") onSaveTask(form);
  else if (kind === "comment") onComment(form);
  else if (kind === "schedule") onSchedule(form);
  else if (kind === "agent") onAgent(form);
  else if (kind === "needs-batch") onNeedsBatch(form);
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset.filter) {
    state.filters[target.dataset.filter] = target.value;
    replaceBoard();
    return;
  }
  if (target.dataset.action === "set-status") setTaskStatus(target.dataset.id, target.value);
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (target.dataset.filter !== "search") return;
  state.filters.search = target.value;
  replaceBoard();
});

document.addEventListener("dragstart", (event) => {
  const handle = event.target.closest("[data-drag]");
  if (!handle || !event.dataTransfer) return;
  event.dataTransfer.setData("text/plain", handle.dataset.drag);
  event.dataTransfer.effectAllowed = "move";
});

document.addEventListener("dragover", (event) => {
  const column = event.target.closest("[data-drop]");
  if (!column) return;
  event.preventDefault();
  column.classList.add("over");
});

document.addEventListener("dragleave", (event) => {
  const column = event.target.closest("[data-drop]");
  if (column && !column.contains(event.relatedTarget)) column.classList.remove("over");
});

document.addEventListener("drop", (event) => {
  const column = event.target.closest("[data-drop]");
  if (!column || !event.dataTransfer) return;
  event.preventDefault();
  column.classList.remove("over");
  const id = event.dataTransfer.getData("text/plain");
  if (id) setTaskStatus(id, column.dataset.drop);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const dialog = document.getElementById("hq-key");
  if (dialog.open) {
    dialog.close();
    return;
  }
  if (document.querySelector(".office-manage:not([hidden]), .office-tracker:not([hidden])")) {
    closeOfficePanels();
    return;
  }
  if (!panel.hidden) closePanel();
});

window.matchMedia("(max-width: 760px)").addEventListener("change", () => {
  if (document.body.classList.contains("hq-office")) parkOfficeLaunches();
});

document.addEventListener("focusout", () => {
  window.setTimeout(() => {
    if (!state.stale || typing()) return;
    state.stale = false;
    paint();
  }, 0);
});

window.addEventListener("hashchange", () => {
  if (state.ready) paint();
});

function closePanel() {
  const current = route();
  if (current.id && ["office", "tasks", "needs"].includes(current.section)) {
    go("#" + current.section);
    return;
  }
  panel.hidden = true;
}

async function boot(supabase, user) {
  state.supabase = supabase;
  state.user = user;
  const profileRes = await supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();
  const profile = profileRes.data || {};
  document.getElementById("user-name").textContent = profile.full_name || user.user_metadata?.full_name || "Account";
  document.getElementById("user-email").textContent = profile.email || user.email || "";
  document.getElementById("user-chip").hidden = false;
  document.getElementById("nav-logout").hidden = false;
  const adminRes = await supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!adminRes.data) {
    showState(
      "Admins only",
      "Agentic HQ is for Roleflow admins.",
      el("p", {}, [el("a", { href: "/businesses/" }, ["Back to businesses"])])
    );
    document.body.dataset.hqReady = "denied";
    return;
  }
  try {
    await reload();
  } catch (error) {
    if (missingRelation(error)) {
      showState("Agentic HQ is not in the database yet", "Apply the Agentic HQ migration, then refresh.");
      document.body.dataset.hqReady = "missing";
      return;
    }
    showState("Agentic HQ did not open", scrub(error));
    document.body.dataset.hqReady = "error";
    return;
  }
  subscribe();
  startDeskPoll();
  state.ready = true;
  paint();
}

async function loadPreviewFixture() {
  const host = location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") return null;
  if (window.__HQ_FIXTURE && Array.isArray(window.__HQ_FIXTURE.agents)) return window.__HQ_FIXTURE;
  const params = new URLSearchParams(location.search);
  if (params.get("orgpreview") !== "1") return null;
  try {
    const response = await fetch("live-preview.json", { cache: "no-store" });
    if (response.ok) {
      const data = await response.json();
      if (data && Array.isArray(data.agents) && data.agents.length) return data;
    }
  } catch {
    /* fall through to the built-in sample */
  }
  return orgPreviewFixture();
}

const arriving = rememberCallback(window.location.href);
const fixture = await loadPreviewFixture();
if (fixture) {
  state.fixture = true;
  await boot(memoryClient(fixture), FIXTURE_USER);
} else if (arriving.type === "recovery") {
  window.location.replace("/reset/" + window.location.hash);
} else if (!isConfigured()) {
  showState("Accounts unavailable", "Paste SUPABASE_URL and SUPABASE_ANON_KEY into supabase/config.js, then refresh.");
} else {
  const supabase = getSupabase();
  const resolved = await resolveSession(supabase, window.location.href);
  if (!resolved.session) {
    const notice = resolved.errorMessage;
    const next = "/admin/hq/" + window.location.hash;
    window.location.replace(notice
      ? "/signup/?mode=login&notice=" + encodeURIComponent(notice) + "&next=" + encodeURIComponent(next)
      : "/login/?next=" + encodeURIComponent(next));
  } else {
    clearAuthParams();
    clearCallbackMemory();
    await boot(supabase, resolved.session.user);
  }
}
