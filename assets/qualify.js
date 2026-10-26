/* Qualification questions, scores, and result copy.
   A pass is every score at 1. Any 0 is not a fit.
   The calendar URL is injected only by resultHtml after a pass.
   Saving a lead happens in qualify-ui.js, not here. */

export const BOOKING_URL = "https://calendar.app.google/R4wpQ4b8F5J7xnD39";

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

const ES_QUESTIONS = [
  { k: "dms", n: "más de 20 DMs al día", q: "¿Cuántos DMs recibes de posibles clientes al día?", o: [["20 o menos", 0], ["21 a 50", 1], ["51 a 100", 1], ["Más de 100", 1]] },
  { k: "offer", n: "una oferta de más de $1k", q: "¿Cuál es el precio de tu oferta principal?", o: [["$1,000 o menos", 0], ["$1,001 a $3,000", 1], ["$3,001 a $10,000", 1], ["Más de $10,000", 1]] },
  { k: "close", n: "una tasa de cierre superior al 20%", q: "¿Cuál es tu tasa de cierre en llamadas de venta?", o: [["20% o menos", 0], ["21% a 30%", 1], ["31% a 50%", 1], ["Más de 50%", 1], ["Todavía no la mido", 0]] },
  { k: "cash", n: "más de $30k al mes en efectivo cobrado", q: "¿Cuánto efectivo cobras cada mes?", o: [["$30,000 o menos", 0], ["$30,001 a $100,000", 1], ["$100,001 a $500,000", 1], ["Más de $500,000", 1]] }
];

const ES_FIELDS = [
  ["n", "¿Cómo te llamamos?", "text", "name", "Tu nombre"],
  ["e", "¿A qué email te escribimos?", "email", "email", "tu@negocio.com"],
  ["ig", "¿Cuál es tu usuario de Instagram?", "text", "off", "@tunegocio"]
];

const COPY = {
  en: {
    questions: QUESTIONS,
    fields: FIELDS,
    analyze: ANALYZE,
    kicker: "Qualification",
    close: "Close",
    back: "Back",
    next: "Continue",
    finish: "See my result",
    again: "Retake the quiz",
    of: "of",
    emailError: "Enter a valid email address.",
    requiredError: "This field is required.",
    passTitle: (name) => `You qualify, ${name}.`,
    passBody: "Your business fits the AI Client Acquisition Engine. The setter runs from the prompt you write, can send your recorded voice notes, and can send your booking link. Book a demo, or create your account to start onboarding.",
    book: "Book a demo",
    signup: "Create your account",
    failTitle: (name) => `Not a fit yet, ${name}.`,
    failBody: (missing) => `Thanks for answering. Roleflow works with businesses that already have over 20 DMs a day, an offer above $1k, a closing rate above 20%, and over $30k a month in cash collected. Right now you're missing: ${missing}.`
  },
  es: {
    questions: ES_QUESTIONS,
    fields: ES_FIELDS,
    analyze: ["Revisando tu oferta", "Comparando el valor con el volumen", "Comprobando el encaje"],
    kicker: "Calificación",
    close: "Cerrar",
    back: "Atrás",
    next: "Continuar",
    finish: "Ver mi resultado",
    again: "Volver a empezar",
    of: "de",
    emailError: "Introduce un email válido.",
    requiredError: "Este campo es obligatorio.",
    passTitle: (name) => `Calificas, ${name}.`,
    passBody: "Tu negocio encaja con el AI Client Acquisition Engine. El setter corre con el prompt que escribes, puede enviar tus notas de voz grabadas y puede enviar tu enlace de agenda. Agenda la demo, o crea tu cuenta para empezar.",
    book: "Agenda una demo",
    signup: "Crea tu cuenta",
    failTitle: (name) => `Todavía no encaja, ${name}.`,
    failBody: (missing) => `Gracias por responder. Roleflow trabaja con negocios que ya tienen más de 20 DMs al día, una oferta de más de $1k, una tasa de cierre superior al 20% y más de $30k al mes en efectivo cobrado. Ahora mismo falta: ${missing}.`
  }
};

export function locale(lang) {
  return lang === "es" ? COPY.es : COPY.en;
}

export function stepCount() {
  return QUESTIONS.length + FIELDS.length;
}

export function esc(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export function fieldError(key, value, lang) {
  const pack = locale(lang);
  const v = String(value || "").trim();
  if (key === "e") return /^\S+@\S+\.\S+$/.test(v) ? "" : pack.emailError;
  return v ? "" : pack.requiredError;
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

export function leadPayload(answers, sourcePage, lang) {
  const packLang = lang === "es" ? "es" : "en";
  const stored = {};
  QUESTIONS.forEach((question) => {
    const row = answers[question.k];
    stored[question.k] = row ? { choice: String(row[1] || ""), score: row[2] === 1 ? 1 : 0 } : null;
  });
  return {
    p_name: String(answers.n || "").trim().slice(0, 200),
    p_email: String(answers.e || "").trim().slice(0, 320),
    p_instagram: String(answers.ig || "").trim().slice(0, 80),
    p_answers: stored,
    p_source_page: String(sourcePage || "").slice(0, 300),
    p_lang: packLang
  };
}

export function resultHtml(answers, lang) {
  const pack = locale(lang);
  const missing = failures(answers);
  const ok = missing.length === 0;
  const name = esc(String(answers.n || "").split(" ")[0]);
  if (!ok) {
    const list = missing.map((item) => pack.questions.find((question) => question.k === item.k).n).join(", ");
    return `<div class="result"><h2>${pack.failTitle(name)}</h2><p>${esc(pack.failBody(list))}</p><button class="btn ghost" type="button" id="again">${esc(pack.again)}</button></div>`;
  }
  const recap = `<ul class="recap">${QUESTIONS.map((q) => `<li>${esc(answers[q.k][1])}</li>`).join("")}</ul>`;
  return `<div class="result"><div class="tick" aria-hidden="true">&#10003;</div><h2>${pack.passTitle(name)}</h2><p>${esc(pack.passBody)}</p>${recap}<div class="endbtns"><a class="btn" id="bookbtn" href="${BOOKING_URL}" target="_blank" rel="noopener">${esc(pack.book)}</a><a class="btn ghost" id="signupbtn" href="${signupHref(answers)}">${esc(pack.signup)}</a></div></div>`;
}
