// Desired workflow, profile binding, and command state for one business.
// Queue insertion is never confirmation. A browser confirmation is a later result.
// This file is safe to load in the account panel: it has no vendor names and no secrets.

export const CURRENT_DESKTOP = Object.freeze({
  browser: "Google Chrome",
  managed_by_organization: true,
  profile_menu: "add_chrome_profile",
  profile_created: false,
  profile_tested: false,
  proxy_settings: "os_level_only",
  per_profile_proxy: false,
  proxies_provisioned: false,
  interaction: "computer_use",
  shell_browser_control: false,
  integration: "unavailable",
  test_only: false
});

export const OPERATIONS = Object.freeze(["set_workflow", "pause", "resume", "kill", "reconcile"]);
export const OPEN_STATUSES = Object.freeze(["queued", "needs_setup", "unsupported", "offline"]);
export const COMMAND_TTL_MS = 30 * 60 * 1000;
export const BACKOFF_S = Object.freeze([60, 300, 900, 1800]);
export const CHANNEL_URL = /^https:\/\/[a-z0-9.-]+(?::[0-9]+)?(?:\/[a-z0-9-]+)?\/v1\/channels\/[a-z0-9_-]+\/[a-z0-9_-]+$/;

const WORKFLOW_KEYS = [
  "timezone",
  "active_start",
  "active_hours",
  "poll_interval_min",
  "sources",
  "daily_prospect_min",
  "daily_prospect_max",
  "draft_only",
  "personalize",
  "templates"
];

export function createStore() {
  return {
    seq: 1,
    workers: [],
    profiles: [],
    proxies: [],
    machines: [],
    routes: [],
    secrets: [],
    states: [],
    versions: [],
    commands: [],
    results: [],
    activity: []
  };
}

export function desktopSupported(desktop) {
  const row = desktop || CURRENT_DESKTOP;
  return row.integration === "available"
    && row.per_profile_proxy === true
    && row.proxies_provisioned === true
    && row.shell_browser_control === false
    && row.interaction === "computer_use"
    && row.profile_created === true
    && row.profile_tested === true
    && row.managed_by_organization !== true;
}

export function windowEnd(start) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(start || ""));
  if (!match) return "";
  const minutes = (Number(match[1]) * 60 + Number(match[2]) + 16 * 60) % (24 * 60);
  return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
}

export function validateWorkflow(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : null;
  if (!source) return { ok: false, reason: "invalid" };
  const extra = Object.keys(source).filter((key) => !WORKFLOW_KEYS.includes(key));
  if (extra.length) return { ok: false, reason: "invalid" };
  if (source.draft_only !== true) return { ok: false, reason: "draft_only" };
  if (source.personalize !== "bio_facts_only") return { ok: false, reason: "personalize" };
  if (source.active_hours !== 16) return { ok: false, reason: "active_hours" };
  if (source.poll_interval_min !== 30) return { ok: false, reason: "poll" };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(source.active_start || ""))) return { ok: false, reason: "active_start" };
  const timezone = String(source.timezone || "");
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){1,2}$/.test(timezone)) return { ok: false, reason: "timezone" };
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    return { ok: false, reason: "timezone" };
  }
  const sources = Array.isArray(source.sources) ? source.sources : null;
  if (!sources || sources.length < 1 || sources.length > 2 || new Set(sources).size !== sources.length) {
    return { ok: false, reason: "sources" };
  }
  if (sources.some((item) => item !== "new_follower" && item !== "post_liker")) return { ok: false, reason: "sources" };
  const dailyMin = source.daily_prospect_min;
  const dailyMax = source.daily_prospect_max;
  if (!Number.isInteger(dailyMin) || !Number.isInteger(dailyMax) || dailyMin < 20 || dailyMax > 100 || dailyMin > dailyMax) {
    return { ok: false, reason: "daily" };
  }
  const templates = Array.isArray(source.templates) ? source.templates : null;
  if (!templates || templates.length < 1 || templates.length > 8) return { ok: false, reason: "templates" };
  const seen = new Set();
  for (const row of templates) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return { ok: false, reason: "templates" };
    const id = String(row.id || "");
    const text = String(row.text || "").trim();
    if (!/^[a-z0-9-]{1,40}$/.test(id) || seen.has(id) || text.length < 1 || text.length > 280) {
      return { ok: false, reason: "templates" };
    }
    if (Object.keys(row).some((key) => key !== "id" && key !== "text")) return { ok: false, reason: "templates" };
    seen.add(id);
  }
  return {
    ok: true,
    workflow: {
      timezone,
      active_start: String(source.active_start),
      active_hours: 16,
      poll_interval_min: 30,
      sources: [...sources].sort(),
      daily_prospect_min: dailyMin,
      daily_prospect_max: dailyMax,
      draft_only: true,
      personalize: "bio_facts_only",
      templates: templates
        .map((row) => ({ id: String(row.id), text: String(row.text).trim() }))
        .sort((a, b) => a.id.localeCompare(b.id))
    }
  };
}

