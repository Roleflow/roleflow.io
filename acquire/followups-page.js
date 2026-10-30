// Follow-ups: a 24-hour ladder, a 7-day list a person sends, welcome steps
// and reminders, on one page with four tabs. This page sends nothing.
// While DM sending is off, a due step is held and shown as held.

import { CRM_STATES } from "./studio-model.js";
import { mountSendBadge } from "./send-badge.js";
import { switchCard, text as agentText } from "./client-pages.js";
import { reminderBody } from "./studio-flow.js";
import {
  STATE_PROMPT_KEYS,
  WELCOME_LIMIT,
  halfDayLabel,
  halfDayOptions,
  hourLabel,
  ladderStepError,
  manualQueue,
  manualStepError,
  mergeStatePrompts,
  normalizeStatePrompts,
  quietLabel,
  replyRate,
  sortSteps,
  statePromptCount,
  welcomeStepError
} from "./followup-ladder.js";

export const FOLLOW_TABS = ["ladder", "manual", "welcome", "reminders"];

const COPY = {
  en: {
    title: "Follow-ups",
    intro: "Steps that go back to a quiet lead. Automatic steps stay inside 24 hours of the lead's last message. Nothing is sent while sending is off.",
    tabs: { ladder: "24-hour ladder", manual: "7-day manual", welcome: "Welcome", reminders: "Reminders" },
    held: "Sending is off. Steps are saved and shown here. Nothing is sent.",
    options: "Ladder options",
    restart: "Restart the ladder when the lead writes again",
    restartHelp: "On: a new message from the lead starts again at step 1. Off: a step already sent is never repeated.",
    beforeClose: "Send before office hours end",
    beforeCloseHelp: "Sends the next step in the last 15 minutes before closing instead of waiting for tomorrow.",
    beforeCloseNeeds: "Turn on office hours with one daily window in Settings to use this.",
    steps: "Steps",
    rules: "When are follow-ups sent?",
    addStep: "Add step",
    editStep: "Edit step",
    suggested: "Use suggested ladder (3h / 10h / 22h)",
    suggestedHelp: "Creates three AI steps, switched off, so you can write them before they run.",
    empty: "No follow-up steps yet.",
    emptyHelp: "Add the first step, or start from the suggested ladder.",
    best: "2 to 3 steps work best: around 2 to 4 h, 8 to 12 h and 20 to 23 h.",
    columns: ["On", "Wait", "Mode", "By state", "Content", "Voice note", ""],
    ai: "AI instructions",
    fixed: "Fixed text",
    anyState: "Any",
    none: "None",
    edit: "Edit",
    remove: "Delete",
    on: "On",
    off: "Off",
    wait: "Wait after the lead's last message",
    useAi: "Write with AI",
    useAiHelp: "On: the text is instructions and the AI writes the message. Off: each line is sent as written.",
    flipConfirm: "This changes what the text means. AI on: the text is instructions. AI off: each line is sent as written. Continue?",
    instructions: "Instructions",
    instructionsHint: "What should this follow-up do? The AI keeps the setter's voice and rules.",
    message: "Message, one per line",
    messageHint: "Hey, did you get a chance to look at this?",
    byState: "Instructions by state",
    byStateHelp: "One field per lead state. Leave a field empty to skip this step for that state. Lost, Unqualified and Postponed leads never get automatic follow-ups.",
    build: "Build instructions",
    content: "Content",
    noContent: "No content",
    voice: "Voice note",
    noVoice: "No voice note",
    voiceHelp: "Sent with this step inside the 24-hour window. Never sent twice to the same lead.",
    save: "Save step",
    cancel: "Cancel",
    stepsHelp: "Steps run in order of wait time.",
    manualSteps: "Manual steps",
    addManual: "Add manual step",
    editManual: "Edit manual step",
    manualEmpty: "No manual steps yet.",
    manualHelp: "For Lost leads, 1 to 6.5 days after their last message. A person sends these, never the AI.",
    manualColumns: ["Wait", "Mode", "Content", ""],
    waitDays: "Wait after the lead's last message",
    waiting: "Waiting for a person",
    waitingEmpty: "No lead is waiting for a manual follow-up.",
    waitingHelp: "Oldest silence first. Inside 7 days a person may reply. Keep it non-promotional.",
    closesIn: "Window closes in",
    load: "Load message",
    draftAi: "Draft with AI",
    sendDesk: "Send from Chats",
    sentIg: "Sent from Instagram",
    welcomeTitle: "Welcome steps",
    addWelcome: "Add welcome step",
    editWelcome: "Edit welcome step",
    welcomeEmpty: "No welcome steps yet.",
    welcomeHelp: "After our first message. Stops when the lead replies, when a person writes, or when the chat is set to manual. On Instagram only within 24 hours of our first message.",
    welcomeLimit: "Up to 2 welcome steps.",
    welcomeWait: "Wait after our first message",
    welcomeColumns: ["Step", "Wait", "Message", ""],
    textOnly: "Welcome steps are text only.",
    stats: "Reply rate",
    statsHelp: "A reply counts when it arrives within 24 hours of a step.",
    statsNone: "No follow-up sent yet.",
    rulesTitle: "When are follow-ups sent?",
    rulesList: [
      "Only after the lead writes to you: a DM, a story reply or a story mention. Comments, follows, likes and profile visits do not count.",
      "Automatic steps go out only inside 24 hours of the lead's last message. After that, only a person can reply, for up to 7 days.",
      "Never to leads marked Lost, Unqualified or Postponed. Never while the lead is waiting for an answer. Never within 1 hour of our last message.",
      "Not for leads you follow, if Skip leads I follow is on in Settings.",
      "Paused while a Resume conversation reminder is open.",
      "Never the same text, content or voice note twice.",
      "Office hours and quiet hours apply.",
      "Nothing is sent while sending is off."
    ],
    close: "Close"
  },
  es: {
    title: "Seguimientos",
    intro: "Pasos para volver a escribir a un lead en silencio. Los pasos automáticos se envían dentro de las 24 horas desde el último mensaje del lead. No se envía nada mientras el envío está apagado.",
    tabs: { ladder: "Escalera 24 h", manual: "Manual 7 días", welcome: "Bienvenida", reminders: "Recordatorios" },
    held: "El envío está apagado. Los pasos se guardan y se muestran aquí. No se envía nada.",
    options: "Opciones de la escalera",
    restart: "Reiniciar la escalera cuando el lead vuelve a escribir",
    restartHelp: "Activado: un mensaje nuevo del lead empieza otra vez en el paso 1. Apagado: un paso ya enviado no se repite.",
    beforeClose: "Enviar antes del cierre",
    beforeCloseHelp: "Envía el siguiente paso en los últimos 15 minutos antes del cierre en vez de esperar a mañana.",
    beforeCloseNeeds: "Activa un horario de oficina diario en Ajustes para usar esto.",
    steps: "Pasos",
    rules: "¿Cuándo se envían?",
    addStep: "Añadir paso",
    editStep: "Editar paso",
    suggested: "Usar escalera sugerida (3 h / 10 h / 22 h)",
    suggestedHelp: "Crea tres pasos con IA, apagados, para que los escribas antes de que funcionen.",
    empty: "Todavía no hay pasos de seguimiento.",
    emptyHelp: "Añade el primer paso o empieza con la escalera sugerida.",
    best: "Funcionan mejor 2 o 3 pasos: hacia 2 a 4 h, 8 a 12 h y 20 a 23 h.",
    columns: ["Activo", "Espera", "Modo", "Por estado", "Contenido", "Nota de voz", ""],
    ai: "Instrucciones IA",
    fixed: "Texto fijo",
    anyState: "Todos",
    none: "Ninguno",
    edit: "Editar",
    remove: "Eliminar",
    on: "Activo",
    off: "Apagado",
    wait: "Espera desde el último mensaje del lead",
    useAi: "Escribir con IA",
    useAiHelp: "Activado: el texto son instrucciones y la IA escribe el mensaje. Apagado: cada línea se envía tal cual.",
    flipConfirm: "Esto cambia el sentido del texto. IA activada: el texto son instrucciones. IA apagada: cada línea se envía tal cual. ¿Continuar?",
    instructions: "Instrucciones",
    instructionsHint: "¿Qué debe hacer este seguimiento? La IA mantiene la voz y las reglas del setter.",
    message: "Mensaje, uno por línea",
    messageHint: "Hola, ¿pudiste verlo?",
    byState: "Instrucciones por estado",
    byStateHelp: "Un campo por estado del lead. Deja un campo vacío para saltar este paso en ese estado. Los leads Perdidos, No cualificados y Pospuestos nunca reciben seguimientos automáticos.",
    build: "Crear instrucciones",
    content: "Contenido",
    noContent: "Sin contenido",
    voice: "Nota de voz",
    noVoice: "Sin nota de voz",
    voiceHelp: "Se envía con este paso dentro de las 24 horas. Nunca dos veces al mismo lead.",
    save: "Guardar paso",
    cancel: "Cancelar",
    stepsHelp: "Los pasos van en orden de espera.",
    manualSteps: "Pasos manuales",
    addManual: "Añadir paso manual",
    editManual: "Editar paso manual",
    manualEmpty: "Todavía no hay pasos manuales.",
    manualHelp: "Para leads Perdidos, de 1 a 6,5 días después de su último mensaje. Los envía una persona, nunca la IA.",
    manualColumns: ["Espera", "Modo", "Contenido", ""],
    waitDays: "Espera desde el último mensaje del lead",
    waiting: "Esperando a una persona",
    waitingEmpty: "Ningún lead espera un seguimiento manual.",
    waitingHelp: "Primero el silencio más largo. Dentro de 7 días puede responder una persona. Sin tono promocional.",
    closesIn: "La ventana cierra en",
    load: "Cargar mensaje",
    draftAi: "Redactar con IA",
    sendDesk: "Enviar desde Chats",
    sentIg: "Enviado desde Instagram",
    welcomeTitle: "Pasos de bienvenida",
    addWelcome: "Añadir paso de bienvenida",
    editWelcome: "Editar paso de bienvenida",
    welcomeEmpty: "Todavía no hay pasos de bienvenida.",
    welcomeHelp: "Después de nuestro primer mensaje. Se detiene cuando el lead responde, cuando escribe una persona o cuando el chat pasa a manual. En Instagram solo dentro de las 24 horas desde nuestro primer mensaje.",
    welcomeLimit: "Hasta 2 pasos de bienvenida.",
    welcomeWait: "Espera desde nuestro primer mensaje",
    welcomeColumns: ["Paso", "Espera", "Mensaje", ""],
    textOnly: "Los pasos de bienvenida son solo texto.",
    stats: "Tasa de respuesta",
    statsHelp: "Cuenta una respuesta si llega dentro de las 24 horas después de un paso.",
    statsNone: "Todavía no se ha enviado ningún seguimiento.",
    rulesTitle: "¿Cuándo se envían los seguimientos?",
    rulesList: [
      "Solo después de que el lead te escriba: un DM, una respuesta a una historia o una mención en historia. Comentarios, follows, likes y visitas al perfil no cuentan.",
      "Los pasos automáticos solo salen dentro de las 24 horas desde el último mensaje del lead. Después, solo una persona puede responder, hasta 7 días.",
      "Nunca a leads Perdidos, No cualificados o Pospuestos. Nunca mientras el lead espera respuesta. Nunca dentro de 1 hora desde nuestro último mensaje.",
      "No a leads que sigues, si Saltar leads que sigo está activado en Ajustes.",
      "En pausa mientras haya un recordatorio de Retomar conversación abierto.",
      "Nunca el mismo texto, contenido o nota de voz dos veces.",
      "Se aplican el horario de oficina y las horas de silencio.",
      "No se envía nada mientras el envío está apagado."
    ],
    close: "Cerrar"
  }
};

