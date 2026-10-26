import { AGENT_KEYS, DEFAULT_POLICY, dashboardMetrics, normalizePolicy, previewReply, setterMayEnable } from "./agent-control.js";
import { grokLaunchUrl } from "./client-config.js";
import { beginInstagramConnect } from "./connect-instagram.js";
import { CLIENT_PROVIDERS, keyHint, modelPatch } from "./model-key.js";

export const ZERNIO_DASHBOARD = "https://zernio.com/dashboard";

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
    setter: "Agentic Setter replies in Instagram DMs through the Roleflow connection. The system prompt below is what the reply engine uses. A tryout stays inside Roleflow and does not send a message.",
    follow: "Follow Up Boss sends the next message only when the rules below match: quiet time, stage, booking, and the cap. It stays off until you turn it on.",
    channel: "Instagram is connected through Zernio. Messages are sent only while this agent is Live.",
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
    igManual: "If Connect Instagram cannot start the login, open the Zernio dashboard and follow these steps.",
    igDashboard: "Open Zernio dashboard",
    igSteps: [
      "Sign in at the Zernio dashboard.",
      "Create a profile for this business, or open the profile already used for it.",
      "Connect an Instagram Business or Creator account. A personal account cannot connect.",
      "Come back here and use Connect Instagram again once the platform key is set, so Roleflow can send and receive DMs."
    ]
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
    setter: "El setter responde DMs de Instagram con la conexión de Roleflow. El prompt de abajo es el que usa el motor. La prueba se queda en Roleflow y no envía un mensaje.",
    follow: "Seguimiento escribe el siguiente mensaje solo cuando encajan estas reglas. Sigue apagado hasta que lo actives.",
    channel: "Instagram se conecta por Zernio. Solo envía mensajes cuando este agente está activo.",
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
    igManual: "Si Conectar Instagram no puede abrir el acceso, entra en el panel de Zernio y sigue estos pasos.",
    igDashboard: "Abrir panel de Zernio",
    igSteps: [
      "Entra en el panel de Zernio.",
      "Crea un perfil para este negocio, o abre el que ya usa.",
      "Conecta una cuenta de Instagram Business o Creator. Una cuenta personal no se puede conectar.",
      "Vuelve aquí y usa Conectar Instagram cuando la clave de la plataforma esté puesta, para que Roleflow envíe y reciba DMs."
    ]
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
  const prompt = ui.el("section", { class: "agent" });
  prompt.append(ui.el("h3", { text: "System prompt" }));
  const area = ui.el("textarea", { id: "setter-prompt", rows: "10", maxlength: "12000", "aria-label": "Setter system prompt" });
  area.value = ui.state.setterPrompt || "";
  prompt.append(area);
  const save = ui.button("Save prompt", () => ui.saveSetterPrompt(area.value));
  prompt.append(save);
  wrap.append(prompt);
  const trial = ui.el("section", { class: "agent", id: "setter-trial" });
  trial.append(ui.el("h3", { text: "Try a message" }));
  trial.append(ui.el("p", { text: "This stays in Roleflow. It does not send an Instagram message." }));
  const log = ui.el("div", { id: "setter-trial-log", class: "assistant-log" });
  const input = ui.el("input", { id: "setter-trial-input", type: "text", maxlength: "500", placeholder: "Write what a lead might say", "aria-label": "Sample lead message" });
  const send = ui.button("Try it", () => ui.trySetter(area.value, input.value, log));
  trial.append(log, input, send);
  wrap.append(trial);
  return wrap;
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
  const status = ui.el("p", { class: "mute", "data-connect-status": "1", text: copy.igManual });
  if (ui.state.canEdit) {
    const control = ui.button("Connect Instagram", async () => {
      control.disabled = true;
      const result = await beginInstagramConnect({ state: ui.state, toast: ui.toast });
      if (result.mode === "redirect") {
        location.assign(result.authUrl);
        return;
      }
      if (result.mode === "manual") status.textContent = copy.igManual;
      else if (ui.toast) ui.toast(result.error, "bad");
      control.disabled = false;
    });
    card.append(control);
  }
  card.append(status);
  card.append(ui.el("a", {
    class: "btn ghost sm",
    id: "zernio-dashboard-link",
    href: ZERNIO_DASHBOARD,
    target: "_blank",
    rel: "noopener noreferrer"
  }, [copy.igDashboard]));
  const steps = ui.el("ol");
  copy.igSteps.forEach((line) => steps.append(ui.el("li", { text: line })));
  card.append(steps);
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
