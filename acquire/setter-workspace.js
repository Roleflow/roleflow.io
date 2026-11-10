// Agentic Setter workspace. Practice stays in the browser until the signed-in
// preview calls the selected model. A voice note is transcribed on the server
// and the setter answers that transcript. Undo removes turns from the stored
// thread, so the next reply only remembers what is left. Nothing here sends
// an Instagram message.

import { PROMPT_MAX, diffLines } from "./prompt-history.js";
import { clampVoice, voiceFooter } from "./setter-voice.js";
import { MAX_CHARS, briefDocument, formatDelta, parseBriefDocument } from "./studio-model.js";
import { SIM_STATES, blankConversation, filterSimulations, lengthDelta, loadSimulations, saveSimulations } from "./sim-log.js";
import { splitReply } from "./split-reply.js";
import { recorderStartOptions } from "./voice-audio.js";
import {
  TRIAL_VOICE_MAX_BYTES,
  TRIAL_VOICE_MAX_MS,
  canRewindTo,
  exchangeStart,
  releaseVoiceUrls,
  rewindTrial,
  trialVoiceOutcome
} from "./trial-thread.js";

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
    working: "Working…",
    discard: "Discard",
    view: "View",
    compare: "Compare",
    unsaved: "Unsaved changes",
    splitLabel: "Split replies over this many words",
    editFailed: "The edit did not run.",
    analyzeFailed: "Analysis did not run.",
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
    configured: "Configured model: Claude Sonnet",
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
    quality: "Prompt quality",
    model: "Claude Sonnet",
    voice: "Human ↔ AI",
    voiceHuman: "Human",
    voiceAi: "AI",
    voiceHumanHint: "More varied, casual, and short. Slang can match the winning conversations.",
    voiceAiHint: "More consistent, structured, and predictable.",
    draftNote: "This is a draft. Save it to keep a new version. The setter stays off until you turn it on.",
    promptNote: "This is the setter system prompt. The simulator uses this text. Saving keeps a version and does not turn the setter on.",
    undo: "Undo",
    rewind: "Rewind to here",
    record: "Record a voice note",
    stopRecord: "Stop recording",
    upload: "Upload a voice note",
    recording: "Recording… press the mic to stop.",
    transcribing: "Transcribing the voice note…",
    voiceEmpty: "No speech was heard in that voice note. Nothing was sent to the setter.",
    voiceLong: "That voice note is too long to transcribe. Nothing was sent to the setter.",
    voiceSetup: "Voice transcription is not set up. Nothing was sent to the setter.",
    voiceSignIn: "Sign in to transcribe a voice note. Nothing was sent to the setter.",
    voiceMic: "The microphone is not available. Upload an audio file instead. Nothing was sent to the setter.",
    voiceFailed: "That voice note could not be transcribed. Nothing was sent to the setter."
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
    working: "Trabajando…",
    discard: "Descartar",
    view: "Ver",
    compare: "Comparar",
    unsaved: "Cambios sin guardar",
    splitLabel: "Parte las respuestas de más de estas palabras",
    editFailed: "La edición no se hizo.",
    analyzeFailed: "El análisis no se hizo.",
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
    configured: "Modelo configurado: Claude Sonnet",
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
    quality: "Calidad del prompt",
    model: "Claude Sonnet",
    voice: "Humano ↔ IA",
    voiceHuman: "Humano",
    voiceAi: "IA",
    voiceHumanHint: "Más variado, casual y corto. La jerga puede seguir las conversaciones que convirtieron.",
    voiceAiHint: "Más consistente, estructurado y predecible.",
    draftNote: "Esto es un borrador. Guárdalo para crear una versión. El setter sigue apagado hasta que lo actives.",
    promptNote: "Este es el prompt de sistema del setter. El simulador usa este texto. Guardar crea una versión y no activa el setter.",
    undo: "Deshacer",
    rewind: "Volver a este mensaje",
    record: "Grabar una nota de voz",
    stopRecord: "Parar la grabación",
    upload: "Subir una nota de voz",
    recording: "Grabando… pulsa el micrófono para parar.",
    transcribing: "Transcribiendo la nota de voz…",
    voiceEmpty: "No se oyó voz en esa nota. No se envió nada al setter.",
    voiceLong: "Esa nota de voz es demasiado larga. No se envió nada al setter.",
    voiceSetup: "La transcripción de voz no está configurada. No se envió nada al setter.",
    voiceSignIn: "Entra para transcribir una nota de voz. No se envió nada al setter.",
    voiceMic: "El micrófono no está disponible. Sube un archivo de audio. No se envió nada al setter.",
    voiceFailed: "Esa nota de voz no se pudo transcribir. No se envió nada al setter."
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

