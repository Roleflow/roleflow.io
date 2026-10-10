import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { sampleAnswers } from "./sample-answers.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = { console, URL };
vm.createContext(sandbox);
for (const file of ["onboarding/config.js", "onboarding/form-model.js", "onboarding/prompt.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox, { filename: file });
}

const config = sandbox.ROLEFLOW_ONBOARDING_CONFIG;
const Form = sandbox.RoleflowForm;
const Prompt = sandbox.RoleflowPrompt;
const NOW = new Date("2026-10-10T15:00:00.000Z");

function section(prompt, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = prompt.match(new RegExp("## \\d+\\. " + escaped + "\\n\\n([\\s\\S]*?)(?=\\n## \\d+\\. |$)"));
  assert.ok(match, "missing section " + title);
  return match[1];
}

const allowed = new Set(["meta", ...config.PROMPT_SECTIONS.map((item) => item.id)]);
const ids = [];
config.QUESTIONS.forEach((step) => {
  assert.ok(step.id && step.title && step.fields.length, "step is incomplete: " + step.id);
  step.fields.forEach((field) => {
    ids.push(field.id);
    assert.ok(allowed.has(field.section), field.id + " has unknown section " + field.section);
  });
});
assert.equal(new Set(ids).size, ids.length, "field ids must be unique");
assert.equal(new Set(config.QUESTIONS.map((step) => step.id)).size, config.QUESTIONS.length);

const titles = Array.from(config.PROMPT_SECTIONS, (item) => `${item.number}. ${item.title}`);
assert.deepEqual(titles, [
  "2. Identity and Mission",
  "3. Non-Negotiables",
  "4. Style, Formatting and Tone",
  "5. Context and Outreach",
  "6. Qualification Logic",
  "7. Link Assets",
  "8. Workflow Logic",
  "9. Objection Handling"
]);
assert.match(config.HIGH_PRIORITY_RULES, /PLACEHOLDER/);
assert.match(config.DIEGO_EMAIL, /@/);

const pairs = Prompt.linkPairs(config);
assert.deepEqual(Array.from(pairs, (pair) => pair.id), ["booking", "vsl", "caseStudies", "application", "leadMagnet"]);
pairs.forEach((pair) => {
  assert.ok(pair.urlField, pair.id + " needs a url field");
  assert.ok(pair.whenField, pair.id + " needs a when field");
  assert.ok(pair.emptyText, pair.id + " needs empty text");
});

assert.equal(Form.isVisible(Form.getField(config, "coldOpen"), { leadSources: ["inbound"] }), false);
assert.equal(Form.isRequired(Form.getField(config, "coldOpen"), { leadSources: ["inbound"] }), false);
assert.equal(Form.validateField(Form.getField(config, "coldOpen"), { leadSources: ["inbound"] }), "");
assert.equal(Form.isRequired(Form.getField(config, "coldOpen"), { leadSources: ["cold"] }), true);
assert.match(Form.validateField(Form.getField(config, "coldOpen"), { leadSources: ["cold"] }), /required/);
assert.equal(Form.validateField(Form.getField(config, "coldOpen"), { leadSources: ["cold"], coldOpen: "Reference a post." }), "");

assert.match(Form.validateField(Form.getField(config, "clientEmail"), { clientEmail: "not-an-email" }), /valid email/);
assert.equal(Form.validateField(Form.getField(config, "clientEmail"), { clientEmail: "ava@northstar.example" }), "");
assert.match(Form.validateField(Form.getField(config, "bookingUrl"), { bookingUrl: "javascript:alert(1)" }), /https/);
assert.equal(Form.validateField(Form.getField(config, "bookingUrl"), { bookingUrl: "" }), "");
assert.equal(Form.validateField(Form.getField(config, "bookingUrl"), { bookingUrl: "https://cal.example/northstar" }), "");
assert.match(Form.validateField(Form.getField(config, "winningDms"), { winningDms: ["", "  "] }), /at least one/i);
assert.equal(Form.validateField(Form.getField(config, "winningDms"), { winningDms: ["Lead: hi"] }), "");
assert.match(Form.validateField(Form.getField(config, "toneChoices"), {}), /required/);

const minimal = {};
config.QUESTIONS.forEach((step) => {
  step.fields.forEach((field) => {
    if (field.id === "leadSources") minimal.leadSources = ["inbound", "comments", "stories", "cold", "referrals", "other"];
  });
});
config.QUESTIONS.forEach((step) => {
  step.fields.forEach((field) => {
    if (field.type === "checkboxes" && minimal[field.id]) return;
    if (!Form.isRequired(field, minimal)) return;
    if (field.type === "email") minimal[field.id] = "ava@northstar.example";
    else if (field.type === "url") minimal[field.id] = "https://example.com/asset";
    else if (field.type === "checkboxes") minimal[field.id] = [field.options[0].value];
    else if (field.type === "transcripts") minimal[field.id] = ["Lead: hello"];
    else minimal[field.id] = "Sample " + field.id;
  });
});
assert.equal(Form.validateAll(config, minimal).ok, true);
assert.equal(Form.validateAll(config, {}).ok, false);
assert.equal(Form.validateAll(config, {}).firstStepIndex, 0);

const prompt = Prompt.buildPrompt(config, sampleAnswers, { now: NOW });
const headings = [...prompt.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
assert.deepEqual(headings, [
  "1. High Priority Rules",
  "2. Identity and Mission",
  "3. Non-Negotiables",
  "4. Style, Formatting and Tone",
  "5. Context and Outreach",
  "6. Qualification Logic",
  "7. Link Assets",
  "8. Workflow Logic",
  "9. Objection Handling"
]);

const rules = section(prompt, "High Priority Rules");
assert.equal(rules.trim(), config.HIGH_PRIORITY_RULES.trim());
assert.ok(prompt.indexOf("## 1. High Priority Rules") < prompt.indexOf("## 2. Identity and Mission"));
assert.match(prompt, /Prepared: 2026-10-10/);
assert.match(prompt, /You are Maya, the Instagram DM setter for Northstar Coaching/);
assert.doesNotMatch(prompt, /ava@northstar\.example/);

const identity = section(prompt, "Identity and Mission");
assert.match(identity, /12-Week Pipeline Intensive/);
assert.match(identity, /\$8,000/);
assert.match(identity, /None\. Do not imply a money-back guarantee/);
assert.match(identity, /Maya on the Northstar team/);

const rulesSection = section(prompt, "Non-Negotiables");
assert.match(rulesSection, /Never promise a specific income/);
assert.match(rulesSection, /Under \$10k a month/);
assert.doesNotMatch(rulesSection, /Pipeline Intensive/);

const style = section(prompt, "Style, Formatting and Tone");
assert.match(style, /sharp friend who runs the calendar/);
assert.match(style, /Warm/);
assert.match(style, /Direct/);
assert.match(style, /Very short messages/);
assert.match(style, /No emojis/);

const context = section(prompt, "Context and Outreach");
assert.match(context, /Inbound DMs/);
assert.match(context, /Cold outreach/);
assert.doesNotMatch(context, /Story replies/);
assert.match(context, /Do not pitch in the first message/);
assert.match(context, /Current DM setting SOP/);
assert.match(context, /CONVERTED_THREAD_ALPHA/);
assert.match(context, /Converted conversation 1/);
assert.match(context, /Converted conversation 3/);
assert.doesNotMatch(context, /Converted conversation 2/);

const hiddenCold = Prompt.buildPrompt(config, { ...sampleAnswers, leadSources: ["inbound"], coldOpen: "SHOULD_NOT_APPEAR" }, { now: NOW });
assert.doesNotMatch(section(hiddenCold, "Context and Outreach"), /SHOULD_NOT_APPEAR/);
assert.match(section(prompt, "Context and Outreach"), /Do not pitch in the first message/);

const qualification = section(prompt, "Qualification Logic");
assert.match(qualification, /at least \$15k collected last month/);
assert.match(qualification, /what does it cost/);

const links = section(prompt, "Link Assets");
assert.match(links, /https:\/\/cal\.example\/northstar/);
assert.match(links, /Only after they match every qualified criterion/);
assert.equal(prompt.split("https://cal.example/northstar").length - 1, 1);
assert.match(links, /Do not invent a video or claim a VSL exists/);
assert.match(links, /Do not invent an application form/);
assert.match(links, /https:\/\/northstar\.example\/checklist/);
assert.match(links, /ep-118/);

const workflow = section(prompt, "Workflow Logic");
assert.match(workflow, /Book only after they answer the revenue question/);
assert.match(workflow, /Sam on the Northstar team/);

const objections = section(prompt, "Objection Handling");
assert.match(objections, /I need to ask my business partner/);
assert.match(objections, /What part do they usually decide/);
assert.doesNotMatch(objections, /Pipeline Intensive/);
assert.doesNotMatch(objections, /CONVERTED_THREAD_ALPHA/);

const submission = Prompt.buildSubmission(config, sampleAnswers, { now: NOW });
assert.match(submission, /ava@northstar\.example/);
assert.match(submission, /## Generated system prompt/);
assert.match(submission, /## 1\. High Priority Rules/);
assert.match(submission, /CONVERTED_THREAD_ALPHA/);

const extra = structuredClone(config);
extra.QUESTIONS[1].fields.push({
  id: "extraProofPoint",
  label: "Extra proof",
  type: "textarea",
  section: "identity",
  promptLabel: "Extra proof point"
});
const extraPrompt = Prompt.buildPrompt(extra, { ...sampleAnswers, extraProofPoint: "SENTINEL_EXTRA_FIELD" }, { now: NOW });
assert.match(section(extraPrompt, "Identity and Mission"), /SENTINEL_EXTRA_FIELD/);
assert.doesNotMatch(section(extraPrompt, "Objection Handling"), /SENTINEL_EXTRA_FIELD/);

const homepage = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.match(homepage, /src="supabase\/config\.js"/);
assert.match(homepage, /Create your account/);
assert.match(homepage, /Book your call/);
assert.match(homepage, /How many DMs do you get from potential customers per day/);
assert.doesNotMatch(homepage, /id="onboarding"/);
assert.doesNotMatch(homepage, /Start your onboarding/);
const redirect = fs.readFileSync(path.join(root, "onboarding/index.html"), "utf8");
assert.match(redirect, /\/login\/\?next=\/account\//);
assert.doesNotMatch(redirect, /HIGH_PRIORITY_RULES/);
const configJs = fs.readFileSync(path.join(root, "supabase/config.js"), "utf8");
assert.match(configJs, /https:\/\/xrsipofgofvjiskmsgij\.supabase\.co/);
assert.match(configJs, /sb_publishable_/);
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261010120000_roleflow_accounts.sql"), "utf8");
assert.match(migration, /enable row level security/i);
assert.match(migration, /diego@roleflow\.io/);
assert.match(migration, /create policy submissions_select/);
assert.match(migration, /on_auth_user_created/);

console.log("onboarding prompt tests passed");
