const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function recoveryDue({
  lastUserMessageAt,
  followupCount = 0,
  now,
  periodHours = 6,
  max = 3,
  humanLocked = false,
  state = "qualification"
}) {
  if (humanLocked) return false;
  if (["dead", "closed", "booked", "human"].includes(state)) return false;
  const sent = Number(followupCount) || 0;
  const limit = Number(max) || 0;
  if (sent >= limit) return false;
  const last = new Date(lastUserMessageAt).getTime();
  const at = Number(now);
  if (!Number.isFinite(last) || !Number.isFinite(at)) return false;
  const age = at - last;
  if (age < 0 || age >= DAY) return false;
  const period = (Number(periodHours) || 6) * HOUR;
  return age >= period * (sent + 1);
}
