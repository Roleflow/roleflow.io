import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { routeActions, routeDue, routeResult, routeRuns, routeTick } from "../api/workforce/handlers.mjs";
import {
  bearerMatches,
  crmWrite,
  deskStatus,
  isDue,
  parseModelActions,
  runnerMessages,
  scorePrompt
} from "../acquire/workforce-model.js";

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const ROUTINE = "22222222-2222-4222-8222-222222222222";
const ACTION = "33333333-3333-4333-8333-333333333333";
const CONTACT = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-10-23T13:05:00.000Z";

function response() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function request(method, body, query) {
  return { method, headers: { authorization: "Bearer test-secret" }, body: body || {}, query: query || {} };
}

test("a daily routine is due in its timezone and a second pass is not", () => {
  const routine = { enabled: true, cron: "0 9 * * *", timezone: "America/New_York", last_run_at: null };
  assert.equal(isDue(routine, new Date(NOW)), true);
  assert.equal(isDue({ ...routine, last_run_at: "2026-10-23T13:01:00.000Z" }, new Date(NOW)), false);
  assert.equal(isDue({ ...routine, last_run_at: "2026-10-22T13:00:00.000Z" }, new Date(NOW)), true);
  assert.equal(isDue({ ...routine, enabled: false }, new Date(NOW)), false);
  assert.equal(isDue({ ...routine, cron: "0 18 * * *" }, new Date("2026-10-23T22:02:00.000Z")), true);
  assert.equal(isDue(routine, new Date("2026-10-23T12:50:00.000Z")), false);
});

test("prompt score, status, and model actions stay inside the panel", () => {
  assert.equal(scorePrompt("").score, 0);
  assert.equal(scorePrompt("Find 20 coaches every day. Do not message anyone until a person approves the list and the notes are long enough to explain the work.").score >= 7, true);
  assert.deepEqual(deskStatus([], [], "icp_acquisition"), { mode: "idle", status: "idle" });
  assert.equal(deskStatus([{ agent_role: "icp_acquisition", status: "running", started_at: NOW }], [], "icp_acquisition").status, "working");
  assert.equal(deskStatus([], [{ agent_role: "icp_acquisition", status: "proposed" }], "icp_acquisition").status, "waiting for approval");
  assert.equal(deskStatus([{ agent_role: "icp_acquisition", status: "error", started_at: NOW, ended_at: NOW }], [], "icp_acquisition").status, "error");
  const parsed = parseModelActions(JSON.stringify({
    summary: "Morning list",
    actions: [
      { type: "draft", target: "Ada", payload: { draft: "A note to review." } },
      { type: "instagram_dm", target: "Ada", payload: { message: "Hello" } }
    ]
  }));
  assert.deepEqual(parsed.actions.map((row) => row.type), ["draft"]);
  assert.equal(parsed.skipped.includes("instagram_dm"), true);
  const write = crmWrite({ type: "crm_update", payload: { contact_id: CONTACT, crm_state: "discovering", note: "Fit looks likely." } });
  assert.equal(write.table, "acq_contacts");
  assert.equal(crmWrite({ type: "instagram_dm", payload: { draft: "no" } }).error, "This action is for the browser worker.");
  assert.match(runnerMessages({ agent_role: "icp_acquisition", name: "Morning", instructions: "Find 20", prompt: "Be careful", brief: { sell: "Coaching" }, sales_links: [], crm: [] })[0].content, /Do not send a message/);
  assert.equal(bearerMatches("Bearer test-secret", ["test-secret"]), true);
  assert.equal(bearerMatches("Bearer other-secret", ["test-secret"]), false);
});

