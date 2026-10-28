// Winning conversations live on the SOPs page. Saving stores the paste.
// Building a prompt only opens a draft. It does not turn the setter on.

import { parseTranscript, swapSides } from "./winning-conversations.js";

const COPY = {
  en: {
    title: "Winning conversations",
    body: "Paste DM conversations that booked or closed. Roleflow can draft a setter prompt from them. The draft stays in Prompts until you save it.",
    raw: "Transcript",
    placeholder: "Me: hey\nThem: hey, what do you do?",
    preview: "Preview",
    swap: "Swap speakers",
    me: "Setter",
    them: "Lead",
    outcome: "Outcome",
    none: "No tag",
    booked: "Booked",
    closed: "Closed",
    notes: "Notes",
    save: "Save conversation",
    update: "Update conversation",
    cancel: "Cancel",
    empty: "No winning conversations yet.",
    edit: "Edit",
    remove: "Delete",
    build: "Build setter prompt from these",
    building: "Drafting…",
    missing: "Apply the winning conversations migration, then save."
  },
  es: {
    title: "Conversaciones que convirtieron",
    body: "Pega conversaciones de DM que terminaron en reserva o cierre. Roleflow puede redactar un prompt del setter a partir de ellas. El borrador se queda en Prompts hasta que lo guardes.",
    raw: "Transcripción",
    placeholder: "Yo: hey\nEllos: hey, a qué te dedicas?",
    preview: "Vista previa",
    swap: "Cambiar interlocutores",
    me: "Setter",
    them: "Lead",
    outcome: "Resultado",
    none: "Sin etiqueta",
    booked: "Reservó",
    closed: "Cerró",
    notes: "Notas",
    save: "Guardar conversación",
    update: "Actualizar conversación",
    cancel: "Cancelar",
    empty: "Todavía no hay conversaciones.",
    edit: "Editar",
    remove: "Eliminar",
    build: "Crear prompt del setter con estas",
    building: "Redactando…",
    missing: "Aplica la migración de conversaciones y luego guarda."
  }
};

function copyFor(ui) {
  return COPY[ui.language && ui.language() === "es" ? "es" : "en"];
}

export function renderWinningConversations(ui) {
  const copy = copyFor(ui);
  const card = ui.el("section", { class: "agent", id: "winning-conversations" });
  card.append(ui.el("h3", { text: copy.title }));
  card.append(ui.el("p", { text: copy.body }));
  if (ui.state.sectionErrors && ui.state.sectionErrors.winning) card.append(ui.el("p", { class: "claude-notice", text: copy.missing }));
  const editing = ui.state.winningEdit || null;
  const parsed = ui.state.winningParse || { messages: [], labeled: false };
  const raw = ui.el("textarea", {
    id: "winning-raw",
    rows: "8",
    maxlength: "20000",
    placeholder: copy.placeholder,
    "aria-label": copy.raw
  });
  raw.value = editing && editing.raw_text ? editing.raw_text : (ui.state.winningRaw || "");
  const notes = ui.el("textarea", { id: "winning-notes", rows: "2", maxlength: "1000", "aria-label": copy.notes });
  notes.value = editing && editing.notes ? editing.notes : "";
  const outcome = ui.el("select", { id: "winning-outcome", "aria-label": copy.outcome });
  [["", copy.none], ["booked", copy.booked], ["closed", copy.closed]].forEach(([value, label]) => {
    outcome.append(ui.el("option", { value, text: label }));
  });
  outcome.value = editing && editing.outcome ? editing.outcome : "";
  const preview = ui.el("div", { id: "winning-preview", class: "win-preview" });
  const paintPreview = () => {
    preview.replaceChildren();
    if (!parsed.messages.length) {
      preview.append(ui.el("p", { class: "mute", text: copy.preview }));
      return;
    }
    parsed.messages.forEach((row) => {
      const who = row.side === "me" ? copy.me : copy.them;
      preview.append(ui.el("p", { text: who + ": " + row.text }));
    });
  };
  const readParse = () => {
    const next = parseTranscript(raw.value);
    if (ui.state.winningSwapped) next.messages = swapSides(next.messages);
    ui.state.winningParse = next;
    parsed.messages = next.messages;
    parsed.labeled = next.labeled;
    paintPreview();
  };
  raw.addEventListener("input", () => {
    ui.state.winningRaw = raw.value;
    ui.state.winningSwapped = false;
    readParse();
  });
  readParse();
  const swap = ui.button(copy.swap, () => {
    ui.state.winningSwapped = !ui.state.winningSwapped;
    readParse();
  });
  card.append(ui.el("label", { text: copy.raw }, [raw]));
  card.append(swap, preview);
  card.append(ui.el("label", { text: copy.outcome }, [outcome]));
  card.append(ui.el("label", { text: copy.notes }, [notes]));
  if (ui.state.canEdit && ui.saveWinning) {
    card.append(ui.button(editing ? copy.update : copy.save, async () => {
      const messages = (ui.state.winningParse && ui.state.winningParse.messages) || parseTranscript(raw.value).messages;
      await ui.saveWinning({
        id: editing && editing.id,
        raw_text: raw.value,
        messages,
        outcome: outcome.value,
        notes: notes.value
      });
    }));
  }
  if (editing && ui.state.canEdit) {
    card.append(ui.button(copy.cancel, () => {
      ui.state.winningEdit = null;
      ui.state.winningRaw = "";
      ui.state.winningSwapped = false;
      ui.paint();
    }));
  }
  const list = ui.el("div", { class: "win-list" });
  const rows = ui.state.winningConversations || [];
  if (!rows.length) list.append(ui.el("p", { class: "mute", text: copy.empty }));
  rows.forEach((row) => {
    const item = ui.el("article", { class: "version-row" });
    const tag = row.outcome === "booked" ? copy.booked : row.outcome === "closed" ? copy.closed : copy.none;
    item.append(ui.el("strong", { text: tag }));
    item.append(ui.el("p", { text: String(row.raw_text || "").slice(0, 180) }));
    if (ui.state.canEdit) {
      const actions = ui.el("div", { class: "filters" });
      actions.append(ui.button(copy.edit, () => {
        ui.state.winningEdit = row;
        ui.state.winningRaw = row.raw_text || "";
        ui.state.winningSwapped = false;
        ui.paint();
      }));
      actions.append(ui.button(copy.remove, () => ui.deleteWinning(row)));
      item.append(actions);
    }
    list.append(item);
  });
  card.append(list);
  if (ui.state.canEdit && ui.buildWinningPrompt) {
    const build = ui.button(copy.build, async () => {
      build.disabled = true;
      build.textContent = copy.building;
      await ui.buildWinningPrompt();
    });
    build.id = "winning-build";
    card.append(build);
  }
  return card;
}
