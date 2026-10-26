import { authReturnUrl, destinationAfterLogin, getSupabase, isConfigured } from "../auth/supabase.js";
import { clearAuthParams, clearCallbackMemory, friendlyAuthError, isLoginTab, readAuthCallback, rememberCallback, resolveSession } from "../auth/callback.js";
import { bindShell, markNav, setBusy, toast } from "../auth/ui.js";
import { PROOF_SLOTS, nextProof } from "../businesses/model.js";
import { inviteDestination, joinDestination } from "./entry.js";

bindShell();

const proofPane = document.getElementById("proof");
const proofQuote = document.getElementById("proof-quote");
const proofName = document.getElementById("proof-name");
const proofDetail = document.getElementById("proof-detail");
const proofPortrait = document.getElementById("proof-portrait");
const proofStars = document.getElementById("proof-stars-label");
const proofLogos = document.getElementById("proof-logos");
const proofCounter = document.getElementById("proof-counter");
const proofDots = document.getElementById("proof-dots");
let proofIndex = 0;
let proofTimer = 0;

if (proofDots) {
  PROOF_SLOTS.forEach((_, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "proof-dot";
    dot.setAttribute("aria-label", "Placeholder " + (index + 1));
    dot.addEventListener("click", () => {
      proofIndex = index;
      paintProof();
    });
    proofDots.append(dot);
  });
}

function paintProof() {
  const slot = PROOF_SLOTS[proofIndex] || PROOF_SLOTS[0];
  if (proofQuote) proofQuote.textContent = slot.quote;
  if (proofName) proofName.textContent = slot.name;
  if (proofDetail) proofDetail.textContent = slot.detail;
  if (proofPortrait) proofPortrait.textContent = slot.portrait;
  if (proofStars) proofStars.textContent = slot.stars;
  if (proofCounter) proofCounter.textContent = (proofIndex + 1) + " / " + PROOF_SLOTS.length;
  if (proofLogos) {
    proofLogos.innerHTML = "";
    (slot.logos || []).forEach((logo) => {
      const item = document.createElement("p");
      item.className = "logo-slot";
      item.textContent = logo;
      proofLogos.append(item);
    });
  }
  if (proofDots) {
    [...proofDots.children].forEach((dot, index) => {
      if (index === proofIndex) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
    });
  }
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

if (proofPane && document.getElementById("proof-prev")) {
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
let invite = null;
let inviteToken = params.get("invite") || "";
let joinCode = params.get("join") || "";
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
  const invited = invite && invite.email;
  const roleLabel = invited && invite.role === "editor" ? "Editor" : "Viewer";
  document.getElementById("page-sub").textContent = invited
    ? "You're invited to " + invite.business_name + " as " + roleLabel + ". No access code is needed. Log in if you already have an account. This invite only adds that business."
    : inviteToken
      ? "Use the invited email to log in or create an account. We'll add you to that business."
      : joinCode
        ? "This link joins a business. Log in or create an account and we'll add you."
        : login
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
          options: {
            redirectTo: authReturnUrl(
              params.get("invite")
                ? "/signup/?mode=login&invite=" + encodeURIComponent(params.get("invite"))
                : "/signup/?mode=login",
              params.get("next"),
              window.location.href
            )
          }
        });
        setBusy(googleBtn, false);
        if (error) showLoginError(friendlyAuthError(error));
      });
    }
    const inviteEmail = () => (invite && invite.email ? String(invite.email) : "");
    function showEntryError(message) {
      const text = message || "That link could not be used.";
      showError(text);
      showLoginError(text);
      toast(text, "bad");
    }
    async function landFromInvite() {
      if (!inviteToken) return false;
      const accepted = await supabase.rpc("accept_invite", { p_token: inviteToken });
      const acq = accepted.data ? { data: null, error: null } : await supabase.rpc("acq_accept_invite", { p_token: inviteToken });
      const next = inviteDestination(
        accepted.data,
        acq && acq.data,
        acq && acq.error ? acq.error.message : ""
      );
      if (next.ok) {
        window.location.replace(next.href);
        return true;
      }
      if (!accepted.data) {
        showEntryError(invite && invite.email
          ? "That invite could not be accepted. Log in with " + invite.email + "."
          : next.message);
      }
      return false;
    }
    async function landFromJoin() {
      if (!joinCode) return false;
      const joined = await supabase.rpc("acq_join_workspace", { p_code: joinCode });
      const next = joinDestination(joined.data, joined.error ? joined.error.message : "");
      if (next.ok) {
        window.location.replace(next.href);
        return true;
      }
      showEntryError(next.message);
      return false;
    }
    if (inviteToken) {
      const preview = await supabase.rpc("preview_invite", { p_token: inviteToken });
      invite = preview.data || null;
      if (invite && invite.email) {
        const access = document.getElementById("access-code");
        const accessLabel = access.closest("label");
        if (accessLabel) accessLabel.hidden = true;
        access.required = false;
        document.getElementById("email").value = invite.email;
        document.getElementById("email").readOnly = true;
        document.getElementById("login-email").value = invite.email;
      }
      showTab(wantsLogin() ? "login" : "signup");
    } else if (joinCode) {
      showTab(wantsLogin() ? "login" : "signup");
    }
    const resolved = await resolveSession(supabase, window.location.href);
    if (resolved.session) {
      clearAuthParams();
      clearCallbackMemory();
      if (inviteToken) await landFromInvite();
      else if (joinCode) await landFromJoin();
      else window.location.replace(await destinationAfterLogin(supabase, params.get("next")));
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
        const inviteOk = Boolean(inviteEmail());
        if (!inviteOk && !accessCode) return showError("Enter your access code.");
        if (password.length < 8) return showError("Use at least 8 characters in the password.");
        if (password !== confirm) return showError("Those passwords do not match.");
        const button = form.querySelector("button[type=submit]");
        setBusy(button, true, "Creating account…");
        const { data: created, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: inviteOk
              ? { full_name: name, instagram, invite_token: inviteToken }
              : { full_name: name, instagram, access_code: accessCode },
            emailRedirectTo: authReturnUrl(
              inviteOk ? "/signup/?mode=login&invite=" + encodeURIComponent(inviteToken) : "/signup/?mode=login",
              params.get("next"),
              window.location.href
            )
          }
        });
        setBusy(button, false);
        if (error) return showError(friendlyAuthError(error));
        if (created.session) {
          if (inviteToken && await landFromInvite()) return;
          if (joinCode && await landFromJoin()) return;
          const sessionEmail = String(created.session.user && created.session.user.email || email).toLowerCase();
          if (inviteOk && inviteEmail().toLowerCase() === sessionEmail) {
            window.location.replace("/account/acquisition/#dashboard");
            return;
          }
          if (inviteToken || joinCode) return;
          window.location.replace("/account/acquisition/?onboarding=1");
          return;
        }
        okEl.textContent = inviteOk
          ? "Check your email to confirm the account. The link brings you back to this invite."
          : "Check your email to confirm the account, then log in. The link brings you back to your account.";
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
        if (inviteToken) {
          await landFromInvite();
          return;
        }
        if (joinCode) {
          await landFromJoin();
          return;
        }
        window.location.replace(await destinationAfterLogin(supabase, params.get("next")));
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
            emailRedirectTo: authReturnUrl(
              inviteEmail() ? "/signup/?mode=login&invite=" + encodeURIComponent(inviteToken) : "/signup/?mode=login",
              params.get("next"),
              window.location.href
            ),
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
