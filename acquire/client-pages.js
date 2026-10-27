import { AGENT_KEYS, dashboardMetrics, DEFAULT_POLICY, normalizePolicy, previewReply, setterMayEnable } from "./agent-control.js";
import { beginInstagramConnect, disconnectInstagram, scrubChannelCopy } from "./connect-instagram.js";
import { CLIENT_PROVIDERS, keyHint, modelPatch } from "./model-key.js";
import { diffLines, PROMPT_MAX } from "./prompt-history.js";
import { BOOKING_TOKEN, TRIAL_SCENARIOS, voiceCatalog, voiceToken } from "./prompt-tokens.js";
import { renderRoleflowCalendar } from "./calendar-page.js";
import { sectionText } from "./section-copy.js";
import { renderSetterDesk } from "./setter-workspace.js";

const COPY = {
  en: {
    off: "Off",
    live: "Live",
    turnOn: "Turn on",
    turnOff: "Turn off",
    confirm: "Turn this agent live? It can message people on Instagram while it stays on.",
    saved: "Saved.",
    promptNeeded: "Save a system prompt, then try it below, before this can go live.",
    grokTitle: "Sign in to your Grok Bot",
    grokMissing: "The Grok Bot sign-in URL is not configured yet. This button stays off until a real https address is set. Nothing here pretends to scan Instagram.",
    grokOpen: "Open Grok Bot",
    warmer: "Lead Warmer watches new followers and recent likers, then runs the warm-up steps you approve in your own Grok Bot. Roleflow does not run that scan from this page.",
    outreach: "Outreacher finds people who fit the offer and starts conversations from your own Grok Bot. Roleflow does not send those first messages from this page.",
    setter: "Agentic Setter replies in Instagram DMs through the Roleflow connection. The system prompt below is what the reply engine uses. Practice stays inside Roleflow and does not send a message.",
    follow: "Follow Up Boss sends the next message only when the rules below match: quiet time, stage, booking, and the cap. It stays off until you turn it on.",
    commentVoice: "Comment voice reads comments on your Instagram posts. When a comment matches a keyword or an intent you write, it queues one private reply. It stays off until you turn it on.",
    commentLimit: "A comment can receive one private reply, and only within 7 days of the comment. That reply is text. The voice note you map is stored on the decision and is not attached. People who did not comment are not messaged.",
    commentEmpty: "No comment decisions yet.",
    commentRulesEmpty: "No rules yet. Add a keyword or an intent, then save.",
    channel: "Instagram messages are sent only while this agent is Live.",
    keyTitle: "Model key",
    keyLink: "Model key",
    keyBody: "The reply engine and the try panel use this business's key first. If none is saved, Roleflow uses its own key. After you save, this page shows only the last 4 characters.",
    keyProvider: "Provider",
    keyLabel: "API key",
    keyPlaceholder: "Paste a key to replace the saved one",
    keySaved: "Key ending in {last4}.",
    keyNone: "No key saved for this provider.",
    keySave: "Save key",
    keyRemove: "Remove key",
    keyTest: "Test key",
    keyChecking: "Checking…",
    keyLocked: "Only an owner or admin can change this key.",
    igTitle: "Connect Instagram",
    igOn: "Instagram is connected for this business.",
    igOff: "Instagram is not connected for this business.",
    igBody: "Instagram opens in this browser for this business only. Log into the account you want, then allow access.",
    igReconnectBody: "Reconnect opens Instagram for this business. The account you allow replaces this one. Disconnect frees it for another business.",
    igUnavailable: "Instagram connect is not available yet.",
    igConnected: "Connected",
    igNotConnected: "Not connected",
    igFailed: "Needs another try",
    igConnect: "Connect Instagram",
    igOpening: "Opening Instagram…",
    igOpeningFor: "Opening Instagram for this business…",
    igRetry: "Try again",
    igRetryHint: "Instagram didn't open. You can try again.",
    igReconnect: "Reconnect",
    igDisconnect: "Disconnect",
    igDisconnected: "Instagram disconnected.",
    dashLede: "One business. Live numbers only.",
    leads: "Leads",
    leadsNote: "People stored for this business.",
    chats: "Chats",
    chatsNote: "Threads Roleflow can open.",
    booked: "Booked",
    bookedNote: "Calendar rows that are not cancelled.",
    agents: "Agents live",
    agentsNote: "Each agent stays off until you turn it on.",
    showLabel: "Show-up",
    showEmpty: "No show-up data yet",
    showNote: "Showed calls divided by showed plus no-shows.",
    shareLabel: "Roleflow share",
    shareNote: "10% of the growth you record. Nothing is owed if you record nothing.",
    workspaceOn: "The workspace is on.",
    workspaceOff: "The workspace is off.",
    billingLink: "Billing",
    accounts: "Accounts",
    manageAccounts: "Manage accounts",
    alerts: "Alerts",
    pending: "{n} pending",
    viewAlerts: "View alerts",
    promptsBanner: "Business and prompts live with the SOPs. Open them to review the setter.",
    promptsLink: "Business & prompts",
    showSave: "Save show-up",
    bookTitle: "Record a booked call",
    bookBody: "This stores the call for show-up tracking. It does not message Instagram.",
    bookHandle: "Instagram handle",
    bookSave: "Record booking"
  },
  es: {
    off: "Apagado",
    live: "Activo",
    turnOn: "Activar",
    turnOff: "Apagar",
    confirm: "¿Activar este agente? Puede escribir por Instagram mientras siga activo.",
    saved: "Guardado.",
    promptNeeded: "Guarda un prompt y pruébalo abajo antes de activarlo.",
    grokTitle: "Entra en tu Grok Bot",
    grokMissing: "La URL de Grok Bot todavía no está configurada. El botón sigue apagado hasta que haya una dirección https real. Esta página no simula un escaneo de Instagram.",
    grokOpen: "Abrir Grok Bot",
    warmer: "El calentador mira seguidores nuevos y likes recientes, y ejecuta el calentamiento en tu propio Grok Bot. Roleflow no hace ese escaneo desde aquí.",
    outreach: "Prospección busca gente que encaja con la oferta y abre la conversación desde tu Grok Bot. Roleflow no envía esos primeros mensajes desde aquí.",
    setter: "El setter responde DMs de Instagram con la conexión de Roleflow. El prompt de abajo es el que usa el motor. La práctica se queda en Roleflow y no envía un mensaje.",
    follow: "Seguimiento escribe el siguiente mensaje solo cuando encajan estas reglas. Sigue apagado hasta que lo actives.",
    commentVoice: "Voz en comentarios lee los comentarios de tus publicaciones. Si un comentario encaja con una palabra o una intención, pone en cola una respuesta privada. Sigue apagado hasta que lo actives.",
    commentLimit: "Un comentario admite una sola respuesta privada, y solo durante 7 días. Esa respuesta es texto. La nota de voz que eliges queda en el registro y no se adjunta. No se escribe a quien no comentó.",
    commentEmpty: "Todavía no hay decisiones.",
    commentRulesEmpty: "Todavía no hay reglas. Añade una palabra o una intención y guarda.",
    channel: "Los mensajes de Instagram solo se envían cuando este agente está activo.",
    keyTitle: "Clave del modelo",
    keyLink: "Clave del modelo",
    keyBody: "El motor y la prueba usan primero la clave de este negocio. Si no hay ninguna, Roleflow usa la suya. Después de guardar, esta página solo muestra los últimos 4 caracteres.",
    keyProvider: "Proveedor",
    keyLabel: "Clave API",
    keyPlaceholder: "Pega una clave para reemplazar la guardada",
    keySaved: "Clave que termina en {last4}.",
    keyNone: "No hay clave guardada para este proveedor.",
    keySave: "Guardar clave",
    keyRemove: "Quitar clave",
    keyTest: "Probar clave",
    keyChecking: "Comprobando…",
    keyLocked: "Solo un propietario o un admin puede cambiar esta clave.",
    igTitle: "Conectar Instagram",
    igOn: "Instagram está conectado para este negocio.",
    igOff: "Instagram no está conectado para este negocio.",
    igBody: "Instagram se abre en este navegador solo para este negocio. Entra en la cuenta que quieras y permite el acceso.",
    igReconnectBody: "Reconectar abre Instagram para este negocio. La cuenta que permitas sustituye a esta. Desconectar la deja libre para otro negocio.",
    igUnavailable: "La conexión de Instagram todavía no está disponible.",
    igConnected: "Conectado",
    igNotConnected: "Sin conectar",
    igFailed: "Hace falta otro intento",
    igConnect: "Conectar Instagram",
    igOpening: "Abriendo Instagram…",
    igOpeningFor: "Abriendo Instagram para este negocio…",
    igRetry: "Reintentar",
    igRetryHint: "Instagram no se abrió. Puedes volver a intentarlo.",
    igReconnect: "Reconectar",
    igDisconnect: "Desconectar",
    igDisconnected: "Instagram desconectado.",
    dashLede: "Un negocio. Solo números reales.",
    leads: "Leads",
    leadsNote: "Personas guardadas de este negocio.",
    chats: "Chats",
    chatsNote: "Hilos que Roleflow puede abrir.",
    booked: "Agendadas",
    bookedNote: "Filas del calendario que no están canceladas.",
    agents: "Agentes activos",
    agentsNote: "Cada agente sigue apagado hasta que lo enciendes.",
    showLabel: "Asistencia",
    showEmpty: "Todavía no hay datos de asistencia",
    showNote: "Asistieron, dividido entre asistieron y no asistieron.",
    shareLabel: "Parte de Roleflow",
    shareNote: "El 10% del crecimiento que registras. Si no registras nada, no se debe nada.",
    workspaceOn: "El espacio está encendido.",
    workspaceOff: "El espacio está apagado.",
    billingLink: "Facturación",
    accounts: "Cuentas",
    manageAccounts: "Gestionar cuentas",
    alerts: "Avisos",
    pending: "{n} pendientes",
    viewAlerts: "Ver avisos",
    promptsBanner: "El negocio y los prompts están en los SOPs. Ábrelos para revisar el setter.",
    promptsLink: "Negocio y prompts",
    showSave: "Guardar asistencia",
    bookTitle: "Registrar una llamada agendada",
    bookBody: "Esto guarda la llamada para la asistencia. No escribe por Instagram.",
    bookHandle: "Usuario de Instagram",
    bookSave: "Registrar reserva"
  },
};

