import { getSupabase, isConfigured } from "./supabase.js";

function onboardingHash(hash) {
  const id = String(hash || "").replace(/^#/, "");
  return id === "onboarding" || id.startsWith("onboarding-");
}

let session = null;
if (isConfigured()) {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  session = data.session;
}
if (onboardingHash(window.location.hash)) {
  window.location.replace(session ? "/account/acquisition/?onboarding=1" : "/login/?next=/account/");
}
