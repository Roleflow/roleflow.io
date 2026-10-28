import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildInstruction, parseTranscript, stripPii, swapSides, transcriptsForModel } from "../acquire/winning-conversations.js";

const root = path.resolve(import.meta.dirname, "..");
assert.equal(
  fs.readFileSync(path.join(root, "acquire/winning-conversations.js"), "utf8"),
  fs.readFileSync(path.join(root, "supabase/functions/_shared/winning-conversations.js"), "utf8")
);

const labeled = parseTranscript("Me: hey\nThem: hey, what do you do?\nMe: we build systems");
assert.equal(labeled.labeled, true);
assert.equal(labeled.messages[0].side, "me");
assert.equal(labeled.messages[1].side, "them");
assert.equal(labeled.messages[2].text, "we build systems");

const names = parseTranscript("Ada North: can we book?\nDiego: yes, after you agree");
assert.equal(names.messages[0].side, "them");
assert.equal(names.messages[1].side, "me");
const flipped = swapSides(names.messages);
assert.equal(flipped[0].side, "me");
assert.equal(flipped[1].side, "them");

const plain = parseTranscript("hey there\nwhat do you sell?");
assert.equal(plain.labeled, false);
assert.equal(plain.messages[0].side, "them");
assert.equal(plain.messages[1].side, "me");

const dirty = "Email ada@example.com or call +1 415 555 2671. I am @adanorth.";
const clean = stripPii(dirty, ["Ada North"]);
assert.equal(clean.includes("ada@example.com"), false);
assert.equal(clean.includes("415"), false);
assert.equal(clean.includes("@adanorth"), false);
assert.equal(clean.includes("[email]"), true);
assert.equal(clean.includes("[phone]"), true);
assert.equal(clean.includes("[handle]"), true);

const packed = transcriptsForModel([{
  outcome: "booked",
  notes: "Ada North paid",
  messages: names.messages.map((row, index) => ({ ...row, text: index === 0 ? "email me ada@example.com" : row.text }))
}]);
assert.equal(JSON.stringify(packed).includes("ada@example.com"), false);
assert.equal(JSON.stringify(packed).includes("Ada North"), false);
const instruction = buildInstruction({
  brief: "Offer: strategy session",
  currentPrompt: "Ask one question.",
  conversations: [{ raw_text: "Me: hey\nThem: book me, ada@example.com", messages: [] }]
});
assert.equal(instruction.includes("ada@example.com"), false);
assert.match(instruction, /Do not guarantee income/);
assert.match(instruction, /booking link only after/);

const sql = fs.readFileSync(path.join(root, "supabase/migrations/20261028070000_winning_conversations.sql"), "utf8");
assert.match(sql, /NOT APPLIED/);
assert.match(sql, /acq_can_read\(business_id\)/);
assert.match(sql, /acq_can_edit\(business_id\)/);
assert.match(sql, /revoke all on public\.acq_winning_conversations from anon/);
assert.doesNotMatch(fs.readFileSync(path.join(root, "acquire/winning-panel.js"), "utf8"), /zernio/i);

console.log("winning conversation tests passed");
