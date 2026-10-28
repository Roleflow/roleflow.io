import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  framePayload,
  heartbeatFresh,
  inputFromBroadcast,
  loginChannel,
  mayJoinLoginChannel,
  panelLoginHash,
  statusPayload
} from "../acquire/dm-login.js";
import { createRealtime, decodeRealtime, encodeRealtime, joinMessage } from "../workers/roleflow-dm/realtime.mjs";
import { runLoginRelay } from "../workers/roleflow-dm/relay.mjs";

const BUSINESS = "840b08a9-869c-4650-8dc7-f78fdfa0e112";
const OTHER = "1351d2ac-79bb-545d-8da0-c49ecff28a47";
const HASH = "ab".repeat(32);
const SECRET = "Secret99";
const now = new Date("2026-10-28T12:00:00Z");
const openLink = {
  token_hash: HASH,
  purpose: "login",
  business_id: BUSINESS,
  used_at: null,
  expires_at: "2026-10-28T12:10:00Z"
};

assert.equal(loginChannel(HASH), "dm-login:" + HASH);
assert.equal(loginChannel("short"), "");
assert.equal(panelLoginHash(HASH), "/account/ig-login/#" + HASH);
assert.equal(mayJoinLoginChannel({ canEdit: true, link: openLink, topic: loginChannel(HASH), now }), true);
assert.equal(mayJoinLoginChannel({ canEdit: false, link: openLink, topic: loginChannel(HASH), now }), false);
assert.equal(mayJoinLoginChannel({ canEdit: true, link: { ...openLink, business_id: OTHER }, topic: loginChannel(HASH), now }), true);
assert.equal(mayJoinLoginChannel({ canEdit: true, link: { ...openLink, used_at: now.toISOString() }, topic: loginChannel(HASH), now }), false);
assert.equal(mayJoinLoginChannel({ canEdit: true, link: { ...openLink, expires_at: now.toISOString() }, topic: loginChannel(HASH), now }), false);
assert.equal(mayJoinLoginChannel({ canEdit: true, link: { ...openLink, purpose: "disconnect" }, topic: loginChannel(HASH), now }), false);
assert.equal(mayJoinLoginChannel({ canEdit: true, link: openLink, topic: "dm-login:other", now }), false);
assert.equal(heartbeatFresh(now.toISOString(), new Date(now.getTime() + 20000)), true);
assert.equal(heartbeatFresh(now.toISOString(), new Date(now.getTime() + 60000)), false);
assert.equal(framePayload("short"), null);
assert.equal(framePayload("a".repeat(120001)), null);
assert.deepEqual(framePayload("abcdefghij"), { j: "abcdefghij" });
assert.equal(inputFromBroadcast({ method: "Page.captureScreenshot", params: { text: SECRET } }), null);
assert.equal(inputFromBroadcast({ method: "Input.insertText", params: { text: SECRET } }).params.text, SECRET);
assert.deepEqual(statusPayload("connected", "@roleflow.io"), { status: "connected", handle: "roleflow.io" });
assert.equal(Object.hasOwn(statusPayload("connected", "roleflow.io"), "j"), false);

const joined = joinMessage(loginChannel(HASH), "service-role-test-key", "1");
assert.equal(joined.payload.config.private, true);
assert.equal(joined.payload.config.broadcast.self, false);
assert.equal(joined.topic, "realtime:dm-login:" + HASH);
const decoded = decodeRealtime(encodeRealtime(joined));
assert.equal(decoded.event, "phx_join");
assert.equal(decoded.payload.config.private, true);

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.sent = [];
    FakeSocket.latest = this;
  }
  send(data) { this.sent.push(String(data)); }
  close() { this.closed = true; }
}
const logs = [];
const realtime = createRealtime({
  url: "https://example.supabase.co",
  key: "service-role-test-key",
  WebSocket: FakeSocket,
  heartbeatMs: 0,
  log: (status) => logs.push(status)
});
const received = [];
const channel = realtime.join(HASH, (body) => received.push(body));
FakeSocket.latest.onopen();
const wire = FakeSocket.latest.sent.map((line) => JSON.parse(line));
assert.equal(wire.some((message) => message[4] && message[4].config && message[4].config.private === true), true);
channel.send("frame", { j: "abcdefghij" });
FakeSocket.latest.onmessage({
  data: encodeRealtime({
    topic: "realtime:" + loginChannel(HASH),
    event: "broadcast",
    payload: { type: "broadcast", event: "input", payload: { method: "Input.insertText", params: { text: SECRET } } }
  })
});
assert.equal(received[0].params.text, SECRET);
assert.equal(logs.join(" ").includes(SECRET), false);
assert.equal(logs.join(" ").includes("service-role-test-key"), false);
realtime.close();

