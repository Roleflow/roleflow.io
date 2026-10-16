import { toast } from "../auth/ui.js";

const ROLES = [
  {
    id: "outreach",
    name: "Outreach Agent",
    room: "Outreach",
    gx: 0,
    gz: -1,
    color: 0xe8b04a,
    phase: 0.4,
    text: "Sends targeted messages to new followers, reads Instagram continuously, and sends messages or voice notes in reply to comments."
  },
  {
    id: "follow_up",
    name: "Follow Up Agent",
    room: "Follow Up",
    gx: -1,
    gz: 0,
    color: 0xc0409a,
    phase: 1.7,
    text: "Follows up with leads who warmed up but stopped midway."
  },
  {
    id: "setting",
    name: "Setting Agent",
    room: "Setting",
    gx: 1,
    gz: 0,
    color: 0xff8a3d,
    phase: 2.8,
    text: "Replies to every inbound message. This is the live setter for this business."
  }
];

const STATUSES = [
  ["active", "Active"],
  ["paused", "Paused"],
  ["not_set_up", "Not set up"]
];

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

function scrub(message) {
  return String(message || "").replace(/tailortalk|zerochats/ig, "the setter service");
}

function missing(error) {
  return error && /schema cache|does not exist|PGRST205|PGRST204/i.test(error.message || "");
}

function shown(value) {
  return value == null || value === "" ? "—" : String(value);
}

function statusLabel(status) {
  return STATUSES.find(([id]) => id === status)?.[1] || "Not set up";
}

function defaultStatus(role, agent) {
  if (role !== "setting") return "not_set_up";
  return agent.status === "paused" ? "paused" : "active";
}

function metricRows(role, counts) {
  if (role === "outreach") return [["New-follower messages", null], ["Comment replies", null]];
  if (role === "follow_up") return [["Follow-ups recorded", counts.followups], ["Warm, quiet 3 days", counts.warm_quiet]];
  return [["Conversations", counts.conversations], ["Booked", counts.booked]];
}

function asCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pendingFor(role, counts) {
  if (role === "follow_up") return asCount(counts.warm_quiet);
  if (role === "setting") {
    const conversations = asCount(counts.conversations);
    const booked = asCount(counts.booked);
    if (conversations == null || booked == null) return null;
    return Math.max(0, conversations - booked);
  }
  return null;
}

function pendingLabel(value) {
  return value == null ? "— pending" : value + " pending";
}

