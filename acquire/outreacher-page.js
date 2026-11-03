// Outreacher tab. One layout for every business. The client signs in inside
// the Roleflow browser. This page has no password field.

const COPY = {
  en: {
    title: "Outreacher",
    body: "Your outreacher runs on its own computer for this business. You sign in to Instagram yourself. Roleflow never sees the password.",
    startTitle: "Start your outreacher",
    startBody: "After checkout, this page shows setup, then a browser where you sign in. Sending stays off until you turn it on.",
    risk: "I understand Instagram can limit or close an account that sends automated messages. I accept that risk for this business.",
    price: "$249 setup + 10% of growth, 3-month minimum",
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
    handleInvalid: "Enter an Instagram username, without the @."
  },
  es: {
    title: "Prospección",
    body: "Tu prospección corre en su propio ordenador para este negocio. Entras en Instagram tú. Roleflow no ve la contraseña.",
    startTitle: "Empieza tu prospección",
    startBody: "Después del pago, esta página muestra la preparación y luego un navegador donde entras. El envío sigue apagado hasta que lo actives.",
    risk: "Entiendo que Instagram puede limitar o cerrar una cuenta que envía mensajes automáticos. Acepto ese riesgo para este negocio.",
    price: "$249 setup + 10% of growth, 3-month minimum",
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
    handleInvalid: "Escribe un usuario de Instagram, sin @."
  }
};

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
  if (ui.state && ui.state.outreachOpen) wrap.append(viewer(ui, copy));
  return wrap;
}

function statusCard(ui, copy, phase, language) {
  const card = ui.el("section", { class: "agent outreach-card", id: "outreach-status" });
  const machine = ui.state && ui.state.machine;
  card.append(priceBlock(ui, copy, machine, language));
  if (phase === "start") card.append(startBlock(ui, copy));
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
  if (canCancel(ui, machine)) {
    const button = ui.button(copy.cancel, () => ui.scheduleOutreachCancel && ui.scheduleOutreachCancel());
    button.id = "outreach-cancel";
    button.classList.add("ghost");
    block.append(button);
  }
  return block;
}

function canCancel(ui, machine) {
  if (!ui.state || ui.state.canEdit !== true || !machine || !machine.minimum_term_ends_at) return false;
  if (machine.subscription_cancel_at) return false;
  return machine.status !== "deleted" && machine.status !== "suspended" && machine.status !== "deleting";
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
