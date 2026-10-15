import { getSupabase, isConfigured, originPath, safeNext } from "../auth/supabase.js";
import { clearAuthParams, clearCallbackMemory, friendlyAuthError, isLoginTab, readAuthCallback, rememberCallback, resolveSession } from "../auth/callback.js";
import { bindShell, markNav, setBusy, toast } from "../auth/ui.js";
import { PROOF_SLOTS, nextProof } from "../businesses/model.js";

bindShell();

const proofPane = document.getElementById("proof");
const proofQuote = document.getElementById("proof-quote");
const proofName = document.getElementById("proof-name");
const proofDetail = document.getElementById("proof-detail");
const proofSlot = document.getElementById("proof-slot");
let proofIndex = 0;
let proofTimer = 0;

function paintProof() {
  const slot = PROOF_SLOTS[proofIndex] || PROOF_SLOTS[0];
  if (proofQuote) proofQuote.textContent = slot.quote;
  if (proofName) proofName.textContent = slot.name;
  if (proofDetail) proofDetail.textContent = slot.detail;
  if (proofSlot) proofSlot.textContent = "Placeholder " + (proofIndex + 1) + " of " + PROOF_SLOTS.length;
}

function moveProof(direction) {
  proofIndex = nextProof(proofIndex, PROOF_SLOTS.length, direction);
  paintProof();
}

function armProof() {
  window.clearInterval(proofTimer);
  if (!proofPane) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || proofPane.matches(":hover") || proofPane.contains(document.activeElement)) return;
  proofTimer = window.setInterval(() => moveProof(1), 7000);
}

if (proofPane) {
  paintProof();
  document.getElementById("proof-prev").addEventListener("click", () => moveProof(-1));
  document.getElementById("proof-next").addEventListener("click", () => moveProof(1));
  proofPane.addEventListener("mouseenter", () => window.clearInterval(proofTimer));
  proofPane.addEventListener("mouseleave", armProof);
  proofPane.addEventListener("focusin", () => window.clearInterval(proofTimer));
  proofPane.addEventListener("focusout", armProof);
  proofPane.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveProof(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveProof(-1);
    }
  });
  armProof();
}

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
  if (query.get("mode") === "login") return true;
  return isLoginTab(window.location.search, window.location.hash);
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
  markNav();
}

function rememberMode(mode) {
  const url = new URL(window.location.href);
  const hash = url.hash.replace(/^#/, "");
  const authHash = /access_token|refresh_token|error|error_description|type=/.test(hash);
  if (mode === "login") {
    url.searchParams.set("mode", "login");
    if (!authHash) url.hash = "login";
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
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else next = tabs.length - 1;
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
  if (message) toast(message, "bad");
}

function showLoginError(message) {
  loginErrorEl.textContent = message || "";
  if (message) loginOkEl.textContent = "";
  if (message) toast(message, "bad");
}

function showLoginOk(message) {
  loginOkEl.textContent = message || "";
  if (message) toast(message, "ok");
}

const notice = params.get("notice");
if (notice) {
  showTab("login");
  loginErrorEl.textContent = notice;
  toast(notice, "bad");
  clearAuthParams();
}

const googleBtn = document.getElementById("google-btn");
const googleNote = document.getElementById("google-note");
const googleOn = globalThis.ROLEFLOW_SUPABASE && globalThis.ROLEFLOW_SUPABASE.GOOGLE_AUTH === true;

if (!isConfigured()) {
  showError("Add SUPABASE_URL and SUPABASE_ANON_KEY in supabase/config.js before accounts can be created.");
  form.querySelector("button").disabled = true;
  document.getElementById("login-btn").disabled = true;
  document.getElementById("magic-btn").disabled = true;
  if (googleBtn) googleBtn.disabled = true;
} else {
  const callback = rememberCallback(window.location.href);
  if (callback.type === "recovery") {
    window.location.replace("/reset/" + window.location.hash);
  } else {
    const supabase = getSupabase();
    if (googleBtn && googleOn) {
      googleBtn.disabled = false;
      if (googleNote) googleNote.textContent = "Continues with the Google account on this device.";
      googleBtn.addEventListener("click", async () => {
        setBusy(googleBtn, true, "Opening Google…");
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: originPath("/account/") }
        });
        setBusy(googleBtn, false);
        if (error) showLoginError(friendlyAuthError(error));
      });
    }
    const resolved = await resolveSession(supabase, window.location.href);
    if (resolved.session) {
      clearAuthParams();
      clearCallbackMemory();
      window.location.replace(safeNext(params.get("next")));
    } else {
      if (resolved.errorMessage) {
        showTab("login");
        loginErrorEl.textContent = resolved.errorMessage;
        toast(resolved.errorMessage, "bad");
        const url = new URL(window.location.href);
        url.searchParams.set("mode", "login");
        history.replaceState(null, "", url);
        clearAuthParams();
        clearCallbackMemory();
        markNav();
      }
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        errorEl.textContent = "";
        okEl.textContent = "";
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
        setBusy(button, true, "Creating account…");
        const { data: created, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name, instagram, access_code: accessCode },
            emailRedirectTo: originPath("/account/")
          }
        });
        setBusy(button, false);
        if (error) return showError(friendlyAuthError(error));
        if (created.session) {
          window.location.replace("/account/");
          return;
        }
        okEl.textContent = "Check your email to confirm the account, then log in. The link brings you back to your account.";
        toast(okEl.textContent, "ok");
      });

      loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        loginErrorEl.textContent = "";
        loginOkEl.textContent = "";
        const email = document.getElementById("login-email").value.trim();
        const password = document.getElementById("login-password").value;
        if (!/^\S+@\S+\.\S+$/.test(email)) return showLoginError("Enter a valid email address.");
        if (!password) return showLoginError("Enter your password.");
        const button = document.getElementById("login-btn");
        setBusy(button, true, "Logging in…");
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        setBusy(button, false);
        if (error) return showLoginError(friendlyAuthError(error));
        window.location.replace(safeNext(params.get("next")));
      });

      document.getElementById("magic-btn").addEventListener("click", async () => {
        loginErrorEl.textContent = "";
        loginOkEl.textContent = "";
        const email = document.getElementById("login-email").value.trim();
        if (!/^\S+@\S+\.\S+$/.test(email)) return showLoginError("Enter the email for the sign-in link.");
        const button = document.getElementById("magic-btn");
        setBusy(button, true, "Sending…");
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: originPath("/account/"),
            shouldCreateUser: false
          }
        });
        setBusy(button, false);
        if (error) return showLoginError(friendlyAuthError(error));
        showLoginOk("Check your email for a sign-in link.");
      });
    }
  }
}
