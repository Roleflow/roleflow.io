import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkHandle, checkIcp, followerBounds, scorePasses } from "../workers/roleflow-dm/brain-icp.mjs";
import { classifyHealth, heartbeatDelayMs, inQuietHours, pollDelayMs, bootDeadlineMs, HEARTBEAT_FAILURE_MS, HEARTBEAT_MISSES } from "../workers/roleflow-dm/brain-health.mjs";
import { messageSendable, performClaimed, publicLog, sendingMode, typeAndMaybeSend } from "../workers/roleflow-dm/brain-guard.mjs";
import { parseHandles, parseProfile } from "../workers/roleflow-dm/brain-parse.mjs";
import { fillMessage, readActivity } from "../workers/roleflow-dm/brain-browser.mjs";
import { decryptBackup, encryptBackup } from "../workers/roleflow-dm/brain-backup.mjs";
import { createApi, machineEndpoint } from "../workers/roleflow-dm/brain-api.mjs";
import { ensureSession, shredPath, writeMode } from "../workers/roleflow-dm/brain-auth.mjs";
import { hostsFromBootstrap, parseProxy, renderNftables } from "../workers/roleflow-dm/brain-nft.mjs";
import { bootMachine, emptyLedger, noteActivity, readyDelayMs, tickMachine } from "../workers/roleflow-dm/brain-loop.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const profileHtml = read("test/fixtures/ig-profile.html");
const followersHtml = read("test/fixtures/ig-followers.html");
const likesHtml = read("test/fixtures/ig-likes.html");
const profile = parseProfile(profileHtml);
assert.equal(profile.handle, "jane.coach");
assert.equal(profile.followers, 12400);
assert.equal(profile.bio, "Coach and mentor. DM me to apply.");
assert.equal(profile.captions.length, 3);
assert.deepEqual(parseHandles(followersHtml), ["jane.coach", "bob.setter"]);
assert.deepEqual(parseHandles(likesHtml), ["liker.one"]);

assert.equal(classifyHealth({ url: "https://www.instagram.com/accounts/login/", text: "Log in" }), "expired");
assert.equal(classifyHealth({ url: "https://www.instagram.com/challenge/123/", text: "" }), "checkpoint");
assert.equal(classifyHealth({ url: "https://www.instagram.com/", text: "Try again later" }), "action_block");
assert.equal(classifyHealth({ url: "https://www.instagram.com/", text: "Home" }), "ok");

assert.equal(inQuietHours(new Date("2026-11-03T22:30:00Z"), "Europe/Madrid", "22:00", "08:00"), true);
assert.equal(inQuietHours(new Date("2026-11-03T10:00:00Z"), "Europe/Madrid", "22:00", "08:00"), false);
assert.equal(bootDeadlineMs(false), 10 * 60 * 1000);
assert.equal(bootDeadlineMs(true), 5 * 60 * 1000);
assert.equal(HEARTBEAT_MISSES, 3);
assert.equal(HEARTBEAT_FAILURE_MS, 3 * 60 * 1000);
assert.equal(heartbeatDelayMs(() => 0), 50 * 1000);
assert.equal(heartbeatDelayMs(() => 0.5), 60 * 1000);
assert.equal(heartbeatDelayMs(() => 1), 70 * 1000);
assert.equal(pollDelayMs(() => 0), 5 * 60 * 1000);
assert.ok(pollDelayMs(() => 1) > 14 * 60 * 1000 && pollDelayMs(() => 1) <= 15 * 60 * 1000);
assert.equal(readyDelayMs(0, null, null), 300000);
assert.ok(readyDelayMs(1, null, null) >= 1799000);
assert.equal(readyDelayMs(0, 180, 1200), 180000);

