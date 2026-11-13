import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CURRENT_DESKTOP,
  bindProfile,
  controllerView,
  createStore,
  desktopSupported,
  pickup,
  acknowledge,
  recordResult,
  saveWorkflow,
  setControl,
  validateWorkflow,
  windowEnd
} from "../acquire/outreacher-workflow.js";
import { workflowFromFields, workflowStatusText, workflowWindowText } from "../acquire/outreacher-page.js";
import { deliverCommand, interpretTransport, planDelivery, readWorkerJwt, signWorkerJwt } from "../supabase/functions/_shared/outreacher-controller.js";
import { readMachineJwt, signMachineJwt } from "../supabase/functions/_shared/outreacher-token.js";

const NOW = new Date("2026-11-08T15:00:00.000Z");
const CHANNEL = "https://controller.example/v1/channels/outreacher/apply";
const FIXTURE_DESKTOP = {
  integration: "available",
  per_profile_proxy: true,
  proxies_provisioned: true,
  shell_browser_control: false,
  interaction: "computer_use",
  profile_created: true,
  profile_tested: true,
  managed_by_organization: false,
  test_only: true
};

const migration = fs.readFileSync(new URL("../supabase/migrations/20261108120000_outreacher_controller.sql", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../acquire/outreacher-page.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../acquire/app.js", import.meta.url), "utf8");
const edge = fs.readFileSync(new URL("../supabase/functions/outreach-controller/index.ts", import.meta.url), "utf8");
const transport = fs.readFileSync(new URL("../supabase/functions/_shared/outreacher-controller.js", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../acquire/outreacher-workflow.js", import.meta.url), "utf8");

function workflowDoc(patch) {
  return {
    timezone: "America/Asuncion",
    active_start: "07:00",
    active_hours: 16,
    poll_interval_min: 30,
    sources: ["new_follower", "post_liker"],
    daily_prospect_min: 20,
    daily_prospect_max: 100,
    draft_only: true,
    personalize: "bio_facts_only",
    templates: [{ id: "draft-1", text: "Hello from the bio." }],
    ...patch
  };
}

function fixtureStore() {
  const store = createStore();
  store.workers.push({
    id: "worker-1",
    capacity: 3,
    status: "ready",
    desktop_capability: "reported",
    proxy_mode: "process_binding",
    interaction: "computer_use",
    shell_control: false,
    test_only: true
  });
  store.workers.push({
    id: "worker-2",
    capacity: 2,
    status: "ready",
    desktop_capability: "reported",
    proxy_mode: "process_binding",
    interaction: "computer_use",
    shell_control: false,
    test_only: true
  });
  store.proxies.push({ id: "proxy-a" }, { id: "proxy-b" }, { id: "proxy-c" }, { id: "proxy-d" });
  store.routes.push({ worker_id: "worker-1", enabled: true, channel_url: CHANNEL });
  store.secrets.push({ worker_id: "worker-1", signing_key: "fixture-signing-key", alias_token: "fixture-alias-token" });
  return store;
}

async function bound(store, patch) {
  return bindProfile(store, {
    workerId: "worker-1",
    businessId: "business-a",
    profileKey: "slot-a",
    processSlot: 1,
    proxyId: "proxy-a",
    igUsername: "@valueaddmarketing",
    desktop: FIXTURE_DESKTOP,
    ...patch
  });
}

assert.equal(desktopSupported(CURRENT_DESKTOP), false);
assert.equal(CURRENT_DESKTOP.per_profile_proxy, false);
assert.equal(CURRENT_DESKTOP.proxy_settings, "os_level_only");
assert.equal(CURRENT_DESKTOP.profile_created, false);
assert.equal(CURRENT_DESKTOP.shell_browser_control, false);
assert.equal(CURRENT_DESKTOP.interaction, "computer_use");
assert.equal(desktopSupported(FIXTURE_DESKTOP), true);
assert.equal(windowEnd("07:00"), "23:00");
assert.equal(windowEnd("18:00"), "10:00");

const checked = validateWorkflow(workflowDoc());
assert.equal(checked.ok, true);
for (const [patch, reason] of [
  [{ draft_only: false }, "draft_only"],
  [{ personalize: "invented" }, "personalize"],
  [{ active_hours: 24 }, "active_hours"],
  [{ poll_interval_min: 5 }, "poll"],
  [{ active_start: "25:00" }, "active_start"],
  [{ timezone: "Not/A Zone" }, "timezone"],
  [{ sources: [] }, "sources"],
  [{ daily_prospect_min: 1, daily_prospect_max: 10 }, "daily"],
  [{ templates: [] }, "templates"],
  [{ password: "nope" }, "invalid"]
]) {
  assert.equal(validateWorkflow(workflowDoc(patch)).reason, reason, reason);
}
assert.equal(workflowFromFields({
  timezone: "America/Asuncion",
  activeStart: "07:00",
  newFollowers: true,
  postLikes: true,
  dailyMin: "20",
  dailyMax: "100",
  drafts: "Hello from the bio."
}).draft_only, true);
assert.match(workflowWindowText({ windowNote: "from {start} to {end} in {timezone}." }, "07:00", "America/Asuncion"), /23:00/);

const bare = await saveWorkflow(createStore(), { businessId: "business-a", document: workflowDoc(), now: NOW });
assert.equal(bare.ok, true);
assert.equal(bare.command.status, "needs_setup");
assert.equal(bare.command.observed_at, null);
assert.equal(bare.state.observed_version, null);
assert.equal(bare.state.desired_version, 1);
assert.equal(bare.state.paused, true);
const replay = await saveWorkflow(bare.store, { businessId: "business-a", document: workflowDoc(), now: NOW });
assert.equal(replay.duplicate, true);
assert.equal(replay.command.id, bare.command.id);
assert.equal(replay.command.status, "needs_setup");
assert.equal(replay.store.commands.length, 1);

const currentDesktop = bindProfile(fixtureStore(), {
  workerId: "worker-1",
  businessId: "business-a",
  profileKey: "slot-a",
  processSlot: 1,
  proxyId: "proxy-a",
  desktop: CURRENT_DESKTOP
});
assert.equal(currentDesktop.ok, false);
assert.equal(currentDesktop.reason, "unsupported");
assert.equal(currentDesktop.store.profiles.length, 0);

const sharedProxy = fixtureStore();
sharedProxy.workers[0].proxy_mode = "os_shared";
const osProxy = await bound(sharedProxy, {});
assert.equal(osProxy.ok, false);
assert.equal(osProxy.reason, "unsupported");
assert.equal(osProxy.store.profiles.length, 0);

const shellStore = fixtureStore();
shellStore.workers[0].shell_control = true;
assert.equal((await bound(shellStore, {})).reason, "shell_forbidden");
assert.equal((await bound(fixtureStore(), { proxyId: "" })).reason, "needs_proxy");
assert.equal((await bound(fixtureStore(), { profileKey: "" })).reason, "profile_required");

let store = fixtureStore();
store.machines.push({ id: "machine-a", business_id: "business-a", proxy_id: "proxy-z", status: "running" });
const kept = await bound(store, {});
assert.equal(kept.reason, "machine_exists");
assert.equal(kept.store.machines[0].status, "running");
assert.equal(kept.store.profiles.length, 0);

store = fixtureStore();
const first = await bound(store, {});
const second = await bound(first.store, { businessId: "business-b", profileKey: "slot-b", processSlot: 2, proxyId: "proxy-b", igUsername: "north.studio" });
const third = await bound(second.store, { businessId: "business-c", profileKey: "slot-c", processSlot: 3, proxyId: "proxy-c" });
const fourth = await bound(third.store, { businessId: "business-d", profileKey: "slot-d", processSlot: 1, proxyId: "proxy-d" });
assert.equal(first.ok && second.ok && third.ok, true);
assert.equal(fourth.reason, "capacity");
assert.equal(fourth.store.profiles.length, 3);
assert.equal((await bound(second.store, { businessId: "business-b", profileKey: "other", processSlot: 3, proxyId: "proxy-d" })).reason, "profile_exists");
assert.equal((await bound(second.store, { businessId: "business-c", profileKey: "slot-c", processSlot: 3, proxyId: "proxy-a" })).reason, "proxy_in_use");
assert.notEqual(second.store.profiles[0].profile_key, second.store.profiles[1].profile_key);
assert.notEqual(second.store.profiles[0].proxy_id, second.store.profiles[1].proxy_id);

const saved = await saveWorkflow(second.store, { businessId: "business-a", document: workflowDoc(), now: NOW });
assert.equal(saved.command.status, "queued");
assert.equal(saved.command.test_only, true);
assert.equal(saved.command.observed_at, null);
assert.equal(saved.state.observed_version, null);
assert.equal(saved.command.profile_id, first.profile.id);
assert.equal(saved.command.proxy_id, "proxy-a");

const otherProfile = saved.store.profiles.find((row) => row.business_id === "business-b");
const wrongAccount = await pickup(saved.store, {
  commandId: saved.command.id,
  profileId: otherProfile.id,
  principal: { kind: "worker", worker_id: "worker-1" },
  now: NOW
});
assert.equal(wrongAccount.reason, "wrong_account");
assert.equal(wrongAccount.command.status, "queued");
assert.equal(wrongAccount.store.activity.some((row) => row.kind === "misrouted"), true);

const otherWorker = await bound(saved.store, { workerId: "worker-2", businessId: "business-d", profileKey: "slot-d", processSlot: 1, proxyId: "proxy-d" });
const misWorker = await pickup(otherWorker.store, {
  commandId: saved.command.id,
  profileId: saved.command.profile_id,
  principal: { kind: "worker", worker_id: "worker-2" },
  now: NOW
});
assert.equal(misWorker.reason, "misrouted");
assert.equal(misWorker.command.status, "queued");

const machineTry = await pickup(saved.store, {
  commandId: saved.command.id,
  profileId: saved.command.profile_id,
  principal: { kind: "machine", machine_id: "machine-a", business_id: "business-a" },
  now: NOW
});
assert.equal(machineTry.reason, "misrouted");

const tampered = structuredClone(saved.store);
tampered.commands[0].proxy_id = "proxy-b";
const badProxy = await pickup(tampered, {
  commandId: saved.command.id,
  profileId: saved.command.profile_id,
  principal: { kind: "worker", worker_id: "worker-1" },
  now: NOW
});
assert.equal(badProxy.reason, "misrouted");
assert.notEqual(badProxy.command.status, "observed");

const resumed = await setControl(saved.store, { businessId: "business-a", action: "resume", now: NOW });
assert.equal(resumed.state.paused, false);
const leased = await pickup(resumed.store, {
  commandId: saved.command.id,
  profileId: saved.command.profile_id,
  principal: { kind: "worker", worker_id: "worker-1" },
  now: NOW
});
assert.equal(leased.ok, true);
assert.equal(leased.command.status, "queued");
assert.equal(leased.command.observed_at, null);
const acked = await acknowledge(leased.store, {
  commandId: saved.command.id,
  profileId: saved.command.profile_id,
  principal: { kind: "worker", worker_id: "worker-1" },
  now: NOW
});
assert.equal(acked.command.status, "acknowledged");
assert.equal(acked.command.observed_at, null);
const missingFacts = await recordResult(acked.store, {
  commandId: saved.command.id,
  profileId: saved.command.profile_id,
  principal: { kind: "worker", worker_id: "worker-1" },
  outcome: "observed",
  resultKey: "result-1",
  activity: [{ kind: "draft_prepared", handle: "ada.north", source: "new_follower", bio_facts: [], draft_text: "Hello" }],
  now: NOW
});
assert.equal(missingFacts.reason, "bio_facts_required");
assert.equal(missingFacts.store.commands[0].status, "acknowledged");
const sent = await recordResult(acked.store, {
  commandId: saved.command.id,
  profileId: saved.command.profile_id,
  principal: { kind: "worker", worker_id: "worker-1" },
  outcome: "sent",
  resultKey: "result-sent",
  now: NOW
});
assert.equal(sent.reason, "send_forbidden");
const observed = await recordResult(acked.store, {
  commandId: saved.command.id,
  profileId: saved.command.profile_id,
  principal: { kind: "worker", worker_id: "worker-1" },
  outcome: "observed",
  resultKey: "result-1",
  activity: [{
    kind: "draft_prepared",
    handle: "@Ada.North",
    source: "new_follower",
    bio_facts: ["Coach in Asuncion"],
    draft_text: "Saw the coaching line in the bio.",
    test_only: true
  }],
  now: NOW
});
assert.equal(observed.command.status, "observed");
assert.equal(observed.store.states.find((row) => row.business_id === "business-a").observed_version, null);
const again = await recordResult(observed.store, {
  commandId: saved.command.id,
  profileId: saved.command.profile_id,
  principal: { kind: "worker", worker_id: "worker-1" },
  outcome: "failed",
  resultKey: "result-1",
  now: NOW
});
assert.equal(again.duplicate, true);
assert.equal(again.outcome, "observed");
assert.equal(again.command.status, "observed");
const view = controllerView({
  desktop: CURRENT_DESKTOP,
  controller: observed.store.states.find((row) => row.business_id === "business-a"),
  profile: observed.store.profiles[0],
  command: observed.command,
  activity: observed.store.activity,
  includeFixtures: true
});
assert.equal(view.agreement, "unconfirmed");
assert.equal(view.observedVersion, null);
assert.equal(view.desktopAvailable, false);
assert.equal(view.delivery, "disabled");
assert.equal(view.connectEnabled, false);
assert.equal(view.fixture, true);
assert.equal(view.draftOnly, true);
assert.equal(workflowStatusText({ desiredLine: "Desired version {version}. Not confirmed on the browser.", confirmedLine: "confirmed", needsSetup: "Needs setup" }, view), "Desired version 1. Not confirmed on the browser.");
const hidden = controllerView({ controller: { desired_version: 1, observed_version: 1 }, command: observed.command, activity: observed.store.activity });
assert.equal(hidden.activity.some((row) => row.test_only), false);

const paused = await setControl(saved.store, { businessId: "business-a", action: "pause", now: NOW });
const pausedPickup = await pickup(paused.store, {
  commandId: saved.command.id,
  profileId: saved.command.profile_id,
  principal: { kind: "worker", worker_id: "worker-1" },
  now: NOW
});
assert.equal(pausedPickup.reason, "paused");
assert.notEqual(pausedPickup.command.status, "observed");
const killed = await setControl(saved.store, { businessId: "business-a", action: "kill", now: NOW });
assert.equal(killed.state.killed, true);
assert.equal(killed.state.paused, true);
assert.equal((await setControl(killed.store, { businessId: "business-a", action: "resume", now: NOW })).reason, "killed");
const killedSave = await saveWorkflow(killed.store, { businessId: "business-a", document: workflowDoc({ templates: [{ id: "draft-1", text: "A second draft." }] }), now: NOW });
assert.equal(killedSave.command.status, "failed");
assert.equal(killedSave.command.last_error, "killed");
assert.equal(killedSave.state.observed_version, null);

const staleStore = structuredClone(acked.store);
staleStore.commands[0].expires_at = "2026-11-08T14:00:00.000Z";
const stale = await acknowledge(staleStore, {
  commandId: saved.command.id,
  profileId: saved.command.profile_id,
  principal: { kind: "worker", worker_id: "worker-1" },
  now: NOW
});
assert.equal(stale.reason, "expired");
assert.equal(stale.command.status, "expired");

const offlineWorker = fixtureStore();
offlineWorker.routes[0].enabled = false;
const offlineBind = await bound(offlineWorker, {});
const offlineSave = await saveWorkflow(offlineBind.store, { businessId: "business-a", document: workflowDoc(), now: NOW });
assert.equal(offlineSave.command.status, "needs_setup");
assert.equal(offlineSave.command.observed_at, null);

const sample = {
  id: "c1",
  business_id: "business-a",
  profile_id: "profile-a",
  worker_id: "worker-1",
  proxy_id: "proxy-a",
  operation: "set_workflow",
  workflow_version: 1,
  payload: workflowDoc(),
  expires_at: "2026-11-08T16:00:00.000Z",
  signature: "abc",
  status: "queued",
  attempt_count: 0,
  test_only: false
};
const route = { enabled: true, channel_url: CHANNEL, desktop_capability: "reported", proxy_mode: "process_binding" };
let fetches = 0;
const blocked = await deliverCommand({
  command: sample,
  route,
  secretPresent: true,
  token: "fixture-alias-token",
  now: NOW,
  fetchImpl: () => { fetches += 1; return { status: 202 }; }
});
assert.equal(blocked.reason, "unsupported");
assert.equal(blocked.fetched, false);
assert.equal(fetches, 0);
assert.equal(planDelivery({ command: { ...sample, test_only: true }, route, secretPresent: true, desktopAvailable: true }).reason, "test_only");
const accepted = await deliverCommand({
  command: sample,
  route,
  secretPresent: true,
  desktopAvailable: true,
  token: "fixture-alias-token",
  now: NOW,
  fetchImpl: async (_url, init) => {
    fetches += 1;
    assert.equal(init.headers["X-Agent-Alias-Token"], "fixture-alias-token");
    assert.equal(JSON.parse(init.body).payload.draft_only, true);
    return { status: 202, applied: true };
  }
});
assert.equal(fetches, 1);
assert.equal(accepted.status, "accepted");
assert.equal(accepted.observed, false);
assert.equal(accepted.command.status, "accepted");
const retry = await deliverCommand({
  command: accepted.command,
  route,
  secretPresent: true,
  desktopAvailable: true,
  token: "fixture-alias-token",
  now: NOW,
  fetchImpl: () => { fetches += 1; return { status: 202 }; }
});
assert.equal(retry.reason, "already_accepted");
assert.equal(fetches, 1);
const unexpected = interpretTransport({ status: 200, applied: true });
assert.equal(unexpected.status, "failed");
assert.equal(unexpected.observed, false);
assert.equal(planDelivery({
  command: sample,
  route: { ...route, channel_url: "http://controller.example/v1/channels/outreacher/apply" },
  secretPresent: true,
  desktopAvailable: true,
  now: NOW
}).reason, "needs_setup");

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const privatePem = await pem("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", pair.privateKey));
const publicPem = await pem("PUBLIC KEY", await crypto.subtle.exportKey("spki", pair.publicKey));
const workerToken = await signWorkerJwt({ worker_id: "worker-1" }, privatePem, NOW.getTime());
const machineToken = await signMachineJwt({ machine_id: "machine-a", business_id: "business-a" }, privatePem, NOW.getTime());
assert.equal((await readWorkerJwt(workerToken.token, publicPem, NOW.getTime())).ok, true);
assert.equal((await readWorkerJwt(machineToken.token, publicPem, NOW.getTime())).ok, false);
assert.equal((await readMachineJwt(workerToken.token, publicPem, NOW.getTime())).ok, false);
assert.equal((await readMachineJwt(machineToken.token, publicPem, NOW.getTime())).claims.business_id, "business-a");
assert.equal(workerToken.claims.business_id, undefined);

assert.doesNotMatch(workflow + transport + edge, /acq_dm_controls|ROLEFLOW_DM_LIVE/);
assert.doesNotMatch(migration, /acq_dm_controls|ROLEFLOW_DM_LIVE|drop index if exists client_machines_one_live|applied/);
assert.match(migration, /client_machines_one_live|status <> 'deleted'/);
assert.match(migration, /capacity in \(2, 3\)/);
assert.match(migration, /shell_control = false/);
assert.match(migration, /interaction = 'computer_use'/);
assert.match(migration, /wrong_account/);
assert.match(migration, /misrouted/);
assert.match(migration, /needs_setup/);
assert.match(migration, /unsupported/);
assert.match(migration, /machine_exists/);
assert.match(migration, /proxy_in_use/);
assert.match(migration, /send_forbidden/);
assert.match(migration, /bio_facts_required/);
assert.match(migration, /test_only = false/);
assert.match(migration, /grant execute on function public.outreacher_save_workflow\(uuid, jsonb\) to authenticated, service_role/);
assert.match(migration, /revoke all on function public.outreacher_pickup\(text, text, text\) from public, anon, authenticated/);
assert.match(migration, /private.outreacher_controller_secrets/);
assert.doesNotMatch(migration, /'applied'/);
assert.match(page, /connect\.id = "workflow-connect"/);
assert.match(page, /connect\.disabled = true/);
assert.match(page, /view\.agreement === "failed" && !view\.killed/);
assert.match(page, /id: "workflow-activity-empty"/);
assert.match(page, /No confirmed activity yet/);
assert.doesNotMatch(page, /Grok Bot|Zernio|Followers found|Messages sent/);
const controllerFns = app.slice(app.indexOf("async function saveControllerWorkflow"), app.indexOf("async function resumeInstagram"));
assert.doesNotMatch(controllerFns, /acq_dm_controls|ROLEFLOW_DM_LIVE|enabled:/);
assert.doesNotMatch(controllerFns, /clearKill|outreacher_clear_kill/);
assert.ok(edge.indexOf("OUTREACH_CONTROLLER_ENABLED") < edge.indexOf("createClient("));
assert.doesNotMatch(edge, /fetch\(|ROLEFLOW_DM_LIVE|deliverCommand/);
assert.match(edge, /p_worker: workerId/);
assert.doesNotMatch(edge, /p_worker: body/);
assert.match(transport, /X-Agent-Alias-Token/);
assert.match(transport, /observed: false/);

async function pem(kind, bytes) {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const lines = b64.match(/.{1,64}/g).join("\n");
  return "-----BEGIN " + kind + "-----\n" + lines + "\n-----END " + kind + "-----";
}

console.log("outreacher controller tests passed");
