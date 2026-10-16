import { getSupabase, isConfigured, logout } from "../../auth/supabase.js";
import { clearAuthParams, clearCallbackMemory, rememberCallback, resolveSession } from "../../auth/callback.js";
import { bindShell, markNav, toast } from "../../auth/ui.js";
import { zonedParts } from "../hq/cron.mjs";
import { standupPhase } from "./standup.mjs";

bindShell();

const STATUSES = [
  ["queued", "Queued"],
  ["in_progress", "In progress"],
  ["blocked", "Blocked"],
  ["needs_diego", "Needs Diego"],
  ["done", "Done"]
];
const PRIORITIES = [["low", "Low"], ["normal", "Normal"], ["high", "High"]];
const MARK = {
  active: "Active",
  queued: "Queued",
  blocked: "Blocked",
  needs: "Needs Diego",
  paused: "Paused"
};
const DRAFT = "Outputs are drafts for Diego. Nothing here sends a DM, post, or email.";
const FIXTURE_USER = {
  id: "00000000-0000-4000-8000-0000000000d1",
  email: "diego@roleflow.io",
  user_metadata: { full_name: "Diego Castanedo" }
};

const app = document.getElementById("office-app");
const panel = document.getElementById("office-panel");
const panelBody = document.getElementById("office-panel-body");
const panelTitle = document.getElementById("office-panel-title");
const labels = document.getElementById("office-labels");

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
  channel: null,
  timer: 0,
  taskFocus: ""
};

const badges = new Map();
let scene = null;
let mounting = false;

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
  if (app) app.hidden = false;
}

function showState(title, message) {
  hideBoot();
  app.hidden = false;
  app.replaceChildren(el("div", { class: "state" }, [
    el("h2", { text: title }),
    el("p", { text: message }),
    el("p", {}, [el("a", { href: "/businesses/" }, ["Back to businesses"])])
  ]));
}

function scrub(error) {
  const message = String((error && (error.message || error.details)) || error || "Something went wrong.");
  if (/PGRST205|schema cache|does not exist/i.test(message)) return "Apply the Agent HQ migration, then refresh.";
  return message.replace(/rfhq_[0-9a-f]+/gi, "[key]").slice(0, 280);
}

function missingRelation(error) {
  return error && /schema cache|does not exist|PGRST205/i.test(error.message || "");
}

function route() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (raw === "meeting") return { kind: "meeting" };
  if (raw === "standup") return { kind: "none" };
  const [kind, id] = raw.split("/");
  if ((kind === "agent" || kind === "task") && id) return { kind, id };
  return { kind: "none" };
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

function zonedInputToDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || "");
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  let utc = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 4; i += 1) {
    const parts = zonedParts(new Date(utc), "Europe/Madrid");
    const got = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const want = Date.UTC(year, month - 1, day, hour, minute);
    if (want === got) return new Date(utc).toISOString();
    utc += want - got;
  }
  return new Date(utc).toISOString();
}

function clockText() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date()) + " Madrid";
}

function agentById(id) {
  return state.agents.find((agent) => agent.id === id) || null;
}

function taskById(id) {
  return state.tasks.find((task) => task.id === id) || null;
}

function activeAgents() {
  return state.agents.filter((agent) => agent.status !== "retired");
}

function openTasks(agentId) {
  return state.tasks.filter((task) => task.status !== "done" && (!agentId || task.agent_id === agentId));
}

function needsItems() {
  return state.tasks
    .filter((task) => task.status === "needs_diego")
    .sort((a, b) => time(b.updated_at) - time(a.updated_at) || a.title.localeCompare(b.title));
}

function workOf(agent) {
  if (!agent || agent.status === "paused") return "paused";
  const mine = openTasks(agent.id);
  if (mine.some((task) => task.status === "needs_diego")) return "needs";
  if (mine.some((task) => task.status === "blocked")) return "blocked";
  if (mine.some((task) => task.status === "in_progress")) return "active";
  if (mine.some((task) => task.status === "queued")) return "queued";
  return "clear";
}

