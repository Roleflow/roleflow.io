import { AGENT_KEYS, DEFAULT_POLICY, dashboardMetrics, normalizePolicy, previewReply, setterMayEnable } from "./agent-control.js";
import { grokLaunchUrl } from "./client-config.js";
import { beginInstagramConnect } from "./connect-instagram.js";
import { CLIENT_PROVIDERS, keyHint, modelPatch } from "./model-key.js";
import { diffLines, PROMPT_MAX } from "./prompt-history.js";
import { BOOKING_TOKEN, TRIAL_SCENARIOS, voiceCatalog, voiceToken } from "./prompt-tokens.js";

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
    igOn: "Instagram is connected for this business.",
    igOff: "Instagram is not connected for this business.",
    igBody: "Connect Instagram starts the account login for this business.",
    igUnavailable: "Instagram connection is not available right now. Contact Roleflow support."
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
    igOn: "Instagram está conectado para este negocio.",
    igOff: "Instagram no está conectado para este negocio.",
    igBody: "Conectar Instagram abre el acceso de la cuenta de este negocio.",
    igUnavailable: "La conexión de Instagram no está disponible ahora. Contacta con el soporte de Roleflow."
  }
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
  const wrap = ui.el("div", { class: "platform-home" });
  wrap.append(ui.pageHeader(ui, "Calendar", "Booked calls stored for this business.", "calendar", "clipboard"));
  const google = ui.state.google;
  const account = ui.el("section", { class: "agent" });
  account.append(ui.el("h3", { text: "Google Calendar" }));
  account.append(ui.el("p", { text: google && google.status === "connected" ? "Connected" + (google.email ? " · " + google.email : "") : "Not connected yet. Connect it from Settings." }));
  account.append(ui.el("a", { class: "btn ghost sm", href: "#settings" }, ["Open settings"]));
  wrap.append(account);
  const rows = ui.state.bookings || [];
  if (!rows.length) wrap.append(ui.el("p", { text: "No bookings yet." }));
  rows.forEach((row) => {
    const target = (ui.state.targets || []).find((item) => item.id === row.target_id);
    const card = ui.el("article", { class: "agent" });
    card.append(ui.el("h3", { text: target && target.handle ? "@" + target.handle : "Booking" }));
    card.append(ui.el("p", { text: (row.show_status || "scheduled") + (row.meet_link ? " · " + row.meet_link : "") }));
    wrap.append(card);
  });
  return wrap;
}

export function renderGrokAgent(ui, kind) {
  const copy = text(ui.language());
  const title = kind === "warmer" ? "Lead Warmer" : "Outreacher";
  const body = kind === "warmer" ? copy.warmer : copy.outreach;
  const wrap = ui.el("div", { class: "platform-home" });
  wrap.append(ui.pageHeader(ui, title, body, kind, kind === "warmer" ? "users" : "send"));
  wrap.append(switchCard(ui, kind, copy));
  const launch = ui.el("section", { class: "agent" });
  launch.append(ui.el("h3", { text: copy.grokTitle }));
  const url = grokLaunchUrl(kind);
  if (!url) {
    launch.append(ui.el("p", { text: copy.grokMissing }));
    const button = ui.el("button", { type: "button", class: "btn", disabled: true }, [copy.grokOpen]);
    launch.append(button);
  } else {
    launch.append(ui.el("a", { class: "btn", href: url, target: "_blank", rel: "noopener noreferrer" }, [copy.grokOpen]));
  }
  wrap.append(launch);
  return wrap;
}

export function renderSetter(ui) {
  const copy = text(ui.language());
  const wrap = ui.el("div", { class: "platform-home" });
  wrap.append(ui.pageHeader(ui, "Agentic Setter", copy.setter, "setter", "inbox"));
  wrap.append(ui.el("p", { text: copy.channel }));
  wrap.append(ui.el("p", {}, [
    ui.el("a", { class: "btn ghost sm", id: "setter-key-link", href: "#settings/model" }, [copy.keyLink])
  ]));
  wrap.append(renderInstagramConnect(ui));
  wrap.append(switchCard(ui, "setter", copy));
  wrap.append(promptEditor(ui));
  wrap.append(practiceThread(ui));
  return wrap;
}

