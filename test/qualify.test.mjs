import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOOKING_URL, FIELDS, QUESTIONS, failures, fieldError, qualified, resultHtml, signupHref } from "../assets/qualify.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const homepage = fs.readFileSync(path.join(root, "index.html"), "utf8");
const ui = fs.readFileSync(path.join(root, "assets/qualify-ui.js"), "utf8");

const ctas = [...homepage.matchAll(/<a\b[^>]*>Book your call<\/a>/g)].map((match) => match[0]);
assert.equal(ctas.length, 2);
for (const tag of ctas) {
  assert.match(tag, /href="#start"/);
  assert.doesNotMatch(tag, /calendar\.app\.google/);
  assert.doesNotMatch(tag, /target="_blank"/);
}
assert.match(homepage, /id="start"/);
assert.match(homepage, /id="qz"/);
assert.match(homepage, /\/assets\/qualify-ui\.js/);
assert.doesNotMatch(homepage, /calendar\.app\.google/);
assert.doesNotMatch(homepage, /Qualification bar/);
assert.doesNotMatch(ui, /calendar\.app\.google/);
assert.match(ui, /resultHtml/);
assert.match(ui, /class="qstep/);
assert.doesNotMatch(ui, /class="screen/);
assert.doesNotMatch(fs.readFileSync(path.join(root, "assets/qualify.js"), "utf8"), /fetch\(|supabase/);

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
assert.match(booked, /id="bookbtn" href="https:\/\/calendar\.app\.google\/8i1gomkozavqYU5b8" target="_blank" rel="noopener"/);
assert.equal(BOOKING_URL, "https://calendar.app.google/8i1gomkozavqYU5b8");
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

console.log("qualify tests passed");