const STATE_LABELS = {
  en: Object.fromEntries(CRM_STATES),
  es: { open: "Abierto", discovering: "Descubriendo", qualifying: "Cualificando", proposal: "Propuesta", booked: "Reservado", paid: "Pagado", lost: "Perdido", unqualified: "No cualificado", postponed: "Pospuesto" }
};

function lang(ui) {
  return ui.language && ui.language() === "es" ? "es" : "en";
}

export function followCopy(language) {
  return COPY[language === "es" ? "es" : "en"];
}

export function followDesk(ui) {
  if (!ui.state.followDesk) ui.state.followDesk = { tab: "ladder", dialog: "", editing: "", rules: false, stateOpen: false };
  if (!FOLLOW_TABS.includes(ui.state.followDesk.tab)) ui.state.followDesk.tab = "ladder";
  return ui.state.followDesk;
}

function sendingOn(ui) {
  const dm = ui.state.autoDm || {};
  return dm.enabled === true && dm.killed !== true;
}

export function renderFollowupsPage(ui) {
  const copy = followCopy(lang(ui));
  const desk = followDesk(ui);
  const wrap = ui.el("div", { class: "studio cta-page followups-page" });
  const header = ui.pageHeader
    ? ui.pageHeader(ui, copy.title, copy.intro, "followups", "trend")
    : ui.el("h2", { text: copy.title });
  mountSendBadge(header, ui);
  wrap.append(header);
  const top = switchCard(ui, "followup", agentText(lang(ui)));
  top.classList.add("follow-top");
  if (!sendingOn(ui)) top.append(ui.el("p", { class: "follow-held", role: "status", text: copy.held }));
  wrap.append(top);
  const tabs = ui.el("div", { class: "cta-tabs", role: "tablist" });
  FOLLOW_TABS.forEach((id) => {
    const button = ui.el("button", { type: "button", role: "tab", "data-follow-tab": id, "aria-pressed": desk.tab === id ? "true" : "false" }, [copy.tabs[id]]);
    button.addEventListener("click", () => {
      desk.tab = id;
      desk.dialog = "";
      desk.editing = "";
      if (typeof history !== "undefined" && typeof location !== "undefined") {
        history.replaceState(null, "", location.pathname + location.search + "#followup/" + id);
      }
      ui.paint();
    });
    tabs.append(button);
  });
  wrap.append(tabs);
  if (desk.tab === "ladder") wrap.append(ladderTab(ui, copy));
  if (desk.tab === "manual") wrap.append(manualTab(ui, copy));
  if (desk.tab === "welcome") wrap.append(welcomeTab(ui, copy));
  if (desk.tab === "reminders") wrap.append(reminderBody(ui));
  if (desk.rules) wrap.append(rulesDialog(ui, copy));
  return wrap;
}