export function text(language) {
  return COPY[language] || COPY.en;
}

export function renderDashboardHome(ui) {
  const copy = text(ui.language());
  const metrics = dashboardMetrics({
    targets: ui.state.targets,
    threads: ui.state.threads,
    bookings: ui.state.bookings,
    switches: ui.state.agentSwitches
  });
  const wrap = ui.el("div", { class: "platform-home" });
  wrap.append(ui.pageHeader(ui, "Dashboard", "One business. Live numbers only.", "dashboard", "grid"));
  const grid = ui.el("div", { class: "home-grid" });
  grid.append(metricCard(ui, "Leads", String(metrics.leads), "People stored for this business."));
  grid.append(metricCard(ui, "Chats", String(metrics.chats), "Threads Roleflow can open."));
  grid.append(metricCard(ui, "Booked", String(metrics.booked), "Calendar rows that are not cancelled."));
  grid.append(metricCard(ui, "Agents live", String(metrics.liveAgents) + " / " + AGENT_KEYS.length, "Each agent stays off until you turn it on."));
  wrap.append(grid);
  const banner = ui.el("div", { class: "info-banner", role: "status" });
  const on = ui.state.settings && ui.state.settings.system_enabled;
  banner.append(ui.el("p", { text: (on ? "The workspace is on." : "The workspace is off.") + " " + ui.instagramLine() }));
  wrap.append(banner);
  wrap.append(ui.el("p", { class: "hq-note", text: copy.channel }));
  return wrap;
}

