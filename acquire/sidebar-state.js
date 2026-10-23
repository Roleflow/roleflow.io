export const SIDEBAR_STORAGE_KEY = "roleflow.sidebar";
export const SIDEBAR_GROUPS_KEY = "roleflow.sidebar.groups";
export const SIDEBAR_LEGACY_KEY = "rf-sidebar";
export const SIDEBAR_COLLAPSED_PX = 72;
export const SIDEBAR_EXPANDED_PX = 264;
export const SIDEBAR_MOTION_MS = 280;
export const SIDEBAR_MOBILE_QUERY = "(max-width: 767px)";

export function readExpanded(storage) {
  if (!storage || typeof storage.getItem !== "function") return true;
  try {
    const value = storage.getItem(SIDEBAR_STORAGE_KEY);
    if (value === "collapsed") return false;
    if (value === "expanded") return true;
    const legacy = storage.getItem(SIDEBAR_LEGACY_KEY);
    if (legacy === "closed") return false;
    if (legacy === "open") return true;
  } catch (_error) {
    return true;
  }
  return true;
}

export function persistExpanded(storage, expanded) {
  if (!storage || typeof storage.setItem !== "function") return;
  try {
    storage.setItem(SIDEBAR_STORAGE_KEY, expanded ? "expanded" : "collapsed");
  } catch (_error) {
    /* private browsing or a full store */
  }
}

export function readCollapsedGroups(storage) {
  if (!storage || typeof storage.getItem !== "function") return [];
  try {
    const parsed = JSON.parse(storage.getItem(SIDEBAR_GROUPS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item === "string");
  } catch (_error) {
    return [];
  }
}

export function persistCollapsedGroups(storage, ids) {
  if (!storage || typeof storage.setItem !== "function") return;
  try {
    storage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify([...ids]));
  } catch (_error) {
    /* private browsing or a full store */
  }
}

export function toggleExpanded(expanded) {
  return !expanded;
}

export function toggleLabel({ expanded, mobile, drawerOpen }) {
  if (mobile) return drawerOpen ? "Close menu" : "Open menu";
  return expanded ? "Collapse sidebar" : "Expand sidebar";
}

export function drawerRequested(open, mobile) {
  return Boolean(open) && Boolean(mobile);
}
