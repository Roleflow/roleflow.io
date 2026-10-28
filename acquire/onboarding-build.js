// Turns a client's materials into draft business sections and a setter prompt.
// Drafts stay drafts until someone approves them. Nothing here turns a setter on.

import { STANDING_RULES, stripPii, transcriptsForModel } from "./winning-conversations.js";

export const BRIEF_KEYS = [
  "sell", "credibility", "who", "pains", "desires", "beliefs", "current",
  "transformed", "problem", "offer", "service", "guarantee", "benefits",
  "differentiation", "mission", "results", "risks"
];

export const STAGE_ORDER = ["", "materials", "drafted", "tested", "approved", "live"];

const FORM_SOURCES = {
  sell: ["offer"],
  offer: ["offer", "price"],
  who: ["ideal"],
  pains: ["criteria"],
  desires: ["criteria"],
  beliefs: ["disqualifiers"],
  current: ["ideal"],
  service: ["offer"],
  risks: ["disqualifiers"]
};

export function advanceStatus(current, next) {
  const from = STAGE_ORDER.indexOf(current || "");
  const to = STAGE_ORDER.indexOf(next || "");
  if (to < 0) return current || "";
  return to > from ? next : (current || "");
}

export function gridStageLabel(stage, language) {
  const labels = {
    materials: ["Materials received", "Materiales recibidos"],
    drafted: ["Prompt drafted", "Prompt en borrador"],
    tested: ["Simulator tested", "Simulador probado"],
    approved: ["Approved", "Aprobado"]
  };
  const row = labels[stage];
  if (!row) return language === "es" ? "IA activa" : "AI active";
  return language === "es" ? row[1] : row[0];
}

