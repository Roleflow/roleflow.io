export function replyDelayMs(baseSeconds = 60, jitterRatio = 0.2, random = Math.random) {
  const base = Number(baseSeconds);
  const seconds = Number.isFinite(base) ? Math.min(300, Math.max(0, base)) : 60;
  const swing = Math.min(1, Math.max(0, Number(jitterRatio) || 0));
  const roll = Number(random());
  const unit = Number.isFinite(roll) ? Math.min(1, Math.max(0, roll)) : 0.5;
  const jitter = (unit * 2 - 1) * swing * seconds;
  return Math.max(0, Math.round((seconds + jitter) * 1000));
}