function markerOf(work) {
  if (work === "clear") return "active";
  return work;
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

function diamond(kind) {
  const mark = kind === "needs" ? "!" : kind === "blocked" ? "" : "";
  const node = el("i", { class: "diamond " + kind, title: MARK[kind] || "Meeting Room" }, [
    kind === "blocked" ? lockSvg() : el("span", { text: mark })
  ]);
  return node;
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

function sortState() {
  state.agents.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name));
  state.tasks.sort((a, b) => time(b.updated_at) - time(a.updated_at));
  state.comments.sort((a, b) => time(a.created_at) - time(b.created_at));
}

function typing() {
  const node = document.activeElement;
  if (!node || node === document.body) return false;
  const tag = node.tagName;
  return (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") && panel.contains(node);
}

async function reload() {
  const names = ["hq_agents", "hq_tasks", "hq_task_comments"];
  const results = await Promise.all(names.map((name) => state.supabase.from(name).select("*")));
  const failed = results.find((result) => result.error);
  if (failed) throw failed.error;
  state.agents = results[0].data || [];
  state.tasks = results[1].data || [];
  state.comments = results[2].data || [];
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
  const channel = state.supabase.channel("agent-office");
  ["hq_agents", "hq_tasks", "hq_task_comments"].forEach((table) => {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, () => scheduleReload());
  });
  channel.subscribe();
  state.channel = channel;
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
    hq_task_comments: structuredClone(seed.comments || [])
  };
  function rows(name) {
    if (!db[name]) db[name] = [];
    return db[name];
  }
  function query(name) {
    const builder = {
      filters: [],
      op: "select",
      payload: null,
      select() { return this; },
      insert(payload) { this.op = "insert"; this.payload = payload; return this; },
      update(payload) { this.op = "update"; this.payload = payload; return this; },
      eq(column, value) { this.filters.push([column, value]); return this; },
      order() { return this; },
      maybeSingle() { this.one = true; return this; },
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
        if (builder.op === "insert") {
          const row = { ...builder.payload, id: builder.payload.id || crypto.randomUUID() };
          const now = new Date().toISOString();
          row.created_at = row.created_at || now;
          row.updated_at = now;
          if (name === "hq_tasks" && row.status === "needs_diego" && !row.decision) row.decision = "pending";
          if (name === "hq_task_comments") {
            row.author_kind = row.author_kind || "diego";
            row.author_id = FIXTURE_USER.id;
          }
          rows(name).push(row);
          return structuredClone(row);
        }
        list.forEach((row) => {
          Object.assign(row, builder.payload, { id: row.id, updated_at: new Date().toISOString() });
          if (name === "hq_tasks" && row.status === "done" && !row.completed_at) row.completed_at = row.updated_at;
        });
        return null;
      }
    };
    return builder;
  }
  return {
    from: query,
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    removeChannel() {},
    auth: {
      getSession: async () => ({ data: { session: { user: FIXTURE_USER } }, error: null }),
      getUser: async () => ({ data: { user: FIXTURE_USER }, error: null }),
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => ({ error: null })
    }
  };
}

function avatarColor(agent) {
  const avatar = agent && agent.avatar;
  if (!avatar) return "";
  if (typeof avatar === "string") {
    try {
      return JSON.parse(avatar).color || "";
    } catch {
      return "";
    }
  }
  return avatar.color || "";
}

function viewAgents() {
  return activeAgents().map((agent) => ({
    id: agent.id,
    name: agent.name,
    color: avatarColor(agent),
    outside: Boolean(agent.outside_org) || agent.department === "Outside",
    work: workOf(agent)
  }));
}

function paintChrome() {
  const clock = document.getElementById("madrid-clock");
  if (clock) clock.textContent = clockText();
  const pending = openTasks().length;
  const count = document.getElementById("pending-count");
  if (count) {
    count.replaceChildren(document.createTextNode(String(pending) + " "), el("span", { text: "pending" }));
  }
  paintManage();
  paintTracker();
  paintPanel();
  if (scene) scene.update(viewAgents());
  markNav();
}

