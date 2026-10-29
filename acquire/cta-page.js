// CTAs: comment keywords on posts and reels, plus story keywords.
// A voice reply is a file recorded or uploaded here. Nothing on this page is sent.

import { ROLES } from "./model.js";
import { buttonError, keywordConflict } from "./comment-cta.js";
import { mountSendBadge } from "./send-badge.js";

const COPY = {
  en: {
    posts: "Posts and Reels",
    stories: "Stories",
    onComment: "On comment",
    auto: "Auto-reply to comments",
    autoHelp: "A public reply is picked at random from the lines below.",
    anyone: "Message privately even without a keyword match",
    anyoneHelp: "After the public reply, a private message can be prepared for anyone who comments.",
    replies: "Public replies",
    repliesHelp: "One short reply per line.",
    saveSettings: "Save comment settings",
    list: "Keywords",
    add: "Add keyword",
    edit: "Edit keyword",
    keyword: "Keyword",
    match: "Match",
    equals: "Equals",
    contains: "Contains",
    dm: "Private message brief",
    dmHelp: "This is the brief. The message is written from the commenter's profile. It is not one fixed line, and it is not sent from this page.",
    kind: "Private reply",
    text: "Text",
    voice: "Voice note",
    voiceHelp: "Record or upload an audio file. An AI-generated voice is not part of this screen.",
    record: "Record",
    stop: "Stop",
    upload: "Upload audio",
    buttonText: "Button text",
    buttonLink: "Button link",
    agent: "AI",
    anyAgent: "Business AI",
    scope: "Publication",
    anyPost: "Any post or reel",
    onePost: "One specific post or reel",
    publication: "Post or reel id",
    save: "Save keyword",
    cancel: "Cancel",
    remove: "Delete",
    empty: "No keywords yet.",
    held: "Sending is off. A match is held until this business turns DMs on.",
    storyTitle: "Story keywords",
    storyEmpty: "No story keywords yet.",
    storyKeyword: "Keyword",
    storyDo: "What should the AI do?",
    saveStory: "Save story keyword",
    columns: ["Keyword", "Match", "Posts", "Reply", "Button"]
  },
  es: {
    posts: "Publicaciones y Reels",
    stories: "Historias",
    onComment: "Al comentar",
    auto: "Responder comentarios en público",
    autoHelp: "La respuesta pública sale al azar de las líneas de abajo.",
    anyone: "Mensaje privado aunque no coincida la palabra",
    anyoneHelp: "Después de la respuesta pública se puede preparar un privado para quien comente.",
    replies: "Respuestas públicas",
    repliesHelp: "Una respuesta corta por línea.",
    saveSettings: "Guardar ajustes",
    list: "Palabras",
    add: "Añadir palabra",
    edit: "Editar palabra",
    keyword: "Palabra",
    match: "Coincidencia",
    equals: "Igual",
    contains: "Contiene",
    dm: "Brief del mensaje privado",
    dmHelp: "Esto es el brief. El mensaje se escribe con el perfil de quien comenta. No es una frase fija y esta página no lo envía.",
    kind: "Respuesta privada",
    text: "Texto",
    voice: "Nota de voz",
    voiceHelp: "Graba o sube un audio. Esta pantalla no genera la voz con IA.",
    record: "Grabar",
    stop: "Parar",
    upload: "Subir audio",
    buttonText: "Texto del botón",
    buttonLink: "Enlace del botón",
    agent: "IA",
    anyAgent: "IA del negocio",
    scope: "Publicación",
    anyPost: "Cualquier publicación o reel",
    onePost: "Una publicación o reel",
    publication: "Id de la publicación o reel",
    save: "Guardar palabra",
    cancel: "Cancelar",
    remove: "Eliminar",
    empty: "Todavía no hay palabras.",
    held: "El envío está apagado. Una coincidencia queda en espera hasta que este negocio active los DM.",
    storyTitle: "Palabras de historias",
    storyEmpty: "Todavía no hay palabras de historias.",
    storyKeyword: "Palabra",
    storyDo: "¿Qué debe hacer la IA?",
    saveStory: "Guardar palabra de historia",
    columns: ["Palabra", "Coincidencia", "Publicaciones", "Respuesta", "Botón"]
  }
};

