export function scopeBusiness(authBusinessId, requestedBusinessId) {
  if (!authBusinessId) return { ok: false, status: 401, error: "Unauthorized." };
  if (requestedBusinessId && requestedBusinessId !== authBusinessId) {
    return { ok: false, status: 403, error: "That worker key is for a different business." };
  }
  return { ok: true, businessId: authBusinessId };
}

export function connectionHealth(row, now = Date.now()) {
  if (!row || row.status === "disconnected" || !row.ig_user_id) return { status: "disconnected", label: "Not connected" };
  if (row.status === "error") return { status: "error", label: row.last_error || "Needs a reconnect" };
  const exp = row.expires_at ? new Date(row.expires_at).getTime() : NaN;
  if (!Number.isFinite(exp) || exp <= now) return { status: "expired", label: "Token expired" };
  if (exp - now < 7 * 24 * 60 * 60 * 1000) return { status: "refresh_due", label: "Refresh due" };
  return { status: "connected", label: row.username ? "@" + String(row.username).replace(/^@/, "") : "Connected" };
}

export function workerHealth(row, now = Date.now()) {
  if (!row) return { status: "missing", label: "No worker" };
  if (!row.enabled || row.status === "paused") return { status: "paused", label: row.pause_reason ? "Paused: " + row.pause_reason : "Off" };
  const beat = row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : NaN;
  if (!Number.isFinite(beat) || now - beat > 10 * 60 * 1000) return { status: "offline", label: "Offline" };
  return { status: "online", label: "Online" };
}

export function routeByIgUser(igUserId, connections) {
  const id = String(igUserId || "");
  if (!id) return null;
  const matches = (connections || []).filter((row) => row && row.ig_user_id === id && row.status === "connected");
  if (matches.length !== 1) return null;
  return matches[0].business_id;
}
