// Dashboard controls: one place to turn each agent and sending on or off.
// Reads only panel state. Writes go through ui.setAgent (client-dashboard
// set_agent) and ui.setSending (acq_dm_controls under RLS).

import { scrubChannelCopy } from "./connect-instagram.js";

export const DASHBOARD_AGENTS = ["setter", "followup", "comment_voice", "warmer", "outreacher"];
export const SOON_AGENTS = ["warmer", "outreacher"];
export const LLM_ERROR_WINDOW_MS = 24 * 60 * 60 * 1000;

const KEY_PROBLEM = /api key|incorrect.*key|invalid.*key|key.*(rejected|invalid|revoked)|unauthori[sz]ed|\b401\b|\b403\b|authentication/i;

const COPY = {
  en: {
    title: "Agents and sending",
    lede: "Turn each agent and sending on or off for this business.",
    replying: "Replying to DMs",
    on: "On",
    off: "Off",
    blocked: "Blocked",
    sending: "Sending",
    sendingNote: "Lets Roleflow send Instagram messages for this business.",
    sendingStopped: "Sending was stopped by Roleflow. Contact support to restart it.",
    agents: {
      setter: ["Setter", "Replies to Instagram DMs."],
      followup: ["Follow-ups", "Sends the next message when your follow-up rules match."],
      comment_voice: ["Comment voice", "Sends one private reply to comments that match your rules."],
      warmer: ["Lead Warmer", "Warms new followers and recent likers."],
      outreacher: ["Outreacher", "Starts first conversations with good-fit people."]
    },
    soon: "Soon",
    needsSending: "Sending is off, so nothing goes out.",
    noInstagram: "Instagram is not connected. Connect it in Settings.",
    keyRejected: "AI key rejected, check Settings.",
    setterOff: "The Setter is off.",
    readOnly: "Only an owner, editor or admin can change these switches.",
    settings: "Open Settings",
    confirmSending: "Turn sending on? Agents that are on can message people on Instagram while it stays on.",
    adminDetail: "Admin: last AI error {when}: {message}"
  },
  es: {
    title: "Agentes y envío",
    lede: "Activa o apaga cada agente y el envío para este negocio.",
    replying: "Respondiendo DMs",
    on: "Activo",
    off: "Apagado",
    blocked: "Bloqueado",
    sending: "Envío",
    sendingNote: "Permite que Roleflow envíe mensajes de Instagram para este negocio.",
    sendingStopped: "Roleflow detuvo el envío. Contacta con soporte para reactivarlo.",
    agents: {
      setter: ["Setter", "Responde los DMs de Instagram."],
      followup: ["Seguimientos", "Envía el siguiente mensaje cuando se cumplen tus reglas."],
      comment_voice: ["Voz en comentarios", "Envía una respuesta privada a los comentarios que cumplen tus reglas."],
      warmer: ["Calentador", "Calienta a nuevos seguidores y a quienes dieron like."],
      outreacher: ["Prospección", "Inicia conversaciones con personas afines."]
    },
    soon: "Pronto",
    needsSending: "El envío está apagado, así que no sale nada.",
    noInstagram: "Instagram no está conectado. Conéctalo en Ajustes.",
    keyRejected: "Clave de IA rechazada, revisa Ajustes.",
    setterOff: "El Setter está apagado.",
    readOnly: "Solo un propietario, editor o admin puede cambiar estos interruptores.",
    settings: "Abrir Ajustes",
    confirmSending: "¿Activar el envío? Los agentes activos pueden escribir por Instagram mientras siga activo.",
    adminDetail: "Admin: último error de IA {when}: {message}"
  }
};

export function switchesText(language) {
  return language === "es" ? COPY.es : COPY.en;
}

function agentOn(switches, key) {
  const row = (switches || []).find((item) => item && item.agent_key === key);
  return Boolean(row && row.enabled === true);
}

export function instagramConnected(state) {
  const source = state || {};
  const businessId = source.businessId || "";
  const ig = source.ig && (!source.ig.business_id || source.ig.business_id === businessId) ? source.ig : null;
  if (ig && ig.status === "connected") return true;
  const gateway = source.gatewayIg;
  return Boolean(gateway && gateway.status === "connected");
}

// No member-readable timestamp of the last key save exists (acq_llm_key_hints
// returns provider and last4 only, and saving a key does not touch
// acq_settings). So a key error counts only while it is in the last 24 hours,
// AND no successful AI reply was recorded after it, AND the key was not saved
// in this browser session after it.
export function successfulReply(row) {
  if (!row || row.role !== "assistant") return false;
  if (row.sender === "human") return false;
  if (row.delivery_status === "failed") return false;
  return Number.isFinite(Date.parse(row.sent_at || ""));
}

export function recentKeyErrors(errors, now, context) {
  const at = now instanceof Date ? now.getTime() : Date.now();
  const extra = context || {};
  const lastReply = (extra.replies || []).filter(successfulReply).reduce((max, row) => Math.max(max, Date.parse(row.sent_at)), -Infinity);
  const savedAt = Date.parse(extra.keySavedAt || "");
  const cleared = Math.max(lastReply, Number.isFinite(savedAt) ? savedAt : -Infinity);
  return (errors || []).filter((row) => {
    if (!row) return false;
    const stamp = Date.parse(row.created_at || "");
    if (!Number.isFinite(stamp) || at - stamp > LLM_ERROR_WINDOW_MS || stamp - at > 60000) return false;
    if (stamp <= cleared) return false;
    return KEY_PROBLEM.test(String(row.message || ""));
  });
}

