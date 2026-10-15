import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";

export function supabaseConfig() {
  const cfg = globalThis.ROLEFLOW_SUPABASE || {};
  return {
    url: String(cfg.SUPABASE_URL || "").trim(),
    key: String(cfg.SUPABASE_ANON_KEY || "").trim()
  };
}

export function isConfigured() {
  const { url, key } = supabaseConfig();
  return url.startsWith("https://") && !url.includes("YOUR_PROJECT") && key.length > 20 && !key.includes("YOUR_ANON");
}

export function getSupabase() {
  if (!isConfigured()) return null;
  if (!globalThis.__roleflowSupabase) {
    const { url, key } = supabaseConfig();
    globalThis.__roleflowSupabase = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "implicit"
      }
    });
  }
  return globalThis.__roleflowSupabase;
}

export function safeNext(raw) {
  const value = String(raw || "");
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("://")) {
    return "/account/";
  }
  return value;
}

export async function destinationAfterLogin(supabase, next) {
  const target = safeNext(next);
  const home = target === "/account/" || target === "/account" || target === "/admin/" || target === "/admin" || target === "/admin/#clients";
  if (!home || !supabase) return target;
  const { data } = await supabase.auth.getUser();
  const id = data.user?.id;
  if (!id) return target;
  const admin = await supabase.from("admins").select("user_id").eq("user_id", id).maybeSingle();
  return admin.data ? "/businesses/" : target;
}

export function originPath(path) {
  return window.location.origin + path;
}

export async function logout() {
  const supabase = getSupabase();
  if (supabase) await supabase.auth.signOut();
  window.location.replace("/");
}

export function signupErrorMessage(error) {
  const raw = [error && error.message, error && error.msg, error && error.error_description, error && error.details, error && error.code]
    .filter(Boolean)
    .join(" ");
  if (/invalid access code/i.test(raw) || /database error saving new user/i.test(raw)) {
    return "Invalid access code.";
  }
  return (error && error.message) || "Could not create the account.";
}