export function workflowCanonical(workflow) {
  const templates = (workflow.templates || []).map((row) => row.id + "=" + row.text).join("\n");
  return [
    "roleflow-workflow.v1",
    workflow.timezone,
    workflow.active_start,
    String(workflow.active_hours),
    String(workflow.poll_interval_min),
    (workflow.sources || []).join(","),
    String(workflow.daily_prospect_min),
    String(workflow.daily_prospect_max),
    "true",
    workflow.personalize,
    templates
  ].join("\n");
}

export function commandCanonical(command, payloadHash) {
  return [
    "roleflow-controller.v1",
    String(command.business_id),
    command.profile_id || "-",
    command.worker_id || "-",
    command.proxy_id || "-",
    String(command.operation),
    String(command.workflow_version),
    String(command.idempotency_key),
    String(command.expires_at),
    payloadHash
  ].join("\n");
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text || "")));
  return hex(new Uint8Array(digest));
}

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(message || "")));
  return hex(new Uint8Array(sig));
}

export function backoffSeconds(attempt) {
  const index = Math.max(0, Number(attempt || 1) - 1);
  return BACKOFF_S[Math.min(index, BACKOFF_S.length - 1)];
}

export function bindProfile(store, input) {
  const next = clone(store);
  const worker = next.workers.find((row) => row.id === input.workerId);
  if (!worker) return fail("needs_setup", store);
  if (worker.capacity !== 2 && worker.capacity !== 3) return fail("capacity", store);
  if (worker.shell_control === true || worker.interaction !== "computer_use") return fail("shell_forbidden", store);
  const desktop = input.desktop || CURRENT_DESKTOP;
  if (!desktopSupported(desktop) || worker.proxy_mode !== "process_binding" || worker.desktop_capability !== "reported") {
    return fail("unsupported", store);
  }
  const profileKey = String(input.profileKey || "");
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(profileKey)) return fail("profile_required", store);
  if (!input.proxyId) return fail("needs_proxy", store);
  if (!input.businessId) return fail("forbidden", store);
  const slot = Number(input.processSlot);
  if (!Number.isInteger(slot) || slot < 1 || slot > worker.capacity) return fail("slot", store);
  if (!next.proxies.some((row) => row.id === input.proxyId)) return fail("needs_proxy", store);
  const liveMachines = next.machines.filter((row) => row.status !== "deleted" && row.status !== "revoked");
  if (liveMachines.some((row) => row.business_id === input.businessId)) return fail("machine_exists", store);
  if (liveMachines.some((row) => row.proxy_id === input.proxyId)) return fail("proxy_in_use", store);
  const live = next.profiles.filter((row) => row.status !== "revoked");
  if (live.filter((row) => row.worker_id === worker.id).length >= worker.capacity) return fail("capacity", store);
  if (live.some((row) => row.business_id === input.businessId)) return fail("profile_exists", store);
  if (live.some((row) => row.proxy_id === input.proxyId)) return fail("proxy_in_use", store);
  if (live.some((row) => row.worker_id === worker.id && (row.process_slot === slot || row.profile_key === profileKey))) {
    return fail("slot", store);
  }
  const profile = {
    id: nid(next),
    business_id: input.businessId,
    worker_id: worker.id,
    profile_key: profileKey,
    process_slot: slot,
    proxy_id: input.proxyId,
    ig_username: normalizeHandle(input.igUsername),
    session_state: "unknown",
    status: "needs_login",
    controller_seen_at: null,
    test_only: desktop.test_only === true
  };
  next.profiles.push(profile);
  return { ok: true, reason: "", store: next, profile };
}