function ladderTab(ui, copy) {
  const host = ui.el("div", { class: "cta-stack" });
  host.append(optionsCard(ui, copy));
  host.append(stepTable(ui, copy));
  host.append(statsCard(ui, copy, "auto"));
  if (followDesk(ui).dialog === "ladder") host.append(dialog(ui, copy, ladderForm(ui, copy)));
  return host;
}

function optionsCard(ui, copy) {
  const settings = ui.state.settings || {};
  const card = ui.el("section", { class: "agent cta-card follow-options" });
  card.append(ui.el("h3", { text: copy.options }));
  const restart = check(ui, copy.restart, settings.followup_restart_on_reply === true, "follow-restart");
  const officeReady = settings.office_mode === "same";
  const before = check(ui, copy.beforeClose, settings.followup_before_close === true && officeReady, "follow-before-close");
  if (!ui.state.canEdit) restart.input.disabled = true;
  if (!ui.state.canEdit || !officeReady) before.input.disabled = true;
  restart.input.addEventListener("change", () => ui.saveFollowupOptions({ followup_restart_on_reply: restart.input.checked }));
  before.input.addEventListener("change", () => ui.saveFollowupOptions({ followup_before_close: before.input.checked }));
  card.append(restart.label, ui.el("p", { class: "mute follow-switch-help", text: copy.restartHelp }));
  card.append(before.label, ui.el("p", { class: "mute follow-switch-help", text: officeReady ? copy.beforeCloseHelp : copy.beforeCloseNeeds }));
  return card;
}

