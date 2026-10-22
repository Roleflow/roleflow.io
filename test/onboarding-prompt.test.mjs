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

function section(prompt, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = prompt.match(new RegExp("# " + escaped + "\\n([\\s\\S]*?)(?=\\n# [^#]|$)"));
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

assert.equal(config.configVersion, 2);
assert.equal(config.QUESTIONS.length, 4);
const fields = config.QUESTIONS.flatMap((step) => step.fields);
assert.equal(fields.length, 10);
assert.equal(fields.filter((field) => field.required).length, 9);
assert.equal(Form.isRequired(Form.getField(config, "sourceMaterial"), {}), false);
assert.equal(Form.getField(config, "sourceMaterial").file, true);
assert.doesNotMatch(fs.readFileSync(path.join(root, "onboarding/config.js"), "utf8"), /tailortalk/i);
assert.doesNotMatch(fs.readFileSync(path.join(root, "onboarding/prompt.js"), "utf8"), /tailortalk/i);
assert.equal(config.SETTER_SECTIONS.length, 9);
assert.deepEqual(Array.from(config.SETTER_SECTIONS, (item) => item.title), [
  "HIGH PRIORITY RULE",
  "IDENTITY & MISSION",
  "NON-NEGOTIABLES",
  "STYLE, FORMATTING & TONE",
  "CONTEXT & OUTREACH",
  "QUALIFICATION LOGIC",
  "LINK ASSETS",
  "WORKFLOW LOGIC",
  "OBJECTION HANDLING"
]);
assert.deepEqual(Array.from(config.PROMPT_SECTIONS, (item) => item.title), [
  "IDENTITY & MISSION",
  "NON-NEGOTIABLES",
  "STYLE, FORMATTING & TONE",
  "CONTEXT & OUTREACH",
  "QUALIFICATION LOGIC",
  "LINK ASSETS",
  "WORKFLOW LOGIC",
  "OBJECTION HANDLING"
]);
const storeReadmePath = "/cursor/stores/self/prompt/README.md";
if (fs.existsSync(storeReadmePath)) {
  const readme = fs.readFileSync(storeReadmePath, "utf8");
  const readmeRules = readme.split("\n").filter((line) => line.startsWith("- **")).join("\n");
  assert.equal(config.HIGH_PRIORITY_RULES, readmeRules);
} else {
  console.log("skipped: store not mounted");
}
assert.doesNotMatch(config.HIGH_PRIORITY_RULES, /PLACEHOLDER/);
assert.match(config.HIGH_PRIORITY_RULES, /`Sheet Tool`/);
assert.match(config.HIGH_PRIORITY_RULES, /`no_response`/);
assert.equal(config.DIEGO_EMAIL, "diego@roleflow.io");
assert.equal(Prompt.linkPairs(config).length, 0);

assert.match(Form.validateField(Form.getField(config, "brandStory"), { brandStory: "Too short." }), /at least 40/);
assert.equal(Form.validateField(Form.getField(config, "sourceMaterial"), {}), "");

const minimal = {};
config.QUESTIONS.forEach((step) => {
  step.fields.forEach((field) => {
    if (!Form.isRequired(field, minimal)) return;
    const min = field.minLength || 1;
    minimal[field.id] = ("Sample " + field.id + " ").repeat(8).slice(0, Math.max(min, 12));
  });
});
assert.equal(Form.validateAll(config, minimal).ok, true);
assert.equal(Form.validateAll(config, {}).ok, false);
assert.equal(Form.validateAll(config, {}).firstStepIndex, 0);

const prompt = Prompt.buildPrompt(config, sampleAnswers);
const headings = [...prompt.matchAll(/^# ([^#\n].*)$/gm)].map((match) => match[1]);
assert.deepEqual(headings, [
  "HIGH PRIORITY RULE",
  "IDENTITY & MISSION",
  "NON-NEGOTIABLES",
  "STYLE, FORMATTING & TONE",
  "CONTEXT & OUTREACH",
  "QUALIFICATION LOGIC",
  "LINK ASSETS",
  "WORKFLOW LOGIC",
  "OBJECTION HANDLING"
]);
assert.equal(section(prompt, "HIGH PRIORITY RULE").trim(), config.HIGH_PRIORITY_RULES.trim());
assert.ok(prompt.indexOf("# HIGH PRIORITY RULE") < prompt.indexOf("# IDENTITY & MISSION"));
assert.match(prompt, /You are Maya Chen/);
assert.match(prompt, /You ARE Maya Chen/);
assert.match(prompt, /@mayachen/);
assert.match(prompt, /Northstar Coaching/);
assert.match(prompt, /25-minute fit call/);
assert.doesNotMatch(prompt, /maya@northstar\.example/);
assert.doesNotMatch(prompt, /Thomas Miller/);
assert.doesNotMatch(prompt, /PLACEHOLDER/);

const rulesSection = section(prompt, "NON-NEGOTIABLES");
for (let n = 1; n <= 12; n += 1) assert.match(rulesSection, new RegExp("^" + n + "\\. ", "m"));
assert.match(rulesSection, /Single-Question Monogamy/);
assert.match(rulesSection, /what Maya Chen sells/);

const style = section(prompt, "STYLE, FORMATTING & TONE");
assert.match(style, /20 words/);
assert.match(style, /Split-Bubble/);
assert.match(style, /lowercase/);
assert.match(style, /👊, 🔥, 💪, 🫡, ✨/);
assert.match(style, /gender-neutral|Gender Neutrality/);

const context = section(prompt, "CONTEXT & OUTREACH");
assert.match(context, /Hey, appreciate the follow/);
assert.match(context, /Audit the Opener/);
assert.match(context, /CONVERTED_THREAD_ALPHA/);

const qualification = section(prompt, "QUALIFICATION LOGIC");
assert.match(qualification, /Geography/);
assert.match(qualification, /Goal & WHY/);
assert.match(qualification, /Where are you based\?/);
assert.match(qualification, /What did you collect last month\?/);

const links = section(prompt, "LINK ASSETS");
assert.match(links, /https:\/\/cal\.example\/maya/);
assert.match(links, /send only after they agree/);
assert.match(links, /https:\/\/northstar\.example\/thanks/);
assert.match(links, /https:\/\/northstar\.example\/checklist/);

const workflow = section(prompt, "WORKFLOW LOGIC");
assert.match(workflow, /STAGE 1/);
assert.match(workflow, /STAGE 5/);
assert.match(workflow, /Fast-Track/);
assert.match(workflow, /https:\/\/cal\.example\/maya/);
assert.match(workflow, /https:\/\/northstar\.example\/thanks/);

const objections = section(prompt, "OBJECTION HANDLING");
assert.match(objections, /Acknowledge -> Reframe -> Redirect/);
assert.match(objections, /Hard Refusal/);
assert.match(objections, /How much is it\?/);
assert.match(objections, /What part do they usually decide/);
assert.match(objections, /^7\. /m);
assert.doesNotMatch(objections, /CONVERTED_THREAD_ALPHA/);

const noEmoji = Prompt.buildPrompt(config, { ...sampleAnswers, voiceRules: "Lowercase. No emojis. Never say bro." });
assert.match(section(noEmoji, "STYLE, FORMATTING & TONE"), /\[CONFIRM\]/);
assert.match(noEmoji, /zero emojis/);

const noLinks = Prompt.buildPrompt(config, { ...sampleAnswers, links: "I will send the calendar later, no URL yet." });
assert.match(section(noLinks, "LINK ASSETS"), /Do not invent/);

const bannered = Prompt.buildPrompt(config, sampleAnswers, { testBanner: true });
assert.match(bannered, /> TEST DATA\. Fictional client/);
assert.match(bannered, /was not emailed/);
assert.match(bannered, /not a live model response/);

const submission = Prompt.buildSubmission(config, sampleAnswers, { promptText: prompt });
assert.match(submission, /maya@northstar\.example/);
assert.match(submission, /## Generated system prompt/);
assert.match(submission, /# HIGH PRIORITY RULE/);
assert.equal(submission.split("maya@northstar.example").length - 1, 1);

const homepage = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.match(homepage, /src="supabase\/config\.js"/);
assert.match(homepage, /Create your account/);
assert.match(homepage, /See if you qualify/);
assert.doesNotMatch(homepage, /Book your call|Book a call|book a call/i);
assert.doesNotMatch(homepage, /calendar\.app\.google/);
assert.match(homepage, /Outbound Manager/);
assert.match(homepage, /An AI team that brings you/);
assert.match(homepage, /href="#start"/);
assert.match(homepage, /id="qz"/);
assert.match(fs.readFileSync(path.join(root, "assets/qualify.js"), "utf8"), /How many DMs do you get from potential customers per day/);
assert.doesNotMatch(homepage, /id="onboarding"/);
assert.doesNotMatch(homepage, /Start your onboarding/);
assert.match(homepage, /id="menu-toggle"/);
assert.match(homepage, /id="site-drawer"/);
assert.match(homepage, /id="drawer-access-code"/);
assert.doesNotMatch(homepage, /Roleflow2026/);
const signupPage = fs.readFileSync(path.join(root, "signup/index.html"), "utf8");
assert.match(signupPage, /id="access-code"/);
assert.match(signupPage, /role="tablist"/);
assert.match(signupPage, /id="login-form"/);
assert.match(signupPage, /Forgot password/);
assert.doesNotMatch(signupPage, /Roleflow2026/);
assert.match(fs.readFileSync(path.join(root, "signup/signup.js"), "utf8"), /mode"\) === "login"|get\("mode"\) === "login"/);
assert.match(fs.readFileSync(path.join(root, "auth/sidebar.js"), "utf8"), /get\("mode"\) === "login"/);
assert.match(homepage, /drawer-form\[hidden\]/);
for (const file of ["signup/signup.js", "auth/sidebar.js", "auth/supabase.js", "login/login.js"]) {
  assert.doesNotMatch(fs.readFileSync(path.join(root, file), "utf8"), /Roleflow2026/, file);
}
assert.match(fs.readFileSync(path.join(root, "login/login.js"), "utf8"), /shouldCreateUser:\s*false/);
assert.match(fs.readFileSync(path.join(root, "auth/sidebar.js"), "utf8"), /shouldCreateUser:\s*false/);
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
const accessMigration = fs.readFileSync(path.join(root, "supabase/migrations/20261011090000_signup_access_code.sql"), "utf8");
assert.match(accessMigration, /private\.signup_settings/);
assert.match(accessMigration, /enforce_signup_access_code/);
assert.match(accessMigration, /revoke execute on function private\.enforce_signup_access_code\(\) from public, anon, authenticated/);
assert.match(accessMigration, /- 'access_code'/);
assert.match(homepage, /href="\/resources\/">Resources</);

const accountPage = fs.readFileSync(path.join(root, "account/index.html"), "utf8");
assert.match(accountPage, /under 10 minutes/);
assert.match(accountPage, /emails it to Diego/);
const accountJs = fs.readFileSync(path.join(root, "account/account.js"), "utf8");
assert.match(accountJs, /functions\.invoke\("generate-setter-prompt"/);
assert.doesNotMatch(accountJs, /prompt_text:/);
const appJs = fs.readFileSync(path.join(root, "onboarding/app.js"), "utf8");
assert.match(appJs, /roleflow\.onboarding\.v2/);
assert.match(appJs, /account\.generate/);
assert.doesNotMatch(appJs, /ensurePrompt/);
const adminJs = fs.readFileSync(path.join(root, "admin/publish.js"), "utf8");
assert.match(adminJs, /Regenerate/);
assert.match(adminJs, /Copy section/);
assert.match(adminJs, /SETTER_SECTIONS/);
assert.doesNotMatch(adminJs, /tailortalk/i);
assert.match(adminJs, /user_id: profile\.id/);
const promptMigration = fs.readFileSync(path.join(root, "supabase/migrations/20261014120000_prompt_generation.sql"), "utf8");
assert.match(promptMigration, /generation_status/);
assert.match(promptMigration, /email_status/);
assert.match(promptMigration, /revoke execute on function public\.guard_onboarding_update\(\) from public, anon, authenticated/);
const sectionsMigration = fs.readFileSync(path.join(root, "supabase/migrations/20261014140000_prompt_sections.sql"), "utf8");
assert.match(sectionsMigration, /prompt_sections jsonb/);
assert.match(sectionsMigration, /new\.prompt_sections = old\.prompt_sections/);
assert.match(sectionsMigration, /revoke execute on function public\.guard_onboarding_update\(\) from public, anon, authenticated/);
const fn = fs.readFileSync(path.join(root, "supabase/functions/generate-setter-prompt/index.ts"), "utf8");
assert.match(fn, /XAI_API_KEY/);
assert.match(fn, /ok: false,\s*\n\s*saved: true/);
assert.doesNotMatch(fn, /json\(500, \{ error: "XAI_API_KEY is not set/);
assert.match(accountJs, /usesLegacySetter/);
assert.match(accountJs, /\/account\/acquisition\//);
assert.match(accountJs, /skipped\.saved = true/);
assert.match(appJs, /error && error\.saved/);
assert.match(fn, /https:\/\/api\.x\.ai\/v1\/chat\/completions/);
assert.match(fn, /grok-4\.7/);
assert.match(fn, /json_schema/);
assert.match(fn, /RESEND_API_KEY/);
assert.match(fn, /RESEND_FROM/);
assert.match(fn, /diego@roleflow\.io/);
assert.match(fn, /New DM Setter prompt: /);
assert.match(fn, /example-thomas-miller\.md/);
assert.match(fn, /prompt_sections/);
assert.doesNotMatch(fn, /OPENAI_API_KEY/);
assert.doesNotMatch(fn, /api\.openai\.com/);
assert.doesNotMatch(fn, /ANTHROPIC_API_KEY/);
config.SETTER_SECTIONS.forEach((section) => {
  assert.ok(fn.includes(section.id), "function is missing section " + section.id);
  assert.ok(fn.includes(section.title), "function is missing heading " + section.title);
});
for (const line of config.HIGH_PRIORITY_RULES.split("\n")) {
  assert.ok(fn.includes(line), "function is missing a high priority rule");
}
const fnExample = fs.readFileSync(path.join(root, "supabase/functions/generate-setter-prompt/example-thomas-miller.md"));
const storeExamplePath = "/cursor/stores/self/prompt/example-thomas-miller.md";
if (fs.existsSync(storeExamplePath)) {
  const storeExample = fs.readFileSync(storeExamplePath);
  assert.ok(storeExample.equals(fnExample), "example prompt drifted from the gold file");
} else {
  console.log("skipped: store not mounted");
}

console.log("onboarding prompt tests passed");
