import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { diffLines, joinPromptInstructions } from "../supabase/functions/_shared/prompt-history.js";
import {
  classifyComment,
  commentVoicePlan,
  decideCommentVoice,
  PRIVATE_REPLY_MS
} from "../supabase/functions/_shared/comment-voice.js";
import {
  bookingLinkFor,
  localTrialText,
  resolveOutgoing,
  ROLEFLOW_BOOKING_LINK,
  voiceCatalog,
  voiceToken
} from "../supabase/functions/_shared/prompt-tokens.js";
import { sendRequest } from "../supabase/functions/_shared/ig-gateway.js";
import { NAV_GROUPS, canonicalTab } from "../acquire/client-nav.mjs";
import { sectionText } from "../acquire/section-copy.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

assert.equal(read("acquire/prompt-history.js"), read("supabase/functions/_shared/prompt-history.js"));
assert.equal(read("acquire/prompt-tokens.js"), read("supabase/functions/_shared/prompt-tokens.js"));
assert.equal(read("acquire/comment-voice.js"), read("supabase/functions/_shared/comment-voice.js"));
assert.equal(read("acquire/agent-control.js"), read("supabase/functions/_shared/agent-control.js"));

const instructions = [
  { node: "Highest Priority Rule", instruction: "Keep  this line." },
  { node: "Skip", instruction: null },
  { node: "The Role", instruction: "Second line stays." }
];
assert.equal(joinPromptInstructions(instructions), "Keep  this line.\n\nSecond line stays.");

const changed = diffLines("Ask one question.", "Ask one question.\nDo not promise a number.");
assert.equal(changed.some((row) => row.type === "add" && row.text === "Do not promise a number."), true);
assert.equal(changed.some((row) => row.type === "same"), true);

const sql = read("supabase/migrations/20261026160000_prompt_versions_and_comment_voice.sql");
assert.match(sql, /NOT APPLIED/);
assert.match(sql, /string_agg\(section\.el->>'instruction', E'\\n\\n' order by section\.ord\)/);
assert.match(sql, /length\(btrim\(public\.acq_agent_prompts\.body\)\) = 0/);
assert.match(sql, /comment_voice/);
assert.match(sql, /daily_cap integer not null default 30/);
assert.doesNotMatch(sql, /drop table/i);
assert.match(sql, /R4wpQ4b8F5J7xnD39/);

const dashboard = read("supabase/functions/client-dashboard/index.ts");
const save = dashboard.slice(dashboard.indexOf("async function savePrompt"), dashboard.indexOf("async function restorePrompt"));
const restore = dashboard.slice(dashboard.indexOf("async function restorePrompt"), dashboard.indexOf("async function writePrompt"));
assert.doesNotMatch(save, /acq_agent_switches/);
assert.doesNotMatch(restore, /acq_agent_switches/);
assert.match(save, /tested: false/);
const trial = dashboard.slice(dashboard.indexOf("async function previewSetter"), dashboard.indexOf("async function saveBookingLink"));
assert.match(trial, /sent: false/);
assert.doesNotMatch(trial, /acq_agent_switches/);
assert.doesNotMatch(trial, /slice\(-12\)/);
assert.doesNotMatch(trial, /one short/);
assert.doesNotMatch(trial, /maxTokens/);
assert.doesNotMatch(trial, /localTrialText/);
assert.match(trial, /key_source/);
assert.match(trial, /practiceError/);
const sendTrial = read("acquire/app.js").slice(read("acquire/app.js").indexOf("async function sendTrial"), read("acquire/app.js").indexOf("function previewPracticeReply"));
assert.match(sendTrial, /messages: history/);
assert.match(sendTrial, /safeTrialError/);
assert.match(read("acquire/client-pages.js"), /dm-model/);
assert.match(read("acquire/model-key.js"), /Gemini 3 Flash/);
assert.match(read("acquire/model-key.js"), /gemini-3-flash-preview/);
assert.match(read("acquire/studio-ops.js"), /Gemini 3 Flash/);
assert.match(read("acquire/studio-ops.js"), /gemini-3-flash-preview/);

const rules = [
  { id: "rule-system", keywords: ["SYSTEM", "SYSTEMS", "SISTEM"], intent: "Someone asking how the growth system works", message: "Thanks for the comment.", clip_id: "clip-1" },
  { id: "rule-price", keywords: [], intent: "Asking for the price of the program", message: "I can send the details.", clip_id: null }
];

assert.equal(classifyComment({ text: "I need a SYSTEM", rules }).ruleId, "rule-system");
assert.equal(classifyComment({ text: "your systems look good", rules }).via, "keyword");
assert.equal(classifyComment({ text: "quiero un sistema", rules }).via, "keyword");
assert.equal(classifyComment({ text: "do you have a systm", rules }).via, "keyword");
assert.equal(classifyComment({ text: "what is the price of the program", rules }).ruleId, "rule-price");
assert.equal(classifyComment({ text: "nice photo", rules }).matched, false);
assert.equal(classifyComment({
  text: "can you explain the offer",
  rules,
  model: { matched: true, ruleId: "rule-price", reason: "model:price" }
}).via, "model");

