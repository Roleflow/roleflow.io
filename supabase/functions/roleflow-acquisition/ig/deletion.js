import { createHmac, timingSafeEqual } from "node:crypto";

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

export function signRequest(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return sig + "." + body;
}

export function parseSignedRequest(signed, secret) {
  const [encodedSig, payload] = String(signed || "").split(".");
  if (!encodedSig || !payload || !secret) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(encodedSig, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
