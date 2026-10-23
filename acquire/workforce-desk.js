import { formatDelta } from "./studio-model.js";
import { agentRole, livePrompt, scorePrompt, validCron, validZone } from "./workforce-model.js";

const TABS = [
  ["prompt", "Prompt"],
  ["routines", "Routines"],
  ["activity", "Activity"]
];

const PRESETS = [
  ["Every day 09:00 find 20 new prospects", "0 9 * * *", "Find 20 new prospects"],
  ["Every day 18:00 follow up on unanswered DMs", "0 18 * * *", "Follow up on unanswered DMs"]
];

let tab = "prompt";
let editing = false;
let draft = "";
let routineDraft = null;

export function renderDesk(ui, spec, kind) {
  const role = agentRole(spec, kind);
  const wrap = ui.el("div", { class: "desk-tools", "data-agent-role": role });
  wrap.append(autoSwitch(ui, role));
  const tabs = ui.el("div", { class: "filters", role: "tablist", "aria-label": "Agent desk" });
  TABS.forEach(([id, label]) => {
    const button = ui.el("button", { type: "button", text: label, "aria-pressed": tab === id ? "true" : "false" });
    button.addEventListener("click", () => {
      tab = id;
      ui.paint();
    });
    tabs.append(button);
  });
  wrap.append(tabs);
  if (tab === "prompt") wrap.append(promptPane(ui, role));
  if (tab === "routines") wrap.append(routinesPane(ui, role));
  if (tab === "activity") wrap.append(activityPane(ui, role));
  return wrap;
}

export function rememberDesk(role) {
  if (routineDraft && routineDraft.role !== role) routineDraft = null;
}

function autoSwitch(ui, role) {
  const row = (ui.state.agentSettings || []).find((item) => item.agent_role === role);
  const toggle = ui.el("label", { class: "switch" });
  const input = ui.el("input", { type: "checkbox", "aria-label": "Auto-approve actions" });
  input.checked = Boolean(row && row.auto_approve === true);
  input.disabled = !ui.state.canEdit;
  input.addEventListener("change", () => ui.setAutoApprove(role, input.checked));
  toggle.append(input, document.createTextNode("Auto-approve actions"));
  return toggle;
}

function promptPane(ui, role) {
  const pane = ui.el("div", { class: "desk-pane" });
  const versions = (ui.state.agentPrompts || []).filter((row) => row.agent_role === role)
    .slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const live = livePrompt(ui.state.agentPrompts || [], role);
  if (!live && !editing) {
    pane.append(ui.el("p", { text: "No prompt yet." }));
    if (ui.state.canEdit) pane.append(ui.button("Write prompt", () => {
      editing = true;
      draft = "";
      ui.paint();
    }));
    return pane;
  }
  const text = editing ? draft : (live && live.body) || "";
  const local = scorePrompt(text);
  const model = ui.state.agentPromptScore && ui.state.agentPromptScore[role];
  const shown = model && model.score != null ? model.score : local.score;
  pane.append(ui.el("h3", { text: "Prompt quality " + shown + " / 10" }));
  ((model && model.items) || local.items).forEach((item) => pane.append(ui.el("p", { text: item })));
  if (editing) {
    const area = ui.el("textarea", { rows: "10", "aria-label": "Agent prompt" });
    area.value = draft;
    area.addEventListener("input", () => {
      draft = area.value;
    });
    pane.append(area);
    const row = ui.el("div", { class: "filters" });
    row.append(ui.button("Save prompt", () => ui.saveAgentPrompt(role, draft).then((ok) => {
      if (!ok) return;
      editing = false;
      ui.paint();
    })));
    row.append(ui.button("Score with AI", () => ui.scoreAgentPrompt(role, area.value)));
    pane.append(row);
  } else if (ui.state.canEdit) {
    const row = ui.el("div", { class: "filters" });
    row.append(ui.button("Edit prompt", () => {
      editing = true;
      draft = live.body || "";
      ui.paint();
    }));
    row.append(ui.button("Score with AI", () => ui.scoreAgentPrompt(role, live.body || "")));
    pane.append(row);
  }
  pane.append(ui.el("h3", { text: "Versions" }));
  if (!versions.length) pane.append(ui.el("p", { text: "No versions yet." }));
  versions.slice(0, 12).forEach((row, index) => {
    const previous = versions[index + 1];
    const line = ui.el("p", { text: ui.when(row.created_at) + " · " + formatDelta(previous ? row.char_count - previous.char_count : null) });
    if (ui.state.canEdit && index > 0) {
      const restore = ui.button("Restore", () => ui.restoreAgentPrompt(role, row.body));
      restore.classList.add("ghost");
      line.append(document.createTextNode(" "));
      line.append(restore);
    }
    pane.append(line);
  });
  return pane;
}