const bounds = followerBounds({ follower_min: 5000, follower_max: 50000 });
assert.equal(bounds.max, 50000);
assert.deepEqual(followerBounds({ follower_min: null, follower_max: null }), { min: 5000, max: 200000 });
const config = {
  settings: { follower_min: 5000, follower_max: 50000, cta_keywords: "", skip_followed: true, keyword_only: false },
  outreacher: { exclude_keywords: "crypto", countries: ["ES"], languages: ["es"] },
  dnc: ["skip.me"],
  sent_handles: ["already.sent"],
  controls: { ig_handle: "own.handle" },
  workforce: { min_score: 70 }
};
assert.equal(checkIcp({ handle: "jane.coach", followers: 80000, bio: "coach" }, config).reason, "follower_range");
assert.equal(checkIcp({ handle: "jane.coach", followers: 12000, bio: "unrelated bio" }, config).ok, true);
assert.equal(checkIcp({ handle: "jane.coach", followers: 12000, bio: "crypto tips" }, config).reason, "exclude");
assert.equal(checkHandle("skip.me", config).reason, "dnc");
assert.equal(checkHandle("already.sent", config).reason, "already");
assert.equal(checkHandle("own.handle", config).reason, "self");
assert.equal(checkIcp({ handle: "jane.coach", followers: 12000, bio: "coach", following: true }, config).reason, "followed");
assert.equal(checkIcp({ handle: "jane.coach", followers: 12000, bio: "coach", country: "US" }, config).reason, "country");
assert.equal(checkIcp({ handle: "jane.coach", followers: 12000, bio: "coach" }, { ...config, settings: { ...config.settings, cta_keywords: "mentor" } }).reason, "keywords");
assert.equal(checkIcp({ handle: "jane.coach", followers: 12000, bio: "mentor" }, { ...config, settings: { ...config.settings, cta_keywords: "mentor" } }).ok, true);
assert.equal(scorePasses(69, 70), false);
assert.equal(scorePasses(70, 70), true);
assert.equal(checkIcp({ handle: "jane" }, { dnc_incomplete: true }).reason, "list_incomplete");

const open = {
  controls: { enabled: true, killed: false, paused: false },
  settings: { system_enabled: true, ig_paused: false },
  workforce: { active: true },
  outreacher: { dry_run: true },
  machine: { status: "running" }
};
assert.equal(sendingMode({ env: {}, config: open }), "dry_run");
assert.equal(sendingMode({ env: { ROLEFLOW_DM_LIVE: "1" }, config: open }), "dry_run");
assert.equal(sendingMode({ env: { ROLEFLOW_DM_LIVE: "1" }, config: { ...open, outreacher: { dry_run: false } } }), "live");
assert.equal(sendingMode({ env: { ROLEFLOW_DM_LIVE: "1" }, config: { ...open, controls: { enabled: false }, outreacher: { dry_run: false } } }), "off");
assert.equal(sendingMode({ env: { ROLEFLOW_DM_LIVE: "1", ROLEFLOW_DM_KILL: "1" }, config: { ...open, outreacher: { dry_run: false } } }), "off");
assert.equal(messageSendable("a".repeat(1001)).reason, "will_not_truncate");
assert.equal(messageSendable("The price is $50").reason, "price");
assert.equal(messageSendable("Short note about your last post").ok, true);

{
  const calls = [];
  const api = {
    claim: async ({ kind, target }) => {
      calls.push(["claim", kind, target]);
      return kind === "follow" ? { ok: false, reason: "refused" } : { ok: true, claim_id: "c-" + kind + "-" + calls.length, expires_at: "2026-11-03T18:02:00.000Z" };
    },
    claimCheck: async ({ claim_id }) => ({ ok: true, claim_id }),
    report: async (fields) => { calls.push(["report", fields]); return { ok: true }; }
  };
  const liked = await performClaimed(api, { kind: "like", target: "jane", now: new Date("2026-11-03T18:00:00Z"), run: async () => ({ ok: true }) });
  assert.equal(liked.ok, true);
  assert.equal(calls[0][1], "like");
  assert.equal(calls.at(-1)[1].claim_id, liked.claim_id);
  const followed = await performClaimed(api, { kind: "follow", target: "jane", now: new Date("2026-11-03T18:00:00Z"), run: async () => { throw new Error("ran"); } });
  assert.equal(followed.reason, "refused");
}

{
  const calls = [];
  const ui = {
    typeAll: async (text) => { calls.push(["type", text]); },
    readComposer: async () => calls.includes("short") ? "short" : calls.at(-1)[1],
    readLastBubble: async () => "Short note",
    clickSend: async () => { calls.push(["click"]); }
  };
  const claim = { ok: true, claim_id: "c1", expires_at: "2026-11-03T18:02:00.000Z" };
  const now = new Date("2026-11-03T18:00:00.000Z");
  const dry = await typeAndMaybeSend(ui, { text: "Short note", live: false, claim, recheck: async () => ({ ok: true }) });
  assert.equal(dry.reason, "dry_run");
  assert.equal(dry.clicked, false);
  assert.equal(calls.some((row) => row[0] === "click"), false);
  const live = await typeAndMaybeSend(ui, { text: "Short note", live: true, claim, recheck: async () => ({ ok: true }) });
  assert.equal(live.reason, "sent");
  assert.equal(live.clicked, true);
  const blocked = await typeAndMaybeSend({
    typeAll: async () => {},
    readComposer: async () => "cut",
    clickSend: async () => { throw new Error("clicked"); }
  }, { text: "Short note", live: true, claim, recheck: async () => ({ ok: true }) });
  assert.equal(blocked.reason, "composer_mismatch");
  const stale = await typeAndMaybeSend(ui, {
    text: "Short note",
    live: true,
    claim,
    recheck: async () => ({ ok: false, reason: "claim_expired" })
  });
  assert.equal(stale.reason, "claim_expired");
  void now;
}

