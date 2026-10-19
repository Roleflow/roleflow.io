import assert from "node:assert/strict";
import { cronFieldsValid, nextCron } from "./cron.mjs";

assert.equal(cronFieldsValid("0 8 * * *"), true);
assert.equal(cronFieldsValid("0 11 * * 2,4"), true);
assert.equal(cronFieldsValid("0 8 * * 1-5"), true);
assert.equal(cronFieldsValid("0 * * * *"), true);
assert.equal(cronFieldsValid("not a cron"), false);

const madrid = "Europe/Madrid";

assert.equal(
  nextCron("0 8 * * *", madrid, new Date("2026-10-16T05:30:00Z")).toISOString(),
  "2026-10-16T06:00:00.000Z"
);

assert.equal(
  nextCron("0 8 * * *", madrid, new Date("2026-10-16T06:00:00Z")).toISOString(),
  "2026-10-17T06:00:00.000Z"
);

assert.equal(
  nextCron("0 6 * * 1-5", madrid, new Date("2026-10-16T05:00:00Z")).toISOString(),
  "2026-10-19T04:00:00.000Z"
);

assert.equal(
  nextCron("0 * * * *", madrid, new Date("2026-10-16T05:10:00Z")).toISOString(),
  "2026-10-16T06:00:00.000Z"
);

assert.equal(
  nextCron("0 10 1 * *", madrid, new Date("2026-10-16T08:00:00Z")).toISOString(),
  "2026-11-01T09:00:00.000Z"
);

assert.equal(
  nextCron("30 7 * * 1-5", madrid, new Date("2026-10-16T04:00:00Z")).toISOString(),
  "2026-10-16T05:30:00.000Z"
);

assert.fail("throwaway: prove the Node tests check goes red");

console.log("cron ok");
