import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionPaths } from "../acquire/auto-dm.js";
import {
  connectStatusPatch,
  controlPatchIsSafe,
  disconnectStatusPatch,
  disconnectUrl,
  forwardClientMessage,
  handleFromAnchors,
  hashLoginToken,
  loginExpiry,
  loginLinkOpen,
  loginSettled,
  loginUrl,
  mayLogClientMessage,
  mintLoginToken,
  sessionCookiePresent,
  sessionStateForDisk
} from "../acquire/dm-login.js";
import { createLoginServer, encryptStorageState, loginPageHtml, tokenFromPath } from "../workers/roleflow-dm/login-service.mjs";

const BUSINESS = "840b08a9-869c-4650-8dc7-f78fdfa0e112";
const SERVICE_KEY = "service-role-test-key";
const SECRET = "Secret99";

const start = new Date("2026-10-28T12:00:00Z");
assert.equal(new Date(loginExpiry(start)).getTime() - start.getTime(), 10 * 60 * 1000);
assert.equal(loginLinkOpen({ expires_at: loginExpiry(start), used_at: null }, start), true);
assert.equal(loginLinkOpen({ expires_at: start.toISOString(), used_at: null }, start), false);
assert.equal(loginLinkOpen({ expires_at: loginExpiry(start), used_at: start.toISOString() }, new Date(start.getTime() + 1000)), false);

const token = mintLoginToken();
const tokenHash = await hashLoginToken(token);
assert.equal(token.length, 64);
assert.equal(tokenHash.length, 64);
assert.notEqual(tokenHash, token);
assert.equal(await hashLoginToken(token), tokenHash);

assert.deepEqual(connectStatusPatch("@roleflow.io"), { ig_handle: "roleflow.io", session_ready: true });
assert.equal(connectStatusPatch(""), null);
assert.equal(connectStatusPatch("accounts"), null);
assert.equal(Object.hasOwn(connectStatusPatch("roleflow.io"), "enabled"), false);
assert.equal(controlPatchIsSafe(connectStatusPatch("roleflow.io")), true);
assert.equal(controlPatchIsSafe(disconnectStatusPatch()), true);
assert.equal(controlPatchIsSafe({ ig_handle: "roleflow.io", session_ready: true, enabled: true }), false);
assert.equal(controlPatchIsSafe({ ig_handle: "roleflow.io", session_ready: true, password: SECRET }), false);
assert.deepEqual(disconnectStatusPatch(), { ig_handle: null, session_ready: false });

const scrubbed = sessionStateForDisk({
  cookies: [{ name: "sessionid", value: "keep-session" }, { name: "password", value: SECRET }],
  origins: [{ localStorage: [{ name: "password", value: SECRET }, { name: "ig", value: "1" }] }],
  password: SECRET
});
assert.equal(JSON.stringify(scrubbed).includes(SECRET), false);
assert.equal(sessionCookiePresent(scrubbed), true);
assert.equal(scrubbed.origins[0].localStorage.some((item) => item.name === "ig"), true);
assert.equal(mayLogClientMessage({ method: "Input.dispatchKeyEvent", params: { text: SECRET } }), false);
assert.equal(mayLogClientMessage({ method: "Input.insertText", params: { text: SECRET } }), false);
assert.equal(forwardClientMessage({ method: "Page.captureScreenshot", params: {} }), null);
assert.equal(forwardClientMessage({ method: "Runtime.evaluate", params: { expression: SECRET } }), null);
assert.equal(loginSettled([{ name: "sessionid", value: "keep-session" }], "https://www.instagram.com/challenge/1"), false);
assert.equal(loginSettled([{ name: "sessionid", value: "keep-session" }], "https://www.instagram.com/"), true);
assert.equal(handleFromAnchors(["/explore/", "/roleflow.io/", "/roleflow.io/"]), "roleflow.io");
assert.equal(loginUrl("http://evil.test", token), "");
assert.equal(loginUrl("https://user:secret@ig-login.example.com", token), "");
assert.equal(loginUrl("https://ig-login.example.com/ignored", token), "https://ig-login.example.com/login/" + token);
assert.equal(disconnectUrl("https://ig-login.example.com", token), "https://ig-login.example.com/disconnect/" + token);
assert.equal(tokenFromPath("/login/" + token + "/stream").action, "stream");
assert.equal(tokenFromPath("/login/" + "a".repeat(63)), null);
assert.equal(tokenFromPath("/disconnect/" + token + "/stream"), null);

