// Host firewall rules shipped in the image. Chromium may reach only the proxy.
// The agent may reach metadata, DNS, NTP, and the control HTTPS set.
// This file prints hostnames only. It never prints a bootstrap token.

import { readFileSync, writeFileSync } from "node:fs";

export function parseBootstrapFile(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : {};
  }
  const out = {};
  for (const line of String(text || "").split(/\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

export function bootstrapFields(text) {
  const raw = parseBootstrapFile(text);
  return {
    machine_id: String(raw.machine_id || raw.machineId || "").trim(),
    token: String(raw.bootstrap_token || raw.token || "").trim(),
    server_id: String(raw.server_id || raw.serverId || "").trim(),
    supabase_url: String(raw.supabase_url || raw.supabaseUrl || "").trim(),
    relay_url: String(raw.relay_url || raw.relayUrl || "").trim()
  };
}

export function hostsFromBootstrap(text) {
  const fields = bootstrapFields(text);
  return [fields.supabase_url, fields.relay_url].map(hostOf).filter(Boolean);
}

function hostOf(value) {
  if (!value) return "";
  try {
    return new URL(value).hostname;
  } catch (_error) {
    return "";
  }
}

function looksLikeIp(value) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value) || String(value).includes(":");
}

export function parseProxy(urlString, resolveHost) {
  let url;
  try {
    url = new URL(urlString);
  } catch (_error) {
    return { ok: false, reason: "proxy_invalid" };
  }
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (!Number.isFinite(port) || port <= 0) return { ok: false, reason: "proxy_invalid" };
  const resolved = typeof resolveHost === "function" ? resolveHost(url.hostname) : (looksLikeIp(url.hostname) ? url.hostname : "");
  if (!resolved) return { ok: false, reason: "proxy_unresolved" };
  const user = decodeURIComponent(url.username || "");
  const pass = decodeURIComponent(url.password || "");
  const auth = user ? user + ":" + pass + "@" : "";
  return {
    ok: true,
    ip: resolved,
    port,
    serverArg: url.protocol + "//" + auth + resolved + ":" + port
  };
}

export function renderNftables({ chromiumUid, agentUid, controlIps }) {
  const chromium = Number(chromiumUid);
  const agent = Number(agentUid);
  if (!Number.isFinite(chromium) || !Number.isFinite(agent)) {
    throw new Error("nftables needs the chromium and agent user ids.");
  }
  const ips = (controlIps || []).filter(Boolean);
  const elements = ips.length ? " elements = { " + ips.join(", ") + " }" : "";
  return [
    "table inet roleflow {",
    "  set proxy_v4 { type ipv4_addr; flags interval; }",
    "  set proxy_port { type inet_service; }",
    "  set control_v4 { type ipv4_addr; flags interval;" + elements + " }",
    "  chain output {",
    "    type filter hook output priority 0; policy accept;",
    "    meta skuid " + chromium + " ip daddr 169.254.169.254 drop",
    "    meta skuid " + chromium + " meta l4proto udp drop",
    "    meta skuid " + chromium + " tcp dport 53 drop",
    "    meta skuid " + chromium + " ip daddr @proxy_v4 tcp dport @proxy_port accept",
    "    meta skuid " + chromium + " drop",
    "    meta skuid " + agent + " ip daddr 169.254.169.254 tcp dport 80 accept",
    "    meta skuid " + agent + " udp dport 53 accept",
    "    meta skuid " + agent + " tcp dport 53 accept",
    "    meta skuid " + agent + " udp dport 123 accept",
    "    meta skuid " + agent + " ip daddr @control_v4 tcp dport 443 accept",
    "  }",
    "}",
    ""
  ].join("\n");
}

function arg(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : "";
}

if (process.argv[1] && process.argv[1].endsWith("brain-nft.mjs") && process.argv.includes("--write")) {
  const bootFile = arg("--bootstrap");
  const hosts = bootFile ? hostsFromBootstrap(readFileSync(bootFile, "utf8")) : [];
  const extra = String(process.env.ROLEFLOW_CONTROL_IPS || "").split(/[\s,]+/).filter(Boolean);
  const rules = renderNftables({
    chromiumUid: process.env.CHROMIUM_UID,
    agentUid: process.env.AGENT_UID,
    controlIps: extra
  });
  writeFileSync(arg("--write"), rules);
  process.stdout.write("wrote nftables\n");
  if (hosts.length) process.stdout.write("control hosts " + hosts.length + "\n");
}
