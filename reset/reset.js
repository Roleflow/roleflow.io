import { getSupabase, isConfigured, originPath } from "../auth/supabase.js";

const requestPanel = document.getElementById("request-panel");
const passwordPanel = document.getElementById("password-panel");
const errorEl = document.getElementById("form-error");
const okEl = document.getElementById("form-ok");
const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const recovery = hash.get("type") === "recovery";

function showError(message) {
  errorEl.textContent = message || "";
  if (message) okEl.textContent = "";
}

if (recovery) {
  requestPanel.hidden = true;
  passwordPanel.hidden = false;
}

if (!isConfigured()) {
  showError("Add SUPABASE_URL and SUPABASE_ANON_KEY in supabase/config.js before password reset can run.");
} else {
  const supabase = getSupabase();
  if (recovery) {
    const { data } = await supabase.auth.getSession();
    if (!data.session) showError("This reset link is invalid or expired. Request a new one.");
  }

  document.getElementById("request-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");
    const email = document.getElementById("email").value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return showError("Enter a valid email address.");
    const button = event.target.querySelector("button");
    button.disabled = true;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: originPath("/reset/")
    });
    button.disabled = false;
    if (error) return showError(error.message);
    okEl.textContent = "Check your email for a link to choose a new password.";
  });

  document.getElementById("password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");
    const password = document.getElementById("password").value;
    const confirm = document.getElementById("confirm").value;
    if (password.length < 8) return showError("Use at least 8 characters.");
    if (password !== confirm) return showError("Those passwords do not match.");
    const button = event.target.querySelector("button");
    button.disabled = true;
    const { error } = await supabase.auth.updateUser({ password });
    button.disabled = false;
    if (error) return showError(error.message);
    okEl.textContent = "Password updated. Taking you to your account.";
    window.setTimeout(() => window.location.replace("/account/"), 600);
  });
}
