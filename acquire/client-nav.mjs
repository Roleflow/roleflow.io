export const NAV_GROUPS = [
  { id: "insights", label: { en: "Insights", es: "Información" }, items: [
    { tab: "dashboard", icon: "grid", tone: "t1", label: { en: "Dashboard", es: "Panel" } },
    { tab: "performance", icon: "trend", tone: "t3", label: { en: "Performance", es: "Rendimiento" } },
    { tab: "assistant", icon: "clipboard", tone: "t2", label: { en: "Roleflow Assistant", es: "Asistente Roleflow" } }
  ] },
  { id: "crm", label: { en: "CRM", es: "CRM" }, items: [
    { tab: "chats", icon: "inbox", tone: "t2", label: { en: "Chats", es: "Chats" } },
    { tab: "opportunities", icon: "users", tone: "t1", label: { en: "Opportunities", es: "Oportunidades" } },
    { tab: "calendar", icon: "clipboard", tone: "t4", label: { en: "Calendar", es: "Calendario" } }
  ] },
  { id: "strategy", label: { en: "Strategy", es: "Estrategia" }, items: [
    { tab: "sops", icon: "clipboard", tone: "t1", label: { en: "SOPs", es: "SOPs" } },
    { tab: "content", icon: "folder", tone: "t3", label: { en: "Content", es: "Contenido" } },
    { tab: "commentvoice", icon: "send", tone: "t5", label: { en: "Comment voice", es: "Voz en comentarios" } },
    { tab: "voice", icon: "send", tone: "t5", label: { en: "Voice Gen", es: "Voz" } }
  ] },
  { id: "workforce", label: { en: "Agent Workforce", es: "Equipo de agentes" }, items: [
    { tab: "warmer", icon: "users", tone: "t4", label: { en: "Lead Warmer", es: "Calentador" } },
    { tab: "outreacher", icon: "send", tone: "t5", label: { en: "Outreacher", es: "Prospección" } },
    { tab: "setter", icon: "inbox", tone: "t2", label: { en: "Agentic Setter", es: "Setter" } },
    { tab: "followup", icon: "trend", tone: "t3", label: { en: "Follow Up Boss", es: "Seguimiento" } }
  ] },
  { id: "account", label: { en: "Account", es: "Cuenta" }, items: [
    { tab: "settings", icon: "settings", tone: "t1", label: { en: "Settings", es: "Ajustes" } }
  ] }
];

const ALIASES = {
  inbox: "chats",
  pipeline: "opportunities",
  brief: "sops",
  onboarding: "sops",
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
  team: "settings",
  configuration: "settings",
  integrations: "settings",
  instagram: "settings",
  billing: "settings",
  controls: "settings",
  settings: "settings",
  commentvoice: "commentvoice"
};

export function canonicalTab(raw) {
  const name = String(raw || "").split("/")[0];
  if (!name) return "dashboard";
  if (ALIASES[name]) return ALIASES[name];
  const known = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.tab)).concat(["settings"]);
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
