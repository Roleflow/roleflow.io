const NS = "http://www.w3.org/2000/svg";
const SETTER_ROLES = ["comment_to_dm", "qualification", "conversation_recovery", "appointment_booking"];

const OUTBOUND = [
  { key: "manager", name: "Outbound Manager", kind: "manager", left: "40%", top: "58%" },
  { key: "icp_acquisition", name: "ICP Target Acquisition", kind: "role", left: "12%", top: "30%" },
  { key: "engagement_warmup", name: "Engagement Warm-Up", kind: "role", left: "40%", top: "16%" },
  { key: "personalised_outreach", name: "Personalised Outreach", kind: "role", left: "66%", top: "32%" }
];

const INBOUND = [
  { key: "manager", name: "Inbound Manager", kind: "manager", left: "38%", top: "60%" },
  { key: "comment_to_dm", name: "Comment-to-DM", kind: "role", left: "6%", top: "28%" },
  { key: "qualification", name: "Qualification", kind: "role", left: "28%", top: "14%" },
  { key: "conversation_recovery", name: "Follow-up / Recovery", kind: "role", left: "52%", top: "16%" },
  { key: "appointment_booking", name: "Booking & Show-up", kind: "role", left: "72%", top: "32%" }
];

let openKey = "";
let openKind = "";
let bound = false;

export function closeOffice() {
  openKey = "";
  openKind = "";
  const drawer = document.getElementById("agent-drawer");
  if (drawer) drawer.hidden = true;
}

export function renderOffice(ui, kind) {
  bindOnce(ui);
  const specs = (kind === "inbound" ? INBOUND : OUTBOUND).map((item) => describe(ui, item, kind));
  const section = ui.el("section", { class: "office", "aria-label": kind === "inbound" ? "Inbound office" : "Outbound office" });
  const floor = ui.el("div", { class: "office-floor" });
  floor.append(floorSvg());
  specs.forEach((spec) => floor.append(station(ui, spec)));
  section.append(floor);
  if (openKey && openKind === kind) {
    const current = specs.find((item) => item.key === openKey);
    if (current) fillDrawer(ui, current, kind);
    else closeOffice();
  }
  return section;
}

function bindOnce(ui) {
  if (bound) return;
  bound = true;
  const drawer = document.getElementById("agent-drawer");
  if (!drawer) return;
  drawer.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-drawer]")) closeOffice();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawer && !drawer.hidden) closeOffice();
  });
}

function describe(ui, item, kind) {
  const inbound = kind === "inbound";
  const pending = inbound && item.kind === "role" && ui.setterPending();
  const provisioned = item.kind === "manager" || ui.state.workforce.some((row) => row.role === item.key);
  let mode = "working";
  let status = "Active";
  if (item.kind === "manager") {
    const on = Boolean(ui.state.settings && ui.state.settings.system_enabled);
    mode = on ? "working" : "idle";
    status = on ? "Active" : "Paused";
    if (inbound && ui.setterPending()) {
      mode = "idle";
      status = "Pending activation";
    }
  } else if (!provisioned || pending) {
    mode = "empty";
    status = "Needs setup";
  } else {
    const row = ui.roleRow(item.key);
    if (!row || row.status !== "active") {
      mode = "idle";
      status = "Paused";
    }
  }
  const today = item.kind === "role" ? ui.countToday(ui.roleRow(item.key)) : countOutbound(ui);
  const cap = ui.state.settings && ui.state.settings.daily_cap;
  const capText = cap ? "Today " + today + " / " + cap : "Today " + today;
  const action = mode === "empty" ? "" : latestAction(ui, item);
  return { ...item, mode, status, capText, action, inbound };
}

function countOutbound(ui) {
  return ui.countToday(ui.roleRow("icp_acquisition"));
}

function latestAction(ui, item) {
  if (item.kind === "manager") {
    const pending = (ui.state.outbox || []).filter((row) => row.status === "pending").length;
    if (pending === 1) return "1 change syncing";
    if (pending) return pending + " changes syncing";
    if (item.key === "manager" && ui.setterPending && ui.setterPending()) return "";
    return "";
  }
  const fromLog = (ui.state.activity || []).find((row) => row.role === item.key && plainAction(row, ui.state.targets || []));
  if (fromLog) return plainAction(fromLog, ui.state.targets || []);
  if (item.key === "icp_acquisition") {
    const scored = (ui.state.targets || []).find((row) => row.icp_score != null && row.handle);
    if (scored) return "Scored @" + clean(scored.handle);
  }
  if (item.key === "engagement_warmup") {
    const warm = (ui.state.targets || []).find((row) => row.stage === "warmup" && row.handle);
    if (warm) return "Warming @" + clean(warm.handle);
  }
  if (item.key === "personalised_outreach") {
    const draft = (ui.state.outreach || []).find((row) => row.decision === "pending" && row.opener);
    if (draft) return "Drafted opener" + forHandle(draft, ui.state.targets || []);
    const sent = (ui.state.outreach || []).find((row) => row.opener);
    if (sent) return "Drafted opener" + forHandle(sent, ui.state.targets || []);
  }
  if (item.key === "qualification") {
    const qual = (ui.state.targets || []).find((row) => row.qual_score != null && row.handle);
    if (qual) return "Qualified @" + clean(qual.handle);
  }
  if (item.key === "appointment_booking") {
    const booking = (ui.state.bookings || [])[0];
    if (booking) {
      const target = (ui.state.targets || []).find((row) => row.id === booking.target_id);
      return "Booked a call" + (target && target.handle ? " with @" + clean(target.handle) : "");
    }
  }
  return "";
}

