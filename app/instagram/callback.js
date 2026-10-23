export function callbackFailure(params) {
  const error = String(params.get("error") || "");
  if (!error) return "";
  const reason = String(params.get("platform_error_reason") || "");
  if (error === "oauth_denied" || reason === "user_denied" || reason === "access_denied") {
    return "Instagram didn't allow the connection. You can try again from the panel.";
  }
  return "Instagram didn't finish connecting. You can try again from the panel.";
}

export function panelReturn(businessId) {
  return "/account/acquisition/?business=" + encodeURIComponent(businessId) + "&ig=connected#integrations";
}

const GENERIC = "Instagram didn't finish connecting. You can try again from the panel.";

export async function finishConnect({ params, fetchImpl, config }) {
  const failure = callbackFailure(params);
  if (failure) return { ok: false, error: failure };
  const state = params.get("state") || "";
  const accountId = params.get("accountId") || "";
  const username = params.get("username") || "";
  if (!state || !accountId || !config || !config.url || !config.key) return { ok: false, error: GENERIC };
  const response = await fetchImpl(String(config.url).replace(/\/$/, "") + "/functions/v1/ig-connect-finish", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: config.key,
      authorization: "Bearer " + config.key
    },
    body: JSON.stringify({ state, account_id: accountId, username })
  });
  const data = await response.json().catch(() => ({}));
  if (!data.ok || !data.business_id) return { ok: false, error: data.error || GENERIC };
  return { ok: true, redirect: panelReturn(data.business_id) };
}

function bootCallback() {
  const params = new URLSearchParams(location.search);
  const status = document.getElementById("ig-status");
  const actions = document.getElementById("ig-actions");
  const cfg = globalThis.ROLEFLOW_SUPABASE || {};
  finishConnect({
    params,
    fetchImpl: globalThis.fetch.bind(globalThis),
    config: { url: cfg.SUPABASE_URL || "", key: cfg.SUPABASE_ANON_KEY || "" }
  }).then((result) => {
    if (result.ok && result.redirect) {
      location.replace(result.redirect);
      return;
    }
    status.textContent = result.error || GENERIC;
    actions.hidden = false;
  }).catch(() => {
    status.textContent = GENERIC;
    actions.hidden = false;
  });
}

if (globalThis.document && document.getElementById("ig-callback")) bootCallback();
