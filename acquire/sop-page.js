// Dedicated SOP page. It reuses the onboarding materials, winning conversations,
// client link, and prompt versions. Applying a build saves a new version.

import { playbookFromSources } from "./onboarding-build.js";
import { parseBulkThreads } from "./winning-conversations.js";

const COPY = {
  en: {
    title: "SOP",
    body: "Paste how this business sells, and the conversations that booked or closed. Build my setter drafts a prompt for you to review. Nothing goes live until you save it.",
    progress: "Onboarding progress",
    sops: "SOPs added",
    conversations: "Conversations added",
    built: "Prompt built",
    tested: "Simulator tested",
    live: "Setter live",
    test: "Test in Simulator",
    link: "Client link",
    workflow: "SOP workflow",
    workflowHelp: "Offer, ideal client, pricing rules, qualification, objections, booking, tone, and do's and don'ts.",
    upload: "Upload .txt, .md, .pdf, or .docx",
    shots: "Screenshots are not read. Paste the text.",
    saveSop: "Save SOP",
    threads: "Top-converting conversations",
    threadsHelp: "Paste one or more threads. Separate them with a line of ---. Start each with Label, Outcome, and Note if you have them.",
    saveThreads: "Save conversations",
    outcome: "Outcome",
    note: "Note",
    edit: "Edit",
    remove: "Delete",
    empty: "No conversations saved yet.",
    build: "Build my setter",
    building: "Building…",
    review: "Review",
    missing: "Missing info",
    noneMissing: "Nothing obvious is missing.",
    prompt: "Generated prompt",
    apply: "Save as new version",
    discard: "Discard",
    error: "The setter was not built.",
    booked: "Booked",
    closed: "Closed"
  },
  es: {
    title: "SOP",
    body: "Pega cómo vende este negocio y las conversaciones que reservaron o cerraron. Crear mi setter redacta un prompt para que lo revises. Nada se publica hasta que lo guardes.",
    progress: "Progreso de onboarding",
    sops: "SOPs añadidos",
    conversations: "Conversaciones añadidas",
    built: "Prompt creado",
    tested: "Simulador probado",
    live: "Setter en vivo",
    test: "Probar en el simulador",
    link: "Enlace para el cliente",
    workflow: "Flujo del SOP",
    workflowHelp: "Oferta, cliente ideal, precios, calificación, objeciones, reserva, tono y qué hacer y qué no.",
    upload: "Sube .txt, .md, .pdf o .docx",
    shots: "Las capturas no se leen. Pega el texto.",
    saveSop: "Guardar SOP",
    threads: "Conversaciones que más convierten",
    threadsHelp: "Pega uno o más hilos. Sepáralos con una línea ---. Empieza cada uno con Label, Outcome y Note si los tienes.",
    saveThreads: "Guardar conversaciones",
    outcome: "Resultado",
    note: "Nota",
    edit: "Editar",
    remove: "Eliminar",
    empty: "Todavía no hay conversaciones.",
    build: "Crear mi setter",
    building: "Creando…",
    review: "Revisión",
    missing: "Información que falta",
    noneMissing: "No falta nada evidente.",
    prompt: "Prompt generado",
    apply: "Guardar como versión nueva",
    discard: "Descartar",
    error: "No se creó el setter.",
    booked: "Reservó",
    closed: "Cerró"
  }
};

const PLAYBOOK_LABELS = {
  en: { offer: "Offer", icp: "Ideal client", questions: "Qualification questions", stages: "Conversation stages", objections: "Objection handling", tone: "Tone and voice", cta: "Booking step" },
  es: { offer: "Oferta", icp: "Cliente ideal", questions: "Preguntas de calificación", stages: "Etapas", objections: "Objeciones", tone: "Tono y voz", cta: "Reserva" }
};

function copyFor(ui) {
  return COPY[ui.language && ui.language() === "es" ? "es" : "en"];
}

export function sopProgress(state) {
  const materials = state.onboardingMaterials || [];
  const sopText = materials.some((item) => String(item.name || "").toLowerCase().includes("sop") || item.kind === "text" || item.kind === "file");
  const form = state.onboarding || {};
  const hasSop = Boolean(sopText || form.offer || form.ideal || form.criteria);
  const hasConversations = (state.winningConversations || []).length > 0;
  const status = form.status || "";
  const built = ["drafted", "tested", "approved", "live"].includes(status) || Boolean(state.sopReview && state.sopReview.prompt);
  const tested = Boolean(state.setterTestedAt) || ["tested", "approved", "live"].includes(status);
  const live = (state.agentSwitches || []).some((row) => row.agent_key === "setter" && row.enabled);
  return { hasSop, hasConversations, built, tested, live };
}

