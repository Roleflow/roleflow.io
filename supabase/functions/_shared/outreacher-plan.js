import { BOOTSTRAP_TTL_MS, randomToken } from "./outreacher-token.js";
import { buildFirewallRules } from "./outreacher-firewall.js";
import { renderCloudInit } from "./outreacher-cloudinit.js";
import { flattenOffers, imageIdFor, parseOffers } from "./outreacher-offers.js";

export const FIRST_BOOT_MS = 10 * 60 * 1000;
export const LATER_BOOT_MS = 5 * 60 * 1000;
export const DEFAULT_HEARTBEAT_MISS_S = 180;

export function heartbeatMissMs(env) {
  const seconds = Number(env && env.heartbeatMissS);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return DEFAULT_HEARTBEAT_MISS_S * 1000;
}
export const DEFAULT_GRACE_DAYS = 5;
export const DEFAULT_RETAIN_DAYS = 30;
export const DEFAULT_PILOT_CAP = 3;
export const PROXY_QUARANTINE_DAYS = 90;
export const MAX_ATTEMPTS = 5;
export const BACKUP_KEEP = 7;

const SERVER_STATUSES = new Set(["provisioning", "awaiting_login", "running", "paused", "stopping"]);

export function pilotCount(rows) {
  return (rows || []).filter((row) => SERVER_STATUSES.has(row.status)).length;
}

export function offersFromEnv(env) {
  return flattenOffers(parseOffers(env && env.providerOrder));
}

function attention(code) {
  return { type: "attention", code };
}

function tokenStillGood(row, now) {
  return row.bootstrap_token_hash && row.bootstrap_expires_at && Date.parse(row.bootstrap_expires_at) > now && !row.bootstrap_used_at;
}