export function dashboardControls(state, now) {
  const source = state || {};
  const dm = source.autoDm || {};
  const killed = dm.killed === true;
  const sendingOn = dm.enabled === true && !killed;
  const setterOn = agentOn(source.agentSwitches, "setter");
  const connected = instagramConnected(source);
  const savedMap = source.llmKeySavedAt || {};
  const keyErrors = recentKeyErrors(source.llmErrors, now, {
    replies: source.assistantReplies,
    keySavedAt: typeof savedMap === "string" ? savedMap : savedMap[source.businessId || ""]
  });
  const blockers = [];
  if (sendingOn || setterOn) {
    if (!connected) blockers.push("noInstagram");
    if (keyErrors.length) blockers.push("keyRejected");
  }
  if (setterOn && !sendingOn) blockers.unshift("needsSending");
  const replying = setterOn && sendingOn && !blockers.length;
  const hints = blockers.slice();
  if (sendingOn && !setterOn) hints.unshift("setterOff");
  return {
    replying: replying ? "on" : setterOn && sendingOn ? "blocked" : "off",
    sendingOn,
    killed,
    setterOn,
    connected,
    keyErrors,
    blockers,
    hints,
    agents: DASHBOARD_AGENTS.map((key) => ({ key, on: agentOn(source.agentSwitches, key), soon: SOON_AGENTS.includes(key) }))
  };
}

function toggle(ui, opts) {
  const node = ui.el("button", {
    type: "button",
    class: "dash-switch" + (opts.on ? " on" : ""),
    role: "switch",
    "aria-checked": opts.on ? "true" : "false",
    "aria-label": opts.label,
    "data-switch": opts.id,
    disabled: opts.disabled ? true : null
  }, [ui.el("span", { class: "dash-switch-knob", "aria-hidden": "true" })]);
  if (!opts.disabled && opts.onChange) {
    node.addEventListener("click", async () => {
      node.disabled = true;
      node.setAttribute("aria-busy", "true");
      try {
        await opts.onChange(!opts.on);
      } finally {
        node.disabled = false;
        node.removeAttribute("aria-busy");
      }
    });
  }
  return node;
}

function row(ui, opts) {
  const item = ui.el("li", { class: "dash-control" + (opts.soon ? " soon" : ""), "data-control": opts.id });
  const label = ui.el("div", { class: "dash-control-text" });
  const name = ui.el("strong", { text: opts.title });
  if (opts.badge) name.append(" ", ui.el("span", { class: "dash-soon", text: opts.badge }));
  label.append(name, ui.el("span", { class: "mute", text: opts.note }));
  const state = ui.el("span", { class: "integration-status" + (opts.on ? " on" : ""), role: "status", text: opts.on ? opts.copy.on : opts.copy.off });
  item.append(label, state, toggle(ui, opts));
  return item;
}

function fill(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => values[key] == null ? "" : String(values[key]));
}

export function renderDashboardSwitches(ui, now) {
  const language = ui.language ? ui.language() : "en";
  const copy = switchesText(language);
  const view = dashboardControls(ui.state, now);
  const canEdit = ui.state.canEdit === true;
  const card = ui.el("section", { class: "agent dash-controls", id: "dashboard-switches", "aria-labelledby": "dash-controls-title" });
  card.append(ui.el("h3", { id: "dash-controls-title", text: copy.title }));
  card.append(ui.el("p", { class: "mute", text: copy.lede }));

  const headline = ui.el("p", { class: "dash-replying " + view.replying, role: "status", id: "dash-replying" });
  const word = view.replying === "on" ? copy.on : view.replying === "blocked" ? copy.blocked : copy.off;
  headline.append(ui.el("span", { text: copy.replying + ": " }), ui.el("strong", { text: word }));
  card.append(headline);

  if (view.hints.length) {
    const list = ui.el("ul", { class: "dash-blockers", id: "dash-blockers" });
    view.hints.forEach((key) => {
      const item = ui.el("li", { "data-blocker": key }, [ui.el("span", { text: copy[key] })]);
      if ((key === "noInstagram" || key === "keyRejected") && ui.go) {
        const link = ui.el("button", { type: "button", class: "dash-hint-link", "data-open": key }, [copy.settings]);
        link.addEventListener("click", () => {
          if (key === "keyRejected") {
            ui.state.configKey = "reply";
            ui.state.settingsFocus = "model";
            ui.go("settings");
          } else {
            ui.go("settings/connect");
          }
        });
        item.append(" ", link);
      }
      list.append(item);
    });
    card.append(list);
  }

  const list = ui.el("ul", { class: "dash-control-list" });
  list.append(row(ui, {
    id: "sending",
    title: copy.sending,
    note: view.killed ? copy.sendingStopped : copy.sendingNote,
    on: view.sendingOn,
    copy,
    label: copy.sending,
    disabled: !canEdit || view.killed || !ui.setSending,
    onChange: (value) => ui.setSending(value)
  }));
  view.agents.forEach((agent) => {
    const words = copy.agents[agent.key];
    list.append(row(ui, {
      id: agent.key,
      title: words[0],
      note: words[1],
      on: agent.on,
      soon: agent.soon,
      badge: agent.soon ? copy.soon : "",
      copy,
      label: words[0],
      disabled: !canEdit || (agent.soon && !agent.on) || !ui.setAgent,
      onChange: (value) => ui.setAgent(agent.key, value)
    }));
  });
  card.append(list);
  if (!canEdit) card.append(ui.el("p", { class: "mute", id: "dash-readonly", text: copy.readOnly }));

  if (ui.state.isAdmin === true && view.keyErrors.length) {
    const last = view.keyErrors[0];
    const when = ui.when ? ui.when(last.created_at) : String(last.created_at || "");
    const message = scrubChannelCopy(String(last.message || "")).slice(0, 200);
    card.append(ui.el("p", { class: "mute admin-only", id: "dash-admin-detail", text: fill(copy.adminDetail, { when, message }) }));
  }
  return card;
}