function listHead(ui, title, actions) {
  const head = ui.el("div", { class: "cta-list-head" });
  head.append(ui.el("h3", { text: title }));
  const bar = ui.el("div", { class: "cta-actions" });
  actions.filter(Boolean).forEach((node) => bar.append(node));
  head.append(bar);
  return head;
}

function rulesButton(ui, copy) {
  const button = ui.button(copy.rules, () => { followDesk(ui).rules = true; ui.paint(); });
  button.classList.add("cta-secondary");
  button.id = "follow-rules";
  return button;
}

function openDialog(ui, kind, id) {
  const desk = followDesk(ui);
  desk.dialog = kind;
  desk.editing = id || "";
  desk.stateOpen = false;
  ui.paint();
}

function stepTable(ui, copy) {
  const language = lang(ui);
  const card = ui.el("section", { class: "agent cta-card" });
  const steps = sortSteps(ui.state.followupSteps || []);
  let add = null;
  if (ui.state.canEdit) {
    add = ui.button(copy.addStep, () => openDialog(ui, "ladder", ""));
    add.id = "follow-add-step";
  }
  card.append(listHead(ui, copy.steps, [rulesButton(ui, copy), add]));
  if (!steps.length) {
    const empty = ui.el("div", { class: "follow-empty", id: "follow-empty" });
    empty.append(ui.el("strong", { text: copy.empty }), ui.el("p", { class: "mute", text: copy.emptyHelp }));
    if (ui.state.canEdit) {
      const suggested = ui.button(copy.suggested, () => ui.createSuggestedLadder());
      suggested.id = "follow-suggested";
      empty.append(suggested, ui.el("p", { class: "mute", text: copy.suggestedHelp }));
    }
    card.append(empty);
    card.append(ui.el("p", { class: "mute", text: copy.best }));
    return card;
  }
  const assets = new Map((ui.state.valueAssets || []).map((row) => [row.id, row]));
  const voices = new Map((ui.state.voices || []).map((row) => [row.id, row]));
  const table = ui.el("table", { class: "cta-table follow-table" });
  const head = ui.el("tr");
  copy.columns.forEach((label) => head.append(ui.el("th", { text: label })));
  table.append(ui.el("thead", {}, [head]));
  const body = ui.el("tbody");
  steps.forEach((step) => {
    const line = ui.el("tr", { "data-step": step.id });
    const toggle = ui.el("input", { type: "checkbox", "aria-label": copy.on + " " + hourLabel(step.hours, language) });
    toggle.checked = step.enabled !== false;
    toggle.disabled = !ui.state.canEdit;
    toggle.addEventListener("change", () => ui.toggleFollowupStep(step.id, toggle.checked));
    const sw = ui.el("label", { class: "switch" });
    sw.append(toggle);
    const count = statePromptCount(step.state_prompts);
    const asset = step.asset_id ? assets.get(step.asset_id) : null;
    const voice = step.voice_note_id ? voices.get(step.voice_note_id) : null;
    line.append(
      ui.el("td", {}, [sw]),
      ui.el("td", {}, [ui.el("span", { class: "follow-pill", text: hourLabel(step.hours, language) })]),
      ui.el("td", { text: step.mode === "ai" ? copy.ai : copy.fixed }),
      ui.el("td", { text: count ? count + " / " + STATE_PROMPT_KEYS.length : (step.crm_state ? stateLabel(language, step.crm_state) : copy.anyState) }),
      ui.el("td", { text: asset ? asset.title || asset.label || asset.kind : "—" }),
      ui.el("td", { text: voice ? voice.title || copy.voice : "—" })
    );
    const actions = ui.el("td");
    if (ui.state.canEdit) {
      const bar = ui.el("div", { class: "cta-actions" });
      const edit = ui.button(copy.edit, () => openDialog(ui, "ladder", step.id));
      edit.classList.add("cta-secondary");
      const remove = ui.button(copy.remove, () => ui.deleteFlowRow("acq_followup_steps", step.id));
      remove.classList.add("cta-danger");
      bar.append(edit, remove);
      actions.append(bar);
    }
    line.append(actions);
    body.append(line);
  });
  table.append(body);
  card.append(ui.el("div", { class: "table-wrap" }, [table]));
  card.append(ui.el("p", { class: "mute", text: copy.stepsHelp + " " + copy.best }));
  return card;
}

