// Username is not a TailorTalk lead field. On Instagram, lead_contact is the handle.

export function usernameOf(lead) {
  const explicit = textOrNull(lead?.username || lead?.instagram_username || lead?.ig_username || lead?.instagram_handle || lead?.handle);
  if (explicit) return explicit.replace(/^@+/, "");
  if (!isInstagram(lead)) return null;
  const contact = textOrNull(lead?.lead_contact);
  if (!contact || contact.includes("*")) return null;
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
