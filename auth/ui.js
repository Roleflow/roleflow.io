export function toast(message, tone) {
  const text = String(message || "").trim();
  if (!text) return;
  let stack = document.getElementById("toasts");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "toasts";
    stack.className = "toast-stack";
    stack.setAttribute("aria-live", "polite");
    document.body.append(stack);
  }
  const item = document.createElement("p");
  item.className = "toast" + (tone === "bad" ? " bad" : "");
  item.setAttribute("role", "status");
  item.textContent = text;
  stack.append(item);
  window.setTimeout(() => item.remove(), 4200);
}

export function markNav() {
  const path = location.pathname.replace(/\/$/, "") || "/";
  const hash = location.hash;
  const login = new URLSearchParams(location.search).get("mode") === "login" || hash === "#login";
  document.querySelectorAll(".app-nav a").forEach((link) => {
    const url = new URL(link.getAttribute("href"), location.origin);
    const linkPath = url.pathname.replace(/\/$/, "") || "/";
    let on = false;
    if (linkPath.endsWith("/signup")) {
      on = path.endsWith("/signup") && ((url.searchParams.get("mode") === "login") === login);
    } else if (linkPath.endsWith("/reset")) {
      on = path.endsWith("/reset");
    } else if (linkPath.endsWith("/admin")) {
      if (url.hash === "#crm") on = path.endsWith("/admin") && hash === "#crm";
      else on = path.endsWith("/admin") && hash !== "#crm";
    } else if (linkPath.endsWith("/businesses")) {
      const href = link.getAttribute("href") || "";
      const hash = location.hash;
      on = path.endsWith("/businesses") && href.startsWith("/businesses") && (hash === "" || hash === "#" || hash === "#list");
    } else if (linkPath.endsWith("/account")) {
      if (url.hash === "#onboarding") on = path.endsWith("/account") && hash.startsWith("#onboarding");
      else if (url.hash === "#setter") on = path.endsWith("/account") && !hash.startsWith("#onboarding");
      else on = path.endsWith("/account");
    }
    if (on) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

export function bindShell() {
  const toggle = document.getElementById("nav-toggle");
  const side = document.getElementById("app-side");
  const backdrop = document.getElementById("nav-backdrop");
  function setOpen(open) {
    document.body.classList.toggle("nav-open", open);
    if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (backdrop) backdrop.hidden = !open;
    if (open) side?.querySelector("a, button")?.focus();
  }
  toggle?.addEventListener("click", () => setOpen(!document.body.classList.contains("nav-open")));
  backdrop?.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("nav-open")) {
      setOpen(false);
      toggle?.focus();
    }
  });
  side?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
  });
  markNav();
  window.addEventListener("hashchange", markNav);
}

export function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    if (label) button.textContent = label;
  } else {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (button.dataset.label) button.textContent = button.dataset.label;
  }
}

globalThis.RoleflowUI = { toast, markNav };
