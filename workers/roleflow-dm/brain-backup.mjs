// Client-side backup of the browser profile. The key is not stored on the volume.

const TEXT = new TextEncoder();
const HEADER = TEXT.encode("RFBK1");

export async function encryptBackup(bytes, keyB64) {
  const keyBytes = b64ToBytes(keyB64);
  if (keyBytes.length !== 32) throw new Error("The backup key must be 32 bytes.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  const out = new Uint8Array(HEADER.length + iv.length + cipher.length);
  out.set(HEADER, 0);
  out.set(iv, HEADER.length);
  out.set(cipher, HEADER.length + iv.length);
  return out;
}

export async function decryptBackup(bytes, keyB64) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const iv = data.slice(HEADER.length, HEADER.length + 12);
  const cipher = data.slice(HEADER.length + 12);
  const key = await crypto.subtle.importKey("raw", b64ToBytes(keyB64), "AES-GCM", false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher));
}

function b64ToBytes(value) {
  const bin = atob(String(value || ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function backupDue(lastDate, now, timeZone) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now instanceof Date ? now : new Date(now));
  return String(lastDate || "") !== today;
}

export async function uploadEncrypted({ api, bytes, fetchImpl }) {
  const slot = await api.backupSlot();
  if (!slot || slot.ok !== true || !slot.upload_url) return { ok: false, reason: slot && slot.reason || "no_slot" };
  if (/\/rest\/v1\b/i.test(slot.upload_url)) return { ok: false, reason: "refused_data_api" };
  const headers = { "content-type": "application/octet-stream" };
  if (slot.token) headers.authorization = "Bearer " + slot.token;
  const put = await fetchImpl(slot.upload_url, { method: "PUT", headers, body: bytes });
  if (!put || put.ok === false) return { ok: false, reason: "upload_failed" };
  const committed = await api.backupCommit({ path: slot.path });
  if (!committed || committed.ok !== true) return { ok: false, reason: committed && committed.reason || "commit_failed" };
  return { ok: true, path: slot.path };
}
