import { ROLES } from "./model.js";
import {
  BRIEF_FIELDS, CRM_STATES, CONTENT_TYPES, MAX_CHARS, PAGE_SIZE, PLACEMENTS, SCHEDULE_PROVIDERS, SETTER_SYNC,
  charCount, collectLeads, emptyBrief, exportCsv, exportJson, filterLeads, formatDelta, paginate, scoreBrief,
  validateAsset, validateLink, validateSchedule, versionDelta
} from "./studio-model.js";
import { sectionAlert, sectionEmpty, sectionText } from "./section-copy.js";
import { renderSopPage } from "./sop-page.js";

export { SETTER_SYNC };

function box(ui) {
  if (!ui.state.studio) {
    ui.state.studio = { view: "list", page: 1, query: {}, open: "", schedule: "calendly", sim: { as: "lead", state: "open", version: "", lines: [] }, proposal: null, edit: "" };
  }
  return ui.state.studio;
}

const SYNC_ROUND = [
  "Lead id",
  "Lead status and converted flag",
  "Chat history, when the payload includes it",
  "Paid lead marked converted",
  "Order amount on a paid lead"
];

const SYNC_ONLY = [
  "Brief sections as the workflow",
  "Personality",
  "Lead status definitions",
  "Manual tags",
  "Attributes to extract",
  "Follow-up on/off, period, and count",
  "Trigger message",
  "Autolock and its condition",
  "Message delay",
  "Quick responses",
  "Comment and story keywords",
  "Remarks and notes",
  "Lead owner",
  "Lead status other than paid"
];

function syncCard(ui) {
  const card = ui.el("section", { class: "agent", "data-command": "setter-sync" });
  const settings = ui.state.settings || {};
  const on = settings.studio_setter_sync === true;
  const logs = ui.state.syncLogs || [];
  const latestOk = logs.find((row) => row.result === "ok");
  const failed = logs.find((row) => row.result === "error");
  const link = ui.state.setterLink || {};
  let status = "Off";
  if (on && latestOk && !failed) status = "Yes";
  if (failed) status = "Needs attention";
  card.append(ui.el("h3", { text: "Synced with setter" }));
  card.append(ui.el("p", { text: status }));
  const when = link.last_synced_at || (logs[0] && logs[0].created_at);
  card.append(ui.el("p", { text: "Last sync: " + (when && ui.when ? ui.when(when) : "No sync yet") }));
  card.append(ui.el("p", { text: failed && failed.detail ? failed.detail : "No errors" }));
  card.append(ui.el("p", { text: link.external_agent_id ? "Setter agent id " + link.external_agent_id : "No setter agent id stored yet." }));
  if (link.agent_hint && String(link.agent_hint).length > 4) card.append(ui.el("p", { text: "Organization " + link.agent_hint }));
  card.append(ui.el("h3", { text: "Round trip" }));
  SYNC_ROUND.forEach((label) => card.append(ui.el("p", { text: label })));
  card.append(ui.el("h3", { text: "Roleflow only" }));
  SYNC_ONLY.forEach((label) => card.append(ui.el("p", { text: label })));
  if (ui.state.canEdit && ui.syncSetter) {
    const button = ui.button("Sync now", () => ui.syncSetter());
    button.classList.add("ghost");
    card.append(button);
  }
  return card;
}

