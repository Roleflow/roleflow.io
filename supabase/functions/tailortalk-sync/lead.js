// username is its own Get Leads field. On Instagram, lead_contact is often null.
// A numeric lead_contact is an Instagram user id, not a handle.

export function usernameOf(lead) {
  const explicit = textOrNull(lead?.username || lead?.instagram_username || lead?.ig_username || lead?.instagram_handle || lead?.handle);
  if (explicit && !/^\d+$/.test(explicit)) return explicit.replace(/^@+/, "");
  if (!isInstagram(lead)) return null;
  const contact = textOrNull(lead?.lead_contact);
  if (!contact || contact.includes("*") || /^\d+$/.test(contact)) return null;
  return contact.replace(/^@+/, "");
}

function isInstagram(lead) {
  return /instagram|insta|(^|[^a-z])ig([^a-z]|$)/i.test(String(lead?.integration || ""));
}

function textOrNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}
