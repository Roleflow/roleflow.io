import { toast } from "../auth/ui.js";

const ROLES = [
  {
    id: "outreach",
    name: "Outreach Agent",
    tone: "gold",
    text: "Sends targeted messages to new followers, reads Instagram continuously, and sends messages or voice notes in reply to comments."
  },
  {
    id: "follow_up",
    name: "Follow Up Agent",
    tone: "magenta",
    text: "Follows up with leads who warmed up but stopped midway."
  },
  {
    id: "setting",
    name: "Setting Agent",
    tone: "orange",
    text: "Replies to every inbound message. This is the live setter for this business."
  }
];

const STATUSES = [
  ["active", "Active"],
  ["paused", "Paused"],
  ["not_set_up", "Not set up"]
];

const ROBOT_SVG = `<svg class="robot TONE" viewBox="0 0 200 228" xmlns="http://www.w3.org/2000/svg" focusable="false">
  <rect x="44" y="46" width="112" height="108" rx="28" fill="#31436f"/>
  <rect x="34" y="142" width="132" height="20" rx="8" fill="#243155"/>
  <rect x="52" y="156" width="12" height="36" rx="4" fill="#31436f"/>
  <rect x="136" y="156" width="12" height="36" rx="4" fill="#31436f"/>
  <rect class="plate" x="78" y="136" width="16" height="34" rx="7"/>
  <rect class="plate" x="106" y="136" width="16" height="34" rx="7"/>
  <rect class="plate" x="62" y="82" width="76" height="58" rx="18"/>
  <rect x="80" y="96" width="40" height="16" rx="4" fill="#0A1226" opacity=".28"/>
  <circle cx="90" cy="122" r="3" fill="#0A1226" opacity=".45"/>
  <circle cx="100" cy="122" r="3" fill="#0A1226" opacity=".45"/>
  <circle cx="110" cy="122" r="3" fill="#0A1226" opacity=".45"/>
  <rect class="plate" x="88" y="72" width="24" height="14" rx="5"/>
  <line class="antenna" x1="100" y1="14" x2="100" y2="3" stroke-width="3" stroke-linecap="round"/>
  <circle class="antenna-tip" cx="100" cy="3" r="5"/>
  <rect class="plate" x="66" y="12" width="68" height="60" rx="20"/>
  <rect class="plate" x="56" y="32" width="12" height="18" rx="4"/>
  <rect class="plate" x="132" y="32" width="12" height="18" rx="4"/>
  <circle cx="86" cy="38" r="7" fill="#EEF1FA"/>
  <circle cx="114" cy="38" r="7" fill="#EEF1FA"/>
  <circle cx="88" cy="38.5" r="3.2" fill="#0A1226"/>
  <circle cx="116" cy="38.5" r="3.2" fill="#0A1226"/>
  <path d="M86 52c6 8 22 8 28 0" fill="none" stroke="#0A1226" stroke-width="2.4" stroke-linecap="round"/>
  <rect x="6" y="178" width="188" height="14" rx="4" fill="#3a4d78"/>
  <rect x="18" y="192" width="164" height="26" rx="5" fill="#1b2948"/>
  <rect x="32" y="201" width="28" height="5" rx="2" fill="#31436f"/>
  <rect x="140" y="201" width="28" height="5" rx="2" fill="#31436f"/>
  <rect x="70" y="152" width="60" height="28" rx="4" fill="#0A1226" stroke="#6d82b4" stroke-width="2"/>
  <rect class="robot-screen" x="75" y="156" width="50" height="16" rx="2"/>
  <g class="robot-arm robot-arm-l">
    <path class="arm-stroke" d="M62 100 C26 128, 36 164, 74 174" stroke-width="12" stroke-linecap="round"/>
  </g>
  <g class="robot-arm robot-arm-r">
    <path class="arm-stroke" d="M138 100 C174 128, 164 164, 126 174" stroke-width="12" stroke-linecap="round"/>
  </g>
  <rect x="58" y="170" width="84" height="10" rx="3" fill="#0A1226"/>
  <g fill="#9AA6C6">
    <rect x="66" y="173" width="6" height="4" rx="1"/>
    <rect x="76" y="173" width="6" height="4" rx="1"/>
    <rect x="86" y="173" width="6" height="4" rx="1"/>
    <rect x="96" y="173" width="6" height="4" rx="1"/>
    <rect x="106" y="173" width="6" height="4" rx="1"/>
    <rect x="116" y="173" width="6" height="4" rx="1"/>
    <rect x="126" y="173" width="6" height="4" rx="1"/>
  </g>
  <g class="robot-arm robot-arm-l"><circle class="plate" cx="74" cy="174" r="7"/></g>
  <g class="robot-arm robot-arm-r"><circle class="plate" cx="126" cy="174" r="7"/></g>
</svg>`;

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