function stateLabel(language, key) {
  return (STATE_LABELS[language] || STATE_LABELS.en)[key] || key;
}

function ladderForm(ui, copy) {
  const language = lang(ui);
  const desk = followDesk(ui);
  const editing = (ui.state.followupSteps || []).find((row) => row.id === desk.editing) || null;
  const form = ui.el("form", { class: "agent cta-card", id: "follow-step-form" });
  form.append(ui.el("h3", { text: editing ? copy.editStep : copy.addStep }));
  const hours = select(ui, copy.wait, Array.from({ length: 23 }, (_item, index) => [String(index + 1), hourLabel(index + 1, language)]), String(editing ? editing.hours : 4));
  hours.id = "follow-hours";
  const ai = ui.el("input", { type: "checkbox", id: "follow-ai" });
  ai.checked = editing ? editing.mode === "ai" : true;
  const aiLabel = ui.el("label", { class: "switch", text: " " + copy.useAi });
  aiLabel.prepend(ai);
  const body = ui.el("textarea", { id: "follow-body", rows: "5" });
  body.value = editing ? editing.body || "" : "";
  const bodyLabel = ui.el("label");
  const bodyName = ui.el("span");
  bodyLabel.append(bodyName, body);
  const prompts = normalizeStatePrompts(editing ? editing.state_prompts : {});
  const statePanel = ui.el("div", { class: "follow-states", id: "follow-states" });
  const stateFields = {};
  STATE_PROMPT_KEYS.forEach((key) => {
    const area = ui.el("textarea", { rows: "2", "data-state": key });
    area.value = prompts[key] || "";
    stateFields[key] = area;
    statePanel.append(labeled(ui, stateLabel(language, key), area));
  });
  const build = ui.button(copy.build, (event) => {
    event.preventDefault();
    const merged = mergeStatePrompts(readStates(stateFields));
    if (merged) body.value = [body.value.trim(), merged].filter(Boolean).join("\n");
  });
  build.classList.add("cta-secondary");
  statePanel.append(ui.el("p", { class: "mute", text: copy.byStateHelp }), build);
  const stateToggle = ui.button(copy.byState + (statePromptCount(prompts) ? " (" + statePromptCount(prompts) + ")" : ""), (event) => {
    event.preventDefault();
    desk.stateOpen = !desk.stateOpen;
    statePanel.hidden = !desk.stateOpen;
  });
  stateToggle.classList.add("cta-secondary");
  stateToggle.id = "follow-by-state";
  statePanel.hidden = !desk.stateOpen;
  const assets = ui.state.valueAssets || [];
  const asset = select(ui, copy.content, [["", copy.noContent]].concat(assets.map((row) => [row.id, row.title || row.label || row.kind])), editing ? editing.asset_id || "" : "");
  const notes = (ui.state.voices || []).filter((note) => note && !note.deleted_at && note.active !== false);
  const voice = select(ui, copy.voice, [["", copy.noVoice]].concat(notes.map((note) => [note.id, voiceName(note)])), editing ? editing.voice_note_id || "" : "");
  voice.id = "follow-voice";
  const paintMode = () => {
    bodyName.textContent = ai.checked ? copy.instructions : copy.message;
    body.placeholder = ai.checked ? copy.instructionsHint : copy.messageHint;
    stateToggle.hidden = !ai.checked;
    if (!ai.checked) statePanel.hidden = true;
    else statePanel.hidden = !desk.stateOpen;
  };
  ai.addEventListener("change", () => {
    if (body.value.trim() && typeof window !== "undefined" && window.confirm && !window.confirm(copy.flipConfirm)) {
      ai.checked = !ai.checked;
      return;
    }
    paintMode();
  });
  paintMode();
  form.append(labeled(ui, copy.wait, hours), aiLabel, ui.el("p", { class: "mute", text: copy.useAiHelp }), bodyLabel, stateToggle, statePanel);
  form.append(labeled(ui, copy.content, asset));
  form.append(labeled(ui, copy.voice, voice), ui.el("p", { class: "mute", text: copy.voiceHelp }));
  const save = ui.button(copy.save, async (event) => {
    event.preventDefault();
    const next = {
      id: editing ? editing.id : "",
      hours: Number(hours.value),
      mode: ai.checked ? "ai" : "text",
      body: body.value.trim(),
      crm_state: editing ? editing.crm_state || null : null,
      asset_id: asset.value || null,
      voice_note_id: voice.value || null,
      state_prompts: ai.checked ? readStates(stateFields) : {},
      enabled: editing ? editing.enabled !== false : true
    };
    const errors = ladderStepError(next);
    if (errors.length) return ui.toast(errors[0], "bad");
    closeDialog(ui);
    await ui.saveFollowupStep(next);
  });
  save.id = "follow-save-step";
  form.append(actionsRow(ui, copy, save));
  form.addEventListener("submit", (event) => event.preventDefault());
  return form;
}

