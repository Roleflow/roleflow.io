import { setterCardSpot, setterHome, setterPlan, setterTaskStation, withAssigned } from "../admin/office/factory.mjs";
import { activeTask, leftLabel, madridTime, progressOf, recentDone, timeline } from "../admin/office/queue.mjs";
import { liveSections } from "../account/setter-model.js";

const ONBOARDING_ID = "dff340d8-ace8-47df-baa4-a78c3a4d5979";
const ONBOARDING_NAME = "Onboarding & Client Success";

let officeHandle = null;
let officeToken = 0;
let liveClient = null;
let taskChannel = null;
const badges = new Map();
const seenStatus = new Map();
const flashes = new Map();
const view = { people: [], tasksById: new Map(), conversations: 0, setterId: "", plan: null, planKey: "", agent: null, host: null };

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  });
  (children || []).forEach((child) => {
    if (child == null || child === false) return;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return node;
}

function asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function hiddenStatus(status) {
  return status === "retired" || status === "archived";
}

export function cancelWorkforce() {
  officeToken += 1;
  document.body.classList.remove("biz-workforce");
  badges.forEach((node) => node.remove());
  badges.clear();
  if (taskChannel && liveClient && liveClient.removeChannel) liveClient.removeChannel(taskChannel);
  taskChannel = null;
  liveClient = null;
  view.people = [];
  view.tasksById = new Map();
  if (officeHandle) {
    officeHandle.destroy();
    officeHandle = null;
  }
}

function leadTitle(lead) {
  return String(lead.lead_name || "").trim() || String(lead.username || "").trim();
}

function hqTask(row) {
  const title = String(row.title || "").trim();
  if (!title || !row.id) return null;
  return {
    id: row.id,
    agent_id: row.agent_id,
    title,
    description: row.description || "",
    status: row.status || "queued",
    priority: row.priority || "normal",
    created_at: row.created_at || row.updated_at || "",
    updated_at: row.updated_at || "",
    completed_at: row.completed_at || "",
    estimate_minutes: row.estimate_minutes,
    started_at: row.started_at || "",
    station: row.station || ""
  };
}

function assignedIds(tasks, agents) {
  const ids = [];
  const workers = new Set();
  (tasks || []).forEach((task) => {
    if (task.station) ids.push(task.station);
    if (task.agent_id) workers.add(task.agent_id);
  });
  (agents || []).forEach((row) => {
    if (workers.has(row.id) && row.station) ids.push(row.station);
  });
  return ids;
}

function planKeyOf(plan) {
  const steps = (plan.pipeline || []).map((station) => station.id).join(",");
  const balcony = plan.balcony ? plan.balcony.id : "";
  return steps + "|" + balcony;
}

function agentWork(agent, tasks) {
  if (!agent || agent.status === "paused") return "paused";
  const open = tasks.filter((task) => task.status !== "done");
  if (open.some((task) => task.status === "needs_diego")) return "needs";
  if (open.some((task) => task.status === "blocked")) return "blocked";
  if (open.some((task) => task.status === "in_progress")) return "active";
  if (open.some((task) => task.status === "queued")) return "queued";
  return open.length ? "active" : "clear";
}

function personRecord(agent, tasks, plan, businessId) {
  const current = agent.status === "paused" ? null : activeTask(tasks);
  const home = setterHome(agent, plan, businessId);
  const station = current ? setterTaskStation(current, agent, plan, businessId) : home;
  return {
    id: agent.id,
    name: agent.name,
    color: agent.color,
    outside: false,
    work: agentWork(agent, tasks),
    home,
    station: agent.station || "",
    errand: current && station && station !== home ? station : "",
    taskId: current ? current.id : ""
  };
}

function colorOf(agent) {
  const color = asObject(agent.avatar).color;
  return /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : "#c04ad0";
}

async function loadWorkforce(supabase, agent) {
  const tasksById = new Map();
  let conversations = 0;
  const leadsRes = await supabase.from("client_ai_setter_leads").select("agent_id, lead_name, username, stage, last_message_time, is_converted").eq("agent_id", agent.id).order("last_message_time", { ascending: false }).limit(200);
  if (!leadsRes.error) conversations = (leadsRes.data || []).filter((lead) => leadTitle(lead)).length;

  let hqTasks = [];
  const taskColumns = "id, agent_id, business_id, setter_id, title, description, status, priority, station, created_at, updated_at, completed_at, estimate_minutes, started_at";
  const [byBusiness, bySetter] = await Promise.all([
    supabase.from("hq_tasks").select(taskColumns).eq("business_id", agent.id).limit(200),
    supabase.from("hq_tasks").select(taskColumns).eq("setter_id", agent.id).limit(200)
  ]);
  const seenTask = new Set();
  [...(byBusiness.error ? [] : byBusiness.data || []), ...(bySetter.error ? [] : bySetter.data || [])].forEach((row) => {
    if (!row || seenTask.has(row.id)) return;
    seenTask.add(row.id);
    const task = hqTask(row);
    if (task) hqTasks.push(task);
  });

  let hqAgents = [];
  const agentRes = await supabase.from("hq_agents").select("id, source_id, name, title, status, avatar, station");
  if (!agentRes.error) hqAgents = (agentRes.data || []).filter((row) => !hiddenStatus(row.status));

  const plan = withAssigned(setterPlan(agent.agent_name || "DM setter"), assignedIds(hqTasks, hqAgents));
  const setterTasks = hqTasks.filter((row) => !row.agent_id || row.agent_id === agent.id);
  tasksById.set(agent.id, setterTasks);
  const people = [personRecord({
    id: agent.id,
    name: agent.agent_name || "DM setter",
    color: "#FF8A3D",
    status: agent.status || "active",
    station: ""
  }, setterTasks, plan, agent.id)];

  const onboarding = hqAgents.find((row) => row.source_id === ONBOARDING_ID || row.id === ONBOARDING_ID || row.name === ONBOARDING_NAME || row.name === "Onboarding Prompt Builder");
  const onboardRow = onboarding || (agentRes.error ? { id: ONBOARDING_ID, name: ONBOARDING_NAME, status: "active", avatar: { color: "#c04ad0" } } : null);
  if (onboardRow && !hiddenStatus(onboardRow.status)) {
    const owned = hqTasks.filter((row) => row.agent_id === onboardRow.id);
    tasksById.set(onboardRow.id, owned);
    people.push(personRecord({
      id: onboardRow.id,
      name: onboardRow.name || ONBOARDING_NAME,
      color: colorOf(onboardRow),
      status: onboardRow.status || "active",
      station: onboardRow.station || ""
    }, owned, plan, agent.id));
  }

  const seen = new Set(people.map((person) => person.id));
  hqTasks.forEach((row) => {
    if (!row.agent_id || seen.has(row.agent_id)) return;
    const worker = hqAgents.find((item) => item.id === row.agent_id);
    if (!worker) return;
    seen.add(worker.id);
    const mine = hqTasks.filter((item) => item.agent_id === worker.id);
    tasksById.set(worker.id, mine);
    people.push(personRecord({
      id: worker.id,
      name: worker.name,
      color: colorOf(worker),
      status: worker.status,
      station: worker.station || ""
    }, mine, plan, agent.id));
  });

  return { people, tasksById, conversations, plan, planKey: planKeyOf(plan) };
}

function workLabel(work) {
  const labels = { paused: "Paused", clear: "Idle", needs: "Needs Diego", active: "Active", queued: "Queued", blocked: "Blocked" };
  return labels[work] || "Idle";
}

function noteTasks(tasksById) {
  tasksById.forEach((tasks) => {
    tasks.forEach((task) => {
      const prev = seenStatus.get(task.id);
      if (prev && prev !== "done" && task.status === "done") flashes.set(task.id, Date.now());
      seenStatus.set(task.id, task.status);
    });
  });
}

function flashFor(tasks) {
  const now = Date.now();
  flashes.forEach((at, id) => {
    if (now - at > 1600) flashes.delete(id);
  });
  return (tasks || []).find((task) => flashes.has(task.id)) || null;
}

function estimateLine(row) {
  const minutes = row.estimated ? row.estimate + " min est." : row.estimate + " min";
  const finish = row.task.status === "blocked" ? "waiting" : "finishes " + madridTime(row.finish) + " Madrid";
  return minutes + " · " + finish;
}

function showPanel(person, tasks) {
  const panel = document.getElementById("wf-panel");
  if (!panel) return;
  const rows = timeline(tasks, new Date());
  const body = [
    el("div", { class: "wf-panel-bar" }, [
      el("h2", { text: person.name }),
      el("button", { type: "button", class: "btn ghost sm", id: "wf-close" }, ["Close"])
    ]),
    el("p", { class: "wf-quiet" }, [
      "Status ",
      el("span", { class: "wf-status", text: workLabel(person.work) })
    ])
  ];
  if (person.id === view.setterId && view.conversations) {
    body.push(el("p", { class: "wf-quiet", text: view.conversations + " recent conversations stay in the lead list." }));
  }
  if (!rows.length) body.push(el("p", { class: "wf-quiet", text: "Queue is empty. This agent is idle." }));
  [["now", "Now"], ["next", "Next"], ["later", "Later"]].forEach(([lane, label]) => {
    const items = rows.filter((row) => row.lane === lane);
    if (!items.length) return;
    body.push(el("h3", { class: "wf-lane", text: label }));
    items.forEach((row) => {
      body.push(el("div", { class: "wf-task" }, [
        el("strong", { text: row.task.title }),
        el("small", { text: estimateLine(row) })
      ]));
    });
  });
  const done = recentDone(tasks);
  body.push(el("h3", { class: "wf-lane", text: "Recent" }));
  if (!done.length) body.push(el("p", { class: "wf-quiet", text: "No tasks yet." }));
  done.forEach((task) => {
    body.push(el("div", { class: "wf-task" }, [
      el("strong", { text: task.title }),
      el("small", { text: "Done" })
    ]));
  });
  panel.hidden = false;
  panel.dataset.agent = person.id;
  panel.replaceChildren(...body);
  panel.querySelector("#wf-close").addEventListener("click", () => {
    panel.hidden = true;
  });
}

function showBrain() {
  const panel = document.getElementById("wf-panel");
  if (!panel) return;
  const name = (view.agent && view.agent.agent_name) || "this business";
  const sections = liveSections(view.agent && view.agent.prompt_sections);
  const picked = sections.filter((section) => ["identity", "style", "context"].includes(section.id) && section.text);
  const body = [
    el("div", { class: "wf-panel-bar" }, [
      el("h2", { text: "Brand Brain" }),
      el("button", { type: "button", class: "btn ghost sm", id: "wf-close" }, ["Close"])
    ]),
    el("p", { class: "wf-quiet", text: name })
  ];
  let left = 1200;
  picked.forEach((section) => {
    if (left <= 0) return;
    const text = section.text.slice(0, left);
    left -= text.length;
    body.push(el("h3", { class: "wf-lane", text: section.title }));
    body.push(el("p", { class: "wf-quiet", text }));
  });
  if (!picked.length) {
    body.push(el("p", { class: "wf-quiet", text: "Brand Brain for " + name + " holds the offer and the voice." }));
  }
  panel.hidden = false;
  panel.dataset.agent = "brand-brain";
  panel.replaceChildren(...body);
  panel.querySelector("#wf-close").addEventListener("click", () => {
    panel.hidden = true;
  });
}

function workforceCards() {
  const cards = [];
  const seen = new Set();
  const plan = view.plan;
  if (!plan) return cards;
  view.people.forEach((person) => {
    const tasks = view.tasksById.get(person.id) || [];
    const agent = { id: person.id, name: person.name, station: person.station || "" };
    const push = (task) => {
      if (!task || seen.has(task.id) || task.status === "done") return;
      const spot = setterCardSpot(task, agent, plan, view.setterId);
      if (!spot) return;
      seen.add(task.id);
      cards.push({ id: task.id, title: task.title, spot, glow: task.status === "needs_diego" });
    };
    if (person.work !== "paused") push(activeTask(tasks));
    tasks.forEach((task) => {
      if (task.status === "needs_diego") push(task);
    });
  });
  return cards;
}

function openSelection(id) {
  if (id === "brand-brain") {
    showBrain();
    return;
  }
  const taskId = String(id || "").startsWith("task:") ? String(id).slice(5) : "";
  if (taskId) {
    for (const [agentId, tasks] of view.tasksById) {
      if (!tasks.some((task) => task.id === taskId)) continue;
      const person = view.people.find((row) => row.id === agentId);
      if (person) showPanel(person, tasks);
      return;
    }
    return;
  }
  const person = view.people.find((row) => row.id === id);
  if (person) showPanel(person, view.tasksById.get(person.id) || []);
}

function placeBadges(items) {
  const labels = document.getElementById("wf-labels");
  if (!labels) return;
  const seen = new Set();
  items.forEach((item) => {
    if (item.id === "meeting") return;
    if (item.id === "brand-brain") {
      seen.add(item.id);
      let node = badges.get(item.id);
      if (!node) {
        node = el("button", { type: "button", class: "wf-badge", "data-action": "open-brain" });
        labels.append(node);
        badges.set(item.id, node);
      }
      if (node.dataset.sig !== "brain") {
        node.dataset.sig = "brain";
        node.replaceChildren(el("span", { class: "wf-pill", text: "Brand Brain" }));
        node.setAttribute("aria-label", "Brand Brain");
      }
      node.style.left = item.x + "px";
      node.style.top = item.y + "px";
      node.hidden = !item.visible;
      node.onclick = () => showBrain();
      return;
    }
    const person = view.people.find((row) => row.id === item.id);
    if (!person) return;
    seen.add(item.id);
    let node = badges.get(item.id);
    if (!node) {
      node = el("button", { type: "button", class: "wf-badge" });
      labels.append(node);
      badges.set(item.id, node);
    }
    const tasks = view.tasksById.get(item.id) || [];
    const current = person.work === "paused" ? null : activeTask(tasks);
    const progress = current ? progressOf(current, new Date()) : null;
    const flash = flashFor(tasks);
    const sig = [person.name, current ? current.id : "", progress ? Math.round(progress.ratio * 100) : "", progress ? leftLabel(progress) : "", flash ? flash.id : ""].join("|");
    if (node.dataset.sig !== sig) {
      node.dataset.sig = sig;
      const bar = progress ? el("span", { class: "wf-progress", "aria-hidden": "true" }, [el("i")]) : null;
      if (bar) bar.firstChild.style.width = Math.round(progress.ratio * 100) + "%";
      node.replaceChildren(
        el("span", { class: "wf-pill", text: person.name }),
        flash ? el("span", { class: "wf-check", text: "Done · " + flash.title }) : null,
        current ? el("span", { class: "wf-bubble", text: current.title }) : null,
        bar,
        progress ? el("span", { class: "wf-left", text: leftLabel(progress) }) : null
      );
      node.setAttribute("aria-label", person.name + (current ? ", " + current.title + ", " + leftLabel(progress) : ""));
    }
    node.style.left = item.x + "px";
    node.style.top = item.y + "px";
    node.hidden = !item.visible;
    node.onclick = () => showPanel(person, view.tasksById.get(person.id) || []);
  });
  badges.forEach((node, id) => {
    if (!seen.has(id)) {
      node.remove();
      badges.delete(id);
    }
  });
}

function rosterList(people, tasksById) {
  const list = el("div", { class: "hq-roster" });
  people.forEach((person) => {
    list.append(el("button", { type: "button" }, [
      el("span", { text: person.name }),
      el("span", { text: person.work === "paused" ? "Paused" : "" })
    ]));
    list.lastChild.addEventListener("click", () => showPanel(person, tasksById.get(person.id) || []));
  });
  return list;
}

export async function mountWorkforce(supabase, agent, host) {
  cancelWorkforce();
  const token = officeToken;
  document.body.classList.add("biz-workforce");
  host.replaceChildren(
    el("div", { class: "wf-office" }, [
      el("div", { id: "wf-stage", class: "wf-stage", role: "application", "aria-label": "Workforce. Click an agent to see their tasks." }),
      el("div", { id: "wf-labels" }),
      el("p", { id: "wf-empty", class: "wf-empty", hidden: true })
    ]),
    el("aside", { id: "wf-panel", hidden: true, "aria-label": "Agent tasks" })
  );

  const data = await loadWorkforce(supabase, agent);
  if (token !== officeToken) return;
  view.people = data.people;
  view.tasksById = data.tasksById;
  view.conversations = data.conversations || 0;
  view.setterId = agent.id;
  view.plan = data.plan;
  view.planKey = data.planKey;
  view.agent = agent;
  view.host = host;
  noteTasks(data.tasksById);
  const empty = document.getElementById("wf-empty");
  if (!data.people.length) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = "No agents are assigned to this business yet.";
    }
    return;
  }
  if (supabase.channel) {
    liveClient = supabase;
    taskChannel = supabase.channel("workforce-" + agent.id);
    taskChannel.on("postgres_changes", { event: "*", schema: "public", table: "hq_tasks" }, () => {
      refreshWorkforce(supabase, agent, token);
    });
    taskChannel.subscribe();
  }

  const hostStage = document.getElementById("wf-stage");
  try {
    const scene = await import("../admin/office/scene.js");
    if (token !== officeToken || !hostStage) return;
    officeHandle = await scene.createScene(hostStage, {
      layout: "factory",
      plan: view.plan,
      onSelect(id) {
        openSelection(id);
      },
      onFrame(payload) {
        placeBadges(payload.labels || []);
      }
    });
    if (token !== officeToken) {
      officeHandle.destroy();
      officeHandle = null;
      return;
    }
    officeHandle.setLoop(() => false);
    officeHandle.update(view.people, workforceCards());
  } catch {
    if (token !== officeToken || !hostStage) return;
    hostStage.replaceChildren(
      el("p", { class: "wf-quiet", text: "This browser could not start the 3D office, so the roster is listed instead." }),
      rosterList(view.people, view.tasksById)
    );
  }
}

