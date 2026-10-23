import { renderDesk } from "./workforce-desk.js";
import { renderSetterStudio } from "./setter-workflow.js";
import { agentRole, deskStatus } from "./workforce-model.js";

const NS = "http://www.w3.org/2000/svg";
const SETTER_ROLES = ["comment_to_dm", "qualification", "conversation_recovery", "appointment_booking"];

const SCENE_W = 1080;
const SCENE_H = 560;

const OUTBOUND = [
  { key: "engagement_warmup", name: "Engagement Warm-Up", kind: "role", x: 540, y: 150, scale: 1.14 },
  { key: "icp_acquisition", name: "ICP Target Acquisition", kind: "role", x: 196, y: 178, scale: 1.16 },
  { key: "personalised_outreach", name: "Personalised Outreach", kind: "role", x: 884, y: 178, scale: 1.16 },
  { key: "manager", name: "Outbound Manager", kind: "manager", x: 540, y: 412, scale: 1.16 }
];

const INBOUND = [
  { key: "qualification", name: "Qualification", kind: "role", x: 360, y: 148, scale: 1.02 },
  { key: "conversation_recovery", name: "Follow-up / Recovery", kind: "role", x: 720, y: 148, scale: 1.02 },
  { key: "comment_to_dm", name: "Comment-to-DM", kind: "role", x: 140, y: 182, scale: 1.02 },
  { key: "appointment_booking", name: "Booking & Show-up", kind: "role", x: 940, y: 182, scale: 1.02 },
  { key: "manager", name: "Inbound Manager", kind: "manager", x: 540, y: 416, scale: 1.1 }
];

const LOOK = {
  "ICP Target Acquisition": { skin: "#E6C2A6", hair: "#2A2438", shirt: "#6A45E0" },
  "Engagement Warm-Up": { skin: "#C98B6A", hair: "#1A1428", shirt: "#7B4DFF" },
  "Personalised Outreach": { skin: "#F0D2B8", hair: "#3A2A22", shirt: "#7B2FB5" },
  "Comment-to-DM": { skin: "#A56B4A", hair: "#241C18", shirt: "#6A45E0" },
  "Qualification": { skin: "#E8C4A8", hair: "#4A3028", shirt: "#7B2FB5" },
  "Follow-up / Recovery": { skin: "#8D5A42", hair: "#1C1824", shirt: "#7B4DFF" },
  "Booking & Show-up": { skin: "#F3D5BE", hair: "#2C241C", shirt: "#C0409A" },
  "Outbound Manager": { skin: "#D7B08A", hair: "#16141E", shirt: "#7B2FB5" },
  "Inbound Manager": { skin: "#C9956E", hair: "#2A1E28", shirt: "#6A45E0" }
};

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
  const canvas = ui.el("div", { class: "office-canvas" });
  canvas.append(sceneSvg(ui, specs, kind));
  const cards = ui.el("div", { class: "office-cards" });
  specs.forEach((spec) => cards.append(officeCard(ui, spec, kind)));
  section.append(canvas, cards);
  if (ui.state.openDeskRequest && ui.state.openDeskRequest.kind === kind) {
    const requested = specs.find((item) => item.key === ui.state.openDeskRequest.key);
    ui.state.openDeskRequest = null;
    if (requested) openDesk(ui, requested, kind);
  } else if (openKey && openKind === kind) {
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
  } else if (!provisioned) {
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
  const role = agentRole(item, kind);
  if (mode !== "empty") {
    const live = deskStatus(ui.state.agentRuns || [], ui.state.agentActions || [], role);
    mode = live.mode;
    status = live.status;
  }
  return { ...item, role, mode, status, capText, action, inbound };
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

function openDesk(ui, spec, kind) {
  openKey = spec.key;
  openKind = kind;
  const drawer = document.getElementById("agent-drawer");
  if (drawer) {
    drawer.hidden = false;
    drawer.classList.toggle("desk-wide", spec.kind === "manager" && kind === "inbound");
  }
  fillDrawer(ui, spec, kind);
}

function officeCard(ui, spec, kind) {
  const button = ui.el("button", { type: "button", class: "office-card " + spec.mode });
  button.setAttribute("aria-label", spec.name + ", " + spec.status + ", " + spec.capText);
  const copy = ui.el("span", { class: "office-card-copy" });
  copy.append(ui.el("strong", { text: spec.name }));
  copy.append(ui.el("span", { text: spec.status + " · " + spec.capText }));
  const action = spec.mode === "empty" ? "Needs setup" : (spec.action || "No activity yet");
  copy.append(ui.el("em", { text: action }));
  button.append(ui.el("span", { class: "office-card-dot " + spec.mode }), copy);
  button.addEventListener("click", () => openDesk(ui, spec, kind));
  return button;
}

function sceneSvg(ui, specs, kind) {
  const svg = node("svg", { class: "office-svg", viewBox: "0 0 " + SCENE_W + " " + SCENE_H, role: "img", "aria-label": kind === "inbound" ? "Inbound office" : "Outbound office" });
  const defs = node("defs");
  const grad = node("linearGradient", { id: "office-grad", x1: "0", y1: "0", x2: "1", y2: "1" });
  grad.append(node("stop", { offset: "0", "stop-color": "#7B4DFF" }));
  grad.append(node("stop", { offset: "0.5", "stop-color": "#C0409A" }));
  grad.append(node("stop", { offset: "1", "stop-color": "#FF8A3D" }));
  defs.append(grad);
  svg.append(defs);
  svg.append(floorArt());
  svg.append(plant(64, 500));
  svg.append(plant(1016, 500));
  svg.append(lamp(1036, 468));
  specs.forEach((spec) => svg.append(stationArt(ui, spec, kind)));
  return svg;
}

function stationArt(ui, spec, kind) {
  const slot = node("g", { class: "slot", transform: "translate(" + spec.x + " " + spec.y + ") scale(" + spec.scale + ")" });
  const group = node("g", { class: "station-g " + spec.mode, tabindex: "0", role: "button" });
  group.setAttribute("aria-label", spec.name + ", " + spec.status + ", " + spec.capText);
  group.append(node("rect", { x: "-96", y: "-108", width: "192", height: "230", fill: "transparent" }));
  group.append(deskArt(spec.mode));
  group.append(chairArt());
  group.append(monitorArt(spec.mode));
  if (spec.mode !== "empty") group.append(personArt(LOOK[spec.name] || LOOK["Outbound Manager"], spec.mode));
  group.append(bubbleArt(spec));
  group.append(nameArt(spec));
  group.append(tipArt(spec));
  const open = () => openDesk(ui, spec, kind);
  group.addEventListener("click", open);
  group.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    open();
  });
  slot.append(group);
  return slot;
}