export async function hashToken(token) {
  const bytes = new TextEncoder().encode(String(token || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((part) => part.toString(16).padStart(2, "0")).join("");
}

export function scopeToken(record, now) {
  if (!record || !record.business_id) return { ok: false, reason: "missing" };
  if (record.revoked_at) return { ok: false, reason: "revoked" };
  const expires = Date.parse(record.expires_at || "");
  if (!Number.isFinite(expires) || expires <= Number(now)) return { ok: false, reason: "expired" };
  return { ok: true, business_id: String(record.business_id) };
}

export function publicIntakeView(row, materials) {
  const source = row && typeof row === "object" ? row : {};
  const files = (Array.isArray(materials) ? materials : []).map((item) => ({
    id: item && item.id ? String(item.id) : "",
    name: item && item.name ? String(item.name).slice(0, 180) : "",
    kind: item && item.kind ? String(item.kind).slice(0, 40) : "text"
  }));
  return {
    ok: true,
    offer: String(source.offer || ""),
    price: String(source.price || ""),
    ideal: String(source.ideal || ""),
    booking_link: String(source.booking_link || ""),
    criteria: String(source.criteria || ""),
    disqualifiers: String(source.disqualifiers || ""),
    status: STAGE_ORDER.includes(source.status) ? source.status : "",
    materials: files
  };
}

export function textFromDocxXml(xml) {
  return String(xml || "")
    .replace(/<w:p[^>]*>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function textFromPdf(bytes) {
  const raw = typeof bytes === "string" ? bytes : new TextDecoder("latin1").decode(bytes);
  const parts = [];
  const pattern = /\((?:\\\)|[^)]){2,}\)\s*Tj/g;
  let match = pattern.exec(raw);
  while (match) {
    parts.push(match[0].slice(1, match[0].lastIndexOf(")")).replace(/\\n/g, "\n").replace(/\\(.)/g, "$1"));
    match = pattern.exec(raw);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function textFromUpload(name, bytes) {
  const file = String(name || "").toLowerCase();
  if (/\.(png|jpe?g|webp|gif)$/.test(file)) return { text: "", note: "screenshot" };
  const raw = typeof bytes === "string" ? bytes : new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (file.endsWith(".pdf")) return { text: textFromPdf(bytes), note: "" };
  if (file.endsWith(".xml")) return { text: textFromDocxXml(raw), note: "" };
  return { text: raw.replace(/\u0000/g, "").trim(), note: "" };
}

function formValue(form, keys) {
  return (keys || []).map((key) => String(form && form[key] || "").trim()).filter(Boolean).join("\n");
}

export function intakeBundle({ form, materials, conversations }) {
  const packed = transcriptsForModel(conversations || []);
  const names = [];
  (conversations || []).forEach((row) => {
    (row && row.messages || []).forEach((item) => { if (item && item.label) names.push(item.label); });
  });
  const materialText = (materials || []).map((item) => stripPii(item && (item.text || item.body) || "", names)).filter(Boolean).join("\n\n");
  const conversationText = packed.map((row) => row.lines.join("\n")).join("\n\n");
  return {
    form: {
      offer: String(form && form.offer || ""),
      price: String(form && form.price || ""),
      ideal: String(form && form.ideal || ""),
      booking: String(form && (form.booking_link || form.booking) || ""),
      criteria: String(form && form.criteria || ""),
      disqualifiers: String(form && form.disqualifiers || "")
    },
    materials: materialText,
    conversations: conversationText
  };
}

export function buildInstruction(bundle) {
  const source = bundle || { form: {}, materials: "", conversations: "" };
  return [
    "Fill the business sections and draft a setter system prompt.",
    "Use only the materials, the form, and the conversations below.",
    "If a section is not supported by those sources, set its value to \"needs input\" and its source to \"needs input\".",
    "Do not invent prices, results, clients, or guarantees.",
    "Keep these rules word for word inside the prompt:",
    STANDING_RULES.join("\n"),
    "Return JSON: {\"fields\": {brief keys}, \"sources\": {key: \"sop\"|\"form\"|\"conversation\"|\"needs input\"}, \"prompt\": string }.",
    "Brief keys: " + BRIEF_KEYS.join(", "),
    "Form:\n" + JSON.stringify(source.form || {}),
    "SOPs and sales docs:\n" + (source.materials || "(none)"),
    "Winning conversations, already stripped:\n" + (source.conversations || "(none)")
  ].join("\n\n");
}

export function normalizeDraft(model, bundle) {
  const parsed = model && typeof model === "object" ? model : {};
  const modelFields = parsed.fields && typeof parsed.fields === "object" ? parsed.fields : {};
  const modelSources = parsed.sources && typeof parsed.sources === "object" ? parsed.sources : {};
  const source = bundle || { form: {}, materials: "", conversations: "" };
  const fields = {};
  const sources = {};
  BRIEF_KEYS.forEach((key) => {
    const claimed = String(modelSources[key] || "");
    const value = String(modelFields[key] || "").trim();
    const backed = (claimed === "sop" && source.materials)
      || (claimed === "conversation" && source.conversations)
      || (claimed === "form" && formValue(source.form, FORM_SOURCES[key] || []));
    if (value && value.toLowerCase() !== "needs input" && backed) {
      fields[key] = value.slice(0, 4000);
      sources[key] = claimed;
      return;
    }
    const fallback = formValue(source.form, FORM_SOURCES[key] || []);
    if (fallback) {
      fields[key] = fallback.slice(0, 4000);
      sources[key] = "form";
      return;
    }
    fields[key] = "needs input";
    sources[key] = "needs input";
  });
  const prompt = String(parsed.prompt || "").trim();
  const safePrompt = prompt && (source.materials || source.conversations || formValue(source.form, ["offer", "ideal", "criteria"]))
    ? prompt.slice(0, 80000)
    : [
      "You are the setter for this business. Use short messages and one question at a time.",
      STANDING_RULES.join("\n"),
      source.conversations ? "Examples:\n" + source.conversations.slice(0, 2000) : "Examples: needs input"
    ].join("\n\n");
  return {
    fields,
    sources,
    prompt: safePrompt,
    missing: BRIEF_KEYS.filter((key) => fields[key] === "needs input")
  };
}
