import { toast } from "../auth/ui.js";

const BUCKET = "business-assets";
const DOC_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);
const AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/wav",
  "audio/ogg",
  "audio/x-m4a",
  "audio/m4a"
]);
const MAX_BYTES = 20 * 1024 * 1024;

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  });
  (children || []).forEach((child) => {
    if (child == null || child === false) return;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return node;
}

function scrub(message) {
  return String(message || "").replace(/tailortalk|zerochats/ig, "the setter service");
}

function missing(error) {
  return error && /schema cache|does not exist|PGRST205|PGRST204/i.test(error.message || "");
}

function safeName(name) {
  const cleaned = String(name || "file").replace(/[^a-z0-9._-]+/ig, "-").replace(/^-+|-+$/g, "");
  return (cleaned || "file").slice(0, 80);
}

function mimeOf(file, kind) {
  const raw = String(file.type || "").split(";")[0].trim().toLowerCase();
  if (raw && raw !== "application/octet-stream") return raw;
  const ext = String(file.name || "").split(".").pop().toLowerCase();
  if (kind === "voice") {
    if (ext === "mp3") return "audio/mpeg";
    if (ext === "m4a") return "audio/mp4";
    if (ext === "wav") return "audio/wav";
    if (ext === "ogg") return "audio/ogg";
    return "audio/webm";
  }
  if (ext === "pdf") return "application/pdf";
  if (ext === "md") return "text/markdown";
  if (ext === "txt") return "text/plain";
  if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === "doc") return "application/msword";
  return raw;
}

function httpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch (_error) {
    return "";
  }
}

