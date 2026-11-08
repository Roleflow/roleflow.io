// Outreacher tab. One layout for every business. The client signs in inside
// the Roleflow browser. This page has no password field.

import { controllerView, validateWorkflow, windowEnd } from "./outreacher-workflow.js";

const COPY = {
  en: {
    title: "Outreacher",
    body: "Your outreacher runs on its own computer for this business. You sign in to Instagram yourself. Roleflow never sees the password.",
    startTitle: "Start your outreacher",
    startBody: "After checkout, this page shows setup, then a browser where you sign in. Sending stays off until you turn it on.",
    risk: "I understand Instagram can limit or close an account that sends automated messages. I accept that risk for this business.",
    price: "$249 setup + 10% of growth, 3-month minimum",
    soon: "Coming soon – contact Roleflow to join the pilot",
    soonLink: "contact Roleflow",
    termOpen: "Minimum term ends {date}. If you cancel before then, it ends on that date instead of immediately.",
    termScheduled: "Cancellation is scheduled for {date}.",
    cancel: "Cancel at end of minimum term",
    checkout: "Continue to checkout",
    checking: "Opening checkout…",
    checkoutMissing: "Checkout is not available right now. Contact Roleflow support.",
    cancelMissing: "Cancellation could not be scheduled. Contact Roleflow support.",
    setupTitle: "Setting up your outreacher",
    setupBody: "This usually takes a few minutes. You can leave this page. It updates on its own.",
    loginTitle: "Connect Instagram",
    loginBody: "Enter the username, then open the browser and sign in there. This page does not ask for the password.",
    username: "Instagram username",
    connect: "Connect",
    opening: "Opening the browser…",
    access: "Access",
    connected: "Connected",
    needsLogin: "Needs login",
    reconnectTitle: "Reconnect Instagram",
    reconnectBody: "Instagram asked for a sign-in again. Open the browser and finish it there. Nothing is sent until that is done.",
    reconnect: "Reconnect",
    paused: "Paused. Nothing sends while this is on.",
    pause: "Pause outreacher",
    sendingOff: "Sending is off. Pause stops it immediately. Turning pause off does not start sending by itself.",
    attention: "Roleflow is checking this outreacher. You do not need to do anything.",
    suspended: "This outreacher is paused because billing stopped. The sign-in can be restored if billing resumes in time.",
    viewerTitle: "Roleflow browser",
    viewerBody: "Instagram opens in this window. You type the password here. Roleflow does not store it.",
    close: "Close",
    handleInvalid: "Enter an Instagram username, without the @.",
    workflowTitle: "Workflow",
    workflowBody: "These settings are saved for this business. Nothing is sent. The browser has to confirm them before they count as active.",
    timezone: "Timezone",
    activeStart: "Active hours start",
    windowNote: "Checks run every 30 minutes for 16 hours, from {start} to {end} in {timezone}.",
    newFollowers: "New followers",
    postLikes: "Post likes",
    dailyMin: "Minimum new people per day",
    dailyMax: "Maximum new people per day",
    drafts: "Draft lines",
    draftsNote: "One line is one draft. A message can use only facts from the bio, and it stays a draft.",
    saveWorkflow: "Save workflow",
    previewSaved: "Saved in this preview. It is not confirmed on a browser.",
    savedWaiting: "Saved. The browser has not confirmed it.",
    desiredLine: "Desired version {version}. Not confirmed on the browser.",
    confirmedLine: "Desired version {version}. The browser confirmed this version.",
    needsSetup: "Needs setup",
    desktopUnavailable: "Browser control is not available yet.",
    profileMissing: "This account is not assigned to a browser profile.",
    proxyMissing: "No dedicated proxy is assigned.",
    proxyNote: "A proxy does not replace a separate login. Each account needs its own browser profile.",
    connectController: "Connect",
    pauseWorkflow: "Pause workflow",
    pauseNote: "Pausing the workflow keeps drafts from being picked up. It does not start sending.",
    stopWorkflow: "Stop workflow",
    stopped: "Stopped. Roleflow has to clear this before the workflow can resume.",
    activityTitle: "Activity",
    activityEmpty: "No confirmed activity yet.",
    unavailableNote: "Workflow saving is not on this account yet.",
    workflowInvalid: "Check the timezone, the daily range, and at least one draft line.",
    browserAccepted: "The controller accepted the request. The browser has not confirmed it.",
    browserReceived: "The controller received the request. The browser has not confirmed it.",
    failedLine: "The last request failed. Nothing was confirmed.",
    expiredLine: "The last request expired before the browser confirmed it.",
    offlineLine: "The browser is offline.",
    fixtureLabel: "Test fixture. This is not a live account."
  },
  es: {
    title: "Prospección",
    body: "Tu prospección corre en su propio ordenador para este negocio. Entras en Instagram tú. Roleflow no ve la contraseña.",
    startTitle: "Empieza tu prospección",
    startBody: "Después del pago, esta página muestra la preparación y luego un navegador donde entras. El envío sigue apagado hasta que lo actives.",
    risk: "Entiendo que Instagram puede limitar o cerrar una cuenta que envía mensajes automáticos. Acepto ese riesgo para este negocio.",
    price: "$249 de alta + 10% del crecimiento, mínimo de 3 meses",
    soon: "Pronto – contacta con Roleflow para unirte al piloto",
    soonLink: "contacta con Roleflow",
    termOpen: "El plazo mínimo termina el {date}. Si cancelas antes, termina ese día y no al momento.",
    termScheduled: "La cancelación está programada para el {date}.",
    cancel: "Cancelar al final del plazo mínimo",
    checkout: "Seguir al pago",
    checking: "Abriendo el pago…",
    checkoutMissing: "El pago no está disponible ahora. Contacta con Roleflow.",
    cancelMissing: "No se pudo programar la cancelación. Contacta con Roleflow.",
    setupTitle: "Preparando tu prospección",
    setupBody: "Suele tardar unos minutos. Puedes salir de esta página. Se actualiza sola.",
    loginTitle: "Conectar Instagram",
    loginBody: "Escribe el usuario y abre el navegador para entrar allí. Esta página no pide la contraseña.",
    username: "Usuario de Instagram",
    connect: "Conectar",
    opening: "Abriendo el navegador…",
    access: "Acceder",
    connected: "Conectado",
    needsLogin: "Falta entrar",
    reconnectTitle: "Volver a entrar en Instagram",
    reconnectBody: "Instagram pidió entrar otra vez. Abre el navegador y termínalo allí. No se envía nada hasta que esté hecho.",
    reconnect: "Reconectar",
    paused: "En pausa. No se envía nada mientras esto esté activo.",
    pause: "Pausar prospección",
    sendingOff: "El envío está apagado. La pausa lo corta al momento. Quitar la pausa no empieza a enviar por sí solo.",
    attention: "Roleflow está revisando esta prospección. No tienes que hacer nada.",
    suspended: "Esta prospección está en pausa porque la facturación se detuvo. El acceso se puede recuperar si la facturación vuelve a tiempo.",
    viewerTitle: "Navegador de Roleflow",
    viewerBody: "Instagram se abre en esta ventana. La contraseña la escribes aquí. Roleflow no la guarda.",
    close: "Cerrar",
    handleInvalid: "Escribe un usuario de Instagram, sin @.",
    workflowTitle: "Flujo",
    workflowBody: "Estos ajustes se guardan para este negocio. No se envía nada. El navegador tiene que confirmarlos para que cuenten como activos.",
    timezone: "Zona horaria",
    activeStart: "Inicio de las horas activas",
    windowNote: "La revisión corre cada 30 minutos durante 16 horas, de {start} a {end} en {timezone}.",
    newFollowers: "Nuevos seguidores",
    postLikes: "Me gusta en publicaciones",
    dailyMin: "Mínimo de personas nuevas por día",
    dailyMax: "Máximo de personas nuevas por día",
    drafts: "Líneas de borrador",
    draftsNote: "Una línea es un borrador. Un mensaje solo puede usar datos de la biografía, y sigue siendo un borrador.",
    saveWorkflow: "Guardar flujo",
    previewSaved: "Guardado en esta vista previa. No está confirmado en un navegador.",
    savedWaiting: "Guardado. El navegador no lo confirmó.",
    desiredLine: "Versión deseada {version}. Sin confirmar en el navegador.",
    confirmedLine: "Versión deseada {version}. El navegador confirmó esta versión.",
    needsSetup: "Falta la configuración",
    desktopUnavailable: "El control del navegador todavía no está disponible.",
    profileMissing: "Esta cuenta no tiene un perfil de navegador asignado.",
    proxyMissing: "No hay un proxy dedicado asignado.",
    proxyNote: "Un proxy no reemplaza un acceso distinto. Cada cuenta necesita su propio perfil de navegador.",
    connectController: "Conectar",
    pauseWorkflow: "Pausar flujo",
    pauseNote: "Pausar el flujo evita que se recojan borradores. No empieza el envío.",
    stopWorkflow: "Detener flujo",
    stopped: "Detenido. Roleflow tiene que quitar esto antes de que el flujo pueda seguir.",
    activityTitle: "Actividad",
    activityEmpty: "Todavía no hay actividad confirmada.",
    unavailableNote: "Guardar el flujo todavía no está disponible en esta cuenta.",
    workflowInvalid: "Revisa la zona horaria, el rango diario y al menos una línea de borrador.",
    browserAccepted: "El controlador aceptó la solicitud. El navegador no la confirmó.",
    browserReceived: "El controlador recibió la solicitud. El navegador no la confirmó.",
    failedLine: "La última solicitud falló. No hubo confirmación.",
    expiredLine: "La última solicitud venció antes de que el navegador la confirmara.",
    offlineLine: "El navegador está desconectado.",
    fixtureLabel: "Prueba de ensayo. Esta no es una cuenta real."
  }
};

