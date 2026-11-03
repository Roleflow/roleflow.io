import assert from "node:assert/strict";
import fs from "node:fs";
import { applyBilling } from "../supabase/functions/_shared/outreacher-plan.js";
import { interpretStripeEvent } from "../supabase/functions/_shared/outreacher-stripe.js";
import { shareCents } from "../acquire/model.js";
import {
  OUTREACH_PRICE_COPY,
  addMonths,
  cancelAtFromSubscription,
  checkoutSessionParams,
  growthFeeCents,
  growthFeeForPeriod,
  meterEventAccepted,
  meterEventParams,
  planMinimumTermCancel,
  planUsageReport,
  previousUtcMonth,
  resolveShareBps,
  stripeCancelParams,
  usageIdentifier
} from "../supabase/functions/_shared/outreacher-pricing.js";

const now = Date.parse("2026-11-03T18:00:00Z");
const term = "2027-02-03T18:00:00.000Z";
const termUnix = Math.floor(Date.parse(term) / 1000);

assert.equal(OUTREACH_PRICE_COPY, "$249 setup + 10% of growth, 3-month minimum");
assert.equal(addMonths(new Date(Date.parse("2026-01-31T18:00:00Z")), 3).toISOString(), "2026-04-30T18:00:00.000Z");
assert.equal(addMonths(new Date(now), 3).toISOString(), term);
assert.equal(previousUtcMonth(Date.parse("2026-03-15T00:00:00Z")).periodStart, "2026-02-01");
assert.equal(previousUtcMonth(Date.parse("2026-03-15T00:00:00Z")).periodEnd, "2026-02-28");
assert.equal(previousUtcMonth(Date.parse("2024-03-01T00:00:00Z")).periodEnd, "2024-02-29");

const session = checkoutSessionParams({
  setupPriceId: "price_setup",
  growthPriceId: "price_growth",
  businessId: "11111111-1111-4111-8111-111111111111",
  origin: "https://www.roleflow.io",
  country: "ES"
});
assert.equal(session.ok, true);
assert.equal(session.params.get("mode"), "subscription");
assert.equal(session.params.get("line_items[0][price]"), "price_setup");
assert.equal(session.params.get("line_items[0][quantity]"), "1");
assert.equal(session.params.get("line_items[1][price]"), "price_growth");
assert.equal(session.params.get("line_items[1][quantity]"), null);
assert.equal(session.params.get("metadata[proxy_country]"), "es");
assert.equal(checkoutSessionParams({ setupPriceId: "price_setup", growthPriceId: "" }).ok, false);
assert.equal(checkoutSessionParams({ setupPriceId: "", growthPriceId: "price_growth" }).ok, false);

const before = planMinimumTermCancel({ nowMs: now, minimumTermEndsAt: term, cancelAt: termUnix - 86400 });
assert.equal(before.action, "schedule");
assert.equal(before.cancelAtUnix, termUnix);
assert.equal(stripeCancelParams(before.cancelAtUnix).get("cancel_at"), String(termUnix));
assert.equal(stripeCancelParams(before.cancelAtUnix).get("cancel_at_period_end"), "false");
assert.equal(planMinimumTermCancel({ nowMs: now, minimumTermEndsAt: term, cancelAt: null }).action, "schedule");
assert.equal(planMinimumTermCancel({ nowMs: now, minimumTermEndsAt: term, cancelAt: termUnix }).action, "noop");
assert.equal(planMinimumTermCancel({ nowMs: now, minimumTermEndsAt: term, cancelAt: termUnix + 86400 }).reason, "after_term");
assert.equal(planMinimumTermCancel({ nowMs: Date.parse(term) + 1000, minimumTermEndsAt: term, cancelAt: null }).action, "period_end");
assert.equal(planMinimumTermCancel({ nowMs: now, minimumTermEndsAt: "", cancelAt: 1 }).action, "allow");

const running = {
  id: "m-1",
  business_id: "biz-1",
  status: "running",
  stripe_subscription_id: "sub_1",
  stripe_customer_id: "cus_1",
  minimum_term_ends_at: term,
  subscription_status: "active",
  subscription_cancel_at: null
};
const scheduled = applyBilling({ machines: [{ ...running }], controls: {}, configs: {} }, {
  kind: "cancel_scheduled",
  subscriptionId: "sub_1",
  cancelAtIso: term
}, now, { graceDays: 5 });
assert.equal(scheduled.scheduled, true);
assert.equal(scheduled.machine.status, "running");
assert.equal(scheduled.machine.subscription_cancel_at, term);
assert.equal(scheduled.machine.grace_delete_at, undefined);

const paid = applyBilling({ machines: [{ ...running, subscription_cancel_at: term, grace_delete_at: "2026-11-08T18:00:00.000Z" }], controls: {}, configs: {} }, {
  kind: "resume",
  keepCancel: true,
  subscriptionId: "sub_1",
  subscriptionStatus: "active"
}, now, { graceDays: 5 });
assert.equal(paid.machine.subscription_cancel_at, term);
assert.equal(paid.machine.grace_delete_at, null);
const undone = applyBilling({ machines: [{ ...running, subscription_cancel_at: term }], controls: {}, configs: {} }, {
  kind: "resume",
  clearCancel: true,
  subscriptionId: "sub_1"
}, now, { graceDays: 5 });
assert.equal(undone.machine.subscription_cancel_at, null);

