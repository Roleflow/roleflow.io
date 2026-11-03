// Stripe webhook. verify_jwt is off. The signature is checked with STRIPE_WEBHOOK_SECRET.
// Replays of the same event id are no-ops. A cancellation inside the 3-month
// minimum is scheduled on Stripe before this event is recorded, so a failed
// schedule is retried. Nothing here is deployed by this change.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { applyBilling, DEFAULT_GRACE_DAYS } from "../_shared/outreacher-plan.js";
import { planMinimumTermCancel, stripeCancelParams, stripePeriodEndParams, cancelAtFromSubscription } from "../_shared/outreacher-pricing.js";
import { interpretStripeEvent, verifyStripeSignature } from "../_shared/outreacher-stripe.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, error: "POST required." });
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
  const raw = await req.text();
  const verified = await verifyStripeSignature(raw, req.headers.get("stripe-signature") || "", secret, Date.now());
  if (!verified.ok) return json(400, { ok: false, error: "Stripe signature was not accepted." });
  let event: { id?: string; type?: string; created?: number; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: "JSON object required." });
  }
  if (!event.id || !event.type) return json(400, { ok: false, error: "Stripe event id is required." });
  const admin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const command = interpretStripeEvent(event);
  if (command.kind === "cancel_requested") {
    const loaded = await loadMachine(admin, command);
    const plan = planMinimumTermCancel({
      nowMs: Date.now(),
      minimumTermEndsAt: loaded?.minimum_term_ends_at || "",
      cancelAt: command.cancelAt
    });
    let cancelAtIso = plan.cancelAtIso || "";
    if (plan.action === "schedule" || plan.action === "period_end") {
      const key = Deno.env.get("STRIPE_SECRET_KEY") || "";
      if (!key || !command.subscriptionId) return json(500, { ok: false, error: "The minimum term could not be scheduled." });
      const scheduled = await postStripeCancel(key, command.subscriptionId, plan);
      if (!scheduled.ok) return json(500, { ok: false, error: "The minimum term could not be scheduled." });
      if (scheduled.cancelAtIso) cancelAtIso = scheduled.cancelAtIso;
    }
    const noted = await admin.rpc("outreacher_note_stripe_event", { p_event_id: event.id, p_type: event.type });
    if (noted.error) return json(500, { ok: false, error: "The event could not be recorded." });
    if (noted.data !== true) return json(200, { ok: true, duplicate: true });
    if (cancelAtIso && loaded) {
      const result = applyBilling({ machines: [loaded], controls: {}, configs: {} }, {
        kind: "cancel_scheduled",
        businessId: loaded.business_id,
        subscriptionId: command.subscriptionId,
        customerId: command.customerId,
        cancelAtIso
      }, Date.now(), { graceDays: numberEnv("OUTREACH_GRACE_DAYS", DEFAULT_GRACE_DAYS) });
      if (result.machine) {
        await admin.from("client_machines").update({ subscription_cancel_at: result.machine.subscription_cancel_at }).eq("id", result.machine.id);
      }
    }
    return json(200, { ok: true, kind: "cancel_requested", action: plan.action });
  }
  const noted = await admin.rpc("outreacher_note_stripe_event", { p_event_id: event.id, p_type: event.type });
  if (noted.error) return json(500, { ok: false, error: "The event could not be recorded." });
  if (noted.data !== true) return json(200, { ok: true, duplicate: true });
  if (command.kind === "ignore") return json(200, { ok: true, ignored: true });
  const loaded = await loadMachine(admin, command);
  const store = {
    machines: loaded ? [loaded] : [],
    controls: {},
    configs: {}
  };
  const result = applyBilling(store, {
    ...command,
    eventId: event.id,
    machineId: loaded?.id || crypto.randomUUID(),
    startMs: event.created ? Number(event.created) * 1000 : Date.now()
  }, Date.now(), { graceDays: numberEnv("OUTREACH_GRACE_DAYS", DEFAULT_GRACE_DAYS) });
  if (!result.ok) return json(400, { ok: false, error: "The checkout is missing a business." });
  if (result.machine) await admin.from("client_machines").upsert(persistMachine(result.machine));
  const businessId = result.machine && result.machine.business_id;
  if (businessId && result.paused) {
    await admin.from("acq_dm_controls").upsert({ business_id: businessId, enabled: false });
    await admin.from("acq_outreacher_config").upsert({ business_id: businessId, paused: true });
    await admin.rpc("outreacher_raise_attention", {
      p_machine: result.machine.id,
      p_business: businessId,
      p_code: "billing",
      p_detail: "Sending is paused. The server stays up until the grace date, then it is deleted and the disk is kept."
    });
  }
  return json(200, { ok: true, kind: command.kind, duplicate: Boolean(result.duplicate) });
});

function numberEnv(name: string, fallback: number) {
  const value = Number(Deno.env.get(name) || "");
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function postStripeCancel(key: string, subscriptionId: string, plan: { action: string; cancelAtUnix?: number; cancelAtIso?: string }) {
  const body = plan.action === "schedule" ? stripeCancelParams(plan.cancelAtUnix) : stripePeriodEndParams();
  const response = await fetch("https://api.stripe.com/v1/subscriptions/" + encodeURIComponent(subscriptionId), {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id) return { ok: false };
  return { ok: true, cancelAtIso: cancelAtFromSubscription(payload) || plan.cancelAtIso || "" };
}

async function loadMachine(admin: ReturnType<typeof createClient>, command: { businessId?: string; subscriptionId?: string; customerId?: string }) {
  let query = admin.from("client_machines").select("*").neq("status", "deleted");
  if (command.businessId) query = query.eq("business_id", command.businessId);
  else if (command.subscriptionId) query = query.eq("stripe_subscription_id", command.subscriptionId);
  else if (command.customerId) query = query.eq("stripe_customer_id", command.customerId);
  else return null;
  const found = await query.limit(1).maybeSingle();
  return found.data || null;
}

function persistMachine(row: Record<string, unknown>) {
  const copy = { ...row };
  delete copy.bootstrap_token;
  delete copy._now;
  delete copy.reactivate;
  delete copy.proxy_released;
  delete copy.backup_count;
  return copy;
}