function header(ui, title, text, how, icon) {
  if (ui.pageHeader) return ui.pageHeader(ui, title, text, how, icon);
  const block = ui.el("section", { class: "agent" });
  block.append(ui.el("h2", { text: title }), ui.el("p", { text }));
  return block;
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function renderBusiness(ui) {
  const studio = box(ui);
  const lang = ui.language ? ui.language() : "en";
  const wrap = ui.el("div", { class: "studio" });
  wrap.append(header(ui, sectionText(lang, "sopsTitle"), sectionText(lang, "sopsBody"), "brief", "clipboard"));
  const alert = sectionAlert(ui, "sops");
  if (alert) wrap.append(alert);
  const brief = { ...emptyBrief(), ...((ui.state.brief && ui.state.brief.fields) || {}) };
  const cards = ui.state.agentCards || [];
  const count = charCount(brief, cards);
  const counter = ui.el("p", { class: "char-count" + (count > MAX_CHARS ? " over" : ""), text: count.toLocaleString("en-US") + " / " + MAX_CHARS.toLocaleString("en-US") });
  wrap.append(counter);
  wrap.append(ui.el("p", { class: "mute", text: SETTER_SYNC ? "Live setter sync is on." : "Live setter sync is off. Saves stay in this panel." }));
  wrap.append(syncCard(ui));

  const form = ui.el("form", { class: "brief-grid" });
  const inputs = {};
  BRIEF_FIELDS.forEach(([key, label]) => {
    const area = ui.el("label", { text: label });
    const input = ui.el("textarea", { rows: "4" });
    input.value = brief[key] || "";
    input.addEventListener("input", () => {
      brief[key] = input.value;
      const next = charCount(brief, readCards());
      counter.textContent = next.toLocaleString("en-US") + " / " + MAX_CHARS.toLocaleString("en-US");
      counter.classList.toggle("over", next > MAX_CHARS);
    });
    area.append(input);
    inputs[key] = input;
    form.append(area);
  });
  form.addEventListener("submit", (event) => event.preventDefault());
  wrap.append(form);

  const edit = ui.el("form", { class: "agent edit-bar" });
  edit.append(ui.el("h3", { text: "Edit with AI" }));
  const instruction = ui.el("input", { type: "text", placeholder: "Say what to change", "aria-label": "Edit with AI" });
  instruction.value = studio.edit || "";
  edit.append(instruction);
  if (ui.state.canEdit) {
    edit.append(ui.button("Edit with AI", async (event) => {
      event.preventDefault();
      studio.edit = instruction.value.trim();
      if (!studio.edit) return ui.toast("Write what to change.", "bad");
      await ui.studioEdit(readFields(), studio.edit);
    }));
  }
  edit.addEventListener("submit", (event) => event.preventDefault());
  wrap.append(edit);
  if (studio.proposal && studio.proposal.fields) wrap.append(proposalCard(ui, studio));

  const local = scoreBrief(brief);
  const score = ui.el("section", { class: "agent" });
  score.append(ui.el("h3", { text: "Prompt quality " + (ui.state.studioScore && ui.state.studioScore.score != null ? ui.state.studioScore.score : local.score) + " / 10" }));
  const items = (ui.state.studioScore && ui.state.studioScore.items) || local.items;
  if (!items.length) score.append(ui.el("p", { text: "The required sections are filled." }));
  items.forEach((item) => score.append(ui.el("p", { text: item })));
  if (ui.state.canEdit) {
    const row = ui.el("div", { class: "actions" });
    row.append(ui.button("Score with AI", () => ui.studioScore(readFields())));
    row.append(ui.button("Fix with AI", () => ui.studioFix(readFields(), items)));
    score.append(row);
  }
  wrap.append(score);

  wrap.append(renderSopPage(ui));
  wrap.append(agentEditor(ui, cards, readCards));
  wrap.append(versionList(ui, brief));
  wrap.append(simulator(ui));

  if (ui.state.canEdit) {
    wrap.append(ui.button("Save business", async () => {
      const fields = readFields();
      const nextCards = readCards();
      if (charCount(fields, nextCards) > MAX_CHARS) {
        ui.toast("Shorten the text before saving.", "bad");
        return;
      }
      await ui.saveBrief(fields, nextCards, "Saved");
    }));
  }

  function readFields() {
    const fields = {};
    BRIEF_FIELDS.forEach(([key]) => { fields[key] = inputs[key].value; });
    return fields;
  }
  function readCards() {
    return cards;
  }
  return wrap;
}

function proposalCard(ui, studio) {
  const card = ui.el("section", { class: "agent" });
  card.append(ui.el("h3", { text: "AI draft" }));
  card.append(ui.el("p", { text: "Review this draft. Apply saves it as a new version." }));
  BRIEF_FIELDS.forEach(([key, label]) => {
    const value = studio.proposal.fields[key];
    if (value) card.append(ui.el("p", { text: label + ": " + value }));
  });
  const row = ui.el("div", { class: "actions" });
  row.append(ui.button("Apply draft", async () => {
    await ui.saveBrief(studio.proposal.fields, ui.state.agentCards || [], "AI draft");
    studio.proposal = null;
  }));
  row.append(ui.button("Discard", () => {
    studio.proposal = null;
    ui.paint();
  }));
  card.append(row);
  return card;
}

function agentEditor(ui, cards) {
  const section = ui.el("section", { class: "agent" });
  section.append(ui.el("h3", { text: "Agent settings" }));
  if (!cards.length) section.append(ui.el("p", { text: "No agent instructions yet. Add one for a role in this business." }));
  cards.forEach((card) => {
    const block = ui.el("div", { class: "agent-card" });
    block.append(ui.el("strong", { text: roleName(card.role) }));
    block.append(ui.el("p", { text: card.name ? "Name: " + card.name : "Using the role name." }));
    block.append(ui.el("p", { text: card.instructions || "No extra instructions." }));
    (card.delegations || []).forEach((item) => block.append(ui.el("p", { text: "Hand off to " + roleName(item.to) + " when " + item.when })));
    section.append(block);
  });
  if (!ui.state.canEdit) return section;
  const form = ui.el("form", { class: "grid-2" });
  const role = ui.el("select", { "aria-label": "Role" });
  ROLES.forEach((item) => role.append(ui.el("option", { value: item.id, text: item.name })));
  const name = ui.field("Name", "");
  const instructions = ui.el("textarea", { rows: "3", "aria-label": "Instructions" });
  const when = ui.field("Hand off when", "");
  const to = ui.el("select", { "aria-label": "Hand off to" });
  to.append(ui.el("option", { value: "", text: "No hand-off" }));
  ROLES.forEach((item) => to.append(ui.el("option", { value: item.id, text: item.name })));
  form.append(role, name.label, instructions, when.label, to);
  form.append(ui.button("Save agent", async (event) => {
    event.preventDefault();
    const existing = cards.find((card) => card.role === role.value) || { role: role.value, delegations: [] };
    const delegations = (existing.delegations || []).slice();
    const whenText = when.input.value.trim();
    if (to.value && whenText && !delegations.some((item) => item.to === to.value && item.when === whenText)) {
      delegations.push({ to: to.value, when: whenText });
    }
    await ui.saveAgent({ role: role.value, name: name.input.value.trim(), instructions: instructions.value.trim(), delegations });
  }));
  form.addEventListener("submit", (event) => event.preventDefault());
  section.append(form);
  return section;
}

function versionList(ui) {
  const section = ui.el("section", { class: "agent" });
  section.append(ui.el("h3", { text: "Versions" }));
  const versions = ui.state.briefVersions || [];
  if (!versions.length) section.append(ui.el("p", { text: "No versions yet. Save the business information to keep the first one." }));
  versions.forEach((version, index) => {
    const previous = versions[index + 1];
    const row = ui.el("p", { text: new Date(version.created_at).toLocaleString() + " · " + formatDelta(versionDelta(version, previous)) + (version.note ? " · " + version.note : "") });
    if (ui.state.canEdit) row.append(" ", ui.button("Restore", () => ui.restoreBrief(version.id)));
    section.append(row);
  });
  return section;
}

function simulator(ui) {
  const studio = box(ui);
  const sim = studio.sim;
  const section = ui.el("section", { class: "agent" });
  section.append(ui.el("h3", { text: "Conversation simulator" }));
  section.append(ui.el("p", { class: "mute", text: "A practice thread. It is not a lead and nothing is sent." }));
  const as = ui.el("select", { "aria-label": "Play as" });
  [["lead", "Play the lead"], ["business", "Play the business"]].forEach(([value, label]) => as.append(ui.el("option", { value, text: label })));
  as.value = sim.as;
  as.addEventListener("change", () => { sim.as = as.value; });
  const state = ui.el("select", { "aria-label": "Lead state" });
  CRM_STATES.forEach(([value, label]) => state.append(ui.el("option", { value, text: label })));
  state.value = sim.state;
  state.addEventListener("change", () => { sim.state = state.value; });
  const version = ui.el("select", { "aria-label": "Version" });
  version.append(ui.el("option", { value: "", text: "Current draft" }));
  (ui.state.briefVersions || []).forEach((item) => version.append(ui.el("option", { value: item.id, text: new Date(item.created_at).toLocaleString() })));
  version.value = sim.version;
  version.addEventListener("change", () => { sim.version = version.value; });
  section.append(ui.el("div", { class: "filters" }, [as, state, version]));
  if (!sim.lines.length) section.append(ui.el("p", { text: "No messages in this practice thread." }));
  sim.lines.forEach((line) => section.append(ui.el("p", { text: (line.role === "assistant" ? "Agent" : "You") + ": " + line.text })));
  const draft = ui.el("input", { type: "text", "aria-label": "Simulator message" });
  section.append(draft);
  const row = ui.el("div", { class: "actions" });
  row.append(ui.button("Send", async () => {
    const text = draft.value.trim();
    if (!text) return;
    sim.lines.push({ role: "user", text });
    draft.value = "";
    await ui.studioSimulate(sim);
  }));
  row.append(ui.button("Reset", () => {
    sim.lines = [];
    ui.paint();
  }));
  section.append(row);
  return section;
}

export function renderCrm(ui) {
  const studio = box(ui);
  const lang = ui.language ? ui.language() : "en";
  const wrap = ui.el("div", { class: "studio" });
  wrap.append(header(ui, sectionText(lang, "opportunitiesTitle"), sectionText(lang, "opportunitiesBody"), "pipeline", "users"));
  const alert = sectionAlert(ui, "opportunities");
  if (alert) wrap.append(alert);
  wrap.append(ui.el("p", { class: "mute", text: lang === "es" ? "La actualización automática es cada 22 segundos. El historial aparece cuando el flujo de eventos está conectado." : "Auto refresh in 22s. Chat history appears when the event stream is connected." }));
  const leads = collectLeads(ui.state.contacts, ui.state.targets);
  const query = studio.query;
  const filters = ui.el("form", { class: "crm-filters" });
  const q = ui.field("Name or handle", query.q || "");
  const state = select(ui, "State", [["all", "Any state"]].concat(CRM_STATES), query.state || "all");
  const agents = [["", "Any agent"]].concat(ROLES.map((role) => [role.id, role.name]));
  const agent = select(ui, "Agent", agents, query.agent || "");
  const tag = ui.field("Tag", query.tag || "");
  const automated = select(ui, "Automated", [["", "Any"], ["yes", "Automated"], ["no", "Not automated"]], query.automated || "");
  const verified = select(ui, "Verified", [["", "Any"], ["yes", "Verified"], ["no", "Not verified"]], query.verified || "");
  const weFollow = select(ui, "We follow", [["", "Any"], ["yes", "Yes"], ["no", "No"]], query.weFollow || "");
  const theyFollow = select(ui, "They follow", [["", "Any"], ["yes", "Yes"], ["no", "No"]], query.theyFollow || "");
  const minFollowers = ui.field("Minimum followers", query.minFollowers || "", "number");
  const messageMin = ui.field("Minimum messages", query.messageMin || "", "number");
  const lastFrom = ui.field("Last message from", query.lastFromDate || "", "date");
  const lastTo = ui.field("Last message to", query.lastToDate || "", "date");
  filters.addEventListener("input", () => { filters.dataset.dirty = "1"; });
  filters.addEventListener("change", () => { filters.dataset.dirty = "1"; });
  filters.append(q.label, state, agent, tag.label, automated, verified, weFollow, theyFollow, minFollowers.label, messageMin.label, lastFrom.label, lastTo.label);
  filters.append(ui.button("Apply filters", (event) => {
    event.preventDefault();
    studio.query = {
      q: q.input.value, state: state.value, agent: agent.value, tag: tag.input.value.trim(),
      automated: automated.value, verified: verified.value, weFollow: weFollow.value, theyFollow: theyFollow.value,
      minFollowers: minFollowers.input.value, messageMin: messageMin.input.value,
      lastFrom: lastFrom.input.value ? lastFrom.input.value + "T00:00:00.000Z" : "",
      lastTo: lastTo.input.value ? lastTo.input.value + "T23:59:59.999Z" : "",
      lastFromDate: lastFrom.input.value,
      lastToDate: lastTo.input.value
    };
    studio.page = 1;
    ui.paint();
  }));
  const matched = filterLeads(leads, studio.query);
  const page = paginate(matched, studio.page, Math.max(PAGE_SIZE, 100));
  const pages = ui.el("div", { class: "filters" });
  if (page.pages > 1) {
    pages.append(ui.button(lang === "es" ? "Anterior" : "Previous", () => { studio.page = Math.max(1, page.page - 1); ui.paint(); }));
    pages.append(ui.el("span", { text: page.page + " / " + page.pages }));
    pages.append(ui.button(lang === "es" ? "Siguiente" : "Next", () => { studio.page = Math.min(page.pages, page.page + 1); ui.paint(); }));
  }
  wrap.append(pages);
  const toolbar = ui.el("div", { class: "filters crm-toolbar" });
  const filterHost = ui.el("details", { class: "filters-menu" });
  filterHost.append(ui.el("summary", { text: lang === "es" ? "Filtros" : "Filters" }));
  filterHost.append(filters);
  const notes = ui.button(lang === "es" ? "Notas" : "Notes", () => jumpLead(ui, page.rows[0], "notes"));
  const message = ui.button(lang === "es" ? "Mensaje" : "Message", () => jumpLead(ui, page.rows[0], "message"));
  notes.classList.add("ghost");
  message.classList.add("ghost");
  const views = ui.el("div", { class: "filters" });
  [[ "list", lang === "es" ? "Lista" : "List" ], [ "board", lang === "es" ? "Tablero" : "Kanban" ]].forEach(([id, label]) => {
    const button = ui.el("button", { type: "button", "aria-pressed": (studio.view || "list") === id ? "true" : "false" }, [label]);
    button.addEventListener("click", () => { studio.view = id; ui.paint(); });
    views.append(button);
  });
  const count = ui.el("span", { text: page.total ? (lang === "es" ? "Mostrando " + page.rows.length + " de " + page.total + " personas" : "Showing " + page.rows.length + " of " + page.total + " people") : sectionText(lang, "opportunitiesNone") });
  const refresh = ui.el("button", { type: "button", class: "icon-btn", "aria-label": lang === "es" ? "Actualizar" : "Refresh" }, ["↻"]);
  refresh.addEventListener("click", () => { if (ui.bootBusiness && ui.state.businessId) ui.bootBusiness(ui.state.businessId); });
  toolbar.append(filterHost, notes, message, views, count, ui.el("span", { class: "range-label", text: lang === "es" ? "Actualización automática en 22 s" : "Auto refresh in 22s" }), refresh);
  toolbar.append(ui.button("Export CSV", () => download("leads.csv", exportCsv(matched), "text/csv")));
  toolbar.append(ui.button("Export JSON", () => download("leads.json", exportJson(matched), "application/json")));
  wrap.append(toolbar);

  if (!leads.length && !alert) wrap.append(sectionEmpty(ui, "opportunitiesEmpty"));
  else if (studio.view === "board") wrap.append(board(ui, matched));
  else wrap.append(table(ui, page.rows, lang));
  const open = matched.find((lead) => lead.kind + ":" + lead.id === studio.open) || leads.find((lead) => lead.kind + ":" + lead.id === studio.open);
  if (open) wrap.append(drawer(ui, open));
  return wrap;
}

function table(ui, rows, lang) {
  const tableNode = ui.el("table", { class: "leads" });
  const head = ui.el("tr");
  ["Status", "Info", lang === "es" ? "Último mensaje" : "Last message", lang === "es" ? "Seguimiento" : "Follow-up", lang === "es" ? "Agente" : "AI agent", lang === "es" ? "Etiquetas" : "Tags", sectionTextSafe(lang, "automated"), ""].forEach((label) => head.append(ui.el("th", { text: label })));
  tableNode.append(ui.el("thead", {}, [head]));
  const body = ui.el("tbody");
  rows.forEach((lead) => body.append(leadRow(ui, lead, lang)));
  tableNode.append(body);
  tableNode.classList.add("compact");
  return ui.el("div", { class: "table-wrap" }, [tableNode]);
}

function sectionTextSafe(lang, key) {
  return key === "automated" ? (lang === "es" ? "Automático" : "Automated") : key;
}

function leadRow(ui, lead, lang) {
  const row = ui.el("tr", { class: "lead-row" });
  row.addEventListener("click", (event) => {
    if (event.target.closest("button, select, input, a, label")) return;
    openLead(ui, lead);
  });
  const statusCell = ui.el("td");
  const status = ui.el("select", { class: "status-pill " + (lead.state || "open"), "aria-label": "Status" });
  CRM_STATES.forEach(([value, label]) => status.append(ui.el("option", { value, text: label })));
  status.value = CRM_STATES.some(([value]) => value === lead.state) ? lead.state : "open";
  status.addEventListener("change", (event) => {
    event.stopPropagation();
    if (ui.saveLead) ui.saveLead(lead, { crm_state: status.value, assigned_agent: lead.agent, ai_enabled: lead.ai, tags: lead.tags || [] });
  });
  statusCell.append(status);
  const info = ui.el("td");
  const person = ui.el("div", { class: "person" });
  const title = lead.name || (lead.handle ? "@" + lead.handle : "Unnamed");
  person.append(ui.el("span", { class: "biz-avatar", text: title.trim().charAt(0).toUpperCase() || "R" }));
  const copy = ui.el("div");
  copy.append(ui.el("strong", { text: title + (lead.verified ? " ✓" : "") }));
  if (lead.handle) copy.append(ui.el("small", { text: "@" + lead.handle }));
  person.append(copy);
  info.append(person);
  const toggleCell = ui.el("td");
  const toggle = ui.el("input", { type: "checkbox", "aria-label": sectionTextSafe(lang, "automated") });
  toggle.checked = lead.automated !== false && lead.ai !== false;
  toggle.addEventListener("click", (event) => event.stopPropagation());
  toggle.addEventListener("change", () => {
    if (ui.saveLead) ui.saveLead(lead, { crm_state: lead.state, assigned_agent: lead.agent, ai_enabled: toggle.checked, tags: lead.tags || [] });
  });
  toggleCell.append(toggle);
  const actions = ui.el("td");
  const chat = ui.el("button", { type: "button", class: "icon-btn", "aria-label": "Chat" }, ["✎"]);
  chat.addEventListener("click", (event) => {
    event.stopPropagation();
    if (ui.go) ui.go("chats");
    if (ui.openChat) ui.openChat(lead);
  });
  const remove = ui.el("button", { type: "button", class: "icon-danger", "aria-label": lang === "es" ? "Quitar" : "Remove" }, ["×"]);
  remove.addEventListener("click", (event) => {
    event.stopPropagation();
    const ok = window.confirm(lang === "es" ? "¿Quitar a esta persona de la lista? Sigue en el negocio." : "Remove this person from the list? They stay on the business.");
    if (!ok) return;
    ui.toast(lang === "es" ? "Las personas se quedan en el negocio." : "People stay on this business.");
  });
  actions.append(chat, remove);
  row.append(
    statusCell,
    info,
    ui.el("td", { text: lead.report || (lead.lastMessageAt && ui.when ? ui.when(lead.lastMessageAt) : "—") }),
    ui.el("td", { text: String(lead.followups || 0) + "/2" }),
    ui.el("td", { text: roleName(lead.agent) || "—" }),
    ui.el("td", { text: (lead.tags || []).join(", ") || "—" }),
    toggleCell,
    actions
  );
  return row;
}

function jumpLead(ui, lead, focus) {
  if (!lead) return ui.toast("Choose a person first.", "bad");
  const studio = box(ui);
  studio.open = lead.kind + ":" + lead.id;
  studio.focus = focus;
  ui.paint();
}

function board(ui, rows) {
  const boardNode = ui.el("div", { class: "kanban" });
  CRM_STATES.forEach(([id, label]) => {
    const column = ui.el("section", { class: "kanban-col" });
    const items = rows.filter((lead) => lead.state === id);
    column.append(ui.el("h3", { text: label }));
    if (!items.length) column.append(ui.el("p", { text: "No leads" }));
    items.forEach((lead) => {
      const card = ui.el("button", { type: "button", class: "kanban-card" }, [lead.name || (lead.handle ? "@" + lead.handle : "Unnamed")]);
      card.addEventListener("click", () => openLead(ui, lead));
      column.append(card);
    });
    boardNode.append(column);
  });
  return boardNode;
}

function drawer(ui, lead) {
  const studio = box(ui);
  const lang = ui.language ? ui.language() : "en";
  const shell = ui.el("div", { class: "lead-drawer" });
  const backdrop = ui.el("button", { type: "button", class: "lead-drawer-backdrop", "aria-label": lang === "es" ? "Cerrar" : "Close" });
  backdrop.addEventListener("click", () => { studio.open = ""; ui.paint(); });
  const card = ui.el("aside", { class: "lead-sheet", role: "dialog", "aria-modal": "true" });
  card.append(ui.el("h2", { text: lead.name || (lead.handle ? "@" + lead.handle : "Lead") }));
  const openChat = ui.button(lang === "es" ? "Abrir chat" : "Open chat", () => {
    if (ui.go) ui.go("chats");
    if (ui.openChat) ui.openChat(lead);
  });
  card.append(openChat);
  card.append(ui.el("p", { text: [lead.handle ? "@" + lead.handle : "", lead.contact].filter(Boolean).join(" · ") || "No contact details stored." }));
  const state = ui.el("select", { "aria-label": "Lead state" });
  CRM_STATES.forEach(([value, label]) => state.append(ui.el("option", { value, text: label })));
  state.value = lead.state;
  const agent = ui.el("select", { "aria-label": "Assigned agent" });
  agent.append(ui.el("option", { value: "", text: "Unassigned" }));
  ROLES.forEach((role) => agent.append(ui.el("option", { value: role.id, text: role.name })));
  agent.value = lead.agent || "";
  const ai = ui.el("label", { class: "switch", text: " AI replies" });
  const aiInput = ui.el("input", { type: "checkbox" });
  aiInput.checked = lead.ai;
  ai.prepend(aiInput);
  const tags = ui.field("Tags", (lead.tags || []).join(", "));
  card.append(state, agent, ai, tags.label);
  if (ui.state.canEdit) {
    card.append(ui.button("Save lead", () => ui.saveLead(lead, {
      crm_state: state.value,
      assigned_agent: agent.value,
      ai_enabled: aiInput.checked,
      tags: tags.input.value.split(",").map((item) => item.trim()).filter(Boolean)
    })));
  }
  card.append(ui.el("h3", { text: "AI report" }));
  card.append(ui.el("p", { text: lead.report || "No AI report yet. A summary appears after the lead status sync." }));
  card.append(ui.el("h3", { text: "Follow-up progress" }));
  card.append(ui.el("p", { text: lead.followups ? lead.followups + " follow-ups recorded." : "No follow-ups recorded." }));
  const notes = (ui.state.leadNotes || []).filter((note) => (lead.kind === "contact" ? note.contact_id === lead.id : note.target_id === lead.id));
  card.append(ui.el("h3", { text: "Notes" }));
  if (!notes.length) card.append(ui.el("p", { text: "No notes yet." }));
  notes.forEach((note) => card.append(ui.el("p", { text: new Date(note.created_at).toLocaleString() + " — " + note.body })));
  const note = ui.field("Add a note", "");
  card.append(note.label);
  if (ui.state.canEdit) card.append(ui.button("Save note", () => ui.addLeadNote(lead, note.input.value.trim())));
  const queued = (ui.state.messageQueue || []).filter((item) => item.status === "pending" && (lead.kind === "contact" ? item.contact_id === lead.id : item.target_id === lead.id));
  card.append(ui.el("h3", { text: "Messages to send" }));
  card.append(ui.el("p", { class: "mute", text: "Queued here. Nothing is sent while live sync is off." }));
  if (!queued.length) card.append(ui.el("p", { text: "No messages queued." }));
  queued.forEach((item) => {
    const line = ui.el("p");
    line.append(ui.el("span", { text: item.body }));
    if (ui.state.canEdit && ui.cancelQueued) line.append(" ", ui.button("Cancel", () => ui.cancelQueued(item.id)));
    card.append(line);
  });
  const draft = ui.field("Queue a message", "");
  card.append(draft.label);
  if (ui.state.canEdit) card.append(ui.button("Queue message", () => ui.queueMessage(lead, draft.input.value.trim())));
  if (lead.kind === "target" && ui.targetDetail) {
    const target = (ui.state.targets || []).find((row) => row.id === lead.id);
    if (target) {
      const extra = ui.el("details", { class: "agent" });
      extra.append(ui.el("summary", { text: "Outbound record" }));
      extra.append(ui.targetDetail(target));
      card.append(extra);
    }
  }
  card.append(ui.button("Close", () => { studio.open = ""; ui.paint(); }));
  shell.append(backdrop, card);
  return shell;
}

export function renderSalesLinks(ui) {
  const studio = box(ui);
  const wrap = ui.el("div", { class: "studio" });
  wrap.append(header(ui, "Sales links", "Links an agent may send. Average ticket is used only when a paid lead points at that link.", "links", "link"));
  const links = ui.state.offerLinks || [];
  if (!links.length) wrap.append(ui.el("p", { text: "No sales links yet." }));
  links.forEach((link) => {
    const card = ui.el("article", { class: "agent" });
    const ticket = link.average_ticket_cents == null ? "No average ticket" : "$" + (link.average_ticket_cents / 100).toLocaleString("en-US");
    card.append(ui.el("h3", { text: link.name }));
    card.append(ui.el("p", { text: link.url }));
    card.append(ui.el("p", { text: ticket + (link.coupon ? " · Coupon " + link.coupon : "") + (link.send_as_button ? " · Button" : " · Text") }));
    if (link.send_instructions) card.append(ui.el("p", { text: link.send_instructions }));
    if ((link.agent_roles || []).length) card.append(ui.el("p", { text: "Agents: " + link.agent_roles.map(roleName).join(", ") }));
    if (ui.state.canEdit) card.append(ui.button("Remove", () => ui.deleteRow("acq_offer_links", link.id)));
    wrap.append(card);
  });
  if (ui.state.canEdit) wrap.append(linkForm(ui));
  wrap.append(scheduleBlock(ui, studio));
  wrap.append(fallbackForm(ui));
  return wrap;
}

function fallbackForm(ui) {
  const current = (ui.state.settings && ui.state.settings.booking_fallback_url) || "";
  const form = ui.el("form", { class: "agent" });
  form.append(ui.el("h3", { text: "Booking fallback" }));
  form.append(ui.el("p", { text: current ? "Stored fallback: " + current : "No booking fallback is stored." }));
  const input = ui.field("Booking fallback URL", current || "https://");
  form.append(input.label);
  if (ui.state.canEdit && ui.patchSettings) {
    form.append(ui.button("Save fallback", async (event) => {
      event.preventDefault();
      const url = input.input.value.trim();
      if (url && !/^https:\/\//i.test(url)) return ui.toast("URL must start with https://", "bad");
      await ui.patchSettings(
        { booking_fallback_url: url },
        { booking_link: url }
      );
    }));
  }
  form.addEventListener("submit", (event) => event.preventDefault());
  return form;
}

function linkForm(ui) {
  const form = ui.el("form", { class: "agent" });
  form.append(ui.el("h3", { text: "Add a link" }));
  const name = ui.field("Name", "");
  const url = ui.field("URL", "https://");
  const body = ui.field("Text", "");
  const coupon = ui.field("Coupon", "");
  const ticket = ui.field("Average ticket (USD)", "");
  const instructions = ui.field("Sending instructions", "");
  const buttonLabel = ui.field("Button label", "");
  const asButton = ui.el("label", { class: "switch", text: " Send as a button" });
  const check = ui.el("input", { type: "checkbox" });
  asButton.prepend(check);
  const roles = rolePicker(ui);
  form.append(name.label, url.label, body.label, coupon.label, ticket.label, instructions.label, buttonLabel.label, asButton, roles.wrap);
  form.append(ui.button("Save link", async (event) => {
    event.preventDefault();
    const checkResult = validateLink({ name: name.input.value, url: url.input.value, ticket: ticket.input.value, sendAsButton: check.checked, buttonLabel: buttonLabel.input.value });
    if (!checkResult.ok) return ui.toast(checkResult.errors[0], "bad");
    await ui.saveOfferLink({
      name: name.input.value.trim(),
      url: url.input.value.trim(),
      body: body.input.value.trim(),
      coupon: coupon.input.value.trim(),
      average_ticket_cents: checkResult.cents,
      send_instructions: instructions.input.value.trim(),
      send_as_button: check.checked,
      button_label: buttonLabel.input.value.trim().slice(0, 20),
      agent_roles: roles.selected()
    });
  }));
  form.addEventListener("submit", (event) => event.preventDefault());
  return form;
}

function scheduleBlock(ui, studio) {
  const section = ui.el("section", { class: "agent" });
  section.append(ui.el("h3", { text: "Automatic scheduling" }));
  const tabs = ui.el("div", { class: "filters" });
  SCHEDULE_PROVIDERS.forEach(([id, label]) => {
    const button = ui.el("button", { type: "button", "aria-pressed": studio.schedule === id ? "true" : "false" }, [label]);
    button.addEventListener("click", () => { studio.schedule = id; ui.paint(); });
    tabs.append(button);
  });
  section.append(tabs);
  const rows = (ui.state.scheduleEndpoints || []).filter((row) => row.provider === studio.schedule);
  if (!rows.length) section.append(ui.el("p", { text: "No " + scheduleLabel(studio.schedule) + " endpoint yet." }));
  rows.forEach((row) => {
    section.append(ui.el("p", { text: (row.name || "Endpoint") + " · " + (row.availability_url || row.booking_url) + (row.has_api_key ? " · Key saved" : "") }));
    if (row.condition) section.append(ui.el("p", { class: "mute", text: row.condition }));
  });
  if (!ui.state.canEdit) return section;
  const form = ui.el("form", { class: "grid-2" });
  const name = ui.field("Name", "");
  const availability = ui.field("Availability URL", "https://");
  const booking = ui.field("Booking URL", "https://");
  const condition = ui.field("Send when", "");
  const key = ui.field("Optional API key", "");
  key.input.type = "password";
  key.input.autocomplete = "off";
  form.append(name.label, availability.label, booking.label, condition.label, key.label);
  form.append(ui.button("Save endpoint", async (event) => {
    event.preventDefault();
    const checkResult = validateSchedule({ provider: studio.schedule, availability_url: availability.input.value, booking_url: booking.input.value });
    if (!checkResult.ok) return ui.toast(checkResult.errors[0], "bad");
    await ui.saveSchedule({
      provider: studio.schedule,
      name: name.input.value.trim(),
      availability_url: availability.input.value.trim(),
      booking_url: booking.input.value.trim(),
      condition: condition.input.value.trim(),
      apiKey: key.input.value
    });
  }));
  form.addEventListener("submit", (event) => event.preventDefault());
  section.append(form);
  return section;
}

export function renderValueContent(ui) {
  const lang = ui.language ? ui.language() : "en";
  const wrap = ui.el("div", { class: "studio" });
  wrap.append(header(ui, sectionText(lang, "contentTitle"), sectionText(lang, "contentBody"), "content", "folder"));
  const alert = sectionAlert(ui, "content");
  if (alert) wrap.append(alert);
  const banner = ui.el("section", { class: "voice-banner" });
  banner.append(ui.el("div", {}, [
    ui.el("h3", { text: sectionText(lang, "contentBanner") }),
    ui.el("p", { text: sectionText(lang, "contentBannerBody") })
  ]));
  banner.append(ui.el("a", { class: "btn sm", href: "#voice" }, [lang === "es" ? "Abrir notas de voz" : "Open voice notes"]));
  wrap.append(banner);
  const studio = box(ui);
  const place = studio.contentPlace || "all";
  const bar = ui.el("div", { class: "filters" });
  const location = ui.el("select", { "aria-label": sectionText(lang, "contentLocation") });
  [["all", sectionText(lang, "contentLocation")], ["before", "Before"], ["after", "After"], ["ai", "AI"]].forEach(([value, label]) => location.append(ui.el("option", { value, text: label })));
  location.value = place;
  location.addEventListener("change", () => { studio.contentPlace = location.value; ui.paint(); });
  const add = ui.button("+ " + sectionText(lang, "contentAdd"), () => {
    studio.contentOpen = true;
    ui.paint();
    const form = document.getElementById("content-add");
    if (form) form.scrollIntoView({ block: "nearest" });
  });
  bar.append(location, add);
  wrap.append(bar);
  const assets = (ui.state.valueAssets || []).filter((asset) => place === "all" || asset.placement === place);
  const tableNode = ui.el("table", { class: "leads" });
  const head = ui.el("tr");
  [lang === "es" ? "Nombre" : "Name", lang === "es" ? "Agentes" : "AI agents", lang === "es" ? "Acciones" : "Actions"].forEach((label) => head.append(ui.el("th", { text: label })));
  tableNode.append(ui.el("thead", {}, [head]));
  const body = ui.el("tbody");
  if (!assets.length && !alert) {
    const empty = ui.el("td", { colspan: "3" });
    empty.append(ui.el("div", { class: "content-empty" }, [ui.el("strong", { text: sectionText(lang, "contentEmptyTitle") })]));
    body.append(ui.el("tr", {}, [empty]));
  }
  assets.forEach((asset) => {
    const row = ui.el("tr");
    const actions = ui.el("td");
    if (ui.state.canEdit) actions.append(ui.button("Remove", () => ui.deleteRow("acq_value_assets", asset.id)));
    row.append(
      ui.el("td", { text: asset.title || asset.kind }),
      ui.el("td", { text: (asset.agent_roles || []).map(roleName).join(", ") || "—" }),
      actions
    );
    body.append(row);
  });
  tableNode.append(body);
  wrap.append(ui.el("section", { class: "section-card" }, [ui.el("div", { class: "table-wrap" }, [tableNode])]));
  if (ui.state.canEdit && studio.contentOpen) {
    const form = assetForm(ui);
    form.id = "content-add";
    wrap.append(form);
  } else if (ui.state.canEdit) {
    const form = assetForm(ui);
    form.id = "content-add";
    form.hidden = true;
    wrap.append(form);
  }
  wrap.append(ownerClips(ui));
  if (ui.voiceLibrary) wrap.append(ui.voiceLibrary());
  return wrap;
}

function ownerClips(ui) {
  const section = ui.el("section", { class: "agent" });
  section.append(ui.el("h3", { text: "Recordings the setter can send" }));
  section.append(ui.el("p", { text: "Add a label and when to use it. The setter sends a recording only when that description fits the chat, and only once in that chat." }));
  const clips = ui.state.ownerClips || [];
  if (!clips.length) section.append(ui.el("p", { text: "No recordings yet." }));
  clips.forEach((clip) => {
    const card = ui.el("article", { class: "voice-card" });
    card.append(ui.el("h3", { text: clip.label || "Recording" }));
    if (clip.when_to_use) card.append(ui.el("p", { text: clip.when_to_use }));
    if (clip.kind === "audio" && ui.signClip) {
      const audio = ui.el("audio", { controls: true, preload: "none" });
      ui.signClip(clip.storage_path).then((url) => { if (url) audio.src = url; });
      card.append(audio);
    }
    if (ui.state.canEdit && ui.deleteOwnerClip) card.append(ui.button("Remove", () => ui.deleteOwnerClip(clip)));
    section.append(card);
  });
  if (ui.state.canEdit && ui.saveOwnerClip) section.append(clipForm(ui));
  return section;
}

function clipForm(ui) {
  const form = ui.el("form", { class: "agent" });
  form.append(ui.el("h3", { text: "Add a recording" }));
  const label = ui.field("Label", "");
  const when = ui.el("textarea", { rows: "3", "aria-label": "When to use", placeholder: "When the lead asks about the offer" });
  const file = ui.el("input", {
    type: "file",
    accept: "audio/*,video/mp4,video/quicktime,video/webm,image/jpeg,image/png",
    "aria-label": "Recording file"
  });
  const source = ui.el("select", { "aria-label": "Voice source", disabled: true });
  source.append(ui.el("option", { value: "recording", text: "Recording you upload" }));
  source.append(ui.el("option", { value: "clone", text: "Cloned voice, later", disabled: true }));
  form.append(label.label, ui.el("label", { text: "When to use" }, [when]), file, ui.el("label", { text: "Voice source" }, [source]));
  form.append(ui.button("Save recording", async (event) => {
    event.preventDefault();
    if (!label.input.value.trim() || !when.value.trim()) return ui.toast("Add a label and when to use it.", "bad");
    await ui.saveOwnerClip(file.files && file.files[0], { label: label.input.value, when: when.value });
  }));
  form.addEventListener("submit", (event) => event.preventDefault());
  return form;
}

function assetForm(ui) {
  const form = ui.el("form", { class: "agent" });
  form.append(ui.el("h3", { text: "Add content" }));
  const kind = select(ui, "Type", CONTENT_TYPES.map((item) => [item, item]), "link");
  const title = ui.field("Title", "");
  const url = ui.field("URL", "https://");
  const label = ui.field("Button label", "");
  const instructions = ui.field("Sending instructions", "");
  const placement = select(ui, "Placement", PLACEMENTS, "ai");
  const file = ui.el("input", { type: "file", "aria-label": "File" });
  const roles = rolePicker(ui);
  form.append(kind, title.label, url.label, label.label, instructions.label, placement, file, roles.wrap);
  form.append(ui.button("Save content", async (event) => {
    event.preventDefault();
    const checkResult = validateAsset({ type: kind.value, placement: placement.value, url: url.input.value, label: label.input.value, file: file.files && file.files[0], storagePath: "" });
    if (!checkResult.ok) return ui.toast(checkResult.errors[0], "bad");
    await ui.saveAsset({
      kind: kind.value,
      title: title.input.value.trim(),
      url: url.input.value.trim(),
      label: label.input.value.trim().slice(0, 20),
      send_instructions: instructions.input.value.trim(),
      placement: placement.value,
      agent_roles: roles.selected(),
      file: file.files && file.files[0]
    });
  }));
  form.addEventListener("submit", (event) => event.preventDefault());
  return form;
}

function rolePicker(ui) {
  const wrap = ui.el("fieldset", { class: "role-picker" });
  wrap.append(ui.el("legend", { text: "Agents" }));
  const inputs = ROLES.map((role) => {
    const label = ui.el("label", { text: " " + role.name });
    const input = ui.el("input", { type: "checkbox", value: role.id });
    label.prepend(input);
    wrap.append(label);
    return input;
  });
  return { wrap, selected: () => inputs.filter((input) => input.checked).map((input) => input.value) };
}

function select(ui, label, options, value) {
  const node = ui.el("select", { "aria-label": label });
  options.forEach((option) => {
    const pair = Array.isArray(option) ? option : [option, option];
    node.append(ui.el("option", { value: pair[0], text: pair[1] }));
  });
  node.value = value;
  return node;
}

function openLead(ui, lead) {
  box(ui).open = lead.kind + ":" + lead.id;
  ui.paint();
}

function roleName(id) {
  const found = ROLES.find((role) => role.id === id);
  return found ? found.name : (id || "");
}

function stateLabel(id) {
  const found = CRM_STATES.find((state) => state[0] === id);
  return found ? found[1] : id;
}

function scheduleLabel(id) {
  const found = SCHEDULE_PROVIDERS.find((item) => item[0] === id);
  return found ? found[1] : id;
}

function placementLabel(id) {
  const found = PLACEMENTS.find((item) => item[0] === id);
  return found ? found[1] : id;
}