export async function mountAssets(supabase, agent, host, canEdit, userId) {
  host.innerHTML = "";
  const panel = el("section", { class: "panel", id: "assets" });
  panel.append(el("h2", { text: "Assets" }));
  panel.append(el("p", { text: "Docs, links, and voice notes for this business. Each one is marked Available to agent. Replies do not use them until that connection is turned on." }));
  const list = el("div", { id: "asset-list" });
  const note = el("p", { class: "err", id: "asset-note", role: "status" });
  panel.append(list, note);
  if (canEdit) panel.append(forms());
  host.append(panel);

  function forms() {
    const wrap = el("div", { class: "asset-forms" });
    wrap.append(docForm(), linkForm(), voiceForm());
    return wrap;
  }

  function docForm() {
    const form = el("form", { class: "auth-form", id: "doc-form" });
    form.append(el("h3", { text: "Docs" }));
    const file = el("input", { id: "doc-file", type: "file", accept: ".pdf,.txt,.md,.doc,.docx,application/pdf,text/plain,text/markdown", required: true });
    const title = el("input", { id: "doc-title", type: "text", placeholder: "Title", "aria-label": "Document title" });
    const button = el("button", { class: "btn", type: "submit" }, ["Upload doc"]);
    form.append(file, title, button);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const chosen = file.files && file.files[0];
      if (!chosen) return;
      button.disabled = true;
      try {
        await saveFile("doc", chosen, title.value.trim() || chosen.name.replace(/\.[^.]+$/, ""));
        form.reset();
        toast("Doc saved.");
        await refresh();
      } catch (error) {
        note.textContent = error.message;
        toast(error.message, "bad");
      }
      button.disabled = false;
    });
    return form;
  }

  function linkForm() {
    const form = el("form", { class: "auth-form", id: "link-form" });
    form.append(el("h3", { text: "Links" }));
    const title = el("input", { id: "link-title", type: "text", required: true, placeholder: "Title", "aria-label": "Link title" });
    const url = el("input", { id: "link-url", type: "url", required: true, placeholder: "https://", "aria-label": "Link URL" });
    const button = el("button", { class: "btn", type: "submit" }, ["Add link"]);
    form.append(title, url, button);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const href = httpUrl(url.value.trim());
      if (!href) {
        note.textContent = "Use a full http or https link.";
        return;
      }
      button.disabled = true;
      try {
        await insertRow({
          kind: "link",
          title: title.value.trim(),
          url: href
        });
        form.reset();
        toast("Link saved.");
        await refresh();
      } catch (error) {
        note.textContent = error.message;
        toast(error.message, "bad");
      }
      button.disabled = false;
    });
    return form;
  }

  function voiceForm() {
    const form = el("form", { class: "auth-form", id: "voice-form" });
    form.append(el("h3", { text: "Voice notes" }));
    const title = el("input", { id: "voice-title", type: "text", required: true, placeholder: "Title", "aria-label": "Voice note title" });
    const when = el("input", { id: "voice-when", type: "text", required: true, placeholder: "When to use", "aria-label": "When to use this voice note" });
    const file = el("input", { id: "voice-file", type: "file", accept: "audio/*", "aria-label": "Audio file" });
    const record = el("button", { class: "btn ghost", type: "button", id: "voice-record" }, ["Record"]);
    const upload = el("button", { class: "btn", type: "submit" }, ["Upload voice note"]);
    const live = el("p", { class: "mute", id: "voice-live" });
    form.append(title, when, file, el("div", { class: "toolbar" }, [record, upload]), live);
    let recorder = null;
    let stream = null;

    record.addEventListener("click", async () => {
      note.textContent = "";
      if (!window.MediaRecorder || !navigator.mediaDevices) {
        note.textContent = "This browser cannot record audio. Upload a file instead.";
        return;
      }
      if (recorder && recorder.state === "recording") {
        recorder.stop();
        return;
      }
      if (!title.value.trim() || !when.value.trim()) {
        note.textContent = "Add a title and a short when-to-use note before recording.";
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (_error) {
        note.textContent = "The microphone is not available.";
        return;
      }
      const chunks = [];
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) chunks.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
        record.textContent = "Record";
        live.textContent = "";
        const blob = new Blob(chunks, { type: "audio/webm" });
        if (!blob.size) return;
        record.disabled = true;
        try {
          const named = new File([blob], safeName(title.value.trim()) + ".webm", { type: "audio/webm" });
          await saveFile("voice", named, title.value.trim(), when.value.trim());
          form.reset();
          toast("Voice note saved.");
          await refresh();
        } catch (error) {
          note.textContent = error.message;
          toast(error.message, "bad");
        }
        record.disabled = false;
      };
      recorder.start();
      record.textContent = "Stop";
      live.textContent = "Recording…";
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const chosen = file.files && file.files[0];
      if (!chosen) {
        note.textContent = "Choose an audio file, or record one.";
        return;
      }
      if (!when.value.trim()) {
        note.textContent = "Add a short when-to-use note.";
        return;
      }
      upload.disabled = true;
      try {
        await saveFile("voice", chosen, title.value.trim(), when.value.trim());
        form.reset();
        toast("Voice note saved.");
        await refresh();
      } catch (error) {
        note.textContent = error.message;
        toast(error.message, "bad");
      }
      upload.disabled = false;
    });
    return form;
  }

  async function saveFile(kind, file, title, whenToUse) {
    if (file.size > MAX_BYTES) throw new Error("Keep the file under 20 MB.");
    const mime = mimeOf(file, kind);
    const allowed = kind === "voice" ? AUDIO_TYPES : DOC_TYPES;
    if (!allowed.has(mime)) throw new Error("That file type is not supported.");
    const id = crypto.randomUUID();
    const path = agent.id + "/" + id + "/" + safeName(file.name);
    const uploaded = await supabase.storage.from(BUCKET).upload(path, file, { contentType: mime, upsert: false });
    if (uploaded.error) throw new Error(scrub(uploaded.error.message));
    try {
      await insertRow({
        id,
        kind,
        title: title || file.name,
        storage_path: path,
        mime_type: mime,
        byte_size: file.size,
        when_to_use: whenToUse || null
      });
    } catch (error) {
      await supabase.storage.from(BUCKET).remove([path]);
      throw error;
    }
  }

  async function insertRow(fields) {
    const row = {
      agent_id: agent.id,
      available_to_agent: true,
      created_by: userId,
      ...fields
    };
    const saved = await supabase.from("business_assets").insert(row);
    if (saved.error) {
      const message = missing(saved.error)
        ? "Apply the assets migration, then refresh."
        : scrub(saved.error.message);
      throw new Error(message);
    }
  }

  async function signedUrl(path) {
    const signed = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (signed.error || !signed.data) return "";
    return signed.data.signedUrl || "";
  }

  async function refresh() {
    list.innerHTML = "";
    const result = await supabase.from("business_assets").select("id, kind, title, url, storage_path, mime_type, when_to_use, available_to_agent, created_at").eq("agent_id", agent.id).order("created_at", { ascending: false });
    if (missing(result.error)) {
      list.append(el("p", { text: "Apply the assets migration, then refresh." }));
      return;
    }
    if (result.error) {
      list.append(el("p", { class: "err", text: scrub(result.error.message) }));
      return;
    }
    const rows = result.data || [];
    if (!rows.length) list.append(el("p", { class: "mute", text: "No docs, links, or voice notes yet." }));
    for (const row of rows) {
      list.append(await renderRow(row));
    }
  }

  async function renderRow(row) {
    const item = el("article", { class: "asset-row", id: "asset-" + row.id });
    const kind = row.kind === "voice" ? "Voice note" : row.kind === "link" ? "Link" : "Doc";
    item.append(el("p", {}, [
      el("strong", { text: row.title }),
      el("span", { class: "mute", text: " · " + kind })
    ]));
    item.append(el("p", { class: "asset-flag", text: "Available to agent" }));
    if (row.kind === "voice") item.append(el("p", { text: "When to use: " + (row.when_to_use || "") }));
    if (row.kind === "link" && row.url) {
      item.append(el("a", { href: row.url, target: "_blank", rel: "noopener noreferrer" }, [row.url]));
    }
    if (row.storage_path) {
      const href = await signedUrl(row.storage_path);
      if (row.kind === "voice" && href) {
        const audio = el("audio", { controls: true, preload: "none", src: href });
        item.append(audio);
      } else if (href) {
        item.append(el("a", { href, target: "_blank", rel: "noopener noreferrer" }, ["Open file"]));
      }
    }
    if (canEdit) {
      const tools = el("div", { class: "toolbar" });
      const rename = el("button", { type: "button", class: "btn ghost sm" }, ["Rename"]);
      const remove = el("button", { type: "button", class: "btn ghost sm" }, ["Delete"]);
      rename.addEventListener("click", () => renameRow(row, item));
      remove.addEventListener("click", () => deleteRow(row, remove));
      tools.append(rename, remove);
      item.append(tools);
    }
    return item;
  }

  function renameRow(row, item) {
    const form = el("form", { class: "auth-form rename-form" });
    const title = el("input", { type: "text", value: row.title, required: true, "aria-label": "New title" });
    const when = row.kind === "voice"
      ? el("input", { type: "text", value: row.when_to_use || "", required: true, "aria-label": "When to use" })
      : null;
    const save = el("button", { class: "btn sm", type: "submit" }, ["Save"]);
    form.append(title);
    if (when) form.append(when);
    form.append(save);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      const patch = { title: title.value.trim(), updated_at: new Date().toISOString() };
      if (when) patch.when_to_use = when.value.trim();
      const updated = await supabase.from("business_assets").update(patch).eq("id", row.id);
      save.disabled = false;
      if (updated.error) {
        note.textContent = scrub(updated.error.message);
        toast(note.textContent, "bad");
        return;
      }
      toast("Updated.");
      await refresh();
    });
    item.append(form);
  }

  async function deleteRow(row, control) {
    note.textContent = "";
    control.disabled = true;
    const removed = await supabase.from("business_assets").delete().eq("id", row.id);
    if (removed.error) {
      control.disabled = false;
      note.textContent = scrub(removed.error.message);
      toast(note.textContent, "bad");
      return;
    }
    if (row.storage_path) await supabase.storage.from(BUCKET).remove([row.storage_path]);
    toast("Deleted.");
    await refresh();
  }

  await refresh();
}
