// Reply delay math for the client panel and the live setter.
// acquire/setter-delay.js and supabase/functions/_shared/setter-delay.js must stay identical.

function clampDelay(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(300, Math.max(0, Math.round(number)));
}

export function delaySeconds(min, max, random) {
  const low = Math.min(clampDelay(min), clampDelay(max));
  const high = Math.max(clampDelay(min), clampDelay(max));
  const roll = typeof random === "function" ? Number(random()) : Math.random();
  const unit = Math.min(1, Math.max(0, Number.isFinite(roll) ? roll : 0));
  return low + Math.floor((high - low) * unit);
}

export function practiceDelaySeconds(min, max, simulate, random) {
  if (simulate !== true) return 0;
  return delaySeconds(min, max, random);
}
