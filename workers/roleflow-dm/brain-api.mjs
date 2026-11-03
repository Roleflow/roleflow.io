// The machine calls the acquisition-bot edge function and nothing else in Supabase.

import { publicLog } from "./brain-guard.mjs";

export function machineEndpoint(base) {
  const root = String(base || "").replace(/\/$/, "");
  if (!root || /\/rest\/v1\b/i.test(root)) throw new Error("The machine can only call edge functions.");
  if (root.endsWith("/functions/v1/acquisition-bot")) return root;
  return root + "/functions/v1/acquisition-bot";
}

export function createApi({ base, readAccess, readRefresh, writeTokens, fetchImpl, log }) {
  const sink = typeof log === "function" ? log : () => {};
  const fetchFn = fetchImpl || fetch;

  async function refresh() {
    const refreshToken = await readRefresh();
    if (!refreshToken) return { ok: false, reason: "no_refresh" };
    const response = await fetchFn(machineEndpoint(base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "refresh", refresh_token: refreshToken })
    });
    const payload = await response.json().catch(() => ({}));
    sink(publicLog({ action: "refresh", ok: payload.ok === true, status: response.status, reason: payload.reason || payload.error || "" }));
    if (!response.ok || payload.ok !== true || !payload.access_token || !payload.refresh_token) {
      return { ok: false, reason: payload.error === "Unauthorized." ? "revoked" : "refresh_failed" };
    }
    await writeTokens(payload.access_token, payload.refresh_token);
    return { ok: true };
  }

  async function call(body, attempt = 0) {
    const headers = { "content-type": "application/json" };
    if (body.action !== "bootstrap" && body.action !== "refresh") {
      const access = await readAccess();
      if (access) headers.authorization = "Bearer " + access;
    }
    const response = await fetchFn(machineEndpoint(base), {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    sink(publicLog({ action: body.action, ok: payload.ok !== false && response.ok, status: response.status, reason: payload.reason || payload.error || "" }));
    if (response.status === 401 && attempt === 0 && body.action !== "refresh" && body.action !== "bootstrap") {
      const rotated = await refresh();
      if (!rotated.ok) return { ok: false, status: 401, reason: rotated.reason || "unauthorized" };
      return call(body, 1);
    }
    return { ...payload, ok: response.ok && payload.ok !== false, status: response.status };
  }

  return {
    exchange({ machineId, token, serverId }) {
      return call({ action: "bootstrap", machine_id: machineId, bootstrap_token: token, server_id: serverId });
    },
    heartbeat(fields) { return call({ action: "heartbeat", ...(fields || {}) }); },
    config() { return call({ action: "config" }); },
    qualify(profile, trigger) { return call({ action: "qualify", profile, trigger }); },
    draft(profile, trigger) { return call({ action: "draft", profile, trigger }); },
    claim({ kind, target }) { return call({ action: "claim", action_kind: kind, target }); },
    claimCheck({ claim_id }) { return call({ action: "claim_check", claim_id }); },
    report(fields) { return call({ action: "report_send", ...(fields || {}) }); },
    logEvent(fields) { return call({ action: "log_event", ...(fields || {}) }); },
    backupSlot() { return call({ action: "backup_slot" }); },
    backupCommit(fields) { return call({ action: "backup_commit", ...(fields || {}) }); },
    refresh
  };
}
