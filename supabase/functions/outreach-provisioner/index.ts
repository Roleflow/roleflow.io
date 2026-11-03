// One-minute provisioner. pg_cron sends the acquisition cron secret. verify_jwt stays off.
// A missing provider token leaves the job pending and raises a Needs Diego item.
// This change does not deploy the function.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { createDigitalOceanProvider } from "../_shared/outreacher-digitalocean.js";
import { createHetznerProvider } from "../_shared/outreacher-hetzner.js";
import { attentionTask } from "../_shared/outreacher-attention.js";
import { offersFromEnv, DEFAULT_HEARTBEAT_MISS_S, DEFAULT_PILOT_CAP, DEFAULT_RETAIN_DAYS, MAX_ATTEMPTS, pilotCount, stepMachine } from "../_shared/outreacher-plan.js";
import { machineKeyEnv, tokenHash } from "../_shared/outreacher-token.js";

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
  const listed = await admin.from("client_machines").select("*").neq("status", "deleted").limit(50);
  if (listed.error) return json(500, { ok: false, error: "Machines could not be read." });
  const rows = listed.data || [];
  const env = buildEnv(rows);
  let stepped = 0;
  for (const row of rows) {
    const proxy = await ensureProxy(admin, row);
    const result = await stepMachine(row, { ...env, proxy: proxy || env.proxy, poolCount: pilotCount(rows) }, {
      providerFor: (name: string) => name === "digitalocean"
        ? createDigitalOceanProvider({ fetch, token: env.doToken })
        : createHetznerProvider({ fetch, token: env.hetznerToken }),
      hashToken: tokenHash,
      pruneBackups: (businessId: string, keep: number) => pruneBackups(admin, businessId, keep),
      deleteBackups: (businessId: string) => deleteBackups(admin, businessId)
    });
    const saved = persistMachine(result.row);
    await admin.from("client_machines").upsert(saved);
    if (saved.bootstrap_token_hash) {
      await admin.rpc("outreacher_save_bootstrap", {
        p_machine: saved.id,
        p_hash: saved.bootstrap_token_hash,
        p_expires: saved.bootstrap_expires_at,
        p_server_id: saved.provider_server_id || "",
        p_ip: saved.ipv4 || ""
      });
    }
    if (result.attention) {
      const task = attentionTask({ code: result.attention, machineId: saved.id, businessId: saved.business_id, detail: saved.last_error || result.attention });
      await admin.rpc("outreacher_raise_attention", {
        p_machine: saved.id,
        p_business: saved.business_id,
        p_code: result.attention,
        p_detail: task.description
      });
    }
    for (const event of result.events || []) {
      await admin.from("client_machine_events").insert({
        machine_id: saved.id,
        business_id: saved.business_id,
        kind: event.kind,
        from_state: event.from_state || null,
        to_state: event.to_state || null,
        detail: event.detail || {}
      });
    }
    if (result.row.proxy_released && row.proxy_id) {
      const until = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
      await admin.from("outreach_proxies").update({
        assigned_machine_id: null,
        reserved_business_id: row.business_id,
        released_at: new Date().toISOString(),
        quarantine_until: until
      }).eq("id", row.proxy_id);
    }
    stepped += 1;
  }
  const machineKeys = machineKeyEnv();
  return json(200, { ok: true, stepped, machine_jwt_configured: Boolean(machineKeys.privateKey && machineKeys.publicKey) });
});