function promptEditor(ui) {
  const prompt = ui.el("section", { class: "agent", id: "setter-prompt-editor" });
  prompt.append(ui.el("h3", { text: "System prompt" }));
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
  const area = ui.el("textarea", { id: "setter-prompt", rows: "12", maxlength: String(PROMPT_MAX), "aria-label": "Setter system prompt" });
  area.value = ui.state.setterPrompt || "";
  prompt.append(area);
  prompt.append(ui.button("Save prompt", () => ui.saveSetterPrompt(area.value)));
  prompt.append(versionList(ui, area));
  return prompt;
}

function versionList(ui, area) {
  const wrap = ui.el("div", { class: "prompt-versions" });
  const versions = (ui.state.promptVersions || []).slice().sort((left, right) => Number(right.version) - Number(left.version));
  wrap.append(ui.el("h3", { text: "Versions" }));
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
  const diff = ui.el("div", { class: "prompt-diff", id: "prompt-diff" });
  const paint = () => {
    const row = versions.find((item) => item.id === select.value) || versions[0];
    paintDiff(ui, diff, row ? row.body : "", area.value);
  };
  select.addEventListener("change", paint);
  paint();
  const restore = ui.button("Restore this version", () => {
    const row = versions.find((item) => item.id === select.value);
    if (!row) return;
    if (!window.confirm("Restore this version? The setter stays off unless you turn it on.")) return;
    ui.restoreSetterPrompt(row);
  });
  wrap.append(select, diff, restore);
  return wrap;
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
  const wrap = ui.el("section", { class: "agent", id: "setter-trial" });
  wrap.append(ui.el("h3", { text: "Practice thread" }));
  wrap.append(ui.el("p", { text: "A simulated Instagram DM. You play the lead. Nothing is sent to Instagram." }));
  const scenarios = ui.el("div", { class: "filters", id: "setter-scenarios" });
  TRIAL_SCENARIOS.forEach((item) => {
    const button = ui.button(item.label, () => ui.startTrial(item.id));
    if (trial.scenario === item.id) button.classList.add("on");
    scenarios.append(button);
  });
  scenarios.append(ui.button("Restart", () => ui.restartTrial()));
  wrap.append(scenarios);
  const log = ui.el("div", { id: "setter-trial-log", class: "dm-thread" });
  (trial.messages || []).forEach((message) => log.append(trialBubble(ui, message)));
  if (!(trial.messages || []).length) log.append(ui.el("p", { class: "mute", text: "The thread is empty. Write as the lead." }));
  const input = ui.el("input", { id: "setter-trial-input", type: "text", maxlength: "500", placeholder: "Write as the lead", "aria-label": "Lead message" });
  const area = () => document.getElementById("setter-prompt");
  const send = ui.button("Send", () => {
    const prompt = area() ? area().value : ui.state.setterPrompt;
    ui.sendTrial(prompt, input.value);
  });
  wrap.append(log, ui.el("div", { class: "filters" }, [input, send]));
  return wrap;
}