export function renderSopPage(ui) {
  const copy = copyFor(ui);
  const lang = ui.language && ui.language() === "es" ? "es" : "en";
  const labels = PLAYBOOK_LABELS[lang];
  const page = ui.el("section", { class: "agent", id: "sop-page" });
  page.append(ui.el("h2", { text: copy.title }));
  page.append(ui.el("p", { text: copy.body }));
  page.append(progress(ui, copy));
  const links = ui.el("div", { class: "filters" });
  links.append(ui.el("a", { class: "btn sm", href: "#setter", text: copy.test }));
  if (ui.state.canEdit && ui.createOnboardingLink) links.append(ui.button(copy.link, () => ui.createOnboardingLink()));
  page.append(links);
  if (ui.state.onboardingShare) page.append(ui.el("p", { id: "sop-share", text: ui.state.onboardingShare }));

  const workflow = ui.el("textarea", { id: "sop-workflow", rows: "8", maxlength: "80000", "aria-label": copy.workflow });
  workflow.value = ui.state.sopWorkflow || "";
  workflow.addEventListener("input", () => { ui.state.sopWorkflow = workflow.value; });
  page.append(ui.el("h3", { text: copy.workflow }));
  page.append(ui.el("p", { class: "mute", text: copy.workflowHelp }));
  page.append(workflow);
  page.append(ui.el("p", { class: "mute", text: copy.upload }));
  page.append(ui.el("p", { class: "mute", text: copy.shots }));
  page.append(ui.el("input", { id: "sop-file", type: "file", accept: ".txt,.md,.pdf,.docx,text/plain" }));
  if (ui.state.canEdit) page.append(ui.button(copy.saveSop, () => ui.saveSopWorkflow(workflow.value)));

  page.append(ui.el("h3", { text: copy.threads }));
  page.append(ui.el("p", { class: "mute", text: copy.threadsHelp }));
  const bulk = ui.el("textarea", { id: "sop-threads", rows: "8", maxlength: "80000", "aria-label": copy.threads, placeholder: "---\nLabel: March\nOutcome: closed\nMe: hey\nThem: book me\n---" });
  page.append(bulk);
  if (ui.state.canEdit) page.append(ui.button(copy.saveThreads, () => ui.saveBulkConversations(bulk.value)));
  const list = ui.el("div", { id: "sop-thread-list" });
  const rows = ui.state.winningConversations || [];
  if (!rows.length) list.append(ui.el("p", { class: "mute", text: copy.empty }));
  rows.forEach((row) => {
    const card = ui.el("article", { class: "version-row" });
    const outcome = row.outcome === "booked" ? copy.booked : row.outcome === "closed" ? copy.closed : "";
    card.append(ui.el("strong", { text: (row.title || "Conversation") + (outcome ? " · " + outcome : "") }));
    if (row.notes) card.append(ui.el("p", { class: "mute", text: copy.note + ": " + row.notes }));
    card.append(ui.el("p", { text: String(row.raw_text || "").slice(0, 180) }));
    if (ui.state.canEdit) {
      const actions = ui.el("div", { class: "filters" });
      actions.append(ui.button(copy.edit, () => {
        bulk.value = row.raw_text || "";
        ui.state.winningEdit = row;
      }));
      actions.append(ui.button(copy.remove, () => ui.deleteWinning(row)));
      card.append(actions);
    }
    list.append(card);
  });
  page.append(list);

  if (ui.state.canEdit && ui.buildSop) {
    const build = ui.button(copy.build, async () => {
      build.disabled = true;
      build.textContent = copy.building;
      const status = ui.el("p", { id: "sop-build-status", class: "claude-notice", role: "status", text: copy.building });
      page.append(status);
      await ui.buildSop(workflow.value);
    });
    build.id = "build-my-setter";
    page.append(build);
  }
  if (ui.state.sopError) page.append(ui.el("p", { id: "sop-error", class: "claude-notice", role: "status", text: ui.state.sopError }));
  if (ui.state.sopReview) page.append(review(ui, copy, labels, ui.state.sopReview));
  return page;
}

function progress(ui, copy) {
  const state = sopProgress(ui.state);
  const list = ui.el("ol", { class: "intake-check", id: "sop-progress" });
  [
    ["hasSop", copy.sops],
    ["hasConversations", copy.conversations],
    ["built", copy.built],
    ["tested", copy.tested],
    ["live", copy.live]
  ].forEach(([key, label]) => {
    list.append(ui.el("li", { class: state[key] ? "is-done" : "", text: (state[key] ? "✓ " : "") + label }));
  });
  return list;
}

function review(ui, copy, labels, draft) {
  const card = ui.el("section", { class: "agent", id: "sop-review" });
  card.append(ui.el("h3", { text: copy.review }));
  const editors = {};
  Object.keys(labels).forEach((key) => {
    const area = ui.el("textarea", { id: "playbook-" + key, rows: "3", "aria-label": labels[key] });
    area.value = (draft.playbook && draft.playbook[key]) || "";
    editors[key] = area;
    card.append(ui.el("label", { text: labels[key] }, [area]));
  });
  card.append(ui.el("h3", { text: copy.missing }));
  const missing = draft.missing || [];
  if (!missing.length) card.append(ui.el("p", { text: copy.noneMissing }));
  missing.forEach((key) => card.append(ui.el("p", { text: labels[key] || key })));
  const prompt = ui.el("textarea", { id: "sop-generated-prompt", rows: "8", "aria-label": copy.prompt });
  prompt.value = draft.prompt || "";
  card.append(ui.el("label", { text: copy.prompt }, [prompt]));
  if (ui.state.canEdit) {
    const actions = ui.el("div", { class: "filters" });
    actions.append(ui.button(copy.apply, async () => {
      const sections = {};
      Object.keys(editors).forEach((key) => { sections[key] = editors[key].value; });
      ui.state.sopReview = { ...draft, playbook: sections, prompt: prompt.value };
      if (ui.applySopPrompt) await ui.applySopPrompt(prompt.value);
    }));
    actions.append(ui.button(copy.discard, () => {
      ui.state.sopReview = null;
      ui.state.sopError = "";
      ui.paint();
    }));
    card.append(actions);
  }
  return card;
}

export function localSopReview(workflow, conversations) {
  const bundle = {
    form: {},
    materials: String(workflow || ""),
    conversations: (conversations || []).map((row) => (row.outcome ? row.outcome + ": " : "") + (row.raw_text || "")).join("\n\n")
  };
  const playbook = playbookFromSources(bundle, {});
  return { playbook: playbook.sections, missing: playbook.missing, prompt: playbook.prompt };
}