export async function saveWorkflow(store, input) {
  const checked = validateWorkflow(input && input.document);
  if (!checked.ok) return fail(checked.reason, store);
  if (!input || !input.businessId) return fail("forbidden", store);
  const now = at(input.now);
  const next = clone(store);
  const hash = await sha256Hex(workflowCanonical(checked.workflow));
  const key = "set_workflow:" + input.businessId + ":" + hash;
  const existing = next.commands.find((row) => row.business_id === input.businessId && row.idempotency_key === key);
  if (existing) return { ok: true, reason: "duplicate", store: next, command: existing, workflow: checked.workflow, duplicate: true };
  const version = next.versions.filter((row) => row.business_id === input.businessId).reduce((max, row) => Math.max(max, row.version), 0) + 1;
  next.versions.push({ business_id: input.businessId, version, document: checked.workflow, document_sha256: hash, created_at: now });
  const state = ensureState(next, input.businessId);
  state.desired_version = version;
  const command = await enqueue(next, {
    businessId: input.businessId,
    operation: "set_workflow",
    version,
    payload: checked.workflow,
    payloadHash: hash,
    idempotencyKey: key,
    now
  });
  return { ok: true, reason: command.last_error, store: next, command, workflow: checked.workflow, state };
}

export async function setControl(store, input) {
  const action = String(input && input.action || "");
  if (action !== "pause" && action !== "resume" && action !== "kill") return fail("invalid", store);
  if (!input.businessId) return fail("forbidden", store);
  const next = clone(store);
  const state = ensureState(next, input.businessId);
  if (action === "resume" && state.killed) return fail("killed", store);
  if (action === "pause" && state.paused && !state.killed) {
    const prior = [...next.commands].reverse().find((row) => row.business_id === input.businessId && row.operation === "pause");
    if (prior) return { ok: true, reason: "duplicate", store: next, command: prior, duplicate: true };
  }
  if (action === "pause") state.paused = true;
  if (action === "resume") state.paused = false;
  if (action === "kill") {
    state.killed = true;
    state.paused = true;
  }
  state.control_generation += 1;
  const version = state.desired_version || 0;
  const command = await enqueue(next, {
    businessId: input.businessId,
    operation: action,
    version,
    payload: { action },
    payloadHash: await sha256Hex(action),
    idempotencyKey: action + ":" + input.businessId + ":" + state.control_generation,
    now: at(input.now)
  });
  return { ok: true, reason: command.last_error, store: next, command, state };
}

export async function pickup(store, input) {
  const now = at(input.now);
  const located = locate(store, input);
  if (!located.ok) return located.changed ? located : fail(located.reason, located.store || store);
  const next = located.store;
  const command = located.command;
  if (Date.parse(command.expires_at) <= Date.parse(now)) return expire(next, command, now);
  const state = ensureState(next, command.business_id);
  if (state.killed && command.operation !== "kill") return fail("killed", next, command);
  if (state.paused && command.operation === "set_workflow") return fail("paused", next, command);
  if (OPEN_STATUSES.includes(command.status) && command.status !== "queued") return fail(command.status, next, command);
  if (command.status === "failed" || command.status === "superseded" || command.status === "expired") {
    return fail(command.last_error || command.status, next, command);
  }
  if (command.status === "observed") return { ok: true, reason: "duplicate", duplicate: true, store: next, command };
  if (!command.signature) return fail("unsigned", next, command);
  const secret = next.secrets.find((row) => row.worker_id === located.profile.worker_id && row.signing_key);
  const expected = secret ? await hmacHex(secret.signing_key, commandCanonical(command, command.payload_sha256)) : "";
  if (!secret || !safeEqual(expected, command.signature)) return fail("unauthorized", next, command);
  command.lease_worker_id = input.principal.worker_id;
  command.lease_profile_id = located.profile.id;
  located.profile.controller_seen_at = now;
  return { ok: true, reason: "", store: next, command };
}

