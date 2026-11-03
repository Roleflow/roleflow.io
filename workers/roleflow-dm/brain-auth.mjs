// Bootstrap and secret files. The token is shredded after a successful exchange.
// Secrets are mode 0600. The browser user does not receive them.

import { chmodSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { bootstrapFields } from "./brain-nft.mjs";

export const ACCESS_FILE = "/data/secrets/access.jwt";
export const REFRESH_FILE = "/data/secrets/refresh";
export const ENDPOINTS_FILE = "/data/state/endpoints.json";
export const BOOTSTRAP_FILE = "/etc/roleflow/bootstrap";
export const PROXY_FILE = "/run/roleflow/proxy.url";
export const PROXY_NFT_FILE = "/run/roleflow/proxy.nft";
export const BACKUP_KEY_FILE = "/run/roleflow/backup.key";
export const VOLUME_KEY_FILE = "/run/roleflow/volume.key";
export const METADATA_INSTANCE_URL = "http://169.254.169.254/hetzner/v1/metadata/instance-id";

export function writeMode(path, data, mode) {
  writeFileSync(path, data, { mode });
  chmodSync(path, mode);
}

export function shredPath(path, exec) {
  const run = exec || ((command, args) => spawnSync(command, args, { encoding: "utf8" }));
  const result = run("shred", ["-u", path]);
  if (result && result.status === 0) return { ok: true, method: "shred" };
  try {
    writeFileSync(path, Buffer.alloc(4096));
    unlinkSync(path);
    return { ok: true, method: "overwrite" };
  } catch (error) {
    return { ok: false, method: "failed", error: error.message };
  }
}

export async function ensureSession(io) {
  if (await io.exists(io.accessPath) && await io.exists(io.refreshPath)) {
    if (await io.exists(io.bootstrapPath)) await io.shred(io.bootstrapPath);
    return { ok: true, reason: "existing" };
  }
  const text = await io.read(io.bootstrapPath);
  if (!text) return { ok: false, reason: "no_bootstrap" };
  const fields = bootstrapFields(text);
  if (!fields.machine_id || !fields.token) return { ok: false, reason: "no_bootstrap" };
  let serverId = fields.server_id;
  if (!serverId && io.metadata) serverId = String(await io.metadata() || "");
  const result = await io.exchange({
    machineId: fields.machine_id,
    token: fields.token,
    serverId
  });
  const body = result && result.body || result || {};
  if (result && result.status === 425 || body.reason === "identity_pending") return { ok: false, reason: "identity_pending" };
  if (!body.ok || !body.access_token || !body.refresh_token) return { ok: false, reason: "bootstrap_failed" };
  await io.writeSecret(io.accessPath, body.access_token);
  await io.writeSecret(io.refreshPath, body.refresh_token);
  await io.writeJson(io.endpointsPath, {
    supabase_url: fields.supabase_url,
    relay_url: fields.relay_url,
    machine_id: fields.machine_id,
    business_id: body.business_id || ""
  });
  await io.shred(io.bootstrapPath);
  return { ok: true, reason: "bootstrapped", business_id: body.business_id || "", machine_id: fields.machine_id };
}

export function readEndpoints(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (_error) {
    return null;
  }
}

export async function placeRuntimeSecrets(config, io) {
  const next = { ...(config || {}) };
  if (next.proxy_url && io.writeProxy) await io.writeProxy(next.proxy_url);
  if (next.backup_key && io.writeBackupKey) await io.writeBackupKey(next.backup_key);
  if (next.volume_key && io.writeVolumeKey) await io.writeVolumeKey(next.volume_key);
  delete next.proxy_url;
  delete next.backup_key;
  delete next.volume_key;
  return next;
}
