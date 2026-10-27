// Agentic Setter workspace. Practice stays in the browser until the signed-in
// preview calls the selected model. Nothing here sends an Instagram message.

import { PROMPT_MAX } from "./prompt-history.js";
import { MAX_CHARS, briefDocument, formatDelta, parseBriefDocument } from "./studio-model.js";
import { SIM_STATES, blankConversation, filterSimulations, lengthDelta, loadSimulations, saveSimulations } from "./sim-log.js";

const COPY = {
  en: {
    business: "Business",
    prompts: "Prompts",
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    text: "Text",
    markdown: "Markdown",
    preview: "Preview",
    analysis: "Analysis",
    notAnalyzed: "Not analyzed",
    versions: "Versions",
    restore: "Restore",
    noVersions: "No saved versions yet.",
    editAi: "Edit with AI",
    apply: "Apply",
    simulator: "Simulator",
    hide: "Hide simulator",
    show: "Show simulator",
    conversations: "Simulated conversations",
    noConversations: "No saved conversations yet.",
    search: "Search conversations",
    state: "Lead state",
    all: "All states",
    reset: "Reset",
    lead: "Lead",
    businessSender: "Business",
    compose: "Write a message",
    send: "Send",
    follow: "Simulate follow-up",
    followNumber: "Follow-up number",
    delay: "Simulate the reply delay. Leave this off to skip the wait. A wait of 0 is allowed.",
    empty: "The thread is empty. Write as the lead.",
    configured: "Configured model: Gemini 3 Flash",
    previewReply: "Preview reply. Nothing was sent.",
    businessLine: "Sent as the business in this preview. Nothing was sent on Instagram.",
    settings: "Agent settings",
    name: "Name",
    on: "On",
    off: "Off",
    delegations: "Delegations",
    noDelegations: "No delegations are saved for this business.",
    when: "When",
    handoff: "Hand off to",
    saveAgent: "Save agent",
    close: "Close",
    waitFrom: "Wait from",
    waitTo: "to",
    seconds: "seconds",
    saveDelay: "Save delay",
    manual: "Manual",
    imported: "Imported",
    team: "Team",
    quality: "Prompt quality"
  },
  es: {
    business: "Negocio",
    prompts: "Prompts",
    edit: "Editar",
    save: "Guardar",
    cancel: "Cancelar",
    text: "Texto",
    markdown: "Markdown",
    preview: "Vista previa",
    analysis: "Análisis",
    notAnalyzed: "Sin analizar",
    versions: "Versiones",
    restore: "Restaurar",
    noVersions: "Todavía no hay versiones.",
    editAi: "Editar con IA",
    apply: "Aplicar",
    simulator: "Simulador",
    hide: "Ocultar simulador",
    show: "Mostrar simulador",
    conversations: "Conversaciones simuladas",
    noConversations: "Todavía no hay conversaciones guardadas.",
    search: "Buscar conversaciones",
    state: "Estado del lead",
    all: "Todos los estados",
    reset: "Reset",
    lead: "Lead",
    businessSender: "Negocio",
    compose: "Escribe un mensaje",
    send: "Enviar",
    follow: "Simular seguimiento",
    followNumber: "Número de seguimiento",
    delay: "Simula la espera de respuesta. Déjalo apagado para saltarla. Una espera de 0 está permitida.",
    empty: "El hilo está vacío. Escribe como el lead.",
    configured: "Modelo configurado: Gemini 3 Flash",
    previewReply: "Respuesta de vista previa. No se envió nada.",
    businessLine: "Enviado como el negocio en esta vista previa. No se envió nada en Instagram.",
    settings: "Ajustes del agente",
    name: "Nombre",
    on: "Activo",
    off: "Apagado",
    delegations: "Delegaciones",
    noDelegations: "Este negocio no tiene delegaciones guardadas.",
    when: "Cuándo",
    handoff: "Pasar a",
    saveAgent: "Guardar agente",
    close: "Cerrar",
    waitFrom: "Esperar de",
    waitTo: "a",
    seconds: "segundos",
    saveDelay: "Guardar espera",
    manual: "Manual",
    imported: "Importado",
    team: "Equipo",
    quality: "Calidad del prompt"
  }
};

function copyFor(ui) {
  return COPY[ui.language && ui.language() === "es" ? "es" : "en"];
}