function floorArt() {
  const g = node("g", { "aria-hidden": "true" });
  g.append(node("rect", { x: "0", y: "0", width: String(SCENE_W), height: String(SCENE_H), fill: "#101A33" }));
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 14; col++) {
      const x = 16 + col * 76;
      const y = 18 + row * 54;
      g.append(node("polygon", {
        points: x + "," + (y + 20) + " " + (x + 38) + "," + y + " " + (x + 76) + "," + (y + 20) + " " + (x + 38) + "," + (y + 40),
        fill: (row + col) % 2 ? "rgba(29,40,72,.55)" : "rgba(10,18,38,.35)",
        stroke: "rgba(154,166,198,.08)",
        "stroke-width": "1"
      }));
    }
  }
  return g;
}

function deskArt(mode) {
  const g = node("g", { class: "desk" });
  g.append(node("ellipse", { cx: "0", cy: "50", rx: "78", ry: "16", fill: "rgba(4,8,20,.42)" }));
  g.append(node("polygon", { points: "-76,-6 0,28 0,48 -76,14", fill: "#0A1226" }));
  g.append(node("polygon", { points: "76,-6 0,28 0,48 76,14", fill: "#243155" }));
  g.append(node("polygon", {
    class: "desk-top",
    points: "-76,-6 0,-42 76,-6 0,28",
    fill: mode === "empty" ? "#101A33" : "#1D2848",
    stroke: mode === "empty" ? "#7E8AAE" : "#243155",
    "stroke-dasharray": mode === "empty" ? "5 4" : "0",
    "stroke-width": "1.4"
  }));
  g.append(node("rect", { x: "-16", y: "-4", width: "32", height: "10", rx: "2", fill: "#0A1226" }));
  return g;
}

function chairArt() {
  const g = node("g", { class: "chair" });
  g.append(node("rect", { x: "-18", y: "16", width: "36", height: "26", rx: "7", fill: "#243155" }));
  g.append(node("rect", { x: "-20", y: "36", width: "40", height: "12", rx: "4", fill: "#1D2848" }));
  return g;
}