function buildEnv(rows: Record<string, unknown>[]) {
  const order = Deno.env.get("OUTREACH_PROVIDER_ORDER") || "";
  return {
    now: Date.now(),
    imageVersion: Deno.env.get("OUTREACH_IMAGE_VERSION") || "",
    amdImageId: Deno.env.get("OUTREACH_IMAGE_ID_AMD64") || "",
    armImageId: Deno.env.get("OUTREACH_IMAGE_ID_ARM64") || "",
    doImageId: Deno.env.get("OUTREACH_DO_IMAGE_ID") || "",
    hetznerToken: Deno.env.get("HCLOUD_TOKEN") || "",
    doToken: Deno.env.get("DIGITALOCEAN_TOKEN") || "",
    relayUrl: Deno.env.get("OUTREACH_RELAY_URL") || "https://live.roleflow.io",
    relayIps: Deno.env.get("OUTREACH_RELAY_IPS") || "",
    supabaseIps: Deno.env.get("OUTREACH_SUPABASE_IPS") || "",
    registryIps: Deno.env.get("OUTREACH_REGISTRY_IPS") || "",
    dnsIps: Deno.env.get("OUTREACH_DNS_IPS") || "",
    ntpIps: Deno.env.get("OUTREACH_NTP_IPS") || "",
    supabaseUrl: Deno.env.get("SUPABASE_URL") || "",
    pilotCap: numberEnv("OUTREACH_PILOT_CAP", DEFAULT_PILOT_CAP),
    retainDays: numberEnv("OUTREACH_RETAIN_DAYS", DEFAULT_RETAIN_DAYS),
    maxAttempts: numberEnv("OUTREACH_MAX_ATTEMPTS", MAX_ATTEMPTS),
    heartbeatMissS: numberEnv("OUTREACH_HEARTBEAT_MISS_S", DEFAULT_HEARTBEAT_MISS_S),
    offers: offersFromEnv({ providerOrder: order || undefined }),
    proxy: null,
    rows
  };
}

function numberEnv(name: string, fallback: number) {
  const value = Number(Deno.env.get(name) || "");
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function ensureProxy(admin: ReturnType<typeof createClient>, row: Record<string, string>) {
  if (row.proxy_id) {
    const current = await admin.from("outreach_proxies").select("id, host, port, label, country").eq("id", row.proxy_id).maybeSingle();
    if (current.data) return { id: current.data.id, ip: current.data.host, port: current.data.port, label: current.data.label, country: current.data.country };
  }
  if (!row.proxy_country) return null;
  const pool = await admin.from("outreach_proxies").select("id, host, port, label, country, assigned_machine_id, reserved_business_id, quarantine_until").eq("country", row.proxy_country);
  const now = Date.now();
  const free = (pool.data || []).find((item) => !item.assigned_machine_id && (!item.quarantine_until || Date.parse(item.quarantine_until) <= now || item.reserved_business_id === row.business_id));
  if (!free) return null;
  const claimed = await admin.from("outreach_proxies").update({ assigned_machine_id: row.id, reserved_business_id: row.business_id, released_at: null, quarantine_until: null }).eq("id", free.id).is("assigned_machine_id", null).select("id");
  if (!claimed.data || !claimed.data.length) return null;
  await admin.from("client_machines").update({ proxy_id: free.id, proxy_label: free.label, proxy_country: free.country }).eq("id", row.id);
  row.proxy_id = free.id;
  return { id: free.id, ip: free.host, port: free.port, label: free.label, country: free.country };
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

async function pruneBackups(admin: ReturnType<typeof createClient>, businessId: string, keep: number) {
  const listed = await admin.from("outreacher_backups").select("id, path, created_at").eq("business_id", businessId).order("created_at", { ascending: false });
  const extra = (listed.data || []).slice(keep);
  for (const item of extra) {
    await admin.storage.from("outreacher-profiles").remove([item.path]);
    await admin.from("outreacher_backups").delete().eq("id", item.id);
  }
}

async function deleteBackups(admin: ReturnType<typeof createClient>, businessId: string) {
  const listed = await admin.from("outreacher_backups").select("id, path").eq("business_id", businessId);
  const paths = (listed.data || []).map((item) => item.path);
  if (paths.length) await admin.storage.from("outreacher-profiles").remove(paths);
  await admin.from("outreacher_backups").delete().eq("business_id", businessId);
}