function trialBubble(ui, message) {
  const bubble = ui.el("article", { class: message.role === "assistant" ? "dm-bubble setter" : "dm-bubble lead" });
  if (message.text) bubble.append(ui.el("p", { text: message.text }));
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
  const wrap = ui.el("div", { class: "platform-home" });
  wrap.append(ui.pageHeader(ui, "Comment voice", copy.commentVoice, "commentvoice", "send"));
  wrap.append(ui.el("p", { text: copy.channel }));
  wrap.append(ui.el("p", { text: copy.commentLimit }));
  wrap.append(switchCard(ui, "comment_voice", copy));
  const form = ui.el("form", { class: "agent", id: "comment-voice-rules" });
  const cap = ui.el("input", { type: "number", name: "cap", min: "1", max: "500", value: String(ui.state.commentVoiceCap || 30), "aria-label": "Daily cap" });
  form.append(ui.el("label", { text: "Daily cap" }, [cap]));
  const rules = ui.state.commentVoiceRules || [];
  const list = ui.el("div", { class: "comment-rules" });
  if (!rules.length) list.append(ui.el("p", { class: "mute", text: copy.commentRulesEmpty }));
  rules.forEach((rule, index) => list.append(commentRule(ui, rule, index)));
  form.append(list);
  form.append(ui.button("Add rule", () => ui.addCommentRule(), "button"));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    ui.saveCommentVoice(readCommentRules(form));
  });
  form.append(ui.button("Save rules", null, "submit"));
  wrap.append(form);
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
  wrap.append(log);
  return wrap;
}

function commentRule(ui, rule, index) {
  const card = ui.el("fieldset", { class: "comment-rule" });
  card.append(ui.el("legend", { text: "Rule " + (index + 1) }));
  const keywords = ui.el("input", { name: "keywords", value: (rule.keywords || []).join(", "), placeholder: "SYSTEM, SYSTEMS, SISTEM", "aria-label": "Keywords" });
  const intent = ui.el("textarea", { name: "intent", rows: "2", "aria-label": "Intent" });
  intent.value = rule.intent || "";
  const message = ui.el("input", { name: "message", value: rule.message || "", placeholder: "Thanks for the comment.", "aria-label": "Private reply text" });
  const clip = ui.el("select", { name: "clip", "aria-label": "Voice note" });
  clip.append(ui.el("option", { value: "", text: "No mapped voice note" }));
  voiceCatalog(ui.state.voices || []).forEach((note) => {
    clip.append(ui.el("option", { value: note.id, text: note.title, selected: note.id === (rule.clip_id || rule.clipId) ? true : null }));
  });
  card.append(
    ui.el("label", { text: "Keywords" }, [keywords]),
    ui.el("label", { text: "Intent" }, [intent]),
    ui.el("label", { text: "Private reply" }, [message]),
    ui.el("label", { text: "Voice note" }, [clip])
  );
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
  wrap.append(ui.pageHeader(ui, "Follow Up Boss", copy.follow, "followup", "trend"));
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
  const status = ui.el("p", { id: "model-key-result", role: "status" });
  const paintHint = () => {
    const last4 = keyHint(ui.state.llmKeys, provider.value);
    hint.textContent = last4 ? copy.keySaved.replace("{last4}", last4) : copy.keyNone;
  };
  provider.addEventListener("change", paintHint);
  paintHint();
  card.append(
    ui.el("label", { text: copy.keyProvider }, [provider]),
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
  card.append(ui.el("h3", { text: "Connect Instagram" }));
  const connected = Boolean(ui.state.ig && ui.state.ig.status === "connected");
  card.append(ui.el("p", { text: connected ? copy.igOn : copy.igOff }));
  card.append(ui.el("p", { text: copy.igBody }));
  const status = ui.el("p", { class: "mute", "data-connect-status": "1", role: "status" });
  if (ui.state.canEdit) {
    const control = ui.button("Connect Instagram", async () => {
      control.disabled = true;
      const result = await beginInstagramConnect({ state: ui.state, toast: ui.toast });
      if (result.mode === "redirect") {
        location.assign(result.authUrl);
        return;
      }
      status.textContent = copy.igUnavailable;
      if (result.mode !== "manual" && result.error && ui.toast) ui.toast(result.error, "bad");
      control.disabled = false;
    });
    card.append(control);
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

function metricCard(ui, title, value, note) {
  const card = ui.el("section", { class: "home-card" });
  card.append(ui.el("h3", { text: title }));
  card.append(ui.el("p", { class: "metric-value", text: value }));
  card.append(ui.el("p", { class: "metric-note", text: note }));
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
