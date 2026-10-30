import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FOLLOWUP_GATE_ORDER, contactLookup, followupGate, pickChannel } from "../supabase/functions/_shared/followup-channel.js";

const source = readFileSync(new URL("../supabase/functions/roleflow-acquisition/index.ts", import.meta.url), "utf8");

test("a follow-up can go out on the messaging account when there is no Meta token", () => {
  assert.equal(pickChannel({ metaToken: true, gatewayReady: true }), "meta");
  assert.equal(pickChannel({ metaToken: false, gatewayReady: true }), "gateway");
  assert.equal(pickChannel({ metaToken: false, gatewayReady: false }), null);
});

test("gates are checked in order: DM controls, follow-up switch, Instagram, 24-hour window", () => {
  assert.deepEqual(FOLLOWUP_GATE_ORDER, ["dm_controls", "followup_switch", "instagram_channel", "window_24h"]);
  const all = { dmOpen: false, dmReason: "dm_disabled", followupOn: false, channel: null, windowOpen: false };
  assert.equal(followupGate(all).gate, "dm_controls");
  assert.equal(followupGate({ ...all, dmOpen: true }).gate, "followup_switch");
  assert.equal(followupGate({ ...all, dmOpen: true, followupOn: true }).reason, "ig_not_connected");
  assert.equal(followupGate({ ...all, dmOpen: true, followupOn: true, channel: "gateway" }).gate, "window_24h");
  assert.equal(followupGate({ dmOpen: true, followupOn: true, channel: "gateway", windowOpen: true }).allow, true);
});

test("the outbox checks the gates in that order before the AI runs", () => {
  const body = source.slice(source.indexOf("async function runOutbox"), source.indexOf("async function loadFollowupStep"));
  const at = (needle) => {
    const index = body.indexOf(needle);
    assert.ok(index > 0, needle);
    return index;
  };
  assert.ok(at("readDmGate(db, businessId)") < at("agentEnabled(db, businessId, agentKey)"));
  assert.ok(at("agentEnabled(db, businessId, agentKey)") < at("sendChannel(db, businessId, thread)"));
  assert.ok(at("sendChannel(db, businessId, thread)") < at("windowCheck = messagingDecision"));
  assert.ok(at("windowCheck = messagingDecision") < at("planTurn("));
});

test("text without a Meta token goes through the messaging account, gated again per bubble", () => {
  assert.match(source, /if \(!token\) return deliverGateway\(db, businessId, thread, bubbles, kind\);/);
  const body = source.slice(source.indexOf("async function deliverGateway"), source.indexOf("async function postGraph"));
  assert.ok(body.indexOf("readDmGate") < body.indexOf("fetch("));
  assert.doesNotMatch(body, /HUMAN_AGENT|messageTag/);
});

test("step voice notes are deduped per chat even without a target", () => {
  const body = source.slice(source.indexOf("async function sendStepVoice"), source.indexOf("async function sendStepText"));
  assert.doesNotMatch(body, /!thread\.target_id\) return null/);
  assert.match(body, /acq_followup_sends/);
});

test("contacts are matched by Instagram id first, then handle", () => {
  assert.deepEqual(contactLookup({ igsid: " 123 ", username: "@ada" }), { externalId: "123", handle: "ada" });
});
