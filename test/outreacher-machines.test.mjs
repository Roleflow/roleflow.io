import assert from "node:assert/strict";
import fs from "node:fs";
import { decideClaim, CLAIM_REASONS, inQuietHours } from "../supabase/functions/_shared/outreacher-claim.js";
import { assertCloudInitSafe, renderCloudInit } from "../supabase/functions/_shared/outreacher-cloudinit.js";
import { buildFirewallRules } from "../supabase/functions/_shared/outreacher-firewall.js";
import { flattenOffers, parseOffers } from "../supabase/functions/_shared/outreacher-offers.js";
import { applyBilling, planMachine, stepMachine } from "../supabase/functions/_shared/outreacher-plan.js";
import { interpretStripeEvent, verifyStripeSignature } from "../supabase/functions/_shared/outreacher-stripe.js";
import {
  authorizeMachineCall,
  evaluateBootstrap,
  evaluateRefresh,
  machineKeyEnv,
  readMachineJwt,
  signMachineJwt,
  tokenHash
} from "../supabase/functions/_shared/outreacher-token.js";

const migration = fs.readFileSync(new URL("../supabase/migrations/20261103190000_client_machines.sql", import.meta.url), "utf8");
const day = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-11-03T18:00:00Z");

const ready = {
  role: "service_role",
  globalKilled: false,
  controls: { enabled: true, killed: false, daily_cap: 20 },
  config: { paused: false, hourly_cap: 6 },
  workforce: { status: "active" },
  settings: { ig_paused: false, system_enabled: true, timezone: "Europe/Madrid", quiet_start: "22:00", quiet_end: "08:00" },
  machine: { status: "running", revoked_at: null, session_state: "ok", sending_mode: "live", subscription_status: "active" },
  dailyCount: 0,
  hourlyCount: 0,
  dnc: false,
  contacted: false,
  target: "ada.north",
  actionKind: "dm",
  quiet: false,
  now: new Date(now)
};

function claim(patch) {
  return decideClaim({ ...ready, ...patch, machine: { ...ready.machine, ...(patch.machine || {}) }, controls: { ...ready.controls, ...(patch.controls || {}) }, config: { ...ready.config, ...(patch.config || {}) }, settings: { ...ready.settings, ...(patch.settings || {}) } });
}

assert.equal(claim({}).ok, true);
assert.equal(claim({}).mode, "live");
for (const [patch, reason] of [
  [{ role: "anon" }, "forbidden"],
  [{ throwError: "db" }, "error"],
  [{ globalMissing: true }, "error"],
  [{ globalKilled: true }, "global_kill"],
  [{ controls: { killed: true } }, "killed"],
  [{ controls: { enabled: false, killed: false } }, "disabled"],
  [{ config: { paused: true } }, "paused"],
  [{ workforce: { status: "paused" } }, "workforce"],
  [{ workforce: null }, "workforce"],
  [{ settings: { ig_paused: true } }, "ig_paused"],
  [{ settings: { system_enabled: false, ig_paused: false } }, "system_off"],
  [{ machine: { subscription_status: "past_due" } }, "subscription"],
  [{ machine: { status: "suspended" } }, "machine"],
  [{ machine: { revoked_at: "2026-11-03T00:00:00Z" } }, "machine"],
  [{ machine: { session_state: "unknown" } }, "session"],
  [{ machine: { session_state: "checkpoint" } }, "session"],
  [{ quiet: true }, "quiet_hours"],
  [{ dailyCount: 20 }, "daily_cap"],
  [{ hourlyCount: 6 }, "hourly_cap"],
  [{ dnc: true }, "dnc"],
  [{ contacted: true }, "already_contacted"],
  [{ target: "not a handle" }, "target"],
  [{ actionKind: "view" }, "claimed"]
]) {
  const result = claim(patch);
  assert.equal(result.reason, reason, reason);
}
assert.equal(claim({ actionKind: "like" }).ok, true);
CLAIM_REASONS.forEach((reason) => assert.match(migration, new RegExp("'" + reason + "'")));
assert.match(migration, /interval '2 minutes'/);
assert.match(migration, /revoke all on function public.outreacher_can_send\(uuid, text, text\) from public, anon, authenticated/);
assert.match(migration, /revoke all on function public.acq_worker_pipeline\(text, text, jsonb\) from public, anon, authenticated/);
assert.doesNotMatch(migration, /grant execute on function public.acq_worker_pipeline\(text, text, jsonb\) to anon/);
assert.match(migration, /claim_required/);
assert.match(migration, /personalised_outreach/);
assert.match(migration, /acq_dm_controls/);
assert.match(migration, /acq_dnc/);
assert.match(migration, /dm_sent_at/);
assert.match(migration, /ig_threads/);
assert.doesNotMatch(migration, /create role outreacher/i);

