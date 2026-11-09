import assert from "node:assert/strict";
import fs from "node:fs";
import { explicitAcquisition, postLoginDestination } from "../auth/landing.js";
import { promptFromSections } from "../acquire/setter-sections.js";

assert.equal(postLoginDestination("/account/"), "/businesses/");
assert.equal(postLoginDestination("/account"), "/businesses/");
assert.equal(postLoginDestination("/account/acquisition/"), "/businesses/");
assert.equal(postLoginDestination("/account/acquisition/#dashboard"), "/businesses/");
assert.equal(postLoginDestination(""), "/businesses/");

assert.equal(postLoginDestination("/account/acquisition/?business=biz#pipeline"), "");
assert.equal(explicitAcquisition("/account/acquisition/?business=biz#pipeline"), true);
assert.equal(postLoginDestination("/account/acquisition/?onboarding=1"), "");
assert.equal(postLoginDestination("/account/acquisition/?connect=1#settings"), "");
assert.equal(postLoginDestination("/account/acquisition/#setter"), "");
assert.equal(postLoginDestination("/account/acquisition/#outreacher"), "");
assert.equal(postLoginDestination("/admin/"), "");
assert.equal(postLoginDestination("/businesses/"), "");
assert.equal(postLoginDestination("/reset/"), "");

const drafted = promptFromSections({
  role: "You reply for this business.",
  workflow: "",
  objections: "Answer the price question in one line."
});
assert.match(drafted, /You reply for this business/);
assert.match(drafted, /Answer the price question/);
assert.doesNotMatch(drafted, /Workflow Logic/);
assert.equal(promptFromSections(null), "");
assert.equal(promptFromSections({ role: "Keep this.", extra: "Do not add this." }), "Keep this.");

const root = new URL("..", import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), "utf8");
const add = read("acquire/add-business.js");
assert.match(add, /roleflow-add-business/);
assert.match(add, /Create business/);
assert.doesNotMatch(add, /acq_create_onboarding_workspace/);
const businesses = read("businesses/app.js");
assert.match(businesses, /acq_workspaces/);
assert.match(businesses, /Connect Instagram/);
assert.match(businesses, /Train the setter/);
assert.match(businesses, /panel-add-business/);
const panel = read("acquire/app.js");
assert.match(panel, /explicitAcquisition/);
assert.match(panel, /location\.replace\("\/businesses\/"\)/);
assert.match(panel, /promptFromSections/);
assert.match(panel, /id: "setter-training"|id="setter-training"/);
assert.match(panel, /href: "#setter"/);
assert.doesNotMatch(read("auth/landing.js") + add + businesses + panel, /highlevel|gohighlevel/i);

console.log("panel home ok");
