import { refresh } from "./serve.mjs";

// Refresh long-lived Instagram tokens once a day, before the 60-day expiry,
// and send engine-outbox drafts whose workspace channel is meta.
// Hobby accepts a daily cron. On Pro, a tighter schedule can call this path.
export const TICK_SCHEDULE = "0 12 * * *";

export default function handler(req, res) {
  return refresh(req, res);
}