assert.equal(inQuietHours(new Date("2026-11-03T21:30:00Z"), "Europe/Madrid", "22:00", "08:00"), true);
assert.equal(inQuietHours(new Date("2026-11-03T10:00:00Z"), "Europe/Madrid", "22:00", "08:00"), false);

const offers = flattenOffers(parseOffers(""));
assert.deepEqual(offers.slice(0, 4).map((row) => row.serverType + ":" + row.arch + ":" + row.location), [
  "cx23:amd64:nbg1",
  "cx23:amd64:fsn1",
  "cx23:amd64:hel1",
  "cax11:arm64:nbg1"
]);
assert.equal(offers.at(-1).provider, "digitalocean");
assert.equal(offers.at(-1).serverType, "s-2vcpu-4gb");

const cloud = renderCloudInit({
  machineId: "11111111-1111-4111-8111-111111111111",
  bootstrapToken: "abc123",
  relayUrl: "https://live.roleflow.io",
  supabaseUrl: "https://xrsipofgofvjiskmsgij.supabase.co"
});
assertCloudInitSafe(cloud);
assert.doesNotMatch(cloud, /server_id=|public_ip=|sending_mode|proxy_|HCLOUD|ssh-/);
assert.match(cloud, /machine_id=11111111-1111-4111-8111-111111111111/);
assert.throws(() => renderCloudInit({ machineId: "m", bootstrapToken: "t\nserver_id=1", relayUrl: "https://live.roleflow.io", supabaseUrl: "https://example.com" }));

const rules = buildFirewallRules({
  relayIps: ["203.0.113.10"],
  supabaseIps: ["203.0.113.20"],
  registryIps: ["203.0.113.30"],
  proxyIp: "198.51.100.8",
  proxyPort: "443"
});
assert.equal(rules.ok, true);
assert.equal(rules.rules.some((rule) => rule.direction !== "out"), false);
assert.equal(buildFirewallRules({ relayIps: ["0.0.0.0/0"], supabaseIps: ["203.0.113.20"], registryIps: ["203.0.113.30"], proxyIp: "198.51.100.8", proxyPort: "443" }).ok, false);
assert.equal(buildFirewallRules({ proxyIp: "198.51.100.8", proxyPort: "443" }).reason, "missing_firewall_pins");

const secret = "whsec_test";
const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { payment_status: "paid", client_reference_id: "biz-1", customer: "cus_1", subscription: "sub_1", metadata: { proxy_country: "es" } } } });
const stamp = String(Math.floor(now / 1000));
const sig = await hmac(secret, stamp + "." + payload);
const header = "t=" + stamp + ",v1=" + sig;
assert.equal((await verifyStripeSignature(payload, header, secret, now)).ok, true);
assert.equal((await verifyStripeSignature(payload, header, secret, now + 10 * 60 * 1000)).reason, "tolerance");
assert.equal((await verifyStripeSignature(payload, header, "", now)).reason, "missing_secret");
assert.equal((await verifyStripeSignature(payload + " ", header, secret, now)).reason, "signature");
const command = interpretStripeEvent(JSON.parse(payload));
assert.equal(command.kind, "provision");
assert.equal(command.country, "es");
assert.equal(interpretStripeEvent({ id: "evt_2", type: "invoice.payment_failed", data: { object: { customer: "cus_1", subscription: "sub_1" } } }).kind, "pause");
assert.equal(interpretStripeEvent({ id: "evt_3", type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer: "cus_1" } } }).kind, "pause");

const seen = new Set();
function accept(event) {
  if (seen.has(event.id)) return { duplicate: true };
  seen.add(event.id);
  return { duplicate: false, command: interpretStripeEvent(event) };
}
const first = accept(JSON.parse(payload));
const replay = accept(JSON.parse(payload));
assert.equal(first.duplicate, false);
assert.equal(replay.duplicate, true);

