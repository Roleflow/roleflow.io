const URLS = {
  update_workflow: "https://api.tailortalk.ai/api/v1/update_workflow",
  deploy: "https://api.tailortalk.ai/api/v1/deploy",
  create_tool: "https://api.tailortalk.ai/api/v1/create_tool"
};

const SECRET = ["api_key", "token", "access_token", "webhook_secret", "authorization", "bytes"];

export function deliveryRequest(row) {
  const kind = String(row && row.kind || "");
  const url = URLS[kind];
  if (!url) return null;
  const payload = Object.assign({}, (row && row.payload) || {});
  SECRET.forEach((key) => delete payload[key]);
  const agent = String((row && row.external_agent_id) || payload.external_agent_id || "").trim();
  const body = Object.assign({}, payload, { agent_id: agent });
  if (kind === "create_tool") {
    const config = payload.config && typeof payload.config === "object" ? payload.config : {};
    const media = String(payload.media_type || config.media_type || "");
    body.tool_type = media === "voice" ? "media" : String(payload.tool_type || payload.kind || "media");
    if (media) body.media_type = media;
  }
  return { method: "POST", url, body };
}

export function settleDelivery(status) {
  const code = Number(status);
  if (code >= 200 && code < 300) return "applied";
  return "pending";
}
