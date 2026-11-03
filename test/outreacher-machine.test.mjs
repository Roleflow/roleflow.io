import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import { createMemory } from "./outreacher-memory.mjs";
import {
  QUALIFY_SYSTEM,
  authenticateMachine,
  draftUserMessage,
  handleMachineAction,
  objectKeys,
  presentConfig,
  pruneNames
} from "../supabase/functions/acquisition-bot/machine.js";
import { sha256Hex, signMachineToken, verifyJwt } from "../supabase/functions/acquisition-bot/jwt.js";

const MACHINE = "11111111-1111-4111-8111-111111111111";
const BUSINESS = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-03T18:00:00.000Z");
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
const publicPem = publicKey.export({ type: "spki", format: "pem" });
const env = { privateKey: privatePem, publicKey: publicPem };

function baseTables(extra) {
  return {
    client_machines: [{
      id: MACHINE,
      business_id: BUSINESS,
      status: "provisioning",
      provider_server_id: "srv-1",
      ipv4: "203.0.113.10",
      bootstrap_token_hash: extra.hash,
      bootstrap_expires_at: extra.expires || "2026-11-03T18:10:00.000Z",
      bootstrap_used_at: null,
      refresh_token_hash: null,
      refresh_prev_hash: null,
      refresh_family_id: null,
      revoked_at: null,
      session_state: null,
      last_error: null
    }],
    client_machine_events: [],
    hq_agents: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
    hq_tasks: [],
    acq_settings: [{
      agent_id: BUSINESS,
      niche: "Example niche",
      follower_min: 5000,
      follower_max: 50000,
      cta_keywords: "coach, mentor",
      icp_notes: "Notes stay per business",
      offer_summary: "A service sold on a call",
      daily_cap: 30,
      keyword_only: false,
      skip_followed: true,
      timezone: "Europe/Madrid",
      quiet_start: "22:00:00",
      quiet_end: "08:00:00",
      ig_paused: false,
      system_enabled: true
    }],
    acq_dm_controls: [{ business_id: BUSINESS, enabled: false, killed: false, paused_reason: "", daily_cap: 20, ig_handle: "own.handle" }],
    acq_agent_prompt_versions: [{ business_id: BUSINESS, version: 2, body: "PANEL PROMPT EXACT\n" }, { business_id: BUSINESS, version: 1, body: "old" }],
    business_workforce: [{ agent_id: BUSINESS, role: "personalised_outreach", status: "active", enabled: true, parameters: { min_score: 70 } }],
    acq_business_briefs: [{ business_id: BUSINESS, fields: { who: "coaches", sell: "help", offer: "the service", service: "delivery" } }],
    acq_dnc: [{ business_id: BUSINESS, handle: "skip.me" }],
    acq_tag_rules: [{ business_id: BUSINESS, name: "hot", rule_kind: "text", rule_text: "said budget" }],
    acq_offer_links: [{ business_id: BUSINESS, name: "Strategy session", url: "https://example.test/book", average_ticket_cents: 9900 }],
    acq_dm_sends: [{ business_id: BUSINESS, handle: "already.sent" }],
    acq_outreacher_config: [{ business_id: BUSINESS, paused: true, dry_run: true, exclude_keywords: "crypto", countries: ["ES"], languages: ["es"], delay_min_s: 300, delay_max_s: 1800, hourly_cap: 6 }],
    acq_activity: []
  };
}

async function serviceFor(overrides = {}) {
  const hash = overrides.hash || await sha256Hex("bootstrap-token");
  const tables = baseTables({ hash, expires: overrides.expires });
  if (overrides.patch) overrides.patch(tables);
  const calls = [];
  const memory = createMemory({
    tables,
    objects: overrides.objects || [],
    rpc: {
      outreacher_machine_secrets(args, store) {
        store.secretArgs = args;
        if (args.p_machine_id !== MACHINE) return { data: null, error: null };
        return { data: { proxy_url: "http://user:secret@203.0.113.8:8000", backup_key: "backup-key", volume_key: "volume-key" }, error: null };
      },
      outreacher_can_send(args) {
        calls.push(args);
        if (args.target === "refused") return { data: { ok: false, reason: "killed" }, error: null };
        return { data: { ok: true, claim_id: "claim-" + args.target }, error: null };
      },
      outreacher_claim_check(args) {
        return { data: { ok: args.claim_id !== "expired", reason: args.claim_id === "expired" ? "claim_expired" : "" }, error: null };
      },
      outreacher_report_send(args) {
        calls.push(args);
        return { data: { ok: true }, error: null };
      }
    }
  });
  memory.calls = calls;
  return memory;
}

