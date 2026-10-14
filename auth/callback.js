function decodeMessage(value) {
  const text = String(value || "").replace(/\+/g, " ");
  if (!text) return "";
  try { return decodeURIComponent(text); } catch { return text; }
}

export function readAuthCallback(href) {
  let url;
  try {
    url = new URL(String(href || ""), "https://www.roleflow.io");
  } catch {
    return { error: "", type: "", hasGrant: false, code: "" };
  }
  const hash = new URLSearchParams(String(url.hash || "").replace(/^#/, ""));
  const query = url.searchParams;
  const raw = hash.get("error_description") || query.get("error_description") || hash.get("error") || query.get("error") || "";
  return {
    error: decodeMessage(raw),
    type: hash.get("type") || query.get("type") || "",
    hasGrant: hash.has("access_token") || hash.has("refresh_token"),
    code: query.get("code") || ""
  };
}

export function isLoginTab(search, hash) {
  const query = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  if (query.get("mode") === "login") return true;
  const raw = String(hash || "").replace(/^#/, "");
  if (!raw || raw === "login") return raw === "login";
  if (/access_token|refresh_token|error|error_description|type=/.test(raw)) return false;
  return false;
}

export function friendlyAuthError(error) {
  const raw = [
    error && error.message,
    error && error.error_description,
    error && error.msg,
    error && error.details,
    error && error.code
  ].filter(Boolean).join(" ");
  if (/invalid access code/i.test(raw) || /database error saving new user/i.test(raw)) return "Invalid access code.";
  if (/email not confirmed/i.test(raw)) return "Confirm your email first. Open the link in that message, then log in.";
  if (/invalid login credentials/i.test(raw)) return "That email and password don't match.";
  if (/user already registered|already been registered/i.test(raw)) return "An account with that email already exists. Log in instead.";
  if (/otp_expired|invalid or has expired|email link is invalid/i.test(raw)) return "That email link is invalid or expired. Request a new one.";
  if (/signups not allowed|user not found|not allowed/i.test(raw)) return "No account uses that email yet. Sign up with your access code first.";
  const message = (error && error.message) || "";
  if (message && message.length < 180 && !/access_token|refresh_token/i.test(message)) return message;
  return "Something went wrong. Try again.";
}

const MEMORY_KEY = "roleflow.auth.callback";

export function rememberCallback(href) {
  const callback = readAuthCallback(href);
  try {
    if (callback.type || callback.error || callback.hasGrant || callback.code) {
      sessionStorage.setItem(MEMORY_KEY, JSON.stringify({ type: callback.type, error: callback.error }));
    }
  } catch { /* storage can be blocked */ }
  return callback;
}

export function peekCallback() {
  try {
    const raw = sessionStorage.getItem(MEMORY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearCallbackMemory() {
  try { sessionStorage.removeItem(MEMORY_KEY); } catch { /* ignore */ }
}

export function clearAuthParams() {
  const url = new URL(window.location.href);
  let changed = false;
  ["error", "error_description", "error_code", "code", "notice"].forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  });
  const hash = url.hash.replace(/^#/, "");
  if (/access_token|refresh_token|^error=|error_description/.test(hash)) {
    url.hash = "";
    changed = true;
  }
  if (changed) history.replaceState(null, "", url.pathname + url.search + url.hash);
}

function waitForSession(supabase) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value || null);
    };
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (next) {
        data.subscription.unsubscribe();
        finish(next);
      }
    });
    window.setTimeout(() => {
      data.subscription.unsubscribe();
      finish(null);
    }, 1500);
  });
}

export async function resolveSession(supabase, href) {
  const callback = readAuthCallback(href || window.location.href);
  if (callback.code && typeof supabase.auth.exchangeCodeForSession === "function") {
    const exchanged = await supabase.auth.exchangeCodeForSession(callback.code);
    if (exchanged.error) return { session: null, callback, errorMessage: friendlyAuthError(exchanged.error) };
    return { session: exchanged.data?.session || null, callback, errorMessage: "" };
  }
  const first = await supabase.auth.getSession();
  if (first.data?.session) return { session: first.data.session, callback, errorMessage: "" };
  if (callback.error) return { session: null, callback, errorMessage: friendlyAuthError({ message: callback.error }) };
  if (first.error) return { session: null, callback, errorMessage: friendlyAuthError(first.error) };
  if (!callback.hasGrant) return { session: null, callback, errorMessage: "" };
  const session = await waitForSession(supabase);
  return {
    session,
    callback,
    errorMessage: session ? "" : "That email link is invalid or expired. Request a new one."
  };
}