const MARKS = {
  business: ["M4 20V8a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v12", "M14 10h4a2 2 0 0 1 2 2v8", "M4 20h16", "M8 10h2", "M8 14h2"],
  prompts: ["M7 3h8l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z", "M15 3v6h6", "M9 13h6", "M9 17h6"],
  spark: ["M12 3l1.4 4.2L18 8.6 13.4 10 12 15l-1.4-5L6 8.6 10.6 7.2 12 3z", "M18 14l.7 2 2 .7-2 .7L18 20l-.7-2.1-2-.7 2-.7L18 14z"],
  send: ["M5 12h14", "M13 6l6 6-6 6"],
  hide: ["M15 6l-6 6 6 6"],
  show: ["M9 6l6 6-6 6"],
  chats: ["M5 6h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9l-4 3V7a1 1 0 0 1 1-1z"],
  reset: ["M4 12a8 8 0 1 0 2.3-5.6", "M4 4v5h5"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  undo: ["M9 14 4 9 9 4", "M4 9h10.5a5.5 5.5 0 1 1 0 11H12"],
  mic: ["M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z", "M19 11a7 7 0 0 1-14 0", "M12 18v3"],
  upload: ["M12 16V4", "M7 9l5-5 5 5", "M5 20h14"]
};

function mark(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  (MARKS[name] || []).forEach((d) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  });
  return svg;
}

