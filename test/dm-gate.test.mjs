import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dmGateCopy, dmGateDecision, readDmGate } from "../supabase/functions/_shared/dm-gate.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

assert.deepEqual(dmGateDecision({ enabled: true, killed: false }), { open: true, reason: "open" });
assert.deepEqual(dmGateDecision({ enabled: true, killed: null }), { open: true, reason: "open" });
assert.equal(dmGateDecision({ enabled: false, killed: false }).reason, "dm_disabled");
assert.equal(dmGateDecision({ enabled: true, killed: true }).reason, "dm_killed");
assert.equal(dmGateDecision({ enabled: "true", killed: false }).open, false);
assert.equal(dmGateCopy("dm_killed"), "Sending is stopped. Nothing was sent.");
assert.equal(dmGateCopy("other"), "Sending is off. Nothing was sent.");
assert.equal(dmGateDecision(null).reason, "dm_controls_missing");
assert.equal(dmGateDecision({ enabled: true }, new Error("boom")).reason, "dm_controls_unreadable");

function fakeDb(result, calls) {
  return {
    from(table) {
      calls.push(table);
      const chain = {
        select() { return chain; },
        eq(column, value) { calls.push(column + "=" + value); return chain; },
        maybeSingle: async () => {
          if (result instanceof Error) throw result;
          return result;
        }
      };
      return chain;
    }
  };
}

const calls = [];
assert.equal((await readDmGate(fakeDb({ data: { enabled: true, killed: false }, error: null }, calls), "b1")).open, true);
assert.deepEqual(calls, ["acq_dm_controls", "business_id=b1"]);
assert.equal((await readDmGate(fakeDb({ data: { enabled: false, killed: false }, error: null }, []), "b1")).open, false);
assert.equal((await readDmGate(fakeDb({ data: null, error: null }, []), "b1")).reason, "dm_controls_missing");
assert.equal((await readDmGate(fakeDb({ data: null, error: { message: "denied" } }, []), "b1")).reason, "dm_controls_unreadable");
assert.equal((await readDmGate(fakeDb(new Error("network"), []), "b1")).reason, "dm_controls_unreadable");
assert.equal((await readDmGate(null, "b1")).open, false);
assert.equal((await readDmGate(fakeDb({ data: { enabled: true }, error: null }, []), "")).open, false);

// Every function that posts a DM, a private reply or a voice note reads the
// gate inside that function before its first network send.
function body(source, name) {
  const start = source.indexOf("async function " + name + "(");
  assert.notEqual(start, -1, name);
  const next = source.indexOf("\nasync function ", start + 10);
  const nextFn = source.indexOf("\nfunction ", start + 10);
  const ends = [next, nextFn].filter((index) => index > start);
  return source.slice(start, ends.length ? Math.min(...ends) : undefined);
}
function gateFirst(text, label) {
  const gate = text.indexOf("readDmGate(");
  assert.notEqual(gate, -1, label + " reads the gate");
  for (const marker of ["fetch(", "postGraph(", "postOfficial(", "sendLibraryAudio(", "deliver(", "withAttachment(", "loadGatewayConfig(", "readIgToken(", "stampAgentEnabled("]) {
    const at = text.indexOf(marker, text.indexOf("{") + 1);
    if (at !== -1) assert.ok(gate < at, label + ": gate before " + marker);
  }
}

const acquisition = read("supabase/functions/roleflow-acquisition/index.ts");
for (const name of ["runOutbox", "deliver", "sendLibraryAudio"]) gateFirst(body(acquisition, name), "roleflow-acquisition " + name);
assert.match(body(acquisition, "voiceSendingOn"), /readDmGate\(/);
assert.doesNotMatch(acquisition, /from\("acq_dm_controls"\)/);
gateFirst(body(read("supabase/functions/zernio-webhook/index.ts"), "sendOne"), "inbound sendOne");

const tick = read("supabase/functions/ig-outbox-tick/index.ts");
const loop = tick.slice(tick.indexOf("for (const row of rows)"));
gateFirst(loop, "ig-outbox-tick loop");

const reply = read("supabase/functions/inbox-reply/index.ts");
const handler = reply.slice(reply.indexOf("const admin = adminClient();"));
gateFirst(handler, "inbox-reply");

// No other function posts to Instagram directly.
const functionsDir = path.join(root, "supabase/functions");
const senders = fs.readdirSync(functionsDir)
  .filter((name) => fs.existsSync(path.join(functionsDir, name, "index.ts")))
  .filter((name) => /graph\.instagram\.com|API_BASE \+|postOfficial\(/.test(read("supabase/functions/" + name + "/index.ts")))
  .sort();
assert.deepEqual(senders, ["ig-outbox-tick", "inbox-reply", "roleflow-acquisition", "zernio-webhook"]);
for (const name of senders) assert.match(read("supabase/functions/" + name + "/index.ts"), /readDmGate\(/, name);

console.log("dm gate tests passed");