function monitorArt(mode) {
  const g = node("g", { class: "monitor" });
  if (mode === "working") g.append(node("ellipse", { class: "work-glow", cx: "0", cy: "-46", rx: "34", ry: "18", fill: "url(#office-grad)", opacity: "0.55" }));
  g.append(node("rect", {
    x: "-24", y: "-64", width: "48", height: "34", rx: "4",
    fill: "#0A1226",
    stroke: mode === "empty" ? "#7E8AAE" : "#243155",
    "stroke-dasharray": mode === "empty" ? "3 3" : "0",
    "stroke-width": "1.5"
  }));
  g.append(node("rect", {
    class: "screen " + mode,
    x: "-20", y: "-60", width: "40", height: "24", rx: "2",
    fill: mode === "working" ? "url(#office-grad)" : "#101A33"
  }));
  g.append(node("rect", { x: "-4", y: "-30", width: "8", height: "10", rx: "1", fill: "#243155" }));
  return g;
}

function personArt(look, mode) {
  const g = node("g", { class: "avatar " + mode });
  g.append(node("rect", { class: "arm arm-l", x: "-40", y: "-2", width: "24", height: "7", rx: "3.5", fill: look.skin }));
  g.append(node("rect", { class: "arm arm-r", x: "16", y: "-2", width: "24", height: "7", rx: "3.5", fill: look.skin }));
  g.append(node("rect", { x: "-18", y: "2", width: "36", height: "32", rx: "10", fill: look.shirt }));
  g.append(node("rect", { x: "-8", y: "-6", width: "16", height: "10", rx: "4", fill: look.skin }));
  g.append(node("circle", { cx: "0", cy: "-18", r: "14", fill: look.skin }));
  g.append(node("path", { d: "M-14 -18a14 12 0 0 1 28 0v3a16 11 0 0 0-28 0z", fill: look.hair }));
  return g;
}

function bubbleArt(spec) {
  const text = spec.mode === "empty" ? "Needs setup" : (spec.action || "No activity yet");
  const lines = bubbleLines(text);
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const width = Math.max(108, longest * 6.6 + 28);
  const height = lines.length > 1 ? 40 : 24;
  const top = -72 - height;
  const live = spec.mode !== "empty" && spec.action ? " live" : " quiet";
  const fill = spec.action && spec.mode !== "empty" ? "#EEF1FA" : "#9AA6C6";
  const g = node("g", { class: "desk-bubble" + live });
  g.append(node("rect", { x: String(-width / 2), y: String(top), width: String(width), height: String(height), rx: "12", fill: "#0A1226" }));
  lines.forEach((line, index) => {
    g.append(node("text", {
      x: "0", y: String(top + 16 + index * 15), "text-anchor": "middle",
      fill: fill, "font-size": "11", "font-family": "Instrument Sans, sans-serif", "font-weight": "500"
    }, line));
  });
  return g;
}

function nameArt(spec) {
  const lines = nameLines(spec.name);
  const g = node("g", { class: "nameplate" });
  const dot = spec.mode === "working" ? "#7B4DFF" : spec.mode === "error" ? "#FF5A7A" : spec.mode === "waiting" ? "#E8B04A" : spec.mode === "idle" ? "#9AA6C6" : "none";
  g.append(node("circle", {
    class: "status-dot " + spec.mode,
    cx: "0", cy: "54", r: "4",
    fill: dot,
    stroke: spec.mode === "empty" ? "#7E8AAE" : "none",
    "stroke-dasharray": spec.mode === "empty" ? "2 2" : "0",
    "stroke-width": "1.5"
  }));
  lines.forEach((line, index) => {
    g.append(node("text", {
      x: "0", y: String(70 + index * 14), "text-anchor": "middle",
      fill: "#EEF1FA", "font-size": "12", "font-family": "Bricolage Grotesque, sans-serif", "font-weight": "600"
    }, line));
  });
  return g;
}

function tipArt(spec) {
  const label = spec.status + " · " + spec.capText;
  const width = Math.min(230, Math.max(120, label.length * 6.1 + 20));
  const g = node("g", { class: "tip" });
  g.append(node("rect", { x: String(-width / 2), y: "96", width: String(width), height: "22", rx: "8", fill: "#0A1226" }));
  g.append(node("text", {
    x: "0", y: "111", "text-anchor": "middle", fill: "#EEF1FA",
    "font-size": "11", "font-family": "Instrument Sans, sans-serif"
  }, label));
  return g;
}

