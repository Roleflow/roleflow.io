import { tick } from "./serve.mjs";

// Call this route every five minutes with the runner bearer.
// The Vercel project is on the Hobby plan, which rejects a cron that runs
// more than once a day and fails the deployment. On Pro, register
// { "path": "/api/workforce/tick", "schedule": "*/5 * * * *" }.
export const TICK_SCHEDULE = "*/5 * * * *";

export default function handler(req, res) {
  return tick(req, res);
}
