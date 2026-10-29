import assert from "node:assert/strict";
import fs from "node:fs";
import { buttonError, cleanComment, keywordConflict, keywordHits, pickPublicReply, pickWinningCta, prepareCommentPlan, SHORT_KEYWORD_MAX } from "../acquire/comment-cta.js";
import { keyLinksBlock } from "../acquire/key-links.js";
import { holdComment } from "../workers/roleflow-dm/comment-cta.mjs";
import { canonicalTab, NAV_GROUPS } from "../acquire/client-nav.mjs";

assert.equal(cleanComment("INFO! 🔥 @roleflow"), "info");
assert.equal(cleanComment("ínfo"), "info");
assert.equal(keywordHits("LIST! 🙌", "list", "equals"), true);
assert.equal(keywordHits("List please", "list", "equals"), false);
assert.equal(keywordHits("what's the price?", "price", "contains"), true);
assert.equal(keywordHits("infp", "info", "contains"), false);
assert.equal(SHORT_KEYWORD_MAX, 4);
assert.equal(keywordHits("stratgy", "strategy", "contains"), true);

const specific = { id: "a", keyword: "INFO", match_mode: "equals", scope: "post", publication_ref: "reel-1" };
const general = { id: "b", keyword: "info", match_mode: "contains", scope: "any", publication_ref: "" };
assert.equal(pickWinningCta("info", [general, specific], "reel-1").id, "a");
assert.equal(pickWinningCta("info please", [general, specific], "reel-2").id, "b");
assert.equal(pickWinningCta("hello", [general], ""), null);

const ctas = [{ id: "1", keyword: "guide", match_mode: "contains", scope: "any", reply_kind: "text", dm_text: "Share the guide.", button_label: "", button_url: "" }];
const off = prepareCommentPlan({
  comment: "guide",
  ctas,
  settings: { auto_reply: true, public_replies: ["One", "Two"] },
  controls: { enabled: false },
  profile: { handle: "ada", name: "Ada", bio: "Coach" },
  now: new Date("2026-10-29T12:00:00Z"),
  random: () => 0
});
assert.equal(off.sent, false);
assert.equal(off.status, "held");
assert.equal(off.hold_reason, "dm_disabled");
assert.equal(off.public_reply, "One");
assert.equal(off.dm.verbatim, false);
assert.equal(off.dm.profile.handle, "ada");
assert.notEqual(off.dm.instruction, off.public_reply);
assert.equal(prepareCommentPlan({ comment: "nope", ctas, settings: {}, controls: { enabled: true } }).action, "ignore");

const voice = prepareCommentPlan({
  comment: "guide",
  ctas: [{ ...ctas[0], reply_kind: "voice", voice_path: "biz/cta-1.webm" }],
  settings: { auto_reply: false },
  controls: { enabled: true, killed: false },
  now: new Date("2026-10-29T12:00:00Z"),
  random: () => 0.5
});
assert.equal(voice.sent, false);
assert.equal(voice.hold_reason, "");
assert.equal(voice.dm.kind, "voice");
assert.equal(voice.dm.voice_path, "biz/cta-1.webm");
assert.ok(voice.send_after);

assert.equal(keywordConflict([{ id: "1", keyword: "info", scope: "any" }], { id: "2", keyword: "INFO", scope: "any" }).length > 0, true);
assert.equal(keywordConflict([{ id: "1", keyword: "info", scope: "post", publication_ref: "a" }], { id: "2", keyword: "info", scope: "post", publication_ref: "b" }), "");
assert.match(buttonError("Open", ""), /both/i);
assert.equal(buttonError("Open the guide", "https://roleflow.io"), "");
assert.equal(pickPublicReply(["A", "B"], () => 0.9), "B");

assert.match(keyLinksBlock([{ kind: "link", title: "Booking", url: "https://roleflow.io/book" }], [{ name: "Offer", url: "https://roleflow.io/offer" }]), /Booking: https:\/\/roleflow.io\/book/);
assert.equal(keyLinksBlock([{ kind: "image", title: "Photo", url: "https://roleflow.io/p" }], []), "");

const held = await holdComment(null, {
  comment: "guide",
  ctas,
  settings: { auto_reply: false },
  controls: { enabled: false },
  now: new Date("2026-10-29T12:00:00Z"),
  random: () => 0
});
assert.equal(held.sent, false);
assert.equal(held.stored, false);

const root = new URL("../", import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), "utf8");
assert.equal(read("acquire/key-links.js"), read("supabase/functions/_shared/key-links.js"));
const strategy = NAV_GROUPS.find((group) => group.id === "strategy");
assert.equal(strategy.items.some((item) => item.tab === "content"), false);
assert.equal(strategy.items.some((item) => item.tab === "ctas"), true);
assert.equal(canonicalTab("content"), "ctas");
assert.equal(canonicalTab("ctas"), "ctas");
const page = read("acquire/cta-page.js") + read("acquire/app.js");
assert.match(page, /Posts and Reels/);
assert.match(page, /Voice note/);
assert.match(page, /renderCtaPage/);
assert.doesNotMatch(page, /zernio/i);
assert.match(read("supabase/functions/roleflow-acquisition/index.ts"), /loadKeyLinks/);
assert.match(read("supabase/functions/roleflow-acquisition/index.ts"), /acq_value_assets/);
assert.doesNotMatch(read("workers/roleflow-dm/comment-cta.mjs"), /send\.mjs|postGraph/);
const sql = read("supabase/migrations/20261029180000_comment_cta_desk.sql");
assert.match(sql, /acq_comment_settings/);
assert.match(sql, /acq_comment_prepares/);
assert.match(sql, /reply_kind in \('text', 'voice'\)/);
assert.doesNotMatch(sql, /drop table/i);
assert.match(read("docs/comment-ctas.md"), /Do not register/);

console.log("comment cta tests passed");
