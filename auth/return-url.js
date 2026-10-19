export const PUBLIC_SITE_ORIGIN = "https://www.roleflow.io";
const DEFAULT_NEXT = "/account/";

function pageOrigin(href) {
  try {
    if (href) return new URL(String(href), PUBLIC_SITE_ORIGIN).origin;
  } catch { /* use the fallback below */ }
  if (typeof location !== "undefined" && location.origin && location.origin !== "null") {
    return location.origin;
  }
  return PUBLIC_SITE_ORIGIN;
}

export function safeNext(raw, href) {
  const value = String(raw ?? "");
  // The URL parser drops tab, CR, and LF, so "/\t/evil.example" is read as "//evil.example".
  if (!value.trim() || /[\u0000-\u001F\u007F]/.test(value) || value.includes("\\")) return DEFAULT_NEXT;
  const base = new URL(pageOrigin(href));
  let url;
  try {
    url = new URL(value, base);
  } catch {
    return DEFAULT_NEXT;
  }
  if (url.origin !== base.origin) return DEFAULT_NEXT;
  const next = url.pathname + url.search + url.hash;
  if (!next.startsWith("/") || next.startsWith("//")) return DEFAULT_NEXT;
  try {
    if (new URL(next, base).origin !== base.origin) return DEFAULT_NEXT;
  } catch {
    return DEFAULT_NEXT;
  }
  return next;
}

export function siteOrigin(href) {
  try {
    const origin = new URL(String(href || ""), PUBLIC_SITE_ORIGIN).origin;
    if (origin === PUBLIC_SITE_ORIGIN || origin === "https://roleflow.io") return PUBLIC_SITE_ORIGIN;
    return origin;
  } catch {
    return PUBLIC_SITE_ORIGIN;
  }
}

export function authReturnUrl(path, next, href) {
  const url = new URL(path || "/signup/", siteOrigin(href));
  url.searchParams.set("next", safeNext(next, href));
  return url.toString();
}
