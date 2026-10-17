const ONBOARDING_ID = "dff340d8-ace8-47df-baa4-a78c3a4d5979";
const ONBOARDING_NAME = "Onboarding & Client Success";

let officeHandle = null;
let officeToken = 0;
const badges = new Map();

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
  if (officeHandle) {
    officeHandle.destroy();
    officeHandle = null;
  }
}

function leadTitle(lead) {
  return String(lead.lead_name || "").trim() || String(lead.username || "").trim();
}

function leadTask(lead) {
  const title = leadTitle(lead);
  if (!title) return null;
  return {
    id: "lead:" + title,
    title,
    status: lead.is_converted ? "done" : "open",
    detail: lead.stage ? String(lead.stage) : "",
    when: lead.last_message_time || ""
  };
}

function hqTask(row) {
  const title = String(row.title || "").trim();
  if (!title) return null;
  return {
    id: row.id,
    title,
    status: row.status === "done" ? "done" : "open",
    hqStatus: row.status,
    detail: row.status === "done" ? "" : String(row.status || "").replaceAll("_", " "),
    when: row.updated_at || ""
  };
}

function setterWork(agent, tasks) {
  if (agent.status === "paused") return "paused";
  const open = tasks.filter((task) => task.status !== "done");
  if (!open.length) return "clear";
  const recent = open.some((task) => {
    const at = new Date(task.when || 0).getTime();
    return at && Date.now() - at < 3 * 86400000;
  });
  return recent ? "active" : "queued";
}

function agentWork(agent, tasks) {
  if (!agent || agent.status === "paused") return "paused";
  const open = tasks.filter((task) => task.status !== "done");
  if (open.some((task) => task.hqStatus === "needs_diego")) return "needs";
  if (open.some((task) => task.hqStatus === "blocked")) return "blocked";
  if (open.some((task) => task.hqStatus === "in_progress")) return "active";
  if (open.some((task) => task.hqStatus === "queued")) return "queued";
  return open.length ? "active" : "clear";
}

function colorOf(agent) {
  const color = asObject(agent.avatar).color;
  return /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : "#c04ad0";
}

async function loadWorkforce(supabase, agent) {
  const tasksById = new Map();
  const setterTasks = [];
  const leadsRes = await supabase.from("client_ai_setter_leads").select("agent_id, lead_name, username, stage, last_message_time, is_converted").eq("agent_id", agent.id).order("last_message_time", { ascending: false }).limit(200);
  if (!leadsRes.error) {
    (leadsRes.data || []).forEach((lead) => {
      const task = leadTask(lead);
      if (task && !setterTasks.some((item) => item.title === task.title && item.status === task.status)) setterTasks.push(task);
    });
  }
  tasksById.set(agent.id, setterTasks);

  let hqTasks = [];
  const taskRes = await supabase.from("hq_tasks").select("id, agent_id, title, status, updated_at").eq("setter_id", agent.id).limit(200);
  if (!taskRes.error) hqTasks = taskRes.data || [];

  let hqAgents = [];
  const agentRes = await supabase.from("hq_agents").select("id, source_id, name, title, status, avatar");
  if (!agentRes.error) hqAgents = (agentRes.data || []).filter((row) => !hiddenStatus(row.status));

  const people = [{
    id: agent.id,
    name: agent.agent_name || "DM setter",
    color: "#FF8A3D",
    outside: false,
    work: setterWork(agent, setterTasks)
  }];

  const onboarding = hqAgents.find((row) => row.source_id === ONBOARDING_ID || row.id === ONBOARDING_ID || row.name === ONBOARDING_NAME || row.name === "Onboarding Prompt Builder");
  const onboardRow = onboarding || (agentRes.error ? { id: ONBOARDING_ID, name: ONBOARDING_NAME, status: "active", avatar: { color: "#c04ad0" } } : null);
  if (onboardRow && !hiddenStatus(onboardRow.status)) {
    const mine = hqTasks.filter((row) => row.agent_id === onboardRow.id).map(hqTask).filter(Boolean);
    tasksById.set(onboardRow.id, mine);
    people.push({
      id: onboardRow.id,
      name: onboardRow.name || ONBOARDING_NAME,
      color: colorOf(onboardRow),
      outside: false,
      work: agentWork(onboardRow, mine)
    });
  }

  const seen = new Set(people.map((person) => person.id));
  hqTasks.forEach((row) => {
    if (!row.agent_id || seen.has(row.agent_id)) return;
    const worker = hqAgents.find((item) => item.id === row.agent_id);
    if (!worker) return;
    seen.add(worker.id);
    const mine = hqTasks.filter((item) => item.agent_id === worker.id).map(hqTask).filter(Boolean);
    tasksById.set(worker.id, mine);
    people.push({
      id: worker.id,
      name: worker.name,
      color: colorOf(worker),
      outside: false,
      work: agentWork(worker, mine)
    });
  });

  return { people, tasksById };
}

