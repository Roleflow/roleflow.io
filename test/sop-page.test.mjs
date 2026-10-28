import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseBulkThreads } from "../acquire/winning-conversations.js";
import { mentionsPrice, playbookFromSources } from "../acquire/onboarding-build.js";
import { sopProgress } from "../acquire/sop-page.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
assert.equal(read("acquire/winning-conversations.js"), read("supabase/functions/_shared/winning-conversations.js"));
assert.equal(read("acquire/onboarding-build.js"), read("supabase/functions/_shared/onboarding-build.js"));

const bulk = parseBulkThreads([
  "---",
  "Label: March close",
  "Outcome: closed",
  "Note: they asked first",
  "Me: hey",
  "Them: let's book",
  "---",
  "Label: April",
  "Outcome: booked",
  "Me: hi",
  "Them: yes"
].join("\n"));
assert.equal(bulk.length, 2);
assert.equal(bulk[0].label, "March close");
assert.equal(bulk[0].outcome, "closed");
assert.equal(bulk[0].notes, "they asked first");
assert.equal(bulk[0].messages[0].side, "me");
assert.equal(bulk[1].outcome, "booked");

const empty = playbookFromSources({ form: {}, materials: "", conversations: "" }, {
  offer: "Invented $5000 program",
  icp: "Invented buyers"
});
assert.equal(empty.sections.offer, "");
assert.equal(empty.missing.includes("offer"), true);
assert.equal(empty.prompt.includes("$5000"), false);
assert.match(empty.prompt, /Do not mention price or commission/);

const priced = playbookFromSources({
  form: { offer: "Strategy session is $2000" },
  materials: "The price is $2000 after they ask.",
  conversations: "Lead: what is the price?\nSetter: it is $2000."
}, { offer: "Strategy session is $2000" });
assert.equal(priced.allowPrice, true);
assert.match(priced.sections.offer, /\$2000/);
assert.equal(mentionsPrice(priced.sections.offer), true);

const progress = sopProgress({
  onboardingMaterials: [{ name: "SOP workflow", kind: "text" }],
  winningConversations: [{ id: "1" }],
  onboarding: { status: "drafted" },
  setterTestedAt: "2026-10-28T00:00:00Z",
  agentSwitches: [{ agent_key: "setter", enabled: false }]
});
assert.equal(progress.hasSop, true);
assert.equal(progress.hasConversations, true);
assert.equal(progress.built, true);
assert.equal(progress.tested, true);
assert.equal(progress.live, false);

const page = read("acquire/sop-page.js");
assert.match(page, /Build my setter/);
assert.match(page, /Crear mi setter/);
assert.match(page, /Test in Simulator/);
assert.match(page, /Probar en el simulador/);
assert.match(page, /createOnboardingLink/);
assert.match(page, /Save as new version/);
assert.doesNotMatch(page, /zernio/i);
assert.match(read("acquire/studio.js"), /renderSopPage/);
assert.match(read("supabase/functions/client-dashboard/index.ts"), /playbookFromSources/);
assert.match(read("supabase/functions/client-dashboard/index.ts"), /Add an SOP or a conversation before building/);
assert.match(read("docs/client-dashboard.md"), /SOP page/);
assert.match(read("account/onboarding/app.js"), /onboarding-link/);

console.log("sop page tests passed");
