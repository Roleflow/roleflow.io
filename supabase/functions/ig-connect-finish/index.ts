// Finishes Instagram Login from the signed state. The browser may not still
// have a user session, so this route does not require a user JWT.
// GET is the hosted return before the panel page is published. POST is the
// panel page. Neither response includes a vendor name or a secret.

import { callbackFailure, verifyState } from "../_shared/ig-gateway.js";
import { adminClient, cors, json, loadGatewayConfig } from "../_shared/gateway-http.js";

const PANEL = "https://www.roleflow.io/account/acquisition/";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  let body: { state?: string; account_id?: string; accountId?: string; username?: string; error?: string; platform_error_reason?: string } = {};
  if (req.method === "GET") {
    body = {
      state: url.searchParams.get("state") || "",
      accountId: url.searchParams.get("accountId") || "",
      username: url.searchParams.get("username") || "",
      error: url.searchParams.get("error") || "",
      platform_error_reason: url.searchParams.get("platform_error_reason") || ""
    };
  } else if (req.method === "POST") {
    try { body = await req.json(); } catch (_error) { body = {}; }
  } else {
    return json(405, { error: "Use POST." });
  }
  const result = await finish(body);
  if (req.method === "GET") return redirect(result);
  return json(200, result.ok
    ? { ok: true, business_id: result.businessId, username: result.username }
    : { ok: false, error: result.error });
});

async function finish(body: { state?: string; account_id?: string; accountId?: string; username?: string; error?: string; platform_error_reason?: string }) {
  const params = new URLSearchParams();
  if (body.error) params.set("error", body.error);
  if (body.platform_error_reason) params.set("platform_error_reason", body.platform_error_reason);
  const failure = callbackFailure(params);
  if (failure) return { ok: false, error: failure, businessId: "" };
  const state = String(body.state || "");
  const accountId = String(body.account_id || body.accountId || "").slice(0, 200);
  const username = String(body.username || "").slice(0, 80);
  if (state.length > 2000 || !accountId) {
    return { ok: false, error: "Instagram didn't finish connecting. You can try again from the panel.", businessId: "" };
  }
  const admin = adminClient();
  const config = await loadGatewayConfig(admin);
  const secret = config.webhookSecret || config.apiKey;
  if (!secret) return { ok: false, error: "Instagram connect is not available yet.", businessId: "" };
  const checked = verifyState(state, secret, Date.now());
  if (!checked.ok) return { ok: false, error: "This connection link expired. Start again from the panel.", businessId: "" };
  const saved = await admin.rpc("acq_gateway_connect_account", {
    p_business: checked.businessId,
    p_nonce: checked.nonce,
    p_account: accountId,
    p_username: username
  });
  if (saved.error || !saved.data || saved.data.ok !== true) {
    const code = saved.data && saved.data.error;
    const error = code === "taken"
      ? "That Instagram account is already connected to another workspace. Disconnect it there, then try again."
      : "This connection link expired. Start again from the panel.";
    return { ok: false, error, businessId: checked.businessId };
  }
  return { ok: true, error: "", businessId: checked.businessId, username: String(saved.data.username || "") };
}

function redirect(result: { ok: boolean; error?: string; businessId?: string }) {
  const url = new URL(PANEL);
  if (result.businessId) url.searchParams.set("business", result.businessId);
  if (result.ok) url.searchParams.set("ig", "connected");
  else url.searchParams.set("notice", result.error || "Instagram didn't finish connecting. You can try again from the panel.");
  url.hash = "integrations";
  return Response.redirect(url.toString(), 302);
}
