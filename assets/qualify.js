/* Homepage qualification. Same questions, scores, and result as the page
   before the acquisition-team rewrite. 0 fails. There is no form backend:
   the only handoff is the signup link, which pre-fills name, email, and Instagram. */

export const BOOKING_URL = "https://calendar.app.google/8i1gomkozavqYU5b8";

export const QUESTIONS = [
  { k: "dms", n: "over 20 DMs a day", q: "How many DMs do you get from potential customers per day?", o: [["20 or fewer", 0], ["21 to 50", 1], ["51 to 100", 1], ["More than 100", 1]] },
  { k: "offer", n: "an offer priced above $1k", q: "What is the price of your main offer?", o: [["$1,000 or less", 0], ["$1,001 to $3,000", 1], ["$3,001 to $10,000", 1], ["More than $10,000", 1]] },
  { k: "close", n: "a closing rate above 20%", q: "What is your closing rate on sales calls?", o: [["20% or lower", 0], ["21% to 30%", 1], ["31% to 50%", 1], ["More than 50%", 1], ["I don't track it yet", 0]] },
  { k: "cash", n: "over $30k a month in cash collected", q: "How much cash do you collect each month?", o: [["$30,000 or less", 0], ["$30,001 to $100,000", 1], ["$100,001 to $500,000", 1], ["More than $500,000", 1]] }
];

export const FIELDS = [
  ["n", "What should we call you?", "text", "name", "Your first name"],
  ["e", "What email can we reach you on?", "email", "email", "you@business.com"],
  ["ig", "What is your Instagram handle?", "text", "off", "@yourbusiness"]
];

export const ANALYZE = ["Checking your offer", "Matching deal value to volume", "Checking the fit"];

export function stepCount() {
  return QUESTIONS.length + FIELDS.length;
}

export function esc(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export function fieldError(key, value) {
  const v = String(value || "").trim();
  if (key === "e") return /^\S+@\S+\.\S+$/.test(v) ? "" : "Enter a valid email address.";
  return v ? "" : "This field is required.";
}

export function failures(answers) {
  return QUESTIONS.filter((q) => !answers[q.k] || answers[q.k][2] === 0);
}

export function qualified(answers) {
  return failures(answers).length === 0;
}

export function signupHref(answers) {
  const params = new URLSearchParams();
  if (answers.n) params.set("name", answers.n);
  if (answers.e) params.set("email", answers.e);
  if (answers.ig) params.set("ig", answers.ig);
  const query = params.toString();
  return "/signup/" + (query ? "?" + query : "");
}

export function progressHtml(index) {
  const total = stepCount();
  return `<div class="prog" aria-hidden="true">${Array.from({ length: total }, (_, i) => `<i class="${i <= index ? "on" : ""}"></i>`).join("")}</div>`;
}

/* TODO: send {name:A.n,email:A.e,instagram:A.ig,answers:A,qualified:ok} to your form backend / CRM here */
export function resultHtml(answers) {
  const missing = failures(answers);
  const ok = missing.length === 0;
  const name = esc(String(answers.n || "").split(" ")[0]);
  if (!ok) {
    return `<div class="result"><h2>Not a fit yet, ${name}.</h2><p>We can't take on your business right now. To work with us you need over 20 DMs a day, an offer above $1k, a closing rate above 20% and over $30k a month in cash collected. Right now you're missing: ${missing.map((item) => item.n).join(", ")}.</p><button class="btn ghost" type="button" id="again">Retake the quiz</button></div>`;
  }
  const recap = `<ul class="recap">${QUESTIONS.map((q) => `<li>${esc(answers[q.k][1])}</li>`).join("")}</ul>`;
  return `<div class="result"><div class="tick" aria-hidden="true">&#10003;</div><h2>You qualify, ${name}.</h2><p>Your business is a strong fit for a DM system that replies in your own voice. Book your call, or create your account to start onboarding.</p>${recap}<div class="endbtns"><a class="btn" id="bookbtn" href="${BOOKING_URL}" target="_blank" rel="noopener">Book your call</a><a class="btn ghost" id="signupbtn" href="${signupHref(answers)}">Create your account</a></div></div>`;
}