function ghost(ui, text, onClick) {
  const node = ui.el("button", { type: "button", class: "desk-ghost" }, [text]);
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

function iconButton(ui, name, label, onClick) {
  const node = ui.el("button", {
    type: "button",
    class: "icon-btn",
    title: label,
    "aria-label": label
  }, [mark(name)]);
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

function roundSend(ui, label) {
  return ui.el("button", { type: "submit", class: "desk-send", title: label, "aria-label": label }, [mark("send")]);
}

function segment(ui, options, current, onPick) {
  const group = ui.el("div", { class: "seg", role: "group" });
  options.forEach(([id, label]) => {
    const button = ui.el("button", {
      type: "button",
      "aria-pressed": current === id ? "true" : "false"
    }, [label]);
    button.addEventListener("click", () => onPick(id));
    group.append(button);
  });
  return group;
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
    }, [mark(id), ui.el("span", { text: label })]);
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
  const head = ui.el("div", { class: "editor-head" });
  head.append(ui.el("h2", { text: prompts ? copy.prompts : copy.business }));
  const dirty = prompts && desk.editing && value.trim() !== String(ui.state.setterPrompt || "").trim();
  head.append(ui.el("span", { class: "desk-count", id: "desk-count", text: value.length.toLocaleString("en-US") + " / " + max.toLocaleString("en-US") + (dirty ? " · " + copy.unsaved : "") }));
  column.append(head);
  const tools = ui.el("div", { class: "desk-tools" });
  if (desk.editing) {
    const save = ui.button(copy.save, () => saveEditor(ui, prompts));
    save.classList.add("desk-save");
    tools.append(save);
    tools.append(ghost(ui, copy.cancel, () => {
      desk.editing = false;
      desk.showPreview = false;
      if (prompts) ui.state.setterDraft = ui.state.setterPrompt || "";
      else desk.businessDraft = null;
      ui.paint();
    }));
  } else {
    const edit = ghost(ui, copy.edit, () => {
      desk.editing = true;
      desk.showPreview = false;
      ui.paint();
    });
    if (!ui.state.canEdit) edit.disabled = true;
    tools.append(edit);
  }
  tools.append(segment(ui, [["text", copy.text], ["markdown", copy.markdown]], desk.showPreview ? "" : desk.format, (id) => {
    desk.format = id;
    desk.showPreview = false;
    ui.paint();
  }));
  const preview = ghost(ui, copy.preview, () => {
    desk.showPreview = !desk.showPreview;
    ui.paint();
  });
  if (desk.showPreview) preview.classList.add("is-on");
  preview.setAttribute("aria-pressed", desk.showPreview ? "true" : "false");
  tools.append(preview);
  column.append(tools);

  if (desk.showPreview) {
    const view = ui.el("div", { class: "desk-preview", id: prompts ? "setter-prompt-preview" : "business-preview" });
    view.innerHTML = plainPreview(value, desk.format === "markdown");
    column.append(view);
  } else {
    const area = ui.el("textarea", {
      id: prompts ? "setter-prompt" : "business-document",
      class: "desk-input",
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
    column.append(ui.el("p", { class: "mute", text: copy.promptNote }));
    if (ui.state.promptDraft) column.append(draftDiff(ui, copy, value));
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
  const score = quality && Number.isFinite(Number(quality.score)) ? Number(quality.score) : null;
  if (score == null) row.append(ui.el("span", { class: "quality-chip", text: copy.notAnalyzed }));
  else {
    const ring = ui.el("span", {
      class: "score-ring",
      style: "--p:" + Math.round(Math.max(0, Math.min(10, score)) * 10),
      title: copy.quality + " " + score + "/10",
      "aria-label": copy.quality + " " + score + "/10"
    }, [String(score)]);
    row.append(ring);
  }
  row.append(ghost(ui, copy.analysis, async () => {
    const prompt = currentPromptValue(ui);
    if (!ui.analyzePrompt) return;
    const button = row.querySelector("[data-analysis]");
    if (button) button.textContent = copy.working;
    const result = await ui.analyzePrompt(prompt);
    if (!result || result.error) {
      desk.analyzeError = (result && result.error) || copy.analyzeFailed;
      ui.paint();
      return;
    }
    desk.analyzeError = "";
    desk.quality = { score: result.score, items: result.items || [] };
    ui.paint();
  }));
  row.querySelector("button") && row.lastChild.setAttribute && row.lastChild.setAttribute("data-analysis", "1");
  const versions = ghost(ui, copy.versions, () => {
    desk.panel = desk.panel === "versions" ? "" : "versions";
    ui.paint();
  });
  if (desk.panel === "versions") versions.classList.add("is-on");
  row.append(versions);
  if (desk.analyzeError) row.append(ui.el("p", { class: "claude-notice", role: "status", text: desk.analyzeError }));
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
    const actions = ui.el("div", { class: "filters" });
    actions.append(ghost(ui, copy.view, () => {
      desk.viewVersion = desk.viewVersion === row.id ? "" : row.id;
      desk.compareVersion = "";
      ui.paint();
    }));
    actions.append(ghost(ui, copy.compare, () => {
      desk.compareVersion = desk.compareVersion === row.id ? "" : row.id;
      desk.viewVersion = "";
      ui.paint();
    }));
    actions.append(ghost(ui, copy.restore, () => {
      if (!window.confirm(copy.restore + "?")) return;
      ui.state.setterDraft = row.body || "";
      desk.editing = false;
      ui.restoreSetterPrompt(row);
    }));
    card.append(actions);
    if (desk.viewVersion === row.id) card.append(ui.el("pre", { class: "prompt-diff", text: row.body || "" }));
    if (desk.compareVersion === row.id) card.append(versionDiff(ui, row.body || ""));
    panel.append(card);
  });
  return panel;
}

function versionDiff(ui, body) {
  const host = ui.el("div", { class: "prompt-diff" });
  const rows = diffLines(ui.state.setterPrompt || "", body).filter((row) => row.type !== "same");
  if (!rows.length) host.append(ui.el("p", { class: "mute", text: "This matches the saved prompt." }));
  rows.slice(0, 80).forEach((row) => {
    host.append(ui.el("p", { class: "diff-line diff-" + row.type, text: (row.type === "add" ? "+ " : "− ") + row.text }));
  });
  return host;
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
  bar.append(ui.el("span", { class: "ai-spark", "aria-hidden": "true" }, [mark("spark")]));
  bar.append(input);
  bar.append(roundSend(ui, copy.apply));
  const status = ui.el("p", { id: "prompt-edit-status", class: "claude-notice", role: "status" });
  if (!desk.editError) status.hidden = true;
  else status.textContent = desk.editError;
  bar.addEventListener("submit", async (event) => {
    event.preventDefault();
    const instruction = input.value.trim();
    if (!instruction) return;
    if (!ui.editPrompt) {
      desk.editError = copy.editFailed;
      status.hidden = false;
      status.textContent = desk.editError;
      return;
    }
    input.disabled = true;
    status.hidden = false;
    status.textContent = copy.working;
    const result = await ui.editPrompt(currentPromptValue(ui), instruction);
    input.disabled = false;
    if (!result || result.error || !result.prompt) {
      desk.editError = (result && result.error) || copy.editFailed;
      status.textContent = desk.editError;
      return;
    }
    desk.editError = "";
    status.hidden = true;
    ui.state.promptDraft = { body: result.prompt, base: ui.state.setterPrompt || "" };
    ui.state.setterDraft = result.prompt;
    desk.editing = true;
    desk.aiInstruction = "";
    desk.quality = null;
    ui.paint();
  });
  const wrap = ui.el("div", { class: "ai-edit" });
  wrap.append(bar, status);
  if (ui.state.promptDraft) {
    const actions = ui.el("div", { class: "filters", id: "prompt-draft-actions" });
    actions.append(ui.button(copy.apply, async () => {
      desk.editing = false;
      desk.panel = "versions";
      await ui.saveSetterPrompt(ui.state.setterDraft || (ui.state.promptDraft && ui.state.promptDraft.body));
    }));
    actions.append(ghost(ui, copy.discard, () => {
      ui.state.promptDraft = null;
      ui.state.setterDraft = ui.state.setterPrompt || "";
      desk.editing = false;
      desk.editError = "";
      ui.paint();
    }));
    wrap.append(actions);
  }
  return wrap;
}

function currentPromptValue(ui) {
  const area = document.getElementById("setter-prompt");
  if (area) {
    ui.state.setterDraft = area.value;
    return area.value;
  }
  return savedPrompt(ui.state);
}

function draftDiff(ui, copy, value) {
  const wrap = ui.el("div", { id: "prompt-draft" });
  wrap.append(ui.el("p", { class: "claude-notice", text: copy.draftNote }));
  const host = ui.el("div", { class: "prompt-diff", id: "prompt-draft-diff" });
  const base = ui.state.promptDraft && ui.state.promptDraft.base != null ? ui.state.promptDraft.base : (ui.state.setterPrompt || "");
  const rows = diffLines(base, value).filter((row) => row.type !== "same");
  if (!rows.length) host.append(ui.el("p", { class: "mute", text: copy.noVersions }));
  rows.slice(0, 80).forEach((row) => {
    host.append(ui.el("p", { class: "diff-line diff-" + row.type, text: (row.type === "add" ? "+ " : "− ") + row.text }));
  });
  wrap.append(host);
  return wrap;
}

function voiceControl(ui, copy, suffix) {
  const lang = ui.language && ui.language() === "es" ? "es" : "en";
  const current = clampVoice(ui.state.setterVoice != null ? ui.state.setterVoice : (ui.state.settings && ui.state.settings.setter_voice));
  const wrap = ui.el("div", { class: "voice-slider" });
  const readout = ui.el("strong", { "data-voice-readout": "1", text: voiceFooter(current, lang) });
  const input = ui.el("input", {
    id: "voice-slider" + suffix,
    type: "range",
    min: "0",
    max: "100",
    step: "25",
    value: String(current),
    "data-voice-slider": "1",
    "aria-label": copy.voice
  });
  if (!ui.state.canEdit) input.disabled = true;
  input.addEventListener("input", () => {
    const next = clampVoice(input.value);
    ui.state.setterVoice = next;
    const label = voiceFooter(next, lang);
    document.querySelectorAll("[data-voice-readout]").forEach((node) => { node.textContent = label; });
    document.querySelectorAll("[data-voice-slider]").forEach((node) => { if (node !== input) node.value = String(next); });
  });
  input.addEventListener("change", () => { if (ui.saveVoice) ui.saveVoice(input.value); });
  wrap.append(ui.el("p", { class: "voice-label", text: copy.voice }));
  wrap.append(ui.el("div", { class: "voice-ends" }, [
    ui.el("span", { text: copy.voiceHuman }),
    readout,
    ui.el("span", { text: copy.voiceAi })
  ]));
  wrap.append(input);
  wrap.append(ui.el("p", { class: "mute", text: copy.voiceHumanHint }));
  wrap.append(ui.el("p", { class: "mute", text: copy.voiceAiHint }));
  return wrap;
}

function answeredChip(ui, copy) {
  const messages = ((ui.state.setterTrial || {}).messages || []).slice().reverse();
  const hit = messages.find((item) => item.role === "assistant" && item.providerLabel);
  if (!hit) return copy.model;
  return hit.model ? hit.providerLabel + " · " + hit.model : hit.providerLabel;
}

async function saveEditor(ui, prompts) {
  const desk = deskState(ui.state);
  if (prompts) {
    const area = document.getElementById("setter-prompt");
    const value = area ? area.value : savedPrompt(ui.state);
    ui.state.setterDraft = value;
    desk.editing = false;
    desk.panel = "versions";
    const saved = await ui.saveSetterPrompt(value);
    if (saved === false) {
      desk.editing = true;
      desk.panel = "";
      ui.paint();
    }
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
  if (desk.simCollapsed) {
    const show = iconButton(ui, "show", copy.show, () => {
      desk.simCollapsed = false;
      ui.paint();
    });
    show.setAttribute("aria-expanded", "false");
    show.setAttribute("aria-controls", "setter-trial");
    sim.append(show);
    return sim;
  }

  const versions = sortedVersions(ui);
  const badge = versions[0] ? "Version " + versions[0].version : "Unsaved draft";
  const title = ui.el("div", { class: "sim-title" });
  title.append(ui.el("h2", { text: copy.simulator }), ui.el("span", { class: "version-badge", text: badge }));
  const hide = iconButton(ui, "hide", copy.hide, () => {
    stopTrialRecorder(desk, true);
    desk.simCollapsed = true;
    ui.paint();
  });
  hide.setAttribute("aria-expanded", "true");
  hide.setAttribute("aria-controls", "setter-trial");
  const convos = iconButton(ui, "chats", copy.conversations, () => {
    desk.panel = desk.panel === "conversations" ? "" : "conversations";
    ui.paint();
  });
  if (desk.panel === "conversations") convos.classList.add("is-on");
  const trial = ui.state.setterTrial || { messages: [] };
  const undo = iconButton(ui, "undo", copy.undo, () => undoTrial(ui, null));
  undo.id = "setter-trial-undo";
  if (exchangeStart(trial.messages) < 0) undo.disabled = true;
  const reset = iconButton(ui, "reset", copy.reset, () => resetConversation(ui));
  const head = ui.el("div", { class: "sim-head" }, [title, ui.el("div", { class: "sim-actions" }, [undo, hide, convos, reset])]);
  sim.append(head);

  const statePick = ui.el("select", { id: "sim-lead-state", class: "lead-pill", "aria-label": copy.state, "data-state": desk.leadState });
  const lang = ui.language && ui.language() === "es" ? "es" : "en";
  SIM_STATES.forEach(([id, en, es]) => {
    statePick.append(ui.el("option", { value: id, text: lang === "es" ? es : en, selected: desk.leadState === id ? true : null }));
  });
  statePick.addEventListener("change", () => {
    desk.leadState = statePick.value;
    statePick.setAttribute("data-state", statePick.value);
  });
  const meta = ui.el("div", { class: "sim-meta" });
  meta.append(ui.el("a", { class: "model-chip", id: "sim-model-chip", href: "#settings/model" }, [answeredChip(ui, copy)]), statePick);
  sim.append(meta);
  sim.append(voiceControl(ui, copy, ""));
  if (desk.panel === "conversations") sim.append(conversationsPanel(ui, copy, desk));

  sim.append(segment(ui, [["lead", copy.lead], ["business", copy.businessSender]], desk.sender, (id) => {
    desk.sender = id;
    ui.paint();
  }));

  const log = ui.el("div", { id: "setter-trial-log", class: "dm-thread sim-thread" });
  (trial.messages || []).forEach((message, index) => log.append(trialBubble(ui, message, copy, index)));
  if (!(trial.messages || []).length) log.append(ui.el("p", { class: "mute", text: copy.empty }));
  sim.append(log);

  const compose = ui.el("form", { class: "sim-compose", id: "setter-trial-compose" });
  const mic = iconButton(ui, "mic", desk.recording ? copy.stopRecord : copy.record, () => toggleTrialRecord(ui, copy));
  mic.id = "setter-trial-mic";
  mic.setAttribute("aria-pressed", desk.recording ? "true" : "false");
  if (desk.recording) mic.classList.add("is-on", "is-recording");
  if (desk.transcribing) mic.disabled = true;
  const file = ui.el("input", {
    id: "setter-trial-file",
    class: "sim-file",
    type: "file",
    accept: "audio/*",
    "aria-label": copy.upload
  });
  file.addEventListener("change", () => {
    const chosen = file.files && file.files[0];
    file.value = "";
    if (chosen) acceptTrialVoice(ui, copy, chosen);
  });
  const upload = iconButton(ui, "upload", copy.upload, () => file.click());
  upload.id = "setter-trial-upload";
  if (desk.recording || desk.transcribing) upload.disabled = true;
  const input = ui.el("input", { id: "setter-trial-input", type: "text", maxlength: "500", placeholder: copy.compose, "aria-label": copy.compose });
  input.value = desk.compose || "";
  input.addEventListener("input", () => { desk.compose = input.value; });
  if (desk.focusCompose) {
    desk.focusCompose = false;
    queueMicrotask(() => {
      input.focus();
      const end = input.value.length;
      try { input.setSelectionRange(end, end); } catch (_error) { /* the field is text */ }
    });
  }
  compose.append(mic, upload, file, input, roundSend(ui, copy.send));
  compose.addEventListener("submit", (event) => {
    event.preventDefault();
    submitSim(ui, input.value, false);
  });
  sim.append(compose);
  const status = ui.el("p", {
    id: "setter-trial-status",
    class: "mute sim-status",
    role: "status",
    hidden: desk.statusText ? null : true,
    text: desk.statusText || ""
  });
  sim.append(status);

  const follow = ui.el("input", {
    id: "followup-number",
    class: "desk-num",
    type: "number",
    min: "1",
    max: "12",
    value: String(desk.followupNumber || 1),
    "aria-label": copy.followNumber
  });
  follow.addEventListener("input", () => { desk.followupNumber = Number(follow.value) || 1; });
  const followBtn = ghost(ui, copy.follow, () => submitSim(ui, "", true));
  followBtn.prepend(mark("clock"));
  sim.append(ui.el("div", { class: "follow-row" }, [followBtn, follow]));
  sim.append(delayFields(ui, copy));

  const simulate = ui.el("input", { id: "practice-delay", type: "checkbox" });
  simulate.checked = ui.state.practiceSimulateDelay === true;
  simulate.addEventListener("change", () => { ui.state.practiceSimulateDelay = simulate.checked; });
  sim.append(ui.el("label", { class: "switch" }, [simulate, " " + copy.delay]));

  const settings = ghost(ui, copy.settings, () => {
    desk.settingsOpen = !desk.settingsOpen;
    ui.paint();
  });
  sim.append(settings);
  if (desk.settingsOpen) sim.append(agentSettings(ui, copy, desk));
  return sim;
}

function conversationsPanel(ui, copy, desk) {
  const panel = ui.el("div", { class: "desk-panel", id: "sim-conversations" });
  const search = ui.el("input", { class: "desk-field", type: "search", value: desk.search || "", placeholder: copy.search, "aria-label": copy.search });
  const filter = ui.el("select", { class: "desk-field", "aria-label": copy.state });
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
    const button = ui.el("button", {
      type: "button",
      class: "sim-saved",
      text: row.title || ((row.messages && row.messages[0] && row.messages[0].text) || row.leadState || "Conversation")
    });
    button.addEventListener("click", () => {
      stopTrialRecorder(desk, true);
      const epoch = ((ui.state.setterTrial && ui.state.setterTrial.epoch) || 0) + 1;
      if (ui.state.setterTrial) ui.state.setterTrial.epoch = epoch;
      ui.state.setterTrial = { scenario: "follower", messages: (row.messages || []).slice(), leadState: row.leadState, epoch };
      desk.leadState = row.leadState || desk.leadState;
      desk.panel = "";
      ui.paint();
    });
    list.append(button);
  });
}

