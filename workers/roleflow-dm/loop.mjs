// One pass over a workspace: new followers and likers, then a DM if planDm allows it.
// The panel switch is the send switch. The process does not keep a second one.

import { mkdirSync } from "node:fs";
import { planDm, sentOnDay, sessionPaths, madridActive } from "../../acquire/auto-dm.js";
import { restRequest } from "./rest.mjs";
import { draftOpener } from "./opener.mjs";
import { sendPlanned } from "./send.mjs";
import { readSessionKey } from "./session-file.mjs";
import { readInstagram as loadInstagram } from "./instagram.mjs";
import {
  chooseApiKey,
  claimLock,
  dueEvents,
  exclusionList,
  markHandled,
  mergeActivity,
  playbookText,
  readLedger,
  writeLedger
} from "./feed.mjs";

const INTERVAL_MS = 3 * 60 * 1000;

async function supabase(env, path, options) {
  const request = restRequest(env, path, options || {});
  if (!request) return { ok: false, data: null };
  const response = await fetch(request.url, request.init);
  if (!response.ok) return { ok: false, data: null };
  if (response.status === 204) return { ok: true, data: null };
  return { ok: true, data: await response.json() };
}

export function createIo(env) {
  return {
    async readControls(workspaceId) {
      let loaded = await supabase(env, "acq_dm_controls?business_id=eq." + workspaceId + "&select=enabled,killed,daily_cap,paused_reason,ig_handle", { method: "GET" });
      if (!loaded.ok) {
        loaded = await supabase(env, "acq_dm_controls?business_id=eq." + workspaceId + "&select=enabled,killed,daily_cap,paused_reason", { method: "GET" });
      }
      const row = loaded.ok && Array.isArray(loaded.data) ? loaded.data[0] : null;
      if (!row) return null;
      return {
        enabled: row.enabled === true,
        killed: row.killed === true,
        cap: row.daily_cap,
        paused: String(row.paused_reason || "").trim() !== "",
        ownHandle: row.ig_handle || ""
      };
    },
    async readSends(workspaceId) {
      const loaded = await supabase(env, "acq_dm_sends?business_id=eq." + workspaceId + "&select=handle,body,created_at&order=created_at.desc&limit=200", { method: "GET" });
      return loaded.ok && Array.isArray(loaded.data) ? loaded.data : [];
    },
    async readContext(workspaceId) {
      const [campaigns, prompt, settings, brief] = await Promise.all([
        supabase(env, "acq_dm_campaigns?business_id=eq." + workspaceId + "&select=exclusions,template&limit=20", { method: "GET" }),
        supabase(env, "acq_agent_prompt_versions?business_id=eq." + workspaceId + "&select=body,setter_voice&order=version.desc&limit=1", { method: "GET" }),
        supabase(env, "acq_settings?agent_id=eq." + workspaceId + "&select=setter_voice", { method: "GET" }),
        supabase(env, "acq_business_briefs?business_id=eq." + workspaceId + "&select=fields", { method: "GET" })
      ]);
      const campaignRows = campaigns.ok && Array.isArray(campaigns.data) ? campaigns.data : [];
      const promptRow = prompt.ok && Array.isArray(prompt.data) ? prompt.data[0] : null;
      const settingsRow = settings.ok && Array.isArray(settings.data) ? settings.data[0] : null;
      const briefRow = brief.ok && Array.isArray(brief.data) ? brief.data[0] : null;
      const voice = settingsRow && settingsRow.setter_voice != null
        ? settingsRow.setter_voice
        : promptRow && promptRow.setter_voice != null ? promptRow.setter_voice : 50;
      const keyLoaded = await supabase(env, "rpc/acq_llm_read_key", {
        method: "POST",
        body: { p_business: workspaceId, p_provider: "anthropic" }
      });
      const keyRow = keyLoaded.ok && keyLoaded.data && keyLoaded.data.ok === true ? keyLoaded.data : null;
      return {
        prompt: promptRow && promptRow.body || "",
        playbook: playbookText(briefRow && briefRow.fields, campaignRows),
        voice,
        exclusions: exclusionList(campaignRows),
        businessKey: keyRow && keyRow.api_key || ""
      };
    },
    readKey(paths) {
      return readSessionKey(paths.keyFile);
    },
    readInstagram(options) {
      return loadInstagram(options);
    },
    draft(options) {
      return draftOpener(options);
    },
    send(job) {
      return sendPlanned(job);
    },
    async recordSend(workspaceId, handle, body) {
      const saved = await supabase(env, "acq_dm_sends", {
        method: "POST",
        body: { business_id: workspaceId, handle, body: String(body || "").slice(0, 1000) }
      });
      return saved.ok;
    },
    async markPaused(workspaceId) {
      await supabase(env, "acq_dm_controls?business_id=eq." + workspaceId, {
        method: "PATCH",
        body: { paused_reason: "blocked", updated_at: new Date().toISOString() }
      });
    }
  };
}

