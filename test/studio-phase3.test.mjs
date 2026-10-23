import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  QUESTIONS, officeError, delayError, webhookError, tagError, scopeError,
  conversationsPerDay, agentPerformance, tagConversion, funnel, followupRate,
  replyBuckets, heatmaps, originBreakdown, projectRevenue, checklist, nextStep,
  filterCommands, commandItems, proposalOf, snippet, originCsv
} from "../acquire/studio-ops-model.js";

test("settings are the eight questions", () => {
  assert.equal(QUESTIONS.length, 8);
  assert.match(QUESTIONS.map((item) => item.q).join(" "), /When does the AI answer/);
  assert.match(QUESTIONS.map((item) => item.q).join(" "), /Integrations/);
});

test("office hours and delay range", () => {
  assert.equal(officeError("always"), "");
  assert.match(officeError("nights"), /24 hours/);
  assert.equal(delayError(20, 90), "");
  assert.match(delayError(90, 20), /low end first/);
});

test("webhook, tag, and scope checks", () => {
  assert.equal(webhookError("https://example.com/hook", ["lead.created"]), "");
  assert.match(webhookError("http://example.com", ["lead.created"]), /https/);
  assert.equal(tagError({ name: "Hot", rule_kind: "ai", notify_email: "" }), "");
  assert.match(tagError({ name: "Hot", rule_kind: "ai", notify_email: "nope" }), /email/);
  assert.equal(scopeError(["conversations"]), "");
  assert.match(scopeError([]), /permission/);
});

test("stats count only the rows they are given", () => {
  const leads = [
    { assigned_agent: "Ada", crm_state: "paid", tags: ["hot"], sales_link_id: "l1" },
    { assigned_agent: "Ada", crm_state: "open", tags: ["hot"], sales_link_id: "l1" }
  ];
  assert.equal(agentPerformance(leads)[0].paid, 1);
  assert.equal(tagConversion(leads)[0].rate, 0.5);
  assert.equal(followupRate([{ followups: 1, stage: "reply" }, { followups: 1, stage: "target" }]), 0.5);
  assert.equal(followupRate([]), null);
  const funnelRows = funnel([{ source: "instagram", stage: "reply", peak_stage: "reply" }], "inbound");
  assert.equal(funnelRows.find((row) => row.stage === "reply").count, 1);
  const days = conversationsPerDay([{ at: "2026-10-22T10:00:00.000Z" }], 2, Date.parse("2026-10-22T12:00:00.000Z"));
  assert.equal(days.at(-1).count, 1);
});

test("reply buckets and heatmaps ignore missing pairs", () => {
  const buckets = replyBuckets([
    { conversation_id: "c", role: "user", created_at: "2026-10-22T10:00:00.000Z" },
    { conversation_id: "c", role: "assistant", created_at: "2026-10-22T10:02:00.000Z" }
  ]);
  assert.equal(buckets.pairs, 1);
  assert.equal(buckets.counts["1_to_5"], 1);
  const heat = heatmaps(["2026-10-22T15:00:00.000Z"]);
  assert.equal(heat.hour[15], 1);
});

test("origins, projection, and csv stay honest", () => {
  const rows = originBreakdown([
    { source_detail: "story reply", crm_state: "paid" },
    { source_detail: "hello there", first_message: "podcast" }
  ], [{ name: "Podcast", keyword: "podcast" }]);
  assert.equal(rows[0].origin, "story");
  assert.equal(rows.find((row) => row.origin === "Podcast").leads, 1);
  const money = projectRevenue(150000, 4);
  assert.equal(money.yearCents, 150000 * 4 * 12);
  assert.equal(money.shareCents, Math.round(money.yearCents * 0.1));
  assert.match(originCsv(rows), /Origin,Leads,Paid/);
});

test("checklist points at the first unfinished step", () => {
  const items = checklist({ settings: {}, brief: null, agentCards: [], offerLinks: [], valueAssets: [], voices: [], ig: null });
  assert.equal(nextStep(items).id, "brief");
  const done = checklist({
    settings: { office_mode: "always" },
    brief: { fields: { sell: "x" } },
    agentCards: [{}],
    offerLinks: [{}],
    valueAssets: [{}],
    voices: [],
    ig: { username: "roleflow", status: "connected" }
  });
  assert.equal(nextStep(done), null);
  const typedOnly = checklist({
    settings: { office_mode: "always" },
    brief: { fields: { sell: "x" } },
    agentCards: [{}],
    offerLinks: [{}],
    valueAssets: [{}],
    voices: [],
    ig: { username: "valueaddmarketing", status: "error" }
  });
  assert.equal(nextStep(typedOnly).id, "instagram");
});

test("command search and proposals", () => {
  const hits = filterCommands(commandItems(), "when does the ai");
  assert.equal(hits[0].tab, "configuration");
  assert.equal(proposalOf({ type: "lead", handle: "@Ada", crm_state: "Booked" }).handle, "ada");
  assert.equal(proposalOf({ type: "setting", patch: { office_mode: "nope" } }), null);
  assert.deepEqual(proposalOf({ type: "setting", patch: { keyword_only: true, password: "x" } }).patch, { keyword_only: true });
  assert.match(snippet("lead", "Paid", "https://example.com/hooks"), /YOUR_WORKSPACE_KEY/);
  assert.match(snippet("lead", "Paid", "https://example.com/hooks"), /Paid/);
});

test("phase 3 screens stay in the panel and off the live setter", () => {
  const ops = readFileSync(new URL("../acquire/studio-ops.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../acquire/app.js", import.meta.url), "utf8");
  const assistant = readFileSync(new URL("../acquire/assistant.js", import.meta.url), "utf8");
  assert.match(ops, /Explain with assistant/);
  assert.match(ops, /coming soon/);
  assert.match(ops, /Regenerate link/);
  assert.match(assistant, /Confirm/);
  assert.match(app, /acq_clone_business/);
  assert.doesNotMatch(ops, /enqueueEngine/);
  assert.doesNotMatch(ops + assistant, /tailortalk|zerochats/i);
});
