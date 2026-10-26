// Strip the Instagram transport vendor from any string a browser can see.
// Server logs and env names are left alone; call this only on a response.

export function clientSafeText(value) {
  return String(value || "")
    .replace(/https?:\/\/(?:[a-z0-9-]+\.)*zernio\.com\S*/gi, "")
    .replace(/zernio/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}
