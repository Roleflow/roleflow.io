export function inviteDestination(memberData, acqData, acqError) {
  if (memberData) return { ok: true, href: "/account/acquisition/#dashboard" };
  const businessId = acqData && acqData.business_id;
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
  if (data && data.ok && data.business_id) {
    return {
      ok: true,
      href: "/account/acquisition/?business=" + encodeURIComponent(data.business_id) + "#dashboard"
    };
  }
  const message = (data && data.error) || errorMessage || "That join link does not match a business.";
  return { ok: false, message: String(message) };
}