{
  let dialog = followersHtml;
  const clicks = [];
  const page = {
    url: () => "https://www.instagram.com/",
    innerText: async () => "Home",
    click: async (selector) => { clicks.push(selector); dialog = selector.includes("liked_by") ? likesHtml : followersHtml; },
    innerHTML: async () => dialog,
    content: async () => profileHtml,
    goto: async () => {},
    fill: async (selector, text) => { page.value = text; page.selector = selector; },
    inputValue: async () => page.value
  };
  const activity = await readActivity(page);
  assert.deepEqual(activity.followers, ["jane.coach", "bob.setter"]);
  assert.deepEqual(activity.likes, ["liker.one"]);
  assert.equal(clicks.includes("a[href$='/followers/']"), true);
  const typed = await fillMessage(page, { handle: "jane.coach", text: "Short note", click: false });
  assert.equal(page.selector, "textarea");
  assert.equal(typed.composer, "Short note");
  assert.equal(typed.clicked, false);
}

{
  const key = Buffer.alloc(32, 7).toString("base64");
  const plain = Buffer.from("PLAINTEXT-PROFILE-MARKER");
  const cipher = await encryptBackup(plain, key);
  assert.equal(Buffer.from(cipher).includes(plain), false);
  assert.equal(Buffer.from(await decryptBackup(cipher, key)).toString(), "PLAINTEXT-PROFILE-MARKER");
}

{
  assert.throws(() => machineEndpoint("https://example.test/rest/v1"), /edge functions/);
  const seen = [];
  let access = "access-1";
  const api = createApi({
    base: "https://example.test",
    readAccess: async () => access,
    readRefresh: async () => "refresh-1",
    writeTokens: async (next) => { access = next; },
    log: (entry) => seen.push(entry),
    fetchImpl: async (url, init) => {
      seen.push({ url, authorization: init.headers.authorization, body: init.body });
      const payload = JSON.parse(init.body);
      if (payload.action === "config") {
        return { ok: true, status: 200, json: async () => ({ ok: true, settings: { niche: "Example" }, proxy_url: "http://user:secret@203.0.113.8:8000" }) };
      }
      return { ok: false, status: 401, json: async () => ({ ok: false, error: "Unauthorized." }) };
    }
  });
  const config = await api.config();
  assert.equal(config.settings.niche, "Example");
  assert.equal(seen.some((entry) => JSON.stringify(entry).includes("secret")), false);
  assert.equal(seen.some((entry) => entry.url && entry.url.endsWith("/functions/v1/acquisition-bot")), true);
  assert.equal(seen.some((entry) => entry.url && entry.url.includes("/rest/v1")), false);
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-brain-"));
  const secret = path.join(dir, "access.jwt");
  writeMode(secret, "token", 0o600);
  assert.equal(fs.statSync(secret).mode & 0o777, 0o600);
  const boot = path.join(dir, "bootstrap");
  fs.writeFileSync(boot, "machine_id=11111111-1111-4111-8111-111111111111\nbootstrap_token=SECRETTOKENVALUE\nsupabase_url=https://example.test\n");
  const shredded = [];
  const stored = {};
  const session = await ensureSession({
    accessPath: path.join(dir, "missing-access"),
    refreshPath: path.join(dir, "missing-refresh"),
    bootstrapPath: boot,
    endpointsPath: path.join(dir, "endpoints.json"),
    exists: async (file) => fs.existsSync(file),
    read: async (file) => fs.readFileSync(file, "utf8"),
    writeSecret: async (file, data) => { stored[file] = data; writeMode(file, data, 0o600); },
    writeJson: async (file, data) => fs.writeFileSync(file, JSON.stringify(data)),
    shred: async (file) => { shredded.push(file); fs.unlinkSync(file); },
    metadata: async () => "srv-9",
    exchange: async () => ({ status: 200, body: { ok: true, access_token: "a", refresh_token: "r", business_id: "biz" } })
  });
  assert.equal(session.ok, true);
  assert.equal(shredded.length, 1);
  assert.equal(fs.existsSync(boot), false);
  assert.equal(fs.readFileSync(path.join(dir, "endpoints.json"), "utf8").includes("SECRETTOKENVALUE"), false);
  const again = await ensureSession({
    accessPath: secret,
    refreshPath: secret,
    bootstrapPath: path.join(dir, "left-over"),
    endpointsPath: path.join(dir, "endpoints.json"),
    exists: async (file) => file === secret || file.endsWith("left-over"),
    read: async () => "",
    writeSecret: async () => { throw new Error("rewrote"); },
    writeJson: async () => {},
    shred: async (file) => shredded.push(file),
    exchange: async () => { throw new Error("exchanged"); }
  });
  assert.equal(again.reason, "existing");
  const target = path.join(dir, "token-file");
  fs.writeFileSync(target, "secret");
  const removed = shredPath(target, () => ({ status: 1 }));
  assert.equal(removed.method, "overwrite");
  assert.equal(fs.existsSync(target), false);
  const proxy = parseProxy("http://user:secret@proxy.example:8000", () => "203.0.113.5");
  assert.equal(proxy.ip, "203.0.113.5");
  assert.equal(proxy.serverArg, "http://user:secret@203.0.113.5:8000");
  assert.equal(JSON.stringify(publicLog(proxy)).includes("secret"), false);
}

