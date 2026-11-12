import { authReturnUrl, destinationAfterLogin, getSupabase, isConfigured, logout } from "./supabase.js";

const drawer = document.getElementById("site-drawer");
const toggle = document.getElementById("menu-toggle");
const backdrop = document.getElementById("drawer-backdrop");
if (!drawer || !toggle) {
  /* other pages do not include the homepage drawer */
} else {
  const guest = document.getElementById("drawer-guest");
  const member = document.getElementById("drawer-member");
  const signupForm = document.getElementById("drawer-signup");
  const loginForm = document.getElementById("drawer-login");
  const loginError = document.getElementById("drawer-login-error");
  const loginOk = document.getElementById("drawer-login-ok");
  const adminLink = document.getElementById("drawer-admin");
  const crmLink = document.getElementById("drawer-crm");
  const applicationsLink = document.getElementById("drawer-applications");
  let paintToken = 0;

  function setOpen(open) {
    drawer.hidden = !open;
    backdrop.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    document.documentElement.classList.toggle("drawer-open", open);
    if (open) {
      const focusTarget = member.hidden
        ? (signupForm.hidden ? loginForm.querySelector("input") : document.getElementById("show-signup"))
        : document.getElementById("drawer-dashboard");
      focusTarget?.focus();
    } else {
      toggle.focus();
    }
  }

  const tabSignup = document.getElementById("show-signup");
  const tabLogin = document.getElementById("show-login");
  const drawerTabs = [tabSignup, tabLogin];

  function wantsLogin() {
    const query = new URLSearchParams(window.location.search);
    const hash = window.location.hash.replace(/^#/, "");
    return query.get("mode") === "login" || hash === "login";
  }

  function showPanel(which) {
    const signup = which === "signup";
    signupForm.hidden = !signup;
    loginForm.hidden = signup;
    tabSignup.setAttribute("aria-selected", signup ? "true" : "false");
    tabLogin.setAttribute("aria-selected", signup ? "false" : "true");
    tabSignup.tabIndex = signup ? 0 : -1;
    tabLogin.tabIndex = signup ? -1 : 0;
  }

  function rememberMode(which) {
    const url = new URL(window.location.href);
    if (which === "login") {
      url.searchParams.set("mode", "login");
      url.hash = "login";
    } else {
      url.searchParams.delete("mode");
      if (url.hash === "#login") url.hash = "";
    }
    history.replaceState(null, "", url);
    showPanel(which);
  }

  const accessLink = toggle.tagName === "A";
  if (!accessLink) toggle.addEventListener("click", () => setOpen(drawer.hidden));
  document.getElementById("drawer-close").addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !drawer.hidden) setOpen(false);
  });
  drawerTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => rememberMode(tab === tabLogin ? "login" : "signup"));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const next = event.key === "ArrowRight" ? (index + 1) % drawerTabs.length : (index - 1 + drawerTabs.length) % drawerTabs.length;
      drawerTabs[next].focus();
      rememberMode(drawerTabs[next] === tabLogin ? "login" : "signup");
    });
  });
  window.addEventListener("hashchange", () => {
    if (accessLink && wantsLogin()) {
      window.location.replace("/signup/?mode=login");
      return;
    }
    const mode = wantsLogin() ? "login" : "signup";
    showPanel(mode);
    if (mode === "login") setOpen(true);
  });
  showPanel(wantsLogin() ? "login" : "signup");
  if (accessLink && wantsLogin()) window.location.replace("/signup/?mode=login");
  else if (wantsLogin()) setOpen(true);
  document.getElementById("drawer-logout").addEventListener("click", logout);

  async function paint(session) {
    const token = ++paintToken;
    if (!session) {
      guest.hidden = false;
      member.hidden = true;
      adminLink.hidden = true;
      if (crmLink) crmLink.hidden = true;
      if (applicationsLink) applicationsLink.hidden = true;
      return;
    }
    guest.hidden = true;
    member.hidden = false;
    const user = session.user;
    let name = user.user_metadata?.full_name || user.email || "Your account";
    let isAdmin = false;
    if (isConfigured()) {
      const supabase = getSupabase();
      const profile = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
      const admin = await supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
      if (token !== paintToken) return;
      if (profile.data?.full_name) name = profile.data.full_name;
      isAdmin = Boolean(admin.data);
    }
    document.getElementById("drawer-name").textContent = name;
    adminLink.hidden = !isAdmin;
    if (crmLink) crmLink.hidden = !isAdmin;
    if (applicationsLink) applicationsLink.hidden = !isAdmin;
  }

  if (!isConfigured()) {
    loginForm.querySelector("button[type=submit]").disabled = true;
  } else {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    await paint(data.session);
    supabase.auth.onAuthStateChange((_event, session) => {
      paint(session);
    });

    // Sign-up is by invitation: the drawer has no sign-up form. People sign
    // up from a team link or an invite email (/signup/?join=… or ?invite=…).

    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      loginError.textContent = "";
      loginOk.textContent = "";
      const email = document.getElementById("drawer-login-email").value.trim();
      const password = document.getElementById("drawer-login-password").value;
      if (!/^\S+@\S+\.\S+$/.test(email)) return (loginError.textContent = "Enter a valid email address.");
      if (!password) return (loginError.textContent = "Enter your password.");
      const button = loginForm.querySelector("button[type=submit]");
      button.disabled = true;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      button.disabled = false;
      if (error) {
        loginError.textContent = error.message;
        return;
      }
      window.location.replace(await destinationAfterLogin(supabase, "/account/"));
    });

    document.getElementById("drawer-magic").addEventListener("click", async () => {
      loginError.textContent = "";
      loginOk.textContent = "";
      const email = document.getElementById("drawer-login-email").value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        loginError.textContent = "Enter the email for the sign-in link.";
        return;
      }
      const button = document.getElementById("drawer-magic");
      button.disabled = true;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: authReturnUrl("/login/", "/account/", window.location.href),
          shouldCreateUser: false
        }
      });
      button.disabled = false;
      if (error) {
        loginError.textContent = /signups not allowed|user not found|not allowed/i.test(error.message || "")
          ? "No account uses that email yet. Sign up from your team link or invite email first."
          : error.message;
        return;
      }
      loginOk.textContent = "Check your email for a sign-in link.";
    });
  }
}