function copyFor(ui) {
  return COPY[ui.language && ui.language() === "es" ? "es" : "en"];
}

function desk(ui) {
  if (!ui.state.ctaDesk) ui.state.ctaDesk = { tab: "posts", dialog: false, editing: "" };
  return ui.state.ctaDesk;
}

export function renderCtaPage(ui) {
  const copy = copyFor(ui);
  const wrap = ui.el("div", { class: "studio cta-page" });
  const header = ui.pageHeader
    ? ui.pageHeader(ui, "CTAs", copy.held, "ctas", "comment")
    : ui.el("h2", { text: "CTAs" });
  mountSendBadge(header, ui);
  wrap.append(header);
  const tabs = ui.el("div", { class: "cta-tabs", role: "tablist" });
  [["posts", copy.posts], ["stories", copy.stories]].forEach(([id, label]) => {
    const button = ui.el("button", { type: "button", "aria-pressed": desk(ui).tab === id ? "true" : "false" }, [label]);
    button.addEventListener("click", () => { desk(ui).tab = id; ui.paint(); });
    tabs.append(button);
  });
  wrap.append(tabs);
  wrap.append(desk(ui).tab === "stories" ? stories(ui, copy) : posts(ui, copy));
  return wrap;
}

function posts(ui, copy) {
  const host = ui.el("div", { class: "cta-stack" });
  host.append(settingsCard(ui, copy));
  host.append(keywordTable(ui, copy));
  if (desk(ui).dialog) host.append(keywordDialog(ui, copy));
  return host;
}

function settingsCard(ui, copy) {
  const settings = ui.state.commentSettings || {};
  const card = ui.el("section", { class: "agent cta-card" });
  card.append(ui.el("h3", { text: copy.onComment }));
  const auto = check(ui, copy.auto, settings.auto_reply === true);
  const anyone = check(ui, copy.anyone, settings.dm_without_keyword === true);
  card.append(auto.label, ui.el("p", { class: "mute", text: copy.autoHelp }));
  card.append(anyone.label, ui.el("p", { class: "mute", text: copy.anyoneHelp }));
  const replies = ui.el("textarea", { id: "cta-public-replies", rows: "4", "aria-label": copy.replies });
  replies.value = (settings.public_replies || []).join("\n");
  card.append(ui.el("h3", { text: copy.replies }));
  card.append(ui.el("p", { class: "mute", text: copy.repliesHelp }));
  card.append(replies);
  if (ui.state.canEdit) {
    card.append(ui.button(copy.saveSettings, () => ui.saveCommentSettings({
      auto_reply: auto.input.checked,
      dm_without_keyword: anyone.input.checked,
      public_replies: replies.value.split("\n").map((line) => line.trim()).filter(Boolean)
    })));
  }
  return card;
}

