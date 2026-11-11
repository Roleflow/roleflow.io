// roleflow-hooks "invite" action: resend the email for an invite the caller
// already created. The caller must be able to manage the team of that
// business, the invite must belong to that business and still be open, and
// the email always goes to the address on the invite row, never to an address
// from the request body.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function inviteRequest(body) {
  const businessId = String(body && body.business_id || "").trim();
  const token = String(body && body.token || "").trim();
  if (!UUID.test(businessId)) return { ok: false, status: 400, error: "That business was not found." };
  if (token.length < 16 || token.length > 200 || /\s/.test(token)) return { ok: false, status: 400, error: "That invite was not found." };
  return { ok: true, businessId, token };
}

// row: the acq_invites row read with the caller's own client (RLS applies).
export function openInvite(row, businessId, token, now = Date.now()) {
  if (!row || row.business_id !== businessId || row.token !== token) return { ok: false, status: 404, error: "That invite was not found." };
  if (row.accepted_at) return { ok: false, status: 409, error: "That invite was already accepted." };
  if (row.expires_at && Date.parse(row.expires_at) <= now) return { ok: false, status: 410, error: "That invite has expired. Create a new one." };
  const email = String(row.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, status: 400, error: "That invite has no valid email." };
  return { ok: true, email };
}

export function inviteMail(email, token) {
  const link = "https://www.roleflow.io/signup/?invite=" + encodeURIComponent(token);
  return {
    to: [email],
    subject: "You are invited to a Roleflow business",
    text: "Open this link to join: " + link
  };
}

// Best effort, per function instance: at most `limit` sends per caller per
// window. It slows a script down; it is not a global quota.
export function rateLimiter(limit = 5, windowMs = 10 * 60 * 1000) {
  const hits = new Map();
  return function allow(key, now = Date.now()) {
    const recent = (hits.get(key) || []).filter((at) => now - at < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.delete(hits.keys().next().value);
    return true;
  };
}