export function soonParts(copy) {
  const full = String(copy && copy.soon || "");
  const link = String(copy && copy.soonLink || "");
  const at = link ? full.indexOf(link) : -1;
  if (at < 0) return { before: full, link: "", after: "" };
  return { before: full.slice(0, at), link, after: full.slice(at + link.length) };
}

export function outreachControls(state) {
  const available = Boolean(state && state.outreachCheckoutAvailable === true);
  return { available, risk: available, checkout: available, cancel: available, soon: !available };
}

export const OUTREACH_CONTACT = "mailto:diego@roleflow.io";
export const OUTREACH_SIGNUP = "/signup/?next=/account/acquisition/%23outreacher";

export function landingCta(status) {
  if (status && status.available === true) return { href: OUTREACH_SIGNUP, label: "Create an account" };
  return { href: OUTREACH_CONTACT, label: "Contact us" };
}

export async function readOutreachCheckoutStatus(fetchImpl, config) {
  const url = String(config && config.SUPABASE_URL || "").replace(/\/$/, "");
  if (!url || !fetchImpl) return { available: false };
  try {
    const response = await fetchImpl(url + "/functions/v1/outreach-checkout", {
      method: "POST",
      headers: {
        apikey: (config && config.SUPABASE_ANON_KEY) || "",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: "status" }),
      signal: AbortSignal.timeout(8000)
    });
    const payload = await response.json().catch(() => ({}));
    return { available: response.ok === true && payload && payload.available === true };
  } catch {
    return { available: false };
  }
}

