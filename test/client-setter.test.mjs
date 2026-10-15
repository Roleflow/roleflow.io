import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { isBooked, isQualified, leadTitle, liveSections, setterFigures, setterStatus, SETTER_SECTIONS } from "../account/setter-model.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const sandbox = { console, URL };
vm.createContext(sandbox);
vm.runInContext(read("onboarding/config.js"), sandbox, { filename: "onboarding/config.js" });
const titles = Array.from(sandbox.ROLEFLOW_ONBOARDING_CONFIG.TAILORTALK_SECTIONS, (section) => section.title);
assert.equal(titles.join("\n"), SETTER_SECTIONS.map((section) => section.title).join("\n"));
assert.equal(SETTER_SECTIONS.length, 9);

const sections = liveSections([
  { node: "HIGH PRIORITY RULE", instruction: "Check the sheet first." },
  { node: "IDENTITY & MISSION", instruction: "You speak for Northstar." },
  { node: "NON-NEGOTIABLES", instruction: "Never invent a price." },
  { node: "STYLE, FORMATTING & TONE", instruction: "Short lines." },
  { node: "CONTEXT & OUTREACH", instruction: "Instagram DMs." },
  { node: "QUALIFICATION LOGIC", instruction: "Budget, then timeline." },
  { node: "LINK ASSETS", instruction: "https://example.test/book" },
  { node: "WORKFLOW LOGIC", instruction: "Qualify, then offer a time." },
  { node: "OBJECTION HANDLING", instruction: "Price means the call is free." }
]);
assert.deepEqual(sections.map((section) => section.id), SETTER_SECTIONS.map((section) => section.id));
assert.equal(sections[0].text, "Check the sheet first.");
assert.equal(sections[8].text, "Price means the call is free.");
assert.equal(sections.filter((section) => section.text).length, 9);

const cachedNodes = liveSections([
  { node: "Highest Priority Rule", instruction: "Check the sheet." },
  { node: "The Role", instruction: "You are the setter." },
  { node: "Non Negotiable Rules", instruction: "Do not invent a price." },
  { node: "Follow up rules", instruction: "Wait a day." }
]);
assert.match(cachedNodes.find((section) => section.id === "high_priority_rule").text, /Check the sheet/);
assert.match(cachedNodes.find((section) => section.id === "identity").text, /setter/);
assert.match(cachedNodes.find((section) => section.id === "nonnegotiables").text, /price/);
assert.match(cachedNodes.find((section) => section.id === "workflow").text, /Wait a day/);

const fromObject = liveSections({ high_priority_rule: "Rule text", workflow: "Steps" });
assert.equal(fromObject[0].text, "Rule text");
assert.equal(fromObject.find((section) => section.id === "workflow").text, "Steps");
assert.equal(fromObject.find((section) => section.id === "identity").text, "");

assert.equal(setterStatus("active"), "Active");
assert.equal(setterStatus("paused"), "Paused");
assert.equal(isQualified({ stage: "Hot" }), true);
assert.equal(isQualified({ stage: "qualified" }), true);
assert.equal(isQualified({ stage: "warm" }), false);
assert.equal(isBooked({ is_converted: true }), true);
assert.equal(isBooked({ is_converted: false }), false);
assert.equal(isBooked({ is_converted: "true" }), false);
assert.equal(leadTitle({ lead_name: "Alex Rivera", username: "@arivera" }), "Alex Rivera (@arivera)");
assert.equal(leadTitle({ lead_name: "Alex Rivera" }), "Alex Rivera");
assert.equal(leadTitle({}), "Unknown");

const figures = setterFigures({
  total_leads: 12,
  by_category: { sales: 9, support: 3 },
  converted_count: 3,
  conversion_rate: 0.25,
  by_status: { hot: 4, warm: 3, cold: 2 },
  leads_per_day: "[{\"day\":\"2026-10-14\",\"count\":2}]"
});
assert.equal(figures.conversations, 12);
assert.equal(figures.leads, 9);
assert.equal(figures.booked, 3);
assert.equal(figures.perDay.length, 1);
assert.equal(setterFigures({ total_leads: 4, converted_count: 1 }).leads, 4);

const migration = read("supabase/migrations/20261014200000_client_setter.sql");
assert.match(migration, /add column if not exists client_id uuid references public\.profiles/);
assert.match(migration, /create unique index if not exists tailortalk_agents_client_id/);
assert.match(migration, /using \(public\.is_admin\(\) or client_id = auth\.uid\(\)\)/);
assert.match(migration, /agent\.client_id = auth\.uid\(\)/);
assert.match(migration, /with \(security_invoker = true\)/);
assert.match(migration, /public\.client_ai_setters/);
assert.match(migration, /public\.client_ai_setter_leads/);
assert.match(migration, /public\.client_ai_setter_stats/);
assert.match(migration, /revoke all on table private\.tailortalk_agent_secrets from public, anon, authenticated/);
assert.match(migration, /using \(public\.is_admin\(\)\)/);
assert.doesNotMatch(migration, /for insert|for update|for delete|grant insert|grant update|grant delete/i);
assert.doesNotMatch(migration, /access_token|token_encrypted/);

const clientFiles = ["account/index.html", "account/account.js", "account/setter.js", "account/setter-model.js"];
for (const file of clientFiles) {
  assert.doesNotMatch(read(file), /tailortalk/i, file + " mentions the provider");
}
assert.match(read("account/index.html"), /id="setter" hidden/);
assert.match(read("account/index.html"), /Your <span class="g">AI Setter<\/span>/);
assert.match(read("account/setter.js"), /client_ai_setters/);
assert.match(read("account/setter.js"), /Recent leads/);
assert.match(read("account/setter.js"), /Live prompt/);
assert.doesNotMatch(read("account/setter.js"), /<textarea|contenteditable|token/);
assert.doesNotMatch(read("index.html"), /id="setter"|Your AI Setter/);
assert.doesNotMatch(read("auth/sidebar.js"), /setter-app|Your AI Setter/);
assert.match(read("account/account.js"), /renderSetter/);
assert.doesNotMatch(read("account/account.js"), /prompt_text:/);

const names = fs.readdirSync(path.join(root, "supabase/migrations")).filter((name) => name.endsWith(".sql"));
assert.deepEqual(names, names.slice().sort());
assert.ok(names.indexOf("20261014180000_tailortalk_registry.sql") < names.indexOf("20261014200000_client_setter.sql"));

console.log("client setter tests passed");
