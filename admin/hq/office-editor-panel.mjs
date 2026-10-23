import { madridStamp } from "../office/office-editor.mjs";
import { stationSpot } from "../office/workforce-model.mjs";

const KINDS = [
  ["assign", "Sends"],
  ["handoff", "Hands off"],
  ["read", "Reads"]
];

function field(el, label, control) {
  return el("label", { class: "office-editor-field" }, [label, control]);
}

function stationFields(el, station, options) {
  const agents = options.agents;
  return el("div", { class: "office-editor-row" }, [
    field(el, "Name", el("input", {
      type: "text",
      value: station.role,
      maxlength: "60",
      "data-edit": "label",
      "data-key": station.id,
      "aria-label": "Name for " + station.role
    })),
    field(el, "Job description", el("textarea", {
      rows: "2",
      maxlength: "2000",
      "data-edit": "description",
      "data-key": station.id,
      "aria-label": "Description for " + station.role
    }, [station.description || ""])),
    field(el, "Role", el("input", {
      type: "text",
      value: station.agentRole || "",
      maxlength: "80",
      "data-edit": "agent-role",
      "data-key": station.id,
      "aria-label": "Role for " + station.role
    })),
    field(el, "Agent", el("select", {
      "data-edit": "agent",
      "data-key": station.id,
      "aria-label": "Agent for " + station.role
    }, agents.map(([value, label]) => el("option", {
      value,
      text: label,
      selected: (station.hqAgentId || "") === value
    })))),
    options.actions || null
  ]);
}

export function officeEditorPanel(el, edit, extras) {
  const draft = edit.draft;
  if (!draft) return el("p", { text: "Opening the editor…" });
  const agents = [["", "No agent"]].concat((extras.agents || []).filter((agent) => agent && agent.status !== "retired").map((agent) => [agent.id, agent.name]));
  const points = [[draft.overseer.id, draft.overseer.role]].concat(draft.stations.map((station) => [station.id, station.role]));
  const tasks = extras.tasks || [];
  const taskAgents = agents.filter((pair) => pair[0]);
  return el("div", { class: "office-editor-body" }, [
    el("div", { class: "office-editor-bar" }, [
      el("h2", { text: edit.scope === "hq" ? "Edit HQ office" : "Edit office" }),
      el("button", { type: "button", class: "office-editor-close", "data-action": "toggle-office-edit", "aria-label": "Close editor" }, ["×"])
    ]),
    extras.floorNote ? el("p", { class: "office-editor-note", text: "The floor stays the org chart. These stations are where tasks land, and HQ keys stay the legacy station names." }) : null,
    el("h3", { text: "Stations" }),
    stationFields(el, draft.overseer, { agents, actions: el("p", { class: "office-editor-note", text: "Overseer" }) }),
    ...draft.stations.map((station, index) => stationFields(el, station, {
      agents,
      actions: el("div", { class: "office-editor-actions" }, [
        el("button", { type: "button", class: "btn ghost sm", "data-action": "editor-up", "data-id": station.id, disabled: index === 0 ? true : null }, ["Up"]),
        el("button", { type: "button", class: "btn ghost sm", "data-action": "editor-down", "data-id": station.id, disabled: index === draft.stations.length - 1 ? true : null }, ["Down"]),
        el("button", { type: "button", class: "btn ghost sm", "data-action": "editor-remove-station", "data-id": station.id }, ["Archive"])
      ])
    })),
    el("div", { class: "office-editor-actions" }, [
      el("input", { id: "editor-new-station", type: "text", maxlength: "60", placeholder: "New station name", "aria-label": "New station name" }),
      el("button", { type: "button", class: "btn sm", "data-action": "editor-add-station" }, ["Add station"])
    ]),
    el("h3", { text: "Next-step arrows" }),
    ...draft.edges.map((edge, index) => el("div", { class: "office-editor-row" }, [
      field(el, "From", el("select", { "data-edit": "edge-from", "data-index": String(index), "aria-label": "From station" }, points.map(([value, label]) => el("option", { value, text: label, selected: edge.from === value })))),
      field(el, "To", el("select", { "data-edit": "edge-to", "data-index": String(index), "aria-label": "To station" }, points.map(([value, label]) => el("option", { value, text: label, selected: edge.to === value })))),
      field(el, "Kind", el("select", { "data-edit": "edge-kind", "data-index": String(index), "aria-label": "Arrow kind" }, KINDS.map(([value, label]) => el("option", { value, text: label, selected: edge.kind === value })))),
      field(el, "Label", el("input", { type: "text", value: edge.label, maxlength: "60", "data-edit": "edge-label", "data-index": String(index), "aria-label": "Arrow label" })),
      el("button", { type: "button", class: "btn ghost sm", "data-action": "editor-remove-edge", "data-index": String(index) }, ["Delete arrow"])
    ])),
    el("button", { type: "button", class: "btn ghost sm", "data-action": "editor-add-edge" }, ["Add arrow"]),
    el("h3", { text: "Tasks" }),
    tasks.length ? el("ul", { class: "office-editor-tasks" }, tasks.map((task) => el("li", {}, [
      el("span", { text: task.title }),
      el("select", {
        "data-action": "editor-move-task",
        "data-id": task.id,
        "aria-label": "Move " + task.title
      }, [["", "Move to…"]].concat(points).map(([value, label]) => el("option", { value, text: label, selected: stationSpot(draft, task, extras.stationIndex) === value })))
    ]))) : el("p", { class: "office-editor-note", text: "No open tasks in this office." }),
    el("div", { class: "office-editor-row" }, [
      field(el, "New task", el("input", { id: "editor-task-title", type: "text", maxlength: "240", placeholder: "Task title", "aria-label": "New task title" })),
      field(el, "Station", el("select", { id: "editor-task-station", "aria-label": "Station for the new task" }, points.map(([value, label]) => el("option", { value, text: label })))),
      field(el, "Agent", el("select", { id: "editor-task-agent", "aria-label": "Agent for the new task" }, (taskAgents.length ? taskAgents : [["fixture", "Fixture preview"]]).map(([value, label]) => el("option", { value, text: label })))),
      el("button", { type: "button", class: "btn sm", "data-action": "editor-create-task" }, ["Create task"])
    ]),
    el("h3", { text: "History" }),
    (edit.revisions || []).length ? el("ul", { class: "office-editor-history" }, edit.revisions.map((revision) => el("li", {}, [
      el("strong", { text: revision.summary || "Saved the office" }),
      el("span", { text: madridStamp(revision.created_at) + " · " + (revision.created_by_name || "Admin") }),
      el("button", { type: "button", class: "btn ghost sm", "data-action": "editor-restore", "data-id": revision.id }, ["Restore"])
    ]))) : el("p", { class: "office-editor-note", text: "No revisions yet. Save to record one." }),
    el("div", { class: "office-editor-save" }, [
      field(el, "What changed", el("input", { id: "editor-summary", type: "text", maxlength: "280", placeholder: "Short summary", "aria-label": "Save summary" })),
      el("div", { class: "office-editor-save-row" }, [
        el("button", { type: "button", class: "btn sm", "data-action": "editor-save" }, ["Save"]),
        edit.notice ? el("p", {
          class: "office-editor-status",
          role: "status",
          "data-kind": edit.noticeKind === "ok" ? "ok" : "bad",
          text: edit.notice
        }) : null
      ])
    ])
  ]);
}
