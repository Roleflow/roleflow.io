// ES256 sessions for one outreacher machine. The private key stays in the
// function environment. The machine never receives it.

const TEXT = new TextEncoder();

export const TOKEN_TTL_SECONDS = 60 * 60;

export function bytesToB64url(bytes) {
  let bin = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const byte of view) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function b64urlToBytes(value) {
  const text = String(value || "");
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function pemBody(pem) {
  return String(pem || "").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
}

export function pemToBytes(pem) {
  return b64urlToBytes(pemBody(pem).replace(/\+/g, "-").replace(/\//g, "_"));
}

export async function importPrivateKey(pem) {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(pem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

export async function importPublicKey(pem) {
  return crypto.subtle.importKey(
    "spki",
    pemToBytes(pem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", TEXT.encode(String(value || "")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToB64url(bytes);
}

export function safeEqual(leftValue, rightValue) {
  const left = String(leftValue || "");
  const right = String(rightValue || "");
  if (!left || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

export async function signJwt(payload, privatePem) {
  const header = { alg: "ES256", typ: "JWT", kid: "outreacher-1" };
  const unsigned = bytesToB64url(TEXT.encode(JSON.stringify(header))) + "." + bytesToB64url(TEXT.encode(JSON.stringify(payload)));
  const key = await importPrivateKey(privatePem);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, TEXT.encode(unsigned));
  return unsigned + "." + bytesToB64url(new Uint8Array(signature));
}

export async function verifyJwt(token, publicPem, now) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  let header;
  let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch (_error) {
    return { ok: false, reason: "malformed" };
  }
  if (!header || header.alg !== "ES256" || header.kid !== "outreacher-1") return { ok: false, reason: "malformed" };
  const key = await importPublicKey(publicPem);
  const signed = TEXT.encode(parts[0] + "." + parts[1]);
  const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64urlToBytes(parts[2]), signed);
  if (!valid) return { ok: false, reason: "signature" };
  const clock = now instanceof Date ? now.getTime() : new Date(now || Date.now()).getTime();
  if (payload.iss !== "roleflow-outreacher" || payload.aud !== "authenticated" || payload.role !== "outreacher") {
    return { ok: false, reason: "claims" };
  }
  if (!payload.machine_id || !payload.business_id || payload.sub !== payload.machine_id) return { ok: false, reason: "claims" };
  if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= clock) return { ok: false, reason: "expired" };
  if (payload.exp - payload.iat !== TOKEN_TTL_SECONDS) return { ok: false, reason: "ttl" };
  return { ok: true, claims: payload };
}

export async function signMachineToken({ privateKey, businessId, machineId, now }) {
  const clock = now instanceof Date ? now : new Date(now || Date.now());
  const iat = Math.floor(clock.getTime() / 1000);
  return signJwt({
    iss: "roleflow-outreacher",
    aud: "authenticated",
    role: "outreacher",
    sub: machineId,
    business_id: businessId,
    machine_id: machineId,
    jti: randomToken(),
    iat,
    exp: iat + TOKEN_TTL_SECONDS
  }, privateKey);
}
