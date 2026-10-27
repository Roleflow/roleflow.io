import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { commentSlotGuide, commentSlotView, whenToSendFromRules } from "../acquire/comment-slot.js";
import { filterSimulations, lengthDelta } from "../acquire/sim-log.js";
import { briefDocument, parseBriefDocument } from "../acquire/studio-model.js";
import { NAV_GROUPS, canonicalTab } from "../acquire/client-nav.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const rules = [{ keywords: ["SYSTEM"], intent: "Someone asking for info", message: "Thanks" }];
assert.equal(whenToSendFromRules(rules), "Someone asking for info");
assert.equal(commentSlotView(null, rules).source, "rules");
assert.equal(commentSlotView({ when_to_send: "send it when someone comments", voice_note_id: "v1" }, rules).source, "saved");
assert.match(commentSlotGuide({ when: "on a comment", token: "{{voice:comment}}", title: "Comment" }), /Send it when: on a comment/);
assert.equal(commentSlotGuide({}), "");

const sims = [
  { title: "Offer", leadState: "qualifying", messages: [{ text: "coaches" }] },
  { title: "Quiet", leadState: "lost", messages: [{ text: "later" }] }
];
assert.equal(filterSimulations(sims, "coach", "all").length, 1);
assert.equal(filterSimulations(sims, "", "lost")[0].title, "Quiet");
assert.equal(lengthDelta("abcd", "ab"), 2);
assert.equal(lengthDelta("a", null), null);

const fields = parseBriefDocument(briefDocument({ sell: "A system", offer: "Calls" }, "es"));
assert.equal(fields.sell, "A system");
assert.equal(fields.offer, "Calls");
assert.match(briefDocument({ sell: "A system" }, "es"), /Qué vendes/);

const menu = read("account/acquisition/index.html");
assert.match(menu, /id="lang-es"/);
assert.match(menu, /id="lang-en"/);
assert.match(menu, /mailto:diego@roleflow.io/);
assert.match(menu, /id="profile-logout"/);
assert.match(menu, /aria-haspopup="menu"/);
assert.doesNotMatch(menu, /id="profile-language"/);
assert.doesNotMatch(menu, /Credits|Subscription|Affiliates|Feature request/i);

const app = read("acquire/app.js");
assert.match(app, /Coming soon\. This agent cannot be turned on/);
assert.doesNotMatch(app, /id="lang-cycle"|profile-language/);
assert.match(app, /comment_when: commentWhenForTrial\(\)/);
assert.match(read("supabase/functions/client-dashboard/index.ts"), /comment_when/);
assert.match(read("supabase/functions/client-dashboard/index.ts"), /Coming soon\. This agent cannot be turned on/);
assert.match(read("supabase/functions/roleflow-acquisition/index.ts"), /loadCommentGuide/);
assert.doesNotMatch(read("supabase/functions/zernio-webhook/index.ts"), /loadCommentGuide/);

const migration = read("supabase/migrations/20261027120000_comment_recording_slot.sql");
assert.match(migration, /NOT APPLIED/);
assert.match(migration, /acq_comment_slots/);
assert.match(migration, /'comment'/);
assert.doesNotMatch(migration, /drop table/i);

const warmer = NAV_GROUPS.find((group) => group.id === "workforce").items.find((item) => item.tab === "warmer");
const outreacher = NAV_GROUPS.find((group) => group.id === "workforce").items.find((item) => item.tab === "outreacher");
assert.equal(warmer.soon, true);
assert.equal(outreacher.soon, true);
assert.equal(canonicalTab("commentvoice"), "voice");
assert.match(read("acquire/client-pages.js"), /Coming soon/);
assert.match(read("acquire/setter-workspace.js"), /Not analyzed/);
assert.match(read("acquire/setter-workspace.js"), /Simulate follow-up/);
assert.match(read("businesses/app.js"), /class: "biz-board"/);
assert.match(read("businesses/app.js"), /No leads in the last 7 days/);
assert.match(read("auth/site.css"), /grid-template-columns:repeat\(3,285px\)/);
assert.doesNotMatch(read("acquire/setter-workspace.js") + read("acquire/comment-slot.js"), /zernio/i);
assert.doesNotMatch(read("acquire/client-pages.js"), /https?:\/\//);

console.log("panel workspace tests passed");
