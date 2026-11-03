// Daily growth-fee report. pg_cron sends the acquisition cron secret.
// verify_jwt stays off. Until STRIPE_SECRET_KEY and STRIPE_OUTREACH_METER_EVENT_NAME
// are both set, an authorized call returns inert and writes nothing.
// This change does not deploy the function. Until it is deployed, the cron has nothing to reach.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import {
  growthFeeForPeriod,
  meterEventAccepted,
  meterEventParams,
  OUTREACH_FEE_CURRENCY,
  planUsageReport,
  previousUtcMonth,
  resolveShareBps,
  utcDate
} from "../_shared/outreacher-pricing.js";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "POST required." });
  const admin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const secret = await admin.rpc("acq_read_cron_secret");
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!secret.data || bearer !== secret.data) return json(401, { ok: false, error: "Unauthorized." });
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
  const meterEventName = Deno.env.get("STRIPE_OUTREACH_METER_EVENT_NAME") || "";
  if (!stripeKey || !meterEventName) return json(200, { ok: true, inert: true, reason: "not_configured" });
  const currency = (Deno.env.get("STRIPE_OUTREACH_FEE_CURRENCY") || OUTREACH_FEE_CURRENCY).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return json(200, { ok: true, inert: true, reason: "currency" });
  const period = previousUtcMonth(Date.now());
  const listed = await admin.from("client_machines").select("business_id, stripe_customer_id, status, created_at").not("stripe_customer_id", "is", null);
  if (listed.error) return json(500, { ok: false, error: "Machines could not be read." });
  const machines = pickMachines(listed.data || []);
  let reported = 0;
  let recordedZero = 0;
  let skipped = 0;
  let failed = 0;
  for (const machine of machines) {
    const outcome = await reportBusiness(admin, machine, { stripeKey, meterEventName, currency, period });
    if (outcome === "reported") reported += 1;
    else if (outcome === "record_zero") recordedZero += 1;
    else if (outcome === "failed") failed += 1;
    else skipped += 1;
  }
  return json(200, { ok: true, inert: false, period: period.periodStart, reported, recordedZero, skipped, failed });
});

function pickMachines(rows: Array<{ business_id?: string; stripe_customer_id?: string; status?: string; created_at?: string }>) {
  const byBusiness = new Map<string, { business_id: string; stripe_customer_id: string; status: string; created_at: string }>();
  for (const row of rows) {
    if (!row.business_id || !row.stripe_customer_id) continue;
    const current = byBusiness.get(row.business_id);
    if (!current || (current.status === "deleted" && row.status !== "deleted")) {
      byBusiness.set(row.business_id, {
        business_id: row.business_id,
        stripe_customer_id: row.stripe_customer_id,
        status: row.status || "",
        created_at: row.created_at || ""
      });
    }
  }
  return [...byBusiness.values()];
}

async function reportBusiness(
  admin: ReturnType<typeof createClient>,
  machine: { business_id: string; stripe_customer_id: string; created_at: string },
  env: { stripeKey: string; meterEventName: string; currency: string; period: { periodStart: string; periodEnd: string; timestamp: number } }
) {
  const existing = await admin.from("outreach_usage_reports").select("reported_at").eq("business_id", machine.business_id).eq("period_start", env.period.periodStart).maybeSingle();
  if (existing.error) return "failed";
  const settings = await admin.from("acq_settings").select("share_bps").eq("agent_id", machine.business_id).maybeSingle();
  if (settings.error) return "failed";
  const share = resolveShareBps(settings.data);
  const deals = await admin.from("acq_deals").select("amount_cents, currency, attributed, closed_on").eq("agent_id", machine.business_id).eq("attributed", true).gte("closed_on", env.period.periodStart).lte("closed_on", env.period.periodEnd);
  if (deals.error) return "failed";
  const fee = share.ok ? growthFeeForPeriod(deals.data || [], {
    periodStart: env.period.periodStart,
    periodEnd: env.period.periodEnd,
    subscribedOn: utcDate(machine.created_at),
    shareBps: share.shareBps,
    currency: env.currency
  }) : { ok: false, feeCents: null };
  const plan = planUsageReport({
    feeCents: fee.feeCents,
    stripeKey: env.stripeKey,
    meterEventName: env.meterEventName,
    alreadyReported: Boolean(existing.data && existing.data.reported_at),
    customerId: machine.stripe_customer_id,
    businessId: machine.business_id,
    periodStart: env.period.periodStart,
    feeOk: fee.ok
  });
  if (plan.action === "skip" || plan.action === "inert") return plan.action === "inert" ? "skipped" : "skipped";
  if (plan.action === "record_zero") {
    const saved = await admin.from("outreach_usage_reports").insert({
      business_id: machine.business_id,
      period_start: env.period.periodStart,
      period_end: env.period.periodEnd,
      fee_cents: 0,
      currency: env.currency,
      stripe_identifier: null,
      reported_at: new Date().toISOString()
    });
    return saved.error ? "failed" : "record_zero";
  }
  const response = await fetch("https://api.stripe.com/v1/billing/meter_events", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.stripeKey, "Content-Type": "application/x-www-form-urlencoded" },
    body: meterEventParams({
      eventName: plan.eventName,
      customerId: plan.customerId,
      value: plan.value,
      identifier: plan.identifier,
      timestamp: env.period.timestamp
    })
  });
  const payload = await response.json().catch(() => ({}));
  const accepted = meterEventAccepted(response.status, payload);
  if (!accepted.ok) return "failed";
  const saved = await admin.from("outreach_usage_reports").insert({
    business_id: machine.business_id,
    period_start: env.period.periodStart,
    period_end: env.period.periodEnd,
    fee_cents: fee.feeCents,
    currency: env.currency,
    stripe_identifier: plan.identifier,
    reported_at: new Date().toISOString()
  });
  return saved.error ? "failed" : "reported";
}