function keywordTable(ui, copy) {
  const card = ui.el("section", { class: "agent cta-card" });
  const headRow = ui.el("div", { class: "cta-list-head" });
  headRow.append(ui.el("h3", { text: copy.list }));
  if (ui.state.canEdit) {
    const add = ui.button(copy.add, () => { desk(ui).dialog = true; desk(ui).editing = ""; ui.paint(); });
    add.id = "cta-add-keyword";
    headRow.append(add);
  }
  card.append(headRow);
  const rows = ui.state.commentCtas || [];
  if (!rows.length) {
    card.append(ui.el("p", { text: copy.empty }));
    return card;
  }
  const table = ui.el("table", { class: "cta-table" });
  const head = ui.el("tr");
  copy.columns.forEach((label) => head.append(ui.el("th", { text: label })));
  head.append(ui.el("th", { text: "" }));
  table.append(ui.el("thead", {}, [head]));
  const body = ui.el("tbody");
  rows.forEach((row) => {
    const line = ui.el("tr");
    const posts = row.scope === "post" ? (row.publication_ref || copy.onePost) : copy.anyPost;
    const reply = row.reply_kind === "voice" ? copy.voice : copy.text;
    line.append(
      ui.el("td", { text: row.keyword || "" }),
      ui.el("td", { text: row.match_mode === "equals" ? copy.equals : copy.contains }),
      ui.el("td", { text: posts }),
      ui.el("td", { text: reply }),
      ui.el("td", { text: row.button_label || "—" })
    );
    const actions = ui.el("td");
    if (ui.state.canEdit) {
      const bar = ui.el("div", { class: "cta-actions" });
      bar.append(ui.button(copy.edit, () => { desk(ui).dialog = true; desk(ui).editing = row.id; ui.paint(); }));
      const remove = ui.button(copy.remove, () => ui.deleteFlowRow("acq_comment_ctas", row.id));
      remove.classList.add("cta-danger");
      bar.append(remove);
      actions.append(bar);
    }
    line.append(actions);
    body.append(line);
  });
  table.append(body);
  card.append(ui.el("div", { class: "table-wrap" }, [table]));
  return card;
}

function keywordDialog(ui, copy) {
  const shell = ui.el("div", { class: "cta-dialog" });
  const backdrop = ui.el("button", { type: "button", class: "cta-dialog-backdrop", "aria-label": copy.cancel });
  const close = () => { desk(ui).dialog = false; desk(ui).editing = ""; ui.paint(); };
  backdrop.addEventListener("click", close);
  const form = keywordForm(ui, copy, close);
  form.classList.add("cta-dialog-card");
  form.setAttribute("role", "dialog");
  form.setAttribute("aria-modal", "true");
  form.id = "cta-keyword-dialog";
  shell.append(backdrop, form);
  return shell;
}