export function planMachine(row, env) {
  const now = env.now;
  const heartbeatMiss = heartbeatMissMs(env);
  if (!row || row.status === "deleted" || row.status === "revoked") return { type: "idle" };
  if (row.status === "deleting") return { type: "purge" };
  if (row.status === "suspended") {
    if (row.volume_retain_until && now >= Date.parse(row.volume_retain_until)) return { type: "purge" };
    if (row.reactivate === true) return { type: "begin" };
    return { type: "idle" };
  }
  const graceDue = row.grace_delete_at && now >= Date.parse(row.grace_delete_at);
  if (row.status === "stopping" || (graceDue && row.status !== "pending")) {
    if (!row.provider_server_id && !row.volume_id) return { type: "mark", status: "deleted", event: "deleted" };
    return { type: "retire_server" };
  }
  if (row.status === "error") {
    if (row.provider_server_id && row.last_heartbeat_at && now - Date.parse(row.last_heartbeat_at) < heartbeatMiss) {
      return { type: "mark", status: row.session_state === "ok" ? "running" : "awaiting_login", event: "recovered" };
    }
    return { type: "idle" };
  }
  if (["awaiting_login", "running", "paused"].includes(row.status)) {
    if (row.status === "awaiting_login" && row.session_state === "ok") {
      return { type: "mark", status: "running", event: "session_ok" };
    }
    if (row.last_heartbeat_at && now - Date.parse(row.last_heartbeat_at) >= heartbeatMiss && !row.health_alerted) {
      return { type: "heartbeat_miss" };
    }
    if (row.backup_count > BACKUP_KEEP) return { type: "prune_backups" };
    return { type: "idle" };
  }
  if (row.status === "provisioning" && row.provider_server_id && row.ipv4) {
    if (row.last_heartbeat_at) {
      return { type: "mark", status: row.session_state === "ok" ? "running" : "awaiting_login", event: "heartbeat" };
    }
    const limit = (row.boot_generation || 0) > 0 ? LATER_BOOT_MS : FIRST_BOOT_MS;
    if (row.server_running_at && now - Date.parse(row.server_running_at) > limit) return { type: "boot_timeout" };
    if (row.bootstrap_expires_at && !row.bootstrap_used_at && now >= Date.parse(row.bootstrap_expires_at)) return { type: "remint" };
    return { type: "idle" };
  }
  if (!env.imageVersion) return attention("missing_image");
  if (!env.proxy) return attention("missing_proxy");
  const rules = buildFirewallRules({
    dnsIps: env.dnsIps,
    ntpIps: env.ntpIps,
    relayIps: env.relayIps,
    supabaseIps: env.supabaseIps,
    registryIps: env.registryIps,
    proxyIp: env.proxy && env.proxy.ip,
    proxyPort: env.proxy && env.proxy.port
  });
  if (!rules.ok) return attention(rules.reason);
  const offers = env.offers || [];
  let offerIndex = row.offer_index || 0;
  let offer = offers[offerIndex];
  if (row.volume_keep && row.volume_location) {
    while (offer && offer.location !== row.volume_location) {
      offerIndex += 1;
      offer = offers[offerIndex];
    }
  }
  if (!offer) return attention(row.volume_keep ? "volume_location" : "no_capacity");
  if (offerIndex !== (row.offer_index || 0)) {
    return { type: "mark", status: row.status, event: "offer_advanced", offer_index: offerIndex };
  }
  if (offer.provider === "hetzner" && !env.hetznerToken) return attention("missing_provider_token");
  if (offer.provider === "digitalocean" && !env.doToken) return attention("missing_provider_token");
  if (!imageIdFor(offer, env)) return attention("missing_image");
  if (row.status === "pending" || row.reactivate === true) {
    if (row.grace_delete_at && !row.provider_server_id) return { type: "mark", status: "deleted", event: "deleted" };
    if ((env.poolCount || 0) >= (env.pilotCap || DEFAULT_PILOT_CAP)) return attention("pilot_cap");
    if (row.next_attempt_at && now < Date.parse(row.next_attempt_at)) return { type: "idle" };
    return { type: "begin" };
  }
  if (row.volume_id && row.volume_location && offer.location !== row.volume_location) {
    if (row.volume_keep) return attention("volume_location");
    return { type: "drop_empty_volume" };
  }
  if (!row.volume_id) return { type: "create_volume", offer };
  if (!row.firewall_id) return { type: "create_firewall", offer, rules: rules.rules };
  if (!row.provider_server_id) return { type: "create_server", offer, rules: rules.rules };
  if (!row.ipv4) return { type: "poll_server" };
  if (!tokenStillGood(row, now)) return { type: "remint", offer };
  return { type: "enter_health" };
}

function stamp(row, patch) {
  return { ...row, ...patch, updated_at: new Date(row._now || Date.now()).toISOString() };
}

function unavailable(error) {
  const text = String((error && (error.code || error.message)) || "");
  return /unavailable|not available|sold out|size_not_available/i.test(text);
}