export function deskState(state) {
  const id = state.businessId || "";
  if (!state.setterDesk || state.setterDesk.businessId !== id) {
    const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
    const panel = params.get("panel");
    state.setterDesk = {
      businessId: id,
      mode: params.get("desk") === "business" ? "business" : "prompts",
      editing: false,
      format: "text",
      showPreview: false,
      simCollapsed: params.get("sim") === "collapsed",
      panel: panel === "versions" || panel === "conversations" ? panel : "",
      sender: "lead",
      leadState: "discovering",
      followupNumber: 1,
      search: "",
      stateFilter: "all",
      quality: null,
      aiInstruction: "",
      settingsOpen: false
    };
  }
  return state.setterDesk;
}

function savedPrompt(state) {
  return state.setterDraft != null ? state.setterDraft : (state.setterPrompt || "");
}

function businessText(ui) {
  const desk = deskState(ui.state);
  if (desk.businessDraft != null) return desk.businessDraft;
  const fields = (ui.state.brief && ui.state.brief.fields) || {};
  return briefDocument(fields, ui.language && ui.language());
}

function sortedVersions(ui) {
  return (ui.state.promptVersions || []).slice().sort((left, right) => Number(right.version) - Number(left.version));
}

function versionSource(ui, row, copy) {
  if (!row || !row.created_by) return copy.imported;
  if (ui.state.user && row.created_by === ui.state.user.id) return copy.manual;
  return copy.team;
}

function rememberSims(ui) {
  const list = ui.state.simConversations || [];
  saveSimulations(safeStorage(), ui.state.businessId, list);
}

function safeStorage() {
  try { return localStorage; } catch (_error) { return null; }
}

export function ensureSimulations(state) {
  if (Array.isArray(state.simConversations)) return state.simConversations;
  const stored = loadSimulations(safeStorage(), state.businessId);
  state.simConversations = stored.length ? stored : (state.previewSimulations || []);
  return state.simConversations;
}

function plainPreview(text, markdown) {
  const escaped = String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const body = markdown ? escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>") : escaped;
  return body.replace(/\n/g, "<br>");
}

export function renderSetterDesk(ui) {
  const copy = copyFor(ui);
  const desk = deskState(ui.state);
  ensureSimulations(ui.state);
  const es = ui.language && ui.language() === "es";
  const wrap = ui.el("div", {
    class: desk.simCollapsed ? "setter-desk is-collapsed" : "setter-desk",
    id: "setter-desk"
  });
  wrap.append(modeRail(ui, copy, desk), editorColumn(ui, copy, desk, es), simulatorColumn(ui, copy, desk));
  return wrap;
}

function modeRail(ui, copy, desk) {
  const rail = ui.el("nav", { class: "desk-modes", role: "tablist", "aria-label": copy.prompts });
  [["business", copy.business], ["prompts", copy.prompts]].forEach(([id, label]) => {
    const tab = ui.el("button", {
      type: "button",
      role: "tab",
      "aria-selected": desk.mode === id ? "true" : "false",
      "aria-controls": "desk-editor"
    }, [label]);
    tab.addEventListener("click", () => {
      desk.mode = id;
      desk.editing = false;
      desk.showPreview = false;
      desk.panel = "";
      ui.paint();
    });
    rail.append(tab);
  });
  return rail;
}