export function renderCalendar(ui) {
  const copy = text(ui.language());
  let recordForm = null;
  if (ui.recordBooking && ui.state.canEdit) {
    const form = ui.el("form", { class: "gcal-record", id: "record-booking" });
    const handle = ui.el("input", { id: "booking-handle", type: "text", maxlength: "30", autocomplete: "off", "aria-label": copy.bookHandle });
    form.append(ui.el("h3", { text: copy.bookTitle }));
    form.append(ui.el("p", { class: "mute", text: copy.bookBody }));
    form.append(ui.el("label", { text: copy.bookHandle }, [handle]));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      ui.recordBooking(handle.value);
    });
    form.append(ui.button(copy.bookSave, null, "submit"));
    recordForm = form;
  }
  return renderRoleflowCalendar(ui, { recordForm });
}

export function renderGrokAgent(ui, kind) {
  const lang = ui.language ? ui.language() : "en";
  const es = lang === "es";
  const title = kind === "warmer" ? (es ? "Calentador" : "Lead Warmer") : (es ? "Prospección" : "Outreacher");
  const body = es
    ? "Este agente está en preparación. No se puede activar desde esta página."
    : "This agent is in preparation. It cannot be turned on from this page.";
  const wrap = ui.el("div", { class: "platform-home" });
  wrap.append(ui.pageHeader(ui, title, body, kind, kind === "warmer" ? "users" : "send"));
  const card = ui.el("section", { class: "agent coming-card", role: "status" });
  card.append(ui.el("p", { class: "soon-badge", text: es ? "Próximamente" : "Coming soon" }));
  card.append(ui.el("h3", { text: es ? "Próximamente" : "Coming soon" }));
  card.append(ui.el("p", { text: body }));
  wrap.append(card);
  return wrap;
}

export function renderSetter(ui) {
  return renderSetterDesk(ui);
}

function promptEditor(ui) {
  const prompt = ui.el("section", { class: "agent setter-editor", id: "setter-prompt-editor" });
  const area = ui.el("textarea", { id: "setter-prompt", rows: "16", maxlength: String(PROMPT_MAX), "aria-label": "Setter system prompt" });
  area.value = ui.state.setterDraft != null ? ui.state.setterDraft : (ui.state.setterPrompt || "");
  area.addEventListener("input", () => { ui.state.setterDraft = area.value; });
  const bar = ui.el("div", { class: "setter-bar" });
  bar.append(ui.button("Save prompt", () => ui.saveSetterPrompt(area.value)));
  bar.append(versionControls(ui, area));
  prompt.append(bar, delayFields(ui));
  const booking = ui.el("input", {
    id: "booking-link",
    type: "url",
    value: (ui.state.settings && ui.state.settings.booking_fallback_url) || ui.state.bookingLink || "",
    placeholder: "Booking link",
    "aria-label": "Booking link"
  });
  const bookingRow = ui.el("div", { class: "filters" });
  bookingRow.append(ui.el("label", { text: "Booking link" }, [booking]));
  bookingRow.append(ui.button("Save link", () => ui.saveBookingLink(booking.value)));
  bookingRow.append(ui.button("Insert booking token", () => insertToken(area, BOOKING_TOKEN)));
  const notes = voiceCatalog(ui.state.voices || []);
  const picker = ui.el("select", { id: "voice-token-picker", "aria-label": "Voice note" });
  picker.append(ui.el("option", { value: "", text: notes.length ? "Choose a voice note" : "No voice notes yet" }));
  notes.forEach((note) => picker.append(ui.el("option", { value: voiceToken(note.slug), text: note.title })));
  const insert = ui.button("Insert voice note", () => {
    if (picker.value) insertToken(area, picker.value);
  });
  prompt.append(bookingRow, ui.el("div", { class: "filters" }, [picker, insert]));
  prompt.append(ui.el("p", { class: "mute", text: "Voice notes come from Voice Gen. The token plays that note when the setter replies. The booking token becomes this business's link." }));
  prompt.append(area);
  prompt.append(versionDiff(ui, area));
  return prompt;
}

function delayFields(ui) {
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
    ui.el("label", { text: "Wait from" }, [min]),
    ui.el("label", { text: "to" }, [max]),
    ui.el("span", { class: "mute", text: "seconds" }),
    ui.button("Save delay", () => ui.saveReplyDelay(min.value, max.value))
  );
  return row;
}

function sortedVersions(ui) {
  return (ui.state.promptVersions || []).slice().sort((left, right) => Number(right.version) - Number(left.version));
}

