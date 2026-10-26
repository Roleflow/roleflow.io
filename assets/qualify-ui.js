import { QUESTIONS, esc, fieldError, leadPayload, locale, progressHtml, qualified, resultHtml, stepCount } from "./qualify.js";

const answers = {};
const total = stepCount();
let step = 0;
let onKey = null;
let root = null;
let dialog = null;
let lastFocus = null;
let analyzeTimer = 0;
let analyzeTick = 0;
let saved = false;

function pageLang() {
  const lang = String(document.documentElement.lang || "").toLowerCase();
  if (lang.startsWith("es") || location.pathname === "/es" || location.pathname.startsWith("/es/")) return "es";
  return "en";
}

function pack() {
  return locale(pageLang());
}

function reduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function ensure() {
  if (dialog) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/assets/qualify.css";
  document.head.appendChild(link);
  dialog = document.createElement("div");
  dialog.className = "qmodal";
  dialog.hidden = true;
  dialog.innerHTML = `<div class="qmodal-back" data-close></div><div class="qsheet" role="dialog" aria-modal="true" aria-labelledby="qualify-kicker" tabindex="-1"><button class="qclose" type="button" data-close></button><p class="qkicker" id="qualify-kicker"></p><div id="qz" tabindex="-1"></div></div>`;
  document.body.appendChild(dialog);
  root = dialog.querySelector("#qz");
  dialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
  root.addEventListener("keydown", (event) => {
    if (onKey && event.target.tagName !== "INPUT") onKey(event);
  });
}

function paint(html, back) {
  root.innerHTML = `<div class="qstep${back ? " back" : ""}">${html}</div>`;
}

function show(back) {
  window.clearInterval(analyzeTick);
  window.clearTimeout(analyzeTimer);
  const copy = pack();
  dialog.querySelector(".qclose").textContent = copy.close;
  dialog.querySelector(".qkicker").textContent = copy.kicker;
  if (step < QUESTIONS.length) {
    const question = copy.questions[step];
    const chosen = answers[question.k];
    paint(`${progressHtml(step)}<h3>${esc(question.q)}</h3><div class="opts">${question.o.map((option, index) => `<button class="opt${chosen && chosen[0] === index ? " sel" : ""}" type="button" data-j="${index}"><kbd>${index + 1}</kbd><span>${esc(option[0])}</span></button>`).join("")}</div><div class="qnav"><button class="btn ghost" type="button" id="bk" ${step ? "" : "disabled"}>${esc(copy.back)}</button><span class="count">${step + 1} ${esc(copy.of)} ${total}</span></div>`, back);
    const pick = (index) => {
      answers[question.k] = [index, question.o[index][0], question.o[index][1]];
      const button = root.querySelectorAll(".opt")[index];
      if (button) button.classList.add("sel");
      window.setTimeout(() => {
        step += 1;
        show(false);
      }, reduced() ? 0 : 220);
    };
    root.querySelectorAll(".opt").forEach((button) => {
      button.addEventListener("click", () => pick(Number(button.dataset.j)));
    });
    onKey = (event) => {
      const index = Number(event.key) - 1;
      if (index >= 0 && index < question.o.length) pick(index);
    };
    document.getElementById("bk").addEventListener("click", () => {
      if (!step) return;
      step -= 1;
      show(true);
    });
    root.focus({ preventScroll: true });
    return;
  }
  if (step < total) {
    const field = copy.fields[step - QUESTIONS.length];
    onKey = null;
    paint(`${progressHtml(step)}<h3>${esc(field[1])}</h3><input class="fin" id="fi" type="${field[2]}" autocomplete="${field[3]}" placeholder="${esc(field[4])}" value="${esc(answers[field[0]] || "")}"><p class="err" id="er" role="alert"></p><div class="qnav"><button class="btn ghost" type="button" id="bk">${esc(copy.back)}</button><button class="btn" type="button" id="nx">${esc(step === total - 1 ? copy.finish : copy.next)}</button></div>`, back);
    const input = document.getElementById("fi");
    const next = () => {
      const error = fieldError(field[0], input.value, pageLang());
      if (error) {
        document.getElementById("er").textContent = error;
        return;
      }
      answers[field[0]] = input.value.trim();
      step += 1;
      show(false);
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") next();
    });
    document.getElementById("nx").addEventListener("click", next);
    document.getElementById("bk").addEventListener("click", () => {
      step -= 1;
      show(true);
    });
    input.focus({ preventScroll: true });
    return;
  }
  onKey = null;
  analyze();
}

function analyze() {
  const lines = pack().analyze;
  let index = 0;
  paint(`<div class="result"><div class="spin" aria-hidden="true"></div><h3 id="am">${esc(lines[0])}</h3></div>`);
  if (reduced()) {
    finish();
    return;
  }
  analyzeTick = window.setInterval(() => {
    index += 1;
    const label = document.getElementById("am");
    if (label && index < lines.length) label.textContent = lines[index];
  }, 520);
  analyzeTimer = window.setTimeout(finish, 1500);
}

function finish() {
  window.clearInterval(analyzeTick);
  const ok = qualified(answers);
  paint(resultHtml(answers, pageLang()));
  if (!saved) {
    saved = true;
    saveLead();
  }
  const again = document.getElementById("again");
  if (again) {
    again.addEventListener("click", () => {
      Object.keys(answers).forEach((key) => delete answers[key]);
      step = 0;
      saved = false;
      show(false);
    });
  }
  if (ok) root.focus({ preventScroll: true });
}

function saveLead() {
  const cfg = window.ROLEFLOW_SUPABASE;
  if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return;
  const payload = leadPayload(answers, location.pathname, pageLang());
  fetch(cfg.SUPABASE_URL + "/rest/v1/rpc/submit_qualification_lead", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: cfg.SUPABASE_ANON_KEY,
      authorization: "Bearer " + cfg.SUPABASE_ANON_KEY
    },
    body: JSON.stringify(payload)
  }).catch(() => {});
}

function open(trigger) {
  ensure();
  lastFocus = trigger || document.activeElement;
  dialog.hidden = false;
  document.documentElement.classList.add("q-lock");
  if (!root.innerHTML) show(false);
  const sheet = dialog.querySelector(".qsheet");
  sheet.focus({ preventScroll: true });
}

function close() {
  if (!dialog) return;
  dialog.hidden = true;
  document.documentElement.classList.remove("q-lock");
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-qualify]");
  if (!trigger) return;
  event.preventDefault();
  open(trigger);
});

window.addEventListener("hashchange", () => {
  if (location.hash === "#qualify") open(null);
});

if (location.hash === "#qualify") open(null);
