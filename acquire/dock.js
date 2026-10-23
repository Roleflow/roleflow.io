import {
  SIDEBAR_MOBILE_QUERY,
  drawerRequested,
  persistExpanded,
  readExpanded,
  toggleExpanded,
  toggleLabel
} from "./sidebar-state.js";

function safeStorage() {
  try {
    return localStorage;
  } catch (_error) {
    return null;
  }
}

export function bindSidebar({ isMobile } = {}) {
  const side = document.getElementById("app-side");
  const toggle = document.getElementById("side-toggle");
  const backdrop = document.getElementById("nav-backdrop");
  const mobileQuery = window.matchMedia(SIDEBAR_MOBILE_QUERY);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mobile = typeof isMobile === "function" ? isMobile : () => mobileQuery.matches;
  if (!side || !toggle) return { setDrawer() {}, isMobile: mobile };

  let expanded = readExpanded(safeStorage());
  const tip = document.createElement("div");
  tip.className = "side-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);

  function syncMotion() {
    document.body.classList.toggle("reduce-motion", reduce.matches);
  }

  function syncChrome() {
    const collapsed = document.documentElement.classList.contains("side-collapsed");
    const onMobile = mobile();
    const drawer = document.body.classList.contains("panel-open");
    const iconMode = collapsed && !onMobile;
    const label = toggleLabel({ expanded: !collapsed, mobile: onMobile, drawerOpen: drawer });
    toggle.setAttribute("aria-expanded", onMobile ? (drawer ? "true" : "false") : (collapsed ? "false" : "true"));
    toggle.setAttribute("aria-label", label);
    toggle.dataset.tip = collapsed ? "Expand sidebar" : "Collapse sidebar";
    const menu = document.getElementById("nav-toggle");
    if (menu) {
      const menuLabel = toggleLabel({ expanded: true, mobile: true, drawerOpen: drawer });
      menu.setAttribute("aria-expanded", drawer ? "true" : "false");
      menu.setAttribute("aria-controls", "app-side");
      menu.setAttribute("aria-label", menuLabel);
      menu.textContent = drawer ? "Close" : "Menu";
    }
    document.querySelectorAll(".nav-group").forEach((group) => {
      const head = group.querySelector(".nav-group-toggle");
      const items = group.querySelector(".nav-group-items");
      const groupClosed = group.classList.contains("is-collapsed");
      if (head) {
        if (iconMode) {
          head.tabIndex = -1;
          head.setAttribute("aria-hidden", "true");
        } else {
          head.tabIndex = 0;
          head.removeAttribute("aria-hidden");
        }
      }
      if (items) {
        if (groupClosed && !iconMode) items.setAttribute("inert", "");
        else items.removeAttribute("inert");
      }
    });
    const biz = document.getElementById("panel-business");
    if (biz) {
      if (iconMode) biz.setAttribute("inert", "");
      else biz.removeAttribute("inert");
    }
    const brand = side.querySelector(".side-brand");
    if (brand) {
      if (iconMode) {
        brand.tabIndex = -1;
        brand.setAttribute("aria-hidden", "true");
      } else {
        brand.removeAttribute("tabindex");
        brand.removeAttribute("aria-hidden");
      }
    }
    if (!iconMode) tip.hidden = true;
  }

  function applyExpanded(next, persist) {
    expanded = Boolean(next);
    document.documentElement.classList.toggle("side-collapsed", !expanded);
    document.body.classList.toggle("side-collapsed", !expanded);
    if (persist) persistExpanded(safeStorage(), expanded);
    syncChrome();
  }

  function setDrawer(open) {
    const show = drawerRequested(open, mobile());
    document.body.classList.toggle("panel-open", show);
    document.body.classList.toggle("nav-open", show);
    if (backdrop) backdrop.hidden = !show;
    syncChrome();
    if (show) side.querySelector(".side-nav a")?.focus();
  }

  function showTip(target) {
    if (!document.documentElement.classList.contains("side-collapsed") || mobile()) return;
    const text = target && target.dataset ? target.dataset.tip : "";
    if (!text) return;
    const rect = target.getBoundingClientRect();
    tip.textContent = text;
    tip.hidden = false;
    tip.style.left = Math.round(rect.right + 10) + "px";
    tip.style.top = Math.round(rect.top + rect.height / 2) + "px";
  }

  syncMotion();
  reduce.addEventListener("change", syncMotion);
  applyExpanded(expanded, false);

  toggle.addEventListener("click", () => {
    if (mobile()) {
      setDrawer(false);
      document.getElementById("nav-toggle")?.focus();
      return;
    }
    applyExpanded(toggleExpanded(expanded), true);
    tip.hidden = true;
  });

  if (backdrop) backdrop.addEventListener("click", () => {
    setDrawer(false);
    document.getElementById("nav-toggle")?.focus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mobile() && document.body.classList.contains("panel-open")) {
      const desk = document.getElementById("agent-drawer");
      if (desk && !desk.hidden) return;
      setDrawer(false);
      document.getElementById("nav-toggle")?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (!side.contains(document.activeElement)) return;
    const links = [...side.querySelectorAll("a[data-tab]")].filter((link) => !link.closest("[inert]"));
    const index = links.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next = links[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) next.focus();
  });

  side.addEventListener("pointerover", (event) => {
    const item = event.target.closest("[data-tip]");
    if (!item || !side.contains(item)) return;
    showTip(item);
  });
  side.addEventListener("pointerout", (event) => {
    const item = event.target.closest("[data-tip]");
    if (!item) return;
    if (event.relatedTarget && item.contains(event.relatedTarget)) return;
    tip.hidden = true;
  });
  side.addEventListener("focusin", (event) => {
    const item = event.target.closest("[data-tip]");
    if (item) showTip(item);
  });
  side.addEventListener("focusout", () => {
    tip.hidden = true;
  });

  document.addEventListener("roleflow-nav", syncChrome);
  mobileQuery.addEventListener("change", () => {
    setDrawer(false);
    syncChrome();
  });

  return { setDrawer, isMobile: mobile };
}