const sql = fs.readFileSync(new URL("../supabase/migrations/20261028200000_dm_login_realtime.sql", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../account/ig-login/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../account/ig-login/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../acquire/app.js", import.meta.url), "utf8");
const panel = fs.readFileSync(new URL("../acquire/auto-dm-page.js", import.meta.url), "utf8");
const docs = fs.readFileSync(new URL("../docs/auto-dm.md", import.meta.url), "utf8");
const relaySource = fs.readFileSync(new URL("../workers/roleflow-dm/relay.mjs", import.meta.url), "utf8");
assert.match(sql, /acq_dm_login_channel_ok/);
assert.match(sql, /acq_dm_login_beat/);
assert.match(sql, /extension = 'broadcast'/);
assert.match(sql, /grant execute on function public.acq_dm_login_beat\(\) to service_role/);
assert.match(sql, /revoke all on function public.acq_dm_login_beat\(\) from public, anon, authenticated/);
assert.doesNotMatch(sql, /password|realtime\.send\s*\(|using \(true\)/i);
assert.doesNotMatch(sql, /drop table/i);
assert.match(page, /private: true/);
assert.match(page, /event: "input"/);
assert.doesNotMatch(page + html, /type="password"|<input|console\./i);
assert.match(app, /panelLoginHash/);
assert.match(app, /loginLive !== true/);
assert.match(panel, /draft.loginLive === true/);
assert.doesNotMatch(app, /loginUrl\(/);
assert.match(docs, /8796/);
assert.match(docs, /roleflow-dm/);
assert.match(docs, /Node 24/);
assert.doesNotMatch(docs, /cloudflared/);
assert.doesNotMatch(relaySource, /writeFile/);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-relay-"));
const calls = [];
const channels = [];
const encrypted = [];
let browser;
function fakeBrowser() {
  const value = {
    cookieList: [],
    pageUrl: "https://www.instagram.com/accounts/login/",
    sent: [],
    send(message) { this.sent.push(message); return Promise.resolve(); },
    cookies() { return this.cookieList; },
    url() { return this.pageUrl; },
    storageState() {
      return { cookies: this.cookieList, origins: [{ localStorage: [{ name: "password", value: SECRET }] }] };
    },
    anchors() { return []; },
    username() { return "roleflow.io"; },
    onFrame(callback) { this.emit = callback; },
    close() { this.closed = true; }
  };
  browser = value;
  return value;
}
const link = {
  id: "11111111-1111-4111-8111-111111111111",
  business_id: BUSINESS,
  token_hash: HASH,
  purpose: "login",
  expires_at: new Date(Date.now() + 600000).toISOString(),
  used_at: null
};
const fetchImpl = async (url, init) => {
  const body = init && init.body ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), method: init.method, body });
  if (String(url).includes("acq_dm_login_links") && init.method === "GET") {
    return { ok: true, status: 200, json: async () => [link] };
  }
  return { ok: true, status: 200, json: async () => [] };
};
await runLoginRelay({
  once: true,
  env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key", ROLEFLOW_DM_SESSION_DIR: dir },
  fetchImpl,
  sessionDir: dir,
  frameMs: 20,
  interval: 20,
  launch: async () => fakeBrowser(),
  encryptStorageState(options) { encrypted.push(options.state); return true; },
  ensureSessionKey() { return "workspace-key"; },
  realtime: {
    join(hash, onInput) {
      const entry = { hash, sent: [], push: onInput, send(event, payload) { this.sent.push({ event, payload }); return true; }, close() {} };
      channels.push(entry);
      return entry;
    },
    close() {}
  },
  log: (status) => logs.push(status)
});
channels[0].push({ method: "Input.insertText", params: { text: SECRET } });
assert.equal(browser.sent[0].params.text, SECRET);
browser.emit(Buffer.from("jpeg-bytes-frame"));
await new Promise((resolve) => setTimeout(resolve, 60));
assert.equal(channels[0].sent.some((item) => item.event === "frame"), true);
assert.equal(JSON.stringify(channels[0].sent).includes(SECRET), false);
browser.cookieList = [{ name: "sessionid", value: "keep-session" }];
browser.pageUrl = "https://www.instagram.com/";
const deadline = Date.now() + 2000;
while (Date.now() < deadline && !channels[0].sent.some((item) => item.event === "status")) {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
const status = channels[0].sent.find((item) => item.event === "status");
assert.equal(status.payload.handle, "roleflow.io");
assert.equal(JSON.stringify(encrypted[0]).includes(SECRET), false);
assert.equal(encrypted[0].cookies[0].value, "keep-session");
assert.equal(JSON.stringify(calls).includes(SECRET), false);
assert.equal(logs.join(" ").includes(SECRET), false);
const beat = calls.find((call) => call.url.includes("acq_dm_login_beat"));
assert.equal(beat.method, "POST");
assert.deepEqual(beat.body, {});
const control = calls.filter((call) => call.url.includes("acq_dm_controls")).at(-1);
assert.deepEqual(control.body, { ig_handle: "roleflow.io", session_ready: true });

const disconnectDir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-relay-off-"));
const sessionFile = path.join(disconnectDir, BUSINESS + ".bin");
fs.writeFileSync(sessionFile, "session");
let launched = false;
const disconnectCalls = [];
await runLoginRelay({
  once: true,
  env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key", ROLEFLOW_DM_SESSION_DIR: disconnectDir },
  sessionDir: disconnectDir,
  fetchImpl: async (url, init) => {
    disconnectCalls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    if (String(url).includes("acq_dm_login_links") && init.method === "GET") {
      return { ok: true, status: 200, json: async () => [{ ...link, id: "22222222-2222-4222-8222-222222222222", purpose: "disconnect", token_hash: "cd".repeat(32) }] };
    }
    return { ok: true, status: 200, json: async () => [] };
  },
  launch: async () => { launched = true; return fakeBrowser(); },
  encryptStorageState() { return true; },
  ensureSessionKey() { return "k"; },
  realtime: { join() { throw new Error("no channel"); }, close() {} },
  log: () => {}
});
assert.equal(launched, false);
assert.equal(fs.existsSync(sessionFile), false);
assert.deepEqual(disconnectCalls.find((call) => call.url.includes("acq_dm_controls")).body, { ig_handle: null, session_ready: false });

console.log("dm login realtime tests passed");