function resetConversation(ui) {
  const desk = deskState(ui.state);
  stopTrialRecorder(desk, true);
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
  const epoch = (trial.epoch || 0) + 1;
  trial.epoch = epoch;
  ui.state.setterTrial = { scenario: "follower", messages: [], leadState: desk.leadState, epoch };
  desk.compose = "";
  ui.paint();
}

function submitSim(ui, text, followup) {
  const desk = deskState(ui.state);
  const prompt = String(ui.state.setterPrompt || "").trim() || currentPromptValue(ui);
  if (!ui.state.setterTrial) ui.state.setterTrial = { scenario: "follower", messages: [] };
  ui.state.setterTrial.leadState = desk.leadState;
  if (followup) ui.sendTrial(prompt, "", { followup: Number(desk.followupNumber) || 1, leadState: desk.leadState });
  else {
    desk.compose = "";
    ui.sendTrial(prompt, text, { sender: desk.sender, leadState: desk.leadState });
  }
}

function undoTrial(ui, index) {
  const desk = deskState(ui.state);
  stopTrialRecorder(desk, true);
  const trial = ui.state.setterTrial || { messages: [] };
  const messages = trial.messages || [];
  const start = index == null ? exchangeStart(messages) : index;
  if (start < 0) return;
  if (index != null && !canRewindTo(messages[start])) return;
  const next = rewindTrial(messages, start);
  if (!next.changed) return;
  releaseVoiceUrls(next.removed);
  trial.messages = next.messages;
  trial.epoch = (trial.epoch || 0) + 1;
  ui.state.setterTrial = trial;
  if (next.sender) desk.sender = next.sender;
  if (next.draft) {
    desk.compose = next.draft;
    desk.focusCompose = true;
  }
  ui.paint();
}