function versionControls(ui, area) {
  const versions = sortedVersions(ui);
  const wrap = ui.el("div", { class: "setter-versions" });
  if (!versions.length) {
    wrap.append(ui.el("p", { class: "mute", text: "No saved versions yet." }));
    return wrap;
  }
  const select = ui.el("select", { id: "prompt-version", "aria-label": "Prompt version" });
  versions.forEach((row) => {
    const who = !row.created_by ? "Imported" : ui.state.user && row.created_by === ui.state.user.id ? "You" : "Team";
    const when = ui.when ? ui.when(row.created_at) : "";
    select.append(ui.el("option", { value: row.id, text: "Version " + row.version + " · " + who + (when ? " · " + when : "") }));
  });
  select.addEventListener("change", () => paintVersionDiff(ui, area));
  const restore = ui.button("Restore this version", () => {
    const row = versions.find((item) => item.id === select.value);
    if (!row) return;
    if (!window.confirm("Restore this version? The setter stays off unless you turn it on.")) return;
    ui.state.setterDraft = row.body || "";
    ui.restoreSetterPrompt(row);
  });
  wrap.append(select, restore);
  return wrap;
}

function versionDiff(ui, area) {
  const diff = ui.el("div", { class: "prompt-diff", id: "prompt-diff" });
  queueMicrotask(() => paintVersionDiff(ui, area));
  return diff;
}

function paintVersionDiff(ui, area) {
  const diff = document.getElementById("prompt-diff");
  const select = document.getElementById("prompt-version");
  if (!diff) return;
  const versions = sortedVersions(ui);
  const row = versions.find((item) => select && item.id === select.value) || versions[0];
  paintDiff(ui, diff, row ? row.body : "", area.value);
}

function paintDiff(ui, host, before, after) {
  host.replaceChildren();
  const rows = diffLines(before, after).filter((row) => row.type !== "same");
  if (!rows.length) {
    host.append(ui.el("p", { class: "mute", text: "This matches the prompt in the editor." }));
    return;
  }
  rows.slice(0, 80).forEach((row) => {
    host.append(ui.el("p", { class: "diff-line diff-" + row.type, text: (row.type === "add" ? "+ " : "- ") + row.text }));
  });
}

function practiceThread(ui) {
  const trial = ui.state.setterTrial || { scenario: "follower", messages: [] };
  const wrap = ui.el("section", { class: "agent setter-chat", id: "setter-trial" });
  wrap.append(ui.el("h3", { text: "Practice thread" }));
  wrap.append(ui.el("p", { text: "A simulated Instagram DM. You play the lead. Nothing is sent to Instagram." }));
  const scenarios = ui.el("div", { class: "filters", id: "setter-scenarios" });
  TRIAL_SCENARIOS.forEach((item) => {
    const button = ui.button(item.label, () => ui.startTrial(item.id));
    if (trial.scenario === item.id) button.classList.add("on");
    scenarios.append(button);
  });
  scenarios.append(ui.button("Reset", () => ui.restartTrial()));
  wrap.append(scenarios);
  const simulate = ui.el("input", { id: "practice-delay", type: "checkbox" });
  simulate.checked = ui.state.practiceSimulateDelay === true;
  simulate.addEventListener("change", () => { ui.state.practiceSimulateDelay = simulate.checked; });
  wrap.append(ui.el("label", { class: "switch" }, [simulate, " Simulate the reply delay. Leave this off to skip the wait. A wait of 0 is allowed."]));
  const log = ui.el("div", { id: "setter-trial-log", class: "dm-thread" });
  (trial.messages || []).forEach((message) => log.append(trialBubble(ui, message)));
  if (!(trial.messages || []).length) log.append(ui.el("p", { class: "mute", text: "The thread is empty. Write as the lead." }));
  const input = ui.el("input", { id: "setter-trial-input", type: "text", maxlength: "500", placeholder: "Write as the lead", "aria-label": "Lead message" });
  const area = () => document.getElementById("setter-prompt");
  const send = ui.button("Send", () => {
    ui.state.setterPane = "chat";
    const prompt = area() ? area().value : (ui.state.setterDraft != null ? ui.state.setterDraft : ui.state.setterPrompt);
    if (area()) ui.state.setterDraft = area().value;
    ui.sendTrial(prompt, input.value);
  });
  wrap.append(log, ui.el("div", { class: "filters" }, [input, send]));
  return wrap;
}

function trialBubble(ui, message) {
  const bubble = ui.el("article", { class: message.role === "assistant" ? "dm-bubble setter" : "dm-bubble lead" });
  if (message.error) {
    bubble.append(ui.el("p", { text: message.error }));
    return bubble;
  }
  if (message.text) bubble.append(ui.el("p", { text: message.text }));
  if (message.modelLine) bubble.append(ui.el("p", { class: "mute dm-model", text: message.modelLine }));
  (message.voices || []).forEach((note) => {
    const card = ui.el("div", { class: "dm-voice" });
    card.append(ui.el("p", { text: "Voice note · " + (note.title || note.slug || "note") }));
    if (note.playbackUrl) {
      const audio = ui.el("audio", { controls: true, preload: "none" });
      audio.src = note.playbackUrl;
      card.append(audio);
    }
    bubble.append(card);
  });
  if (message.delayLine) bubble.append(ui.el("p", { class: "mute", text: message.delayLine }));
  if (message.role === "assistant" && message.versionLabel) {
    bubble.append(ui.el("p", { class: "mute", text: message.versionLabel }));
    if (message.prompt) {
      const used = ui.el("details", { class: "prompt-used", open: true });
      used.append(ui.el("summary", { text: "Prompt used for this run" }));
      used.append(ui.el("pre", { text: message.prompt }));
      bubble.append(used);
    }
  }
  return bubble;
}