export async function mountWorkforce(supabase, agent, host, canEdit, cachedStats) {
  host.innerHTML = "";
  const panel = el("section", { id: "workforce" });
  panel.append(el("h2", { text: "Workforce" }));
  panel.append(el("p", { text: "One robot for each agent. Open a desk for the role, status, and counts from the lead sync. A dash means that number is not in the sync." }));
  const floor = el("div", { class: "office-floor", id: "office-floor" });
  const note = el("p", { class: "err", id: "workforce-note", role: "status" });
  const dialog = el("dialog", { class: "agent-modal", id: "agent-modal", "aria-labelledby": "agent-modal-title" });
  panel.append(floor, note, dialog);
  host.append(panel);

  const stored = new Map();
  const statusRes = await supabase.from("business_workforce").select("role, status").eq("agent_id", agent.id);
  if (statusRes.error && !missing(statusRes.error)) {
    note.textContent = scrub(statusRes.error.message);
  }
  (statusRes.data || []).forEach((row) => stored.set(row.role, row.status));

  let counts = { conversations: null, booked: null, followups: null, warm_quiet: null };
  const countRes = await supabase.rpc("business_workforce_counts", { p_agent: agent.id });
  if (countRes.data && typeof countRes.data === "object") {
    counts = { ...counts, ...countRes.data };
  } else if (cachedStats) {
    const conversations = Number(cachedStats.total_leads);
    const booked = Number(cachedStats.converted_count);
    if (Number.isFinite(conversations)) counts.conversations = conversations;
    if (Number.isFinite(booked)) counts.booked = booked;
  }

  let opener = null;
  ROLES.forEach((role) => floor.append(deskButton(role)));

  dialog.addEventListener("click", (event) => {
    const sheet = dialog.querySelector(".agent-sheet");
    if (!sheet || !sheet.contains(event.target)) dialog.close();
  });
  dialog.addEventListener("close", () => {
    if (opener && opener.isConnected) opener.focus();
  });

  function currentStatus(role) {
    return stored.get(role.id) || defaultStatus(role.id, agent);
  }

  function deskButton(role) {
    const status = currentStatus(role);
    const button = el("button", {
      type: "button",
      class: "desk",
      id: "desk-" + role.id,
      "data-status": status,
      "aria-haspopup": "dialog"
    });
    const scene = el("span", { class: "desk-scene", "aria-hidden": "true" });
    scene.innerHTML = ROBOT_SVG.replace("TONE", role.tone);
    button.append(scene);
    button.append(el("span", { class: "desk-name", text: role.name }));
    button.append(statusLine(status));
    button.addEventListener("click", () => openRole(role, button));
    return button;
  }

  function statusLine(status) {
    return el("span", { class: "status-line" }, [
      el("i", { class: status === "active" ? "dot on" : "dot" }),
      statusLabel(status)
    ]);
  }

  function paintDesk(role) {
    const button = document.getElementById("desk-" + role.id);
    if (!button) return;
    const status = currentStatus(role);
    button.setAttribute("data-status", status);
    const line = button.querySelector(".status-line");
    if (line) line.replaceWith(statusLine(status));
  }

  function openRole(role, button) {
    opener = button;
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
    sheet.append(metrics(role.id));
    dialog.replaceChildren(sheet);
  }

  function metrics(role) {
    const grid = el("dl", { class: "desk-metrics" });
    metricRows(role, counts).forEach(([label, value]) => {
      grid.append(el("div", {}, [
        el("dt", { text: label }),
        el("dd", { text: shown(value) })
      ]));
    });
    return grid;
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
    paintDesk(role);
    if (dialog.open) {
      renderModal(role);
      const pressed = dialog.querySelector("[aria-pressed=true]");
      if (pressed) pressed.focus();
    }
    toast(role.name + " is " + statusLabel(status) + ".");
  }
}
