// Onboarding intake for one business. Build everything opens drafts.
// Approving writes those drafts. It does not turn the setter on.

import { BRIEF_KEYS, advanceStatus } from "./onboarding-build.js";
import { briefHeading } from "./studio-model.js";

const COPY = {
  en: {
    title: "Onboarding",
    body: "Collect this client's materials, then build the business sections and the setter prompt. Nothing goes live until you approve it.",
    checklist: "Checklist",
    materials: "Materials received",
    drafted: "Prompt drafted",
    tested: "Simulator tested",
    approved: "Approved",
    live: "Live",
    offer: "Offer",
    price: "Price",
    ideal: "Ideal client",
    booking: "Booking link",
    criteria: "Qualifying criteria",
    disqualifiers: "Disqualifiers",
    docs: "SOPs and sales docs",
    paste: "Paste text",
    upload: "Upload .pdf, .docx, .txt, or .md",
    shots: "Paste the conversation. Screenshots are not read.",
    transcript: "Top converting conversations",
    save: "Save intake",
    link: "Client link",
    revoke: "Revoke",
    build: "Build everything",
    building: "Building…",
    approve: "Approve drafts",
    review: "Review prompt draft",
    source: "Source",
    needs: "needs input",
    empty: "No client link yet. A link expires in 14 days and can be revoked."
  },
  es: {
    title: "Onboarding",
    body: "Reúne el material de este cliente y crea las secciones del negocio y el prompt del setter. Nada se publica hasta que lo apruebes.",
    checklist: "Lista",
    materials: "Materiales recibidos",
    drafted: "Prompt en borrador",
    tested: "Simulador probado",
    approved: "Aprobado",
    live: "En vivo",
    offer: "Oferta",
    price: "Precio",
    ideal: "Cliente ideal",
    booking: "Enlace de reserva",
    criteria: "Criterios de calificación",
    disqualifiers: "Descalificadores",
    docs: "SOPs y documentos de venta",
    paste: "Pegar texto",
    upload: "Sube .pdf, .docx, .txt o .md",
    shots: "Pega la conversación. Las capturas no se leen.",
    transcript: "Conversaciones que más convierten",
    save: "Guardar intake",
    link: "Enlace para el cliente",
    revoke: "Revocar",
    build: "Crear todo",
    building: "Creando…",
    approve: "Aprobar borradores",
    review: "Revisar borrador del prompt",
    source: "Fuente",
    needs: "falta información",
    empty: "Todavía no hay enlace. Caduca a los 14 días y se puede revocar."
  }
};

const STAGES = ["materials", "drafted", "tested", "approved", "live"];

function copyFor(ui) {
  return COPY[ui.language && ui.language() === "es" ? "es" : "en"];
}

export function renderOnboarding(ui) {
  const copy = copyFor(ui);
  const lang = ui.language && ui.language() === "es" ? "es" : "en";
  const card = ui.el("section", { class: "agent", id: "onboarding-intake" });
  const row = ui.state.onboarding || {};
  card.append(ui.el("h3", { text: copy.title }));
  card.append(ui.el("p", { text: copy.body }));
  card.append(checklist(ui, copy, row.status || ""));
  const form = ui.el("div", { class: "brief-grid" });
  const fields = {};
  [
    ["offer", copy.offer],
    ["price", copy.price],
    ["ideal", copy.ideal],
    ["booking_link", copy.booking],
    ["criteria", copy.criteria],
    ["disqualifiers", copy.disqualifiers]
  ].forEach(([key, label]) => {
    const input = key === "price" || key === "booking_link"
      ? ui.el("input", { type: "text", id: "intake-" + key, value: row[key] || "", "aria-label": label })
      : ui.el("textarea", { id: "intake-" + key, rows: "3", "aria-label": label });
    if (input.tagName === "TEXTAREA") input.value = row[key] || "";
    fields[key] = input;
    const wrap = ui.el("label", { text: label }, [input]);
    form.append(wrap);
  });
  card.append(form);
  const docs = ui.el("textarea", { id: "intake-docs", rows: "4", "aria-label": copy.docs, placeholder: copy.paste });
  card.append(ui.el("label", { text: copy.docs }, [docs]));
  card.append(ui.el("p", { class: "mute", text: copy.upload }));
  card.append(ui.el("p", { class: "mute", text: copy.shots }));
  const file = ui.el("input", { id: "intake-file", type: "file", accept: ".pdf,.docx,.txt,.md,text/plain" });
  card.append(file);
  const transcript = ui.el("textarea", { id: "intake-transcript", rows: "5", "aria-label": copy.transcript, placeholder: "Me: hey\nThem: hey" });
  card.append(ui.el("label", { text: copy.transcript }, [transcript]));
  if (ui.state.canEdit) {
    const actions = ui.el("div", { class: "filters" });
    actions.append(ui.button(copy.save, () => ui.saveOnboarding(read(fields), docs.value, transcript.value)));
    actions.append(ui.button(copy.link, () => ui.createOnboardingLink()));
    const build = ui.button(copy.build, async () => {
      build.disabled = true;
      build.textContent = copy.building;
      await ui.buildOnboarding(read(fields));
    });
    build.id = "build-everything";
    actions.append(build);
    card.append(actions);
  }
  const links = ui.state.onboardingLinks || [];
  if (!links.length) card.append(ui.el("p", { class: "mute", text: copy.empty }));
  links.forEach((link) => {
    const line = ui.el("p", { text: (link.revoked_at ? copy.revoke : copy.link) + " · " + (ui.when ? ui.when(link.expires_at) : "") });
    if (!link.revoked_at && ui.state.canEdit) line.append(ui.button(copy.revoke, () => ui.revokeOnboardingLink(link)));
    card.append(line);
  });
  const share = ui.state.onboardingShare;
  if (share) card.append(ui.el("p", { id: "onboarding-share", text: share }));
  const draft = ui.state.onboardingDraft;
  if (draft && draft.fields) card.append(draftCard(ui, copy, lang, draft));
  return card;
}

