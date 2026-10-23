import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertReadOnly, dncHandles, sheetReadCall } from "../supabase/functions/roleflow-setter-sync/dnc.js";
import {
  ROLEFLOW_ONLY, ROUND_TRIP, executePlan, isPaid, logLine, newExternalIds, pullRows, pushPlan
} from "../supabase/functions/roleflow-setter-sync/plan.js";

const leadPayload = {
  data: {
    leads: [
      {
        id: "lead-1",
        lead_name: "Ada",
        lead_contact: "ada.coach",
        lead_status: "hot",
        last_message_time: "2026-10-22T10:00:00+00:00",
        chat_history: [
          { id: "m1", role: "user", text: "Hello" },
          { id: "m1", role: "user", text: "Hello again" }
        ]
      },
      { id: "lead-1", lead_name: "Ada duplicate", lead_status: "hot" }
    ]
  }
};

test("pull is idempotent on the external id and keeps chat history", () => {
  const rows = pullRows(leadPayload);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].external_id, "lead-1");
  assert.equal(rows[0].messages.length, 1);
  assert.deepEqual(newExternalIds(["lead-1"], rows), []);
  assert.deepEqual(newExternalIds([], rows), ["lead-1"]);
});

test("sync off sends nothing", () => {
  const plan = pushPlan({ settings: { studio_setter_sync: false }, leads: [{ external_id: "lead-1", crm_state: "paid", ig_handle: "ada.coach" }] });
  assert.equal(plan.enabled, false);
  assert.equal(plan.calls.length, 0);
  assert.ok(plan.roleflowOnly.includes("workflow"));
});

test("a paid lead is marked converted and nobody is messaged", async () => {
  const plan = pushPlan({
    settings: { studio_setter_sync: true },
    leads: [
      { external_id: "lead-1", crm_state: "paid", ig_handle: "ada.coach" },
      { external_id: "lead-2", crm_state: "open", ig_handle: "bee.coach" }
    ],
    deals: [{ id: "deal-1", amount_cents: 150000, currency: "USD", external_id: "lead-1" }]
  });
  assert.deepEqual(plan.calls.map((call) => call.op), ["mark_converted", "mark_order"]);
  assert.equal(plan.calls[0].body.contact_ids[0], "ada.coach");
  assert.equal(plan.calls[1].body.order_id, "deal-1");
  const seen = [];
  const results = await executePlan(plan, async (call) => {
    seen.push(call.op);
    assert.notEqual(call.op, "send_message");
    return { ok: true };
  });
  assert.deepEqual(seen, ["mark_converted", "mark_order"]);
  assert.equal(results.every((row) => row.ok), true);
  await assert.rejects(() => executePlan({ calls: [{ op: "send_message" }] }, async () => ({ ok: true })), /message/);
});

test("workflow deploy is draft then live only when that transport is allowed", () => {
  const off = pushPlan({ settings: { studio_setter_sync: true }, brief: { fields: { sell: "Coaching" } } });
  assert.equal(off.calls.some((call) => call.op === "deploy"), false);
  assert.ok(off.roleflowOnly.includes("workflow"));
  const on = pushPlan({ settings: { studio_setter_sync: true }, brief: { fields: { sell: "Coaching" } }, agentId: "agent-1" }, { allowWorkflow: true });
  assert.deepEqual(on.calls.map((call) => call.op), ["update_draft", "deploy"]);
  assert.equal(on.calls[0].body.draft.sections.sell, "Coaching");
});

test("logs do not keep a token", () => {
  const line = logLine({ direction: "push", action: "leads", result: "error", detail: "Agent supersecretokenvalue12345 failed" });
  assert.equal(line.detail.includes("supersecretokenvalue12345"), false);
  assert.equal(isPaid({ lead_status: "converted" }), true);
  assert.equal(isPaid({ crm_state: "open" }), false);
});

test("a sheet tool list becomes do-not-contact handles and the fetch does not write", () => {
  const call = assertReadOnly(sheetReadCall());
  assert.equal(call.method, "POST");
  assert.equal(call.body.mode, "read");
  assert.equal(call.body.tool_type, "sheet");
  assert.throws(() => assertReadOnly({ method: "POST", url: "https://api.tailortalk.ai/api/v1/update_sheet", body: { mode: "read" } }));
  const handles = dncHandles({
    tools: [
      { type: "sheet", name: "query_sheet", description: "exclusion list", rows: [["instagram"], ["@Ada.Coach"], ["not a handle"], ["bee.coach"]] },
      { type: "sheet", name: "inventory", rows: [["sku"], ["coach.extra"]] }
    ]
  });
  assert.deepEqual(handles, ["ada.coach", "bee.coach"]);
  const app = readFileSync(new URL("../acquire/app.js", import.meta.url), "utf8");
  assert.match(app, /\.eq\("conversation_id", conversationId\)/);
  assert.doesNotMatch(app, /acq_messages[\s\S]{0,180}\.limit\(400\)/);
  assert.match(app, /Load earlier|loadEarlier/);
  assert.match(readFileSync(new URL("../acquire/studio-flow.js", import.meta.url), "utf8"), /Load earlier/);
  assert.match(readFileSync(new URL("../supabase/migrations/20261023040000_vam_chats_dnc.sql", import.meta.url), "utf8"), /sender in \('ai', 'human', 'lead'\)/);
  assert.match(readFileSync(new URL("../supabase/migrations/20261023040000_vam_chats_dnc.sql", import.meta.url), "utf8"), /udnnperp/);
  assert.match(readFileSync(new URL("../supabase/migrations/20261023040000_vam_chats_dnc.sql", import.meta.url), "utf8"), /studio_setter_sync = false/);
});

test("the panel names round trip and Roleflow only, and the flag stays off", () => {
  const studio = readFileSync(new URL("../acquire/studio.js", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../supabase/migrations/20261022240000_studio_phase4.sql", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../supabase/functions/roleflow-setter-sync/index.ts", import.meta.url), "utf8");
  ROUND_TRIP.forEach((item) => assert.match(studio, new RegExp(item.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))));
  ROLEFLOW_ONLY.forEach((item) => assert.match(studio, new RegExp(item.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))));
  assert.match(studio, /Synced with setter/);
  assert.match(sql, /studio_setter_sync = false/);
  assert.match(worker, /studio_setter_sync/);
  assert.doesNotMatch(worker, /send_message/);
  assert.doesNotMatch(studio, /tailortalk/i);
});