function editorColumn(ui, copy, desk, es) {
  const column = ui.el("section", { class: "desk-editor", id: "desk-editor" });
  const prompts = desk.mode !== "business";
  const value = prompts ? savedPrompt(ui.state) : businessText(ui);
  const max = prompts ? PROMPT_MAX : MAX_CHARS;
  column.append(ui.el("h2", { text: prompts ? copy.prompts : copy.business }));
  const tools = ui.el("div", { class: "desk-tools" });
  tools.append(ui.el("span", { class: "desk-count", id: "desk-count", text: value.length.toLocaleString("en-US") + " / " + max.toLocaleString("en-US") }));
  if (desk.editing) {
    tools.append(ui.button(copy.save, () => saveEditor(ui, prompts)));
    tools.append(ui.button(copy.cancel, () => {
      desk.editing = false;
      desk.showPreview = false;
      if (prompts) ui.state.setterDraft = ui.state.setterPrompt || "";
      else desk.businessDraft = null;
      ui.paint();
    }));
  } else {
    const edit = ui.button(copy.edit, () => {
      desk.editing = true;
      desk.showPreview = false;
      ui.paint();
    });
    if (!ui.state.canEdit) edit.disabled = true;
    tools.append(edit);
  }
  [["text", copy.text], ["markdown", copy.markdown]].forEach(([id, label]) => {
    const button = ui.button(label, () => {
      desk.format = id;
      desk.showPreview = false;
      ui.paint();
    });
    if (desk.format === id && !desk.showPreview) button.classList.add("on");
    tools.append(button);
  });
  const preview = ui.button(copy.preview, () => {
    desk.showPreview = !desk.showPreview;
    ui.paint();
  });
  if (desk.showPreview) preview.classList.add("on");
  tools.append(preview);
  column.append(tools);

  if (desk.showPreview) {
    const view = ui.el("div", { class: "desk-preview", id: prompts ? "setter-prompt-preview" : "business-preview" });
    view.innerHTML = plainPreview(value, desk.format === "markdown");
    column.append(view);
  } else {
    const area = ui.el("textarea", {
      id: prompts ? "setter-prompt" : "business-document",
      rows: "14",
      maxlength: String(max),
      "aria-label": prompts ? copy.prompts : copy.business
    });
    area.value = value;
    if (!desk.editing) area.readOnly = true;
    area.addEventListener("input", () => {
      if (prompts) ui.state.setterDraft = area.value;
      else desk.businessDraft = area.value;
      const count = document.getElementById("desk-count");
      if (count) count.textContent = area.value.length.toLocaleString("en-US") + " / " + max.toLocaleString("en-US");
    });
    column.append(area);
  }

  if (prompts) {
    column.append(qualityRow(ui, copy, desk));
    const versions = versionsPanel(ui, copy, desk);
    if (versions) column.append(versions);
    column.append(aiBar(ui, copy, desk));
  }
  else column.append(ui.el("p", { class: "mute", text: es ? "Este texto es el brief del negocio. Guardar escribe los campos que reconoces." : "This text is the business brief. Save writes the headings it recognizes." }));
  return column;
}

function qualityRow(ui, copy, desk) {
  const row = ui.el("div", { class: "quality-row" });
  const quality = desk.quality;
  const label = quality && Number.isFinite(quality.score)
    ? copy.quality + " " + quality.score + "/10"
    : copy.notAnalyzed;
  row.append(ui.el("strong", { text: label }));
  row.append(ui.button(copy.analysis, async () => {
    const prompt = currentPromptValue(ui);
    if (!ui.analyzePrompt) return;
    const result = await ui.analyzePrompt(prompt);
    if (!result) return;
    desk.quality = { score: result.score, items: result.items || [] };
    ui.paint();
  }));
  const versions = ui.button(copy.versions, () => {
    desk.panel = desk.panel === "versions" ? "" : "versions";
    ui.paint();
  });
  if (desk.panel === "versions") versions.classList.add("on");
  row.append(versions);
  if (quality && quality.items && quality.items.length) {
    const list = ui.el("ul", { class: "quality-items" });
    quality.items.forEach((item) => list.append(ui.el("li", { text: item })));
    row.append(list);
  }
  return row;
}

function versionsPanel(ui, copy, desk) {
  if (desk.panel !== "versions") return null;
  const panel = ui.el("div", { class: "desk-panel", id: "prompt-versions-panel" });
  const versions = sortedVersions(ui);
  if (!versions.length) {
    panel.append(ui.el("p", { class: "mute", text: copy.noVersions }));
    return panel;
  }
  versions.forEach((row, index) => {
    const previous = versions[index + 1];
    const card = ui.el("article", { class: "version-row" });
    const when = ui.when ? ui.when(row.created_at) : "";
    card.append(ui.el("strong", { text: "Version " + row.version + (when ? " · " + when : "") }));
    card.append(ui.el("p", { class: "mute", text: versionSource(ui, row, copy) + " · " + formatDelta(lengthDelta(row.body, previous ? previous.body : null)) }));
    card.append(ui.button(copy.restore, () => {
      if (!window.confirm(copy.restore + "?")) return;
      ui.state.setterDraft = row.body || "";
      desk.editing = false;
      ui.restoreSetterPrompt(row);
    }));
    panel.append(card);
  });
  return panel;
}

