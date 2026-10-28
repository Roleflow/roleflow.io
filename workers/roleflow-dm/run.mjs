// One follow-to-DM process per workspace.
// Run it on a computer you already use. Do not buy a new host for this.
// The Instagram password is not an argument and is not written anywhere.
// Sessions live in ROLEFLOW_DM_SESSION_DIR, one encrypted file and one key file per workspace id.

import { readFileSync } from "node:fs";
import { planDm, sessionPaths } from "../../acquire/auto-dm.js";

const workspaceId = process.argv[2] || process.env.ROLEFLOW_DM_WORKSPACE || "";
const handle = process.argv[3] || "";
const dir = process.env.ROLEFLOW_DM_SESSION_DIR || "";
const paths = sessionPaths(dir, workspaceId);

let sessionKey = "";
if (workspaceId && dir) {
  try { sessionKey = readFileSync(paths.keyFile, "utf8").trim(); } catch (_error) { sessionKey = ""; }
}

const killed = process.env.ROLEFLOW_DM_KILL === "1";
const enabled = process.env.ROLEFLOW_DM_ENABLED === "1";

if (!workspaceId) {
  console.log(JSON.stringify({ ok: false, reason: "missing_workspace" }));
  process.exit(0);
}

const profile = {
  name: process.env.ROLEFLOW_DM_PROFILE_NAME || "",
  bio: process.env.ROLEFLOW_DM_PROFILE_BIO || "",
  category: process.env.ROLEFLOW_DM_PROFILE_CATEGORY || "",
  posts: String(process.env.ROLEFLOW_DM_PROFILE_POSTS || "").split("\n").filter(Boolean)
};

const job = {
  workspaceId,
  enabled,
  killed,
  paused: process.env.ROLEFLOW_DM_PAUSED === "1",
  handle,
  cap: process.env.ROLEFLOW_DM_CAP || 20,
  sentToday: Number(process.env.ROLEFLOW_DM_SENT_TODAY || 0),
  followedAt: process.env.ROLEFLOW_DM_FOLLOWED_AT || "",
  draft: process.env.ROLEFLOW_DM_DRAFT || "",
  profile,
  recent: String(process.env.ROLEFLOW_DM_RECENT || "").split("\n").filter(Boolean),
  exclusions: String(process.env.ROLEFLOW_DM_EXCLUSIONS || "").split(","),
  sentHandles: String(process.env.ROLEFLOW_DM_SENT || "").split(","),
  note: process.env.ROLEFLOW_DM_NOTE || "",
  now: new Date()
};

const plan = planDm(job);
if (!plan.ok) {
  console.log(JSON.stringify({ ok: false, workspaceId, reason: plan.reason, readyAt: plan.readyAt || "" }));
  process.exit(0);
}

if (!sessionKey || !dir) {
  console.log(JSON.stringify({ ok: false, workspaceId, reason: "no_session" }));
  process.exit(0);
}

if (process.env.ROLEFLOW_DM_SEND !== "1") {
  console.log(JSON.stringify({ ok: true, reason: "ready", workspaceId, handle, body: plan.body }));
  process.exit(0);
}

const { sendPlanned } = await import("./send.mjs");
const sent = await sendPlanned({
  ...job,
  sessionKey,
  sessionFile: paths.file,
  logFile: paths.logFile
});
console.log(JSON.stringify({ ...sent, workspaceId, body: plan.body }));
