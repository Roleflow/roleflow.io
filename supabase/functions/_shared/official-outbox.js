import { API_BASE, interpretSend, sendRequest } from "./ig-gateway.js";

// The webhook waits at most this long inside the request. A longer configured
// delay is stored on the outbox row and sent by the one-minute tick.
export const INLINE_WAIT_SECONDS = 25;

export function waitsInline(seconds) {
  const wait = Number(seconds);
  return Number.isFinite(wait) && wait <= INLINE_WAIT_SECONDS;
}

export function officialReady(row, now) {
  if (!row || row.transport !== "official" || row.status !== "pending") return false;
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  if (payload.needsPlan === true) return false;
  if (!String(payload.text || "").trim()) return false;
  const due = Date.parse(row.run_at || "");
  return Number.isFinite(due) && due <= now;
}

export function claimOfficial(rows, now, limit) {
  const cap = Math.min(10, Math.max(1, Number(limit) || 5));
  const picked = [];
  const seen = new Set();
  const sorted = [...(rows || [])].sort((left, right) => Date.parse(left.run_at || "") - Date.parse(right.run_at || ""));
  for (const row of sorted) {
    if (picked.length >= cap) break;
    if (!officialReady(row, now)) continue;
    const key = String(row.idempotency_key || row.id || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    picked.push({ ...row, status: "running", attempts: (Number(row.attempts) || 0) + 1 });
  }
  return picked;
}

export async function postOfficial(row, apiKey, fetchImpl) {
  if (!apiKey || !row || !row.payload || !String(row.payload.text || "").trim()) {
    return { ok: false, status: "failed", error: "The reply was not sent." };
  }
  const request = sendRequest(row);
  const fetchFn = fetchImpl || fetch;
  try {
    const response = await fetchFn(API_BASE + request.path, {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(request.body)
    });
    const payload = await response.json().catch(() => ({}));
    return interpretSend(response.status, payload);
  } catch (_error) {
    return { ok: false, status: "failed", error: "The reply was not sent." };
  }
}