function aiBar(ui, copy, desk) {
  const bar = ui.el("form", { class: "ai-bar", id: "edit-with-ai" });
  const input = ui.el("input", {
    type: "text",
    maxlength: "500",
    value: desk.aiInstruction || "",
    placeholder: copy.editAi,
    "aria-label": copy.editAi
  });
  input.addEventListener("input", () => { desk.aiInstruction = input.value; });
  bar.append(input);
  bar.append(ui.button(copy.apply, null, "submit"));
  bar.addEventListener("submit", async (event) => {
    event.preventDefault();
    const instruction = input.value.trim();
    if (!instruction || !ui.editPrompt) return;
    const next = await ui.editPrompt(currentPromptValue(ui), instruction);
    if (!next) return;
    ui.state.setterDraft = next;
    desk.editing = true;
    desk.aiInstruction = "";
    desk.quality = null;
    ui.paint();
  });
  return bar;
}

function currentPromptValue(ui) {
  const area = document.getElementById("setter-prompt");
  if (area) {
    ui.state.setterDraft = area.value;
    return area.value;
  }
  return savedPrompt(ui.state);
}

async function saveEditor(ui, prompts) {
  const desk = deskState(ui.state);
  if (prompts) {
    const area = document.getElementById("setter-prompt");
    const value = area ? area.value : savedPrompt(ui.state);
    ui.state.setterDraft = value;
    await ui.saveSetterPrompt(value);
    desk.editing = false;
    return;
  }
  const area = document.getElementById("business-document");
  const text = area ? area.value : businessText(ui);
  desk.businessDraft = text;
  const fields = parseBriefDocument(text);
  if (ui.saveBrief) await ui.saveBrief(fields, ui.state.agentCards || [], "Business editor");
  desk.editing = false;
  desk.businessDraft = null;
}

function simulatorColumn(ui, copy, desk) {
  const sim = ui.el("aside", {
    class: desk.simCollapsed ? "desk-sim is-strip" : "desk-sim",
    id: "setter-trial",
    "aria-label": copy.simulator
  });
  const toggle = ui.el("button", {
    type: "button",
    class: "sim-collapse",
    "aria-expanded": desk.simCollapsed ? "false" : "true",
    "aria-controls": "setter-trial"
  }, [desk.simCollapsed ? copy.show : copy.hide]);
  toggle.addEventListener("click", () => {
    desk.simCollapsed = !desk.simCollapsed;
    ui.paint();
  });
  sim.append(toggle);
  if (desk.simCollapsed) return sim;

  const head = ui.el("div", { class: "sim-head" });
  head.append(ui.el("h2", { text: copy.simulator }));
  head.append(ui.el("a", { class: "btn ghost sm", href: "#settings/model" }, [ui.language && ui.language() === "es" ? "Clave del modelo" : "Model key"]));
  const versions = sortedVersions(ui);
  const badge = versions[0] ? "Version " + versions[0].version : "Unsaved draft";
  head.append(ui.el("span", { class: "version-badge", text: badge }));
  sim.append(head, ui.el("p", { class: "mute", text: copy.configured }));

  const statePick = ui.el("select", { id: "sim-lead-state", "aria-label": copy.state });
  const lang = ui.language && ui.language() === "es" ? "es" : "en";
  SIM_STATES.forEach(([id, en, es]) => {
    statePick.append(ui.el("option", { value: id, text: lang === "es" ? es : en, selected: desk.leadState === id ? true : null }));
  });
  statePick.addEventListener("change", () => { desk.leadState = statePick.value; });
  sim.append(statePick);

  const convos = ui.button(copy.conversations, () => {
    desk.panel = desk.panel === "conversations" ? "" : "conversations";
    ui.paint();
  });
  if (desk.panel === "conversations") convos.classList.add("on");
  const reset = ui.button(copy.reset, () => resetConversation(ui));
  reset.setAttribute("aria-label", "New conversation");
  sim.append(ui.el("div", { class: "desk-tools" }, [convos, reset]));
  if (desk.panel === "conversations") sim.append(conversationsPanel(ui, copy, desk));

  const sender = ui.el("div", { class: "desk-tools", role: "group", "aria-label": copy.lead });
  [["lead", copy.lead], ["business", copy.businessSender]].forEach(([id, label]) => {
    const button = ui.button(label, () => {
      desk.sender = id;
      ui.paint();
    });
    if (desk.sender === id) button.classList.add("on");
    sender.append(button);
  });
  sim.append(sender);

  const trial = ui.state.setterTrial || { messages: [] };
  const log = ui.el("div", { id: "setter-trial-log", class: "dm-thread sim-thread" });
  (trial.messages || []).forEach((message) => log.append(trialBubble(ui, message, copy)));
  if (!(trial.messages || []).length) log.append(ui.el("p", { class: "mute", text: copy.empty }));
  sim.append(log);

  const input = ui.el("input", { id: "setter-trial-input", type: "text", maxlength: "500", placeholder: copy.compose, "aria-label": copy.compose });
  const send = ui.button(copy.send, () => submitSim(ui, input.value, false));
  sim.append(ui.el("div", { class: "desk-tools" }, [input, send]));

  const follow = ui.el("input", {
    id: "followup-number",
    type: "number",
    min: "1",
    max: "12",
    value: String(desk.followupNumber || 1),
    "aria-label": copy.followNumber
  });
  follow.addEventListener("input", () => { desk.followupNumber = Number(follow.value) || 1; });
  sim.append(ui.el("div", { class: "desk-tools" }, [
    ui.button(copy.follow, () => submitSim(ui, "", true)),
    follow
  ]));
  sim.append(delayFields(ui, copy));

  const simulate = ui.el("input", { id: "practice-delay", type: "checkbox" });
  simulate.checked = ui.state.practiceSimulateDelay === true;
  simulate.addEventListener("change", () => { ui.state.practiceSimulateDelay = simulate.checked; });
  sim.append(ui.el("label", { class: "switch" }, [simulate, " " + copy.delay]));

  const settings = ui.button(copy.settings, () => {
    desk.settingsOpen = !desk.settingsOpen;
    ui.paint();
  });
  sim.append(settings);
  if (desk.settingsOpen) sim.append(agentSettings(ui, copy, desk));
  return sim;
}

