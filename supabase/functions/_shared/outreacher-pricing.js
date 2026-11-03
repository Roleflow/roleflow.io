// Outreacher price: $249 setup once, then 10% of recorded growth each month,
// with a 3-month minimum. The fee math matches acq_settings.share_bps (1000).

export const OUTREACH_PRICE_COPY = "$249 setup + 10% of growth, 3-month minimum";
export const OUTREACH_SHARE_BPS = 1000;
export const OUTREACH_MINIMUM_MONTHS = 3;
export const OUTREACH_FEE_CURRENCY = "USD";

export function addMonths(date, months) {
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth() + Number(months);
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDay);
  return new Date(Date.UTC(
    year,
    monthIndex,
    day,
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds()
  ));
}

export function assignMinimumTerm(machine, startMs, nowMs) {
  const existing = Date.parse(machine.minimum_term_ends_at || "");
  if (Number.isFinite(existing) && existing > nowMs) return machine.minimum_term_ends_at;
  const start = new Date(Number.isFinite(startMs) ? startMs : nowMs);
  machine.minimum_term_ends_at = addMonths(start, OUTREACH_MINIMUM_MONTHS).toISOString();
  return machine.minimum_term_ends_at;
}

export function checkoutSessionParams({ setupPriceId, growthPriceId, businessId, origin, country }) {
  if (!setupPriceId || !growthPriceId) return { ok: false, reason: "missing_price" };
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("line_items[0][price]", setupPriceId);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[1][price]", growthPriceId);
  params.set("success_url", origin + "/account/acquisition/#outreacher");
  params.set("cancel_url", origin + "/account/acquisition/#outreacher");
  params.set("client_reference_id", businessId);
  params.set("metadata[business_id]", businessId);
  params.set("subscription_data[metadata][business_id]", businessId);
  if (country && /^[a-z]{2}$/i.test(country)) params.set("metadata[proxy_country]", country.toLowerCase());
  return { ok: true, params };
}

export function stripeCancelParams(cancelAtUnix) {
  const params = new URLSearchParams();
  params.set("cancel_at", String(cancelAtUnix));
  params.set("cancel_at_period_end", "false");
  return params;
}

export function stripePeriodEndParams() {
  const params = new URLSearchParams();
  params.set("cancel_at_period_end", "true");
  return params;
}

// A cancellation requested before the minimum ends at the term instant.
// One that is already set to that instant is left alone, so the webhook
// Stripe sends after we schedule it does not schedule itself again.
export function planMinimumTermCancel({ nowMs, minimumTermEndsAt, cancelAt }) {
  const termMs = Date.parse(minimumTermEndsAt || "");
  if (!Number.isFinite(termMs)) return { action: "allow", reason: "no_term" };
  const termUnix = Math.floor(termMs / 1000);
  const termIso = new Date(termUnix * 1000).toISOString();
  const requested = cancelAt == null || cancelAt === "" ? null : Number(cancelAt);
  const requestedOk = Number.isFinite(requested) ? requested : null;
  if (nowMs >= termMs) {
    if (requestedOk != null && requestedOk >= termUnix) {
      return {
        action: "noop",
        reason: "after_term",
        cancelAtUnix: requestedOk,
        cancelAtIso: new Date(requestedOk * 1000).toISOString()
      };
    }
    return { action: "period_end", reason: "term_elapsed" };
  }
  if (requestedOk != null && requestedOk === termUnix) {
    return { action: "noop", reason: "already_scheduled", cancelAtUnix: termUnix, cancelAtIso: termIso };
  }
  if (requestedOk != null && requestedOk > termUnix) {
    return {
      action: "noop",
      reason: "after_term",
      cancelAtUnix: requestedOk,
      cancelAtIso: new Date(requestedOk * 1000).toISOString()
    };
  }
  return { action: "schedule", reason: "before_term", cancelAtUnix: termUnix, cancelAtIso: termIso };
}

export function previousUtcMonth(nowMs) {
  const date = new Date(nowMs);
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0));
  const iso = (value) => value.toISOString().slice(0, 10);
  return {
    periodStart: iso(start),
    periodEnd: iso(end),
    timestamp: Math.floor(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59, 59) / 1000)
  };
}

