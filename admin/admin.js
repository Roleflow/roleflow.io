import { getSupabase, isConfigured, logout } from "../auth/supabase.js";
import { clearAuthParams, clearCallbackMemory, rememberCallback, resolveSession } from "../auth/callback.js";
import { bindShell, markNav } from "../auth/ui.js";
import { renderApplications } from "./applications.js";
import { renderAcquisitionRoster, renderAddPreview, renderConnectPreview } from "./acquisition-admin.js";
import { bindAssistant } from "../acquire/assistant.js";

bindShell();
let assistantClient = null;
bindAssistant(() => ({ supabase: assistantClient, businessId: "" }));

const hello = document.getElementById("admin-hello");
const app = document.getElementById("admin-app");
const logoutBtn = document.getElementById("nav-logout");
logoutBtn.addEventListener("click", logout);

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  });
  (children || []).forEach((child) => {
    if (child == null || child === false) return;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return node;
}

function hideBoot() {
  const boot = document.getElementById("boot-state");
  if (boot) boot.hidden = true;
}

function showMessage(text) {
  hideBoot();
  app.innerHTML = "";
  app.append(el("div", { class: "state" }, [
    el("h2", {}, ["Admin unavailable"]),
    el("p", {}, [text])
  ]));
}

const arriving = rememberCallback(window.location.href);
const previewHost = location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname.endsWith(".vercel.app");
const previewAdmin = previewHost && new URLSearchParams(location.search).get("preview") === "1";
if (previewAdmin) {
  hello.textContent = "Preview";
  hideBoot();
  if (new URLSearchParams(window.location.search).get("add") === "1") renderAddPreview(app);
  else renderConnectPreview(app);
} else if (arriving.type === "recovery") {
  window.location.replace("/reset/" + window.location.hash);
} else if (!isConfigured()) {
  hello.textContent = "Add the Supabase keys in supabase/config.js.";
  showMessage("Paste SUPABASE_URL and SUPABASE_ANON_KEY into supabase/config.js, then refresh.");
} else {
    const supabase = getSupabase();
    assistantClient = supabase;
  const resolved = await resolveSession(supabase, window.location.href);
  if (!resolved.session) {
    const notice = resolved.errorMessage;
    window.location.replace(notice
      ? "/signup/?mode=login&notice=" + encodeURIComponent(notice)
      : "/login/?next=/admin/");
  } else {
    clearAuthParams();
    clearCallbackMemory();
    logoutBtn.hidden = false;
    const user = resolved.session.user;
    const adminRes = await supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (adminRes.error && /schema cache|does not exist|PGRST205/i.test(adminRes.error.message || "")) {
      hello.textContent = "Signed in.";
      showMessage("The database migration has not been applied yet. Run supabase/migrations/20261010120000_roleflow_accounts.sql in the Supabase SQL editor.");
    } else if (!adminRes.data) {
      hello.textContent = "Signed in as " + (user.email || "a client") + ".";
      showMessage("This page is only for Roleflow admins. Your businesses are on your account.");
      app.append(el("p", { class: "links" }, [el("a", { href: "/businesses/" }, ["Go to your businesses"])]));
    } else {
      if (location.hash === "#applications") {
        hello.textContent = "Signed in as " + (user.email || "admin") + ".";
        hideBoot();
        const tabs = document.getElementById("admin-tabs");
        const tabApplications = document.getElementById("tab-applications");
        if (tabs) tabs.hidden = false;
        const headerApplications = document.getElementById("nav-applications");
        if (headerApplications) headerApplications.hidden = false;
        if (tabApplications) tabApplications.setAttribute("aria-selected", "true");
        document.getElementById("main")?.classList.add("sheet-wide");
        markNav();
        await renderApplications(supabase, user, { app, hello });
      } else {
        hello.textContent = "Signed in as " + (user.email || "admin") + ".";
        hideBoot();
        const title = document.getElementById("admin-title");
        if (title) title.textContent = "Your businesses";
        markNav();
        await renderAcquisitionRoster(supabase, app);
      }
    }
  }
}