function plainAction(row, targets) {
  const who = forHandle(row, targets);
  const action = String(row.action || "");
  const notes = String(row.notes || "");
  if (/score/i.test(action) || /score/i.test(notes)) return "Scored" + who;
  if (/open|draft/i.test(action) || /open|draft/i.test(notes)) return "Drafted opener" + who;
  if (/warmup|like/i.test(action)) return "Warmed a profile" + who;
  if (/book/i.test(action)) return "Booked a call" + who;
  if (/qual/i.test(action)) return "Qualified a lead" + who;
  if (/follow|recover/i.test(action)) return "Sent a follow-up" + who;
  if (/voice/i.test(action)) return "Sent a voice note" + who;
  if (/dm|reply|message|comment/i.test(action)) return "Replied" + who;
  if (notes && notes.length < 72 && !/tailor|zerochat|@roleflowqa/i.test(notes)) return notes;
  return "";
}

function forHandle(row, targets) {
  const id = row.target_id;
  const target = (targets || []).find((item) => item.id === id);
  return target && target.handle ? " @" + clean(target.handle) : "";
}

function clean(value) {
  return String(value || "").replace(/^@/, "");
}

function station(ui, spec) {
  const button = ui.el("button", {
    type: "button",
    class: "station " + spec.mode,
    "data-tip": spec.name + " · " + spec.status + " · " + spec.capText
  });
  button.style.left = spec.left;
  button.style.top = spec.top;
  button.setAttribute("aria-label", spec.name + ", " + spec.status + ", " + spec.capText);
  const bubble = spec.mode === "empty"
    ? ui.el("span", { class: "desk-tag", text: "Needs setup" })
    : spec.action
      ? ui.el("span", { class: "desk-bubble", text: spec.action })
      : ui.el("span", { class: "desk-bubble quiet", text: "No activity yet" });
  button.append(bubble);
  button.append(scene());
  button.append(ui.el("span", { class: "desk-name", text: spec.name }));
  button.addEventListener("click", () => {
    openKey = spec.key;
    openKind = spec.inbound ? "inbound" : "outbound";
    const drawer = document.getElementById("agent-drawer");
    if (drawer) drawer.hidden = false;
    fillDrawer(ui, spec, openKind);
  });
  return button;
}

function scene() {
  const wrap = document.createElement("span");
  wrap.className = "desk-scene";
  wrap.innerHTML = '<span class="monitor"><i></i></span><span class="person"><span class="head"></span><span class="torso"></span><span class="arm"></span></span><span class="desk-top"></span>';
  return wrap;
}

function floorSvg() {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "floor-svg");
  svg.setAttribute("viewBox", "0 0 800 460");
  svg.setAttribute("aria-hidden", "true");
  const plate = document.createElementNS(NS, "polygon");
  plate.setAttribute("points", "60,36 760,36 700,430 16,430");
  plate.setAttribute("fill", "#0c0e14");
  plate.setAttribute("stroke", "rgba(255,255,255,.08)");
  svg.append(plate);
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 13; col++) {
      const x = 70 + col * 50 + (row % 2) * 25;
      const y = 58 + row * 28;
      const tile = document.createElementNS(NS, "polygon");
      tile.setAttribute("points", (x + 25) + "," + y + " " + (x + 50) + "," + (y + 14) + " " + (x + 25) + "," + (y + 28) + " " + x + "," + (y + 14));
      tile.setAttribute("fill", (row + col) % 2 ? "rgba(255,255,255,.012)" : "rgba(255,255,255,.028)");
      tile.setAttribute("stroke", "rgba(255,255,255,.04)");
      svg.append(tile);
    }
  }
  const glow = document.createElementNS(NS, "ellipse");
  glow.setAttribute("class", "floor-glow");
  glow.setAttribute("cx", "400");
  glow.setAttribute("cy", "240");
  glow.setAttribute("rx", "200");
  glow.setAttribute("ry", "46");
  glow.setAttribute("fill", "rgba(212,161,90,.055)");
  svg.append(glow);
  return svg;
}