function voiceFailCopy(copy, reason) {
  if (reason === "empty") return copy.voiceEmpty;
  if (reason === "too_long") return copy.voiceLong;
  if (reason === "no_provider") return copy.voiceSetup;
  if (reason === "signed_out") return copy.voiceSignIn;
  if (reason === "mic") return copy.voiceMic;
  return copy.voiceFailed;
}

function setTrialStatus(ui, text) {
  const desk = deskState(ui.state);
  desk.statusText = text || "";
  const node = document.getElementById("setter-trial-status");
  if (!node) return;
  node.hidden = !desk.statusText;
  node.textContent = desk.statusText;
}

function rememberCompose(desk) {
  const field = document.getElementById("setter-trial-input");
  if (field) desk.compose = field.value;
}

function stopTrialRecorder(desk, discard) {
  if (desk.recordTimer) {
    clearInterval(desk.recordTimer);
    desk.recordTimer = 0;
  }
  const recorder = desk.recorder;
  desk.recording = false;
  desk.recorder = null;
  if (recorder && recorder.state === "recording") {
    desk.discardRecording = discard === true;
    recorder.stop();
  }
}

async function toggleTrialRecord(ui, copy) {
  const desk = deskState(ui.state);
  if (desk.transcribing) return;
  if (desk.recorder && desk.recorder.state === "recording") {
    desk.recorder.stop();
    return;
  }
  const media = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
  if (!media || !media.getUserMedia || typeof MediaRecorder !== "function") {
    appendTrialError(ui, voiceFailCopy(copy, "mic"));
    return;
  }
  let stream;
  try {
    stream = await media.getUserMedia({ audio: true });
  } catch (_error) {
    appendTrialError(ui, voiceFailCopy(copy, "mic"));
    return;
  }
  const supports = (type) => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type);
  let recorder;
  try {
    recorder = new MediaRecorder(stream, recorderStartOptions(supports));
  } catch (_error) {
    try { recorder = new MediaRecorder(stream); }
    catch (_inner) {
      stream.getTracks().forEach((track) => track.stop());
      appendTrialError(ui, voiceFailCopy(copy, "mic"));
      return;
    }
  }
  const chunks = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size) chunks.push(event.data);
  });
  recorder.addEventListener("stop", () => {
    stream.getTracks().forEach((track) => track.stop());
    const discard = desk.discardRecording === true;
    desk.discardRecording = false;
    desk.recorder = null;
    desk.recording = false;
    if (desk.recordTimer) {
      clearInterval(desk.recordTimer);
      desk.recordTimer = 0;
    }
    if (discard) {
      desk.statusText = "";
      return;
    }
    const type = recorder.mimeType || (chunks[0] && chunks[0].type) || "audio/webm";
    acceptTrialVoice(ui, copy, new Blob(chunks, { type }));
  });
  desk.recorder = recorder;
  desk.recording = true;
  desk.recordStarted = Date.now();
  recorder.start();
  setTrialStatus(ui, copy.recording);
  const mic = document.getElementById("setter-trial-mic");
  if (mic) {
    mic.classList.add("is-on", "is-recording");
    mic.setAttribute("aria-pressed", "true");
    mic.setAttribute("aria-label", copy.stopRecord);
  }
  desk.recordTimer = setInterval(() => {
    if (Date.now() - desk.recordStarted >= TRIAL_VOICE_MAX_MS && desk.recorder && desk.recorder.state === "recording") desk.recorder.stop();
  }, 400);
}