function conversationsPanel(ui, copy, desk) {
  const panel = ui.el("div", { class: "desk-panel", id: "sim-conversations" });
  const search = ui.el("input", { type: "search", value: desk.search || "", placeholder: copy.search, "aria-label": copy.search });
  const filter = ui.el("select", { "aria-label": copy.state });
  filter.append(ui.el("option", { value: "all", text: copy.all }));
  const lang = ui.language && ui.language() === "es" ? "es" : "en";
  SIM_STATES.forEach(([id, en, es]) => filter.append(ui.el("option", { value: id, text: lang === "es" ? es : en })));
  filter.value = desk.stateFilter || "all";
  search.addEventListener("input", () => { desk.search = search.value; paintConversationList(ui, copy, desk, list); });
  filter.addEventListener("change", () => { desk.stateFilter = filter.value; paintConversationList(ui, copy, desk, list); });
  const list = ui.el("div");
  panel.append(search, filter, list);
  paintConversationList(ui, copy, desk, list);
  return panel;
}

function paintConversationList(ui, copy, desk, list) {
  list.replaceChildren();
  const rows = filterSimulations(ensureSimulations(ui.state), desk.search, desk.stateFilter);
  if (!rows.length) {
    list.append(ui.el("p", { class: "mute", text: copy.noConversations }));
    return;
  }
  rows.forEach((row) => {
    const button = ui.button(row.title || ((row.messages && row.messages[0] && row.messages[0].text) || row.leadState || "Conversation"), () => {
      ui.state.setterTrial = { scenario: "follower", messages: (row.messages || []).slice(), leadState: row.leadState };
      desk.leadState = row.leadState || desk.leadState;
      desk.panel = "";
      ui.paint();
    });
    list.append(button);
  });
}

function resetConversation(ui) {
  const desk = deskState(ui.state);
  const trial = ui.state.setterTrial || { messages: [] };
  if ((trial.messages || []).length) {
    const versions = sortedVersions(ui);
    const row = {
      ...blankConversation(desk.leadState),
      title: (trial.messages.find((item) => item.text) || {}).text || "Conversation",
      messages: trial.messages.slice(),
      versionLabel: versions[0] ? "Version " + versions[0].version : "",
      updatedAt: new Date().toISOString()
    };
    ui.state.simConversations = [row].concat(ensureSimulations(ui.state).filter((item) => item.id !== row.id));
    rememberSims(ui);
  }
  ui.state.setterTrial = { scenario: "follower", messages: [], leadState: desk.leadState };
  ui.paint();
}

