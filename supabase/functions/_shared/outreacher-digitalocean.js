const API = "https://api.digitalocean.com/v2";

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
    try { parsed = JSON.parse(text); } catch { parsed = { message: text }; }
  }
  if (!response.ok) {
    const message = parsed.message || (parsed.error && parsed.error.message) || "digitalocean_" + response.status;
    const error = new Error(message);
    error.status = response.status;
    error.code = /not available|unavailable|size is not available/i.test(message) ? "unavailable" : message;
    throw error;
  }
  return parsed;
}

export function createDigitalOceanProvider({ fetch: fetchImpl, token } = {}) {
  const request = (method, path, body) => call(fetchImpl, token, method, path, body);
  return {
    name: "digitalocean",
    async createVolume({ name, location, sizeGb }) {
      const parsed = await request("POST", "/volumes", {
        name,
        region: location,
        size_gigabytes: sizeGb || 10,
        filesystem_type: "ext4"
      });
      return { id: parsed.volume.id };
    },
    async deleteVolume(id) {
      if (!id) return;
      await request("DELETE", "/volumes/" + id);
    },
    async createFirewall({ name, rules }) {
      const inbound = [];
      const outbound = (rules || []).filter((rule) => rule.direction === "out").map((rule) => ({
        protocol: rule.protocol,
        ports: rule.port,
        destinations: { addresses: rule.destination_ips }
      }));
      const parsed = await request("POST", "/firewalls", { name, inbound_rules: inbound, outbound_rules: outbound });
      return { id: parsed.firewall.id };
    },
    async deleteFirewall(id) {
      if (!id) return;
      await request("DELETE", "/firewalls/" + id);
    },
    async createServer({ name, serverType, location, image, volumeId, firewallId, userData, sshKeys }) {
      const parsed = await request("POST", "/droplets", {
        name,
        region: location,
        size: serverType,
        image,
        ssh_keys: Array.isArray(sshKeys) ? sshKeys : [],
        user_data: userData,
        ipv6: false,
        volumes: volumeId ? [volumeId] : [],
        tags: ["rf-outreacher"]
      });
      const droplet = parsed.droplet;
      if (firewallId) {
        await request("POST", "/firewalls/" + firewallId + "/droplets", { droplet_ids: [droplet.id] });
      }
      const v4 = ((droplet.networks && droplet.networks.v4) || []).find((row) => row.type === "public");
      return { id: String(droplet.id), ipv4: v4 ? v4.ip_address : "", status: droplet.status };
    },
    async getServer(id) {
      const parsed = await request("GET", "/droplets/" + id);
      const v4 = ((parsed.droplet.networks && parsed.droplet.networks.v4) || []).find((row) => row.type === "public");
      return { id: String(parsed.droplet.id), ipv4: v4 ? v4.ip_address : "", status: parsed.droplet.status };
    },
    async deleteServer(id) {
      if (!id) return;
      await request("DELETE", "/droplets/" + id);
    }
  };
}