export function outreacherCopy(language) {
  return COPY[language === "es" ? "es" : "en"];
}

export function normalizeHandle(value) {
  const handle = String(value || "").trim().replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(handle) ? handle : "";
}

export function outreacherPhase(state) {
  const source = state || {};
  const machine = source.machine;
  const paused = Boolean(source.outreacherConfig && source.outreacherConfig.paused);
  if (!machine || machine.status === "deleted") return "start";
  if (machine.status === "suspended" || machine.status === "deleting") return "suspended";
  if (machine.status === "error" || machine.status === "revoked") return "attention";
  if (machine.status === "pending" || machine.status === "provisioning" || machine.status === "stopping") return "setup";
  if (paused) return "paused";
  if (machine.session_state === "ok") return "connected";
  if (machine.session_state === "expired" || machine.session_state === "checkpoint" || machine.session_state === "action_block") return "reconnect";
  if (machine.status === "awaiting_login" || machine.status === "running") return "login";
  return "setup";
}

export function sessionLabel(copy, machine) {
  if (!machine) return "";
  if (machine.session_state === "ok") return copy.connected;
  return copy.needsLogin;
}

export function formatUtcDate(iso, language) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language === "es" ? "es" : "en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

export function termCopy(copy, machine, language) {
  if (!machine || !machine.minimum_term_ends_at) return "";
  if (machine.subscription_cancel_at) {
    return copy.termScheduled.replace("{date}", formatUtcDate(machine.subscription_cancel_at, language));
  }
  return copy.termOpen.replace("{date}", formatUtcDate(machine.minimum_term_ends_at, language));
}

