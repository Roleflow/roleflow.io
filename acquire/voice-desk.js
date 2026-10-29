// Voice Gen library. A name is either a SOP step or one person.

import { SUGGESTED_STEPS, usedCounts, workflowSteps } from "./voice-route.js";
import { prepareVoiceNote, recorderStartOptions, VOICE_MAX_BYTES, VOICE_MAX_MS, voiceError } from "./voice-audio.js";
import { mountSendBadge } from "./send-badge.js";

export function renderVoiceDesk(ui) {
  const es = ui.language && ui.language() === "es";
  const wrap = ui.el("div", { class: "studio voice-desk" });
  const header = ui.pageHeader
    ? ui.pageHeader(ui, "Voice Gen", es
      ? "Grabas la nota y le pones nombre. El setter la envía en ese paso o solo a esa persona."
      : "Record a note and name it. The setter sends it at that step, or only to that person.", "voice", "send")
    : ui.el("h2", { text: "Voice Gen" });
  mountSendBadge(header, ui);
  wrap.append(header);
  wrap.append(ui.el("section", { class: "banner gold" }, [
    ui.el("p", { text: es
      ? "Nada se envía mientras los DM están apagados."
      : "Nothing is sent while DMs are off." })
  ]));
  if (ui.state.canEdit) wrap.append(recorder(ui, es));
  wrap.append(library(ui, es));
  return wrap;
}

function library(ui, es) {
  const counts = usedCounts(ui.state.voiceSends);
  const notes = (ui.state.voices || []).filter((note) => !note.deleted_at);
  const grid = ui.el("div", { class: "agents" });
  if (!notes.length) grid.append(ui.el("p", { class: "mute", text: es ? "Todavía no hay notas." : "No voice notes yet." }));
  notes.forEach((note) => grid.append(card(ui, note, counts[note.id] || 0, es)));
  return grid;
}

function card(ui, note, used, es) {
  const node = ui.el("article", { class: "voice-card" });
  node.append(ui.el("h3", { text: note.title || (es ? "Sin nombre" : "Untitled") }));
  node.append(ui.el("p", { text: assignmentLabel(note, es) }));
  const when = note.created_at ? new Date(note.created_at).toLocaleDateString() : "—";
  const seconds = note.duration_ms ? Math.round(note.duration_ms / 1000) + "s" : "—";
  const usedWord = es ? (used === 1 ? "vez" : "veces") : (used === 1 ? "time" : "times");
  node.append(ui.el("p", { class: "mute", text: seconds + " · " + when + " · " + (es ? "usada " : "used ") + used + " " + usedWord }));
  const steps = workflowSteps(ui.state.sopWorkflow || "");
  if (note.assignment_kind === "step" && note.step_name && !steps.some((step) => step.toLowerCase() === String(note.step_name).toLowerCase())) {
    node.append(ui.el("p", { class: "step-warn", text: es ? "Paso que no está en el SOP" : "Step not in SOP" }));
  }
  const audio = ui.el("audio", { controls: true, preload: "none" });
  node.append(audio);
  if (ui.signAudio && note.storage_path) ui.signAudio(note.storage_path).then((url) => { if (url) audio.src = url; });
  if (!ui.state.canEdit) return node;
  const name = ui.field(es ? "Nombre" : "Name", note.title || "");
  const tools = ui.el("div", { class: "voice-card-actions" });
  const rename = ui.button(es ? "Renombrar" : "Rename", () => ui.renameVoice(note, name.input.value));
  const again = ui.button(es ? "Volver a grabar" : "Re-record", () => ui.rerecordVoice(note));
  rename.classList.add("cta-secondary");
  again.classList.add("cta-secondary");
  const remove = ui.button(es ? "Eliminar" : "Delete", () => ui.deleteVoice(note));
  remove.classList.add("cta-danger");
  tools.append(rename, again, remove);
  node.append(name.label, tools);
  return node;
}

function assignmentLabel(note, es) {
  if (note.assignment_kind === "person" && note.lead_handle) return (es ? "Solo para @" : "Only @") + String(note.lead_handle).replace(/^@/, "");
  if (note.assignment_kind === "step" && note.step_name) return (es ? "Paso: " : "Step: ") + note.step_name;
  return es ? "Sin asignar" : "Unassigned";
}

