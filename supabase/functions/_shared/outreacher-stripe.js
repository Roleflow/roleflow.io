import { hmacHex, timingSafeEqual } from "./outreacher-token.js";

export async function verifyStripeSignature(rawBody, header, secret, nowMs, toleranceSec = 300) {
  if (!secret) return { ok: false, reason: "missing_secret" };
  const parts = {};
  String(header || "").split(",").forEach((piece) => {
    const index = piece.indexOf("=");
    if (index > 0) parts[piece.slice(0, index).trim()] = piece.slice(index + 1).trim();
  });
  const stamp = parts.t;
  const given = parts.v1;
  if (!stamp || !given || !/^\d+$/.test(stamp)) return { ok: false, reason: "bad_header" };
  const age = Math.abs(Math.floor(Number(nowMs) / 1000) - Number(stamp));
  if (age > toleranceSec) return { ok: false, reason: "tolerance" };
  const expected = await hmacHex(secret, stamp + "." + String(rawBody || ""));
  if (!timingSafeEqual(expected, given)) return { ok: false, reason: "signature" };
  return { ok: true };
}

export function interpretStripeEvent(event) {
  const type = event && event.type;
  const object = event && event.data && event.data.object ? event.data.object : {};
  if (type === "checkout.session.completed") {
    const paid = object.payment_status === "paid" || object.payment_status === "no_payment_required" || object.status === "complete";
    if (!paid) return { kind: "ignore", reason: "unpaid" };
    const businessId = (object.metadata && object.metadata.business_id) || object.client_reference_id || "";
    return {
      kind: "provision",
      businessId: String(businessId || ""),
      customerId: typeof object.customer === "string" ? object.customer : (object.customer && object.customer.id) || "",
      subscriptionId: typeof object.subscription === "string" ? object.subscription : (object.subscription && object.subscription.id) || "",
      country: (object.metadata && object.metadata.proxy_country) || ""
    };
  }
  if (type === "invoice.payment_failed") {
    return {
      kind: "pause",
      customerId: typeof object.customer === "string" ? object.customer : "",
      subscriptionId: typeof object.subscription === "string" ? object.subscription : ""
    };
  }
  if (type === "customer.subscription.deleted") {
    return {
      kind: "pause",
      customerId: typeof object.customer === "string" ? object.customer : "",
      subscriptionId: object.id || ""
    };
  }
  if (type === "invoice.paid") {
    return {
      kind: "resume",
      keepCancel: true,
      customerId: typeof object.customer === "string" ? object.customer : "",
      subscriptionId: typeof object.subscription === "string" ? object.subscription : "",
      subscriptionStatus: "active"
    };
  }
  if (type === "customer.subscription.updated") {
    const customerId = typeof object.customer === "string" ? object.customer : "";
    const subscriptionId = object.id || "";
    if (cancellationRequested(object)) {
      return {
        kind: "cancel_requested",
        customerId,
        subscriptionId,
        cancelAt: object.cancel_at == null || object.cancel_at === "" ? null : Number(object.cancel_at),
        cancelAtPeriodEnd: object.cancel_at_period_end === true,
        subscriptionStatus: object.status || ""
      };
    }
    const status = object.status || "";
    if (status === "active" || status === "trialing") {
      return {
        kind: "resume",
        clearCancel: true,
        customerId,
        subscriptionId,
        subscriptionStatus: status === "trialing" ? "trialing" : "active"
      };
    }
  }
  return { kind: "ignore", reason: type || "unknown" };
}

function cancellationRequested(object) {
  if (!object) return false;
  if (object.cancel_at_period_end === true) return true;
  if (object.cancel_at) return true;
  const reason = object.cancellation_details && object.cancellation_details.reason;
  return typeof reason === "string" && reason.length > 0;
}