export function renderOutreacher(ui) {
  const language = ui.language ? ui.language() : "en";
  const copy = outreacherCopy(language);
  const phase = outreacherPhase(ui.state);
  const wrap = ui.el("div", { class: "platform-home", id: "outreacher", "data-phase": phase });
  wrap.append(ui.pageHeader(ui, copy.title, copy.body, "outreacher", "send"));
  wrap.append(statusCard(ui, copy, phase, language));
  wrap.append(workflowCard(ui, copy));
  if (ui.state && ui.state.outreachOpen) wrap.append(viewer(ui, copy));
  return wrap;
}

function statusCard(ui, copy, phase, language) {
  const card = ui.el("section", { class: "agent outreach-card", id: "outreach-status" });
  const machine = ui.state && ui.state.machine;
  card.append(priceBlock(ui, copy, machine, language));
  if (phase === "start" && outreachControls(ui.state).checkout) card.append(startBlock(ui, copy));
  if (phase === "setup") {
    card.append(ui.el("h3", { text: copy.setupTitle }));
    card.append(ui.el("p", { class: "mute", id: "outreach-setup", text: copy.setupBody }));
  }
  if (phase === "login") card.append(loginBlock(ui, copy, false));
  if (phase === "reconnect") card.append(loginBlock(ui, copy, true));
  if (phase === "connected") {
    card.append(ui.el("p", { class: "integration-status on", id: "outreach-session", role: "status", text: sessionLabel(copy, machine) }));
    card.append(accessButton(ui, copy.access));
  }
  if (phase === "paused") {
    card.append(ui.el("p", { id: "outreach-paused", role: "status", text: copy.paused }));
    if (machine && machine.session_state === "ok") card.append(accessButton(ui, copy.access));
    else card.append(loginBlock(ui, copy, machine && machine.session_state && machine.session_state !== "unknown"));
  }
  if (phase === "attention") card.append(ui.el("p", { id: "outreach-attention", role: "status", text: copy.attention }));
  if (phase === "suspended") card.append(ui.el("p", { id: "outreach-suspended", role: "status", text: copy.suspended }));
  if (phase !== "start" && phase !== "setup" && phase !== "attention" && phase !== "suspended") {
    card.append(pauseRow(ui, copy));
  }
  if (ui.state && ui.state.outreachError) {
    card.append(ui.el("p", { class: "claude-notice", id: "outreach-error", role: "alert", text: ui.state.outreachError }));
  }
  return card;
}

function priceBlock(ui, copy, machine, language) {
  const block = ui.el("div", { class: "outreach-price-block", id: "outreach-price-block" });
  block.append(ui.el("p", { class: "outreach-price", id: "outreach-price", text: copy.price }));
  const term = termCopy(copy, machine, language);
  if (term) block.append(ui.el("p", { class: "mute outreach-term", id: "outreach-term", text: term }));
  if (outreachControls(ui.state).soon) block.append(soonNote(ui, copy));
  else if (canCancel(ui, machine)) {
    const button = ui.button(copy.cancel, () => ui.scheduleOutreachCancel && ui.scheduleOutreachCancel());
    button.id = "outreach-cancel";
    button.classList.add("ghost");
    block.append(button);
  }
  return block;
}

function canCancel(ui, machine) {
  if (!outreachControls(ui.state).cancel) return false;
  if (!ui.state || ui.state.canEdit !== true || !machine || !machine.minimum_term_ends_at) return false;
  if (machine.subscription_cancel_at) return false;
  return machine.status !== "deleted" && machine.status !== "suspended" && machine.status !== "deleting";
}

