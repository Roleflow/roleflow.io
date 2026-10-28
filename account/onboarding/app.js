// Public onboarding form. The token scopes it to one business.
// Screenshots are not read. Paste the conversation instead.

import { getSupabase, isConfigured } from "../../auth/supabase.js";
import { parseTranscript } from "../../acquire/winning-conversations.js";

const COPY = {
  en: {
    title: "Onboarding",
    body: "Tell Roleflow about the offer and paste the conversations that booked or closed. Screenshots are not read.",
    offer: "Offer",
    price: "Price",
    ideal: "Ideal client",
    booking: "Booking link",
    criteria: "Qualifying criteria",
    disqualifiers: "Disqualifiers",
    docs: "SOPs and sales docs",
    transcript: "Top converting conversations",
    upload: "Upload .pdf, .docx, .txt, or .md",
    save: "Send to Roleflow",
    saved: "Saved. Roleflow will turn this into a draft. It is not live.",
    invalid: "This link is not valid.",
    preview: "Preview link. Nothing is sent."
  },
  es: {
    title: "Onboarding",
    body: "Cuéntale a Roleflow la oferta y pega las conversaciones que reservaron o cerraron. Las capturas no se leen.",
    offer: "Oferta",
    price: "Precio",
    ideal: "Cliente ideal",
    booking: "Enlace de reserva",
    criteria: "Criterios de calificación",
    disqualifiers: "Descalificadores",
    docs: "SOPs y documentos de venta",
    transcript: "Conversaciones que más convierten",
    upload: "Sube .pdf, .docx, .txt o .md",
    save: "Enviar a Roleflow",
    saved: "Guardado. Roleflow lo convertirá en un borrador. No está en vivo.",
    invalid: "Este enlace no es válido.",
    preview: "Enlace de vista previa. No se envía nada."
  }
};

const params = new URLSearchParams(location.search);
const lang = params.get("lang") === "es" ? "es" : "en";
const copy = COPY[lang];
const root = document.getElementById("intake-app");

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  });
  (children || []).forEach((child) => node.append(child.nodeType ? child : document.createTextNode(String(child))));
  return node;
}

function field(key, label, value, area) {
  const input = area ? el("textarea", { id: key, rows: "4" }) : el("input", { id: key, type: "text" });
  input.value = value || "";
  return el("label", { text: label }, [input]);
}

function paint(data, note) {
  root.replaceChildren();
  const card = el("section", { class: "agent", id: "client-intake" });
  card.append(el("p", { class: "side-kicker", text: "Roleflow" }));
  card.append(el("h1", { text: copy.title }));
  card.append(el("p", { text: copy.body }));
  if (note) card.append(el("p", { id: "intake-note", role: "status", text: note }));
  const form = el("form", { id: "client-intake-form" });
  form.append(field("offer", copy.offer, data.offer, true));
  form.append(field("price", copy.price, data.price, false));
  form.append(field("ideal", copy.ideal, data.ideal, true));
  form.append(field("booking_link", copy.booking, data.booking_link, false));
  form.append(field("criteria", copy.criteria, data.criteria, true));
  form.append(field("disqualifiers", copy.disqualifiers, data.disqualifiers, true));
  form.append(field("material", copy.docs, "", true));
  form.append(el("p", { class: "mute", text: copy.upload }));
  form.append(el("input", { id: "intake-file", type: "file", accept: ".pdf,.docx,.txt,.md,text/plain" }));
  form.append(field("transcript", copy.transcript, "", true));
  const preview = el("div", { id: "client-transcript-preview" });
  form.querySelector("#transcript").addEventListener("input", (event) => {
    preview.replaceChildren();
    parseTranscript(event.target.value).messages.forEach((row) => {
      preview.append(el("p", { text: (row.side === "me" ? "Setter" : "Lead") + ": " + row.text }));
    });
  });
  form.append(preview);
  form.append(el("button", { type: "submit", class: "btn", text: copy.save }));
  form.addEventListener("submit", (event) => submit(event, form));
  card.append(form);
  root.append(card);
}

async function submit(event, form) {
  event.preventDefault();
  const note = document.getElementById("intake-note");
  if (params.get("preview") === "1") {
    if (note) note.textContent = copy.preview;
    else paint({}, copy.preview);
    return;
  }
  if (!isConfigured()) return;
  const token = params.get("token") || "";
  const body = {
    token,
    action: "save",
    offer: form.offer.value,
    price: form.price.value,
    ideal: form.ideal.value,
    booking_link: form.booking_link.value,
    criteria: form.criteria.value,
    disqualifiers: form.disqualifiers.value,
    material: form.material.value,
    transcript: form.transcript.value
  };
  const supabase = getSupabase();
  const saved = await supabase.functions.invoke("onboarding-link", { body });
  const payload = saved.data || {};
  if (saved.error || payload.ok === false) {
    paint(body, (payload && payload.error) || copy.invalid);
    return;
  }
  const file = form.querySelector("#intake-file").files[0];
  if (file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    bytes.forEach((part) => { binary += String.fromCharCode(part); });
    await supabase.functions.invoke("onboarding-link", { body: { token, action: "upload", name: file.name, data: btoa(binary) } });
  }
  paint(payload, copy.saved);
}

if (params.get("preview") === "1") {
  paint({
    offer: "Strategy session",
    price: "",
    ideal: "Latino real estate agents and loan officers.",
    booking_link: "https://calendar.example/room",
    criteria: "They want more qualified buyers.",
    disqualifiers: "They asked to stop."
  }, copy.preview);
} else if (!params.get("token")) {
  paint({}, copy.invalid);
} else if (isConfigured()) {
  getSupabase().functions.invoke("onboarding-link", { body: { token: params.get("token"), action: "load" } }).then((result) => {
    const payload = result.data || {};
    paint(payload.ok === false ? {} : payload, payload.ok === false ? payload.error : "");
  });
} else paint({}, copy.invalid);