export async function stepMachine(row, env, deps) {
  const decision = planMachine(row, env);
  const now = env.now;
  const base = { ...row, _now: now };
  if (decision.type === "idle") return { row, decision, events: [] };
  if (decision.type === "attention") {
    return {
      row: stamp(base, { status: row.status === "suspended" ? row.status : (row.status === "provisioning" ? "provisioning" : "pending"), last_error: decision.code }),
      decision,
      events: [{ kind: "needs_attention", detail: { code: decision.code } }],
      attention: decision.code
    };
  }
  if (decision.type === "mark") {
    return {
      row: stamp(base, {
        status: decision.status,
        offer_index: decision.offer_index != null ? decision.offer_index : row.offer_index,
        last_error: decision.status === "running" || decision.status === "awaiting_login" ? "" : row.last_error,
        health_alerted: decision.status === "running" || decision.status === "awaiting_login" ? false : row.health_alerted,
        reactivate: false
      }),
      decision,
      events: [{ kind: decision.event || "state", from_state: row.status, to_state: decision.status }]
    };
  }
  if (decision.type === "begin") {
    return {
      row: stamp(base, { status: "provisioning", reactivate: false, last_error: "", server_running_at: null }),
      decision,
      events: [{ kind: "state", from_state: row.status, to_state: "provisioning" }]
    };
  }
  if (decision.type === "heartbeat_miss") {
    return {
      row: stamp(base, { health_alerted: true, last_error: "missed_heartbeats" }),
      decision,
      events: [{ kind: "heartbeat_missed", detail: { last_heartbeat_at: row.last_heartbeat_at } }],
      attention: "missed_heartbeats"
    };
  }
  if (decision.type === "boot_timeout") {
    const attempts = (row.attempts || 0) + 1;
    const failed = attempts >= (env.maxAttempts || MAX_ATTEMPTS);
    if (!failed && row.provider_server_id) {
      try { await providerForRow(deps, row).deleteServer(row.provider_server_id); } catch { /* retried on the next tick */ }
    }
    return {
      row: stamp(base, {
        attempts,
        status: failed ? "error" : "provisioning",
        last_error: "health_timeout",
        next_attempt_at: new Date(now + Math.min(60, 2 ** attempts) * 60 * 1000).toISOString(),
        provider_server_id: failed ? row.provider_server_id : "",
        ipv4: failed ? row.ipv4 : "",
        server_running_at: null,
        bootstrap_token_hash: failed ? row.bootstrap_token_hash : ""
      }),
      decision,
      events: [{ kind: "health_timeout", detail: { attempts } }],
      attention: failed ? "health_timeout" : ""
    };
  }
  const offer = decision.offer || (env.offers || [])[row.offer_index || 0];
  const provider = deps.providerFor(offer && offer.provider);
  try {
    if (decision.type === "create_volume") {
      const created = await provider.createVolume({
        name: "rf-" + String(row.id).replace(/-/g, "").slice(0, 12),
        location: offer.location,
        sizeGb: 10,
        labels: labels(row)
      });
      return {
        row: stamp(base, { volume_id: created.id, volume_location: offer.location, region: offer.location, provider: offer.provider }),
        decision,
        events: [{ kind: "volume_created", detail: { volume_id: created.id } }]
      };
    }
    if (decision.type === "drop_empty_volume") {
      if (row.volume_id) await providerForRow(deps, row).deleteVolume(row.volume_id);
      return { row: stamp(base, { volume_id: "", volume_location: "", firewall_id: "" }), decision, events: [{ kind: "volume_dropped" }] };
    }
    if (decision.type === "create_firewall") {
      const created = await provider.createFirewall({
        name: "rf-" + String(row.id).replace(/-/g, "").slice(0, 12),
        rules: decision.rules,
        labels: { ...labels(row), rf_role: "outreacher" }
      });
      return { row: stamp(base, { firewall_id: created.id }), decision, events: [{ kind: "firewall_created" }] };
    }
    if (decision.type === "create_server" || decision.type === "mint_bootstrap" || decision.type === "remint") {
      let current = base;
      if (decision.type === "remint" && row.provider_server_id) {
        await providerForRow(deps, row).deleteServer(row.provider_server_id);
        current = stamp(base, {
          provider_server_id: "",
          ipv4: "",
          server_running_at: null,
          bootstrap_token_hash: "",
          bootstrap_expires_at: null,
          boot_generation: (row.boot_generation || 0) + 1
        });
      }
      if (!tokenStillGood(current, now)) {
        const token = deps.mintToken ? deps.mintToken() : randomToken(32);
        const hash = await deps.hashToken(token);
        current = stamp(current, {
          bootstrap_token: token,
          bootstrap_token_hash: hash,
          bootstrap_expires_at: new Date(now + BOOTSTRAP_TTL_MS).toISOString(),
          bootstrap_used_at: null,
          bound_server_id: "",
          bound_ip: ""
        });
      }
      if (decision.type === "mint_bootstrap" && row.provider_server_id && row.ipv4) {
        return {
          row: stamp(current, { bootstrap_token: "" }),
          decision,
          events: [{ kind: "bootstrap_minted" }]
        };
      }
      const userData = renderCloudInit({
        machineId: row.id,
        bootstrapToken: current.bootstrap_token,
        relayUrl: env.relayUrl,
        supabaseUrl: env.supabaseUrl
      });
      const created = await provider.createServer({
        name: "rf-" + String(row.id).replace(/-/g, "").slice(0, 12),
        serverType: offer.serverType,
        arch: offer.arch,
        location: offer.location,
        image: imageIdFor(offer, env),
        volumeId: current.volume_id,
        firewallId: current.firewall_id,
        userData,
        sshKeys: [],
        labels: { ...labels(row), rf_role: "outreacher" }
      });
      return {
        row: stamp(current, {
          provider: offer.provider,
          server_type: offer.serverType,
          arch: offer.arch,
          region: offer.location,
          provider_server_id: created.id,
          ipv4: created.ipv4 || "",
          bound_server_id: created.id,
          bound_ip: created.ipv4 || "",
          server_running_at: created.ipv4 ? new Date(now).toISOString() : null,
          status: "provisioning",
          bootstrap_token: "",
          volume_keep: true,
          image_version: env.imageVersion
        }),
        decision,
        events: [{ kind: "server_created", from_state: row.status, to_state: "provisioning", detail: { server_type: offer.serverType, arch: offer.arch, provider: offer.provider } }]
      };
    }
    if (decision.type === "poll_server") {
      const found = await providerForRow(deps, row).getServer(row.provider_server_id);
      if (!found.ipv4) return { row, decision, events: [] };
      return {
        row: stamp(base, { ipv4: found.ipv4, bound_ip: found.ipv4, bound_server_id: row.provider_server_id, server_running_at: row.server_running_at || new Date(now).toISOString(), status: "provisioning" }),
        decision,
        events: [{ kind: "server_running", to_state: "provisioning" }]
      };
    }
    if (decision.type === "enter_health") {
      return {
        row: stamp(base, { status: "provisioning", server_running_at: row.server_running_at || new Date(now).toISOString() }),
        decision,
        events: [{ kind: "state", from_state: row.status, to_state: "provisioning" }]
      };
    }
    if (decision.type === "retire_server") {
      if (row.provider_server_id) await providerForRow(deps, row).deleteServer(row.provider_server_id);
      if (row.firewall_id) await providerForRow(deps, row).deleteFirewall(row.firewall_id);
      const retain = new Date(now + (env.retainDays || DEFAULT_RETAIN_DAYS) * 24 * 60 * 60 * 1000).toISOString();
      return {
        row: stamp(base, {
          status: "suspended",
          provider_server_id: "",
          ipv4: "",
          firewall_id: "",
          server_running_at: null,
          volume_retain_until: row.volume_retain_until || retain,
          backup_retain_until: row.backup_retain_until || retain,
          grace_delete_at: null,
          proxy_id: "",
          proxy_released: true
        }),
        decision,
        events: [{ kind: "server_deleted", from_state: row.status, to_state: "suspended" }]
      };
    }
    if (decision.type === "purge") {
      if (row.volume_id) await providerForRow(deps, row).deleteVolume(row.volume_id);
      if (deps.deleteBackups) await deps.deleteBackups(row.business_id);
      return {
        row: stamp(base, { status: "deleted", volume_id: "", volume_location: "" }),
        decision,
        events: [{ kind: "purged", from_state: row.status, to_state: "deleted" }]
      };
    }
    if (decision.type === "prune_backups") {
      if (deps.pruneBackups) await deps.pruneBackups(row.business_id, BACKUP_KEEP);
      return { row: stamp(base, { backup_count: BACKUP_KEEP }), decision, events: [{ kind: "backups_pruned" }] };
    }
  } catch (error) {
    if (unavailable(error)) {
      const next = (row.offer_index || 0) + 1;
      const nextOffer = (env.offers || [])[next];
      const clearVolume = !row.volume_keep && nextOffer && row.volume_location && nextOffer.location !== row.volume_location && row.volume_id;
      if (clearVolume) {
        try { await providerForRow(deps, row).deleteVolume(row.volume_id); } catch { /* the next tick retries */ }
      }
      return {
        row: stamp(base, {
          offer_index: next,
          provider_server_id: "",
          last_error: "type_unavailable",
          volume_id: clearVolume ? "" : row.volume_id,
          volume_location: clearVolume ? "" : row.volume_location,
          firewall_id: clearVolume ? "" : row.firewall_id
        }),
        decision,
        events: [{ kind: "offer_skipped", detail: { server_type: offer && offer.serverType, location: offer && offer.location } }]
      };
    }
    const attempts = (row.attempts || 0) + 1;
    const failed = attempts >= (env.maxAttempts || MAX_ATTEMPTS);
    return {
      row: stamp(base, {
        attempts,
        status: failed ? "error" : row.status,
        last_error: String(error && error.message || "provider_error").slice(0, 300),
        next_attempt_at: new Date(now + Math.min(60, 2 ** attempts) * 60 * 1000).toISOString()
      }),
      decision,
      events: [{ kind: "provider_error", detail: { attempts } }],
      attention: failed ? "provider_error" : ""
    };
  }
  return { row, decision, events: [] };
}

