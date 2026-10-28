import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { splitReply } from "../acquire/split-reply.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
assert.equal(read("acquire/split-reply.js"), read("supabase/functions/_shared/split-reply.js"));

assert.deepEqual(splitReply("One short line.", 15), ["One short line."]);
assert.deepEqual(splitReply("", 15), []);
assert.equal(splitReply("Keep this as one message even if it is long.", 0).length, 1);

const long = "Thanks for the note. I can walk through the first part with you. Then I can ask what you want to change.";
const parts = splitReply(long, 8);
assert.equal(parts.length >= 2, true);
assert.equal(parts.every((part) => part.split(/\s+/).length <= 12), true);
assert.equal(parts.join(" ").includes("Thanks"), true);

const clause = "I can help with the offer, the follow up, and the booking link once you say you want a call today";
const halved = splitReply(clause, 10);
assert.equal(halved.length >= 2, true);

const studio = read("supabase/functions/roleflow-studio/index.ts");
const edit = studio.slice(studio.indexOf("chain: setter.chain"), studio.indexOf("runtime,"));
assert.match(studio, /loadSetterReply/);
assert.match(edit, /chain: setter\.chain/);
assert.doesNotMatch(edit, /temperature/);
assert.match(read("acquire/setter-workspace.js"), /prompt-edit-status/);
assert.match(read("acquire/setter-workspace.js"), /Unsaved changes/);
assert.match(read("acquire/setter-workspace.js"), /Compare/);
assert.match(read("acquire/setter-workspace.js"), /Cambios sin guardar/);
assert.match(read("acquire/app.js"), /splitReply/);
assert.match(read("supabase/functions/zernio-webhook/index.ts"), /splitReply/);
assert.match(read("supabase/functions/roleflow-acquisition/index.ts"), /splitReply/);
assert.match(read("supabase/migrations/20261028110000_reply_split_words.sql"), /NOT APPLIED/);
assert.match(read("supabase/migrations/20261028110000_reply_split_words.sql"), /reply_split_words integer not null default 15/);
assert.doesNotMatch(read("acquire/setter-workspace.js"), /zernio/i);

console.log("prompt editor tests passed");