export function renderCommentVoice(ui) {
  const copy = text(ui.language());
  const lang = ui.language ? ui.language() : "en";
  const surface = ui.state.commentSurface === "stories" ? "stories" : "posts";
  const wrap = ui.el("div", { class: "platform-home" });
  wrap.append(ui.pageHeader(ui, sectionText(lang, "commentTitle"), sectionText(lang, "commentBody"), "commentvoice", "send"));
  const tabs = ui.el("div", { class: "section-tabs", role: "tablist" });
  [["posts", "postsReels"], ["stories", "stories"]].forEach(([id, key]) => {
    const tab = ui.el("button", { type: "button", "aria-pressed": surface === id ? "true" : "false" }, [sectionText(lang, key)]);
    tab.addEventListener("click", () => { ui.state.commentSurface = id; ui.paint(); });
    tabs.append(tab);
  });
  wrap.append(tabs);
  wrap.append(ui.el("p", { text: surface === "stories" ? copy.commentVoice : copy.commentLimit }));
  wrap.append(switchCard(ui, "comment_voice", copy));
  const layout = ui.el("div", { class: "voice-layout" });
  const column = ui.el("div");
  const prefs = commentPrefs();
  const form = ui.el("form", { class: "agent", id: "comment-voice-rules" });
  const keywords = ui.el("section", { class: "section-card" });
  keywords.append(ui.el("div", { class: "card-head" }, [
    ui.el("h3", { text: lang === "es" ? "Palabras" : "Keywords" }),
    ui.button("+ " + sectionText(lang, "addKeyword"), () => ui.addCommentRule(), "button")
  ]));
  const cap = ui.el("input", { type: "number", name: "cap", min: "1", max: "500", value: String(ui.state.commentVoiceCap || 30), "aria-label": "Daily cap" });
  keywords.append(ui.el("label", { text: "Daily cap" }, [cap]));
  const rules = ui.state.commentVoiceRules || [];
  const list = ui.el("div", { class: "comment-rules" });
  if (!rules.length) list.append(ui.el("p", { class: "mute", text: copy.commentRulesEmpty }));
  rules.forEach((rule, index) => list.append(commentRule(ui, rule, index, lang)));
  keywords.append(list);
  const onComment = ui.el("section", { class: "section-card" });
  onComment.append(ui.el("h3", { text: sectionText(lang, "onComment") }));
  const publicReply = ui.el("input", { type: "checkbox", name: "public_reply" });
  publicReply.checked = prefs.publicReply === true;
  const dmAnyway = ui.el("input", { type: "checkbox", name: "dm_anyway" });
  dmAnyway.checked = prefs.dmAnyway === true;
  onComment.append(
    ui.el("label", { class: "switch" }, [publicReply, lang === "es" ? " Responder comentarios en público" : " Reply to comments publicly"]),
    ui.el("label", { class: "switch" }, [dmAnyway, lang === "es" ? " Mensaje directo aunque la palabra no coincida" : " DM even if the keyword does not match"])
  );
  onComment.append(ui.button(sectionText(lang, "saveSettings"), null, "submit"));
  form.append(keywords, onComment);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      localStorage.setItem("roleflow.commentprefs", JSON.stringify({ publicReply: publicReply.checked, dmAnyway: dmAnyway.checked }));
    } catch (_error) { /* private mode */ }
    ui.saveCommentVoice(readCommentRules(form));
  });
  column.append(form);
  const log = ui.el("section", { class: "agent", id: "comment-voice-log" });
  log.append(ui.el("h3", { text: "Decisions" }));
  const rows = ui.state.commentVoiceLog || [];
  if (!rows.length) log.append(ui.el("p", { class: "mute", text: copy.commentEmpty }));
  rows.forEach((row) => {
    const card = ui.el("article", { class: "comment-decision" });
    const who = row.commenter_username || row.commenter_id || "Someone";
    card.append(ui.el("p", { text: who + ": " + (row.comment_text || "") }));
    card.append(ui.el("p", { class: "mute", text: decisionLine(row) }));
    log.append(card);
  });
  column.append(log);
  layout.append(column, phonePreview(ui, lang, surface, rules[0]));
  wrap.append(layout);
  return wrap;
}

function commentPrefs() {
  try { return JSON.parse(localStorage.getItem("roleflow.commentprefs") || "{}") || {}; } catch (_error) { return {}; }
}

function phonePreview(ui, lang, surface, rule) {
  const phone = ui.el("aside", { class: "phone" });
  const keyword = rule && rule.keywords && rule.keywords[0] ? rule.keywords[0] : "KEYWORD";
  const reply = rule && rule.message ? rule.message : (lang === "es" ? "Gracias por el comentario." : "Thanks for the comment.");
  phone.append(ui.el("div", { class: "phone-top" }, [ui.el("span", { text: surface === "stories" ? sectionText(lang, "stories") : "Reel" }), ui.el("span", { text: "IG" })]));
  const toggle = ui.el("div", { class: "phone-toggle" });
  const comments = ui.el("button", { type: "button", "aria-pressed": "true" }, [sectionText(lang, "comments")]);
  const messages = ui.el("button", { type: "button", "aria-pressed": "false" }, [sectionText(lang, "messages")]);
  const sheet = ui.el("div", { class: "phone-sheet" });
  const comment = ui.el("div", { class: "phone-comment", text: keyword });
  const dm = ui.el("div", { class: "phone-dm", hidden: true, text: reply });
  const show = (mode) => {
    comments.setAttribute("aria-pressed", mode === "comments" ? "true" : "false");
    messages.setAttribute("aria-pressed", mode === "messages" ? "true" : "false");
    comment.hidden = mode !== "comments";
    dm.hidden = mode !== "messages";
  };
  comments.addEventListener("click", () => show("comments"));
  messages.addEventListener("click", () => show("messages"));
  toggle.append(comments, messages);
  sheet.append(comment, dm);
  phone.append(toggle, sheet, ui.el("p", { class: "phone-note", text: sectionText(lang, "previewNote") }));
  return phone;
}

