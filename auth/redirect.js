import { getSupabase, isConfigured } from "./supabase.js";

let session = null;
if (isConfigured()) {
  const { data } = await getSupabase().auth.getSession();
  session = data.session;
}
const onboardingNext = "/account/acquisition/?onboarding=1";
window.location.replace(session ? onboardingNext : "/login/?next=" + encodeURIComponent(onboardingNext));