function submitSim(ui, text, followup) {
  const desk = deskState(ui.state);
  const prompt = currentPromptValue(ui);
  if (!ui.state.setterTrial) ui.state.setterTrial = { scenario: "follower", messages: [] };
  ui.state.setterTrial.leadState = desk.leadState;
  if (followup) ui.sendTrial(prompt, "", { followup: Number(desk.followupNumber) || 1, leadState: desk.leadState });
  else ui.sendTrial(prompt, text, { sender: desk.sender, leadState: desk.leadState });
}

function delayFields(ui, copy) {
  const settings = ui.state.settings || {};
  const row = ui.el("div", { class: "setter-delay" });
  const min = ui.el("input", {
    id: "reply-delay-min",
    type: "number",
    min: "0",
    max: "300",
    value: String(settings.reply_delay_seconds == null ? 30 : settings.reply_delay_seconds),
    "aria-label": "Minimum reply delay in seconds"
  });
  const max = ui.el("input", {
    id: "reply-delay-max",
    type: "number",
    min: "0",
    max: "300",
    value: String(settings.reply_delay_max_seconds == null ? 120 : settings.reply_delay_max_seconds),
    "aria-label": "Maximum reply delay in seconds"
  });
  row.append(
    ui.el("label", { text: copy.waitFrom }, [min]),
    ui.el("label", { text: copy.waitTo }, [max]),
    ui.el("span", { class: "mute", text: copy.seconds }),
    ui.button(copy.saveDelay, () => ui.saveReplyDelay(min.value, max.value))
  );
  return row;
}

function trialBubble(ui, message, copy) {
  const role = message.role === "assistant" ? "setter" : "lead";
  const bubble = ui.el("article", { class: "dm-bubble " + role });
  if (message.error) {
    bubble.append(ui.el("p", { text: message.error }));
    return bubble;
  }
  if (message.text) bubble.append(ui.el("p", { text: message.text }));
  const line = message.preview ? copy.previewReply : (message.business ? copy.businessLine : message.modelLine);
  if (line) bubble.append(ui.el("p", { class: "mute dm-model", text: line }));
  if (message.versionLabel) bubble.append(ui.el("p", { class: "mute", text: message.versionLabel }));
  if (message.delayLine) bubble.append(ui.el("p", { class: "mute", text: message.delayLine }));
  return bubble;
}

function agentSettings(ui, copy, desk) {
  const card = ui.el("form", { class: "agent agent-settings", id: "setter-agent-settings" });
  card.append(ui.el("h3", { text: copy.settings }));
  const cards = ui.state.agentCards || [];
  const current = cards[0] || { role: "qualification", name: "", instructions: "", delegations: [] };
  const name = ui.el("input", { id: "setter-agent-name", type: "text", maxlength: "80", value: current.name || desk.agentName || "", "aria-label": copy.name });
  const on = (ui.state.agentSwitches || []).some((row) => row.agent_key === "setter" && row.enabled);
  const toggle = ui.el("input", { id: "setter-agent-on", type: "checkbox" });
  toggle.checked = on;
  card.append(ui.el("label", { text: copy.name }, [name]));
  card.append(ui.el("label", { class: "switch" }, [toggle, " " + (on ? copy.on : copy.off)]));
  card.append(ui.el("h3", { text: copy.delegations }));
  const delegations = (current.delegations || []).slice();
  if (!delegations.length) card.append(ui.el("p", { class: "mute", text: copy.noDelegations }));
  delegations.forEach((item) => card.append(ui.el("p", { text: item.when + " → " + item.to })));
  const when = ui.el("input", { type: "text", maxlength: "160", "aria-label": copy.when });
  const to = ui.el("input", { type: "text", maxlength: "80", "aria-label": copy.handoff });
  card.append(when, to);
  card.append(ui.button(copy.saveAgent, null, "submit"));
  card.append(ui.button(copy.close, () => {
    desk.settingsOpen = false;
    ui.paint();
  }));
  card.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nextOn = toggle.checked;
    if (nextOn !== on && ui.setAgent) await ui.setAgent("setter", nextOn);
    desk.agentName = name.value.trim();
    const whenText = when.value.trim();
    const toText = to.value.trim();
    const nextDelegations = delegations.slice();
    if (whenText && toText) nextDelegations.push({ when: whenText, to: toText });
    if (ui.saveAgent) {
      await ui.saveAgent({
        role: current.role || "qualification",
        name: name.value.trim(),
        instructions: current.instructions || "",
        delegations: nextDelegations
      });
    }
    desk.settingsOpen = false;
  });
  return card;
}