function fillDrawer(ui, spec, kind) {
  const body = document.getElementById("agent-drawer-body");
  if (!body) return;
  body.replaceChildren();
  const head = ui.el("header", { class: "drawer-head" });
  head.append(ui.el("div", {}, [
    ui.el("p", { class: "metric-label", text: kind === "inbound" ? "Inbound office" : "Outbound office" }),
    ui.el("h2", { text: spec.name }),
    ui.el("p", { class: "drawer-status", text: spec.status + " · " + spec.capText })
  ]));
  head.append(ui.el("button", { type: "button", class: "btn ghost sm", "data-close-drawer": "true" }, ["Close"]));
  body.append(head);
  if (spec.kind === "manager") {
    body.append(ui.el("p", { text: spec.inbound
      ? "The inbound manager watches the setter team. One switch runs Comment-to-DM, Qualification, Follow-up, and Booking."
      : "The outbound manager watches target finding, warm-up, and personalised outreach. The daily cap counts new profiles." }));
    const toggle = ui.el("label", { class: "switch" });
    const input = ui.el("input", { type: "checkbox", "aria-label": "Turn the system on" });
    input.checked = Boolean(ui.state.settings && ui.state.settings.system_enabled);
    input.disabled = !ui.state.canEdit;
    input.addEventListener("change", () => ui.patchSettings({ system_enabled: input.checked }));
    toggle.append(input, document.createTextNode(input.checked ? "System on" : "System off"));
    body.append(toggle);
  } else if (spec.inbound) {
    body.append(ui.el("p", { text: "This seat uses the same setter switch as the rest of the inbound team." }));
    const provisioned = SETTER_ROLES.filter((role) => ui.state.workforce.some((row) => row.role === role));
    body.append(ui.setterSwitch(provisioned));
    if (ui.setterPending()) body.append(ui.el("p", { text: "Instagram: not connected. The desk stays empty until the setter is activated." }));
    if ((ui.state.outbox || []).some((row) => row.status === "pending")) body.append(ui.el("p", { text: "Syncing…" }));
  } else {
    body.append(ui.roleSwitch(spec.key, spec.name));
    if (spec.key === "icp_acquisition") {
      body.append(ui.el("p", { text: "Profiles found today: " + ui.countToday(ui.roleRow(spec.key)) }));
    }
    body.append(ui.el("p", { text: ui.instagramLine() }));
  }
  if (spec.action) body.append(ui.el("p", { class: "metric-value sm", text: spec.action }));
  const activity = recent(ui, spec);
  const list = ui.el("div", { class: "drawer-activity" });
  list.append(ui.el("h3", { text: "Recent activity" }));
  if (!activity.length) list.append(ui.el("p", { text: "No activity yet." }));
  activity.forEach((line) => list.append(ui.el("p", { text: line })));
  body.append(list);
  const crm = ui.el("div", { class: "drawer-links" });
  crm.append(ui.el("h3", { text: "CRM" }));
  const items = related(ui, spec);
  if (!items.length) crm.append(ui.el("p", { text: "No CRM items for this agent yet." }));
  items.forEach((target) => {
    const link = ui.el("a", { href: "#pipeline" }, ["@" + clean(target.handle)]);
    link.addEventListener("click", (event) => {
      event.preventDefault();
      ui.state.openId = target.id;
      closeOffice();
      ui.go("pipeline");
    });
    crm.append(link);
  });
  body.append(crm);
}

function recent(ui, spec) {
  const rows = (ui.state.activity || []).filter((row) => spec.kind === "role" && row.role === spec.key).slice(0, 8);
  const lines = [];
  rows.forEach((row) => {
    const text = plainAction(row, ui.state.targets || []);
    if (text) lines.push(text + " · " + ui.when(row.created_at));
  });
  if (spec.action && !lines.some((line) => line.startsWith(spec.action))) lines.unshift(spec.action);
  return lines.slice(0, 6);
}

function related(ui, spec) {
  const targets = ui.state.targets || [];
  if (spec.key === "icp_acquisition") return targets.filter((row) => row.icp_score != null && row.handle).slice(0, 6);
  if (spec.key === "engagement_warmup") return targets.filter((row) => row.stage === "warmup" && row.handle).slice(0, 6);
  if (spec.key === "personalised_outreach") {
    const ids = new Set((ui.state.outreach || []).map((row) => row.target_id));
    return targets.filter((row) => ids.has(row.id) && row.handle).slice(0, 6);
  }
  if (spec.key === "qualification") return targets.filter((row) => (row.qual_score != null || row.lead_status === "warm" || row.lead_status === "hot") && row.handle).slice(0, 6);
  if (spec.key === "appointment_booking") {
    const ids = new Set((ui.state.bookings || []).map((row) => row.target_id));
    return targets.filter((row) => ids.has(row.id) && row.handle).slice(0, 6);
  }
  if (spec.key === "comment_to_dm") return targets.filter((row) => /comment|instagram/i.test(String(row.source || "")) && row.handle).slice(0, 6);
  if (spec.key === "conversation_recovery") return (ui.state.contacts || []).filter((row) => row.handle).slice(0, 6);
  if (spec.kind === "manager") return targets.filter((row) => row.handle).slice(0, 5);
  return [];
}