export function growthFeeCents(amountCents, shareBps) {
  const amount = Number(amountCents);
  const bps = Number(shareBps);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(bps) || bps < 0) return null;
  return Math.round(amount * bps / 10000);
}

export function resolveShareBps(settingsRow) {
  if (!settingsRow) return { ok: true, shareBps: OUTREACH_SHARE_BPS, source: "default" };
  if (settingsRow.share_bps == null || settingsRow.share_bps === "") return { ok: false, reason: "share_bps" };
  const bps = Number(settingsRow.share_bps);
  if (!Number.isFinite(bps)) return { ok: false, reason: "share_bps" };
  return { ok: true, shareBps: bps, source: "acq_settings" };
}

export function utcDate(value) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}

// Attributed deals closed in the month, on or after the machine was created.
// The share is taken once on the sum, the same way the acquisition report does.
export function growthFeeForPeriod(deals, { periodStart, periodEnd, subscribedOn, shareBps, currency }) {
  const rows = [];
  for (const deal of deals || []) {
    if (!deal || deal.attributed !== true) continue;
    const closed = String(deal.closed_on || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closed)) return { ok: false, reason: "closed_on", feeCents: null };
    if (closed < periodStart || closed > periodEnd) continue;
    if (subscribedOn && closed < subscribedOn) continue;
    if (!Number.isFinite(Number(deal.amount_cents)) || Number(deal.amount_cents) < 0) {
      return { ok: false, reason: "amount", feeCents: null };
    }
    rows.push(deal);
  }
  const expected = currency || OUTREACH_FEE_CURRENCY;
  if (rows.some((deal) => String(deal.currency || "") !== expected)) {
    return { ok: false, reason: "currency", feeCents: null };
  }
  const amountCents = rows.reduce((sum, deal) => sum + Number(deal.amount_cents), 0);
  const feeCents = growthFeeCents(amountCents, shareBps);
  if (feeCents == null) return { ok: false, reason: "share_bps", feeCents: null };
  return { ok: true, feeCents, amountCents, dealCount: rows.length, currency: expected };
}

export function usageIdentifier(businessId, periodStart) {
  return "outreach-fee:" + businessId + ":" + periodStart;
}

// Missing Stripe config is inert: no meter call and no report row.
// A zero fee is recorded locally and is not sent to Stripe.
export function planUsageReport({ feeCents, stripeKey, meterEventName, alreadyReported, customerId, businessId, periodStart, feeOk }) {
  if (!stripeKey || !meterEventName) return { action: "inert", reason: "not_configured", stripe: false };
  if (alreadyReported) return { action: "skip", reason: "already_reported", stripe: false };
  if (!customerId) return { action: "skip", reason: "no_customer", stripe: false };
  if (feeOk === false || feeCents == null) return { action: "skip", reason: "fee_unknown", stripe: false };
  if (feeCents === 0) return { action: "record_zero", reason: "zero_fee", stripe: false };
  if (feeCents < 0) return { action: "skip", reason: "negative", stripe: false };
  return {
    action: "report",
    reason: "fee",
    stripe: true,
    identifier: usageIdentifier(businessId, periodStart),
    value: String(feeCents),
    eventName: meterEventName,
    customerId
  };
}

export function meterEventParams({ eventName, customerId, value, identifier, timestamp }) {
  const params = new URLSearchParams();
  params.set("event_name", eventName);
  params.set("payload[stripe_customer_id]", customerId);
  params.set("payload[value]", String(value));
  params.set("identifier", identifier);
  if (timestamp) params.set("timestamp", String(timestamp));
  return params;
}

export function meterEventAccepted(status, payload) {
  if (status >= 200 && status < 300 && payload && payload.identifier) return { ok: true };
  const code = payload && payload.error && payload.error.code;
  if (code === "resource_already_exists") return { ok: true, duplicate: true };
  return { ok: false, reason: code || "stripe_error" };
}

export function cancelAtFromSubscription(payload) {
  const unix = payload && (payload.cancel_at || payload.current_period_end);
  const value = Number(unix);
  if (!Number.isFinite(value) || value <= 0) return "";
  return new Date(value * 1000).toISOString();
}