export async function acknowledge(store, input) {
  const now = at(input.now);
  const located = locate(store, input);
  if (!located.ok) return located.changed ? located : fail(located.reason, located.store || store);
  const next = located.store;
  const command = located.command;
  if (Date.parse(command.expires_at) <= Date.parse(now)) return expire(next, command, now);
  if (command.lease_profile_id && command.lease_profile_id !== located.profile.id) return audit(next, command, "misrouted");
  if (command.status === "acknowledged" || command.status === "observed") {
    return { ok: true, reason: "duplicate", duplicate: true, store: next, command };
  }
  if (command.status !== "queued" && command.status !== "accepted") return fail("not_acknowledged", next, command);
  command.status = "acknowledged";
  command.acknowledged_at = now;
  command.updated_at = now;
  touchState(next, command, "acknowledged");
  next.activity.push(event(next, command, "command_acknowledged"));
  return { ok: true, reason: "", store: next, command };
}

export async function recordResult(store, input) {
  const now = at(input.now);
  const outcome = String(input && input.outcome || "");
  if (outcome === "sent" || outcome === "live") return fail("send_forbidden", store);
  const located = locate(store, input);
  if (!located.ok) return located.changed ? located : fail(located.reason, located.store || store);
  const next = located.store;
  const command = located.command;
  const resultKey = String(input.resultKey || "");
  if (!resultKey) return fail("invalid", store);
  const prior = next.results.find((row) => row.business_id === command.business_id && row.result_key === resultKey);
  if (prior) return { ok: true, reason: "duplicate", duplicate: true, store: next, command, outcome: prior.outcome };
  if (Date.parse(command.expires_at) <= Date.parse(now) && command.status !== "observed") return expire(next, command, now);
  if (command.status !== "acknowledged" && command.status !== "observed") return fail("not_acknowledged", next, command);
  const items = Array.isArray(input.activity) ? input.activity : [];
  if (items.length > 20) return fail("invalid", store);
  for (const item of items) {
    const kind = String(item && item.kind || "");
    if (kind === "sent" || kind === "message_sent") return fail("send_forbidden", store);
    if ((kind === "draft_prepared" || kind === "qualification") && !facts(item).length) return fail("bio_facts_required", store);
    if (item && item.draft_text && !facts(item).length) return fail("bio_facts_required", store);
  }
  next.results.push({ business_id: command.business_id, result_key: resultKey, command_id: command.id, outcome, created_at: now });
  if (outcome === "observed") {
    command.status = "observed";
    command.observed_at = now;
    command.updated_at = now;
    if (!command.test_only) {
      const state = ensureState(next, command.business_id);
      state.observed_version = command.workflow_version;
      state.controller_status = "observed";
      state.last_error = "";
    }
    next.activity.push(event(next, command, "command_observed"));
  } else if (outcome === "failed") {
    command.status = "failed";
    command.last_error = "failed";
    command.updated_at = now;
    touchState(next, command, "failed");
    next.activity.push(event(next, command, "command_failed"));
  } else {
    return fail("invalid", store);
  }
  for (const item of items) remember(next, command, item, now);
  return { ok: true, reason: "", store: next, command, outcome };
}

export function controllerView(input) {
  const source = input || {};
  const desktop = source.desktop || CURRENT_DESKTOP;
  const supported = desktopSupported(desktop) && desktopSupported(CURRENT_DESKTOP);
  const controller = source.controller || {};
  const command = source.command || null;
  const desiredVersion = controller.desired_version || null;
  const observedVersion = controller.observed_version || null;
  let agreement = "needs_setup";
  if (source.unavailable) agreement = "needs_setup";
  else if (controller.killed || (command && command.status === "failed")) agreement = "failed";
  else if (command && command.status === "expired") agreement = "expired";
  else if (command && command.status === "offline") agreement = "offline";
  else if (observedVersion && observedVersion === desiredVersion) agreement = "confirmed";
  else if (desiredVersion) agreement = "unconfirmed";
  if (!supported && agreement === "confirmed") agreement = "unconfirmed";
  const rows = Array.isArray(source.activity) ? source.activity : [];
  return {
    desiredVersion,
    observedVersion: supported ? observedVersion : null,
    agreement,
    desktopAvailable: supported,
    delivery: supported ? "configured" : "disabled",
    connectEnabled: false,
    proxy: source.profile && (source.profile.proxy_id || ["needs_login", "offline", "ready", "paused"].includes(source.profile.status)) ? "assigned" : "not_assigned",
    profileStatus: source.profile ? source.profile.status : "unconfigured",
    fixture: Boolean((command && command.test_only) || rows.some((row) => row.test_only)),
    activity: rows.filter((row) => source.includeFixtures || !row.test_only),
    draftOnly: true,
    paused: controller.paused !== false,
    killed: controller.killed === true,
    commandStatus: command && !command.test_only ? command.status : null
  };
}

