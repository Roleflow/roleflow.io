// Checkout and cancellation for a signed-in editor, plus a public status read.
// verify_jwt is off so the public page can ask whether checkout is configured.
// Checkout and cancel still require the caller's user JWT. Status never calls Stripe.
// This change does not deploy the function.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { checkoutAvailable, checkoutSessionParams, planMinimumTermCancel, stripeCancelParams, stripePeriodEndParams, cancelAtFromSubscription } from "../_shared/outreacher-pricing.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, error: "POST required." });
  let body: { business_id?: string; country?: string; action?: string } = {};
  try { body = await req.json(); } catch { body = {}; }
  if (body.action === "status") {
    return json(200, {
      available: checkoutAvailable({
        secret: Deno.env.get("STRIPE_SECRET_KEY") || "",
        setupPriceId: Deno.env.get("STRIPE_OUTREACH_SETUP_PRICE_ID") || "",
        growthPriceId: Deno.env.get("STRIPE_OUTREACH_GROWTH_PRICE_ID") || ""
      })
    });
  }
  const key = Deno.env.get("STRIPE_SECRET_KEY") || "";
  const admin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const userClient = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_ANON_KEY") || "", {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const user = await userClient.auth.getUser();
  if (!user.data.user) return json(401, { ok: false, error: "Sign in again." });
  const businessId = String(body.business_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) return json(400, { ok: false, error: "Choose a business." });
  const allowed = await userClient.rpc("acq_can_edit", { p_workspace: businessId });
  if (allowed.error || allowed.data !== true) return json(403, { ok: false, error: "You cannot change billing for this business." });
  if (body.action === "cancel") return cancelSubscription(admin, key, businessId);
  const setupPriceId = Deno.env.get("STRIPE_OUTREACH_SETUP_PRICE_ID") || "";
  const growthPriceId = Deno.env.get("STRIPE_OUTREACH_GROWTH_PRICE_ID") || "";
  const origin = Deno.env.get("OUTREACH_SITE_ORIGIN") || "https://www.roleflow.io";
  const session = checkoutSessionParams({
    setupPriceId,
    growthPriceId,
    businessId,
    origin,
    country: body.country || ""
  });
  if (!key || !session.ok) return json(200, { ok: false, error: "Checkout is not available right now. Contact Roleflow support." });
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded" },
    body: session.params
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.url) return json(502, { ok: false, error: "Checkout could not be opened." });
  return json(200, { ok: true, url: payload.url });
});

async function cancelSubscription(admin: ReturnType<typeof createClient>, key: string, businessId: string) {
  if (!key) return json(503, { ok: false, error: "Cancellation could not be scheduled. Contact Roleflow support." });
  const found = await admin.from("client_machines").select("id, status, stripe_subscription_id, minimum_term_ends_at, subscription_cancel_at").eq("business_id", businessId).neq("status", "deleted").limit(1).maybeSingle();
  const row = found.data;
  if (found.error || !row || !row.stripe_subscription_id) return json(404, { ok: false, error: "There is no outreacher subscription to cancel." });
  if (row.subscription_cancel_at) return json(200, { ok: true, cancel_at: row.subscription_cancel_at, action: "noop" });
  const plan = planMinimumTermCancel({
    nowMs: Date.now(),
    minimumTermEndsAt: row.minimum_term_ends_at || "",
    cancelAt: null
  });
  if (plan.action === "allow") return json(409, { ok: false, error: "The minimum term is not recorded yet." });
  const body = plan.action === "schedule" ? stripeCancelParams(plan.cancelAtUnix) : stripePeriodEndParams();
  const response = await fetch("https://api.stripe.com/v1/subscriptions/" + encodeURIComponent(row.stripe_subscription_id), {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id) return json(502, { ok: false, error: "Cancellation could not be scheduled. Contact Roleflow support." });
  const cancelAtIso = cancelAtFromSubscription(payload) || plan.cancelAtIso || "";
  if (!cancelAtIso) return json(502, { ok: false, error: "Cancellation could not be scheduled. Contact Roleflow support." });
  const saved = await admin.from("client_machines").update({ subscription_cancel_at: cancelAtIso }).eq("id", row.id);
  if (saved.error) return json(500, { ok: false, error: "Cancellation was scheduled in Stripe and could not be saved here." });
  return json(200, { ok: true, cancel_at: cancelAtIso, action: plan.action });
}