async function refreshWorkforce(supabase, agent, token) {
  const data = await loadWorkforce(supabase, agent);
  if (token !== officeToken) return;
  if (data.planKey !== view.planKey && view.host) {
    mountWorkforce(supabase, agent, view.host);
    return;
  }
  view.people = data.people;
  view.tasksById = data.tasksById;
  view.conversations = data.conversations || 0;
  view.plan = data.plan;
  noteTasks(data.tasksById);
  if (officeHandle) officeHandle.update(view.people, workforceCards());
  const panel = document.getElementById("wf-panel");
  const openId = panel && panel.dataset.agent;
  if (panel && !panel.hidden && openId === "brand-brain") showBrain();
  else if (panel && !panel.hidden && openId) {
    const person = view.people.find((row) => row.id === openId);
    if (person) showPanel(person, view.tasksById.get(person.id) || []);
  }
}

export function fixtureClient(seed) {
  const db = {
    hq_agents: seed.agents || [],
    hq_tasks: seed.tasks || [],
    client_ai_setter_leads: seed.leads || []
  };
  return {
    from(name) {
      const builder = {
        filters: [],
        select() { return this; },
        eq(column, value) { this.filters.push([column, value]); return this; },
        order() { return this; },
        limit() { return this; },
        then(resolve) {
          const rows = (db[name] || []).filter((row) => builder.filters.every(([column, value]) => row[column] === value));
          resolve({ data: rows, error: null });
        }
      };
      return builder;
    }
  };
}