async function act(service, body, extra = {}) {
  return handleMachineAction({
    service,
    body,
    businessId: extra.businessId || "",
    machineId: extra.machineId || "",
    ip: extra.ip == null ? "203.0.113.10" : extra.ip,
    now: extra.now || NOW,
    env,
    complete: extra.complete || (async () => { throw new Error("complete was not expected"); })
  });
}

const token = await sha256Hex("bootstrap-token");
assert.equal(token.length, 64);

{
  const verified = await verifyJwt(await signMachineToken({ privateKey: privatePem, businessId: BUSINESS, machineId: MACHINE, now: NOW }), publicPem, NOW);
  assert.equal(verified.ok, true);
  assert.equal(verified.claims.role, "outreacher");
  assert.equal(verified.claims.exp - verified.claims.iat, 3600);
  const later = await verifyJwt(await signMachineToken({ privateKey: privatePem, businessId: BUSINESS, machineId: MACHINE, now: NOW }), publicPem, new Date(NOW.getTime() + 3601 * 1000));
  assert.equal(later.ok, false);
  const otherKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "pem" });
  const forged = await verifyJwt(await signMachineToken({ privateKey: privatePem, businessId: BUSINESS, machineId: MACHINE, now: NOW }), otherKey, NOW);
  assert.equal(forged.ok, false);
}

{
  const memory = await serviceFor();
  const pending = await act(memory, { action: "bootstrap", machine_id: MACHINE, bootstrap_token: "bootstrap-token", server_id: "srv-1" }, { ip: "203.0.113.10" });
  assert.equal(pending.status, 200);
  assert.equal(pending.body.role, "outreacher");
  assert.equal(memory.db.tables.client_machines[0].bootstrap_used_at != null, true);
  const replay = await act(memory, { action: "bootstrap", machine_id: MACHINE, bootstrap_token: "bootstrap-token", server_id: "srv-1" });
  assert.equal(replay.status, 401);
  assert.equal(memory.db.tables.client_machines[0].status, "revoked");
  assert.equal(memory.db.tables.client_machine_events.filter((row) => row.kind === "bootstrap_replay").length, 1);
  assert.equal(memory.db.tables.hq_tasks.length, 1);
}

{
  const memory = await serviceFor({ patch: (tables) => { tables.client_machines[0].provider_server_id = null; } });
  const early = await act(memory, { action: "bootstrap", machine_id: MACHINE, bootstrap_token: "bootstrap-token", server_id: "srv-1" });
  assert.equal(early.status, 425);
  assert.equal(early.body.reason, "identity_pending");
  assert.equal(memory.db.tables.client_machines[0].bootstrap_used_at, null);
}

{
  const memory = await serviceFor();
  const wrongIp = await act(memory, { action: "bootstrap", machine_id: MACHINE, bootstrap_token: "bootstrap-token", server_id: "srv-1" }, { ip: "198.51.100.9" });
  assert.equal(wrongIp.status, 401);
  assert.equal(memory.db.tables.client_machines[0].bootstrap_used_at, null);
  const wrongServer = await act(memory, { action: "bootstrap", machine_id: MACHINE, bootstrap_token: "bootstrap-token", server_id: "other" });
  assert.equal(wrongServer.status, 401);
  const tooLong = await serviceFor({ expires: "2026-11-03T18:20:00.000Z" });
  assert.equal((await act(tooLong, { action: "bootstrap", machine_id: MACHINE, bootstrap_token: "bootstrap-token", server_id: "srv-1" })).status, 401);
  const password = await act(memory, { action: "bootstrap", machine_id: MACHINE, password: "nope" });
  assert.equal(password.status, 400);
  assert.equal(JSON.stringify(password.body).includes("nope"), false);
}

{
  const memory = await serviceFor();
  const first = await act(memory, { action: "bootstrap", machine_id: MACHINE, bootstrap_token: "bootstrap-token", server_id: "srv-1" });
  const rotated = await act(memory, { action: "refresh", refresh_token: first.body.refresh_token });
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.body.refresh_token, first.body.refresh_token);
  const replay = await act(memory, { action: "refresh", refresh_token: first.body.refresh_token });
  assert.equal(replay.status, 401);
  assert.equal(memory.db.tables.client_machines[0].status, "revoked");
  assert.equal(memory.db.tables.client_machine_events.filter((row) => row.kind === "refresh_reuse").length, 1);
  const session = await authenticateMachine(memory, rotated.body.access_token, env, NOW);
  assert.equal(session.ok, false);
}

