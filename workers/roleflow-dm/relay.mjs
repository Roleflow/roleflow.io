// Polls Supabase for one-time links and streams Instagram over a private Realtime channel.
// The box only dials out. Frames and typed input are not written down.

import { mkdirSync, rmSync } from "node:fs";
import { sessionPaths } from "../../acquire/auto-dm.js";
import {
  connectStatusPatch,
  controlPatchIsSafe,
  disconnectStatusPatch,
  framePayload,
  handleFromAnchors,
  handleFromUsernameField,
  inputFromBroadcast,
  loginSettled,
  sessionStateForDisk,
  statusPayload,
  workspaceIdOk
} from "../../acquire/dm-login.js";
import { createRealtime } from "./realtime.mjs";
import { restRequest } from "./rest.mjs";

const POLL_MS = 2000;
const FRAME_MS = 500;

async function call(env, fetchImpl, path, options) {
  const request = restRequest(env, path, options || {});
  if (!request) return { ok: false, data: null };
  const response = await fetchImpl(request.url, request.init);
  if (!response.ok) return { ok: false, data: null };
  if (response.status === 204) return { ok: true, data: null };
  return { ok: true, data: await response.json().catch(() => null) };
}

export async function runLoginRelay(options) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sessionDir = options.sessionDir || env.ROLEFLOW_DM_SESSION_DIR || "";
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now || (() => new Date());
  const log = options.log || ((status) => {
    console.log(JSON.stringify({ login: status }));
  });
  const launch = options.launch;
  const encrypt = options.encryptStorageState;
  const ensureKey = options.ensureSessionKey;
  const realtime = options.realtime || (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? createRealtime({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, log, heartbeatMs: options.heartbeatMs })
    : null);
  const active = new Map();
  if (sessionDir) mkdirSync(sessionDir, { recursive: true, mode: 0o700 });

  async function beat() {
    await call(env, fetchImpl, "rpc/acq_dm_login_beat", { method: "POST", body: {} });
  }

  async function markUsed(id) {
    await call(env, fetchImpl, "acq_dm_login_links?id=eq." + id, {
      method: "PATCH",
      body: { used_at: now().toISOString() }
    });
  }

  async function patchControls(businessId, patch) {
    if (!controlPatchIsSafe(patch) || !workspaceIdOk(businessId)) return false;
    const saved = await call(env, fetchImpl, "acq_dm_controls?business_id=eq." + businessId, {
      method: "PATCH",
      body: patch
    });
    return saved.ok;
  }

  async function disconnect(link) {
    if (!workspaceIdOk(link.business_id) || !sessionDir) return;
    rmSync(sessionPaths(sessionDir, link.business_id).file, { force: true });
    const cleared = await patchControls(link.business_id, disconnectStatusPatch());
    if (cleared) await markUsed(link.id);
    log("disconnect");
  }

  async function finish(link, browser, channel) {
    let handle = "";
    try {
      handle = handleFromUsernameField(await browser.username());
      if (!handle) handle = handleFromAnchors(await browser.anchors());
    } catch (_error) {
      handle = "";
    }
    const patch = connectStatusPatch(handle);
    if (!patch || !encrypt || !ensureKey) return false;
    const state = sessionStateForDisk(await browser.storageState());
    const paths = sessionPaths(sessionDir, link.business_id);
    const key = ensureKey(paths.keyFile);
    if (!encrypt({ state, file: paths.file, key })) return false;
    if (!await patchControls(link.business_id, patch)) {
      rmSync(paths.file, { force: true });
      return false;
    }
    channel.send("status", statusPayload("connected", patch.ig_handle));
    await markUsed(link.id);
    log("connected");
    return true;
  }

  function watch(link, browser) {
    let latest = null;
    let last = "";
    let accept = () => {};
    const channel = realtime.join(link.token_hash, (body) => accept(body));
    accept = (body) => {
      const safe = inputFromBroadcast(body);
      if (!safe || !browser.send) return;
      browser.send(safe).catch(() => {});
    };
    browser.onFrame((frame) => { latest = frame; });
    const timer = setInterval(() => {
      if (!latest) return;
      const encoded = Buffer.from(latest).toString("base64");
      if (encoded === last) return;
      const payload = framePayload(encoded);
      if (!payload) return;
      if (channel.send("frame", payload)) last = encoded;
    }, options.frameMs || FRAME_MS);
    if (timer.unref) timer.unref();
    const session = { closed: false, timer, channel };
    active.set(link.token_hash, session);
    (async () => {
      try {
        const deadline = new Date(link.expires_at).getTime();
        while (!session.closed && now().getTime() < deadline) {
          let cookies = [];
          let pageUrl = "";
          try {
            cookies = await browser.cookies();
            pageUrl = await browser.url();
          } catch (_error) {
            cookies = [];
          }
          if (loginSettled(cookies, pageUrl)) {
            await finish(link, browser, channel);
            break;
          }
          await sleep(options.interval || 200);
        }
        if (!session.closed && now().getTime() >= deadline) await markUsed(link.id);
      } catch (_error) {
        log("browser_missing");
      } finally {
        clearInterval(timer);
        session.closed = true;
        active.delete(link.token_hash);
        try { channel.close(); } catch (_error) { /* already closed */ }
        try { await browser.close(); } catch (_error) { /* already closed */ }
      }
    })();
  }

  async function tick() {
    await beat();
    const listed = await call(
      env,
      fetchImpl,
      "acq_dm_login_links?used_at=is.null&select=id,business_id,token_hash,purpose,expires_at,used_at&order=created_at.asc&limit=20",
      { method: "GET" }
    );
    const rows = listed.ok && Array.isArray(listed.data) ? listed.data : [];
    for (const link of rows) {
      if (!link || active.has(link.token_hash)) continue;
      const end = new Date(link.expires_at).getTime();
      if (!Number.isFinite(end) || end <= now().getTime()) {
        await markUsed(link.id);
        continue;
      }
      if (link.purpose === "disconnect") {
        await disconnect(link);
        continue;
      }
      if (link.purpose !== "login" || !realtime || !launch) continue;
      let browser;
      try { browser = await launch(); } catch (_error) {
        log("browser_missing");
        continue;
      }
      watch(link, browser);
    }
  }

  do {
    try { await tick(); } catch (_error) { log("relay_closed"); }
    if (options.once) break;
    await sleep(options.pollMs || POLL_MS);
  } while (!options.once);
  return { active, close: () => realtime && realtime.close() };
}
