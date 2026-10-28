import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { madridActive, readyAtFor, sentOnDay, sessionPaths } from "../acquire/auto-dm.js";
import {
  chooseApiKey,
  claimLock,
  dueEvents,
  feedBlocked,
  handlesFromFollowers,
  handlesFromLikers,
  hashRoll,
  mediaIds,
  mergeActivity,
  profileFromInfo,
  readLedger
} from "../workers/roleflow-dm/feed.mjs";
import { tickWorkspace } from "../workers/roleflow-dm/loop.mjs";

const workspace = "1351d2ac-79bb-545d-8da0-c49ecff28a47";
const noon = new Date("2026-06-15T10:00:00Z");
const night = new Date("2026-06-15T22:30:00Z");
const profile = { name: "Bo", bio: "Coach in Austin", category: "Sports", posts: ["Morning run"] };
const businessKey = "sk-business-test";
const platformKey = "sk-platform-test";
const sessionKey = "workspace-session-key";

assert.equal(chooseApiKey(businessKey, platformKey), businessKey);
assert.equal(chooseApiKey("", platformKey), platformKey);
assert.equal(handlesFromFollowers({ users: [{ username: "Ada" }, { username: "" }] }).length, 1);
assert.deepEqual(mediaIds({ items: [{ id: "101" }, { pk: "102" }] }), ["101", "102"]);
assert.equal(handlesFromLikers({ users: [{ username: "bo" }] })[0].handle, "bo");
assert.equal(profileFromInfo({
  data: { user: { full_name: "Bo", biography: "Coach", category_name: "Sports", edge_owner_to_timeline_media: { edges: [{ node: { edge_media_to_caption: { edges: [{ node: { text: "Morning run" } }] } } }] } } }
}).posts[0], "Morning run");
assert.equal(feedBlocked(401, {}), true);
assert.equal(feedBlocked(200, { users: [] }), false);
assert.equal(feedBlocked(200, { message: "checkpoint_required" }), true);

const first = mergeActivity({ ledger: { baselined: false, events: [] }, followers: [{ handle: "ada" }], likes: [], now: noon, ownHandle: "valueaddmarketing" });
assert.equal(first.baselined, true);
assert.equal(first.events[0].baseline, true);
assert.equal(dueEvents(first, noon, []).length, 0);
const again = mergeActivity({ ledger: first, followers: [{ handle: "ada" }, { handle: "bo" }], likes: [{ handle: "bo" }], now: noon, ownHandle: "valueaddmarketing" });
const bo = again.events.find((row) => row.handle === "bo" && row.kind === "follow");
assert.equal(bo.baseline, false);
assert.equal(new Date(bo.readyAt).getTime() > noon.getTime(), true);
const stable = mergeActivity({ ledger: again, followers: [{ handle: "bo" }], likes: [], now: new Date(noon.getTime() + 60000), ownHandle: "" });
assert.equal(stable.events.find((row) => row.handle === "bo" && row.kind === "follow").readyAt, bo.readyAt);
assert.equal(readyAtFor(bo.seenAt, () => hashRoll("bo", bo.seenAt)), bo.readyAt);
assert.equal(sentOnDay([{ created_at: noon.toISOString() }, { created_at: "2026-06-14T10:00:00Z" }], noon), 1);

