// Picks the Instagram channel a follow-up goes out on. A business connects
// Instagram either with a stored Meta token or through the connected
// messaging account. Follow-ups must work with either one.

export function pickChannel(input) {
  const source = input || {};
  if (source.metaToken) return "meta";
  if (source.gatewayReady) return "gateway";
  return null;
}

// The order every automatic follow-up send checks, first to last.
export const FOLLOWUP_GATE_ORDER = ["dm_controls", "followup_switch", "instagram_channel", "window_24h"];

export function followupGate(input) {
  const source = input || {};
  if (!source.dmOpen) return { allow: false, reason: source.dmReason || "dm_disabled", gate: "dm_controls" };
  if (!source.followupOn) return { allow: false, reason: "agent_off", gate: "followup_switch" };
  if (!source.channel) return { allow: false, reason: "ig_not_connected", gate: "instagram_channel" };
  if (!source.windowOpen) return { allow: false, reason: source.windowReason || "outside_24h", gate: "window_24h" };
  return { allow: true, reason: "open", gate: "" };
}

export function contactLookup(thread) {
  const row = thread || {};
  return {
    externalId: String(row.igsid || "").trim(),
    handle: String(row.username || "").replace(/^@/, "").trim()
  };
}