function taskList(title, tasks) {
  const block = el("section", {}, [el("h3", { text: title })]);
  if (!tasks.length) {
    block.append(el("p", { class: "wf-quiet", text: "No tasks yet." }));
    return block;
  }
  tasks.forEach((task) => {
    block.append(el("div", { class: "wf-task" }, [
      el("strong", { text: task.title }),
      task.detail ? el("small", { text: task.detail }) : null
    ]));
  });
  return block;
}

function showPanel(person, tasks) {
  const panel = document.getElementById("wf-panel");
  if (!panel) return;
  const open = tasks.filter((task) => task.status !== "done");
  const done = tasks.filter((task) => task.status === "done").slice(0, 8);
  panel.hidden = false;
  panel.replaceChildren(
    el("div", { class: "wf-panel-bar" }, [
      el("h2", { text: person.name }),
      el("button", { type: "button", class: "btn ghost sm", id: "wf-close" }, ["Close"])
    ]),
    el("p", { class: "wf-quiet" }, [
      "Status ",
      el("span", { class: "wf-status", text: person.work === "paused" ? "Paused" : person.work === "clear" ? "Clear" : person.work.replaceAll("_", " ") })
    ]),
    taskList("Open", open),
    taskList("Done", done)
  );
  panel.querySelector("#wf-close").addEventListener("click", () => {
    panel.hidden = true;
  });
}

function placeBadges(items, people, tasksById) {
  const labels = document.getElementById("wf-labels");
  if (!labels) return;
  const seen = new Set();
  items.forEach((item) => {
    if (item.id === "meeting") return;
    const person = people.find((row) => row.id === item.id);
    if (!person) return;
    seen.add(item.id);
    let node = badges.get(item.id);
    if (!node) {
      node = el("button", { type: "button", class: "wf-badge" });
      labels.append(node);
      badges.set(item.id, node);
    }
    const open = (tasksById.get(item.id) || []).find((task) => task.status !== "done");
    const bubble = open ? open.title : "";
    if (node.dataset.label !== person.name || node.dataset.bubble !== bubble) {
      node.dataset.label = person.name;
      node.dataset.bubble = bubble;
      node.replaceChildren(
        el("span", { class: "wf-pill", text: person.name }),
        bubble ? el("span", { class: "wf-bubble", text: bubble }) : null
      );
      node.setAttribute("aria-label", person.name);
    }
    node.style.left = item.x + "px";
    node.style.top = item.y + "px";
    node.hidden = !item.visible;
    node.onclick = () => showPanel(person, tasksById.get(person.id) || []);
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
  const empty = document.getElementById("wf-empty");
  if (!data.people.length) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = "No agents are assigned to this business yet.";
    }
    return;
  }

  const hostStage = document.getElementById("wf-stage");
  try {
    const scene = await import("../admin/office/scene.js");
    if (token !== officeToken || !hostStage) return;
    officeHandle = await scene.createScene(hostStage, {
      onSelect(id) {
        const person = data.people.find((row) => row.id === id);
        if (person) showPanel(person, data.tasksById.get(person.id) || []);
      },
      onFrame(payload) {
        placeBadges(payload.labels || [], data.people, data.tasksById);
      }
    });
    if (token !== officeToken) {
      officeHandle.destroy();
      officeHandle = null;
      return;
    }
    officeHandle.setLoop(() => false);
    officeHandle.update(data.people);
  } catch {
    if (token !== officeToken || !hostStage) return;
    hostStage.replaceChildren(
      el("p", { class: "wf-quiet", text: "This browser could not start the 3D office, so the roster is listed instead." }),
      rosterList(data.people, data.tasksById)
    );
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
