const STEPS = [
  {
    title: "Business",
    fields: [
      ["name", "Business name", "text"],
      ["handle", "Instagram handle", "text"]
    ]
  },
  {
    title: "Offer",
    fields: [
      ["offer", "Offer and price", "textarea"],
      ["ideal", "Ideal client", "textarea"]
    ]
  },
  {
    title: "Who to book",
    fields: [
      ["criteria", "Qualification criteria", "textarea"],
      ["objections", "Objections", "textarea"],
      ["exclusions", "Exclusions", "textarea"]
    ]
  },
  {
    title: "Voice",
    fields: [
      ["booking", "Booking link", "text"],
      ["tone", "Tone", "text"],
      ["languages", "Languages", "text"],
      ["faqs", "FAQs", "textarea"]
    ]
  }
];

export function openAddBusiness({ supabase, preview }) {
  const existing = document.getElementById("add-business-modal");
  if (existing) existing.remove();
  const modal = document.createElement("div");
  modal.id = "add-business-modal";
  modal.className = "desk-modal";
  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "desk-modal-backdrop";
  backdrop.setAttribute("aria-label", "Close");
  const sheet = document.createElement("div");
  sheet.className = "desk-modal-sheet onboard-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", "add-business-title");
  modal.append(backdrop, sheet);
  document.body.append(modal);
  const answers = {};
  let step = 0;
  const close = () => modal.remove();
  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", function onKey(event) {
    if (event.key !== "Escape" || !document.body.contains(modal)) {
      document.removeEventListener("keydown", onKey);
      return;
    }
    close();
  });
  const paint = () => {
    sheet.replaceChildren();
    const head = document.createElement("div");
    head.className = "setter-bar";
    const title = document.createElement("h2");
    title.id = "add-business-title";
    title.textContent = "Add business";
    const progress = document.createElement("p");
    progress.className = "mute";
    progress.textContent = "Step " + (step + 1) + " of " + STEPS.length + " · " + STEPS[step].title;
    head.append(title, progress);
    sheet.append(head);
    const form = document.createElement("form");
    form.className = "onboard-form";
    STEPS[step].fields.forEach(([key, label, type]) => {
      const wrap = document.createElement("label");
      wrap.append(document.createTextNode(label));
      const input = type === "textarea" ? document.createElement("textarea") : document.createElement("input");
      if (input.tagName === "INPUT") input.type = "text";
      input.value = answers[key] || "";
      input.required = key === "name";
      input.setAttribute("aria-label", label);
      input.addEventListener("input", () => {
        answers[key] = input.value;
      });
      wrap.append(input);
      form.append(wrap);
    });
    const actions = document.createElement("div");
    actions.className = "filters";
    if (step > 0) {
      const back = document.createElement("button");
      back.type = "button";
      back.className = "btn ghost sm";
      back.textContent = "Back";
      back.addEventListener("click", () => {
        step -= 1;
        paint();
      });
      actions.append(back);
    }
    const next = document.createElement("button");
    next.type = "submit";
    next.className = "btn sm";
    next.textContent = step === STEPS.length - 1 ? "Create business" : "Continue";
    actions.append(next);
    form.append(actions);
    const note = document.createElement("p");
    note.className = "mute";
    note.id = "add-business-note";
    form.append(note);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (step < STEPS.length - 1) {
        if (step === 0 && !String(answers.name || "").trim()) {
          note.textContent = "Add the business name.";
          return;
        }
        step += 1;
        paint();
        return;
      }
      next.disabled = true;
      note.textContent = "Writing the setter prompt…";
      if (preview || !supabase) {
        note.textContent = "This preview stays here. A live submit opens the prompt editor for review.";
        next.disabled = false;
        return;
      }
      const created = await supabase.functions.invoke("roleflow-add-business", { body: answers });
      const payload = created.data || {};
      if (created.error || payload.ok === false || !payload.business_id) {
        note.textContent = (payload && payload.error) || (created.error && created.error.message) || "The business was not created.";
        next.disabled = false;
        return;
      }
      window.location.href = "/account/acquisition/?business=" + encodeURIComponent(payload.business_id) + "&editor=1#inbound";
    });
    sheet.append(form);
  };
  paint();
}