function commentRule(ui, rule, index, lang) {
  const card = ui.el("fieldset", { class: "comment-rule" });
  card.append(ui.el("legend", { text: (lang === "es" ? "Palabra " : "Keyword ") + (index + 1) }));
  const keywords = ui.el("input", { name: "keywords", value: (rule.keywords || []).join(", "), placeholder: "SYSTEM, SYSTEMS, SISTEM", "aria-label": "Keyword" });
  const match = ui.el("select", { name: "match_type", "aria-label": lang === "es" ? "Tipo de coincidencia" : "Match type" });
  [["exact", lang === "es" ? "Coincidencia exacta" : "Exact match"], ["contains", lang === "es" ? "Contiene" : "Contains"]].forEach(([value, label]) => match.append(ui.el("option", { value, text: label })));
  const intent = ui.el("textarea", { name: "intent", rows: "2", "aria-label": "Intent" });
  intent.value = rule.intent || "";
  const message = ui.el("input", { name: "message", value: rule.message || "", placeholder: lang === "es" ? "Texto opcional" : "Optional text", "aria-label": "Private reply text" });
  const clip = ui.el("select", { name: "clip", "aria-label": "Voice note" });
  clip.append(ui.el("option", { value: "", text: lang === "es" ? "Nota de voz de la biblioteca" : "Voice note from the library" }));
  voiceCatalog(ui.state.voices || []).forEach((note) => {
    clip.append(ui.el("option", { value: note.id, text: note.title, selected: note.id === (rule.clip_id || rule.clipId) ? true : null }));
  });
  const linkUrl = ui.el("input", { name: "link_url", type: "url", placeholder: "Link", "aria-label": "Link URL" });
  const linkLabel = ui.el("input", { name: "link_label", maxlength: "20", placeholder: lang === "es" ? "Texto del botón" : "Button label", "aria-label": "Button label" });
  const counter = ui.el("span", { class: "mute", text: "0/20" });
  linkLabel.addEventListener("input", () => { counter.textContent = String(linkLabel.value.length) + "/20"; });
  const agent = ui.el("select", { name: "rule_agent", "aria-label": "AI" });
  agent.append(ui.el("option", { value: "business", text: lang === "es" ? "IA del negocio" : "Business AI" }));
  card.append(
    ui.el("label", { text: "Keyword" }, [keywords]),
    ui.el("label", { text: lang === "es" ? "Tipo de coincidencia" : "Match type" }, [match]),
    ui.el("label", { text: lang === "es" ? "Respuesta por mensaje directo" : "DM reply" }, [clip, message]),
    ui.el("label", { text: lang === "es" ? "Botón de enlace" : "Link button" }, [linkUrl, linkLabel, counter]),
    ui.el("label", { text: "AI" }, [agent]),
    ui.el("label", { text: "Intent" }, [intent])
  );
  const row = ui.el("div", { class: "filters" });
  row.append(ui.button(lang === "es" ? "Cancelar" : "Cancel", () => ui.paint()));
  row.append(ui.button(sectionText(lang, "saveKeyword"), null, "submit"));
  card.append(row);
  return card;
}

function readCommentRules(form) {
  const data = new FormData(form);
  const caps = data.getAll("cap");
  const keywords = data.getAll("keywords");
  const intents = data.getAll("intent");
  const messages = data.getAll("message");
  const clips = data.getAll("clip");
  return {
    dailyCap: caps[0],
    rules: keywords.map((value, index) => ({
      keywords: String(value || "").split(",").map((item) => item.trim()).filter(Boolean),
      intent: intents[index] || "",
      message: messages[index] || "",
      clip_id: clips[index] || ""
    }))
  };
}

function decisionLine(row) {
  const reason = String(row.reason || "");
  if (reason.startsWith("queued_text_only")) return "Matched. A text private reply was queued. The voice note was not attached. " + reason;
  if (reason.startsWith("daily_cap")) return "Matched, and the daily cap was already reached. " + reason;
  if (reason.startsWith("deduped")) return "Matched, and this person was already contacted. " + reason;
  if (reason.startsWith("private_reply_window")) return "Matched, and the 7-day private reply window has closed. " + reason;
  if (reason.startsWith("duplicate_comment")) return "This comment was already reviewed. " + reason;
  if (reason.startsWith("agent_off")) return "The agent is off.";
  if (reason.startsWith("no_match") || row.matched === false) return "No keyword or intent matched. " + reason;
  return reason;
}

function insertToken(area, token) {
  if (!area) return;
  const focused = document.activeElement === area;
  const start = focused && area.selectionStart != null ? area.selectionStart : area.value.length;
  const end = focused && area.selectionEnd != null ? area.selectionEnd : start;
  const before = start > 0 && area.value.slice(start - 1, start) !== "\n" && area.value.slice(start - 1, start) !== " " ? " " : "";
  const next = area.value.slice(end, end + 1);
  const after = next && next !== "\n" && next !== " " ? " " : "";
  const piece = before + token + after;
  area.value = area.value.slice(0, start) + piece + area.value.slice(end);
  const cursor = start + piece.length;
  area.focus();
  if (area.setSelectionRange) area.setSelectionRange(cursor, cursor);
}

