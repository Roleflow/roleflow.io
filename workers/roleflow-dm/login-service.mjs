// One login service for every workspace. Bind it to localhost.
// The Instagram session is encrypted into ROLEFLOW_DM_SESSION_DIR.
// Typed input is forwarded in memory and is never written to a log or a file.

import http from "node:http";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sessionPaths } from "../../acquire/auto-dm.js";
import {
  connectStatusPatch,
  controlPatchIsSafe,
  disconnectStatusPatch,
  forwardClientMessage,
  handleFromAnchors,
  handleFromUsernameField,
  hashLoginToken,
  loginLinkOpen,
  loginSettled,
  sessionStateForDisk,
  workspaceIdOk
} from "../../acquire/dm-login.js";

export const LOGIN_PORT = 8790;
const BODY_LIMIT = 4096;

export function loginPageHtml() {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>Instagram</title>
<style>
  html, body { margin: 0; height: 100%; background: #111; color: #eee; font: 15px sans-serif; }
  img { width: 100%; height: calc(100% - 48px); object-fit: contain; background: #000; }
  p { margin: 0; padding: 14px 16px; }
</style>
<p id="note">Instagram's own page, including any code or check. Click it, then type.</p>
<img id="view" alt="Instagram login">
<script>
const note = document.getElementById("note");
const view = document.getElementById("view");
view.draggable = false;
view.src = location.pathname + "/stream";
let open = true;
function send(message) {
  if (!open) return;
  fetch(location.pathname + "/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message)
  });
}
function at(event) {
  const rect = view.getBoundingClientRect();
  const width = view.naturalWidth || rect.width || 1;
  const height = view.naturalHeight || rect.height || 1;
  return {
    x: Math.round((event.clientX - rect.left) * width / (rect.width || 1)),
    y: Math.round((event.clientY - rect.top) * height / (rect.height || 1)),
    button: "left",
    clickCount: 1
  };
}
view.addEventListener("mousemove", (event) => send({ method: "Input.dispatchMouseEvent", params: Object.assign({ type: "mouseMoved" }, at(event)) }));
view.addEventListener("mousedown", (event) => send({ method: "Input.dispatchMouseEvent", params: Object.assign({ type: "mousePressed" }, at(event)) }));
view.addEventListener("mouseup", (event) => send({ method: "Input.dispatchMouseEvent", params: Object.assign({ type: "mouseReleased" }, at(event)) }));
document.addEventListener("keydown", (event) => {
  if (!open) return;
  event.preventDefault();
  const text = event.key && event.key.length === 1 ? event.key : "";
  send({ method: "Input.dispatchKeyEvent", params: { type: "keyDown", key: event.key, code: event.code, text: text, windowsVirtualKeyCode: event.keyCode, nativeVirtualKeyCode: event.keyCode } });
  if (text) send({ method: "Input.dispatchKeyEvent", params: { type: "char", key: event.key, text: text } });
});
document.addEventListener("keyup", (event) => {
  if (!open) return;
  event.preventDefault();
  send({ method: "Input.dispatchKeyEvent", params: { type: "keyUp", key: event.key, code: event.code, windowsVirtualKeyCode: event.keyCode, nativeVirtualKeyCode: event.keyCode } });
});
document.addEventListener("paste", (event) => {
  if (!open) return;
  event.preventDefault();
  const text = event.clipboardData && event.clipboardData.getData("text");
  if (text) send({ method: "Input.insertText", params: { text: text } });
});
setInterval(async () => {
  const response = await fetch(location.pathname + "/status");
  if (!response.ok) return;
  const data = await response.json();
  if (data.status === "connected") {
    open = false;
    view.remove();
    note.textContent = "Connected as @" + (data.handle || "");
  }
  if (data.status === "closed") {
    open = false;
    note.textContent = "This login link is closed.";
  }
}, 2000);
</script>`;
}

export function tokenFromPath(pathname) {
  const match = String(pathname || "").match(/^\/(login|disconnect)\/([a-f0-9]{64})(?:\/(stream|input|status))?$/);
  if (!match) return null;
  if (match[1] === "disconnect" && match[3]) return null;
  return {
    kind: match[1],
    token: match[2],
    action: match[3] || (match[1] === "disconnect" ? "disconnect" : "page")
  };
}

export function ensureSessionKey(keyFile) {
  try {
    const existing = readFileSync(keyFile, "utf8").trim();
    if (existing) return existing;
  } catch (_error) {
    /* first login for this workspace creates the key */
  }
  const key = randomBytes(32).toString("hex");
  writeFileSync(keyFile, key + "\n", { mode: 0o600 });
  chmodSync(keyFile, 0o600);
  return key;
}

export function encryptStorageState({ state, file, key }) {
  const clean = sessionStateForDisk(state);
  const dir = mkdtempSync(join(tmpdir(), "rf-login-"));
  const plain = join(dir, "state.json");
  try {
    writeFileSync(plain, JSON.stringify(clean), { mode: 0o600 });
    const result = spawnSync("openssl", [
      "enc", "-aes-256-cbc", "-pbkdf2", "-salt",
      "-in", plain,
      "-out", file,
      "-pass", "env:ROLEFLOW_DM_SESSION_KEY"
    ], { env: { ...process.env, ROLEFLOW_DM_SESSION_KEY: key } });
    if (result.status !== 0) return false;
    chmodSync(file, 0o600);
    return true;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function restRequest(env, path, options = {}) {
  const root = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!root || !key || !path) return null;
  const headers = {
    apikey: key,
    authorization: "Bearer " + key,
    accept: "application/json"
  };
  const init = { method: options.method || "GET", headers };
  if (options.body) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  return { url: root + "/rest/v1/" + path, init };
}

function logStatus(log, status) {
  const known = status === "listen" || status === "closed" || status === "connected" || status === "disconnect" || status === "missing_env" || status === "browser_missing";
  if (known) log(status);
}

async function loadPlaywright(env) {
  const root = env.ROLEFLOW_DM_PLAYWRIGHT_ROOT || "";
  if (root) return createRequire(join(root, "package.json"))("playwright");
  const loaded = await import("playwright");
  return loaded.chromium ? loaded : loaded.default;
}

export async function launchInstagramBrowser(env = process.env) {
  const previousDebug = process.env.DEBUG;
  delete process.env.DEBUG;
  try {
    const playwright = await loadPlaywright(env);
    const browser = await playwright.chromium.launch({
      headless: env.ROLEFLOW_DM_LOGIN_HEADED === "1" ? false : true,
      args: ["--disable-dev-shm-usage"]
    });
    const context = await browser.newContext({ viewport: { width: 420, height: 800 } });
    context.setDefaultTimeout(15000);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    let onFrame = () => {};
    cdp.on("Page.screencastFrame", async (frame) => {
      onFrame(Buffer.from(frame.data, "base64"));
      await cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
    });
    await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "domcontentloaded", timeout: 20000 });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 40, maxWidth: 420, maxHeight: 800, everyNthFrame: 1 });
    return {
      send(message) { return cdp.send(message.method, message.params || {}); },
      cookies() { return context.cookies("https://www.instagram.com"); },
      url() { return page.url(); },
      storageState() { return context.storageState(); },
      anchors() {
        return page.evaluate(() => [...document.querySelectorAll("a[href]")].map((node) => node.getAttribute("href")));
      },
      async username() {
        await page.goto("https://www.instagram.com/accounts/edit/", { waitUntil: "domcontentloaded", timeout: 20000 });
        return page.locator("input[name='username']").inputValue().catch(() => "");
      },
      onFrame(callback) { onFrame = callback; },
      close() { return browser.close(); }
    };
  } finally {
    if (previousDebug) process.env.DEBUG = previousDebug;
  }
}

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        tooBig = true;
        chunks.length = 0;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooBig) {
        finish({ error: 413 });
        return;
      }
      try { finish({ value: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
      catch (_error) { finish({ value: null }); }
    });
    req.on("error", () => finish(tooBig ? { error: 413 } : { value: null }));
  });
}

export function createLoginServer(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const launch = options.launch || (() => launchInstagramBrowser(env));
  const sessionDir = options.sessionDir || env.ROLEFLOW_DM_SESSION_DIR || "";
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const interval = options.interval || 50;
  const log = options.log || ((status) => {
    console.log(JSON.stringify({ login: status }));
  });
  const now = options.now || (() => new Date());
  const sessions = new Map();
  const timers = new Set();

  function configured() {
    return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && sessionDir);
  }

  async function supabase(path, requestOptions) {
    const request = restRequest(env, path, requestOptions);
    if (!request) return { ok: false, data: null };
    const response = await fetchImpl(request.url, request.init);
    if (!response.ok) return { ok: false, data: null };
    if (response.status === 204) return { ok: true, data: null };
    const data = await response.json();
    return { ok: true, data };
  }

  async function loadLink(token) {
    const tokenHash = await hashLoginToken(token);
    const loaded = await supabase(
      "acq_dm_login_links?token_hash=eq." + tokenHash + "&select=id,business_id,purpose,expires_at,used_at",
      { method: "GET" }
    );
    if (!loaded.ok) return { error: 503 };
    const row = Array.isArray(loaded.data) ? loaded.data[0] : null;
    if (!loginLinkOpen(row, now()) || !workspaceIdOk(row.business_id)) return { error: 410 };
    return { row };
  }

  async function markUsed(linkId) {
    await supabase("acq_dm_login_links?id=eq." + linkId, {
      method: "PATCH",
      body: { used_at: now().toISOString() }
    });
  }

  async function patchControls(businessId, patch) {
    if (!controlPatchIsSafe(patch) || !workspaceIdOk(businessId)) return false;
    const saved = await supabase("acq_dm_controls?business_id=eq." + businessId, {
      method: "PATCH",
      body: patch
    });
    return saved.ok;
  }

  async function saveConnected(session, browser) {
    let handle = "";
    try {
      handle = handleFromUsernameField(await browser.username());
      if (!handle) handle = handleFromAnchors(await browser.anchors());
    } catch (_error) {
      handle = "";
    }
    const patch = connectStatusPatch(handle);
    if (!patch) {
      session.status = "closed";
      return;
    }
    let state = { cookies: [], origins: [] };
    try { state = await browser.storageState(); } catch (_error) { state = { cookies: [], origins: [] }; }
    mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
    const paths = sessionPaths(sessionDir, session.businessId);
    const key = ensureSessionKey(paths.keyFile);
    if (!encryptStorageState({ state, file: paths.file, key })) {
      session.status = "closed";
      return;
    }
    if (!await patchControls(session.businessId, patch)) {
      rmSync(paths.file, { force: true });
      session.status = "closed";
      return;
    }
    await markUsed(session.linkId);
    session.used = true;
    session.handle = patch.ig_handle;
    session.status = "connected";
    session.latestFrame = null;
    logStatus(log, "connected");
  }

  async function startBrowser(session) {
    let browser;
    try {
      browser = await launch();
      session.browser = browser;
      browser.onFrame((frame) => {
        if (session.status === "pending") session.latestFrame = frame;
      });
      session.markLaunched();
      while (!session.closed && now().getTime() < session.expiresAt) {
        let cookies = [];
        let pageUrl = "";
        try {
          cookies = await browser.cookies();
          pageUrl = await browser.url();
        } catch (_error) {
          cookies = [];
          pageUrl = "";
        }
        if (loginSettled(cookies, pageUrl)) {
          await saveConnected(session, browser);
          return;
        }
        await sleep(interval);
      }
      if (session.status !== "connected") {
        session.status = "closed";
        session.latestFrame = null;
        if (!session.used) {
          session.used = true;
          await markUsed(session.linkId);
        }
        logStatus(log, "closed");
      }
    } catch (_error) {
      session.status = "closed";
      logStatus(log, "browser_missing");
    } finally {
      session.markLaunched();
      session.latestFrame = null;
      if (browser) {
        try { await browser.close(); } catch (_error) { /* already closed */ }
      }
    }
  }

  function beginLogin(row) {
    const token = row.token;
    if (sessions.has(token)) return sessions.get(token);
    let markLaunched = () => {};
    const session = {
      token,
      linkId: row.id,
      businessId: row.business_id,
      purpose: row.purpose,
      expiresAt: new Date(row.expires_at).getTime(),
      status: "pending",
      handle: "",
      latestFrame: null,
      browser: null,
      closed: false,
      used: false,
      launched: new Promise((resolve) => { markLaunched = resolve; })
    };
    session.markLaunched = () => markLaunched();
    sessions.set(token, session);
    session.done = startBrowser(session);
    return session;
  }

  function begin(res, status, type, extra) {
    const headers = Object.assign({
      "content-type": type,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "x-content-type-options": "nosniff"
    }, extra || {});
    res.writeHead(status, headers);
  }

  function text(res, status, body) {
    begin(res, status, "text/plain; charset=utf-8");
    res.end(body);
  }

  async function handle(req, res) {
    if (req.method === "OPTIONS") {
      begin(res, 204, "text/plain");
      res.end();
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      begin(res, 200, "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    const route = tokenFromPath(url.pathname);
    if (!route) {
      text(res, 404, "Not found");
      return;
    }
    if (!configured()) {
      logStatus(log, "missing_env");
      text(res, 503, "Login is not configured on this computer.");
      return;
    }
    if (route.kind === "disconnect") {
      if (req.method !== "POST") {
        text(res, 405, "Not found");
        return;
      }
      const loaded = await loadLink(route.token);
      if (loaded.error || loaded.row.purpose !== "disconnect") {
        text(res, loaded.error || 410, "This link is closed.");
        return;
      }
      rmSync(sessionPaths(sessionDir, loaded.row.business_id).file, { force: true });
      const cleared = await patchControls(loaded.row.business_id, disconnectStatusPatch());
      if (!cleared) {
        text(res, 503, "Login is not available right now.");
        return;
      }
      await markUsed(loaded.row.id);
      logStatus(log, "disconnect");
      begin(res, 200, "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (route.action === "page" && req.method === "GET") {
      const loaded = await loadLink(route.token);
      if (loaded.error || loaded.row.purpose !== "login") {
        text(res, loaded.error || 410, "This link is closed.");
        return;
      }
      begin(res, 200, "text/html; charset=utf-8");
      res.end(loginPageHtml());
      return;
    }
    if (route.action === "status" && req.method === "GET" && !sessions.has(route.token)) {
      const loaded = await loadLink(route.token);
      if (loaded.error || loaded.row.purpose !== "login") {
        text(res, loaded.error || 410, "This link is closed.");
        return;
      }
      begin(res, 200, "application/json");
      res.end(JSON.stringify({ status: "waiting", handle: "" }));
      return;
    }
    if (route.action !== "status" && route.action !== "input" && route.action !== "stream") {
      text(res, 405, "Not found");
      return;
    }
    let session = sessions.get(route.token);
    if (session && session.status === "closed" && !session.used) sessions.delete(route.token);
    if (!sessions.has(route.token)) {
      const loaded = await loadLink(route.token);
      if (loaded.error || loaded.row.purpose !== "login") {
        text(res, loaded.error || 410, "This link is closed.");
        return;
      }
      session = beginLogin(Object.assign({ token: route.token }, loaded.row));
    } else {
      session = sessions.get(route.token);
    }
    if (route.action === "status" && req.method === "GET") {
      begin(res, 200, "application/json");
      res.end(JSON.stringify({ status: session.status, handle: session.handle || "" }));
      return;
    }
    if (route.action === "input" && req.method === "POST") {
      const body = await readJson(req);
      if (body.error) {
        text(res, body.error, "Not found");
        return;
      }
      const safe = forwardClientMessage(body.value);
      await session.launched;
      if (safe && session.browser && session.status === "pending") {
        try { await session.browser.send(safe); } catch (_error) { /* the page may be navigating */ }
      }
      begin(res, 204, "text/plain");
      res.end();
      return;
    }
    if (route.action === "stream" && req.method === "GET") {
      await session.launched;
      if (!session.browser) {
        text(res, 503, "The login browser is not available.");
        return;
      }
      begin(res, 200, "multipart/x-mixed-replace; boundary=frame", { "x-accel-buffering": "no" });
      const timer = setInterval(() => {
        if (res.writableEnded || res.destroyed) {
          clearInterval(timer);
          timers.delete(timer);
          return;
        }
        if (session.latestFrame) {
          res.write("--frame\r\nContent-Type: image/jpeg\r\n\r\n");
          res.write(session.latestFrame);
          res.write("\r\n");
        }
        if (session.status !== "pending") {
          clearInterval(timer);
          timers.delete(timer);
          res.end();
        }
      }, interval);
      timers.add(timer);
      req.on("close", () => {
        clearInterval(timer);
        timers.delete(timer);
      });
      return;
    }
    text(res, 405, "Not found");
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) text(res, 503, "Login is not available right now.");
    });
  });
  server.on("close", () => {
    for (const timer of timers) clearInterval(timer);
    timers.clear();
    for (const session of sessions.values()) session.closed = true;
  });
  return server;
}

export function startLoginService(env = process.env) {
  const server = createLoginServer({ env });
  const host = env.ROLEFLOW_DM_LOGIN_HOST || "127.0.0.1";
  const port = Number(env.ROLEFLOW_DM_LOGIN_PORT || LOGIN_PORT);
  server.listen(port, host, () => {
    console.log(JSON.stringify({ login: "listen" }));
  });
  return server;
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isDirectRun()) {
  if (!process.env.ROLEFLOW_DM_SESSION_DIR || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log(JSON.stringify({ login: "missing_env" }));
    process.exit(1);
  }
  startLoginService(process.env);
}
