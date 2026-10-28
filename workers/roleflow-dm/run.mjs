// Follow-to-DM worker for @roleflow.io.
// Run it on a computer you already use. Do not buy a new host for this.
// The Instagram password is not an argument and is not written to disk.
// Put the encrypted Playwright session next to this file as session.bin.
// Decrypt it with ROLEFLOW_DM_SESSION_KEY (openssl enc -aes-256-cbc -pbkdf2).
// This process exits before opening Instagram unless every gate in planDm passes.

import { planDm, isRoleflowAccount } from "../../acquire/auto-dm.js";

const account = process.env.ROLEFLOW_DM_ACCOUNT || "";
const killed = process.env.ROLEFLOW_DM_KILL === "1";
const enabled = process.env.ROLEFLOW_DM_ENABLED === "1";

if (!isRoleflowAccount(account) || killed || !enabled) {
  console.log(JSON.stringify({ ok: false, reason: !isRoleflowAccount(account) ? "not_roleflow" : killed ? "killed" : "off" }));
  process.exit(0);
}

const job = {
  account,
  enabled: true,
  killed: false,
  paused: process.env.ROLEFLOW_DM_PAUSED === "1",
  handle: process.argv[2] || "",
  cap: process.env.ROLEFLOW_DM_CAP || 20,
  sentToday: Number(process.env.ROLEFLOW_DM_SENT_TODAY || 0),
  followedAt: process.env.ROLEFLOW_DM_FOLLOWED_AT || "",
  template: process.env.ROLEFLOW_DM_TEMPLATE || "",
  exclusions: String(process.env.ROLEFLOW_DM_EXCLUSIONS || "").split(","),
  sentHandles: String(process.env.ROLEFLOW_DM_SENT || "").split(","),
  note: process.env.ROLEFLOW_DM_NOTE || "",
  now: new Date()
};

const plan = planDm(job);
if (!plan.ok) {
  console.log(JSON.stringify({ ok: false, reason: plan.reason, readyAt: plan.readyAt || "" }));
  process.exit(0);
}

if (!process.env.ROLEFLOW_DM_SESSION_KEY || !process.env.ROLEFLOW_DM_SESSION_FILE) {
  console.log(JSON.stringify({ ok: false, reason: "no_session" }));
  process.exit(0);
}

if (process.env.ROLEFLOW_DM_SEND !== "1") {
  console.log(JSON.stringify({ ok: true, reason: "ready", handle: job.handle, body: plan.body }));
  process.exit(0);
}

const { sendPlanned } = await import("./send.mjs");
const sent = await sendPlanned({
  ...job,
  sessionKey: process.env.ROLEFLOW_DM_SESSION_KEY,
  sessionFile: process.env.ROLEFLOW_DM_SESSION_FILE
});
console.log(JSON.stringify(sent));
