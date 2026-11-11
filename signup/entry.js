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

// What the sign-up form asks for. A valid invite or a team join link that is
// on needs no access code and no Instagram handle; the server checks the link
// again when the account is created.
export function signupNeeds({ inviteOk, joinOk } = {}) {
  const linked = Boolean(inviteOk || joinOk);
  return { accessCode: !linked, instagram: !linked };
}

// The metadata sent with supabase.auth.signUp. Only one of invite_token,
// join_code, or access_code is sent.
export function signupMetadata({ name, instagram, accessCode, inviteToken, inviteOk, joinCode, joinOk } = {}) {
  const base = { full_name: String(name || ""), instagram: String(instagram || "") };
  if (inviteOk && inviteToken) return { ...base, invite_token: String(inviteToken) };
  if (joinOk && joinCode) return { ...base, join_code: String(joinCode) };
  return { ...base, access_code: String(accessCode || "") };
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