function voiceName(note) {
  const seconds = Number(note.duration_ms) > 0 ? " · " + Math.round(Number(note.duration_ms) / 1000) + "s" : "";
  return (note.title || "Voice note") + seconds;
}

function readStates(fields) {
  const out = {};
  Object.entries(fields).forEach(([key, area]) => { out[key] = area.value; });
  return normalizeStatePrompts(out);
}

function manualTab(ui, copy) {
  const language = lang(ui);
  const host = ui.el("div", { class: "cta-stack" });
  const card = ui.el("section", { class: "agent cta-card" });
  let add = null;
  if (ui.state.canEdit) {
    add = ui.button(copy.addManual, () => openDialog(ui, "manual", ""));
    add.id = "follow-add-manual";
  }
  card.append(listHead(ui, copy.manualSteps, [add]));
  card.append(ui.el("p", { class: "mute", text: copy.manualHelp }));
  const steps = (ui.state.manualSteps || []).slice().sort((a, b) => a.wait_half_days - b.wait_half_days);
  if (!steps.length) card.append(ui.el("p", { text: copy.manualEmpty }));
  else {
    const assets = new Map((ui.state.valueAssets || []).map((row) => [row.id, row]));
    const table = ui.el("table", { class: "cta-table" });
    const head = ui.el("tr");
    copy.manualColumns.forEach((label) => head.append(ui.el("th", { text: label })));
    table.append(ui.el("thead", {}, [head]));
    const body = ui.el("tbody");
    steps.forEach((step) => {
      const line = ui.el("tr");
      const asset = step.asset_id ? assets.get(step.asset_id) : null;
      line.append(
        ui.el("td", {}, [ui.el("span", { class: "follow-pill", text: halfDayLabel(step.wait_half_days, language) })]),
        ui.el("td", { text: step.mode === "ai" ? copy.ai : copy.fixed }),
        ui.el("td", { text: asset ? asset.title || asset.kind : "—" })
      );
      const actions = ui.el("td");
      if (ui.state.canEdit) {
        const bar = ui.el("div", { class: "cta-actions" });
        const edit = ui.button(copy.edit, () => openDialog(ui, "manual", step.id));
        edit.classList.add("cta-secondary");
        const remove = ui.button(copy.remove, () => ui.deleteFlowRow("acq_manual_followup_steps", step.id));
        remove.classList.add("cta-danger");
        bar.append(edit, remove);
        actions.append(bar);
      }
      line.append(actions);
      body.append(line);
    });
    table.append(body);
    card.append(ui.el("div", { class: "table-wrap" }, [table]));
  }
  host.append(card);
  host.append(waitingCard(ui, copy, steps));
  host.append(statsCard(ui, copy, "manual"));
  if (followDesk(ui).dialog === "manual") host.append(dialog(ui, copy, manualForm(ui, copy)));
  return host;
}

function waitingCard(ui, copy, steps) {
  const language = lang(ui);
  const card = ui.el("section", { class: "agent cta-card", id: "follow-waiting" });
  card.append(ui.el("h3", { text: copy.waiting }));
  card.append(ui.el("p", { class: "mute", text: copy.waitingHelp }));
  const done = {};
  (ui.state.manualFollowups || []).forEach((row) => {
    if (!row.contact_id || !row.step_id || row.status !== "sent_by_human") return;
    (done[row.contact_id] = done[row.contact_id] || []).push(row.step_id);
  });
  const rows = manualQueue({ leads: ui.state.contacts || [], steps, done, now: ui.state.previewNow ? Date.parse(ui.state.previewNow) : Date.now() });
  if (!rows.length) {
    card.append(ui.el("p", { text: copy.waitingEmpty }));
    return card;
  }
  rows.forEach((row) => {
    const item = ui.el("article", { class: "follow-lead", "data-contact": row.lead.id });
    const top = ui.el("div", { class: "follow-lead-head" });
    top.append(
      ui.el("strong", { text: "@" + (row.lead.ig_handle || row.lead.name || "lead") }),
      ui.el("span", { class: "status-pill lost", text: stateLabel(language, "lost") }),
      ui.el("span", { class: "mute", text: quietLabel(row.quietMs, language) }),
      ui.el("span", { class: "follow-pill", text: halfDayLabel(row.step.wait_half_days, language) })
    );
    item.append(top);
    const draft = ui.el("textarea", { rows: "2", "aria-label": copy.message, class: "follow-draft" });
    draft.value = (ui.state.followDrafts || {})[row.lead.id] || "";
    draft.addEventListener("input", () => { ui.state.followDrafts = { ...(ui.state.followDrafts || {}), [row.lead.id]: draft.value }; });
    item.append(draft);
    item.append(ui.el("p", { class: "mute", text: copy.closesIn + " " + quietLabel(row.closesInMs, language).replace(/^Quiet |\s*en silencio$/g, "") }));
    if (ui.state.canEdit) {
      const bar = ui.el("div", { class: "cta-actions" });
      const load = ui.button(copy.load, () => { draft.value = row.step.mode === "text" ? row.step.body || "" : ""; draft.dispatchEvent(new Event("input")); });
      load.classList.add("cta-secondary");
      const ai = ui.button(copy.draftAi, async () => {
        const text = await ui.draftManualFollowup({ lead: row.lead, step: row.step });
        if (text) { draft.value = text; draft.dispatchEvent(new Event("input")); }
      });
      ai.classList.add("cta-secondary");
      const desk = ui.button(copy.sendDesk, () => ui.sendManualFromDesk(row.lead, row.step, draft.value));
      const ig = ui.button(copy.sentIg, () => ui.markManualSent(row.lead, row.step, draft.value));
      ig.classList.add("cta-secondary");
      bar.append(load, ai, desk, ig);
      item.append(bar);
    }
    card.append(item);
  });
  return card;
}