function remember(store, command, item, now) {
  const kind = String(item.kind || "");
  if (!["prospect_seen", "draft_prepared", "duplicate_skipped", "qualification"].includes(kind)) return;
  const handle = normalizeHandle(item.handle);
  const source = item.source === "post_liker" ? "post_liker" : item.source === "new_follower" ? "new_follower" : "";
  if (!handle || !source) return;
  const dedup = String(item.dedup_key || source + ":" + handle);
  if (store.activity.some((row) => row.business_id === command.business_id && row.dedup_key === dedup)) {
    store.activity.push({
      id: nid(store),
      business_id: command.business_id,
      command_id: command.id,
      kind: "duplicate_skipped",
      handle,
      source,
      bio_facts: [],
      draft_text: "",
      dedup_key: "",
      test_only: command.test_only === true,
      created_at: now
    });
    return;
  }
  const prepared = facts(item);
  store.activity.push({
    id: nid(store),
    business_id: command.business_id,
    command_id: command.id,
    kind: item.prior_contact === true ? "duplicate_skipped" : kind,
    handle,
    source,
    bio_facts: prepared,
    draft_text: prepared.length ? String(item.draft_text || "").slice(0, 500) : "",
    dedup_key: dedup,
    test_only: command.test_only === true || item.test_only === true,
    created_at: now
  });
}

async function enqueue(store, spec) {
  const state = ensureState(store, spec.businessId);
  const profile = store.profiles.find((row) => row.business_id === spec.businessId && row.status !== "revoked") || null;
  const worker = profile ? store.workers.find((row) => row.id === profile.worker_id) : null;
  const gate = disposition(store, state, profile, worker, spec.operation);
  const expires = new Date(Date.parse(spec.now) + COMMAND_TTL_MS).toISOString();
  const command = {
    id: nid(store),
    business_id: spec.businessId,
    profile_id: profile ? profile.id : null,
    worker_id: profile ? profile.worker_id : null,
    proxy_id: profile ? profile.proxy_id : null,
    operation: spec.operation,
    workflow_version: spec.version,
    payload: spec.payload,
    payload_sha256: spec.payloadHash,
    idempotency_key: spec.idempotencyKey,
    status: gate.status,
    last_error: gate.reason,
    signature: null,
    expires_at: expires,
    attempt_count: 0,
    next_attempt_at: null,
    accepted_at: null,
    acknowledged_at: null,
    observed_at: null,
    lease_worker_id: null,
    lease_profile_id: null,
    test_only: Boolean(profile && profile.test_only) || Boolean(worker && worker.test_only),
    created_at: spec.now,
    updated_at: spec.now
  };
  if (gate.status === "queued") {
    const secret = store.secrets.find((row) => row.worker_id === worker.id && row.signing_key);
    command.signature = secret ? await hmacHex(secret.signing_key, commandCanonical(command, spec.payloadHash)) : null;
    if (!command.signature) {
      command.status = "needs_setup";
      command.last_error = "unsigned";
    }
  }
  for (const prior of store.commands) {
    if (prior.business_id === spec.businessId && prior.operation === spec.operation && prior.id !== command.id && OPEN_STATUSES.includes(prior.status)) {
      prior.status = "superseded";
      prior.updated_at = spec.now;
    }
  }
  store.commands.push(command);
  if (!command.test_only) {
    state.controller_status = command.status === "queued" ? "queued" : command.status;
    state.profile_id = command.profile_id;
    state.last_error = command.last_error || "";
    state.updated_at = spec.now;
  }
  store.activity.push(event(store, command, "command_queued"));
  return command;
}