function paintManage() {
  const list = document.getElementById("manage-list");
  if (!list) return;
  const current = route();
  list.replaceChildren();
  activeAgents().forEach((agent) => {
    const work = workOf(agent);
    const count = openTasks(agent.id).length;
    const button = el("button", {
      type: "button",
      class: "office-count",
      "data-pick": agent.id
    }, [
      diamond(markerOf(work)),
      el("span", { class: "who", text: agent.name }),
      el("b", { text: String(count) })
    ]);
    if (current.kind === "agent" && current.id === agent.id) button.setAttribute("aria-current", "true");
    list.append(button);
  });
}

function paintTracker() {
  const list = document.getElementById("tracker-list");
  if (!list) return;
  const items = openTasks().slice(0, 6);
  list.replaceChildren();
  if (!items.length) {
    list.append(el("p", { class: "office-quiet", text: "Nothing open." }));
    return;
  }
  items.forEach((task) => {
    const agent = agentById(task.agent_id);
    list.append(el("button", { type: "button", class: "office-task", "data-task": task.id }, [
      el("strong", { text: task.title }),
      el("small", { text: (agent ? agent.name : "Unassigned") + " · " + statusLabel(task.status) })
    ]));
  });
}

function taskForm(agentId) {
  return el("form", { class: "hq-form", "data-form": "create-task" }, [
    el("input", { type: "hidden", name: "agent_id", value: agentId }),
    field("Title", el("input", { name: "title", required: true, maxlength: "240" })),
    field("Description", el("textarea", { name: "description", maxlength: "8000" })),
    field("Priority", selectEl({ name: "priority" }, PRIORITIES, "normal")),
    field("Status", selectEl({ name: "status" }, STATUSES.filter((item) => item[0] !== "done"), "queued")),
    field("Due (Madrid)", el("input", { type: "datetime-local", name: "due" })),
    el("button", { class: "btn sm", type: "submit" }, ["Assign task"])
  ]);
}

function taskCard(task) {
  return el("div", { class: "hq-card" }, [
    el("button", { type: "button", class: "hq-card-title", "data-task": task.id }, [task.title]),
    el("p", { class: "hq-note", text: statusLabel(task.status) }),
    selectEl({ "data-action": "set-status", "data-id": task.id, "aria-label": "Status for " + task.title }, STATUSES, task.status)
  ]);
}

function agentPanel(agent) {
  const work = workOf(agent);
  const wrap = el("div", {}, [
    el("p", { class: "hq-note", text: [agent.title, agent.department].filter(Boolean).join(" · ") }),
    el("p", {}, [diamond(markerOf(work)), " ", MARK[markerOf(work)] || ""]),
    el("p", { class: "hq-note", text: openTasks(agent.id).length + " open" }),
    el("h3", { text: "Open tasks" })
  ]);
  const mine = state.tasks.filter((task) => task.agent_id === agent.id && task.status !== "done");
  if (!mine.length) wrap.append(el("p", { class: "hq-note", text: "No open tasks." }));
  mine.forEach((task) => wrap.append(taskCard(task)));
  wrap.append(el("h3", { text: "Assign a task" }));
  wrap.append(taskForm(agent.id));
  wrap.append(el("p", { class: "hq-note", text: DRAFT }));
  wrap.append(el("p", {}, [el("a", { href: "/admin/hq/#office/" + agent.id }, ["Open in Agent HQ"])]));
  return wrap;
}