{
  const rules = renderNftables({ chromiumUid: 101, agentUid: 102, controlIps: ["203.0.113.20"] });
  assert.match(rules, /169\.254\.169\.254/);
  assert.match(rules, /meta l4proto udp drop/);
  assert.match(rules, /tcp dport 53 drop/);
  assert.match(rules, /@proxy_v4/);
  assert.match(rules, /skuid 101/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-nft-"));
  const boot = path.join(dir, "bootstrap");
  fs.writeFileSync(boot, "bootstrap_token=SECRETTOKENVALUE\nsupabase_url=https://db.example.test\nrelay_url=wss://relay.example.test\n");
  assert.deepEqual(hostsFromBootstrap(fs.readFileSync(boot, "utf8")), ["db.example.test", "relay.example.test"]);
  const out = path.join(dir, "nft.conf");
  const ran = spawnSync(process.execPath, ["workers/roleflow-dm/brain-nft.mjs", "--write", out, "--bootstrap", boot], {
    cwd: root,
    env: { ...process.env, CHROMIUM_UID: "101", AGENT_UID: "102" },
    encoding: "utf8"
  });
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal((ran.stdout + fs.readFileSync(out, "utf8")).includes("SECRETTOKENVALUE"), false);
}

function allow(extra) {
  return {
    ok: true,
    settings: { niche: "Example niche", follower_min: 5000, follower_max: 50000, cta_keywords: "coach", timezone: "Europe/Madrid", quiet_start: "22:00", quiet_end: "08:00", system_enabled: true, ig_paused: false, skip_followed: false },
    controls: { enabled: true, killed: false, paused: false, daily_cap: 20, ig_handle: "own.handle" },
    workforce: { active: true, min_score: 70 },
    outreacher: { dry_run: true, delay_min_s: 0, delay_max_s: 0, hourly_cap: 6, exclude_keywords: "" },
    dnc: [],
    sent_handles: [],
    prompt: "PANEL PROMPT EXACT\n",
    machine: { status: "running" },
    halt: false,
    ...extra
  };
}

function harness(options = {}) {
  const calls = [];
  let clock = options.clock || Date.parse("2026-11-03T10:00:00Z");
  const claims = [];
  const ctx = {
    env: options.env || {},
    started: clock,
    now: () => new Date(clock),
    random: () => 0,
    sleep: async (ms) => { clock += ms; },
    bootWindow: () => 10 * 60 * 1000,
    state: { ledger: emptyLedger(), session: "unknown", halt: false, lastError: "", lastBackupDate: "2026-11-03", booted: false },
    config: options.config || allow(),
    persist: () => {},
    secrets: { writeProxy: async (url) => calls.push(["proxy", url.includes("secret")]) },
    auth: { ensure: async () => ({ ok: true, reason: "existing" }) },
    api: {
      heartbeat: async (fields) => { calls.push(["heartbeat", fields.session_state, fields.sending_mode]); return { ok: true, status: 200 }; },
      config: async () => { calls.push(["config"]); return options.config || allow({ proxy_url: "http://user:secret@203.0.113.8:8000" }); },
      claim: async (input) => {
        claims.push(input);
        calls.push(["claim", input.kind, input.target]);
        return { ok: true, claim_id: "claim-" + claims.length, expires_at: new Date(clock + 120000).toISOString() };
      },
      claimCheck: async ({ claim_id }) => { calls.push(["check", claim_id]); return { ok: true, claim_id }; },
      draft: async (profile, trigger) => { calls.push(["draft", trigger, profile.handle]); return { ok: true, text: "Short note about the systems post" }; },
      qualify: async () => ({ ok: true, score: 80 }),
      logEvent: async (fields) => { calls.push(["log", fields.reason, fields.handle]); return { ok: true }; },
      report: async (fields) => { calls.push(["report", fields.result, fields.claim_id, fields.body]); return { ok: true }; }
    },
    browser: {
      health: async () => options.health || { url: "https://www.instagram.com/", text: "Home" },
      listActivity: async () => options.activity || { ok: true, followers: ["bob.setter"], likes: ["liker.one"] },
      readProfile: async (handle) => ({ ok: true, profile: { handle, name: "Bob", followers: 12000, bio: "coach and mentor", captions: ["systems"], following: false } }),
      openDm: async () => ({
        typeAll: async (text) => { calls.push(["type", text]); },
        readComposer: async () => "Short note about the systems post",
        readLastBubble: async () => "Short note about the systems post",
        clickSend: async () => { calls.push(["click"]); }
      })
    }
  };
  return { ctx, calls, advance: (ms) => { clock += ms; } };
}

{
  const { ctx, calls } = harness();
  let polls = 0;
  ctx.browser.listActivity = async () => {
    polls += 1;
    return { ok: true, followers: polls === 1 ? ["bob.setter"] : ["bob.setter", "cara.coach"], likes: [] };
  };
  const booted = await bootMachine(ctx);
  assert.equal(booted.mode, "dry_run");
  assert.equal(calls[0][0], "heartbeat");
  assert.equal(calls[1][0], "config");
  assert.equal(ctx.config.proxy_url, undefined);
  assert.equal(calls.some((row) => row[0] === "proxy"), true);
  const first = await tickMachine(ctx);
  assert.equal(first.reason, "baseline");
  ctx.state.nextPollAt = new Date(ctx.now().getTime() - 1000).toISOString();
  const queued = await tickMachine(ctx);
  assert.equal(queued.reason, "dry_run");
  assert.equal(calls.some((row) => row[0] === "click"), false);
  assert.equal(calls.some((row) => row[0] === "type" && row[1] === "Short note about the systems post"), true);
  assert.equal(calls.filter((row) => row[0] === "claim" && row[1] === "dm").length, 1);
  const report = calls.find((row) => row[0] === "report");
  assert.equal(report[1], "dry_run");
  assert.equal(report[3], "Short note about the systems post");
}

{
  const { ctx, calls } = harness({
    env: { ROLEFLOW_DM_LIVE: "1" },
    config: allow({ outreacher: { dry_run: false, delay_min_s: 0, delay_max_s: 0, hourly_cap: 6, exclude_keywords: "" }, proxy_url: undefined })
  });
  ctx.state.ledger = noteActivity({
    ledger: { baselined: true, events: [] },
    followers: ["bob.setter"],
    likes: [],
    now: ctx.now(),
    ownHandle: "own.handle",
    delayMinS: 0,
    delayMaxS: 0
  }).ledger;
  ctx.state.nextPollAt = new Date(ctx.now().getTime() + 600000).toISOString();
  ctx.state.ledger.events[0].profile = { handle: "bob.setter", followers: 12000, bio: "coach", captions: ["systems"], following: false, score: 80 };
  ctx.state.ledger.events[0].readyAt = ctx.now().toISOString();
  const sent = await tickMachine(ctx);
  assert.equal(sent.reason, "sent");
  assert.equal(calls.some((row) => row[0] === "click"), true);
  assert.equal(calls.find((row) => row[0] === "report")[1], "sent");
}

{
  const { ctx, calls } = harness({ config: allow({ dnc: ["bob.setter"] }) });
  ctx.browser.listActivity = async () => ({ ok: true, followers: ["bob.setter"], likes: [] });
  ctx.state.ledger.baselined = true;
  ctx.state.nextPollAt = new Date(ctx.now().getTime() - 1000).toISOString();
  await tickMachine(ctx);
  assert.equal(calls.some((row) => row[0] === "claim"), false);
  assert.equal(calls.some((row) => row[0] === "log" && row[1] === "dnc"), true);
}

{
  const { ctx, calls } = harness({ health: { url: "https://www.instagram.com/accounts/login/", text: "Log in" } });
  const result = await tickMachine(ctx);
  assert.equal(result.reason, "expired");
  assert.equal(calls.some((row) => row[0] === "heartbeat" && row[1] === "expired"), true);
  assert.equal(calls.some((row) => row[0] === "claim"), false);
}

{
  const { ctx, calls } = harness({ config: allow({ controls: { enabled: true, killed: true, paused: false, ig_handle: "own.handle" }, halt: true }) });
  const result = await tickMachine(ctx);
  assert.equal(result.reason, "halt");
  assert.equal(calls.some((row) => row[0] === "claim"), false);
}

{
  const quiet = allow();
  const { ctx, calls } = harness({ clock: Date.parse("2026-11-03T22:30:00Z"), config: quiet });
  ctx.state.ledger.baselined = true;
  ctx.state.nextPollAt = new Date(ctx.now().getTime() - 1000).toISOString();
  const result = await tickMachine(ctx);
  assert.equal(result.reason, "hours");
  assert.equal(calls.some((row) => row[0] === "claim"), false);
}

{
  let runs = 0;
  const { ctx } = harness();
  ctx.auth.ensure = async () => {
    runs += 1;
    return runs === 1 ? { ok: false, reason: "identity_pending" } : { ok: true };
  };
  const booted = await bootMachine(ctx);
  assert.equal(booted.ok, true);
  assert.equal(runs, 2);
}

{
  const noted = noteActivity({ ledger: emptyLedger(), followers: ["jane.coach"], likes: [], now: new Date("2026-11-03T10:00:00Z"), ownHandle: "own" });
  assert.equal(noted.baseline, true);
  assert.equal(noted.ledger.events[0].baseline, true);
  const next = noteActivity({ ledger: noted.ledger, followers: ["jane.coach", "new.person"], likes: [], now: new Date("2026-11-03T10:05:00Z"), ownHandle: "own", delayMinS: 300, delayMaxS: 300 });
  assert.equal(next.ledger.events.filter((row) => row.baseline).length, 1);
  assert.equal(next.ledger.events.find((row) => row.handle === "new.person").baseline, false);
}

const dockerfile = read("workers/roleflow-dm/Dockerfile");
const entry = read("workers/roleflow-dm/entrypoint.sh");
const launch = read("workers/roleflow-dm/image/chromium-launch.sh");
const policy = JSON.parse(read("workers/roleflow-dm/image/chromium-policy.json"));
const build = read("workers/roleflow-dm/build-image.sh");
assert.match(build, /linux\/amd64,linux\/arm64/);
assert.match(dockerfile, /arm64\) narch=arm64/);
assert.doesNotMatch(dockerfile + entry + read("workers/roleflow-dm/supervisord.conf"), /ROLEFLOW_DM_LIVE=1/);
assert.match(entry, /chown agent:roleflow/);
assert.match(entry, /chmod 700/);
assert.match(read("workers/roleflow-dm/supervisord.conf"), /127\.0\.0\.1:6080/);
assert.match(dockerfile, /useradd --system --create-home --gid roleflow --shell \/usr\/sbin\/nologin agent/);
assert.match(dockerfile, /useradd --system --create-home --gid roleflow --shell \/usr\/sbin\/nologin chromium/);
assert.match(launch, /--force-webrtc-ip-handling-policy=disable_non_proxied_udp/);
assert.match(launch, /--user-data-dir=\/data\/profile/);
assert.doesNotMatch(launch, /echo "\$PROXY"|echo \$PROXY/);
assert.equal(policy.PasswordManagerEnabled, false);
assert.equal(policy.WebRtcIPHandlingPolicy, "disable_non_proxied_udp");
assert.equal(policy.AutofillAddressEnabled, false);

for (const file of [
  "workers/roleflow-dm/brain.mjs",
  "workers/roleflow-dm/brain-loop.mjs",
  "workers/roleflow-dm/brain-api.mjs",
  "supabase/functions/acquisition-bot/machine.js",
  "docs/auto-dm.md"
]) {
  if (!fs.existsSync(path.join(root, file))) continue;
  assert.doesNotMatch(read(file), /Grok Bot|Zernio/i);
}

console.log("outreacher brain tests passed");
