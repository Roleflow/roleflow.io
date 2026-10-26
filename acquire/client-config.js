// Placeholder launch URLs for the client's own Grok Bot.
// Replace warmer and outreacher with https URLs, or set
// window.ROLEFLOW_GROK_URLS = { warmer: "https://…", outreacher: "https://…" }
// before the dashboard loads. An empty value is not a live integration.

export const GROK_BOT_URLS = {
  warmer: "",
  outreacher: ""
};

export function grokLaunchUrl(kind) {
  const override = (typeof globalThis !== "undefined" && globalThis.ROLEFLOW_GROK_URLS) || {};
  const value = String((override && override[kind]) || GROK_BOT_URLS[kind] || "").trim();
  if (!/^https:\/\//i.test(value)) return "";
  return value;
}
