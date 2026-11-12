export function inviteDestination(memberData, acqData, acqError) {
  if (memberData) return { ok: true, href: "/account/acquisition/#dashboard" };
  const businessId = acqData && acqData.business_id;
  // Testers land on the businesses page, which lists only what they were given.
  if (businessId && (acqData.role === "tester" || acqData.role === "prompt_editor")) {
    return { ok: true, href: "/businesses/" };
  }
  if (businessId) {
    return {
      ok: true,
      href: "/account/acquisition/?business=" + encodeURIComponent(businessId) + "#dashboard"
    };
  }
  if (acqError) return { ok: false, message: String(acqError) };
  return { ok: false, message: "That invite could not be accepted." };
}

export function joinDestination(data, errorMessage) {
  // A team link joins as Tester by default; testers land on the businesses page.
  if (data && data.ok && data.business_id && (data.role === "tester" || data.role === "prompt_editor")) {
    return { ok: true, href: "/businesses/" };
  }
  if (data && data.ok && data.business_id) {
    return {
      ok: true,
      href: "/account/acquisition/?business=" + encodeURIComponent(data.business_id) + "#dashboard"
    };
  }
  const message = (data && data.error) || errorMessage || "That join link does not match a business.";
  return { ok: false, message: String(message) };
}

// What the sign-up form asks for. Nobody needs an access code. A valid invite
// or a team join link that is on also makes the Instagram handle optional; the
// server checks the link again when the account is created.
export function signupNeeds({ inviteOk, joinOk } = {}) {
  const linked = Boolean(inviteOk || joinOk);
  return { instagram: !linked };
}

// The metadata sent with supabase.auth.signUp: name, Instagram, and at most one
// of invite_token or join_code. No access code is sent.
export function signupMetadata({ name, instagram, inviteToken, inviteOk, joinCode, joinOk } = {}) {
  const base = { full_name: String(name || ""), instagram: String(instagram || "") };
  if (inviteOk && inviteToken) return { ...base, invite_token: String(inviteToken) };
  if (joinOk && joinCode) return { ...base, join_code: String(joinCode) };
  return base;
}

// Sign-up is by invitation only: a valid invite (for that email) or a team join
// link that is on. The sign-up trigger enforces the same rule server-side.
export const INVITE_ONLY_MESSAGE = "Sign-up is by invitation. Ask the business owner for a team link.";

export function signupAllowed({ inviteOk, joinOk } = {}) {
  return Boolean(inviteOk || joinOk);
}

// Why the sign-up form is closed, or "" when it is open.
export function signupClosedReason({ inviteToken, inviteOk, joinCode, joinOk } = {}) {
  if (signupAllowed({ inviteOk, joinOk })) return "";
  if (inviteToken) return "This invite link is not valid or has expired. Ask the business owner for a new one, or log in if you already have an account.";
  if (joinCode) return "This team link is turned off or was replaced. Ask the business owner for a new one, or log in if you already have an account.";
  return INVITE_ONLY_MESSAGE;
}

export function linkRoleLabel(role) {
  if (role === "editor") return "Editor";
  if (role === "prompt_editor") return "Tester + prompt edits";
  if (role === "tester") return "Tester";
  if (role === "viewer") return "Viewer";
  return "a member";
}

// Where the confirmation email brings a new account back to.
export function signupReturnPath({ inviteToken, inviteOk, joinCode, joinOk } = {}) {
  if (inviteOk && inviteToken) return "/signup/?mode=login&invite=" + encodeURIComponent(inviteToken);
  if (joinOk && joinCode) return "/signup/?mode=login&join=" + encodeURIComponent(joinCode);
  return "/signup/?mode=login";
}