const store = { machines: [], controls: {}, configs: {} };
const created = applyBilling(store, { ...command, eventId: "evt_1", machineId: "m-1" }, now, { graceDays: 5 });
assert.equal(created.created, true);
assert.equal(store.machines[0].status, "pending");
assert.equal(store.machines[0].sending_mode, "off");
const again = applyBilling(store, { ...command, eventId: "evt_9", machineId: "m-2" }, now, { graceDays: 5 });
assert.equal(again.duplicate, true);
assert.equal(store.machines.length, 1);
const paused = applyBilling(store, { kind: "pause", subscriptionId: "sub_1" }, now, { graceDays: 5 });
assert.equal(paused.paused, true);
assert.equal(store.machines[0].status, "pending");
assert.equal(store.controls["biz-1"].enabled, false);
assert.equal(store.configs["biz-1"].paused, true);
assert.equal(Date.parse(store.machines[0].grace_delete_at) - now, 5 * day);

const machine = baseMachine();
const env = baseEnv(now);
const deps = fakeDeps();
let stepped = await drive(machine, env, deps, 6);
assert.equal(stepped.status, "provisioning");
assert.equal(stepped.provider, "hetzner");
assert.equal(stepped.server_type, "cx23");
assert.equal(stepped.arch, "amd64");
assert.equal(stepped.ipv4, "203.0.113.50");
assert.equal(stepped.provider_server_id, "9001");
assert.equal(stepped.volume_id, "vol-1");
assert.ok(deps.calls.some((call) => call.op === "createServer" && call.input.sshKeys.length === 0));
const userData = deps.calls.find((call) => call.op === "createServer").input.userData;
assert.doesNotMatch(userData, /server_id=|public_ip=/);
assert.match(userData, /bootstrap_token=/);
stepped.last_heartbeat_at = new Date(now).toISOString();
stepped = (await stepMachine(stepped, env, deps)).row;
assert.equal(stepped.status, "awaiting_login");
stepped.session_state = "ok";
stepped = (await stepMachine(stepped, env, deps)).row;
assert.equal(stepped.status, "running");

stepped.grace_delete_at = new Date(now + 5 * day).toISOString();
assert.equal((await stepMachine(stepped, env, deps)).row.status, "running");
const afterGrace = await stepMachine(stepped, { ...env, now: now + 5 * day + 1000 }, deps);
assert.equal(afterGrace.row.status, "suspended");
assert.equal(afterGrace.row.volume_id, "vol-1");
assert.equal(afterGrace.row.provider_server_id, "");
assert.ok(deps.calls.some((call) => call.op === "deleteServer"));
const retained = afterGrace.row;
const purged = await stepMachine(retained, { ...env, now: Date.parse(retained.volume_retain_until) + 1000 }, deps);
assert.equal(purged.row.status, "deleted");
assert.equal(purged.row.volume_id, "");
assert.ok(deps.calls.some((call) => call.op === "deleteVolume" && call.id === "vol-1"));

const suspended = { ...baseMachine(), status: "suspended", volume_id: "vol-keep", volume_location: "nbg1", volume_keep: true, subscription_status: "past_due" };
const resumed = applyBilling({ machines: [suspended], controls: {}, configs: {} }, { kind: "resume", businessId: suspended.business_id, subscriptionStatus: "active" }, now, { graceDays: 5 });
assert.equal(resumed.machine.status, "pending");
assert.equal(resumed.machine.volume_id, "vol-keep");
const reattached = await drive(resumed.machine, baseEnv(now), deps, 8);
assert.equal(reattached.volume_id, "vol-keep");
assert.equal(reattached.provider_server_id.length > 0, true);

const stock = fakeDeps({ unavailable: new Set(["cx23"]) });
const fallen = await drive(baseMachine(), baseEnv(now), stock, 40);
assert.equal(fallen.server_type, "cax11");
assert.equal(fallen.arch, "arm64");
assert.equal(fallen.provider, "hetzner");

const inert = await stepMachine(baseMachine(), { ...baseEnv(now), hetznerToken: "" }, fakeDeps());
assert.equal(inert.row.status, "pending");
assert.equal(inert.attention, "missing_provider_token");
const noProxy = await stepMachine(baseMachine(), { ...baseEnv(now), proxy: null }, fakeDeps());
assert.equal(noProxy.attention, "missing_proxy");

const capped = await stepMachine(baseMachine(), { ...baseEnv(now), poolCount: 3, pilotCap: 3 }, fakeDeps());
assert.equal(capped.attention, "pilot_cap");
assert.equal(capped.row.status, "pending");