assert.equal(growthFeeCents(105000, 1000), shareCents(105000, 1000));
assert.equal(growthFeeCents(5, 1000), 1);
assert.equal(growthFeeCents(4, 1000), 0);
const february = growthFeeForPeriod([
  { amount_cents: 100000, currency: "USD", attributed: true, closed_on: "2026-02-16" },
  { amount_cents: 5000, currency: "USD", attributed: true, closed_on: "2026-02-20" },
  { amount_cents: 99999, currency: "USD", attributed: false, closed_on: "2026-02-11" },
  { amount_cents: 80000, currency: "USD", attributed: true, closed_on: "2026-01-15" },
  { amount_cents: 100, currency: "USD", attributed: true, closed_on: "2026-02-01" }
], { periodStart: "2026-02-01", periodEnd: "2026-02-28", subscribedOn: "2026-02-15", shareBps: 1000, currency: "USD" });
assert.equal(february.ok, true);
assert.equal(february.amountCents, 105000);
assert.equal(february.feeCents, 10500);
assert.equal(growthFeeForPeriod([
  { amount_cents: 100, currency: "EUR", attributed: true, closed_on: "2026-02-20" }
], { periodStart: "2026-02-01", periodEnd: "2026-02-28", subscribedOn: "2026-02-01", shareBps: 1000, currency: "USD" }).reason, "currency");
assert.equal(resolveShareBps(null).shareBps, 1000);
assert.equal(resolveShareBps({ share_bps: 1000 }).source, "acq_settings");
assert.equal(resolveShareBps({ share_bps: null }).ok, false);

const period = "2026-02-01";
const businessId = "11111111-1111-4111-8111-111111111111";
const inert = planUsageReport({ feeCents: 10500, stripeKey: "", meterEventName: "", alreadyReported: false, customerId: "cus_1", businessId, periodStart: period, feeOk: true });
assert.equal(inert.action, "inert");
assert.equal(inert.stripe, false);
const unnamed = planUsageReport({ feeCents: 10500, stripeKey: "sk_test", meterEventName: "", alreadyReported: false, customerId: "cus_1", businessId, periodStart: period, feeOk: true });
assert.equal(unnamed.action, "inert");
const zero = planUsageReport({ feeCents: 0, stripeKey: "sk_test", meterEventName: "outreacher_growth_fee", alreadyReported: false, customerId: "cus_1", businessId, periodStart: period, feeOk: true });
assert.equal(zero.action, "record_zero");
assert.equal(zero.stripe, false);
const again = planUsageReport({ feeCents: 10500, stripeKey: "sk_test", meterEventName: "outreacher_growth_fee", alreadyReported: true, customerId: "cus_1", businessId, periodStart: period, feeOk: true });
assert.equal(again.action, "skip");
assert.equal(again.stripe, false);
const blocked = planUsageReport({ feeCents: null, stripeKey: "sk_test", meterEventName: "outreacher_growth_fee", alreadyReported: false, customerId: "cus_1", businessId, periodStart: period, feeOk: false });
assert.equal(blocked.action, "skip");
const report = planUsageReport({ feeCents: 10500, stripeKey: "sk_test", meterEventName: "outreacher_growth_fee", alreadyReported: false, customerId: "cus_1", businessId, periodStart: period, feeOk: true });
assert.equal(report.action, "report");
assert.equal(report.stripe, true);
assert.equal(report.value, "10500");
assert.equal(report.identifier, usageIdentifier(businessId, period));
const meter = meterEventParams({ eventName: report.eventName, customerId: "cus_1", value: report.value, identifier: report.identifier, timestamp: 1772323199 });
assert.equal(meter.get("event_name"), "outreacher_growth_fee");
assert.equal(meter.get("payload[stripe_customer_id]"), "cus_1");
assert.equal(meter.get("payload[value]"), "10500");
assert.equal(meter.get("identifier"), "outreach-fee:" + businessId + ":2026-02-01");
assert.equal(meterEventAccepted(200, { identifier: report.identifier }).ok, true);
assert.equal(meterEventAccepted(400, { error: { code: "resource_already_exists" } }).duplicate, true);
assert.equal(meterEventAccepted(400, { error: { code: "meter_event_invalid" } }).ok, false);
assert.equal(cancelAtFromSubscription({ cancel_at: 1790000000 }), new Date(1790000000 * 1000).toISOString());
assert.equal(cancelAtFromSubscription({ current_period_end: 1790000000 }), new Date(1790000000 * 1000).toISOString());
assert.equal(cancelAtFromSubscription({ cancel_at: 0 }), "");
assert.equal(cancelAtFromSubscription({}), "");

const billing = fs.readFileSync(new URL("../supabase/functions/outreach-billing/index.ts", import.meta.url), "utf8");
const usage = fs.readFileSync(new URL("../supabase/functions/outreach-usage/index.ts", import.meta.url), "utf8");
const pricingMigration = fs.readFileSync(new URL("../supabase/migrations/20261103200000_outreacher_pricing.sql", import.meta.url), "utf8");
assert.ok(billing.indexOf('plan.action === "schedule"') < billing.indexOf("outreacher_note_stripe_event"));
assert.ok(billing.indexOf('error: "The minimum term could not be scheduled."') < billing.indexOf("outreacher_note_stripe_event"));
assert.match(usage, /STRIPE_OUTREACH_METER_EVENT_NAME/);
assert.ok(usage.indexOf('reason: "not_configured"') < usage.indexOf("outreach_usage_reports"));
assert.match(pricingMigration, /grant select \(minimum_term_ends_at, subscription_cancel_at\)/);
assert.match(pricingMigration, /revoke all on public\.outreach_usage_reports from public, anon, authenticated/);
assert.match(pricingMigration, /outreach-usage/);
assert.doesNotMatch(pricingMigration, /create policy/i);
assert.match(fs.readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8"), /\[functions\.outreach-usage\]\nverify_jwt = false/);
assert.equal(interpretStripeEvent({ type: "invoice.payment_failed", data: { object: { customer: "cus_1", subscription: "sub_1" } } }).kind, "pause");

console.log("outreacher pricing tests passed");