function disposition(store, state, profile, worker, operation) {
  if (state.killed && operation !== "kill") return { status: "failed", reason: "killed" };
  if (!profile || !profile.worker_id || !profile.profile_key || !profile.process_slot) return { status: "needs_setup", reason: "needs_setup" };
  if (!profile.proxy_id) return { status: "needs_setup", reason: "needs_proxy" };
  if (!worker || worker.shell_control === true || worker.interaction !== "computer_use") return { status: "unsupported", reason: "unsupported" };
  if (worker.desktop_capability !== "reported" || worker.proxy_mode !== "process_binding") return { status: "unsupported", reason: "unsupported" };
  if (worker.status === "unsupported") return { status: "unsupported", reason: "unsupported" };
  if (worker.status === "offline" || worker.status === "unconfigured") return { status: "offline", reason: "offline" };
  const route = store.routes.find((row) => row.worker_id === worker.id);
  const secret = store.secrets.find((row) => row.worker_id === worker.id && row.signing_key);
  if (!route || route.enabled !== true || !secret || !CHANNEL_URL.test(String(route.channel_url || ""))) {
    return { status: "needs_setup", reason: "needs_setup" };
  }
  return { status: "queued", reason: "" };
}

function locate(store, input) {
  const next = clone(store);
  const command = next.commands.find((row) => row.id === (input && input.commandId));
  if (!command) return { ok: false, reason: "forbidden", store };
  const profile = next.profiles.find((row) => row.id === (input && input.profileId));
  const principal = input && input.principal;
  if (!principal || !profile) return audit(next, command, "misrouted");
  if (principal.kind === "machine") return audit(next, command, "misrouted");
  if (principal.kind !== "worker" || principal.worker_id !== profile.worker_id) return audit(next, command, "misrouted");
  if (profile.business_id !== command.business_id) return audit(next, command, "wrong_account");
  if (principal.business_id && principal.business_id !== command.business_id) return audit(next, command, "wrong_account");
  if (command.profile_id !== profile.id || command.worker_id !== profile.worker_id) return audit(next, command, "misrouted");
  if (!command.proxy_id || command.proxy_id !== profile.proxy_id) return audit(next, command, "misrouted");
  return { ok: true, store: next, command, profile };
}

function audit(store, command, reason) {
  if (command) store.activity.push(event(store, command, "misrouted"));
  return { ok: false, reason, store, command, changed: true };
}

function expire(store, command, now) {
  if (command.status !== "observed") {
    command.status = "expired";
    command.updated_at = now;
    touchState(store, command, "expired");
    store.activity.push(event(store, command, "command_expired"));
  }
  return { ok: false, reason: "expired", store, command };
}

function touchState(store, command, status) {
  if (command.test_only) return;
  const state = ensureState(store, command.business_id);
  state.controller_status = status;
  state.updated_at = command.updated_at;
}

function ensureState(store, businessId) {
  let state = store.states.find((row) => row.business_id === businessId);
  if (!state) {
    state = {
      business_id: businessId,
      paused: true,
      killed: false,
      desired_version: null,
      observed_version: null,
      controller_status: "needs_setup",
      profile_id: null,
      last_error: "",
      control_generation: 0,
      updated_at: null
    };
    store.states.push(state);
  }
  return state;
}

function event(store, command, kind) {
  return {
    id: nid(store),
    business_id: command.business_id,
    command_id: command.id,
    kind,
    handle: "",
    source: "",
    bio_facts: [],
    draft_text: "",
    dedup_key: "",
    test_only: command.test_only === true,
    created_at: command.updated_at || command.created_at
  };
}

function facts(item) {
  const rows = Array.isArray(item && item.bio_facts) ? item.bio_facts : [];
  return rows.map((row) => String(row || "").trim()).filter((row) => row.length > 0 && row.length <= 280).slice(0, 8);
}

function normalizeHandle(value) {
  const handle = String(value || "").trim().replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(handle) ? handle : "";
}

function fail(reason, store, command) {
  return { ok: false, reason, store, command: command || null };
}

function nid(store) {
  const value = store.seq;
  store.seq += 1;
  return "cmd-" + value;
}

function at(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return date.toISOString();
}

function clone(store) {
  return structuredClone(store);
}

function hex(bytes) {
  return [...bytes].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function safeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