function taskPanel(task) {
  const agent = agentById(task.agent_id);
  const comments = state.comments.filter((comment) => comment.task_id === task.id);
  const wrap = el("div", {}, [
    el("p", {}, [el("button", { type: "button", class: "btn ghost sm", "data-pick": task.agent_id }, ["Back to " + (agent ? agent.name : "agent")])]),
    el("p", { class: "hq-note", text: (agent ? agent.name : "Unassigned") + " · " + statusLabel(task.status) }),
    el("form", { class: "hq-form", "data-form": "save-task", "data-id": task.id }, [
      field("Title", el("input", { name: "title", required: true, maxlength: "240", value: task.title })),
      field("Description", el("textarea", { name: "description", maxlength: "8000", value: task.description || "" })),
      field("Status", selectEl({ name: "status" }, STATUSES, task.status)),
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
      el("strong", { text: comment.author_kind === "diego" ? "Diego" : (agent ? agent.name : "Agent") }),
      el("p", { text: comment.body }),
      el("p", { class: "hq-note", text: formatMadrid(comment.created_at) })
    ]));
  });
  wrap.append(thread);
  wrap.append(el("form", { class: "hq-form", "data-form": "comment", "data-id": task.id }, [
    field("Comment", el("textarea", { name: "body", required: true, maxlength: "8000", placeholder: "Reply stays in Agent Office." })),
    el("button", { class: "btn sm", type: "submit" }, ["Comment"])
  ]));
  return wrap;
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
    const agent = agentById(task.agent_id);
    wrap.append(el("article", { class: "hq-need" }, [
      el("span", { class: "num", text: String(index + 1) }),
      el("div", {}, [
        el("button", { type: "button", class: "hq-card-title", "data-task": task.id }, [task.title]),
        el("p", { class: "hq-note", text: agent ? agent.name : "Unassigned" }),
        task.result ? el("p", { text: task.result }) : null,
        el("div", { class: "hq-row" }, [
          el("button", { type: "button", class: "btn sm", "data-action": "approve", "data-id": task.id }, ["Approve"]),
          el("button", { type: "button", class: "btn ghost sm", "data-action": "reject", "data-id": task.id }, ["Reject"])
        ])
      ])
    ]));
  });
  wrap.append(el("p", {}, [el("a", { href: "/admin/hq/#needs" }, ["Open the full Needs Diego inbox"])]));
  wrap.append(el("h3", { text: "Today's standup" }));
  activeAgents().forEach((agent) => {
    const mine = openTasks(agent.id);
    const block = el("article", { class: "hq-card" }, [
      el("button", { type: "button", class: "hq-card-title", "data-pick": agent.id }, [agent.name]),
      el("p", { class: "hq-note", text: MARK[markerOf(workOf(agent))] + " · " + mine.length + " open" })
    ]);
    if (!mine.length) block.append(el("p", { class: "hq-note", text: "Clear." }));
    mine.slice(0, 4).forEach((task) => {
      block.append(el("button", { type: "button", class: "office-task", "data-task": task.id }, [
        el("strong", { text: task.title }),
        el("small", { text: statusLabel(task.status) })
      ]));
    });
    wrap.append(block);
  });
  return wrap;
}

function paintPanel() {
  const current = route();
  if (current.kind === "none") {
    panel.hidden = true;
    panelBody.replaceChildren();
    return;
  }
  panel.hidden = false;
  if (current.kind === "meeting") {
    panelTitle.textContent = "Meeting Room";
    panelBody.replaceChildren(meetingPanel());
    return;
  }
  if (current.kind === "agent") {
    const agent = agentById(current.id);
    panelTitle.textContent = agent ? agent.name : "Agent";
    panelBody.replaceChildren(agent ? agentPanel(agent) : el("p", { text: "That agent is not on the roster." }));
    return;
  }
  const task = taskById(current.id);
  panelTitle.textContent = task ? task.title : "Task";
  panelBody.replaceChildren(task ? taskPanel(task) : el("p", { text: "That task is no longer here." }));
}

function badgeNode(id) {
  let node = badges.get(id);
  if (node) return node;
  node = el("button", { type: "button", class: "office-badge", "data-pick": id === "meeting" ? "meeting" : id });
  labels.append(node);
  badges.set(id, node);
  return node;
}