{
  const memory = await serviceFor();
  const opened = await act(memory, { action: "bootstrap", machine_id: MACHINE, bootstrap_token: "bootstrap-token", server_id: "srv-1" });
  memory.db.tables.client_machines[0].status = "running";
  const ok = await authenticateMachine(memory, opened.body.access_token, env, NOW);
  assert.equal(ok.ok, true);
  memory.db.tables.client_machines[0].business_id = OTHER;
  const mismatch = await authenticateMachine(memory, opened.body.access_token, env, NOW);
  assert.equal(mismatch.status, 403);
  assert.match(mismatch.error, /different business/);
  memory.db.tables.client_machines[0].business_id = BUSINESS;
  memory.db.tables.client_machines[0].status = "revoked";
  memory.db.tables.client_machines[0].revoked_at = NOW.toISOString();
  const revoked = await authenticateMachine(memory, opened.body.access_token, env, NOW);
  assert.equal(revoked.status, 401);
}

{
  const memory = await serviceFor();
  memory.db.tables.client_machines[0].status = "running";
  const access = await signMachineToken({ privateKey: privatePem, businessId: BUSINESS, machineId: MACHINE, now: NOW });
  const config = await act(memory, { action: "config" }, { businessId: BUSINESS, machineId: MACHINE });
  assert.equal(config.body.prompt, "PANEL PROMPT EXACT\n");
  assert.equal(config.body.settings.follower_max, 50000);
  assert.equal(config.body.settings.follower_min, 5000);
  assert.equal(config.body.workforce.min_score, 70);
  assert.equal(config.body.offer_links[0].url, "https://example.test/book");
  assert.equal("average_ticket_cents" in config.body.offer_links[0], false);
  assert.deepEqual(config.body.dnc, ["skip.me"]);
  assert.deepEqual(config.body.sent_handles, ["already.sent"]);
  assert.equal(config.body.proxy_url.includes("secret"), true);
  assert.equal(config.body.outreacher.paused, true);
  assert.equal(config.body.controls.paused, true);
  assert.equal(memory.db.secretArgs.p_machine_id, MACHINE);
  const user = draftUserMessage({
    profile: { handle: "jane", bio: "coach", captions: ["scale"] },
    trigger: "new_follower",
    brief: config.body.brief,
    links: config.body.offer_links,
    tagRules: config.body.tag_rules,
    settings: config.body.settings
  });
  assert.equal(user.includes("Example niche"), true);
  assert.equal(user.includes("9900"), false);
  assert.equal(user.includes("https://example.test/book"), true);
  delete memory.db.tables.acq_outreacher_config;
  const missing = await act(memory, { action: "config" }, { businessId: BUSINESS, machineId: MACHINE });
  assert.equal(missing.body.outreacher.dry_run, true);
  assert.equal(missing.body.missing.includes("acq_outreacher_config"), true);
  const seen = [];
  const drafted = await act(memory, { action: "draft", profile: { handle: "jane", bio: "coach", captions: ["one"] }, trigger: "new_follower" }, {
    businessId: BUSINESS,
    machineId: MACHINE,
    complete: async (system, message) => {
      seen.push({ system, message });
      return "x".repeat(1500);
    }
  });
  assert.equal(seen[0].system, "PANEL PROMPT EXACT\n");
  assert.equal(drafted.body.text.length, 1500);
  const qualified = await act(memory, { action: "qualify", profile: { handle: "jane", bio: "coach" } }, {
    businessId: BUSINESS,
    machineId: MACHINE,
    complete: async (system) => {
      assert.equal(system, QUALIFY_SYSTEM);
      assert.notEqual(system, "PANEL PROMPT EXACT\n");
      return "{\"score\":82,\"summary\":\"fits\"}";
    }
  });
  assert.equal(qualified.body.score, 82);
  const cut = await act(memory, { action: "draft", profile: { handle: "jane" } }, {
    businessId: BUSINESS,
    machineId: MACHINE,
    complete: async () => { const error = new Error("cut"); error.code = "cut_off"; throw error; }
  });
  assert.equal(cut.body.reason, "truncated");
  const foreign = await act(memory, { action: "config", business_id: OTHER }, { businessId: BUSINESS, machineId: MACHINE });
  assert.equal(foreign.status, 403);
  const claim = await act(memory, { action: "claim", action_kind: "dm", target: "jane.coach", business_id: BUSINESS }, { businessId: BUSINESS, machineId: MACHINE });
  assert.equal(claim.body.claim_id, "claim-jane.coach");
  assert.equal(memory.calls.at(-1).business_id, BUSINESS);
  const refused = await act(memory, { action: "claim", action_kind: "like", target: "refused" }, { businessId: BUSINESS, machineId: MACHINE });
  assert.equal(refused.body.ok, false);
  delete memory.db.rpc.outreacher_can_send;
  const unavailable = await act(memory, { action: "claim", action_kind: "view", target: "jane" }, { businessId: BUSINESS, machineId: MACHINE });
  assert.equal(unavailable.body.reason, "claim_unavailable");
  memory.db.rpc.outreacher_can_send = memory.calls && (() => ({ data: { ok: true, claim_id: "c1" }, error: null }));
  const reported = await act(memory, { action: "report_send", claim_id: "c1", result: "dry_run", handle: "jane", body: "y".repeat(1500), kind: "dm" }, { businessId: BUSINESS, machineId: MACHINE });
  assert.equal(reported.body.ok, true);
  assert.equal(memory.db.tables.acq_activity.at(-1).payload.body.length, 1500);
  const tooLong = await act(memory, { action: "report_send", claim_id: "c1", result: "sent", handle: "jane", body: "y".repeat(1500) }, { businessId: BUSINESS, machineId: MACHINE });
  assert.equal(tooLong.body.reason, "will_not_truncate");
  assert.equal(memory.db.tables.acq_dm_sends.some((row) => String(row.body || "").length > 1000), false);
  const beat = await act(memory, {
    action: "heartbeat",
    session_state: "expired",
    sending_mode: "dry_run",
    sends_today: 1,
    sends_per_hour: 1,
    error_rate: 0.25,
    uptime_s: 12,
    image_version: "2026.11.03"
  }, { businessId: BUSINESS, machineId: MACHINE });
  assert.equal(beat.body.halt, true);
  assert.equal(memory.db.tables.client_machines[0].sends_per_hour, 1);
  assert.equal(memory.db.tables.client_machines[0].error_rate, 0.25);
  assert.equal(memory.db.tables.client_machine_events.some((row) => row.kind === "session_expired"), true);
  assert.equal(memory.db.tables.acq_settings[0].ig_paused, true);
  assert.equal(memory.db.tables.acq_settings[0].ig_pause_reason, "warning");
  const again = await act(memory, { action: "heartbeat", session_state: "expired", sending_mode: "off" }, { businessId: BUSINESS, machineId: MACHINE });
  assert.equal(memory.db.tables.client_machine_events.filter((row) => row.kind === "session_expired").length, 1);
  assert.equal(again.body.ok, true);
  const slot = await act(memory, { action: "backup_slot" }, { businessId: BUSINESS, machineId: MACHINE });
  assert.equal(slot.body.path.startsWith(BUSINESS + "/"), true);
  assert.equal(slot.body.upload_url.includes("/rest/v1"), false);
  memory.db.objects = Array.from({ length: 8 }, (_item, index) => ({ name: "b" + index, created_at: "2026-11-0" + (index + 1) }));
  const committed = await act(memory, { action: "backup_commit", path: slot.body.path }, { businessId: BUSINESS, machineId: MACHINE });
  assert.equal(committed.body.dropped, 1);
  assert.deepEqual(memory.db.removed, [BUSINESS + "/" + MACHINE + "/b0"]);
  assert.equal(memory.db.objects.length, 7);
  const otherPath = await act(memory, { action: "backup_commit", path: OTHER + "/nope" }, { businessId: BUSINESS, machineId: MACHINE });
  assert.equal(otherPath.status, 403);
  void access;
}