function manualForm(ui, copy) {
  const language = lang(ui);
  const desk = followDesk(ui);
  const editing = (ui.state.manualSteps || []).find((row) => row.id === desk.editing) || null;
  const form = ui.el("form", { class: "agent cta-card", id: "follow-manual-form" });
  form.append(ui.el("h3", { text: editing ? copy.editManual : copy.addManual }));
  const wait = select(ui, copy.waitDays, halfDayOptions().map((half) => [String(half), halfDayLabel(half, language)]), String(editing ? editing.wait_half_days : 2));
  const ai = ui.el("input", { type: "checkbox" });
  ai.checked = editing ? editing.mode === "ai" : false;
  const aiLabel = ui.el("label", { class: "switch", text: " " + copy.useAi });
  aiLabel.prepend(ai);
  const body = ui.el("textarea", { rows: "4" });
  body.value = editing ? editing.body || "" : "";
  const bodyName = ui.el("span");
  const bodyLabel = ui.el("label");
  bodyLabel.append(bodyName, body);
  const paint = () => { bodyName.textContent = ai.checked ? copy.instructions : copy.message; };
  ai.addEventListener("change", paint);
  paint();
  const assets = ui.state.valueAssets || [];
  const asset = select(ui, copy.content, [["", copy.noContent]].concat(assets.map((row) => [row.id, row.title || row.kind])), editing ? editing.asset_id || "" : "");
  form.append(labeled(ui, copy.waitDays, wait), aiLabel, bodyLabel, labeled(ui, copy.content, asset), ui.el("p", { class: "mute", text: copy.manualHelp }));
  const save = ui.button(copy.save, async (event) => {
    event.preventDefault();
    const next = { id: editing ? editing.id : "", wait_half_days: Number(wait.value), mode: ai.checked ? "ai" : "text", body: body.value.trim(), asset_id: asset.value || null };
    const errors = manualStepError(next);
    if (errors.length) return ui.toast(errors[0], "bad");
    closeDialog(ui);
    await ui.saveManualStep(next);
  });
  form.append(actionsRow(ui, copy, save));
  form.addEventListener("submit", (event) => event.preventDefault());
  return form;
}

function welcomeTab(ui, copy) {
  const language = lang(ui);
  const host = ui.el("div", { class: "cta-stack" });
  const card = ui.el("section", { class: "agent cta-card" });
  const rows = (ui.state.welcomeSteps || []).slice().sort((a, b) => a.position - b.position);
  let add = null;
  if (ui.state.canEdit) {
    add = ui.button(copy.addWelcome, () => openDialog(ui, "welcome", ""));
    add.id = "follow-add-welcome";
    if (rows.length >= WELCOME_LIMIT) add.disabled = true;
  }
  card.append(listHead(ui, copy.welcomeTitle, [add]));
  card.append(ui.el("p", { class: "mute", text: copy.welcomeHelp }));
  if (!rows.length) card.append(ui.el("p", { text: copy.welcomeEmpty }));
  else {
    const table = ui.el("table", { class: "cta-table" });
    const head = ui.el("tr");
    copy.welcomeColumns.forEach((label) => head.append(ui.el("th", { text: label })));
    table.append(ui.el("thead", {}, [head]));
    const body = ui.el("tbody");
    rows.forEach((row) => {
      const line = ui.el("tr");
      line.append(
        ui.el("td", { text: String(row.position) }),
        ui.el("td", {}, [ui.el("span", { class: "follow-pill", text: hourLabel(row.delay_hours, language) })]),
        ui.el("td", { class: "follow-text", text: row.body || "" })
      );
      const actions = ui.el("td");
      if (ui.state.canEdit) {
        const bar = ui.el("div", { class: "cta-actions" });
        const edit = ui.button(copy.edit, () => openDialog(ui, "welcome", row.id));
        edit.classList.add("cta-secondary");
        const remove = ui.button(copy.remove, () => ui.deleteFlowRow("acq_welcome_steps", row.id));
        remove.classList.add("cta-danger");
        bar.append(edit, remove);
        actions.append(bar);
      }
      line.append(actions);
      body.append(line);
    });
    table.append(body);
    card.append(ui.el("div", { class: "table-wrap" }, [table]));
  }
  if (rows.length >= WELCOME_LIMIT) card.append(ui.el("p", { class: "mute", text: copy.welcomeLimit }));
  host.append(card);
  host.append(statsCard(ui, copy, "welcome"));
  if (followDesk(ui).dialog === "welcome") host.append(dialog(ui, copy, welcomeForm(ui, copy, rows)));
  return host;
}

