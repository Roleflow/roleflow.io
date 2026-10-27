import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOOKING_URL, FIELDS, QUESTIONS, failures, fieldError, leadPayload, locale, qualified, resultHtml, signupHref } from "../assets/qualify.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const homepage = fs.readFileSync(path.join(root, "index.html"), "utf8");
const ui = fs.readFileSync(path.join(root, "assets/qualify-ui.js"), "utf8");

const demoCtas = [...homepage.matchAll(/<a\b[^>]*>Apply To Work Together →<\/a>/g)].map((match) => match[0]);
assert.equal(demoCtas.length, 3);
for (const tag of demoCtas) {
  assert.match(tag, /href="#qualify"/);
  assert.match(tag, /data-qualify/);
  assert.match(tag, /class="btn"/);
  assert.doesNotMatch(tag, /class="btn ghost"/);
  assert.doesNotMatch(tag, /calendar\.app\.google/);
}
assert.doesNotMatch(homepage, /See if you qualify/);
assert.doesNotMatch(homepage, /book your call|book a call/i);
assert.match(homepage, /id="start"/);
assert.doesNotMatch(homepage, /id="qz"/);
assert.match(homepage, /\/assets\/qualify-ui\.js/);
const qualifySource = fs.readFileSync(path.join(root, "assets/qualify.js"), "utf8");
assert.equal((qualifySource.match(/calendar\.app\.google\/R4wpQ4b8F5J7xnD39/g) || []).length, 1);
assert.equal((qualifySource.match(/8i1gomkozavqYU5b8/g) || []).length, 0);
assert.doesNotMatch(homepage, /Qualification bar/);
assert.doesNotMatch(ui, /calendar\.app\.google/);
assert.match(ui, /resultHtml/);
assert.match(ui, /class="qstep/);
assert.doesNotMatch(ui, /class="screen/);
assert.match(ui, /prefers-reduced-motion/);
assert.match(ui, /submit_qualification_lead/);
assert.match(fs.readFileSync(path.join(root, "assets/qualify.css"), "utf8"), /prefers-reduced-motion:reduce/);
assert.doesNotMatch(qualifySource, /fetch\(|supabase/);

assert.deepEqual(QUESTIONS.map((question) => [question.q, question.o]), [
  ["How many DMs do you get from potential customers per day?", [["20 or fewer", 0], ["21 to 50", 1], ["51 to 100", 1], ["More than 100", 1]]],
  ["What is the price of your main offer?", [["$1,000 or less", 0], ["$1,001 to $3,000", 1], ["$3,001 to $10,000", 1], ["More than $10,000", 1]]],
  ["What is your closing rate on sales calls?", [["20% or lower", 0], ["21% to 30%", 1], ["31% to 50%", 1], ["More than 50%", 1], ["I don't track it yet", 0]]],
  ["How much cash do you collect each month?", [["$30,000 or less", 0], ["$30,001 to $100,000", 1], ["$100,001 to $500,000", 1], ["More than $500,000", 1]]]
]);
assert.deepEqual(FIELDS.map((field) => field[1]), [
  "What should we call you?",
  "What email can we reach you on?",
  "What is your Instagram handle?"
]);

function answers(scores, contact = {}) {
  const out = { n: "Ada Lovelace", e: "ada@co.test", ig: "@ada", ...contact };
  QUESTIONS.forEach((question, index) => {
    const score = scores[index];
    const option = question.o.find((item) => item[1] === score);
    out[question.k] = [question.o.indexOf(option), option[0], score];
  });
  return out;
}

const pass = answers([1, 1, 1, 1]);
assert.equal(qualified(pass), true);
assert.deepEqual(failures(pass), []);
const booked = resultHtml(pass);
assert.match(booked, /You qualify, Ada\./);
assert.match(booked, /id="bookbtn" href="https:\/\/calendar\.app\.google\/R4wpQ4b8F5J7xnD39" target="_blank" rel="noopener"/);
assert.match(booked, /AI Client Acquisition Engine/);
assert.doesNotMatch(booked, /cloned|guarantee/i);
assert.equal(BOOKING_URL, "https://calendar.app.google/R4wpQ4b8F5J7xnD39");
assert.match(booked, /id="signupbtn" href="\/signup\/\?name=Ada\+Lovelace&email=ada%40co\.test&ig=%40ada"/);
assert.equal(signupHref(pass), "/signup/?name=Ada+Lovelace&email=ada%40co.test&ig=%40ada");

for (let index = 0; index < QUESTIONS.length; index += 1) {
  const scores = [1, 1, 1, 1];
  scores[index] = 0;
  const blocked = resultHtml(answers(scores));
  assert.equal(qualified(answers(scores)), false);
  assert.doesNotMatch(blocked, /bookbtn|calendar\.app\.google|signupbtn/);
  assert.match(blocked, /Not a fit yet, Ada\./);
  assert.match(blocked, /id="again"/);
  assert.match(blocked, new RegExp(QUESTIONS[index].n.replace(/[$.]/g, "\\$&")));
}

const untracked = answers([1, 1, 1, 1]);
untracked.close = [4, "I don't track it yet", 0];
const quiet = resultHtml(untracked);
assert.doesNotMatch(quiet, /calendar\.app\.google/);
assert.match(quiet, /a closing rate above 20%/);

assert.equal(fieldError("e", "not-an-email"), "Enter a valid email address.");
assert.equal(fieldError("n", "  "), "This field is required.");
assert.equal(fieldError("ig", "@roleflow"), "");
assert.equal(fieldError("e", "ada@co.test"), "");

const spanish = locale("es");
assert.equal(spanish.questions.length, QUESTIONS.length);
spanish.questions.forEach((question, index) => {
  assert.equal(question.k, QUESTIONS[index].k);
  assert.deepEqual(question.o.map((option) => option[1]), QUESTIONS[index].o.map((option) => option[1]));
  assert.notEqual(question.q, QUESTIONS[index].q);
});
assert.equal(locale("en").questions, QUESTIONS);
const spanishPass = resultHtml(pass, "es");
assert.match(spanishPass, /Calificas, Ada\./);
assert.match(spanishPass, /AI Client Acquisition Engine/);
assert.match(spanishPass, /id="bookbtn" href="https:\/\/calendar\.app\.google\/R4wpQ4b8F5J7xnD39"/);
const spanishFail = resultHtml(answers([0, 1, 1, 1]), "es");
assert.doesNotMatch(spanishFail, /calendar\.app\.google/);
assert.match(spanishFail, /Todavía no encaja, Ada\./);
assert.match(spanishFail, /más de 20 DMs al día/);
assert.equal(fieldError("e", "nope", "es"), "Introduce un email válido.");

const payload = leadPayload(pass, "/es/para/coaches/", "es");
assert.equal(payload.p_lang, "es");
assert.equal(payload.p_source_page, "/es/para/coaches/");
assert.equal(payload.p_answers.dms.score, 1);
assert.equal(payload.p_answers.close.score, 1);
assert.equal("p_qualified" in payload, false);

const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261026200000_qualification_leads.sql"), "utf8");
assert.match(migration, /create table public\.qualification_leads/);
assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all on table public\.qualification_leads from public, anon, authenticated/);
assert.match(migration, /grant execute on function public\.submit_qualification_lead\(text, text, text, jsonb, text, text\) to anon, authenticated/);
assert.match(migration, /#>> '\{dms,score\}'/);
assert.doesNotMatch(migration, /grant select|for select/i);

function htmlFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(full, out);
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}
for (const file of htmlFiles(root)) {
  const text = fs.readFileSync(file, "utf8");
  assert.equal(text.includes("calendar.app.google"), false, path.relative(root, file));
}
for (const file of fs.readdirSync(path.join(root, "scripts")).filter((name) => name.endsWith(".py"))) {
  const text = fs.readFileSync(path.join(root, "scripts", file), "utf8");
  assert.equal(text.includes("calendar.app.google"), false, file);
}
const llms = fs.readFileSync(path.join(root, "llms.txt"), "utf8");
assert.equal(llms.includes("calendar.app.google"), false);
assert.match(llms, /#qualify/);
assert.doesNotMatch(llms, /roleflow\.io\/es/);
assert.equal(fs.existsSync(path.join(root, "es/index.html")), false);
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const redirectTo = (source) => vercel.redirects.find((item) => item.source === source);
assert.equal(redirectTo("/es").destination, "/");
assert.equal(redirectTo("/es").statusCode, 301);
assert.equal(redirectTo("/es/").destination, "/");
assert.equal(redirectTo("/es/para/coaches/").destination, "/for/coaches/");
assert.equal(redirectTo("/es/para/coaches/").statusCode, 301);
assert.equal(redirectTo("/es/que-es-un-setter-con-ia/").destination, "/what-is-an-ai-dm-setter/");
assert.equal(redirectTo("/es/:path*").destination, "/");
assert.equal(redirectTo("/es/:path*").statusCode, 301);
const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
assert.doesNotMatch(sitemap, /\/es\//);
assert.doesNotMatch(sitemap, /hreflang="es"/);
for (const file of htmlFiles(root)) {
  const rel = path.relative(root, file);
  if (rel.startsWith("account/") || rel.startsWith("admin/") || rel.startsWith("acquire/")) continue;
  const text = fs.readFileSync(file, "utf8");
  assert.equal(text.includes('href="/es'), false, rel);
  assert.equal(text.includes('hreflang="es"'), false, rel);
}
assert.match(fs.readFileSync(path.join(root, "account/acquisition/index.html"), "utf8"), /value="es">Español/);
assert.match(fs.readFileSync(path.join(root, "signup/index.html"), "utf8"), /data-qualify/);

console.log("qualify tests passed");