const booting = { ...baseMachine(), status: "provisioning", provider: "hetzner", provider_server_id: "9001", ipv4: "203.0.113.50", server_running_at: new Date(now - 11 * 60 * 1000).toISOString(), boot_generation: 0, volume_id: "vol-1" };
const timed = await stepMachine(booting, baseEnv(now), fakeDeps());
assert.equal(timed.row.last_error, "health_timeout");
const later = { ...booting, boot_generation: 1, server_running_at: new Date(now - 6 * 60 * 1000).toISOString() };
assert.equal((await stepMachine(later, baseEnv(now), fakeDeps())).row.last_error, "health_timeout");
const fresh = { ...booting, server_running_at: new Date(now - 4 * 60 * 1000).toISOString(), boot_generation: 1 };
assert.equal((await stepMachine(fresh, baseEnv(now), fakeDeps())).decision.type, "idle");

const live = { ...baseMachine(), status: "running", provider_server_id: "9001", last_heartbeat_at: new Date(now - 181 * 1000).toISOString() };
const recent = { ...live, last_heartbeat_at: new Date(now - 120 * 1000).toISOString(), health_alerted: false };
assert.equal((await stepMachine(recent, baseEnv(now), fakeDeps())).decision.type, "idle");
const missed = await stepMachine(live, baseEnv(now), fakeDeps());
assert.equal(missed.attention, "missed_heartbeats");
assert.equal(missed.events[0].kind, "heartbeat_missed");
assert.equal(missed.row.status, "running");
const wider = await stepMachine(live, { ...baseEnv(now), heartbeatMissS: 300 }, fakeDeps());
assert.equal(wider.decision.type, "idle");
assert.match(migration, /function public\.outreacher_machine_secrets\(p_machine_id uuid\)/);
assert.match(migration, /security definer/);
assert.match(migration, /set search_path = ''/);
assert.match(migration, /revoke all on function public\.outreacher_machine_secrets\(uuid\) from public, anon, authenticated/);
assert.match(migration, /grant execute on function public\.outreacher_machine_secrets\(uuid\) to service_role/);
assert.doesNotMatch(migration, /grant execute on function public\.outreacher_machine_secrets\(uuid\) to anon/);
assert.doesNotMatch(migration, /grant execute on function public\.outreacher_machine_secrets\(uuid\) to authenticated/);
assert.doesNotMatch(migration, /grant execute on function public\.outreacher_machine_secrets\(uuid\) to public/);

const hash = await tokenHash("one-time");
assert.equal(evaluateBootstrap({ hash, presentedHash: hash, expiresAt: new Date(now + 1000).toISOString(), boundServerId: "", boundIp: "", serverId: "9001", sourceIp: "203.0.113.50", nowMs: now }).reason, "identity_pending");
const exchanged = evaluateBootstrap({ hash, presentedHash: hash, expiresAt: new Date(now + 1000).toISOString(), boundServerId: "9001", boundIp: "203.0.113.50", serverId: "9001", sourceIp: "203.0.113.50", nowMs: now });
assert.equal(exchanged.ok, true);
const replayed = evaluateBootstrap({ hash, presentedHash: hash, expiresAt: new Date(now + 1000).toISOString(), usedAt: new Date(now).toISOString(), boundServerId: "9001", boundIp: "203.0.113.50", serverId: "9001", sourceIp: "203.0.113.50", nowMs: now });
assert.equal(replayed.revoke, true);
const previous = await tokenHash("old");
const current = await tokenHash("new");
assert.equal(evaluateRefresh({ currentHash: current, previousHash: previous, presentedHash: previous, expiresAt: new Date(now + day).toISOString(), nowMs: now }).revoke, true);

const machineKeys = await es256Pair();
assert.deepEqual(machineKeyEnv((name) => name), {
  privateKey: "OUTREACHER_JWT_PRIVATE_KEY",
  publicKey: "OUTREACHER_JWT_PUBLIC_KEY"
});
const signed = await signMachineJwt({ business_id: "biz-1", machine_id: "m-1" }, machineKeys.privateKey, now);
const read = await readMachineJwt(signed.token, machineKeys.publicKey, now);
assert.equal(read.ok, true);
assert.equal(read.claims.role, "outreacher");
assert.equal(authorizeMachineCall(read.claims, { id: "m-1", business_id: "biz-1", status: "running", revoked_at: null }, now).ok, true);
assert.equal(authorizeMachineCall(read.claims, { id: "m-1", business_id: "biz-1", status: "running", revoked_at: now }, now).reason, "revoked");
assert.equal(authorizeMachineCall(read.claims, { id: "m-1", business_id: "other", status: "running" }, now).reason, "revoked");
assert.equal(authorizeMachineCall(read.claims, { id: "m-1", business_id: "biz-1", status: "deleted" }, now).reason, "revoked");
assert.equal((await readMachineJwt(signed.token, (await es256Pair()).publicKey, now)).ok, false);

