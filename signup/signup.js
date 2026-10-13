import { getSupabase, isConfigured, logout, originPath, safeNext, signupErrorMessage } from "../auth/supabase.js";

const form = document.getElementById("signup-form");
const loginForm = document.getElementById("login-form");
const errorEl = document.getElementById("form-error");
const okEl = document.getElementById("form-ok");
const loginErrorEl = document.getElementById("login-error");
const loginOkEl = document.getElementById("login-ok");
const tabSignup = document.getElementById("tab-signup");
const tabLogin = document.getElementById("tab-login");
const params = new URLSearchParams(window.location.search);
const tabs = [tabSignup, tabLogin];

function wantsLogin() {
  const query = new URLSearchParams(window.location.search);
  const hash = window.location.hash.replace(/^#/, "");
  return query.get("mode") === "login" || hash === "login";
}

function showTab(mode) {
  const login = mode === "login";
  form.hidden = login;
  loginForm.hidden = !login;
  tabSignup.setAttribute("aria-selected", login ? "false" : "true");
  tabLogin.setAttribute("aria-selected", login ? "true" : "false");
  tabSignup.tabIndex = login ? -1 : 0;
  tabLogin.tabIndex = login ? 0 : -1;
  document.getElementById("page-heading").innerHTML = login
    ? 'Log <span class="g">in</span>'
    : 'Create your <span class="g">account</span>';
  document.getElementById("page-sub").textContent = login
    ? "Open your account to continue onboarding, or email yourself a sign-in link."
    : "This is where qualified clients start onboarding. Your answers are saved to the account, so you can finish on any device.";
  document.title = login ? "Log in · Roleflow" : "Create your account · Roleflow";
  document.getElementById("skip-link").setAttribute("href", login ? "#login-form" : "#signup-form");
}

function rememberMode(mode) {
  const url = new URL(window.location.href);
  if (mode === "login") {
    url.searchParams.set("mode", "login");
    url.hash = "login";
  } else {
    url.searchParams.delete("mode");
    if (url.hash === "#login") url.hash = "";
  }
  history.replaceState(null, "", url);
  showTab(mode);
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => rememberMode(tab === tabLogin ? "login" : "signup"));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
    tabs[next].focus();
    rememberMode(tabs[next] === tabLogin ? "login" : "signup");
  });
});
window.addEventListener("hashchange", () => showTab(wantsLogin() ? "login" : "signup"));
showTab(wantsLogin() ? "login" : "signup");

function normalizeHandle(value) {
  const handle = String(value || "").trim();
  if (!handle || handle.startsWith("@") || /[/\s]/.test(handle)) return handle;
  return "@" + handle;
}

document.getElementById("name").value = params.get("name") || "";
document.getElementById("email").value = params.get("email") || "";
document.getElementById("instagram").value = normalizeHandle(params.get("ig") || "");

function showError(message) {
  errorEl.textContent = message || "";
  okEl.textContent = "";
}

function showLoginError(message) {
  loginErrorEl.textContent = message || "";
  if (message) loginOkEl.textContent = "";
}

if (!isConfigured()) {
  showError("Add SUPABASE_URL and SUPABASE_ANON_KEY in supabase/config.js before accounts can be created.");
  form.querySelector("button").disabled = true;
  document.getElementById("login-btn").disabled = true;
  document.getElementById("magic-btn").disabled = true;
} else {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    window.location.replace(safeNext(params.get("next")));
  }
  document.getElementById("nav-logout").hidden = !data.session;
  document.getElementById("nav-logout").addEventListener("click", logout);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");
    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const instagram = normalizeHandle(document.getElementById("instagram").value);
    const accessCode = document.getElementById("access-code").value.trim();
    const password = document.getElementById("password").value;
    const confirm = document.getElementById("confirm").value;
    if (!name) return showError("Enter your name.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return showError("Enter a valid email address.");
    if (!instagram) return showError("Enter your Instagram handle.");
    if (!accessCode) return showError("Enter your access code.");
    if (password.length < 8) return showError("Use at least 8 characters in the password.");
    if (password !== confirm) return showError("Those passwords do not match.");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    const { data: created, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name, instagram, access_code: accessCode },
        emailRedirectTo: originPath("/account/")
      }
    });
    button.disabled = false;
    if (error) return showError(signupErrorMessage(error));
    if (created.session) {
      window.location.replace("/account/");
      return;
    }
    okEl.textContent = "Check your email to confirm the account, then log in. The link brings you back to your account.";
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showLoginError("");
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return showLoginError("Enter a valid email address.");
    if (!password) return showLoginError("Enter your password.");
    const button = document.getElementById("login-btn");
    button.disabled = true;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    button.disabled = false;
    if (error) return showLoginError(error.message);
    window.location.replace(safeNext(params.get("next")));
  });

  document.getElementById("magic-btn").addEventListener("click", async () => {
    showLoginError("");
    const email = document.getElementById("login-email").value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return showLoginError("Enter the email for the sign-in link.");
    const button = document.getElementById("magic-btn");
    button.disabled = true;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: originPath("/account/"),
        shouldCreateUser: false
      }
    });
    button.disabled = false;
    if (error) return showLoginError(error.message);
    loginOkEl.textContent = "Check your email for a sign-in link.";
  });
}