const page = readFileSync(new URL("../acquire/auto-dm-page.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../acquire/app.js", import.meta.url), "utf8");
const service = readFileSync(new URL("../workers/roleflow-dm/login-service.mjs", import.meta.url), "utf8");
const sql = readFileSync(new URL("../supabase/migrations/20261028190000_dm_instagram_login.sql", import.meta.url), "utf8");
assert.match(page, /auto-dm-connect/);
assert.match(page, /auto-dm-disconnect/);
assert.match(page, /Connected as @\{handle\}/);
assert.doesNotMatch(page, /type="password"|zernio/i);
assert.match(app, /token_hash: tokenHash/);
assert.match(app, /purpose: "login"/);
assert.match(app, /purpose: "disconnect"/);
assert.match(app, /select\("ig_handle, session_ready"\)/);
assert.match(app, /enabled: state\.autoDm\.enabled === true/);
assert.doesNotMatch(app, /type="password"|zernio|tailortalk/i);
assert.doesNotMatch(loginPageHtml(), /type="password"|<input|console\./i);
assert.doesNotMatch(service, /password|screenshot|captureScreenshot|zernio/i);
assert.match(service, /startScreencast/);
const logs = [...service.matchAll(/console\.(log|info|debug|warn|error)\(([^;]*)/g)];
assert.ok(logs.length >= 1);
for (const call of logs) assert.match(call[2], /JSON\.stringify\(\{ login:/);
assert.match(sql, /token_hash/);
assert.match(sql, /10 minutes/);
assert.match(sql, /session_ready boolean not null default false/);
assert.match(sql, /acq_dm_controls_member_guard/);
assert.match(sql, /public_origin/);
assert.doesNotMatch(sql, /password|bytea|storage_state|sessionid|drop table/i);
assert.doesNotMatch(sql, /update\s+public\.acq_dm_controls/i);

const dir = mkdtempSync(join(tmpdir(), "rf-dm-login-"));
const direct = encryptStorageState({
  state: { cookies: [{ name: "sessionid", value: "keep-session" }], password: SECRET },
  file: join(dir, "direct.bin"),
  key: "workspace-key"
});
assert.equal(direct, true);
const decoded = spawnSync("openssl", [
  "enc", "-d", "-aes-256-cbc", "-pbkdf2",
  "-in", join(dir, "direct.bin"),
  "-out", join(dir, "direct.json"),
  "-pass", "env:ROLEFLOW_DM_SESSION_KEY"
], { env: { ...process.env, ROLEFLOW_DM_SESSION_KEY: "workspace-key" }, encoding: "utf8" });
assert.equal(decoded.status, 0);
const directState = JSON.parse(readFileSync(join(dir, "direct.json"), "utf8"));
assert.equal(JSON.stringify(directState).includes(SECRET), false);
assert.equal(directState.cookies[0].value, "keep-session");

function fakeBrowser() {
  return {
    cookieList: [],
    pageUrl: "https://www.instagram.com/accounts/login/",
    sent: [],
    send(message) { this.sent.push(message); },
    cookies() { return this.cookieList; },
    url() { return this.pageUrl; },
    storageState() {
      return {
        cookies: this.cookieList,
        origins: [{ localStorage: [{ name: "password", value: SECRET }, { name: "ig", value: "1" }] }]
      };
    },
    anchors() { return ["/roleflow.io/"]; },
    username() { return "roleflow.io"; },
    onFrame(callback) { callback(Buffer.from([0xff, 0xd8, 0xff, 0xd9])); },
    close() { this.closed = true; }
  };
}

const loginToken = "ab".repeat(32);
const links = [{
  id: "11111111-1111-4111-8111-111111111111",
  business_id: BUSINESS,
  token_hash: await hashLoginToken(loginToken),
  purpose: "login",
  expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  used_at: null
}];
const calls = [];
const browser = fakeBrowser();
const printed = [];
const original = { log: console.log, info: console.info, debug: console.debug, warn: console.warn, error: console.error };
for (const method of Object.keys(original)) {
  console[method] = (...args) => printed.push(args.map(String).join(" "));
}
const server = createLoginServer({
  env: {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    ROLEFLOW_DM_SESSION_DIR: dir
  },
  fetchImpl: async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), method: init.method, body });
    if (String(url).includes("acq_dm_login_links") && init.method === "GET") {
      const hash = String(url).split("token_hash=eq.")[1].split("&")[0];
      return { ok: true, status: 200, json: async () => links.filter((row) => row.token_hash === hash) };
    }
    if (String(url).includes("acq_dm_login_links") && init.method === "PATCH") {
      const id = String(url).split("id=eq.")[1];
      const row = links.find((item) => item.id === id);
      if (row && body) row.used_at = body.used_at;
      return { ok: true, status: 200, json: async () => [] };
    }
    if (String(url).includes("acq_dm_controls") && init.method === "PATCH") {
      return { ok: true, status: 200, json: async () => [] };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  },
  launch: async () => browser,
  sessionDir: dir,
  interval: 20,
  log: (status) => printed.push(String(status)),
  now: () => new Date()
});

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  assert.equal((await fetch(base + "/health")).status, 200);
  assert.equal((await fetch(base + "/login/not-a-token")).status, 404);
  const html = await fetch(base + "/login/" + loginToken);
  assert.equal(html.status, 200);
  assert.doesNotMatch(await html.text(), /type="password"|<input/i);
  const typed = await fetch(base + "/login/" + loginToken + "/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "Input.dispatchKeyEvent", params: { type: "char", text: SECRET, key: SECRET } })
  });
  assert.equal(typed.status, 204);
  await fetch(base + "/login/" + loginToken + "/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "Page.captureScreenshot", params: { text: SECRET } })
  });
  assert.equal(browser.sent.length, 1);
  assert.equal(browser.sent[0].params.text, SECRET);
  const stream = await fetch(base + "/login/" + loginToken + "/stream");
  assert.match(stream.headers.get("content-type") || "", /multipart\/x-mixed-replace/);
  await stream.body.cancel();
  browser.cookieList = [{ name: "sessionid", value: "keep-session" }];
  browser.pageUrl = "https://www.instagram.com/challenge/abc";
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal((await (await fetch(base + "/login/" + loginToken + "/status")).json()).status, "pending");
  browser.pageUrl = "https://www.instagram.com/";
  let connected = null;
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    connected = await (await fetch(base + "/login/" + loginToken + "/status")).json();
    if (connected.status === "connected") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(connected.status, "connected");
  assert.equal(connected.handle, "roleflow.io");
  const paths = sessionPaths(dir, BUSINESS);
  assert.deepEqual(readdirSync(dir).filter((name) => name.startsWith(BUSINESS)).sort(), [BUSINESS + ".bin", BUSINESS + ".key"]);
  const key = readFileSync(paths.keyFile, "utf8").trim();
  const restored = spawnSync("openssl", [
    "enc", "-d", "-aes-256-cbc", "-pbkdf2",
    "-in", paths.file,
    "-out", join(dir, "restored.json"),
    "-pass", "env:ROLEFLOW_DM_SESSION_KEY"
  ], { env: { ...process.env, ROLEFLOW_DM_SESSION_KEY: key }, encoding: "utf8" });
  assert.equal(restored.status, 0);
  const stored = JSON.parse(readFileSync(join(dir, "restored.json"), "utf8"));
  assert.equal(JSON.stringify(stored).includes(SECRET), false);
  assert.equal(stored.cookies[0].name, "sessionid");
  assert.equal(stored.cookies[0].value, "keep-session");
  const controlCalls = calls.filter((call) => call.url.includes("acq_dm_controls"));
  assert.deepEqual(controlCalls[0].body, { ig_handle: "roleflow.io", session_ready: true });
  assert.equal(JSON.stringify(calls).includes(SECRET), false);
  assert.equal(JSON.stringify(calls).includes(loginToken), false);
  assert.equal(printed.join("\n").includes(SECRET), false);
  assert.equal(printed.join("\n").includes(SERVICE_KEY), false);
  assert.equal(readFileSync(paths.file).includes(SERVICE_KEY), false);
  assert.equal((await fetch(base + "/login/" + loginToken)).status, 410);
  const disconnectToken = "cd".repeat(32);
  links.push({
    id: "22222222-2222-4222-8222-222222222222",
    business_id: BUSINESS,
    token_hash: await hashLoginToken(disconnectToken),
    purpose: "disconnect",
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    used_at: null
  });
  writeFileSync(paths.file, "session-bytes");
  const removed = await fetch(base + "/disconnect/" + disconnectToken, { method: "POST" });
  assert.equal(removed.status, 200);
  assert.equal(existsSync(paths.file), false);
  assert.equal(existsSync(paths.keyFile), true);
  assert.deepEqual(calls.filter((call) => call.url.includes("acq_dm_controls")).at(-1).body, { ig_handle: null, session_ready: false });
  const expired = "ef".repeat(32);
  links.push({
    id: "33333333-3333-4333-8333-333333333333",
    business_id: BUSINESS,
    token_hash: await hashLoginToken(expired),
    purpose: "login",
    expires_at: new Date(Date.now() - 1000).toISOString(),
    used_at: null
  });
  assert.equal((await fetch(base + "/login/" + expired)).status, 410);
} finally {
  await new Promise((resolve) => server.close(resolve));
  for (const method of Object.keys(original)) console[method] = original[method];
  rmSync(dir, { recursive: true, force: true });
}

console.log("dm login tests passed");