export function renderFollowBoss(ui) {
  const copy = text(ui.language());
  const policy = normalizePolicy(ui.state.followupPolicy || DEFAULT_POLICY);
  const wrap = ui.el("div", { class: "platform-home" });
  const lang = ui.language ? ui.language() : "en";
  wrap.append(ui.pageHeader(ui, sectionText(lang, "followTitle"), sectionText(lang, "followBody"), "followup", "trend"));
  wrap.append(ui.el("p", { text: copy.channel }));
  wrap.append(switchCard(ui, "followup", copy));
  const form = ui.el("form", { class: "agent grid-2", id: "followup-policy" });
  form.append(numberField(ui, "Hours since last message", "hours", policy.hoursSinceLastMessage, 1, 23));
  form.append(selectField(ui, "Lead stage", "stage", [
    ["any", "Any stage"],
    ["open", "Open"],
    ["discovering", "Discovering"],
    ["qualifying", "Qualifying"],
    ["proposal", "Proposal"],
    ["booked", "Booked"],
    ["paid", "Paid"]
  ], policy.leadStage));
  form.append(numberField(ui, "No reply after N messages", "quietCount", policy.noReplyAfter, 1, 20));
  form.append(selectField(ui, "Booking", "booked", [["any", "Booked or not"], ["booked", "Booked"], ["not_booked", "Not booked"]], policy.booked));
  form.append(numberField(ui, "Max follow-ups", "max", policy.maxFollowups, 1, 10));
  form.append(textField(ui, "Quiet hours start", "quietStart", policy.quietStart));
  form.append(textField(ui, "Quiet hours end", "quietEnd", policy.quietEnd));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    ui.saveFollowupPolicy(readPolicy(form));
  });
  form.append(ui.button("Save triggers", null, "submit"));
  wrap.append(form);
  return wrap;
}

export function renderModelKey(ui) {
  const copy = text(ui.language());
  const card = ui.el("form", { class: "agent", id: "model-key" });
  card.append(ui.el("h3", { text: copy.keyTitle }));
  card.append(ui.el("p", { text: copy.keyBody }));
  const current = ui.state.settings && ui.state.settings.llm_setter_provider;
  const provider = ui.el("select", { id: "model-key-provider", "aria-label": copy.keyProvider });
  CLIENT_PROVIDERS.forEach((item) => {
    provider.append(ui.el("option", { value: item.id, text: item.label, selected: item.id === current ? true : null }));
  });
  const key = ui.el("input", {
    id: "model-key-input",
    type: "password",
    autocomplete: "off",
    "aria-label": copy.keyLabel,
    placeholder: copy.keyPlaceholder
  });
  const hint = ui.el("p", { id: "model-key-hint", class: "mute" });
  const modelNote = ui.el("p", { id: "model-key-default", class: "mute" });
  const status = ui.el("p", { id: "model-key-result", role: "status" });
  const paintHint = () => {
    const last4 = keyHint(ui.state.llmKeys, provider.value);
    const chosen = CLIENT_PROVIDERS.find((item) => item.id === provider.value);
    hint.textContent = last4 ? copy.keySaved.replace("{last4}", last4) : copy.keyNone;
    modelNote.textContent = chosen ? "Default model: " + chosen.model : "";
  };
  provider.addEventListener("change", paintHint);
  paintHint();
  card.append(
    ui.el("label", { text: copy.keyProvider }, [provider]),
    modelNote,
    ui.el("label", { text: copy.keyLabel }, [key]),
    hint,
    status
  );
  const manage = ui.state.canManageKeys === true;
  const row = ui.el("div", { class: "filters" });
  if (manage && ui.saveLlm) {
    row.append(ui.button(copy.keySave, (event) => {
      event.preventDefault();
      const providerId = provider.value;
      const apiKey = key.value;
      key.value = "";
      ui.saveLlm(modelPatch(providerId, false), [{ provider: providerId, apiKey }]);
    }));
    row.append(ui.button(copy.keyRemove, (event) => {
      event.preventDefault();
      const providerId = provider.value;
      key.value = "";
      ui.saveLlm(modelPatch(providerId, true), [{ provider: providerId, clear: true }]);
    }));
  }
  if (ui.state.canEdit && ui.testLlm) {
    row.append(ui.button(copy.keyTest, async (event) => {
      event.preventDefault();
      status.textContent = copy.keyChecking;
      const message = await ui.testLlm({
        purpose: "setter",
        provider: provider.value,
        model: CLIENT_PROVIDERS.find((item) => item.id === provider.value).model,
        api_key: key.value
      });
      status.textContent = message || "";
    }));
  }
  if (row.childElementCount) card.append(row);
  if (!manage) card.append(ui.el("p", { class: "hq-note", text: copy.keyLocked }));
  card.addEventListener("submit", (event) => event.preventDefault());
  return card;
}

