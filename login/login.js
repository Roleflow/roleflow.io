import { getSupabase, isConfigured, originPath, safeNext } from "../auth/supabase.js";

const form = document.getElementById("login-form");
const errorEl = document.getElementById("form-error");
const okEl = document.getElementById("form-ok");
const next = safeNext(new URLSearchParams(window.location.search).get("next"));
document.getElementById("signup-link").href = "/signup/?next=" + encodeURIComponent(next);

function showError(message) {
  errorEl.textContent = message || "";
  if (message) okEl.textContent = "";
}

if (!isConfigured()) {
  showError("Add SUPABASE_URL and SUPABASE_ANON_KEY in supabase/config.js before you can log in.");
} else {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  if (data.session && !window.location.hash.includes("access_token")) {
    window.location.replace(next);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return showError("Enter a valid email address.");
    if (!password) return showError("Enter your password.");
    const button = document.getElementById("login-btn");
    button.disabled = true;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    button.disabled = false;
    if (error) return showError(error.message);
    window.location.replace(next);
  });

  document.getElementById("magic-btn").addEventListener("click", async () => {
    showError("");
    const email = document.getElementById("email").value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return showError("Enter the email for the sign-in link.");
    const button = document.getElementById("magic-btn");
    button.disabled = true;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: originPath("/account/") }
    });
    button.disabled = false;
    if (error) return showError(error.message);
    okEl.textContent = "Check your email for a sign-in link.";
  });
}