function harness(dir, controls, feed) {
  const paths = sessionPaths(dir, workspace);
  const sent = [];
  const drafted = [];
  const recorded = [];
  const paused = [];
  const instagram = [];
  const io = {
    async readControls() { return controls; },
    async readSends() { return feed.sends || []; },
    async readContext() {
      return {
        prompt: "Ask one question.",
        playbook: "Offer: calls",
        voice: 40,
        exclusions: feed.exclusions || [],
        businessKey: feed.businessKey === undefined ? businessKey : feed.businessKey
      };
    },
    readKey() { return sessionKey; },
    async readInstagram(options) {
      instagram.push(options.profileHandles || []);
      return {
        ok: feed.fail || true,
        reason: feed.reason || "",
        followers: feed.followers || [],
        likes: feed.likes || [],
        profiles: (options.profileHandles || []).length ? { bo: profile } : {}
      };
    },
    async draft(options) {
      drafted.push(options.apiKey);
      return { ok: true, draft: "saw your latest post about listings" };
    },
    async send(job) {
      sent.push(job.handle);
      return { ok: true, reason: "sent", body: job.draft };
    },
    async recordSend(_workspaceId, handle, body) {
      recorded.push({ handle, body });
      return true;
    },
    async markPaused() { paused.push(true); }
  };
  return { paths, sent, drafted, recorded, paused, instagram, io };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-feed-"));
const on = { enabled: true, killed: false, cap: 20, paused: false, ownHandle: "valueaddmarketing" };

const baseline = harness(dir, on, { followers: [{ handle: "ada" }] });
const baselined = await tickWorkspace({
  workspaceId: workspace,
  env: {},
  now: noon,
  paths: baseline.paths,
  io: baseline.io,
  pid: 7
});
assert.equal(baselined.reason, "baseline");
assert.equal(baseline.sent.length, 0);
assert.equal(readLedger(baseline.paths.feedFile).events[0].baseline, true);
assert.equal(fs.statSync(baseline.paths.feedFile).mode & 0o777, 0o600);
assert.equal(JSON.stringify(readLedger(baseline.paths.feedFile)).includes(businessKey), false);
assert.equal(JSON.stringify(readLedger(baseline.paths.feedFile)).includes(sessionKey), false);

const waitingDir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-feed-"));
const waiting = harness(waitingDir, on, { followers: [{ handle: "bo" }] });
fs.writeFileSync(waiting.paths.feedFile, JSON.stringify({ baselined: true, events: [] }));
const waited = await tickWorkspace({
  workspaceId: workspace,
  env: { ANTHROPIC_API_KEY: platformKey },
  now: noon,
  paths: waiting.paths,
  io: waiting.io,
  pid: 7
});
assert.equal(waited.reason, "waiting");
assert.equal(waiting.sent.length, 0);
assert.equal(waiting.drafted.length, 0);
const remembered = readLedger(waiting.paths.feedFile).events.find((row) => row.handle === "bo");
assert.equal(remembered.readyAt, mergeActivity({
  ledger: { baselined: true, events: [] },
  followers: [{ handle: "bo" }],
  likes: [],
  now: noon,
  ownHandle: "valueaddmarketing"
}).events[0].readyAt);

const sendDir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-feed-"));
const sending = harness(sendDir, on, { followers: [{ handle: "bo" }] });
fs.writeFileSync(sending.paths.feedFile, JSON.stringify({
  baselined: true,
  events: [{ handle: "bo", kind: "follow", seenAt: "2026-06-15T08:00:00Z", readyAt: "2026-06-15T08:05:00Z", roll: 0, baseline: false, sent: false }]
}));
const sent = await tickWorkspace({
  workspaceId: workspace,
  env: { ANTHROPIC_API_KEY: platformKey },
  now: noon,
  paths: sending.paths,
  io: sending.io,
  pid: 7
});
assert.equal(sent.reason, "sent");
assert.deepEqual(sent.handles, ["bo"]);
assert.deepEqual(sending.drafted, [businessKey]);
assert.equal(sending.recorded[0].handle, "bo");
assert.equal(sending.recorded[0].body.includes("listings"), true);
assert.equal(JSON.stringify(sent).includes(businessKey), false);
assert.equal(JSON.stringify(readLedger(sending.paths.feedFile)).includes(businessKey), false);
assert.equal(JSON.stringify(readLedger(sending.paths.feedFile)).includes("password"), false);
const againSent = await tickWorkspace({
  workspaceId: workspace,
  env: { ANTHROPIC_API_KEY: platformKey },
  now: noon,
  paths: sending.paths,
  io: sending.io,
  pid: 7
});
assert.equal(againSent.reason, "baseline");
assert.equal(sending.sent.length, 1);

const offDir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-feed-"));
const off = harness(offDir, { ...on, enabled: false }, { followers: [{ handle: "bo" }] });
const stayed = await tickWorkspace({ workspaceId: workspace, env: {}, now: noon, paths: off.paths, io: off.io, pid: 7 });
assert.equal(stayed.reason, "off");
assert.equal(off.instagram.length, 0);

const killDir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-feed-"));
const killed = harness(killDir, { ...on, killed: true }, {});
assert.equal((await tickWorkspace({ workspaceId: workspace, env: {}, now: noon, paths: killed.paths, io: killed.io, pid: 7 })).reason, "killed");
assert.equal(killed.instagram.length, 0);

const nightDir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-feed-"));
const afterHours = harness(nightDir, on, { followers: [{ handle: "bo" }] });
assert.equal(madridActive(night), false);
assert.equal((await tickWorkspace({ workspaceId: workspace, env: {}, now: night, paths: afterHours.paths, io: afterHours.io, pid: 7 })).reason, "hours");
assert.equal(afterHours.instagram.length, 0);

const skipDir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-feed-"));
const skipped = harness(skipDir, on, { followers: [{ handle: "bo" }], exclusions: ["bo"] });
fs.writeFileSync(skipped.paths.feedFile, JSON.stringify({
  baselined: true,
  events: [{ handle: "bo", kind: "follow", seenAt: "2026-06-15T08:00:00Z", readyAt: "2026-06-15T08:05:00Z", roll: 0, baseline: false, sent: false }]
}));
await tickWorkspace({ workspaceId: workspace, env: {}, now: noon, paths: skipped.paths, io: skipped.io, pid: 7 });
assert.equal(skipped.sent.length, 0);

const capDir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-feed-"));
const capped = harness(capDir, on, {
  followers: [{ handle: "bo" }],
  sends: Array.from({ length: 20 }, (_item, index) => ({ handle: "old" + index, body: "note " + index, created_at: noon.toISOString() }))
});
fs.writeFileSync(capped.paths.feedFile, JSON.stringify({
  baselined: true,
  events: [{ handle: "bo", kind: "follow", seenAt: "2026-06-15T08:00:00Z", readyAt: "2026-06-15T08:05:00Z", roll: 0, baseline: false, sent: false }]
}));
await tickWorkspace({ workspaceId: workspace, env: {}, now: noon, paths: capped.paths, io: capped.io, pid: 7 });
assert.equal(capped.sent.length, 0);

const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-feed-"));
const lockPaths = sessionPaths(lockDir, workspace);
assert.equal(claimLock(lockPaths.lockFile, 7, noon, 60000), true);
assert.equal(claimLock(lockPaths.lockFile, 8, noon, 60000), false);
assert.equal(fs.statSync(lockPaths.lockFile).mode & 0o777, 0o600);
const busy = harness(lockDir, on, { followers: [{ handle: "bo" }] });
fs.writeFileSync(busy.paths.feedFile, JSON.stringify({ baselined: true, events: [] }));
assert.equal((await tickWorkspace({ workspaceId: workspace, env: {}, now: noon, paths: busy.paths, io: busy.io, pid: 8 })).reason, "busy");
assert.equal(busy.instagram.length, 0);

const runSource = fs.readFileSync(new URL("../workers/roleflow-dm/run.mjs", import.meta.url), "utf8");
const loopSource = fs.readFileSync(new URL("../workers/roleflow-dm/loop.mjs", import.meta.url), "utf8");
const instagramSource = fs.readFileSync(new URL("../workers/roleflow-dm/instagram.mjs", import.meta.url), "utf8");
const docs = fs.readFileSync(new URL("../docs/auto-dm.md", import.meta.url), "utf8");
assert.match(runSource, /runLoop/);
assert.doesNotMatch(runSource, /process\.argv\[3\]|ROLEFLOW_DM_SEND|ROLEFLOW_DM_ENABLED/);
assert.doesNotMatch(loopSource, /ROLEFLOW_DM_SEND|ROLEFLOW_DM_ENABLED/);
assert.doesNotMatch(instagramSource, /console\.(log|info|debug|warn|error)/);
assert.match(docs, /\/opt\/roleflow-dm\/sessions/);
assert.match(docs, /\/workspace\/roleflow-dm\/vam\/session\//);
assert.match(docs, /\/workspace\/roleflow-dm\/roleflow\/\.dm\/sessions\//);
assert.match(docs, /20261028150149/);
assert.match(docs, /already applied/);
assert.match(docs, /chmod 600/);
assert.doesNotMatch(docs, /ROLEFLOW_DM_SEND|ROLEFLOW_DM_ENABLED/);
assert.equal(sessionPaths("/opt/roleflow-dm/sessions", workspace).file, "/opt/roleflow-dm/sessions/" + workspace + ".bin");
assert.equal(sessionPaths("/opt/roleflow-dm/sessions", workspace).keyFile, "/opt/roleflow-dm/sessions/" + workspace + ".key");

const worker = spawnSync(process.execPath, ["workers/roleflow-dm/run.mjs"], { encoding: "utf8" });
assert.match(worker.stdout, /missing_workspace/);
assert.equal(worker.stdout.includes(businessKey), false);
const missingEnv = spawnSync(process.execPath, ["workers/roleflow-dm/run.mjs", workspace], {
  env: { ...process.env, ROLEFLOW_DM_SESSION_DIR: "", SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" },
  encoding: "utf8",
  timeout: 5000
});
assert.match(missingEnv.stdout, /missing_env/);
assert.equal(missingEnv.status, 1);

console.log("dm feed tests passed");