async function acceptTrialVoice(ui, copy, blob) {
  const desk = deskState(ui.state);
  rememberCompose(desk);
  desk.transcribing = true;
  desk.statusText = copy.transcribing;
  ui.paint();
  let playbackUrl = "";
  try {
    if (!blob || !blob.size) return showTrialVoiceError(ui, copy, "empty", "");
    if (blob.size > TRIAL_VOICE_MAX_BYTES) return showTrialVoiceError(ui, copy, "too_long", "");
    playbackUrl = URL.createObjectURL(blob);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const result = ui.transcribeTrial ? await ui.transcribeTrial(bytes, blob.type || "") : { ok: false, reason: "signed_out" };
    const outcome = trialVoiceOutcome(result);
    if (!outcome.send) return showTrialVoiceError(ui, copy, outcome.reason, playbackUrl);
    desk.transcribing = false;
    desk.statusText = "";
    const prompt = String(ui.state.setterPrompt || "").trim() || currentPromptValue(ui);
    if (!ui.state.setterTrial) ui.state.setterTrial = { scenario: "follower", messages: [] };
    ui.state.setterTrial.leadState = desk.leadState;
    ui.sendTrial(prompt, outcome.transcript, {
      sender: "lead",
      leadState: desk.leadState,
      voice: {
        transcript: outcome.transcript,
        language: outcome.language,
        duration: outcome.duration,
        mime: blob.type || "",
        playbackUrl
      }
    });
  } catch (_error) {
    showTrialVoiceError(ui, copy, "transcribe", playbackUrl);
  }
}

