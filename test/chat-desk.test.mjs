import assert from "node:assert/strict";
import fs from "node:fs";
import { aggregateFromLeads, bubbleKind, deskMatches, emptySummary, mergeSummary } from "../acquire/chat-summary.js";
import { filterLeads } from "../acquire/studio-model.js";
import { parseSummaryText, summaryRequest } from "../supabase/functions/_shared/chat-summary.js";

const leads = [
  { id: "1", name: "Ada", handle: "ada", state: "discovering", ai: true },
  { id: "2", name: "Sam", handle: "sam", state: "lost", ai: false },
  { id: "3", name: "Bea", handle: "bea", state: "booked", ai: true }
];
assert.equal(deskMatches(leads[0], "new"), true);
assert.equal(deskMatches(leads[2], "booked"), true);
assert.equal(deskMatches(leads[1], "manual"), true);
assert.deepEqual(filterLeads(leads, { desk: "lost" }).map((lead) => lead.handle), ["sam"]);
assert.deepEqual(filterLeads(leads, { desk: "ai" }).map((lead) => lead.handle), ["ada", "bea"]);
assert.equal(bubbleKind({ sender: "human", role: "assistant" }), "human");
assert.equal(bubbleKind({ sender: "ai", role: "assistant" }), "ai");
assert.equal(bubbleKind({ sender: "adanorth", role: "user" }), "lead");

const counts = aggregateFromLeads(leads);
assert.equal(counts.conversations, 3);
assert.equal(counts.booked, 1);
assert.equal(counts.needsHuman, 1);
assert.equal(emptySummary([]).empty, true);
assert.equal(emptySummary(leads).empty, false);
const merged = mergeSummary(emptySummary(leads), {
  empty: false,
  conversation: { situation: "Asked about the offer", goal: "", objections: [], offer: "", outcome: "", next: "Book a call" },
  aggregate: counts
});
assert.equal(merged.conversation.situation, "Asked about the offer");
assert.equal(merged.conversation.next, "Book a call");

const request = summaryRequest("Lead: How does it work?\nAI: A call.");
assert.equal(request.model, "claude-sonnet-5-5");
assert.equal(Object.hasOwn(request, "temperature"), false);
assert.equal(parseSummaryText("noise {\"situation\":\"Asked\",\"goal\":\"\",\"objections\":[\"price\"],\"offer\":\"\",\"outcome\":\"\",\"next\":\"call\",\"questions\":[\"How does it work?\"]}").objections[0], "price");
assert.equal(parseSummaryText("not json"), null);

const root = new URL("../", import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), "utf8");
const panel = read("acquire/studio-flow.js") + read("acquire/app.js") + read("acquire/chat-summary.js");
assert.match(panel, /Conversation summary/);
assert.match(panel, /functions\.invoke\("inbox-reply"/);
assert.match(panel, /functions\.invoke\("conversation-summary"/);
assert.match(panel, /delivery_status/);
assert.match(panel, /chat-ai-toggle/);
assert.doesNotMatch(panel, /zernio|tailortalk/i);
const sender = read("supabase/functions/inbox-reply/index.ts");
assert.match(sender, /sender: "human"/);
assert.match(sender, /delivery_status/);
assert.match(sender, /manualSendRequest/);
assert.doesNotMatch(sender, /zernio/i);
const summary = read("supabase/functions/conversation-summary/index.ts");
assert.match(summary, /acq_can_read/);
assert.match(summary, /acq_chat_summaries/);
assert.match(summary, /ANTHROPIC_API_KEY/);
assert.doesNotMatch(summary, /temperature|zernio/i);
const sql = read("supabase/migrations/20261029120000_chat_summary.sql");
assert.match(sql, /delivery_status in \('sending', 'sent', 'failed'\)/);
assert.match(sql, /acq_chat_summaries/);
assert.match(sql, /acq_can_read\(business_id\)/);
assert.doesNotMatch(sql, /drop table/i);

console.log("chat desk tests passed");