function plant(x, y) {
  const g = node("g", { transform: "translate(" + x + " " + y + ")", "aria-hidden": "true" });
  g.append(node("ellipse", { cx: "0", cy: "26", rx: "18", ry: "6", fill: "rgba(4,8,20,.35)" }));
  g.append(node("path", { d: "M-11 22h22l-3 16h-16z", fill: "#1D2848" }));
  g.append(node("ellipse", { cx: "-8", cy: "4", rx: "11", ry: "16", fill: "#6A45E0" }));
  g.append(node("ellipse", { cx: "9", cy: "2", rx: "10", ry: "18", fill: "#7B2FB5" }));
  g.append(node("ellipse", { cx: "0", cy: "-10", rx: "8", ry: "16", fill: "#7B4DFF" }));
  return g;
}

function lamp(x, y) {
  const g = node("g", { transform: "translate(" + x + " " + y + ")", "aria-hidden": "true" });
  g.append(node("ellipse", { cx: "0", cy: "48", rx: "26", ry: "8", fill: "rgba(232,176,74,.2)" }));
  g.append(node("rect", { x: "-3", y: "-6", width: "6", height: "48", rx: "2", fill: "#243155" }));
  g.append(node("polygon", { points: "-22,-28 22,-28 14,-8 -14,-8", fill: "#E8B04A" }));
  g.append(node("rect", { x: "-12", y: "40", width: "24", height: "6", rx: "2", fill: "#1D2848" }));
  return g;
}

function nameLines(name) {
  if (name.length <= 16) return [name];
  const parts = name.split(" ");
  let line = parts[0];
  let index = 1;
  while (index < parts.length - 1 && (line + " " + parts[index]).length <= 16) {
    line += " " + parts[index];
    index += 1;
  }
  const rest = parts.slice(index).join(" ");
  return rest ? [line, rest] : [name];
}

function bubbleLines(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= 24) return [value];
  const words = value.split(" ");
  const lines = [];
  let line = "";
  words.forEach((word) => {
    const next = line ? line + " " + word : word;
    if (line && next.length > 24) {
      lines.push(line);
      line = word;
    } else line = next;
  });
  if (line) lines.push(line);
  if (lines.length <= 2) return lines;
  const mid = Math.ceil(value.length / 2);
  let split = value.lastIndexOf(" ", mid);
  if (split < 8) split = value.indexOf(" ", mid);
  if (split < 0) return [value];
  return [value.slice(0, split), value.slice(split + 1)];
}

function node(tag, attrs, text) {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs || {}).forEach(([key, value]) => el.setAttribute(key, value));
  if (text != null) el.textContent = text;
  return el;
}

function fillDrawer(ui, spec, kind) {
  const body = document.getElementById("agent-drawer-body");
  if (!body) return;
  body.replaceChildren();
  const head = ui.el("header", { class: "drawer-head" });
  head.append(ui.el("div", {}, [
    ui.el("p", { class: "metric-label", text: kind === "inbound" ? "Inbound office" : "Outbound office" }),
    ui.el("h2", { id: "desk-modal-title", text: spec.name }),
    ui.el("p", { class: "drawer-status", text: spec.status + " · " + spec.capText })
  ]));
  head.append(ui.el("button", { type: "button", class: "btn ghost sm", "data-close-drawer": "true" }, ["Close"]));
  body.append(head);
  if (spec.kind === "manager" && spec.inbound) {
    const toggle = ui.el("label", { class: "switch" });
    const input = ui.el("input", { type: "checkbox", "aria-label": "Turn the system on" });
    input.checked = Boolean(ui.state.settings && ui.state.settings.system_enabled);
    input.disabled = !ui.state.canEdit;
    input.addEventListener("change", () => ui.patchSettings({ system_enabled: input.checked }));
    toggle.append(input, document.createTextNode(input.checked ? "System on" : "System off"));
    body.append(toggle);
    body.append(renderSetterStudio(ui));
    return;
  }
  if (spec.kind === "manager") {
    body.append(ui.el("p", { text: "The outbound manager watches target finding, warm-up, and personalised outreach. The daily cap counts new profiles." }));
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
  body.append(renderDesk(ui, spec, kind));
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
