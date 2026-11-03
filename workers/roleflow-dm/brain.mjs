// Long-running outreacher process. One business, one browser profile, no model key.
// node workers/roleflow-dm/brain.mjs
// Sending stays off unless ROLEFLOW_DM_LIVE=1 and the panel has turned dry-run off.

import { readFileSync } from "node:fs";
import { bootMachine, heartbeatEvery, snapshot, tickMachine } from "./brain-loop.mjs";
import { createApi, machineEndpoint } from "./brain-api.mjs";
import {
  ACCESS_FILE,
  BACKUP_KEY_FILE,
  BOOTSTRAP_FILE,
  ENDPOINTS_FILE,
  METADATA_INSTANCE_URL,
  PROXY_FILE,
  PROXY_NFT_FILE,
  REFRESH_FILE,
  VOLUME_KEY_FILE,
  ensureSession,
  placeRuntimeSecrets,
  readEndpoints,
  shredPath,
  writeMode
} from "./brain-auth.mjs";
import { bootDeadlineMs } from "./brain-health.mjs";
import { bootstrapFields, parseProxy } from "./brain-nft.mjs";
import { publicLog } from "./brain-guard.mjs";
import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";

const isMain = process.argv[1] && process.argv[1].endsWith("brain.mjs");

export function createRuntime(env) {
  const started = Date.now();
  const state = {
    ledger: { baselined: false, events: [], sends: [], attempts: [] },
    booted: existsSync("/data/state/boot.json"),
    session: "unknown",
    halt: false,
    lastError: "",
    lastBackupDate: ""
  };
  const endpoints = readEndpoints(ENDPOINTS_FILE) || {};
  let base = env.ROLEFLOW_SUPABASE_URL || endpoints.supabase_url || "";
  if (!base && existsSync(BOOTSTRAP_FILE)) {
    base = bootstrapFields(readFileSync(BOOTSTRAP_FILE, "utf8")).supabase_url;
  }
  let access = "";
  let refresh = "";
  const api = createApi({
    base,
    readAccess: async () => access || (existsSync(ACCESS_FILE) ? readFileSync(ACCESS_FILE, "utf8") : ""),
    readRefresh: async () => refresh || (existsSync(REFRESH_FILE) ? readFileSync(REFRESH_FILE, "utf8") : ""),
    writeTokens: async (nextAccess, nextRefresh) => {
      access = nextAccess;
      refresh = nextRefresh;
      writeMode(ACCESS_FILE, nextAccess, 0o600);
      writeMode(REFRESH_FILE, nextRefresh, 0o600);
    },
    log: (entry) => console.log(JSON.stringify(publicLog(entry)))
  });
  const ctx = {
    env,
    started,
    now: () => new Date(),
    random: Math.random,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    bootWindow: () => bootDeadlineMs(state.booted === true),
    state,
    config: {},
    api,
    auth: {
      ensure: () => ensureSession({
        accessPath: ACCESS_FILE,
        refreshPath: REFRESH_FILE,
        bootstrapPath: BOOTSTRAP_FILE,
        endpointsPath: ENDPOINTS_FILE,
        exists: async (path) => existsSync(path),
        read: async (path) => existsSync(path) ? readFileSync(path, "utf8") : "",
        writeSecret: async (path, data) => writeMode(path, data, 0o600),
        writeJson: async (path, data) => writeMode(path, JSON.stringify(data), 0o600),
        shred: async (path) => shredPath(path),
        metadata: () => fetch(METADATA_INSTANCE_URL).then((response) => response.ok ? response.text() : ""),
        exchange: (input) => api.exchange(input)
      })
    },
    secrets: {
      writeProxy: async (url) => {
        const parsed = parseProxy(url, () => "");
        const usable = parsed.ok ? parsed : parseProxy(url, (host) => host);
        if (!usable.ok) return;
        writeMode(PROXY_FILE, usable.serverArg, 0o640);
        writeMode(PROXY_NFT_FILE, usable.ip + " " + usable.port + "\n", 0o644);
      },
      writeBackupKey: async (key) => writeMode(BACKUP_KEY_FILE, key, 0o600),
      writeVolumeKey: async (key) => writeMode(VOLUME_KEY_FILE, key, 0o600)
    },
    browser: { health: async () => ({ url: "", text: "" }), listActivity: async () => ({ ok: false, reason: "ui" }), readProfile: async () => ({ ok: false }), openDm: async () => ({}) },
    persist: () => writeMode("/data/state/ledger.json", JSON.stringify(state.ledger), 0o600),
    stopped: false
  };
  ctx.place = (config) => placeRuntimeSecrets(config, ctx.secrets);
  return ctx;
}

async function main() {
  mkdirSync("/data/state", { recursive: true });
  mkdirSync("/data/secrets", { recursive: true });
  mkdirSync("/run/roleflow", { recursive: true });
  const ctx = createRuntime(process.env);
  process.on("SIGTERM", () => { ctx.stopped = true; });
  const booted = await bootMachine(ctx);
  console.log(JSON.stringify(publicLog(booted)));
  if (!booted.ok) process.exit(1);
  writeMode("/data/state/boot.json", JSON.stringify({ booted: true }), 0o600);
  if (process.env.ROLEFLOW_DM_BROWSER !== "0") {
    const { attachBrowser } = await import("./brain-cdp.mjs");
    ctx.browser = await attachBrowser(process.env);
  }
  while (!ctx.stopped) {
    if (heartbeatDueSafe(ctx)) {
      const beat = await ctx.api.heartbeat(snapshot(ctx, ctx.state.session || "ok"));
      ctx.state.lastHeartbeatAt = ctx.now().toISOString();
      if (beat && beat.halt === true) ctx.state.halt = true;
      console.log(JSON.stringify(publicLog({ action: "heartbeat", ok: beat.ok !== false, reason: beat.reason || "" })));
    }
    const result = await tickMachine(ctx);
    console.log(JSON.stringify(publicLog(result)));
    await ctx.sleep(Math.min(heartbeatEvery(ctx.random), 15000));
  }
}

function heartbeatDueSafe(ctx) {
  return !ctx.state.lastHeartbeatAt || (ctx.now().getTime() - new Date(ctx.state.lastHeartbeatAt).getTime()) >= heartbeatEvery(() => 0.5);
}

if (isMain) {
  main().catch((error) => {
    console.log(JSON.stringify(publicLog({ ok: false, reason: error && error.message || "failed" })));
    process.exit(1);
  });
}

export { machineEndpoint };
