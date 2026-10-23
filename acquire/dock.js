export function bindDock({ setOpen, isMobile }) {
  const rail = document.getElementById("icon-rail");
  const panel = document.getElementById("slide-panel");
  const pin = document.getElementById("rail-toggle");
  const menuPin = document.getElementById("menu-pin");
  if (!rail || !panel || !pin) return;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coarse = window.matchMedia("(pointer: coarse)");
  const scales = new WeakMap();
  const velocity = new WeakMap();
  const storeKey = "rf-sidebar";
  let pinned = false;
  let suppressHover = 0;
  let pointerY = null;
  let hovering = false;
  let raf = 0;
  let closeTimer = 0;
  let openTimer = 0;
  let lastX = 999;

  function syncMotion() {
    document.body.classList.toggle("reduce-motion", reduce.matches);
  }
  syncMotion();
  reduce.addEventListener("change", syncMotion);

  function nodes() {
    return [...rail.querySelectorAll(".dock-scale")];
  }

  function tick() {
    raf = 0;
    let moving = false;
    nodes().forEach((node) => {
      const parent = node.closest("a, button");
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      let desired = 1;
      if (hovering && pointerY != null && !reduce.matches && !coarse.matches && !document.body.classList.contains("panel-open")) {
        const dy = pointerY - center;
        const mag = Math.exp(-(dy * dy) / (2 * 46 * 46));
        desired = 1 + 0.9 * mag;
      }
      const prev = scales.get(node) ?? 1;
      const vel = velocity.get(node) ?? 0;
      const nextVel = reduce.matches ? desired - prev : vel * 0.62 + (desired - prev) * 0.16;
      const next = reduce.matches ? desired : prev + nextVel;
      scales.set(node, next);
      velocity.set(node, nextVel);
      if (Math.abs(next - desired) > 0.004 || Math.abs(nextVel) > 0.004) moving = true;
      const dy = pointerY == null ? 0 : pointerY - center;
      const away = hovering && pointerY != null && !reduce.matches && !document.body.classList.contains("panel-open") ? -Math.sign(dy) * Math.abs(next - 1) * 34 : 0;
      const scale = Math.abs(next - 1) < 0.004 ? 1 : next;
      node.style.transform = scale === 1 && Math.abs(away) < 0.4 ? "" : "translateY(" + away.toFixed(2) + "px) scale(" + scale.toFixed(3) + ")";
    });
    if (moving) raf = requestAnimationFrame(tick);
  }

  function poke() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function zone() {
    return document.body.classList.contains("panel-open") ? 288 : 84;
  }

  function readStored() {
    try { return localStorage.getItem(storeKey); } catch (_error) { return null; }
  }

  function writeStored(open) {
    if (isMobile()) return;
    try { localStorage.setItem(storeKey, open ? "open" : "closed"); } catch (_error) { /* private browsing */ }
  }

  function armOpen() {
    if (Date.now() < suppressHover) return;
    if (isMobile() || pinned || coarse.matches || document.body.classList.contains("panel-open")) return;
    if (openTimer) return;
    clearTimeout(closeTimer);
    closeTimer = 0;
    openTimer = setTimeout(() => {
      openTimer = 0;
      if (isMobile() || pinned || document.body.classList.contains("panel-open")) return;
      if (lastX > 84 && !rail.contains(document.activeElement)) return;
      hovering = false;
      pointerY = null;
      poke();
      setOpen(true);
    }, reduce.matches ? 0 : 320);
  }

  function cancelOpen() {
    clearTimeout(openTimer);
    openTimer = 0;
  }

  function scheduleClose() {
    if (isMobile() || pinned || closeTimer) return;
    closeTimer = setTimeout(() => {
      closeTimer = 0;
      if (pinned || lastX <= zone()) return;
      hovering = false;
      pointerY = null;
      poke();
      setOpen(false);
      syncPin();
    }, reduce.matches ? 0 : 220);
  }

  function syncPin() {
    const open = document.body.classList.contains("panel-open");
    const label = open ? "Collapse sidebar" : "Expand sidebar";
    [pin, menuPin].forEach((button) => {
      if (!button) return;
      button.setAttribute("aria-pressed", pinned ? "true" : "false");
      button.dataset.tip = label;
      button.title = label;
      button.setAttribute("aria-label", label);
    });
    document.body.classList.toggle("panel-pinned", pinned);
  }

  function expandSidebar() {
    pinned = true;
    writeStored(true);
    clearTimeout(closeTimer);
    closeTimer = 0;
    cancelOpen();
    setOpen(true);
    syncPin();
  }

  function collapseSidebar() {
    pinned = false;
    writeStored(false);
    suppressHover = Date.now() + 450;
    clearTimeout(closeTimer);
    closeTimer = 0;
    cancelOpen();
    setOpen(false);
    syncPin();
  }

  function togglePin() {
    if (isMobile()) {
      setOpen(!document.body.classList.contains("panel-open"));
      return;
    }
    if (document.body.classList.contains("panel-open") && pinned) collapseSidebar();
    else expandSidebar();
  }

  rail.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" || coarse.matches || isMobile()) return;
    if (document.body.classList.contains("panel-open")) return;
    hovering = true;
    pointerY = event.clientY;
    lastX = event.clientX;
    poke();
    armOpen();
  });

  document.addEventListener("pointermove", (event) => {
    if (isMobile() || coarse.matches || event.pointerType === "touch") return;
    lastX = event.clientX;
    const open = document.body.classList.contains("panel-open");
    if (!open && event.clientX <= 84) {
      if (!hovering) {
        hovering = true;
        pointerY = event.clientY;
        poke();
      } else {
        pointerY = event.clientY;
        poke();
      }
      armOpen();
      return;
    }
    if (open && event.clientX <= 288) {
      clearTimeout(closeTimer);
      closeTimer = 0;
      return;
    }
    if (open) scheduleClose();
    else {
      cancelOpen();
      if (hovering) {
        hovering = false;
        pointerY = null;
        poke();
      }
    }
  });

  pin.addEventListener("click", togglePin);
  if (menuPin) menuPin.addEventListener("click", togglePin);

  document.getElementById("panel-close").addEventListener("click", () => {
    if (isMobile()) {
      pinned = false;
      syncPin();
      cancelOpen();
      setOpen(false);
      return;
    }
    collapseSidebar();
  });
  const collapse = document.getElementById("panel-collapse");
  if (collapse) collapse.addEventListener("click", () => {
    if (isMobile()) {
      pinned = false;
      syncPin();
      cancelOpen();
      setOpen(false);
      return;
    }
    collapseSidebar();
  });
  document.getElementById("nav-backdrop").addEventListener("click", () => {
    if (!isMobile() && pinned) collapseSidebar();
    else {
      pinned = false;
      syncPin();
      cancelOpen();
      setOpen(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("panel-open")) {
      const desk = document.getElementById("agent-drawer");
      if (desk && !desk.hidden) return;
      if (!isMobile() && pinned) collapseSidebar();
      else {
        pinned = false;
        syncPin();
        cancelOpen();
        setOpen(false);
      }
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const scope = document.body.classList.contains("panel-open") ? panel : rail;
    if (!scope.contains(document.activeElement)) return;
    const links = [...scope.querySelectorAll("a")];
    const index = links.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next = links[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) next.focus();
  });
  rail.addEventListener("focusin", (event) => {
    if (isMobile()) return;
    cancelOpen();
    const current = event.target.closest("a, button");
    setOpen(true);
    requestAnimationFrame(() => {
      if (!current) return;
      if (current.id === "rail-toggle" && menuPin) {
        menuPin.focus();
        return;
      }
      if (current.id === "nav-logout") {
        const logout = document.getElementById("panel-logout");
        if (logout) logout.focus();
        return;
      }
      const match = current.dataset.tab && panel.querySelector('a[data-tab="' + current.dataset.tab + '"]');
      if (match) match.focus();
    });
  });
  if (!isMobile() && readStored() === "open") expandSidebar();

  panel.addEventListener("focusout", (event) => {
    if (panel.contains(event.relatedTarget) || rail.contains(event.relatedTarget)) return;
    scheduleClose();
  });
}