function keywordForm(ui, copy, close) {
  const editing = (ui.state.commentCtas || []).find((row) => row.id === desk(ui).editing) || null;
  const form = ui.el("form", { class: "agent cta-card", id: "cta-keyword-form" });
  form.append(ui.el("h3", { text: editing ? copy.edit : copy.add }));
  const keyword = ui.field(copy.keyword, editing ? editing.keyword : "");
  const mode = select(ui, copy.match, [["contains", copy.contains], ["equals", copy.equals]], editing ? editing.match_mode : "contains");
  const dm = ui.el("textarea", { id: "cta-dm", rows: "4", "aria-label": copy.dm });
  dm.value = editing ? editing.dm_text || "" : "";
  const kind = select(ui, copy.kind, [["text", copy.text], ["voice", copy.voice]], editing && editing.reply_kind === "voice" ? "voice" : "text");
  const voice = voiceField(ui, copy, editing);
  const libraryNotes = (ui.state.voices || []).filter((note) => note && !note.deleted_at && note.storage_path);
  const library = select(ui, "Library note", [["", "No library note / custom file"]].concat(libraryNotes.map((note) => [note.id, note.title || "Voice note"])), editing && editing.voice_note_id || "");
  const voiceHelp = ui.el("p", { class: "mute", text: copy.voiceHelp });
  const syncVoice = () => {
    const on = kind.value === "voice";
    const picked = Boolean(library.value);
    voice.hidden = !on;
    libraryLabel.hidden = !on;
    voiceHelp.hidden = !on || picked;
    if (voice.custom) voice.custom.hidden = !on || picked;
    if (voice.preview) voice.preview.hidden = !on || !picked;
  };
  library.addEventListener("change", () => {
    const note = libraryNotes.find((item) => item.id === library.value);
    voice.libraryId = note ? note.id : "";
    voice.path = note ? note.storage_path : "";
    voice.mime = note ? note.mime_type || "audio/wav" : "";
    if (voice.preview) {
      if (note && ui.signAudio) ui.signAudio(note.storage_path).then((url) => { if (url) voice.preview.src = url; });
      if (!note) voice.preview.removeAttribute("src");
    }
    syncVoice();
  });
  const buttonText = ui.field(copy.buttonText, editing ? editing.button_label || "" : "");
  const buttonLink = ui.field(copy.buttonLink, editing ? editing.button_url || "" : "");
  const agent = select(ui, copy.agent, [["", copy.anyAgent]].concat(ROLES.map((role) => [role.id, role.name])), editing ? editing.agent_role || "" : "");
  const scope = select(ui, copy.scope, [["any", copy.anyPost], ["post", copy.onePost]], editing && editing.scope === "post" ? "post" : "any");
  const publication = ui.field(copy.publication, editing ? editing.publication_ref || "" : "");
  publication.label.classList.add("cta-publication");
  const libraryLabel = labeled(ui, "Library note", library);
  const showPublication = () => { publication.label.hidden = scope.value !== "post"; };
  kind.addEventListener("change", syncVoice);
  scope.addEventListener("change", showPublication);
  syncVoice();
  showPublication();
  if (library.value) library.dispatchEvent(new Event("change"));
  form.append(keyword.label, labeled(ui, copy.match, mode), labeled(ui, copy.dm, dm), ui.el("p", { class: "mute", text: copy.dmHelp }));
  libraryLabel.classList.add("voice-choice");
  form.append(labeled(ui, copy.kind, kind), voiceHelp, libraryLabel, voice);
  form.append(buttonText.label, buttonLink.label, labeled(ui, copy.agent, agent), labeled(ui, copy.scope, scope), publication.label);
  const save = ui.button(copy.save, async (event) => {
    event.preventDefault();
    const next = {
      id: editing ? editing.id : "",
      keyword: keyword.input.value.trim(),
      match_mode: mode.value,
      dm_text: dm.value.trim(),
      reply_kind: kind.value,
      voice_path: voice.path || (editing && editing.voice_path) || "",
      voice_mime: voice.mime || (editing && editing.voice_mime) || "",
      voice_note_id: voice.libraryId || (editing && editing.voice_note_id) || null,
      button_label: buttonText.input.value.trim(),
      button_url: buttonLink.input.value.trim(),
      agent_role: agent.value,
      scope: scope.value,
      publication_ref: scope.value === "post" ? publication.input.value.trim() : "",
      reply_to_comments: false,
      dm_anyone: false,
      public_replies: []
    };
    const conflict = keywordConflict(ui.state.commentCtas || [], next);
    if (conflict) return ui.toast(conflict, "bad");
    const button = buttonError(next.button_label, next.button_url);
    if (button) return ui.toast(button, "bad");
    if (next.reply_kind === "voice" && !next.voice_path && voice.file) {
      const stored = await ui.storeCtaVoice(voice.file);
      if (!stored) return;
      next.voice_path = stored.path;
      next.voice_mime = stored.mime;
    }
    if (next.reply_kind === "voice" && !next.voice_path) return ui.toast(copy.voiceHelp, "bad");
    desk(ui).dialog = false;
    desk(ui).editing = "";
    await ui.saveCommentCta(next);
  });
  const cancel = ui.button(copy.cancel, close);
  cancel.classList.add("cta-secondary");
  const row = ui.el("div", { class: "cta-dialog-actions" });
  row.append(save, cancel);
  form.append(row);
  form.addEventListener("submit", (event) => event.preventDefault());
  return form;
}

