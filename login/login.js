import { getSupabase, isConfigured, originPath, safeNext } from "../auth/supabase.js";
import { clearAuthParams, clearCallbackMemory, friendlyAuthError, readAuthCallback, rememberCallback, resolveSession } from "../auth/callback.js";
import { bindShell, setBusy, toast } from "../auth/ui.js";

bindShell();

const form = document.getElementById("login-form");
const errorEl = document.getElementById("form-error");
const okEl = document.getElementById("form-ok");
const next = safeNext(new URLSearchParams(window.location.search).get("next"));
document.getElementById("signup-link").href = "/signup/?next=" + encodeURIComponent(next);

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

const notice = new URLSearchParams(window.location.search).get("notice");
if (notice) {
  errorEl.textContent = notice;
  toast(notice, "bad");
  clearAuthParams();
}

if (!isConfigured()) {
  showError("Add SUPABASE_URL and SUPABASE_ANON_KEY in supabase/config.js before you can log in.");
} else {
  const callback = rememberCallback(window.location.href);
  if (callback.type === "recovery" || readAuthCallback(window.location.href).type === "recovery") {
    window.location.replace("/reset/" + window.location.hash);
  } else {
    const supabase = getSupabase();
    const resolved = await resolveSession(supabase, window.location.href);
    if (resolved.session) {
      clearAuthParams();
      clearCallbackMemory();
      window.location.replace(next);
    } else if (resolved.errorMessage) {
      errorEl.textContent = resolved.errorMessage;
      toast(resolved.errorMessage, "bad");
      clearAuthParams();
      clearCallbackMemory();
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorEl.textContent = "";
      okEl.textContent = "";
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;
      if (!/^\S+@\S+\.\S+$/.test(email)) return showError("Enter a valid email address.");
      if (!password) return showError("Enter your password.");
      const button = document.getElementById("login-btn");
      setBusy(button, true, "Logging in…");
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setBusy(button, false);
      if (error) return showError(friendlyAuthError(error));
      window.location.replace(next);
    });

    document.getElementById("magic-btn").addEventListener("click", async () => {
      errorEl.textContent = "";
      okEl.textContent = "";
      const email = document.getElementById("email").value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) return showError("Enter the email for the sign-in link.");
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
      if (error) return showError(friendlyAuthError(error));
      showOk("Check your email for a sign-in link.");
    });
  }
}
