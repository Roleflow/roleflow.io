import { authReturnUrl, getSupabase, isConfigured, safeNext } from "../auth/supabase.js";
import { clearAuthParams, clearCallbackMemory, friendlyAuthError, peekCallback, readAuthCallback, rememberCallback, resolveSession } from "../auth/callback.js";
import { bindShell, setBusy, toast } from "../auth/ui.js";

bindShell();

const requestPanel = document.getElementById("request-panel");
const passwordPanel = document.getElementById("password-panel");
const errorEl = document.getElementById("form-error");
const okEl = document.getElementById("form-ok");
const next = safeNext(new URLSearchParams(window.location.search).get("next"));
const callback = rememberCallback(window.location.href);
const memory = peekCallback();
const recovery = callback.type === "recovery" || memory?.type === "recovery";

function showError(message) {
  errorEl.textContent = message || "";
  if (message) {
    okEl.textContent = "";
    toast(message, "bad");
  }
}

function showOk(message) {
  okEl.textContent = message || "";
  if (message) toast(message, "ok");
}

if (recovery) {
  requestPanel.hidden = true;
  passwordPanel.hidden = false;
  document.querySelector(".skip")?.setAttribute("href", "#password-form");
}

if (!isConfigured()) {
  showError("Add SUPABASE_URL and SUPABASE_ANON_KEY in supabase/config.js before password reset can run.");
} else {
  const supabase = getSupabase();
  if (recovery || callback.error || callback.hasGrant || callback.code) {
    const resolved = await resolveSession(supabase, window.location.href);
    clearAuthParams();
    if (recovery && !resolved.session) {
      requestPanel.hidden = false;
      passwordPanel.hidden = true;
      showError(resolved.errorMessage || "This reset link is invalid or expired. Request a new one.");
    } else if (callback.error && !recovery) {
      showError(friendlyAuthError({ message: callback.error }));
    }
  }

  document.getElementById("request-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.textContent = "";
    okEl.textContent = "";
    const email = document.getElementById("email").value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return showError("Enter a valid email address.");
    const button = event.target.querySelector("button");
    setBusy(button, true, "Sending…");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: authReturnUrl("/reset/", next, window.location.href)
    });
    setBusy(button, false);
    if (error) return showError(friendlyAuthError(error));
    showOk("Check your email for a link to choose a new password.");
  });

  document.getElementById("password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.textContent = "";
    okEl.textContent = "";
    const password = document.getElementById("password").value;
    const confirm = document.getElementById("confirm").value;
    if (password.length < 8) return showError("Use at least 8 characters.");
    if (password !== confirm) return showError("Those passwords do not match.");
    const button = event.target.querySelector("button");
    setBusy(button, true, "Saving…");
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(button, false);
    if (error) return showError(friendlyAuthError(error));
    clearCallbackMemory();
    showOk("Password updated. Taking you to your account.");
    window.setTimeout(() => window.location.replace(next), 600);
  });
}
