import { ANALYZE, FIELDS, QUESTIONS, esc, fieldError, progressHtml, resultHtml, stepCount } from "./qualify.js";

const answers = {};
const total = stepCount();
const root = document.getElementById("qz");
let step = 0;
let onKey = null;

function paint(html, back) {
  root.innerHTML = `<div class="qstep${back ? " back" : ""}">${html}</div>`;
}

function show(back) {
  if (step < QUESTIONS.length) {
    const question = QUESTIONS[step];
    const chosen = answers[question.k];
    paint(`${progressHtml(step)}<h3>${question.q}</h3><div class="opts">${question.o.map((option, index) => `<button class="opt${chosen && chosen[0] === index ? " sel" : ""}" type="button" data-j="${index}"><kbd>${index + 1}</kbd><span>${option[0]}</span></button>`).join("")}</div><div class="qnav"><button class="btn ghost" type="button" id="bk" ${step ? "" : "disabled"}>Back</button><span class="count">${step + 1} of ${total}</span></div>`, back);
    const pick = (index) => {
      answers[question.k] = [index, question.o[index][0], question.o[index][1]];
      root.querySelectorAll(".opt")[index].classList.add("sel");
      window.setTimeout(() => {
        step += 1;
        show(false);
      }, 260);
    };
    root.querySelectorAll(".opt").forEach((button) => {
      button.addEventListener("click", () => pick(Number(button.dataset.j)));
    });
    onKey = (event) => {
      const index = Number(event.key) - 1;
      if (index >= 0 && index < question.o.length) pick(index);
    };
    document.getElementById("bk").addEventListener("click", () => {
      step -= 1;
      show(true);
    });
    root.focus({ preventScroll: true });
    return;
  }
  if (step < total) {
    const field = FIELDS[step - QUESTIONS.length];
    onKey = null;
    paint(`${progressHtml(step)}<h3>${field[1]}</h3><input class="fin" id="fi" type="${field[2]}" autocomplete="${field[3]}" placeholder="${field[4]}" value="${esc(answers[field[0]] || "")}"><p class="err" id="er" role="alert"></p><div class="qnav"><button class="btn ghost" type="button" id="bk">Back</button><button class="btn" type="button" id="nx">${step === total - 1 ? "See my result" : "Continue"}</button></div>`, back);
    const input = document.getElementById("fi");
    const next = () => {
      const error = fieldError(field[0], input.value);
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
  let index = 0;
  paint(`<div class="result"><div class="spin" aria-hidden="true"></div><h3 id="am">${ANALYZE[0]}</h3></div>`);
  const timer = window.setInterval(() => {
    index += 1;
    const label = document.getElementById("am");
    if (label && index < ANALYZE.length) label.textContent = ANALYZE[index];
  }, 600);
  window.setTimeout(() => {
    window.clearInterval(timer);
    paint(resultHtml(answers));
    const again = document.getElementById("again");
    if (again) {
      again.addEventListener("click", () => {
        for (const key of Object.keys(answers)) delete answers[key];
        step = 0;
        show(false);
      });
    }
  }, 1900);
}

root.addEventListener("keydown", (event) => {
  if (onKey && event.target.tagName !== "INPUT") onKey(event);
});

show(false);