test("the runner reads due context and records proposals", async () => {
  const db = memory({
    library: {
      routines: [{ id: ROUTINE, business_id: BUSINESS, agent_role: "icp_acquisition", name: "Morning prospects", cron: "0 9 * * *", timezone: "America/New_York", enabled: true, instructions: "Find 20 new prospects", last_run_at: null }],
      prompts: [
        { id: "other", business_id: "00000000-0000-4000-8000-000000000099", agent_role: "icp_acquisition", body: "Wrong business", created_at: "2099-01-01T00:00:00.000Z" },
        { id: "p1", business_id: BUSINESS, agent_role: "icp_acquisition", body: "Find coaches. Do not message them.", created_at: NOW }
      ],
      briefs: [{ business_id: BUSINESS, fields: { sell: "Coaching" } }],
      links: [{ id: "l1", business_id: BUSINESS, name: "Apply", url: "https://roleflow.io/apply", body: "Use this link" }],
      crm: [{ id: CONTACT, business_id: BUSINESS, kind: "contact", name: "Ada", handle: "ada", crm_state: "open", tags: ["new"] }]
    }
  });
  const denied = response();
  await routeDue({ method: "GET", headers: {}, query: {} }, denied, { db, now: NOW, res: denied });
  assert.equal(denied.statusCode, 401);

  const due = response();
  await routeDue(request("GET"), due, { db, now: NOW, res: due });
  assert.equal(due.body.routines.length, 1);
  assert.equal(due.body.routines[0].prompt, "Find coaches. Do not message them.");
  assert.equal(due.body.routines[0].brief.sell, "Coaching");
  assert.equal(due.body.routines[0].sales_links[0].name, "Apply");
  assert.equal(due.body.routines[0].crm[0].handle, "ada");

  const posted = response();
  await routeRuns(request("POST", {
    business_id: BUSINESS,
    agent_role: "icp_acquisition",
    routine_id: ROUTINE,
    summary: "Morning list",
    actions: [
      { type: "follow", target: "ada", payload: {} },
      { type: "instagram_dm", target: "ada", payload: { message: "Hello" } }
    ]
  }), posted, { db, res: posted });
  assert.equal(posted.statusCode, 200);
  assert.deepEqual(posted.body.actions.map((row) => row.type), ["follow"]);
  assert.equal(posted.body.actions[0].status, "proposed");
  assert.equal(posted.body.actions[0].executor, "browser");
});

test("approved browser actions are listed and a result does not send anything", async () => {
  const db = memory({});
  db.actions.push({ id: ACTION, business_id: BUSINESS, agent_role: "personalised_outreach", run_id: null, type: "follow", target: "ada", payload: {}, status: "approved", approved_by: null, error: "" });
  db.actions.push({ id: "55555555-5555-4555-8555-555555555555", business_id: BUSINESS, agent_role: "icp_acquisition", type: "research", target: "coaches", payload: { note: "Notes" }, status: "approved", claimed_at: null, error: "" });
  const listed = response();
  await routeActions(request("GET", {}, { status: "approved" }), listed, { db, res: listed });
  assert.deepEqual(listed.body.actions.map((row) => row.type), ["follow"]);

  const blocked = response();
  db.actions[0].status = "proposed";
  await routeResult(request("POST", { status: "done", result: {} }, { id: ACTION }), blocked, { db, res: blocked });
  assert.equal(blocked.statusCode, 409);

  db.actions[0].status = "approved";
  const refused = response();
  await routeResult(request("POST", { status: "done", result: { message: "Hello" } }, { id: ACTION }), refused, { db, res: refused });
  assert.equal(refused.statusCode, 400);

  const done = response();
  await routeResult(request("POST", { status: "done", summary: "Followed from the browser worker." }, { id: ACTION }), done, { db, res: done });
  assert.equal(done.body.action.status, "done");
  assert.equal(db.crm.length, 0);
});