function soonNote(ui, copy) {
  const parts = soonParts(copy);
  const line = ui.el("p", { class: "mute outreach-soon", id: "outreach-soon" });
  if (parts.before) line.append(parts.before);
  if (parts.link) line.append(ui.el("a", { href: OUTREACH_CONTACT }, [parts.link]));
  if (parts.after) line.append(parts.after);
  return line;
}

function startBlock(ui, copy) {
  const block = ui.el("div", { id: "outreach-start" });
  block.append(ui.el("h3", { text: copy.startTitle }));
  block.append(ui.el("p", { class: "mute", text: copy.startBody }));
  const risk = ui.el("input", { id: "outreach-risk", type: "checkbox" });
  const mayEdit = Boolean(ui.state && ui.state.canEdit === true);
  const button = ui.button(copy.checkout, () => ui.startOutreachCheckout && ui.startOutreachCheckout(risk.checked));
  button.id = "outreach-checkout";
  button.disabled = true;
  risk.disabled = !mayEdit;
  risk.addEventListener("change", () => { button.disabled = !(mayEdit && risk.checked); });
  block.append(ui.el("label", { class: "switch outreach-risk" }, [risk, copy.risk]));
  block.append(button);
  return block;
}

function loginBlock(ui, copy, reconnect) {
  const block = ui.el("div", { id: reconnect ? "outreach-reconnect" : "outreach-login" });
  block.append(ui.el("h3", { text: reconnect ? copy.reconnectTitle : copy.loginTitle }));
  block.append(ui.el("p", { class: "mute", text: reconnect ? copy.reconnectBody : copy.loginBody }));
  const current = (ui.state && ui.state.outreacherConfig && ui.state.outreacherConfig.ig_username) || (ui.state && ui.state.machine && ui.state.machine.ig_username) || "";
  const input = ui.el("input", {
    id: "outreach-handle",
    type: "text",
    maxlength: "30",
    autocomplete: "username",
    spellcheck: "false",
    "aria-label": copy.username,
    value: current ? "@" + String(current).replace(/^@+/, "") : ""
  });
  const button = ui.button(reconnect ? copy.reconnect : copy.connect, () => ui.openOutreachBrowser && ui.openOutreachBrowser(input.value));
  button.id = "outreach-connect";
  if (!ui.state || ui.state.canEdit !== true) button.disabled = true;
  block.append(ui.el("label", { text: copy.username }, [input]));
  block.append(button);
  return block;
}

function accessButton(ui, label) {
  const button = ui.button(label, () => ui.openOutreachBrowser && ui.openOutreachBrowser(""));
  button.id = "outreach-access";
  return button;
}

function pauseRow(ui, copy) {
  const row = ui.el("div", { class: "outreach-pause" });
  const paused = Boolean(ui.state && ui.state.outreacherConfig && ui.state.outreacherConfig.paused);
  const input = ui.el("input", { id: "outreach-pause", type: "checkbox" });
  input.checked = paused;
  input.addEventListener("change", () => ui.saveOutreachPause && ui.saveOutreachPause(input.checked));
  row.append(ui.el("label", { class: "switch" }, [input, copy.pause]));
  row.append(ui.el("p", { class: "mute", text: copy.sendingOff }));
  return row;
}

function viewer(ui, copy) {
  const frame = ui.el("section", { class: "outreach-viewer", id: "outreach-viewer" });
  const bar = ui.el("div", { class: "outreach-viewer-bar" });
  bar.append(ui.el("strong", { text: copy.viewerTitle }));
  const close = ui.button(copy.close, () => {
    ui.state.outreachOpen = false;
    ui.state.outreachUrl = "";
    if (ui.paint) ui.paint();
  });
  close.id = "outreach-close";
  close.classList.add("ghost");
  bar.append(close);
  frame.append(bar);
  frame.append(ui.el("p", { class: "mute", text: copy.viewerBody }));
  const url = ui.state && ui.state.outreachUrl;
  if (url) {
    frame.append(ui.el("iframe", { class: "outreach-frame", title: copy.viewerTitle, src: url }));
  } else {
    const stage = ui.el("div", { class: "outreach-frame outreach-stage", role: "status" });
    stage.append(ui.el("p", { text: copy.viewerBody }));
    frame.append(stage);
  }
  return frame;
}