function placeBadges(items) {
  const seen = new Set();
  items.forEach((item) => {
    seen.add(item.id);
    const node = badgeNode(item.id);
    const agent = item.id === "meeting" ? null : agentById(item.id);
    const marker = item.id === "meeting" ? "meet" : markerOf(workOf(agent));
    const name = item.id === "meeting" ? "Meeting Room" : (agent ? agent.name : "");
    if (node.dataset.marker !== marker || node.dataset.label !== name) {
      node.dataset.marker = marker;
      node.dataset.label = name;
      node.replaceChildren(
        item.id === "meeting" ? el("i", { class: "diamond meet", title: "Meeting Room" }) : diamond(marker),
        el("span", { class: "office-pill", text: name })
      );
      node.setAttribute("aria-label", name + (item.id === "meeting" ? "" : ", " + (MARK[marker] || "")));
    }
    node.style.left = item.x + "px";
    node.style.top = item.y + "px";
    node.hidden = !item.visible || !name;
  });
  badges.forEach((node, id) => {
    if (!seen.has(id)) {
      node.remove();
      badges.delete(id);
    }
  });
}

function phaseLine(phase) {
  const line = document.getElementById("standup-line");
  const button = document.getElementById("replay-standup");
  if (!line) return;
  const text = phase && phase.playing
    ? "Standup is in progress. Agents are walking to the meeting room."
    : "Daily standup is 08:00 Europe/Madrid. Agents walk to the meeting room.";
  if (line.textContent !== text) line.textContent = text;
  if (button) {
    const label = phase && phase.playing && location.hash !== "#standup" ? "Standup playing" : "Replay standup";
    if (button.textContent !== label) button.textContent = label;
  }
}

function paint() {
  if (!state.ready) return;
  hideBoot();
  paintChrome();
  const fallback = document.getElementById("office-fallback");
  if (fallback) fallback.replaceChildren(fallbackList());
}

function fallbackList() {
  const list = el("div", { class: "hq-roster" });
  list.append(el("button", { type: "button", "data-pick": "meeting" }, ["Meeting Room"]));
  activeAgents().forEach((agent) => {
    list.append(el("button", { type: "button", "data-pick": agent.id }, [
      el("span", { text: agent.name }),
      el("span", { text: MARK[markerOf(workOf(agent))] + " · " + openTasks(agent.id).length + " open" })
    ]));
  });
  return list;
}

async function mountScene() {
  if (mounting || scene) return;
  mounting = true;
  const host = document.getElementById("office-view");
  try {
    const mod = await import("./scene.js");
    if (!host || !host.isConnected) return;
    scene = await mod.createScene(host, {
      onSelect(id) { openPick(id); },
      onFrame(payload) {
        placeBadges(payload.labels || []);
        phaseLine(payload.phase);
        window.__officePhase = payload.phase;
      }
    });
    scene.setLoop(() => location.hash === "#standup");
    scene.update(viewAgents());
    document.getElementById("zoom-in").onclick = () => scene.zoom(1.12);
    document.getElementById("zoom-out").onclick = () => scene.zoom(0.88);
    document.getElementById("replay-standup").onclick = () => scene.replay();
  } catch (error) {
    window.__officeReady = "fallback";
    const hostNode = document.getElementById("office-view");
    if (hostNode) {
      const list = el("div", { id: "office-fallback" });
      list.append(fallbackList());
      hostNode.replaceChildren(list);
    }
    toast(scrub(error), "bad");
  } finally {
    mounting = false;
  }
}

function openPick(id) {
  if (!id) return;
  if (id === "meeting") go("#meeting");
  else if (agentById(id)) go("#agent/" + id);
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
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
  const payload = {
    agent_id: agentId,
    title: title.slice(0, 240),
    description: String(data.description || ""),
    status,
    priority: data.priority || "normal",
    due: data.due ? zonedInputToDate(data.due) : null,
    result: ""
  };
  if (status === "needs_diego") payload.decision = "pending";
  const ok = await commit(() => state.supabase.from("hq_tasks").insert(payload), "Task assigned.");
  if (ok) form.reset();
}