function welcomeForm(ui, copy, rows) {
  const language = lang(ui);
  const desk = followDesk(ui);
  const editing = rows.find((row) => row.id === desk.editing) || null;
  const form = ui.el("form", { class: "agent cta-card", id: "follow-welcome-form" });
  form.append(ui.el("h3", { text: editing ? copy.editWelcome : copy.addWelcome }));
  const wait = select(ui, copy.welcomeWait, Array.from({ length: 23 }, (_item, index) => [String(index + 1), hourLabel(index + 1, language)]), String(editing ? Math.max(1, Math.round(Number(editing.delay_hours) || 1)) : 1));
  const body = ui.el("textarea", { rows: "4", placeholder: copy.messageHint });
  body.value = editing ? editing.body || "" : "";
  form.append(labeled(ui, copy.welcomeWait, wait), labeled(ui, copy.message, body), ui.el("p", { class: "mute", text: copy.textOnly }));
  const save = ui.button(copy.save, async (event) => {
    event.preventDefault();
    const position = editing ? editing.position : (rows.some((row) => row.position === 1) ? 2 : 1);
    const next = { id: editing ? editing.id : "", position, delay_hours: Number(wait.value), body: body.value.trim(), mode: "text" };
    const list = rows.filter((row) => row.id !== next.id).concat([next]);
    const errors = welcomeStepError(list);
    if (errors.length) return ui.toast(errors[0], "bad");
    closeDialog(ui);
    await ui.saveWelcomeStep(next);
  });
  form.append(actionsRow(ui, copy, save));
  form.addEventListener("submit", (event) => event.preventDefault());
  return form;
}

function statsCard(ui, copy, track) {
  const card = ui.el("section", { class: "agent cta-card follow-stats" });
  const rate = replyRate(ui.state.followupSends || [], track);
  card.append(ui.el("h3", { text: copy.stats }));
  if (rate.rate == null) {
    card.append(ui.el("p", { class: "mute", text: copy.statsNone }));
    return card;
  }
  card.append(ui.el("strong", { class: "follow-rate", text: rate.rate + "%" }));
  card.append(ui.el("p", { class: "mute", text: rate.replied + " / " + rate.sent + " · " + copy.statsHelp }));
  return card;
}

function rulesDialog(ui, copy) {
  const card = ui.el("section", { class: "agent cta-card", id: "follow-rules-card" });
  card.append(ui.el("h3", { text: copy.rulesTitle }));
  const list = ui.el("ul", { class: "follow-rules" });
  copy.rulesList.forEach((line) => list.append(ui.el("li", { text: line })));
  card.append(list);
  const close = ui.button(copy.close, () => { followDesk(ui).rules = false; ui.paint(); });
  close.classList.add("cta-secondary");
  card.append(ui.el("div", { class: "cta-dialog-actions" }, [close]));
  return dialog(ui, copy, card, () => { followDesk(ui).rules = false; ui.paint(); });
}

function closeDialog(ui) {
  const desk = followDesk(ui);
  desk.dialog = "";
  desk.editing = "";
}

function dialog(ui, copy, form, onClose) {
  const shell = ui.el("div", { class: "cta-dialog" });
  const backdrop = ui.el("button", { type: "button", class: "cta-dialog-backdrop", "aria-label": copy.cancel });
  backdrop.addEventListener("click", onClose || (() => { closeDialog(ui); ui.paint(); }));
  form.classList.add("cta-dialog-card");
  form.setAttribute("role", "dialog");
  form.setAttribute("aria-modal", "true");
  shell.append(backdrop, form);
  return shell;
}

function actionsRow(ui, copy, save) {
  const cancel = ui.button(copy.cancel, (event) => { if (event) event.preventDefault(); closeDialog(ui); ui.paint(); });
  cancel.classList.add("cta-secondary");
  const row = ui.el("div", { class: "cta-dialog-actions" });
  row.append(save, cancel);
  return row;
}

function check(ui, label, checked, id) {
  const input = ui.el("input", { type: "checkbox", id });
  input.checked = checked === true;
  const wrap = ui.el("label", { class: "switch", text: " " + label });
  wrap.prepend(input);
  return { label: wrap, input };
}

function select(ui, label, options, value) {
  const node = ui.el("select", { "aria-label": label });
  options.forEach(([id, text]) => node.append(ui.el("option", { value: id, text })));
  node.value = value || "";
  return node;
}

function labeled(ui, name, node) {
  const label = ui.el("label");
  label.append(ui.el("span", { text: name }), node);
  return label;
}
