export function bindDock({ setOpen, isMobile }) {
  const rail = document.getElementById("icon-rail");
  const panel = document.getElementById("slide-panel");
  const pin = document.getElementById("rail-toggle");
  if (!rail || !panel || !pin) return;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coarse = window.matchMedia("(pointer: coarse)");
  const scales = new WeakMap();
  const velocity = new WeakMap();
  let pinned = false;
  let pointerY = null;
  let hovering = false;
  let raf = 0;
  let closeTimer = 0;

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
      if (hovering && pointerY != null && !reduce.matches && !coarse.matches) {
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
      const away = hovering && pointerY != null && !reduce.matches ? -Math.sign(dy) * Math.abs(next - 1) * 34 : 0;
      const scale = Math.abs(next - 1) < 0.004 ? 1 : next;
      node.style.transform = scale === 1 && Math.abs(away) < 0.4 ? "" : "translateY(" + away.toFixed(2) + "px) scale(" + scale.toFixed(3) + ")";
    });
    if (moving) raf = requestAnimationFrame(tick);
  }

  function poke() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function openHover() {
    if (isMobile() || pinned) return;
    clearTimeout(closeTimer);
    setOpen(true);
  }

  function scheduleClose() {
    if (isMobile() || pinned) return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (pinned) return;
      const active = document.activeElement;
      if (rail.matches(":hover") || panel.matches(":hover")) return;
      if (active && (rail.contains(active) || panel.contains(active))) return;
      hovering = false;
      pointerY = null;
      poke();
      setOpen(false);
    }, 220);
  }

  function unpin() {
    pinned = false;
    document.body.classList.remove("panel-pinned");
    pin.setAttribute("aria-pressed", "false");
    pin.dataset.tip = "Pin menu";
    pin.title = "Pin menu";
  }

  rail.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" || coarse.matches || isMobile()) return;
    hovering = true;
    pointerY = event.clientY;
    poke();
    openHover();
  });
  rail.addEventListener("pointerleave", () => {
    hovering = false;
    pointerY = null;
    poke();
    scheduleClose();
  });
  panel.addEventListener("pointerenter", () => {
    clearTimeout(closeTimer);
  });
  panel.addEventListener("pointerleave", scheduleClose);

  document.addEventListener("pointermove", (event) => {
    if (isMobile() || coarse.matches || event.pointerType === "touch") return;
    if (event.clientX <= 8) openHover();
  });

  pin.addEventListener("click", () => {
    if (isMobile()) {
      setOpen(!document.body.classList.contains("panel-open"));
      return;
    }
    pinned = !pinned;
    document.body.classList.toggle("panel-pinned", pinned);
    pin.setAttribute("aria-pressed", pinned ? "true" : "false");
    pin.dataset.tip = pinned ? "Unpin menu" : "Pin menu";
    pin.title = pin.dataset.tip;
    setOpen(pinned || rail.matches(":hover"));
  });

  document.getElementById("panel-close").addEventListener("click", () => {
    unpin();
    setOpen(false);
  });
  document.getElementById("nav-backdrop").addEventListener("click", () => {
    unpin();
    setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("panel-open")) {
      unpin();
      setOpen(false);
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (!rail.contains(document.activeElement)) return;
    const links = [...rail.querySelectorAll("a")];
    const index = links.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next = links[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) next.focus();
  });
  rail.addEventListener("focusin", () => {
    if (!isMobile()) setOpen(true);
  });
  rail.addEventListener("focusout", (event) => {
    if (panel.contains(event.relatedTarget) || rail.contains(event.relatedTarget)) return;
    scheduleClose();
  });
}