const now = Date.parse("2026-10-26T12:00:00Z");
const base = { enabled: true, text: "SYSTEM please", rules, commentId: "c1", commenterId: "person-1", commentAt: new Date(now).toISOString(), now, dailyCap: 30, history: [] };
assert.equal(decideCommentVoice({ ...base, enabled: false }).reason, "agent_off");
assert.equal(decideCommentVoice({ ...base, enabled: false }).queued, false);
assert.equal(decideCommentVoice(base).reason, "queued_text_only");
assert.equal(decideCommentVoice({ ...base, sentToday: 30 }).reason, "daily_cap");
assert.equal(decideCommentVoice({ ...base, seenCommenter: true }).reason, "deduped");
assert.equal(decideCommentVoice({ ...base, commentAt: new Date(now - PRIVATE_REPLY_MS - 1000).toISOString() }).reason, "private_reply_window");
assert.equal(decideCommentVoice({ ...base, text: "hello" }).reason, "no_match");

const queued = commentVoicePlan(base);
assert.equal(queued.send.kind, "comment_voice");
assert.equal(queued.send.attachmentUrl, "");
assert.equal(queued.send.text, "Thanks for the comment.");
assert.equal(queued.log.clip_id, "clip-1");
assert.match(queued.log.reason, /queued_text_only/);
assert.equal(queued.log.matched, true);
const off = commentVoicePlan({ ...base, enabled: false });
assert.equal(off.send, null);
assert.equal(off.log.queued, false);

const request = sendRequest({
  kind: "comment_voice",
  payload: { accountId: "acct", postId: "post", commentId: "c1", text: queued.send.text, attachmentUrl: "https://cdn.example/a.m4a", attachmentType: "audio" }
});
assert.deepEqual(request.body, { accountId: "acct", message: "Thanks for the comment." });

const notes = [{ id: "v1", title: "Opener — coaching", storage_path: "biz/opener.m4a", mime_type: "audio/mp4", active: true }];
assert.equal(voiceToken(notes[0].title), "{{voice:opener_coaching}}");
const catalog = voiceCatalog(notes);
const spoken = resolveOutgoing("Here is {{voice:opener_coaching}} and {{booking_link}}", { voices: catalog, bookingLink: "" });
assert.equal(spoken.voices[0].id, "v1");
assert.equal(spoken.text.includes("{{voice:"), false);
assert.match(spoken.text, new RegExp(ROLEFLOW_BOOKING_LINK.replace(/[.]/g, "\\.")));
assert.equal(bookingLinkFor("https://calendar.example/room"), "https://calendar.example/room");

const local = localTrialText({
  prompt: "Send {{voice:opener_coaching}} and {{booking_link}}",
  inbound: "SYSTEM",
  scenario: "comment",
  voices: catalog
});
const practiced = resolveOutgoing(local, { voices: catalog, bookingLink: ROLEFLOW_BOOKING_LINK });
assert.equal(practiced.voices.length, 1);
assert.equal(practiced.text.includes(ROLEFLOW_BOOKING_LINK), true);

const webhook = read("supabase/functions/zernio-webhook/index.ts");
assert.match(webhook, /planCommentVoice/);
assert.match(webhook, /resolveOutgoing/);
assert.match(webhook, /privateReplyKind/);
assert.match(read("acquire/client-pages.js"), /setter-prompt/);
assert.match(read("acquire/client-pages.js"), /Practice thread/);
assert.match(read("acquire/client-pages.js"), /setter-split/);
assert.match(read("acquire/client-pages.js"), /tabs\.append\(editorTab, chatTab\)/);
assert.match(read("acquire/client-pages.js"), /id: "reply-delay-min"/);
assert.match(read("acquire/client-pages.js"), /id: "practice-delay"/);
assert.match(read("acquire/client-pages.js"), /"Reset"/);
assert.match(read("acquire/app.js"), /saveReplyDelay/);
assert.match(read("acquire/app.js"), /practiceDelaySeconds/);
assert.match(read("supabase/migrations/20261026190000_reply_delay_default.sql"), /set default 30/);
assert.match(read("supabase/functions/roleflow-acquisition/index.ts"), /reply_delay_max_seconds/);
assert.doesNotMatch(read("acquire/client-pages.js"), /https?:\/\//);
assert.doesNotMatch(read("acquire/client-pages.js"), /zernio/i);
assert.doesNotMatch(read("businesses/app.js"), /test chat/i);

const strategy = NAV_GROUPS.find((group) => group.id === "strategy");
const workforce = NAV_GROUPS.find((group) => group.id === "workforce");
assert.equal(strategy.items.some((item) => item.tab === "commentvoice"), true);
assert.equal(workforce.items.some((item) => item.tab === "commentvoice"), false);
assert.equal(canonicalTab("commentvoice"), "commentvoice");
assert.equal(sectionText("es", "sopsTitle"), "SOPs");
assert.match(sectionText("es", "loadError"), /No se pudo cargar/);
assert.match(read("acquire/home.js"), /strategyTabs/);
assert.match(read("acquire/acquire.css"), /max-width:420px/);

console.log("prompt and comment voice tests passed");