function showTrialVoiceError(ui, copy, reason, playbackUrl) {
  const desk = deskState(ui.state);
  desk.transcribing = false;
  desk.statusText = "";
  if (playbackUrl) releaseVoiceUrls([{ voice: { playbackUrl } }]);
  appendTrialError(ui, voiceFailCopy(copy, reason));
}

function appendTrialError(ui, text) {
  if (!ui.state.setterTrial) ui.state.setterTrial = { scenario: "follower", messages: [], epoch: 0 };
  const trial = ui.state.setterTrial;
  trial.messages = (trial.messages || []).concat([{ role: "user", error: text, voiceError: true }]);
  const desk = deskState(ui.state);
  desk.transcribing = false;
  desk.statusText = "";
  ui.paint();
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
    ghost(ui, copy.saveDelay, () => ui.saveReplyDelay(min.value, max.value))
  );
  const split = ui.el("input", {
    id: "reply-split-words",
    type: "number",
    min: "0",
    max: "80",
    value: String(settings.reply_split_words == null ? 15 : settings.reply_split_words),
    "aria-label": copy.splitLabel
  });
  row.append(ui.el("label", { text: copy.splitLabel }, [split]), ghost(ui, copy.save, () => ui.saveReplySplit(split.value)));
  return row;
}

function trialBubble(ui, message, copy, index) {
  const role = message.role === "assistant" ? "setter" : "lead";
  const bubble = ui.el("article", { class: "dm-bubble " + role });
  if (message.error) {
    bubble.classList.add("is-error");
    bubble.append(ui.el("p", { text: message.error }));
    return bubble;
  }
  if (message.voice && (message.voice.playbackUrl || message.voice.transcript)) {
    if (message.voice.playbackUrl) {
      const audio = ui.el("audio", { controls: true, preload: "metadata" });
      audio.src = message.voice.playbackUrl;
      bubble.append(audio);
    }
    const transcript = message.voice.transcript || message.text || "";
    if (transcript) bubble.append(ui.el("p", { class: "dm-transcript", text: transcript }));
  } else if (message.text) bubble.append(ui.el("p", { text: message.text }));
  const line = message.modelLine || (message.preview ? copy.previewReply : (message.business ? copy.businessLine : ""));
  if (line) bubble.append(ui.el("p", { class: "mute dm-model", text: line }));
  if (message.versionLabel) bubble.append(ui.el("p", { class: "mute", text: message.versionLabel }));
  if (message.delayLine) bubble.append(ui.el("p", { class: "mute", text: message.delayLine }));
  if (canRewindTo(message)) {
    const back = iconButton(ui, "undo", copy.rewind, () => undoTrial(ui, index));
    back.classList.add("sim-rewind");
    bubble.append(back);
  }
  return bubble;
}

function agentSettings(ui, copy, desk) {
  const card = ui.el("form", { class: "agent agent-settings", id: "setter-agent-settings" });
  card.append(ui.el("h3", { text: copy.settings }));
  card.append(voiceControl(ui, copy, "-settings"));
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
  const saveAgent = ui.button(copy.saveAgent, null, "submit");
  saveAgent.classList.add("desk-save");
  card.append(saveAgent);
  card.append(ghost(ui, copy.close, () => {
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
