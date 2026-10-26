export const SECTION_COPY = {
  en: {
    performanceTitle: "Performance",
    performanceBody: "Where leads started: story, post, reel, ad, or a keyword you name.",
    performanceEmpty: "No origin is recorded for this range yet.",
    assistantTitle: "Roleflow Assistant",
    assistantBody: "Ask about this business. Answers stay on the numbers and settings stored here.",
    assistantEmpty: "Ask how a page works, what a number means, or where to change a setting. Answers use this business only.",
    chatsTitle: "Chats",
    chatsBody: "Conversations stored for this business. Nothing on this page is sent.",
    chatsEmpty: "No chats yet.",
    chatsNone: "No chats match.",
    chatsPick: "Choose a chat.",
    opportunitiesTitle: "Opportunities",
    opportunitiesBody: "Leads stored for this business, from open through postponed.",
    opportunitiesEmpty: "No opportunities yet. They appear when a conversation is stored. Nothing here is a sample.",
    opportunitiesNone: "No leads match these filters.",
    calendarTitle: "Calendar",
    calendarBody: "Booked calls stored for this business.",
    calendarEmpty: "No bookings yet.",
    calendarOff: "Google Calendar is not connected yet. Connect it from Settings.",
    calendarOn: "Connected",
    sopsTitle: "SOPs",
    sopsBody: "The brief every agent reads. Saving keeps a version.",
    contentTitle: "Content",
    contentBody: "Files and links an agent can send. Images up to 8 MB, audio up to 20 MB, video up to 50 MB.",
    contentEmpty: "No content yet.",
    loadError: "This section could not be loaded.",
    retry: "Try again"
  },
  es: {
    performanceTitle: "Rendimiento",
    performanceBody: "De dónde salieron los leads: historia, publicación, reel, anuncio o una palabra que nombres.",
    performanceEmpty: "Todavía no hay un origen en este rango.",
    assistantTitle: "Asistente Roleflow",
    assistantBody: "Pregunta por este negocio. Las respuestas usan solo los números y ajustes guardados aquí.",
    assistantEmpty: "Pregunta cómo funciona una página, qué significa un número o dónde cambiar un ajuste. Las respuestas usan solo este negocio.",
    chatsTitle: "Chats",
    chatsBody: "Conversaciones guardadas de este negocio. Desde esta página no se envía nada.",
    chatsEmpty: "Todavía no hay chats.",
    chatsNone: "Ningún chat coincide.",
    chatsPick: "Elige un chat.",
    opportunitiesTitle: "Oportunidades",
    opportunitiesBody: "Leads guardados de este negocio, de abierto a pospuesto.",
    opportunitiesEmpty: "Todavía no hay oportunidades. Aparecen cuando se guarda una conversación. Aquí no hay datos de ejemplo.",
    opportunitiesNone: "Ningún lead coincide con estos filtros.",
    calendarTitle: "Calendario",
    calendarBody: "Llamadas agendadas de este negocio.",
    calendarEmpty: "Todavía no hay reservas.",
    calendarOff: "Google Calendar todavía no está conectado. Conéctalo en Ajustes.",
    calendarOn: "Conectado",
    sopsTitle: "SOPs",
    sopsBody: "El brief que lee cada agente. Cada guardado conserva una versión.",
    contentTitle: "Contenido",
    contentBody: "Archivos y enlaces que un agente puede enviar. Imágenes hasta 8 MB, audio hasta 20 MB, vídeo hasta 50 MB.",
    contentEmpty: "Todavía no hay contenido.",
    loadError: "No se pudo cargar esta sección.",
    retry: "Reintentar"
  }
};

export function sectionText(language, key) {
  const pack = SECTION_COPY[language === "es" ? "es" : "en"];
  return pack[key] || SECTION_COPY.en[key] || "";
}

export function sectionAlert(ui, key) {
  const errors = (ui.state && ui.state.sectionErrors) || {};
  if (!errors[key]) return null;
  const language = ui.language ? ui.language() : "en";
  const box = ui.el("div", { class: "section-error", role: "alert" });
  box.append(ui.el("p", { text: sectionText(language, "loadError") }));
  if (ui.bootBusiness && ui.state && ui.state.businessId) {
    box.append(ui.button(sectionText(language, "retry"), () => ui.bootBusiness(ui.state.businessId)));
  }
  return box;
}

export function sectionEmpty(ui, key) {
  const language = ui.language ? ui.language() : "en";
  return ui.el("p", { class: "section-empty", role: "status", text: sectionText(language, key) });
}