function read(fields) {
  const values = {};
  Object.keys(fields).forEach((key) => { values[key] = fields[key].value; });
  return values;
}

function checklist(ui, copy, status) {
  const list = ui.el("ol", { class: "intake-check", id: "onboarding-checklist" });
  const rank = ["", ...STAGES].indexOf(status);
  STAGES.forEach((stage, index) => {
    const done = rank > index;
    list.append(ui.el("li", { class: done ? "is-done" : "", text: (done ? "✓ " : "") + copy[stage] }));
  });
  return list;
}

function draftCard(ui, copy, lang, draft) {
  const card = ui.el("section", { class: "agent", id: "onboarding-draft" });
  card.append(ui.el("h3", { text: copy.title }));
  BRIEF_KEYS.forEach((key) => {
    const source = draft.sources && draft.sources[key] ? draft.sources[key] : copy.needs;
    const value = draft.fields[key] || copy.needs;
    card.append(ui.el("p", { text: briefHeading(key, lang) + " · " + copy.source + ": " + source }));
    card.append(ui.el("p", { text: value }));
  });
  if (ui.state.canEdit) {
    const row = ui.el("div", { class: "filters" });
    row.append(ui.button(copy.approve, () => ui.approveOnboarding()));
    row.append(ui.button(copy.review, () => ui.reviewOnboardingPrompt()));
    card.append(row);
  }
  return card;
}

export function previewOnboarding(params) {
  if (params.get("intake") !== "1" && params.get("built") !== "1") return {};
  const draft = params.get("built") === "1" ? {
    fields: {
      sell: "A bilingual growth system for real estate agents.",
      credibility: "needs input",
      who: "Latino real estate agents and loan officers.",
      pains: "needs input",
      desires: "needs input",
      beliefs: "needs input",
      current: "needs input",
      transformed: "needs input",
      problem: "needs input",
      offer: "Strategy session · needs input",
      service: "needs input",
      guarantee: "needs input",
      benefits: "needs input",
      differentiation: "needs input",
      mission: "needs input",
      results: "needs input",
      risks: "needs input"
    },
    sources: { sell: "sop", who: "form", offer: "form", credibility: "needs input" },
    prompt: "You are the setter. Short lines.\nDo not guarantee income or results.\nDo not invent results, clients, or numbers.\nStop when the person asks you to stop.\nShare the booking link only after the lead agrees to a call.",
    missing: ["credibility"]
  } : null;
  return {
    onboarding: {
      offer: "Strategy session",
      price: "",
      ideal: "Latino real estate agents and loan officers.",
      booking_link: "https://calendar.example/room",
      criteria: "They want more qualified buyers.",
      disqualifiers: "They asked to stop.",
      status: params.get("built") === "1" ? advanceStatus("materials", "drafted") : "materials"
    },
    onboardingMaterials: [{ id: "mat-1", name: "Sales notes", kind: "text" }],
    onboardingLinks: [],
    onboardingDraft: draft
  };
}