export function workflowFromFields(fields) {
  const source = fields || {};
  const lines = String(source.drafts || "").split(/\n/).map((line) => line.trim()).filter(Boolean);
  const sources = [];
  if (source.newFollowers) sources.push("new_follower");
  if (source.postLikes) sources.push("post_liker");
  const dailyMin = Number(source.dailyMin);
  const dailyMax = Number(source.dailyMax);
  return {
    timezone: String(source.timezone || "").trim(),
    active_start: String(source.activeStart || "").slice(0, 5),
    active_hours: 16,
    poll_interval_min: 30,
    sources,
    daily_prospect_min: Number.isInteger(dailyMin) ? dailyMin : Number.NaN,
    daily_prospect_max: Number.isInteger(dailyMax) ? dailyMax : Number.NaN,
    draft_only: true,
    personalize: "bio_facts_only",
    templates: lines.map((text, index) => ({ id: "draft-" + (index + 1), text }))
  };
}

export function workflowStatusText(copy, view) {
  if (view && view.agreement === "confirmed" && view.desiredVersion) {
    return copy.confirmedLine.replace("{version}", String(view.desiredVersion));
  }
  if (view && view.desiredVersion) return copy.desiredLine.replace("{version}", String(view.desiredVersion));
  return copy.needsSetup;
}

export function workflowWindowText(copy, start, timezone) {
  return copy.windowNote
    .replace("{start}", start || "07:00")
    .replace("{end}", windowEnd(start || "07:00"))
    .replace("{timezone}", timezone || "America/Asuncion");
}

