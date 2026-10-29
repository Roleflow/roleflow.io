import { dmSendBadge } from "./comment-cta.js";

export function mountSendBadge(header, ui) {
  const actions = header && header.querySelector ? header.querySelector(".page-actions") : null;
  if (!actions || !ui.el) return;
  const lang = ui.language && ui.language() === "es" ? "es" : "en";
  const badge = dmSendBadge(ui.state && ui.state.autoDm);
  const label = badge.tone === "on" ? (lang === "es" ? "En vivo" : "Live") : (lang === "es" ? "Envío apagado" : badge.label);
  actions.prepend(ui.el("span", { id: "cta-send-state", class: "dm-send-state integration-status " + badge.tone, text: label }));
}
