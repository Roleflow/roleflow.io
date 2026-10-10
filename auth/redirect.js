import { getSupabase, isConfigured } from "./supabase.js";

let session = null;
if (isConfigured()) {
  const { data } = await getSupabase().auth.getSession();
  session = data.session;
}
window.location.replace(session ? "/account/" : "/login/?next=/account/");
