import { toast } from "../auth/ui.js";

const ROLES = [
  {
    id: "outreach",
    name: "Outreach Agent",
    mark: "OA",
    tone: "gold",
    text: "Sends targeted messages to new followers, reads Instagram continuously, and sends messages or voice notes in reply to comments."
  },
  {
    id: "follow_up",
    name: "Follow Up Agent",
    mark: "FA",
    tone: "magenta",
    text: "Follows up with leads who warmed up but stopped midway."
  },
  {
    id: "setting",
    name: "Setting Agent",
    mark: "SA",
    tone: "orange",
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

function defaultStatus(role, agent) {
  if (role !== "setting") return "not_set_up";
  return agent.status === "paused" ? "paused" : "active";
}

export async function mountWorkforce(supabase, agent, host, canEdit, cachedStats) {
  host.innerHTML = "";
  const panel = el("section", { id: "workforce" });
  panel.append(el("h2", { text: "Workforce" }));
  panel.append(el("p", { text: "Three desks for this business. Counts come from the lead sync. A dash means that number is not in the sync." }));
  const floor = el("div", { class: "office-floor", id: "office-floor" });
  const note = el("p", { class: "err", id: "workforce-note", role: "status" });
  panel.append(floor, note);
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

  ROLES.forEach((role) => {
    const status = stored.get(role.id) || defaultStatus(role.id, agent);
    floor.append(desk(role, status));
  });

  function desk(role, status) {
    const card = el("article", { class: "desk", "data-status": status, id: "desk-" + role.id });
    const scene = el("div", { class: "desk-scene", "aria-hidden": "true" });
    scene.append(
      el("div", { class: "worker " + role.tone }, [role.mark]),
      el("div", { class: "desk-surface" })
    );
    card.append(scene);
    card.append(el("h3", { text: role.name }));
    card.append(el("p", { text: role.text }));
    const label = STATUSES.find(([id]) => id === status)?.[1] || "Not set up";
    card.append(el("p", { class: "status-line", id: "desk-status-" + role.id }, [
      el("i", { class: status === "active" ? "dot on" : "dot" }),
      label
    ]));
    card.append(metrics(role.id));
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
      card.append(group);
    } else if (statusRes.error && missing(statusRes.error)) {
      card.append(el("p", { class: "mute", text: "Status can be saved after the assets migration." }));
    }
    return card;
  }

  function metrics(role) {
    const grid = el("dl", { class: "desk-metrics" });
    const rows = role === "outreach"
      ? [["New-follower messages", null], ["Comment replies", null]]
      : role === "follow_up"
        ? [["Follow-ups recorded", counts.followups], ["Warm, quiet 3 days", counts.warm_quiet]]
        : [["Conversations", counts.conversations], ["Booked", counts.booked]];
    rows.forEach(([label, value]) => {
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
    const card = document.getElementById("desk-" + role.id);
    if (card) card.replaceWith(desk(role, status));
    toast(role.name + " is " + (STATUSES.find(([id]) => id === status)?.[1] || "updated") + ".");
  }
}
