// Panel side of business access. The server decides (client-dashboard and
// RLS); this only shapes what a tester sees so the panel matches it.

export const TESTER_ROLES = ["tester", "prompt_editor"];

export const ROLE_OPTIONS = [
  {
    id: "tester",
    label: { en: "Tester", es: "Tester" },
    hint: { en: "Reads the setter prompt and uses the practice chat.", es: "Lee el prompt del setter y usa el chat de práctica." }
  },
  {
    id: "prompt_editor",
    label: { en: "Tester + prompt edits", es: "Tester + editar prompt" },
    hint: { en: "Tester, and can save the setter prompt. Saving changes the live setter.", es: "Tester, y puede guardar el prompt. Guardar cambia el setter en vivo." }
  },
  {
    id: "editor",
    label: { en: "Editor", es: "Editor" },
    hint: { en: "Full panel except team and owner settings.", es: "Todo el panel salvo el equipo y los ajustes del dueño." }
  }
];

export function isTesterRole(role) {
  return TESTER_ROLES.includes(role);
}

// The role this person has on one business, as the panel should treat it.
// Admin and owner always win over a member row.
export function panelRole({ isAdmin, userId, business, member }) {
  if (isAdmin) return "admin";
  if (business && userId && business.owner_id === userId) return "owner";
  if (business && business.tester_role && isTesterRole(business.tester_role)) return business.tester_role;
  if (member && member.status === "active") return member.role || "viewer";
  return "viewer";
}

export function panelAbilities(role) {
  const full = role === "admin" || role === "owner" || role === "editor";
  return {
    testerMode: isTesterRole(role),
    canEdit: full,
    canEditPrompt: full || role === "prompt_editor",
    canManageTeam: role === "admin" || role === "owner"
  };
}

// Testers see one page: the Agentic Setter.
export function testerTab() {
  return "setter";
}

export function navGroupsFor(groups, testerMode) {
  if (!testerMode) return groups;
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.tab === "setter") }))
    .filter((group) => group.items.length);
}

// Merge businesses the person can only test into the list RLS returned.
export function mergeTesterBusinesses(listed, testerRows) {
  const rows = Array.isArray(listed) ? listed.slice() : [];
  const seen = new Set(rows.map((row) => row.id));
  (Array.isArray(testerRows) ? testerRows : []).forEach((row) => {
    if (!row || !row.business_id || seen.has(row.business_id)) return;
    if (!isTesterRole(row.role)) return;
    seen.add(row.business_id);
    rows.push({ id: row.business_id, name: row.name || "Business", owner_id: null, tester_role: row.role, created_at: row.created_at || null });
  });
  return rows;
}

// Only open an empty business of their own when the person has nothing else.
export function shouldOpenOwnWorkspace(rows, userId) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.some((row) => row.owner_id && row.owner_id === userId)) return false;
  if (list.some((row) => isTesterRole(row.tester_role))) return false;
  return true;
}

export function roleText(role, language) {
  const option = ROLE_OPTIONS.find((item) => item.id === role);
  if (option) return option.label[language === "es" ? "es" : "en"];
  if (role === "owner") return language === "es" ? "Dueño" : "Owner";
  if (role === "admin") return "Admin";
  if (role === "viewer") return language === "es" ? "Lector" : "Viewer";
  return language === "es" ? "Miembro" : "Member";
}

// Team join link. Only the owner sees or changes it, and it joins as Tester
// unless the owner picked another role for it.
export const JOIN_ROLE_DEFAULT = "tester";

export function joinRole(role) {
  return ROLE_OPTIONS.some((option) => option.id === role) ? role : JOIN_ROLE_DEFAULT;
}

export function joinLinkUrl(origin, code) {
  const value = String(code || "").trim();
  if (!/^[0-9a-f]{24}$/.test(value)) return "";
  return String(origin || "") + "/signup/?join=" + encodeURIComponent(value);
}

export function joinLinkNote(role, language) {
  const es = language === "es";
  const label = roleText(joinRole(role), es ? "es" : "en");
  return es
    ? "Quien abra este enlace e inicie sesión entra como " + label + "."
    : "Anyone who opens this link and signs in joins as " + label + ".";
}
