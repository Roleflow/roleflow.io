import { DM_CAP_DEFAULT, DM_CAP_MAX, clampDmCap } from "./auto-dm.js";

const COPY = {
  en: {
    title: "Outreacher",
    body: "Follow-to-DM for this business. It stays off until you turn it on. The kill switch stops it immediately.",
    locked: "This module runs on this business only.",
    optIn: "Send follow-to-DMs",
    kill: "Kill switch",
    cap: "Daily cap",
    capHelp: "20 a day unless you set another number. 50 is the most.",
    wait: "Each DM waits 5 to 30 minutes after the follow or like, and only between 09:00 and 21:00 Madrid. Claude writes a new opener from the public profile.",
    password: "The Instagram password is never stored. The worker keeps this business's encrypted session on its own computer.",
    campaign: "Campaign",
    name: "Name",
    handles: "Handles",
    handlesHelp: "One Instagram handle per line.",
    template: "Message",
    templateHelp: "Notes for the opener. The sent text is written for that person. Prices and commission are removed.",
    save: "Save campaign",
    exclusion: "Do not message",
    exclusionHelp: "One handle per line. Anyone who says stop is added here.",
    saved: "Saved. Nothing sends while this is off or the kill switch is on."
  },
  es: {
    title: "Prospección",
    body: "DM después de seguir, para este negocio. Sigue apagado hasta que lo actives. El interruptor de parada lo corta al momento.",
    locked: "Este módulo es solo de este negocio.",
    optIn: "Enviar DMs tras seguir",
    kill: "Interruptor de parada",
    cap: "Tope diario",
    capHelp: "20 al día salvo que pongas otro número. El máximo es 50.",
    wait: "Cada DM espera de 5 a 30 minutos tras el follow o el like, y solo entre las 09:00 y las 21:00 de Madrid. Claude escribe un primer mensaje nuevo a partir del perfil público.",
    password: "La contraseña de Instagram no se guarda. El worker conserva la sesión cifrada de este negocio en su propio ordenador.",
    campaign: "Campaña",
    name: "Nombre",
    handles: "Usuarios",
    handlesHelp: "Un usuario de Instagram por línea.",
    template: "Mensaje",
    templateHelp: "Usa {hola|hey} para variar. Los precios y la comisión se quitan.",
    save: "Guardar campaña",
    exclusion: "No escribir",
    exclusionHelp: "Un usuario por línea. Quien diga stop se añade aquí.",
    saved: "Guardado. No se envía nada mientras esté apagado o el interruptor de parada esté activo."
  }
};

function box(state) {
  if (!state.autoDm) {
    state.autoDm = {
      enabled: false,
      killed: false,
      cap: DM_CAP_DEFAULT,
      name: "",
      handles: "",
      template: "{hi|hey}, saw you around. what are you building?",
      exclusions: ""
    };
  }
  return state.autoDm;
}

export function renderAutoDm(ui) {
  const lang = ui.language && ui.language() === "es" ? "es" : "en";
  const copy = COPY[lang];
  const wrap = ui.el("div", { class: "platform-home", id: "auto-dm" });
  wrap.append(ui.pageHeader(ui, copy.title, copy.body, "outbound", "send"));
  const draft = box(ui.state);
  const card = ui.el("form", { class: "agent", id: "auto-dm-form" });
  const enabled = ui.el("input", { id: "auto-dm-enabled", type: "checkbox" });
  enabled.checked = draft.enabled === true;
  const killed = ui.el("input", { id: "auto-dm-kill", type: "checkbox" });
  killed.checked = draft.killed === true;
  const cap = ui.el("input", {
    id: "auto-dm-cap",
    type: "number",
    min: "1",
    max: String(DM_CAP_MAX),
    value: String(clampDmCap(draft.cap))
  });
  const name = ui.el("input", { id: "auto-dm-name", type: "text", maxlength: "80", value: draft.name || "" });
  const handles = ui.el("textarea", { id: "auto-dm-handles", rows: "6" });
  handles.value = draft.handles || "";
  const template = ui.el("textarea", { id: "auto-dm-template", rows: "4" });
  template.value = draft.template || "";
  const exclusions = ui.el("textarea", { id: "auto-dm-exclusions", rows: "4" });
  exclusions.value = draft.exclusions || "";
  card.append(ui.el("label", { class: "switch" }, [enabled, " " + copy.optIn]));
  card.append(ui.el("label", { class: "switch" }, [killed, " " + copy.kill]));
  card.append(ui.el("label", { text: copy.cap }, [cap]));
  card.append(ui.el("p", { class: "mute", text: copy.capHelp }));
  card.append(ui.el("p", { text: copy.wait }));
  card.append(ui.el("p", { text: copy.password }));
  card.append(ui.el("h3", { text: copy.campaign }));
  card.append(ui.el("label", { text: copy.name }, [name]));
  card.append(ui.el("label", { text: copy.handles }, [handles]));
  card.append(ui.el("p", { class: "mute", text: copy.handlesHelp }));
  card.append(ui.el("label", { text: copy.template }, [template]));
  card.append(ui.el("p", { class: "mute", text: copy.templateHelp }));
  card.append(ui.el("h3", { text: copy.exclusion }));
  exclusions.setAttribute("aria-label", copy.exclusion);
  card.append(exclusions);
  card.append(ui.el("p", { class: "mute", text: copy.exclusionHelp }));
  card.append(ui.button(copy.save, null, "submit"));
  const saved = ui.state.dmCampaigns || [];
  if (saved.length) {
    card.append(ui.el("h3", { text: copy.campaign }));
    saved.forEach((row) => {
      card.append(ui.el("p", { text: (row.name || copy.campaign) + (row.enabled ? "" : " · off") }));
    });
  }
  card.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = {
      enabled: enabled.checked,
      killed: killed.checked,
      cap: clampDmCap(cap.value),
      name: name.value.trim(),
      handles: handles.value,
      template: template.value,
      exclusions: exclusions.value
    };
    ui.state.autoDm = next;
    if (ui.saveAutoDm) ui.saveAutoDm(next);
    else if (ui.toast) ui.toast(copy.saved);
  });
  wrap.append(card);
  return wrap;
}
