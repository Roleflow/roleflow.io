// Starts an official Instagram Login for a workspace the caller can edit.
// Returns the hosted consent URL. No vendor name is returned to the browser.

import { startConnect } from "../_shared/ig-gateway.js";
import { adminClient, cors, json, loadGatewayConfig, userClientFrom } from "../_shared/gateway-http.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  const userClient = userClientFrom(req);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(401, { error: "Sign in required." });
  let body: { business_id?: string } = {};
  try { body = await req.json(); } catch (_error) { body = {}; }
  const businessId = String(body.business_id || "");
  if (!UUID.test(businessId)) return json(400, { error: "That business was not found." });
  const allowed = await userClient.rpc("acq_can_edit", { p_workspace: businessId });
  if (allowed.error || allowed.data !== true) return json(403, { error: "You can't edit this business." });
  const admin = adminClient();
  const config = await loadGatewayConfig(admin);
  if (!config.apiKey) return json(200, { configured: false });
  const business = await admin.from("acq_workspaces").select("id, name").eq("id", businessId).maybeSingle();
  if (business.error || !business.data) return json(404, { error: "That business was not found." });
  const existing = await admin.from("ig_gateway_accounts").select("profile_id").eq("business_id", businessId).maybeSingle();
  let result;
  try {
    result = await startConnect({
      apiKey: config.apiKey,
      webhookSecret: config.webhookSecret,
      existingProfileId: existing.data && existing.data.profile_id,
      business: { id: businessId, name: business.data.name },
      fetchImpl: fetch
    });
  } catch (_error) {
    return json(200, { configured: true, error: "Instagram connect could not start." });
  }
  if (!result.configured) return json(200, { configured: false });
  if (result.profileId) {
    const saved = await admin.rpc("acq_gateway_save_profile", { p_business: businessId, p_profile: result.profileId });
    if (saved.error) return json(200, { configured: true, error: "Instagram connect could not start." });
  }
  if (result.error || !result.authUrl) return json(200, { configured: true, error: result.error || "Instagram connect could not start." });
  const issued = await admin.rpc("acq_gateway_issue_state", {
    p_business: businessId,
    p_nonce: result.nonce,
    p_expires: result.expiresAt
  });
  if (issued.error) return json(200, { configured: true, error: "Instagram connect could not start." });
  return json(200, { configured: true, authUrl: result.authUrl });
});
