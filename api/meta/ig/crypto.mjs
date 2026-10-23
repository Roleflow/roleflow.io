// AES-GCM tokens, same layout as the acquisition function: base64(iv).base64(cipher).
// The plaintext token never leaves this module.

export async function encryptToken(plain, keyMaterial) {
  if (!keyMaterial || String(keyMaterial).length < 16) throw new Error("Token key must be at least 16 characters.");
  const key = await aesKey(keyMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(String(plain))));
  return bytesToB64(iv) + "." + bytesToB64(cipher);
}

export async function decryptToken(stored, keyMaterial) {
  const [ivPart, cipherPart] = String(stored || "").split(".");
  if (!ivPart || !cipherPart) throw new Error("Stored token is unreadable.");
  const key = await aesKey(keyMaterial);
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(ivPart) }, key, b64ToBytes(cipherPart));
  return new TextDecoder().decode(clear);
}

async function aesKey(material) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(material || "")));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBytes(value) {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
