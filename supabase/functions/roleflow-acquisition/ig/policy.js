export const WINDOW_MS = 24 * 60 * 60 * 1000;
export const HUMAN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function messagingDecision({ lastUserMessageAt, now, kind, humanLocked }) {
  const last = lastUserMessageAt ? new Date(lastUserMessageAt).getTime() : NaN;
  if (!Number.isFinite(last)) return { allow: false, tag: null, reason: "no_user_message" };
  const at = Number(now);
  if (!Number.isFinite(at)) return { allow: false, tag: null, reason: "no_user_message" };
  const age = at - last;
  if (age < 0) return { allow: false, tag: null, reason: "clock_skew" };
  if (age <= WINDOW_MS) return { allow: true, tag: null, reason: "standard_window" };
  const human = kind === "human" && humanLocked === true;
  if (human && age <= HUMAN_WINDOW_MS) return { allow: true, tag: "HUMAN_AGENT", reason: "human_agent_window" };
  if (age <= HUMAN_WINDOW_MS) return { allow: false, tag: null, reason: "outside_24h" };
  return { allow: false, tag: null, reason: "outside_7d" };
}