export async function mountWorkforce(supabase, agent, host, canEdit, cachedStats) {
  host.innerHTML = "";
  const panel = el("section", { id: "workforce" });
  panel.append(el("h2", { text: "Workforce" }));
  panel.append(el("p", { text: "Three robots share this office. Open a robot or its room for the role, status, and counts from the lead sync. A dash means that number is not in the sync." }));
  const stage = el("div", { class: "office-stage", id: "office-stage" });
  const skeleton = el("div", { class: "office-skeleton" }, [
    el("span", { class: "skel" }),
    el("span", { class: "skel short" })
  ]);
  stage.append(skeleton);
  const note = el("p", { class: "err", id: "workforce-note", role: "status" });
  const dialog = el("dialog", { class: "agent-modal", id: "agent-modal", "aria-labelledby": "agent-modal-title" });
  panel.append(stage, note, dialog);
  host.append(panel);

  const stored = new Map();
  const statusRes = await supabase.from("business_workforce").select("role, status").eq("agent_id", agent.id);
  if (statusRes.error && !missing(statusRes.error)) note.textContent = scrub(statusRes.error.message);
  (statusRes.data || []).forEach((row) => stored.set(row.role, row.status));

  let counts = { conversations: null, booked: null, followups: null, warm_quiet: null };
  const countRes = await supabase.rpc("business_workforce_counts", { p_agent: agent.id });
  if (countRes.data && typeof countRes.data === "object") counts = { ...counts, ...countRes.data };
  else if (cachedStats) {
    const conversations = Number(cachedStats.total_leads);
    const booked = Number(cachedStats.converted_count);
    if (Number.isFinite(conversations)) counts.conversations = conversations;
    if (Number.isFinite(booked)) counts.booked = booked;
  }

  let opener = null;
  let office = { setStatus() {}, stop() {} };
  const currentStatus = (role) => stored.get(role.id) || defaultStatus(role.id, agent);
  const pendings = ROLES.map((role) => pendingFor(role.id, counts));
  const queueKnown = pendings.every((value) => value != null);

  dialog.addEventListener("click", (event) => {
    const sheet = dialog.querySelector(".agent-sheet");
    if (!sheet || !sheet.contains(event.target)) dialog.close();
  });
  dialog.addEventListener("close", () => {
    if (opener && opener.isConnected) opener.focus();
  });

  try {
    const { mountOffice } = await import("./office-scene.js");
    office = await mountOffice(stage, {
      agents: ROLES.map((role) => ({
        ...role,
        status: currentStatus(role),
        lines: metricRows(role.id, counts).map(([label, value]) => ({ label, value: shown(value) })),
        pendingLabel: pendingLabel(pendingFor(role.id, counts))
      })),
      queue: ROLES.map((role) => ({
        label: role.room,
        value: shown(pendingFor(role.id, counts))
      })),
      queueFooter: queueKnown ? pendings.reduce((sum, value) => sum + value, 0) + " pending" : "— pending",
      onOpen(id) {
        const role = ROLES.find((item) => item.id === id);
        const pill = stage.querySelector('.agent-pill[data-role="' + id + '"]');
        if (role) openRole(role, pill);
      }
    });
    skeleton.remove();
    stage.dataset.ready = "true";
  } catch (error) {
    skeleton.remove();
    note.textContent = "The office view could not be loaded.";
  }

  function statusLine(status) {
    return el("span", { class: "status-line" }, [
      el("i", { class: status === "active" ? "dot on" : "dot" }),
      statusLabel(status)
    ]);
  }

  function openRole(role, button) {
    opener = button || null;
    renderModal(role);
    if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
    else dialog.setAttribute("open", "");
    const close = dialog.querySelector(".modal-close");
    if (close) close.focus();
  }

  function renderModal(role) {
    const status = currentStatus(role);
    const sheet = el("div", { class: "agent-sheet" });
    const head = el("div", { class: "modal-head" });
    head.append(el("h3", { id: "agent-modal-title", text: role.name }));
    const close = el("button", { type: "button", class: "btn ghost sm modal-close" }, ["Close"]);
    close.addEventListener("click", () => dialog.close());
    head.append(close);
    sheet.append(head);
    sheet.append(el("p", { text: role.text }));
    sheet.append(statusLine(status));
    if (canEdit && !statusRes.error) {
      const group = el("div", { class: "status-toggle", role: "group", "aria-label": role.name + " status" });
      STATUSES.forEach(([id, title]) => {
        const button = el("button", {
          type: "button",
          class: "btn ghost sm",
          "aria-pressed": id === status ? "true" : "false"
        }, [title]);
        button.addEventListener("click", () => saveStatus(role, id, button));
        group.append(button);
      });
      sheet.append(group);
    } else if (statusRes.error && missing(statusRes.error)) {
      sheet.append(el("p", { class: "mute", text: "Status can be saved after the assets migration." }));
    }
    const grid = el("dl", { class: "desk-metrics" });
    metricRows(role.id, counts).forEach(([label, value]) => {
      grid.append(el("div", {}, [
        el("dt", { text: label }),
        el("dd", { text: shown(value) })
      ]));
    });
    sheet.append(grid);
    dialog.replaceChildren(sheet);
  }

  async function saveStatus(role, status, button) {
    note.textContent = "";
    button.disabled = true;
    const saved = await supabase.from("business_workforce").upsert({
      agent_id: agent.id,
      role: role.id,
      status,
      updated_at: new Date().toISOString()
    }, { onConflict: "agent_id,role" });
    button.disabled = false;
    if (saved.error) {
      const message = missing(saved.error) ? "Apply the assets migration, then refresh." : scrub(saved.error.message);
      note.textContent = message;
      toast(message, "bad");
      return;
    }
    stored.set(role.id, status);
    office.setStatus(role.id, status);
    if (dialog.open) {
      renderModal(role);
      const pressed = dialog.querySelector("[aria-pressed=true]");
      if (pressed) pressed.focus();
    }
    toast(role.name + " is " + statusLabel(status) + ".");
  }
}