assert.match(migration, /provider_server_id/);
assert.match(migration, /bootstrap_token_hash/);
assert.match(migration, /refresh_prev_hash/);
assert.match(migration, /function public.outreacher_can_send\(business_id uuid, action_kind text, target text\)/);
assert.match(migration, /function public.outreacher_claim_check\(claim_id uuid\)/);
assert.match(migration, /function public.outreacher_report_send\(claim_id uuid, result text, detail jsonb\)/);
assert.match(migration, /private.outreach_machine_secrets/);
assert.match(migration, /proxy_url text/);
assert.match(migration, /outreacher-profiles/);
assert.match(migration, /dry_run boolean not null default true/);
assert.doesNotMatch(cloud, /ROLEFLOW_DM_LIVE/);
assert.match(cloud, /ROLEFLOW_APPLY_NFT=1/);
assert.match(migration, /client_machine_events/);
assert.doesNotMatch(migration, /Grok Bot|Zernio/);
assert.match(fs.readFileSync(new URL("../supabase/functions/_shared/outreacher-token.js", import.meta.url), "utf8"), /authorizeMachineCall/);

console.log("outreacher machine tests passed");

function baseMachine() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    business_id: "biz-1",
    status: "pending",
    provider: "hetzner",
    offer_index: 0,
    attempts: 0,
    boot_generation: 0,
    sending_mode: "off",
    session_state: "unknown",
    subscription_status: "active",
    volume_keep: false,
    health_alerted: false
  };
}

function baseEnv(at) {
  return {
    now: at,
    imageVersion: "roleflow-outreacher:2026.11.03",
    amdImageId: "img-amd",
    armImageId: "img-arm",
    doImageId: "img-do",
    hetznerToken: "test-token",
    doToken: "do-token",
    relayIps: "203.0.113.10",
    supabaseIps: "203.0.113.20",
    registryIps: "203.0.113.30",
    proxy: { ip: "198.51.100.8", port: "443" },
    offers: flattenOffers(parseOffers("")),
    pilotCap: 3,
    poolCount: 0,
    relayUrl: "https://live.roleflow.io",
    supabaseUrl: "https://xrsipofgofvjiskmsgij.supabase.co",
    retainDays: 30,
    maxAttempts: 5
  };
}

function fakeDeps(options = {}) {
  const calls = [];
  let servers = 9000;
  const provider = {
    async createVolume(input) {
      calls.push({ op: "createVolume", input });
      return { id: "vol-" + (calls.filter((call) => call.op === "createVolume").length) };
    },
    async deleteVolume(id) { calls.push({ op: "deleteVolume", id }); },
    async createFirewall(input) {
      calls.push({ op: "createFirewall", input });
      assert.equal(input.rules.some((rule) => rule.direction !== "out"), false);
      return { id: "fw-1" };
    },
    async deleteFirewall(id) { calls.push({ op: "deleteFirewall", id }); },
    async createServer(input) {
      calls.push({ op: "createServer", input });
      if (options.unavailable && options.unavailable.has(input.serverType)) {
        const error = new Error("unavailable");
        error.code = "unavailable";
        throw error;
      }
      servers += 1;
      return { id: String(servers), ipv4: "203.0.113.50", status: "running" };
    },
    async getServer(id) { return { id, ipv4: "203.0.113.50", status: "running" }; },
    async deleteServer(id) { calls.push({ op: "deleteServer", id }); }
  };
  return { calls, providerFor: () => provider, hashToken: tokenHash, deleteBackups: async () => { calls.push({ op: "deleteBackups" }); }, pruneBackups: async () => {} };
}

async function drive(row, env, deps, limit) {
  let current = row;
  for (let i = 0; i < limit; i += 1) {
    const result = await stepMachine(current, env, deps);
    current = result.row;
    if (current.provider_server_id && current.ipv4 && current.status === "provisioning") return current;
    if (current.status === "awaiting_login" || current.status === "running" || current.status === "error") return current;
  }
  return current;
}

async function es256Pair() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const priv = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const pub = await crypto.subtle.exportKey("spki", pair.publicKey);
  const pem = (bytes, label) => {
    const b64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
    return "-----BEGIN " + label + "-----\n" + (b64.match(/.{1,64}/g) || []).join("\n") + "\n-----END " + label + "-----";
  };
  return { privateKey: pem(priv, "PRIVATE KEY"), publicKey: pem(pub, "PUBLIC KEY") };
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((part) => part.toString(16).padStart(2, "0")).join("");
}
