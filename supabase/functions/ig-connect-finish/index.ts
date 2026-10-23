// Finishes Instagram Login from the signed state. The browser may not still
// have a user session, so this route does not require a user JWT.

import { verifyState } from "../_shared/ig-gateway.js";
import { adminClient, cors, json, loadGatewayConfig } from "../_shared/gateway-http.js";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  let body: { state?: string; account_id?: string; accountId?: string; username?: string } = {};
  try { body = await req.json(); } catch (_error) { body = {}; }
  const state = String(body.state || "");
  const accountId = String(body.account_id || body.accountId || "").slice(0, 200);
  const username = String(body.username || "").slice(0, 80);
  if (state.length > 2000 || !accountId) {
    return json(200, { ok: false, error: "Instagram didn't finish connecting. You can try again from the panel." });
  }
  const admin = adminClient();
  const config = await loadGatewayConfig(admin);
  const secret = config.webhookSecret || config.apiKey;
  if (!secret) return json(200, { ok: false, error: "Instagram connect is not available yet." });
  const checked = verifyState(state, secret, Date.now());
  if (!checked.ok) return json(200, { ok: false, error: "This connection link expired. Start again from the panel." });
  const saved = await admin.rpc("acq_gateway_connect_account", {
    p_business: checked.businessId,
    p_nonce: checked.nonce,
    p_account: accountId,
    p_username: username
  });
  if (saved.error || !saved.data || saved.data.ok !== true) {
    return json(200, { ok: false, error: "This connection link expired. Start again from the panel." });
  }
  return json(200, { ok: true, business_id: checked.businessId, username: saved.data.username || "" });
});
