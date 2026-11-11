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