function publicResult(workspaceId, reason, extra) {
  return Object.assign({ ok: reason === "sent" || reason === "idle" || reason === "off" || reason === "waiting" || reason === "baseline", workspaceId, reason }, extra || {});
}

export async function tickWorkspace(input) {
  const now = input.now instanceof Date ? input.now : new Date();
  const env = input.env || {};
  const workspaceId = String(input.workspaceId || "");
  const io = input.io;
  const paths = input.paths;
  if (env.ROLEFLOW_DM_KILL === "1") return publicResult(workspaceId, "killed", { ok: false });
  const controls = await io.readControls(workspaceId);
  if (!controls) return publicResult(workspaceId, "no_controls", { ok: false });
  if (controls.killed) return publicResult(workspaceId, "killed", { ok: false });
  if (!controls.enabled) return publicResult(workspaceId, "off");
  if (controls.paused) return publicResult(workspaceId, "paused", { ok: false });
  if (!madridActive(now)) return publicResult(workspaceId, "hours", { ok: false });
  const sessionKey = io.readKey(paths);
  if (!sessionKey) return publicResult(workspaceId, "no_session", { ok: false });
  const staleMs = Number(env.ROLEFLOW_DM_LOCK_MS || INTERVAL_MS * 2);
  if (!claimLock(paths.lockFile, input.pid || process.pid, now, staleMs)) return publicResult(workspaceId, "busy", { ok: true });
  const sends = await io.readSends(workspaceId);
  const context = await io.readContext(workspaceId);
  let ledger = readLedger(paths.feedFile);
  for (const row of ledger.events || []) {
    if (row && row.sent && row.recorded !== true && row.body) {
      const saved = await io.recordSend(workspaceId, row.handle, row.body);
      if (saved) row.recorded = true;
    }
  }
  const activity = await io.readInstagram({
    sessionFile: paths.file,
    sessionKey,
    ownHandle: controls.ownHandle,
    profileHandles: []
  });
  if (!activity || activity.ok !== true) {
    writeLedger(paths.feedFile, ledger);
    if (activity && activity.reason === "paused") {
      await io.markPaused(workspaceId);
      return publicResult(workspaceId, "paused", { ok: false });
    }
    return publicResult(workspaceId, "no_session", { ok: false });
  }
  ledger = mergeActivity({
    ledger,
    followers: activity.followers,
    likes: activity.likes,
    now,
    ownHandle: controls.ownHandle
  });
  const due = dueEvents(ledger, now, (sends || []).map((row) => row.handle));
  let profiles = {};
  if (due.length) {
    const loaded = await io.readInstagram({
      sessionFile: paths.file,
      sessionKey,
      ownHandle: controls.ownHandle,
      profileHandles: due.map((row) => row.handle)
    });
    if (loaded && loaded.reason === "paused") {
      writeLedger(paths.feedFile, ledger);
      await io.markPaused(workspaceId);
      return publicResult(workspaceId, "paused", { ok: false });
    }
    profiles = loaded && loaded.profiles || {};
  }
  const apiKey = chooseApiKey(context.businessKey, env.ANTHROPIC_API_KEY);
  const recent = (sends || []).map((row) => row.body).filter(Boolean);
  let sentToday = sentOnDay(sends, now);
  const sentHandles = [];
  for (const event of due) {
    if (sentToday >= Number(controls.cap || 20)) break;
    const drafted = await io.draft({
      apiKey,
      profile: profiles[event.handle] || {},
      prompt: context.prompt,
      playbook: context.playbook,
      voice: context.voice
    });
    const plan = planDm({
      workspaceId,
      enabled: true,
      killed: false,
      paused: false,
      handle: event.handle,
      cap: controls.cap,
      sentToday,
      followedAt: event.seenAt,
      random: () => event.roll,
      profile: profiles[event.handle] || {},
      draft: drafted && drafted.ok ? drafted.draft : "",
      recent,
      exclusions: context.exclusions,
      sentHandles: (sends || []).map((row) => row.handle).concat(sentHandles),
      now
    });
    if (!plan.ok) continue;
    ledger = markHandled(ledger, event.handle);
    const claimed = ledger.events.find((row) => row.handle === event.handle && row.sent && row.body == null);
    if (claimed) claimed.body = plan.body;
    writeLedger(paths.feedFile, ledger);
    let delivered;
    try {
      delivered = await io.send({
        workspaceId,
        enabled: true,
        killed: false,
        paused: false,
        handle: event.handle,
        cap: controls.cap,
        sentToday,
        followedAt: event.seenAt,
        random: () => event.roll,
        profile: profiles[event.handle] || {},
        draft: plan.body,
        recent,
        exclusions: context.exclusions,
        sentHandles: (sends || []).map((row) => row.handle).concat(sentHandles),
        now,
        sessionKey,
        sessionFile: paths.file,
        logFile: paths.logFile
      });
    } catch (_error) {
      delivered = { ok: false, reason: "not_sent" };
    }
    if (!delivered || delivered.ok !== true) {
      ledger = {
        baselined: true,
        events: ledger.events.map((row) => row.handle === event.handle && !row.baseline ? { ...row, sent: false, body: undefined } : row)
      };
      writeLedger(paths.feedFile, ledger);
      if (delivered && delivered.reason === "paused") {
        await io.markPaused(workspaceId);
        return publicResult(workspaceId, "paused", { ok: false });
      }
      continue;
    }
    const recorded = await io.recordSend(workspaceId, event.handle, plan.body);
    ledger = {
      baselined: true,
      events: ledger.events.map((row) => row.handle === event.handle ? { ...row, sent: true, recorded, body: plan.body } : row)
    };
    writeLedger(paths.feedFile, ledger);
    sentHandles.push(event.handle);
    recent.push(plan.body);
    sentToday += 1;
  }
  writeLedger(paths.feedFile, ledger);
  if (sentHandles.length) return publicResult(workspaceId, "sent", { handles: sentHandles });
  if (!input.paths || readLedger(paths.feedFile).baselined) {
    const waiting = (ledger.events || []).some((row) => row && !row.baseline && !row.sent);
    return publicResult(workspaceId, waiting ? "waiting" : "baseline");
  }
  return publicResult(workspaceId, "idle");
}

export async function runLoop(options) {
  const env = options.env || process.env;
  const workspaceId = String(options.workspaceId || "");
  const dir = env.ROLEFLOW_DM_SESSION_DIR || "";
  if (!dir || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log(JSON.stringify({ ok: false, workspaceId, reason: "missing_env" }));
    return 1;
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const paths = sessionPaths(dir, workspaceId);
  const io = options.io || createIo(env);
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const interval = Number(env.ROLEFLOW_DM_INTERVAL_MS || INTERVAL_MS);
  let stop = false;
  const onStop = () => { stop = true; };
  if (!options.once) {
    process.on("SIGTERM", onStop);
    process.on("SIGINT", onStop);
  }
  do {
    let result;
    try {
      result = await tickWorkspace({
        workspaceId,
        env,
        now: options.now ? options.now() : new Date(),
        paths,
        io,
        pid: options.pid || process.pid
      });
    } catch (_error) {
      result = { ok: false, workspaceId, reason: "not_sent" };
    }
    console.log(JSON.stringify(result));
    if (options.once || stop || (result.reason === "killed" && env.ROLEFLOW_DM_KILL === "1")) break;
    if (!options.once) await sleep(interval);
  } while (!stop);
  return 0;
}
