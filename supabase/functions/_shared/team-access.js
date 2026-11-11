// Who may do what on one business, for client-dashboard.
//
// Roles on a business (acq_members.role, plus owner/admin):
//   admin, owner, editor  full panel (owner and admin also manage the team)
//   prompt_editor         practice chat, read and save the setter prompt
//   tester                practice chat, read the setter prompt
// Testers never reach live switches, Auto-DMs, Instagram, billing, follow-up
// rules, onboarding, booking link, or any other business. That is enforced
// here per action and by RLS (testers are not in acq_can_read/acq_can_edit).

export const TESTER_ROLES = ["tester", "prompt_editor"];
export const INVITE_ROLES = ["tester", "prompt_editor", "editor"];

// Actions a tester may call. Everything not listed needs full edit access.
const TEST_ACTIONS = new Set(["load", "preview_setter", "transcribe_trial"]);
const PROMPT_ACTIONS = new Set(["save_prompt", "restore_prompt"]);
const TEAM_ACTIONS = new Set(["team_list", "team_invite", "team_remove"]);

export function normalizeAccess(raw) {
  const row = raw && typeof raw === "object" ? raw : {};
  const role = typeof row.role === "string" ? row.role : null;
  const canEdit = row.can_edit === true;
  return {
    role,
    canEdit,
    canTest: canEdit || row.can_test === true,
    canEditPrompt: canEdit || row.can_edit_prompt === true,
    canManageTeam: row.can_manage_team === true,
    tester: !canEdit && TESTER_ROLES.includes(role)
  };
}

// Before the migration is applied acq_access does not exist. Fall back to the
// old single check so the function keeps working exactly as before.
export function legacyAccess(canEdit) {
  return normalizeAccess({ role: canEdit ? "editor" : null, can_edit: canEdit === true });
}

export function actionNeeds(action) {
  if (TEST_ACTIONS.has(action)) return "test";
  if (PROMPT_ACTIONS.has(action)) return "prompt";
  if (TEAM_ACTIONS.has(action)) return "team";
  return "edit";
}

export function mayRun(access, action) {
  const need = actionNeeds(action);
  if (need === "test") return access.canTest;
  if (need === "prompt") return access.canEditPrompt;
  if (need === "team") return access.canManageTeam;
  return access.canEdit;
}

export function denyMessage(access, action) {
  const need = actionNeeds(action);
  if (need === "team") return "Only the business owner can manage access.";
  if (access.tester) return "Testers can use the practice chat only.";
  return "You can't edit this business.";
}

// What load returns to a tester: the prompt to read and test, nothing else.
export function testerLoadView(prompt, testedAt, language, access) {
  return {
    ok: true,
    access: accessView(access),
    switches: [],
    prompt: String(prompt || ""),
    tested_at: testedAt || null,
    language: language === "es" ? "es" : "en"
  };
}

export function accessView(access) {
  return {
    role: access.role,
    can_edit: access.canEdit,
    can_test: access.canTest,
    can_edit_prompt: access.canEditPrompt,
    can_manage_team: access.canManageTeam
  };
}

export function normalizeInvite(body) {
  const email = String(body && body.email || "").trim().toLowerCase().slice(0, 254);
  const role = String(body && body.role || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (!INVITE_ROLES.includes(role)) return { ok: false, error: "Choose Tester, Tester + prompt edits, or Editor." };
  return { ok: true, email, role };
}

export function roleLabel(role) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  if (role === "editor") return "Editor";
  if (role === "viewer") return "Viewer";
  if (role === "prompt_editor") return "Tester + prompt edits";
  if (role === "tester") return "Tester";
  return "Member";
}

// Who the owner may remove: anyone but the business owner.
export function mayRemoveMember(member, ownerId) {
  if (!member || !member.user_id) return false;
  if (member.role === "owner") return false;
  if (ownerId && member.user_id === ownerId) return false;
  return true;
}

export function inviteEmail(businessName, role, link, existing) {
  const name = String(businessName || "a business").slice(0, 80);
  const label = roleLabel(role);
  const what = role === "editor"
    ? "You can open and edit this business in the Roleflow panel."
    : role === "prompt_editor"
      ? "You can read and edit the Agentic Setter prompt and try it in the practice chat. The practice chat never sends anything to Instagram."
      : "You can read the Agentic Setter prompt and try it in the practice chat. The practice chat never sends anything to Instagram.";
  const step = existing
    ? "Log in with this email to open it: " + link
    : "Open this link to create your account with this email. You do not need an access code: " + link;
  return {
    subject: "You have access to " + name + " on Roleflow",
    text: [
      "You have been given " + label + " access to " + name + " on Roleflow.",
      "",
      what,
      "",
      step,
      existing ? "" : "The link expires in 14 days."
    ].filter((line, index, list) => !(line === "" && index === list.length - 1)).join("\n")
  };
}

export function inviteToken(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Open invites, one per email: the newest row wins. Older duplicates (the
// panel used to create one per click) stay in the table but are not listed.
export function dedupeInvites(rows, now = Date.now()) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && !row.accepted_at && (!row.expires_at || Date.parse(row.expires_at) > now))
    .slice()
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .filter((row) => {
      const key = String(row.email || "").trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// When the owner invites an email that already has an open invite, reuse the
// newest one instead of adding another row.
export function reusableInvite(rows, email, now = Date.now()) {
  const key = String(email || "").trim().toLowerCase();
  return dedupeInvites(rows, now).find((row) => String(row.email || "").trim().toLowerCase() === key) || null;
}