export function renderInstagramConnect(ui) {
  const copy = text(ui.language());
  const card = ui.el("section", { class: "agent", id: "instagram-connect" });
  const businessId = ui.state.businessId || "";
  const ig = ui.state.ig && (!ui.state.ig.business_id || ui.state.ig.business_id === businessId) ? ui.state.ig : null;
  const connected = Boolean(ig && ig.status === "connected");
  const failed = Boolean(ig && ig.status === "error");
  const handle = ig && ig.username ? "@" + String(ig.username).replace(/^@/, "") : "";
  const lastError = ig && ig.last_error ? scrubChannelCopy(ig.last_error) : "";
  const pendingNotice = !connected && ui.state.connectError ? scrubChannelCopy(ui.state.connectError) : "";
  card.dataset.businessId = businessId;
  card.append(ui.el("h3", { text: copy.igTitle }));
  card.append(ui.el("p", {
    class: connected ? "integration-status on" : "integration-status",
    role: "status",
    text: connected ? copy.igConnected : failed ? copy.igFailed : copy.igNotConnected
  }));
  card.append(ui.el("p", { text: connected ? (handle || copy.igOn) : copy.igOff }));
  card.append(ui.el("p", { class: "mute", text: connected ? copy.igReconnectBody : copy.igBody }));
  const status = ui.el("p", { class: "mute", "data-connect-status": "1", role: "status" });
  if (pendingNotice || lastError) status.textContent = pendingNotice || lastError;
  if (ui.state.canEdit) {
    const row = ui.el("div", { class: "filters" });
    const label = connected ? copy.igReconnect : failed || pendingNotice ? copy.igRetry : copy.igConnect;
    const control = ui.button(label, async () => {
      control.disabled = true;
      control.textContent = copy.igOpening;
      control.setAttribute("aria-busy", "true");
      status.textContent = copy.igOpeningFor;
      if (ui.state.preview) {
        card.dataset.connectBusiness = businessId;
        return;
      }
      const result = await beginInstagramConnect({ state: ui.state, toast: ui.toast, businessId });
      if (result.mode === "redirect") {
        status.textContent = copy.igOpening;
        location.assign(result.authUrl);
        return;
      }
      status.textContent = result.mode === "manual" ? copy.igUnavailable : (result.error || copy.igRetryHint);
      if (result.error && ui.toast) ui.toast(result.mode === "manual" ? copy.igUnavailable : result.error, "bad");
      control.disabled = false;
      control.textContent = copy.igRetry;
      control.removeAttribute("aria-busy");
    });
    control.setAttribute("data-connect-instagram", businessId);
    row.append(control);
    if (connected || failed) {
      const disconnect = ui.button(copy.igDisconnect, async () => {
        disconnect.disabled = true;
        if (ui.state.preview) {
          status.textContent = copy.igDisconnected;
          card.dataset.disconnectedBusiness = businessId;
          return;
        }
        const result = await disconnectInstagram({ state: ui.state, businessId });
        if (!result.ok) {
          status.textContent = result.error || copy.igRetryHint;
          if (ui.toast) ui.toast(result.error || copy.igRetryHint, "bad");
          disconnect.disabled = false;
          return;
        }
        if (ui.toast) ui.toast(copy.igDisconnected);
        if (ui.bootBusiness) await ui.bootBusiness(businessId);
      });
      disconnect.classList.add("ghost");
      row.append(disconnect);
    }
    card.append(row);
  }
  card.append(status);
  return card;
}

export function localTry(prompt, message) {
  return previewReply(prompt, message);
}

export function gateSetter(state) {
  return setterMayEnable({ prompt: state.setterPrompt, testedAt: state.setterTestedAt });
}

function switchCard(ui, key, copy) {
  const row = (ui.state.agentSwitches || []).find((item) => item.agent_key === key);
  const on = Boolean(row && row.enabled);
  const card = ui.el("section", { class: "agent agent-switch" });
  const status = ui.el("p", { class: on ? "integration-status on" : "integration-status", text: on ? copy.live : copy.off });
  status.setAttribute("role", "status");
  const button = ui.button(on ? copy.turnOff : copy.turnOn, () => ui.setAgent(key, !on));
  button.setAttribute("data-agent", key);
  card.append(status, button);
  if (key === "setter" && !on) card.append(ui.el("p", { class: "hq-note", text: copy.promptNeeded }));
  return card;
}

function metricCard(ui, title, value, note, tone) {
  const card = ui.el("article", { class: "kpi pastel " + (tone || "gray") });
  card.append(ui.el("span", { class: "watermark", "aria-hidden": "true", text: String(title || "R").slice(0, 1) }));
  card.append(ui.el("span", { text: title }), ui.el("strong", { text: value }));
  if (note) card.append(ui.el("em", { text: note }));
  return card;
}

function numberField(ui, label, name, value, min, max) {
  const wrap = ui.el("label", { text: label });
  const input = ui.el("input", { type: "number", name, min: String(min), max: String(max), value: String(value), required: true });
  wrap.append(input);
  return wrap;
}

function textField(ui, label, name, value) {
  const wrap = ui.el("label", { text: label });
  wrap.append(ui.el("input", { type: "time", name, value, required: true }));
  return wrap;
}

function selectField(ui, label, name, options, value) {
  const wrap = ui.el("label", { text: label });
  const select = ui.el("select", { name });
  options.forEach(([option, text]) => select.append(ui.el("option", { value: option, text, selected: option === value ? true : null })));
  wrap.append(select);
  return wrap;
}

function readPolicy(form) {
  const data = new FormData(form);
  return normalizePolicy({
    hoursSinceLastMessage: data.get("hours"),
    leadStage: data.get("stage"),
    noReplyAfter: data.get("quietCount"),
    booked: data.get("booked"),
    maxFollowups: data.get("max"),
    quietStart: data.get("quietStart"),
    quietEnd: data.get("quietEnd")
  });
}
