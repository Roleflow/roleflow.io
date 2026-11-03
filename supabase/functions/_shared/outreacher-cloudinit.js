// cloud-init is written before the provider returns a server id or address.
// Those values are recorded on the machine row from the create response.
// This file must not opt the machine into sending.

const FORBIDDEN = [
  /^sending_mode=/im,
  /^ROLEFLOW_SEND/im,
  /^ROLEFLOW_DM_ENABLED=/im,
  /^proxy_/im,
  /service_role/i,
  /BEGIN OPENSSH/,
  /^server_id=/im,
  /^public_ip=/im,
  /HCLOUD_TOKEN/i,
  /DIGITALOCEAN_TOKEN/i
];

export function renderCloudInit({ machineId, bootstrapToken, relayUrl, supabaseUrl }) {
  if (!machineId || !bootstrapToken) throw new Error("bootstrap_incomplete");
  const relay = String(relayUrl || "https://live.roleflow.io").trim();
  const supabase = String(supabaseUrl || "").trim();
  const body = [
    "#cloud-config",
    "write_files:",
    "  - path: /etc/roleflow/bootstrap",
    "    owner: root:root",
    "    permissions: \"0600\"",
    "    content: |",
    "      machine_id=" + machineId,
    "      bootstrap_token=" + bootstrapToken,
    "      relay_url=" + relay,
      "      supabase_url=" + supabase,
    "  - path: /etc/roleflow/host.env",
    "    owner: root:root",
    "    permissions: \"0644\"",
    "    content: |",
    "      ROLEFLOW_APPLY_NFT=1",
    "runcmd:",
    "  - [ systemctl, start, roleflow-outreacher ]"
  ].join("\n") + "\n";
  assertCloudInitSafe(body);
  return body;
}

export function assertCloudInitSafe(body) {
  const text = String(body || "");
  if (!text.includes("machine_id=") || !text.includes("bootstrap_token=")) {
    throw new Error("bootstrap_incomplete");
  }
  if (text.includes("server_id=") || text.includes("public_ip=")) {
    throw new Error("cloud_init_binds_too_early");
  }
  FORBIDDEN.forEach((pattern) => {
    if (pattern.test(text)) throw new Error("cloud_init_forbidden");
  });
  return true;
}
