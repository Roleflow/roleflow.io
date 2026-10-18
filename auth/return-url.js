export const PUBLIC_SITE_ORIGIN = "https://www.roleflow.io";

export function safeNext(raw) {
  const value = String(raw || "");
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("://")) {
    return "/account/";
  }
  return value;
}

export function siteOrigin(href) {
  try {
    const origin = new URL(String(href || ""), PUBLIC_SITE_ORIGIN).origin;
    if (origin === PUBLIC_SITE_ORIGIN || origin === "https://roleflow.io") return PUBLIC_SITE_ORIGIN;
  } catch { /* use the public site */ }
  return PUBLIC_SITE_ORIGIN;
}

export function authReturnUrl(path, next, href) {
  const url = new URL(path || "/signup/", siteOrigin(href));
  url.searchParams.set("next", safeNext(next));
  return url.toString();
}
