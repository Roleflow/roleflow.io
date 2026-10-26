export const NAV_GROUPS = [
  { id: "business", label: { en: "Business panel", es: "Panel del negocio" }, items: [
    { tab: "home", icon: "grid", tone: "t1", label: { en: "Home", es: "Inicio" } },
    { tab: "dashboard", icon: "chart", tone: "t2", label: { en: "Dashboard", es: "Panel" } },
    { tab: "assistant", icon: "clipboard", tone: "t3", label: { en: "Roleflow Assistant", es: "Asistente Roleflow" } }
  ] },
  { id: "strategy", label: { en: "Strategy", es: "Estrategia" }, items: [
    { tab: "sops", icon: "clipboard", tone: "t4", label: { en: "SOPs", es: "SOPs" } },
    { tab: "content", icon: "folder", tone: "t5", label: { en: "Content", es: "Contenido" } },
    { tab: "commentvoice", icon: "send", tone: "t6", label: { en: "Comment voice", es: "Voz en comentarios" } },
    { tab: "followup", icon: "trend", tone: "t7", label: { en: "Follow-ups", es: "Seguimientos" } }
  ] },
  { id: "conversations", label: { en: "Conversations", es: "Conversaciones" }, items: [
    { tab: "chats", icon: "inbox", tone: "t2", label: { en: "Chats", es: "Chats" } },
    { tab: "opportunities", icon: "users", tone: "t1", label: { en: "Opportunities", es: "Oportunidades" } },
    { tab: "calendar", icon: "clipboard", tone: "t4", label: { en: "Calendar", es: "Calendario" } }
  ] },
  { id: "analytics", label: { en: "Analytics", es: "Analítica" }, items: [
    { tab: "performance", icon: "trend", tone: "t3", label: { en: "Performance", es: "Rendimiento" } }
  ] },
  { id: "settings", label: { en: "Settings", es: "Ajustes" }, items: [
    { tab: "settings", icon: "settings", tone: "t5", label: { en: "Settings", es: "Ajustes" } },
    { tab: "team", icon: "userplus", tone: "t6", label: { en: "Team", es: "Equipo" } },
    { tab: "instagram", icon: "link", tone: "t7", label: { en: "Business & Instagram", es: "Negocio e Instagram" } },
    { tab: "billing", icon: "trend", tone: "t2", label: { en: "Billing", es: "Facturación" } }
  ] }
];

const ALIASES = {
  inbox: "chats",
  pipeline: "opportunities",
  brief: "sops",
  prompts: "setter",
  inbound: "setter",
  outbound: "outreacher",
  agents: "outreacher",
  overview: "outreacher",
  followups: "followup",
  reminders: "followup",
  ctas: "setter",
  stats: "performance",
  reports: "performance",
  links: "settings",
  configuration: "settings",
  integrations: "instagram",
  controls: "settings",
  settings: "settings",
  commentvoice: "commentvoice"
};

const EXTRA_TABS = ["voice", "warmer", "outreacher", "setter", "onboarding"];

export function canonicalTab(raw) {
  const name = String(raw || "").split("/")[0];
  if (!name) return "dashboard";
  if (name === "onboarding") return "onboarding";
  if (ALIASES[name]) return ALIASES[name];
  const known = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.tab)).concat(EXTRA_TABS);
  return known.includes(name) ? name : "dashboard";
}

export function navLabel(item, language) {
  const copy = item && item.label;
  if (!copy) return "";
  return copy[language] || copy.en;
}

export function readLanguage(storage) {
  try {
    const value = storage && storage.getItem("roleflow.lang");
    return value === "es" ? "es" : "en";
  } catch (_error) {
    return "en";
  }
}

export function writeLanguage(storage, language) {
  const next = language === "es" ? "es" : "en";
  try {
    if (storage) storage.setItem("roleflow.lang", next);
  } catch (_error) {
    /* private mode */
  }
  return next;
}
