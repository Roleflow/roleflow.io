export const SYNC_SETUP = "Setting up";
export const SYNC_READY = "Setter ready";
export const SYNC_LIVE = "Live";
export const SYNCING = "Syncing";
export const SYNC_FAILED = "Sync failed";

// Page headers show one short, client-safe label. The backend reason goes in
// `detail` (tooltip / admin-only views) so a long or internal error can never
// stretch the header or reach a client as the status pill.

const DONE = new Set(["done", "applied"]);

export function businessSync(input) {
  const source = input || {};
  const preview = String(source.previewSync || "");
  if (preview === "setup") return pack("setup", SYNC_SETUP, "wait");
  if (preview === "ready") return pack("ready", SYNC_READY, "wait");
  if (preview === "live") return pack("live", SYNC_LIVE, "on");
  if (preview === "syncing") return pack("syncing", SYNCING, "wait");
  if (preview === "failed") return pack("failed", SYNC_FAILED, "bad", reasonText(source.previewError));

  const rows = Array.isArray(source.outbox) ? source.outbox : [];
  const creates = rows.filter((row) => row.kind === "create_agent");
  const createPending = creates.some((row) => row.status === "pending");
  const createDone = creates.some((row) => DONE.has(row.status)) || Boolean(String(source.externalAgentId || "").trim());
  const createFailed = newest(creates.filter((row) => row.status === "failed"));
  if (createPending) return pack("setup", SYNC_SETUP, "wait");
  // Engine failures only describe the business when it runs on the engine setter.
  // Businesses on the Roleflow setter can carry stale or intentionally blocked
  // engine jobs; those must not turn every page header red.
  const engineFailures = source.engine !== false;
  if (createFailed && !createDone && engineFailures) return pack("failed", SYNC_FAILED, "bad", reasonText(createFailed.error));

  const others = rows.filter((row) => row.kind !== "create_agent");
  if (others.some((row) => row.status === "pending")) return pack("syncing", SYNCING, "wait");
  const failed = newest(others.filter((row) => row.status === "failed"));
  if (failed && !superseded(others, failed) && engineFailures) return pack("failed", SYNC_FAILED, "bad", reasonText(failed.error));

  const live = source.igStatus === "connected" && source.systemEnabled === true;
  if (live) return pack("live", SYNC_LIVE, "on");
  if (createDone) return pack("ready", SYNC_READY, "wait");
  return pack("setup", SYNC_SETUP, "wait");
}

export function queueSyncNotice(supabase, businessId) {
  if (!supabase || !businessId || !supabase.functions) return;
  supabase.functions.invoke("roleflow-hooks", {
    body: { action: "notify_sync", business_id: businessId }
  }).catch(() => {});
}

function pack(key, label, tone, detail) {
  return { key, label, tone, detail: detail || "" };
}

function newest(rows) {
  return rows.slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0] || null;
}

function superseded(rows, failed) {
  return rows.some((row) => {
    if (row === failed || row.kind !== failed.kind) return false;
    if (!DONE.has(row.status) && row.status !== "pending") return false;
    return String(row.created_at || "") > String(failed.created_at || "");
  });
}

function reasonText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return (text || "The setter could not be updated.").slice(0, 180);
}
