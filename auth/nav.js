import { getSupabase, isConfigured } from "./supabase.js";

function onboardingHash(hash) {
  const id = String(hash || "").replace(/^#/, "");
  return id === "onboarding" || id.startsWith("onboarding-");
}

const link = document.getElementById("nav-account");
let session = null;
if (isConfigured()) {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  session = data.session;
}
if (onboardingHash(window.location.hash)) {
  window.location.replace(session ? "/account/" : "/login/?next=/account/");
} else if (link && session) {
  link.textContent = "Account";
  link.setAttribute("href", "/account/");
}
