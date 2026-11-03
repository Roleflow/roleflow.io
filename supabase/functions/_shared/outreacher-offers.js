// CX23 is tried first. CAX11 is Arm, so the image tag must be multi-arch.
// The provisioner records whichever provider, type and arch actually started.

export const DEFAULT_OFFERS = [
  { provider: "hetzner", serverType: "cx23", arch: "amd64", locations: ["nbg1", "fsn1", "hel1"] },
  { provider: "hetzner", serverType: "cax11", arch: "arm64", locations: ["nbg1", "fsn1", "hel1"] },
  { provider: "hetzner", serverType: "cx33", arch: "amd64", locations: ["nbg1", "fsn1", "hel1"] },
  { provider: "digitalocean", serverType: "s-2vcpu-4gb", arch: "amd64", locations: ["fra1"] }
];

export function parseOffers(raw) {
  if (!raw) return DEFAULT_OFFERS.map((row) => ({ ...row, locations: row.locations.slice() }));
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(parsed) || !parsed.length) throw new Error("provider_order_empty");
  return parsed.map((row) => ({
    provider: String(row.provider || ""),
    serverType: String(row.serverType || row.server_type || ""),
    arch: String(row.arch || "amd64"),
    locations: (row.locations || [row.location]).map((item) => String(item || "")).filter(Boolean)
  }));
}

export function flattenOffers(offers) {
  const rows = [];
  (offers || []).forEach((offer) => {
    (offer.locations || []).forEach((location) => {
      rows.push({
        provider: offer.provider,
        serverType: offer.serverType,
        arch: offer.arch,
        location
      });
    });
  });
  return rows;
}

export function imageIdFor(offer, env) {
  if (!offer) return "";
  if (offer.provider === "digitalocean") return String((env && env.doImageId) || "");
  if (offer.arch === "arm64") return String((env && env.armImageId) || "");
  return String((env && env.amdImageId) || "");
}
