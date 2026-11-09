// Where a signed-in person goes when login has no specific business to open.

export const BUSINESSES_HOME = "/businesses/";

const EXPLICIT_QUERY = ["business", "invite", "onboarding", "intake", "join", "connect", "ig", "built", "editor", "desk", "cta", "sheet"];

export function pageUrl(target) {
  try {
    return new URL(String(target || "/account/"), "https://www.roleflow.io");
  } catch (_error) {
    return new URL("https://www.roleflow.io/account/");
  }
}

export function pathName(url) {
  return String(url.pathname || "/").replace(/\/+$/, "") || "/";
}

export function explicitAcquisition(target) {
  const url = target instanceof URL ? target : pageUrl(target);
  for (const key of EXPLICIT_QUERY) {
    if (url.searchParams.get(key)) return true;
  }
  const hash = url.hash.replace(/^#/, "").split("/")[0];
  return Boolean(hash && hash !== "dashboard");
}

export function postLoginDestination(target) {
  const url = pageUrl(target);
  const path = pathName(url);
  if (path === "/account") return BUSINESSES_HOME;
  if (path === "/account/acquisition" && !explicitAcquisition(url)) return BUSINESSES_HOME;
  return "";
}