function voiceField(ui, copy, editing) {
  const box = ui.el("div", { class: "cta-voice" });
  const custom = ui.el("div", { class: "cta-voice-custom" });
  const file = ui.el("input", { type: "file", accept: "audio/*", class: "cta-file", "aria-label": copy.upload });
  const upload = ui.el("button", { type: "button", class: "cta-upload" }, [copy.upload]);
  upload.addEventListener("click", () => file.click());
  const status = ui.el("p", { class: "mute", text: editing && editing.voice_path ? editing.voice_path.split("/").pop() : "" });
  const player = ui.el("audio", { class: "cta-audio", controls: "controls" });
  player.hidden = true;
  const picked = ui.el("audio", { class: "cta-audio", controls: "controls" });
  picked.hidden = true;
  box.custom = custom;
  box.preview = picked;
  box.file = null;
  box.mime = "";
  const showFile = (picked) => {
    if (picked.size > 20 * 1024 * 1024) {
      ui.toast("Audio is 20 MB at most.", "bad");
      file.value = "";
      return;
    }
    box.file = picked;
    box.mime = picked.type || "audio/webm";
    status.textContent = picked.name;
    player.src = URL.createObjectURL(picked);
    player.hidden = false;
  };
  file.addEventListener("change", () => {
    const picked = file.files && file.files[0];
    if (picked) showFile(picked);
  });
  const record = ui.el("button", { type: "button", class: "cta-record" }, [copy.record]);
  let recorder = null;
  let chunks = [];
  record.addEventListener("click", async () => {
    if (recorder && recorder.state === "recording") {
      recorder.stop();
      record.textContent = copy.record;
      return;
    }
    if (!navigator.mediaDevices || !window.MediaRecorder) return ui.toast(copy.upload, "bad");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.addEventListener("dataavailable", (event) => { if (event.data && event.data.size) chunks.push(event.data); });
    recorder.addEventListener("stop", () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      showFile(new File([blob], "cta-voice.webm", { type: blob.type }));
    });
    recorder.start();
    record.textContent = copy.stop;
  });
  custom.append(file, upload, record);
  box.append(custom, status, player, picked);
  return box;
}

function stories(ui, copy) {
  const card = ui.el("section", { class: "agent cta-card" });
  card.append(ui.el("h3", { text: copy.storyTitle }));
  const rows = ui.state.storyCtas || [];
  if (!rows.length) card.append(ui.el("p", { text: copy.storyEmpty }));
  rows.forEach((row) => {
    const line = ui.el("article", { class: "cta-story" });
    line.append(ui.el("strong", { text: row.keyword || "" }));
    if (row.agent_role) line.append(ui.el("p", { text: row.agent_role }));
    if (row.extra_instructions) line.append(ui.el("p", { text: row.extra_instructions }));
    if (ui.state.canEdit) line.append(ui.button(copy.remove, () => ui.deleteFlowRow("acq_story_ctas", row.id)));
    card.append(line);
  });
  if (!ui.state.canEdit) return card;
  const keyword = ui.field(copy.storyKeyword, "");
  const agent = select(ui, copy.agent, [["", copy.anyAgent]].concat(ROLES.map((role) => [role.id, role.name])), "");
  const extra = ui.el("textarea", { rows: "3", "aria-label": copy.storyDo });
  card.append(keyword.label, labeled(ui, copy.agent, agent), labeled(ui, copy.storyDo, extra));
  card.append(ui.button(copy.saveStory, (event) => {
    event.preventDefault();
    if (!keyword.input.value.trim()) return ui.toast(copy.keyword, "bad");
    ui.saveStoryCta({ keyword: keyword.input.value.trim(), agent_role: agent.value, extra_instructions: extra.value.trim() });
  }));
  return card;
}

function check(ui, label, checked) {
  const input = ui.el("input", { type: "checkbox" });
  input.checked = checked === true;
  const wrap = ui.el("label", { class: "switch", text: " " + label });
  wrap.prepend(input);
  return { label: wrap, input };
}

function select(ui, label, options, value) {
  const node = ui.el("select", { "aria-label": label });
  options.forEach(([id, text]) => node.append(ui.el("option", { value: id, text })));
  node.value = value || "";
  return node;
}

function labeled(ui, name, node) {
  const label = ui.el("label");
  label.append(ui.el("span", { text: name }), node);
  return label;
}