function recorder(ui, es) {
  const form = ui.el("form", { class: "agent", id: "voice-recorder" });
  form.append(ui.el("h3", { text: es ? "Nueva nota" : "New note" }));
  form.append(ui.el("p", { class: "mute", text: es ? "Máximo 60 segundos." : "60 seconds max." }));
  const title = ui.field(es ? "Nombre" : "Name", "");
  const kind = ui.el("select", { "aria-label": es ? "Tipo de nombre" : "Name kind" });
  [["none", es ? "Sin asignar" : "Unassigned"], ["step", es ? "Paso del SOP" : "SOP step"], ["person", es ? "Una persona" : "One person"]].forEach(([value, label]) => {
    kind.append(ui.el("option", { value, text: label }));
  });
  const steps = workflowSteps(ui.state.sopWorkflow || "");
  const stepNames = steps.length ? steps : SUGGESTED_STEPS;
  const step = ui.el("select", { "aria-label": es ? "Paso" : "Step" });
  stepNames.forEach((name) => step.append(ui.el("option", { value: name, text: name })));
  const stepLabel = labeled(ui, es ? "Paso" : "Step", step);
  stepLabel.classList.add("voice-choice");
  if (!steps.length) stepLabel.append(ui.el("span", { class: "mute", text: es ? "Estos nombres aún no están en el SOP." : "These names are not in the SOP yet." }));
  const leads = (ui.collectLeads ? ui.collectLeads(ui.state.contacts, ui.state.targets) : []).filter((lead) => lead.handle);
  const person = ui.el("select", { "aria-label": es ? "Persona" : "Person" });
  if (!leads.length) person.append(ui.el("option", { value: "", text: es ? "Nadie guardado" : "No saved leads" }));
  leads.forEach((lead) => person.append(ui.el("option", { value: lead.handle, text: (lead.name ? lead.name + " · " : "") + "@" + lead.handle })));
  const personLabel = labeled(ui, es ? "Persona" : "Person", person);
  personLabel.classList.add("voice-choice");
  const sync = () => {
    stepLabel.hidden = kind.value !== "step";
    personLabel.hidden = kind.value !== "person";
  };
  kind.addEventListener("change", sync);
  sync();
  const status = ui.el("p", { class: "mute", text: "" });
  const timer = ui.el("p", { class: "rec-timer" });
  timer.hidden = true;
  const player = ui.el("audio", { controls: true, class: "cta-audio" });
  player.hidden = true;
  const file = ui.el("input", { type: "file", accept: "audio/*", class: "cta-file", "aria-label": es ? "Subir audio" : "Upload audio" });
  const upload = ui.el("button", { type: "button", class: "cta-upload" }, [es ? "Subir" : "Upload"]);
  upload.addEventListener("click", () => file.click());
  const record = ui.el("button", { type: "button", class: "cta-record" }, [es ? "Grabar" : "Record"]);
  const retake = ui.el("button", { type: "button", class: "cta-secondary" }, [es ? "Repetir" : "Re-take"]);
  retake.hidden = true;
  let held = null;
  let recorder = null;
  let stream = null;
  let clock = 0;
  let saveBtn = null;
  const preview = (blob, name) => {
    held = blob;
    player.src = URL.createObjectURL(blob);
    player.hidden = false;
    status.textContent = name;
    retake.hidden = false;
  };
  file.addEventListener("change", () => {
    const picked = file.files && file.files[0];
    if (!picked) return;
    if (picked.size > VOICE_MAX_BYTES) {
      file.value = "";
      ui.toast(voiceError("too_big", es), "bad");
      return;
    }
    preview(picked, picked.name);
  });
  record.addEventListener("click", async () => {
    if (recorder && recorder.state === "recording") {
      recorder.stop();
      record.textContent = es ? "Grabar" : "Record";
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        ui.toast(es ? "El micrófono no está disponible." : "The microphone is not available.", "bad");
        return;
      }
    }
    const chunks = [];
    const options = recorderStartOptions((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, options);
    recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
    let hitLimit = false;
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      clearInterval(clock);
      timer.hidden = true;
      if (saveBtn) saveBtn.disabled = false;
      const recorded = recorder.mimeType || "";
      const type = recorded.includes("mp4") ? "audio/mp4" : (recorded || "audio/webm");
      preview(new Blob(chunks, { type }), es ? "Grabación" : "Recording");
      if (hitLimit) ui.toast(es ? "Se paró a los 60 segundos." : "Stopped at 60 seconds.");
    };
    const started = Date.now();
    timer.hidden = false;
    timer.replaceChildren(ui.el("span", { class: "rec-dot" }), "0:00");
    if (saveBtn) saveBtn.disabled = true;
    clock = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      const text = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
      timer.replaceChildren(ui.el("span", { class: "rec-dot" }), text);
      if (seconds * 1000 >= VOICE_MAX_MS && recorder.state === "recording") {
        hitLimit = true;
        recorder.stop();
        record.textContent = es ? "Grabar" : "Record";
      }
    }, 250);
    recorder.start();
    record.textContent = es ? "Parar" : "Stop";
  });
  retake.addEventListener("click", () => {
    held = null;
    player.hidden = true;
    player.removeAttribute("src");
    status.textContent = "";
    retake.hidden = true;
    file.value = "";
  });
  form.append(title.label, labeled(ui, es ? "Para quién" : "Who it is for", kind), stepLabel, personLabel, timer, status, player);
  const tools = ui.el("div", { class: "voice-tools" });
  tools.append(upload, file, record, retake);
  form.append(tools);
  saveBtn = ui.button(es ? "Guardar" : "Save", async (event) => {
    event.preventDefault();
    if (!title.input.value.trim()) return ui.toast(es ? "Ponle un nombre." : "Name the note.", "bad");
    if (!held) return ui.toast(es ? "Graba o sube un audio." : "Record or upload audio.", "bad");
    let prepared = held;
    let durationMs = null;
    try {
      const ready = await prepareVoiceNote(held);
      prepared = ready.file;
      durationMs = ready.durationMs;
    } catch (error) {
      ui.toast(voiceError(error && error.code, es), "bad");
      return;
    }
    await ui.saveLibraryNote(prepared, {
      id: ui.state.voiceReplace || "",
      title: title.input.value.trim(),
      assignment_kind: kind.value,
      step_name: kind.value === "step" ? step.value : "",
      lead_handle: kind.value === "person" ? person.value : "",
      duration_ms: durationMs
    });
    ui.state.voiceReplace = "";
  });
  form.append(saveBtn);
  form.addEventListener("submit", (event) => event.preventDefault());
  return form;
}

function labeled(ui, name, node) {
  const label = ui.el("label");
  label.append(ui.el("span", { text: name }), node);
  return label;
}
