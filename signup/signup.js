import { getSupabase, isConfigured, logout, originPath, safeNext } from "../auth/supabase.js";

const form = document.getElementById("signup-form");
const errorEl = document.getElementById("form-error");
const okEl = document.getElementById("form-ok");
const params = new URLSearchParams(window.location.search);

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

if (!isConfigured()) {
  showError("Add SUPABASE_URL and SUPABASE_ANON_KEY in supabase/config.js before accounts can be created.");
  form.querySelector("button").disabled = true;
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
    const password = document.getElementById("password").value;
    const confirm = document.getElementById("confirm").value;
    if (!name) return showError("Enter your name.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return showError("Enter a valid email address.");
    if (!instagram) return showError("Enter your Instagram handle.");
    if (password.length < 8) return showError("Use at least 8 characters in the password.");
    if (password !== confirm) return showError("Those passwords do not match.");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    const { data: created, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name, instagram },
        emailRedirectTo: originPath("/account/")
      }
    });
    button.disabled = false;
    if (error) return showError(error.message);
    if (created.session) {
      window.location.replace("/account/");
      return;
    }
    okEl.textContent = "Check your email to confirm the account, then log in. The link brings you back to your account.";
  });
}