function workflowCard(ui, copy) {
  const card = ui.el("section", { class: "agent outreach-card", id: "workflow-card" });
  const state = ui.state || {};
  const saved = state.controllerWorkflow || null;
  const view = controllerView({
    controller: state.controller,
    profile: state.controllerProfile,
    command: state.controllerCommand,
    activity: state.controllerActivity,
    unavailable: state.controllerUnavailable !== false
  });
  card.append(ui.el("h3", { text: copy.workflowTitle }));
  card.append(ui.el("p", { class: "mute", text: copy.workflowBody }));
  card.append(ui.el("p", { class: "integration-status", id: "workflow-connection", role: "status", text: copy.needsSetup }));
  card.append(ui.el("p", { id: "workflow-desired", role: "status", text: workflowStatusText(copy, view) }));
  if (view.commandStatus === "accepted") card.append(ui.el("p", { id: "workflow-progress", text: copy.browserAccepted }));
  if (view.commandStatus === "acknowledged") card.append(ui.el("p", { id: "workflow-progress", text: copy.browserReceived }));
  if (view.agreement === "failed" && !view.killed) card.append(ui.el("p", { id: "workflow-progress", text: copy.failedLine }));
  if (view.agreement === "expired") card.append(ui.el("p", { id: "workflow-progress", text: copy.expiredLine }));
  if (view.agreement === "offline") card.append(ui.el("p", { id: "workflow-progress", text: copy.offlineLine }));
  card.append(ui.el("p", { id: "workflow-desktop", text: copy.desktopUnavailable }));
  card.append(ui.el("p", { class: "mute", id: "workflow-profile", text: view.profileStatus === "unconfigured" ? copy.profileMissing : copy.proxyNote }));
  if (view.proxy !== "assigned") card.append(ui.el("p", { id: "workflow-proxy", text: copy.proxyMissing }));
  const connect = ui.button(copy.connectController, () => {});
  connect.id = "workflow-connect";
  connect.classList.add("ghost");
  connect.disabled = true;
  connect.setAttribute("aria-disabled", "true");
  card.append(connect);
  if (view.fixture) card.append(ui.el("p", { id: "workflow-fixture", text: copy.fixtureLabel }));
  if (state.controllerNotice) card.append(ui.el("p", { id: "workflow-notice", role: "status", text: state.controllerNotice }));
  if (state.controllerUnavailable !== false) {
    card.append(ui.el("p", { class: "mute", id: "workflow-unavailable", text: copy.unavailableNote }));
    card.append(activityBlock(ui, copy, view));
    return card;
  }
  const mayEdit = state.canEdit === true;
  const timezone = ui.el("input", {
    id: "workflow-timezone",
    type: "text",
    maxlength: "64",
    value: (saved && saved.timezone) || "America/Asuncion",
    disabled: mayEdit ? null : true
  });
  const start = ui.el("input", {
    id: "workflow-start",
    type: "time",
    value: (saved && saved.active_start) || "07:00",
    disabled: mayEdit ? null : true
  });
  const window = ui.el("p", { class: "mute", id: "workflow-window", text: workflowWindowText(copy, start.value, timezone.value) });
  const refreshWindow = () => { window.textContent = workflowWindowText(copy, start.value, timezone.value); };
  timezone.addEventListener("input", refreshWindow);
  start.addEventListener("input", refreshWindow);
  const followers = ui.el("input", { id: "workflow-followers", type: "checkbox" });
  const likes = ui.el("input", { id: "workflow-likes", type: "checkbox" });
  const sourceList = saved && Array.isArray(saved.sources) ? saved.sources : ["new_follower", "post_liker"];
  followers.checked = sourceList.includes("new_follower");
  likes.checked = sourceList.includes("post_liker");
  followers.disabled = !mayEdit;
  likes.disabled = !mayEdit;
  const dailyMin = ui.el("input", { id: "workflow-daily-min", type: "number", min: "20", max: "100", value: saved ? String(saved.daily_prospect_min) : "20" });
  const dailyMax = ui.el("input", { id: "workflow-daily-max", type: "number", min: "20", max: "100", value: saved ? String(saved.daily_prospect_max) : "100" });
  dailyMin.disabled = !mayEdit;
  dailyMax.disabled = !mayEdit;
  const drafts = ui.el("textarea", {
    id: "workflow-drafts",
    rows: "4",
    maxlength: "2400"
  });
  drafts.value = saved && Array.isArray(saved.templates) ? saved.templates.map((row) => row.text).join("\n") : "";
  drafts.disabled = !mayEdit;
  card.append(ui.el("label", { text: copy.timezone }, [timezone]));
  card.append(ui.el("label", { text: copy.activeStart }, [start]));
  card.append(window);
  card.append(ui.el("label", { class: "switch" }, [followers, copy.newFollowers]));
  card.append(ui.el("label", { class: "switch" }, [likes, copy.postLikes]));
  card.append(ui.el("label", { text: copy.dailyMin }, [dailyMin]));
  card.append(ui.el("label", { text: copy.dailyMax }, [dailyMax]));
  card.append(ui.el("label", { text: copy.drafts }, [drafts]));
  card.append(ui.el("p", { class: "mute", text: copy.draftsNote }));
  const save = ui.button(copy.saveWorkflow, () => ui.saveControllerWorkflow && ui.saveControllerWorkflow(workflowFromFields({
    timezone: timezone.value,
    activeStart: start.value,
    newFollowers: followers.checked,
    postLikes: likes.checked,
    dailyMin: dailyMin.value,
    dailyMax: dailyMax.value,
    drafts: drafts.value
  })));
  save.id = "workflow-save";
  save.disabled = !mayEdit;
  card.append(save);
  const paused = ui.el("input", { id: "workflow-pause", type: "checkbox" });
  paused.checked = view.paused;
  paused.disabled = !mayEdit || view.killed;
  paused.addEventListener("change", () => ui.saveControllerPause && ui.saveControllerPause(paused.checked));
  card.append(ui.el("label", { class: "switch" }, [paused, copy.pauseWorkflow]));
  card.append(ui.el("p", { class: "mute", text: copy.pauseNote }));
  if (view.killed) card.append(ui.el("p", { id: "workflow-stopped", role: "status", text: copy.stopped }));
  const stop = ui.button(copy.stopWorkflow, () => ui.stopController && ui.stopController());
  stop.id = "workflow-stop";
  stop.disabled = !mayEdit || view.killed;
  card.append(stop);
  card.append(activityBlock(ui, copy, view));
  const checked = saved ? validateWorkflow(saved) : null;
  if (checked && !checked.ok) card.append(ui.el("p", { class: "claude-notice", id: "workflow-invalid", role: "alert", text: copy.workflowInvalid }));
  return card;
}