{
  const names = Array.from({ length: 8 }, (_item, index) => ({ name: "b" + index, created_at: String(index).padStart(2, "0") }));
  const pruned = pruneNames(names, 7);
  assert.equal(pruned.keep.length, 7);
  assert.equal(pruned.drop[0].name, "b0");
  assert.deepEqual(objectKeys(BUSINESS + "/" + MACHINE, [{ name: "b0" }, { name: BUSINESS + "/" + MACHINE + "/kept.bin" }]), [
    BUSINESS + "/" + MACHINE + "/b0",
    BUSINESS + "/" + MACHINE + "/kept.bin"
  ]);
  const shown = presentConfig({ settings: { follower_min: null, follower_max: null }, prompt: "  keep\n", controls: null, workforce: {}, offerLinks: [{ name: "A", url: "https://example.test", average_ticket_cents: 1 }] });
  assert.equal(shown.settings.follower_min, null);
  assert.equal(shown.prompt, "  keep\n");
  assert.equal(shown.controls.enabled, false);
  assert.equal("average_ticket_cents" in shown.offer_links[0], false);
}

const machineSource = fs.readFileSync(new URL("../supabase/functions/acquisition-bot/machine.js", import.meta.url), "utf8");
assert.match(machineSource, /outreacher_machine_secrets/);
assert.match(machineSource, /p_machine_id/);
assert.doesNotMatch(machineSource, /schema\("private"\)/);
assert.doesNotMatch(machineSource, /from\("outreach_machine_secrets"\)/);
assert.doesNotMatch(machineSource, /create table|insert into storage\.buckets/i);

const bot = fs.readFileSync(new URL("../supabase/functions/acquisition-bot/index.ts", import.meta.url), "utf8");
assert.match(bot, /different business/);
assert.match(bot, /That action is not available to this machine/);
assert.match(bot, /authenticateMachine/);
assert.doesNotMatch(bot, /instagram_password/i);

console.log("outreacher machine tests passed");
