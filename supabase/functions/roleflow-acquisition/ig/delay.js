import { delaySeconds } from "../../_shared/setter-gate.js";

export function replyDelayMs(minSeconds = 30, maxSeconds = 120, random = Math.random) {
  return delaySeconds(minSeconds, maxSeconds, random) * 1000;
}
