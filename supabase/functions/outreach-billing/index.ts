// Stripe webhook. verify_jwt is off. The signature is checked with STRIPE_WEBHOOK_SECRET.
// Replays of the same event id are no-ops. Nothing here is deployed by this change.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { applyBilling, DEFAULT_GRACE_DAYS } from "../_shared/outreacher-plan.js";
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
  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: "JSON object required." });
  }
  if (!event.id || !event.type) return json(400, { ok: false, error: "Stripe event id is required." });
  const admin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const noted = await admin.rpc("outreacher_note_stripe_event", { p_event_id: event.id, p_type: event.type });
  if (noted.error) return json(500, { ok: false, error: "The event could not be recorded." });
  if (noted.data !== true) return json(200, { ok: true, duplicate: true });
  const command = interpretStripeEvent(event);
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
    machineId: loaded?.id || crypto.randomUUID()
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
