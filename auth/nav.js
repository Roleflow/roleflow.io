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
  const onboardingNext = "/account/acquisition/?onboarding=1";
  window.location.replace(session ? onboardingNext : "/login/?next=" + encodeURIComponent(onboardingNext));
}