function routinesPane(ui, role) {
  const pane = ui.el("div", { class: "desk-pane" });
  const rows = (ui.state.agentRoutines || []).filter((row) => row.agent_role === role);
  if (!rows.length) pane.append(ui.el("p", { text: "No routines yet." }));
  rows.forEach((row) => {
    const block = ui.el("div", { class: "desk-routine" });
    block.append(ui.el("strong", { text: row.name }));
    block.append(ui.el("p", { text: row.cron + " · " + row.timezone + (row.enabled === false ? " · paused" : "") }));
    if (row.instructions) block.append(ui.el("p", { text: row.instructions }));
    if (ui.state.canEdit) {
      const controls = ui.el("div", { class: "filters" });
      controls.append(ui.button("Edit", () => {
        routineDraft = { ...row, role };
        ui.paint();
      }));
      controls.append(ui.button(row.enabled === false ? "Resume" : "Pause", () => ui.setRoutineEnabled(row, row.enabled === false)));
      block.append(controls);
    }
    pane.append(block);
  });
  if (!ui.state.canEdit) return pane;
  if (!routineDraft || routineDraft.role !== role) routineDraft = emptyRoutine(ui, role);
  const current = routineDraft;
  pane.append(ui.el("h3", { text: current.id ? "Edit routine" : "Add a routine" }));
  PRESETS.forEach(([label, cron, instructions]) => {
    const button = ui.button(label, () => {
      current.name = label;
      current.cron = cron;
      current.instructions = instructions;
      current.role = role;
      ui.paint();
    });
    button.classList.add("ghost");
    pane.append(button);
  });
  const name = ui.field("Name", current.name || "");
  const cron = ui.field("Schedule", current.cron || "0 9 * * *");
  const zone = ui.field("Timezone", current.timezone || (ui.state.settings && ui.state.settings.timezone) || "Europe/Madrid");
  const instructions = ui.el("label", { text: "Instructions" });
  const area = ui.el("textarea", { rows: "4", "aria-label": "Routine instructions" });
  area.value = current.instructions || "";
  instructions.append(area);
  [name, cron, zone].forEach((item) => {
    item.input.addEventListener("input", () => {
      current.name = name.input.value;
      current.cron = cron.input.value;
      current.timezone = zone.input.value;
    });
    pane.append(item.label);
  });
  area.addEventListener("input", () => {
    current.instructions = area.value;
  });
  pane.append(instructions);
  pane.append(ui.button(current.id ? "Save routine" : "Add routine", () => {
    const error = routineError(current, role);
    if (error) return ui.toast(error, "bad");
    ui.saveRoutine({ ...current, agent_role: role }).then((ok) => {
      if (!ok) return;
      routineDraft = emptyRoutine(ui, role);
      ui.paint();
    });
  }));
  return pane;
}

function activityPane(ui, role) {
  const pane = ui.el("div", { class: "desk-pane" });
  const runs = (ui.state.agentRuns || []).filter((row) => row.agent_role === role);
  const actions = (ui.state.agentActions || []).filter((row) => row.agent_role === role);
  pane.append(ui.el("h3", { text: "Runs" }));
  if (!runs.length) pane.append(ui.el("p", { text: "No runs yet." }));
  runs.slice(0, 8).forEach((row) => {
    const line = row.status + (row.summary ? " · " + row.summary : "") + (row.error ? " · " + row.error : "");
    pane.append(ui.el("p", { text: line + " · " + ui.when(row.started_at) }));
  });
  pane.append(ui.el("h3", { text: "Actions" }));
  if (!actions.length) pane.append(ui.el("p", { text: "No actions yet." }));
  actions.slice(0, 12).forEach((row) => {
    const block = ui.el("div", { class: "desk-routine" });
    block.append(ui.el("p", { text: row.type + (row.target ? " · " + row.target : "") + " · " + row.status }));
    if (row.error) block.append(ui.el("p", { text: row.error }));
    if (ui.state.canEdit && row.status === "proposed") {
      const controls = ui.el("div", { class: "filters" });
      controls.append(ui.button("Approve", () => ui.approveAction(row)));
      const reject = ui.button("Reject", () => ui.rejectAction(row));
      reject.classList.add("ghost");
      controls.append(reject);
      block.append(controls);
    }
    pane.append(block);
  });
  return pane;
}

function emptyRoutine(ui, role) {
  return {
    role,
    name: "",
    cron: "0 9 * * *",
    timezone: (ui.state.settings && ui.state.settings.timezone) || "Europe/Madrid",
    instructions: "",
    enabled: true
  };
}

function routineError(row, role) {
  if (!String(row.name || "").trim()) return "Name the routine.";
  if (!validCron(row.cron)) return "Use a five-field schedule.";
  if (!validZone(String(row.timezone || "").trim())) return "Use a timezone such as Europe/Madrid.";
  if (!role) return "Choose an agent.";
  return "";
}