async function onSaveTask(form) {
  const data = formData(form);
  const title = String(data.title || "").trim();
  if (!title) {
    toast("A title is required.", "bad");
    return;
  }
  const payload = {
    title: title.slice(0, 240),
    description: String(data.description || ""),
    status: data.status,
    priority: data.priority || "normal",
    due: data.due ? zonedInputToDate(data.due) : null,
    result: String(data.result || "").slice(0, 20000)
  };
  if (payload.status === "needs_diego") payload.decision = "pending";
  await commit(() => state.supabase.from("hq_tasks").update(payload).eq("id", form.dataset.id), "Task saved.");
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

async function setTaskStatus(id, status) {
  const task = taskById(id);
  if (!task || task.status === status) return;
  const patch = { status };
  if (status === "needs_diego") patch.decision = "pending";
  await commit(() => state.supabase.from("hq_tasks").update(patch).eq("id", id), "Status updated.");
}

async function decide(id, decision) {
  const task = taskById(id);
  if (!task || task.status !== "needs_diego") {
    toast("That item is no longer waiting.", "bad");
    return;
  }
  await commit(async () => {
    const updated = await state.supabase.from("hq_tasks").update({ status: "done", decision }).eq("id", id);
    if (updated.error) return updated;
    const body = decision === "approved" ? "Approved." : "Rejected.";
    return state.supabase.from("hq_task_comments").insert({ task_id: id, author_kind: "diego", body });
  }, decision === "approved" ? "Approved. The draft stays here." : "Rejected. The draft stays here.");
}

document.getElementById("nav-logout").addEventListener("click", () => logout());

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-action], [data-pick], [data-task]");
  if (!trigger) return;
  if (trigger.dataset.action === "close-panel") {
    go("#");
    return;
  }
  if (trigger.dataset.action === "approve") {
    decide(trigger.dataset.id, "approved");
    return;
  }
  if (trigger.dataset.action === "reject") {
    decide(trigger.dataset.id, "rejected");
    return;
  }
  if (trigger.dataset.task) {
    go("#task/" + trigger.dataset.task);
    return;
  }
  if (trigger.dataset.pick) openPick(trigger.dataset.pick);
});

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.dataset.form) return;
  event.preventDefault();
  if (form.dataset.form === "create-task") onCreateTask(form);
  else if (form.dataset.form === "save-task") onSaveTask(form);
  else if (form.dataset.form === "comment") onComment(form);
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset.action === "set-status") setTaskStatus(target.dataset.id, target.value);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && panel && !panel.hidden) go("#");
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

window.setInterval(() => {
  const clock = document.getElementById("madrid-clock");
  if (clock) clock.textContent = clockText();
}, 30000);

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
    showState("Admins only", "Agent Office is for Roleflow admins.");
    document.body.dataset.officeReady = "denied";
    return;
  }
  try {
    await reload();
  } catch (error) {
    if (missingRelation(error)) {
      showState("Agent Office is not in the database yet", "Apply the Agent HQ migration, then refresh.");
      document.body.dataset.officeReady = "missing";
      return;
    }
    showState("Agent Office did not open", scrub(error));
    document.body.dataset.officeReady = "error";
    return;
  }
  subscribe();
  state.ready = true;
  paint();
  await mountScene();
  document.body.dataset.officeReady = "1";
}

const arriving = rememberCallback(window.location.href);
const fixture = readFixture();
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
    const next = "/admin/office/" + window.location.hash;
    window.location.replace(notice
      ? "/signup/?mode=login&notice=" + encodeURIComponent(notice) + "&next=" + encodeURIComponent(next)
      : "/login/?next=" + encodeURIComponent(next));
  } else {
    clearAuthParams();
    clearCallbackMemory();
    await boot(supabase, resolved.session.user);
  }
}