function activityBlock(ui, copy, view) {
  const block = ui.el("div", { id: "workflow-activity" });
  block.append(ui.el("h3", { text: copy.activityTitle }));
  const rows = (view.activity || []).filter((row) => ["prospect_seen", "draft_prepared", "duplicate_skipped", "qualification"].includes(row.kind));
  if (!rows.length) {
    block.append(ui.el("p", { class: "mute", id: "workflow-activity-empty", text: copy.activityEmpty }));
    return block;
  }
  const list = ui.el("ul", { class: "workflow-activity" });
  rows.forEach((row) => {
    const facts = Array.isArray(row.bio_facts) ? row.bio_facts.filter(Boolean).join("; ") : "";
    const text = [row.handle ? "@" + row.handle : "", row.source || "", facts, row.draft_text || ""].filter(Boolean).join(" · ");
    const item = ui.el("li", { text: text || row.kind || "" });
    if (row.test_only) item.append(ui.el("span", { class: "workflow-fixture", text: " " + copy.fixtureLabel }));
    list.append(item);
  });
  block.append(list);
  return block;
}

export async function loadController(supabase, businessId) {
  if (!supabase || !businessId) return { unavailable: true, state: null, profile: null, workflow: null, activity: [], command: null };
  const state = await supabase.from("outreacher_controller_state").select("paused, killed, desired_version, observed_version, controller_status, profile_id, last_error").eq("business_id", businessId).maybeSingle();
  if (state.error) {
    return {
      unavailable: /schema cache|does not exist|PGRST|outreacher_controller_state/i.test(state.error.message || ""),
      error: state.error.message,
      state: null,
      profile: null,
      workflow: null,
      activity: [],
      command: null
    };
  }
  const profile = await supabase.from("outreacher_profiles").select("id, profile_key, process_slot, ig_username, session_state, status, controller_seen_at").eq("business_id", businessId).limit(1).maybeSingle();
  const version = await supabase.from("outreacher_workflow_versions").select("version, document").eq("business_id", businessId).order("version", { ascending: false }).limit(1).maybeSingle();
  const activity = await supabase.from("outreacher_activity").select("id, kind, handle, source, bio_facts, draft_text, created_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(20);
  const command = await supabase.from("outreacher_commands").select("id, operation, workflow_version, status, last_error, expires_at, accepted_at, acknowledged_at, observed_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return {
    unavailable: false,
    state: state.data,
    profile: profile.error ? null : profile.data,
    workflow: version.error || !version.data ? null : version.data.document,
    activity: activity.error ? [] : activity.data || [],
    command: command.error ? null : command.data
  };
}

export async function loadOutreacher(supabase, businessId) {
  if (!supabase || !businessId) return { machine: null, config: null };
  const columns = "id, status, session_state, sending_mode, ig_username, last_heartbeat_at, subscription_status, grace_delete_at, volume_retain_until, minimum_term_ends_at, subscription_cancel_at, updated_at";
  let machine = await supabase.from("client_machines").select(columns).eq("business_id", businessId).neq("status", "deleted").limit(1).maybeSingle();
  if (machine.error && /minimum_term_ends_at|subscription_cancel_at/i.test(machine.error.message || "")) {
    machine = await supabase.from("client_machines").select("id, status, session_state, sending_mode, ig_username, last_heartbeat_at, subscription_status, grace_delete_at, volume_retain_until, updated_at").eq("business_id", businessId).neq("status", "deleted").limit(1).maybeSingle();
  }
  const config = await supabase.from("acq_outreacher_config").select("paused, hourly_cap, ig_username").eq("business_id", businessId).maybeSingle();
  return {
    machine: machine.error ? null : machine.data,
    config: config.error ? null : config.data,
    unavailable: Boolean(machine.error && /schema cache|does not exist|PGRST/i.test(machine.error.message || ""))
  };
}
