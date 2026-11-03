const API = "https://api.hetzner.cloud/v1";

function unavailable(status, body) {
  const code = body && body.error && (body.error.code || body.error.message);
  const text = String(code || "");
  return status === 422 && /unavail|resource_unavailable|not available/i.test(text);
}

async function call(fetchImpl, token, method, path, body) {
  if (!token) {
    const error = new Error("missing_provider_token");
    error.code = "missing_provider_token";
    throw error;
  }
  const response = await fetchImpl(API + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let parsed = {};
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = { error: { message: text } }; }
  }
  if (!response.ok) {
    const error = new Error((parsed.error && (parsed.error.message || parsed.error.code)) || "hetzner_" + response.status);
    error.code = (parsed.error && parsed.error.code) || error.message;
    error.status = response.status;
    if (unavailable(response.status, parsed)) error.code = "unavailable";
    throw error;
  }
  return parsed;
}

function ipv4Of(server) {
  return server && server.public_net && server.public_net.ipv4 && server.public_net.ipv4.ip || "";
}

export function createHetznerProvider({ fetch: fetchImpl, token } = {}) {
  const request = (method, path, body) => call(fetchImpl, token, method, path, body);
  return {
    name: "hetzner",
    async createVolume({ name, location, sizeGb, labels }) {
      const parsed = await request("POST", "/volumes", {
        name,
        size: sizeGb || 10,
        location,
        format: "ext4",
        labels: labels || {}
      });
      return { id: String(parsed.volume.id) };
    },
    async deleteVolume(id) {
      if (!id) return;
      await request("DELETE", "/volumes/" + id);
    },
    async createFirewall({ name, rules, labels }) {
      const parsed = await request("POST", "/firewalls", {
        name,
        labels: labels || {},
        rules: (rules || []).map((rule) => ({
          direction: rule.direction,
          protocol: rule.protocol,
          port: rule.port,
          destination_ips: rule.destination_ips,
          source_ips: []
        }))
      });
      return { id: String(parsed.firewall.id) };
    },
    async deleteFirewall(id) {
      if (!id) return;
      await request("DELETE", "/firewalls/" + id);
    },
    async createServer({ name, serverType, location, image, volumeId, firewallId, userData, sshKeys, labels }) {
      const parsed = await request("POST", "/servers", {
        name,
        server_type: serverType,
        location,
        image,
        ssh_keys: Array.isArray(sshKeys) ? sshKeys : [],
        user_data: userData,
        labels: labels || {},
        firewalls: firewallId ? [{ firewall: Number(firewallId) || firewallId }] : [],
        volumes: volumeId ? [Number(volumeId) || volumeId] : [],
        public_net: { enable_ipv4: true, enable_ipv6: false },
        start_after_create: true
      });
      return { id: String(parsed.server.id), ipv4: ipv4Of(parsed.server), status: parsed.server.status };
    },
    async getServer(id) {
      const parsed = await request("GET", "/servers/" + id);
      return { id: String(parsed.server.id), ipv4: ipv4Of(parsed.server), status: parsed.server.status };
    },
    async deleteServer(id) {
      if (!id) return;
      await request("DELETE", "/servers/" + id);
    }
  };
}