test("the cron executes reasoning and leaves browser work approved", async () => {
  const db = memory({
    auto: true,
    library: {
      routines: [{ id: ROUTINE, business_id: BUSINESS, agent_role: "icp_acquisition", name: "Morning prospects", cron: "0 9 * * *", timezone: "America/New_York", enabled: true, instructions: "Find 20 new prospects", last_run_at: null }],
      prompts: [{ business_id: BUSINESS, agent_role: "icp_acquisition", body: "Find coaches. Do not message them.", created_at: NOW }],
      briefs: [{ business_id: BUSINESS, fields: { sell: "Coaching" } }],
      links: [],
      crm: []
    }
  });
  const calls = [];
  const res = response();
  await routeTick(request("GET"), res, {
    db,
    now: NOW,
    res,
    async complete(messages) {
      calls.push(messages[0].content);
      if (String(messages[0].content).includes("Do not send a message.") && String(messages[0].content).startsWith("Return JSON")) {
        return JSON.stringify({ note: "Reviewed the list." });
      }
      return JSON.stringify({
        summary: "Planned the morning.",
        actions: [
          { type: "crm_update", target: "Ada", payload: { contact_id: CONTACT, crm_state: "discovering", note: "Fit looks likely." } },
          { type: "instagram_dm", target: "Ada", payload: { message: "Hello" } },
          { type: "follow", target: "Ada", payload: {} }
        ]
      });
    }
  });
  assert.equal(res.body.ran, 1);
  assert.equal(db.actions.some((row) => row.type === "instagram_dm"), false);
  const follow = db.actions.find((row) => row.type === "follow");
  const crm = db.actions.find((row) => row.type === "crm_update");
  assert.equal(follow.status, "approved");
  assert.equal(crm.status, "done");
  assert.equal(db.crm[0].table, "acq_contacts");
  assert.equal(db.crm[0].patch.crm_state, "discovering");
  assert.equal(JSON.stringify(db.crm).includes("acq_messages"), false);
  assert.equal(calls.some((line) => /Do not send a message/.test(line)), true);
});

test("the desk, cron, and secret stay empty of sample agents", () => {
  const read = (file) => fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const desk = read("acquire/workforce-desk.js");
  const office = read("acquire/office.js");
  const sql = read("supabase/migrations/20261023050000_studio_phase5.sql");
  const vercel = read("vercel.json");
  ["Write prompt", "Prompt", "Routines", "Activity", "Auto-approve actions", "Approve", "Reject", "Every day 09:00 find 20 new prospects", "Every day 18:00 follow up on unanswered DMs"].forEach((label) => {
    assert.match(desk, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
  assert.match(office, /deskStatus/);
  assert.match(read("api/workforce/tick.mjs"), /TICK_SCHEDULE = "\*\/5 \* \* \* \*"/);
  assert.doesNotMatch(vercel, /\*\/5 \* \* \* \*/);
  assert.match(sql, /workforce_runner_secret/);
  assert.match(sql, /acq_read_workforce_secret/);
  assert.match(sql, /auto_approve boolean not null default false/);
  assert.match(sql, /acq_can_read\(business_id\)/);
  assert.doesNotMatch(sql, /insert into public\.agent_prompts/i);
  assert.doesNotMatch(sql, /insert into public\.agent_routines/i);
  assert.doesNotMatch(desk + office + read("acquire/workforce-model.js") + read("api/workforce/handlers.mjs"), /tailortalk/i);
  assert.match(read("supabase/functions/roleflow-studio/index.ts"), /Score this agent prompt/);
});

function memory(seed) {
  const actions = [];
  const crm = [];
  return {
    actions,
    crm,
    async secrets() { return ["test-secret"]; },
    async library() { return seed.library || { routines: [], prompts: [], briefs: [], links: [], crm: [] }; },
    async autoApprove() { return seed.auto === true; },
    async claimRoutine() { return { id: ROUTINE }; },
    async insertRun(row) { return { ...row, id: "66666666-6666-4666-8666-666666666666" }; },
    async insertAction(row) {
      const saved = { ...row, id: ACTION, claimed_at: null, error: "" };
      actions.push(saved);
      return saved;
    },
    async touchRoutine() {},
    async listActions(status) { return actions.filter((row) => row.status === status); },
    async claimAction(id) {
      const row = actions.find((item) => item.id === id && item.status === "approved" && !item.claimed_at);
      if (!row) return null;
      row.claimed_at = NOW;
      return row;
    },
    async finishAction(id, patch) {
      const row = actions.find((item) => item.id === id);
      Object.assign(row, patch);
      return row;
    },
    async applyCrm(_business, write) { crm.push(write); },
    async getAction(id) { return actions.find((row) => row.id === id) || null; }
  };
}