function labels(row) {
  return { rf_business: row.business_id, rf_machine: row.id };
}

function providerForRow(deps, row) {
  return deps.providerFor(row.provider || "hetzner");
}

export function applyBilling(store, command, now, config) {
  const graceDays = (config && config.graceDays) || DEFAULT_GRACE_DAYS;
  const grace = new Date(now + graceDays * 24 * 60 * 60 * 1000).toISOString();
  const machines = store.machines.filter((row) => row.business_id === command.businessId || (command.subscriptionId && row.stripe_subscription_id === command.subscriptionId) || (command.customerId && row.stripe_customer_id === command.customerId));
  const live = machines.find((row) => row.status !== "deleted");
  if (command.kind === "provision") {
    if (!command.businessId) return { ok: false, reason: "missing_business" };
    if (live && live.status !== "suspended" && live.status !== "error") return { ok: true, duplicate: true, machine: live };
    if (live && (live.status === "suspended" || live.status === "error")) {
      live.reactivate = true;
      live.status = "pending";
      live.subscription_status = "active";
      live.grace_delete_at = null;
      live.stripe_subscription_id = command.subscriptionId || live.stripe_subscription_id;
      live.stripe_customer_id = command.customerId || live.stripe_customer_id;
      live.proxy_country = command.country || live.proxy_country;
      live.offer_index = 0;
      live.provider_server_id = "";
      live.ipv4 = "";
      live.attempts = 0;
      return { ok: true, reactivated: true, machine: live };
    }
    const created = {
      id: command.machineId,
      business_id: command.businessId,
      stripe_customer_id: command.customerId || "",
      stripe_subscription_id: command.subscriptionId || "",
      stripe_event_id: command.eventId,
      provider: "hetzner",
      status: "pending",
      subscription_status: "active",
      session_state: "unknown",
      sending_mode: "off",
      proxy_country: command.country || "",
      offer_index: 0,
      attempts: 0,
      boot_generation: 0,
      revoked_at: null
    };
    store.machines.push(created);
    return { ok: true, created: true, machine: created };
  }
  if (command.kind === "pause") {
    if (!live) return { ok: true, missing: true };
    live.subscription_status = "past_due";
    live.grace_delete_at = live.grace_delete_at || grace;
    store.controls[live.business_id] = { ...(store.controls[live.business_id] || {}), enabled: false };
    store.configs[live.business_id] = { ...(store.configs[live.business_id] || {}), paused: true };
    return { ok: true, paused: true, machine: live };
  }
  if (command.kind === "resume") {
    if (!live) return { ok: true, missing: true };
    live.subscription_status = command.subscriptionStatus || "active";
    live.grace_delete_at = null;
    if (live.status === "suspended" || live.status === "error") {
      live.status = "pending";
      live.reactivate = true;
      live.offer_index = 0;
      live.provider_server_id = "";
      live.ipv4 = "";
      live.firewall_id = "";
    }
    return { ok: true, resumed: true, machine: live };
  }
  return { ok: true, ignored: true };
}
