// Cloud firewall for one machine. Inbound is empty. Host nftables is the image's job.

export const DEFAULT_DNS_IPS = ["185.12.64.1", "185.12.64.2"];
export const DEFAULT_NTP_IPS = ["162.159.200.1", "162.159.200.123"];

function cidr(ip) {
  const value = String(ip || "").trim();
  if (!value) return "";
  return value.includes("/") ? value : value + "/32";
}

function list(value, fallback) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  const ips = raw.map((item) => String(item || "").trim()).filter(Boolean);
  return ips.length ? ips : fallback.slice();
}

export function buildFirewallRules(input) {
  const dns = list(input && input.dnsIps, DEFAULT_DNS_IPS).map(cidr).filter(Boolean);
  const ntp = list(input && input.ntpIps, DEFAULT_NTP_IPS).map(cidr).filter(Boolean);
  const relay = list(input && input.relayIps, []).map(cidr).filter(Boolean);
  const supabase = list(input && input.supabaseIps, []).map(cidr).filter(Boolean);
  const registry = list(input && input.registryIps, []).map(cidr).filter(Boolean);
  const proxyIp = cidr(input && input.proxyIp);
  const proxyPort = String((input && input.proxyPort) || "").trim();
  if (!relay.length || !supabase.length || !registry.length || !proxyIp || !proxyPort) {
    return { ok: false, reason: "missing_firewall_pins" };
  }
  const open = [...dns, ...ntp, ...relay, ...supabase, ...registry, proxyIp];
  if (open.some((item) => item === "0.0.0.0/0" || item === "::/0")) {
    return { ok: false, reason: "open_egress" };
  }
  const rules = [
    { direction: "out", protocol: "udp", port: "53", destination_ips: dns },
    { direction: "out", protocol: "tcp", port: "53", destination_ips: dns },
    { direction: "out", protocol: "udp", port: "123", destination_ips: ntp },
    { direction: "out", protocol: "tcp", port: "443", destination_ips: relay },
    { direction: "out", protocol: "tcp", port: "443", destination_ips: supabase },
    { direction: "out", protocol: "tcp", port: "443", destination_ips: registry },
    { direction: "out", protocol: "tcp", port: proxyPort, destination_ips: [proxyIp] }
  ];
  if (rules.some((rule) => rule.direction !== "out")) return { ok: false, reason: "inbound" };
  return { ok: true, rules };
}
