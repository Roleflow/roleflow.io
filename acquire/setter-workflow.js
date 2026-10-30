import { roleflowSections, SETTER_SECTION_DEFS } from "./setter-sections.js";
import { businessSync, queueSyncNotice } from "./sync-state.js";

const TOOL_KINDS = [
  ["media", "Media"],
  ["document", "Documents"],
  ["sheet", "Google Sheet"],
  ["api", "API"],
  ["booking", "Booking"],
  ["event", "Events"]
];

let draft = null;
let openSection = "exclusion";
let versionId = "";
let toolOpen = false;
let toolKind = "media";
let editingId = "";

export function renderSetterStudio(ui) {
  const versions = (ui.state.setterPrompts || []).slice().sort((a, b) => b.version - a.version);
  const currentId = versionId || ui.state.setterCurrentId || (versions[0] && versions[0].id) || "";
  const current = versions.find((row) => row.id === currentId) || versions[0] || null;
  if (!draft || draft.id !== (current && current.id)) {
    draft = { id: current && current.id || "new", sections: roleflowSections(current && current.sections) };
    versionId = current && current.id || "";
  }
  const tools = (ui.state.agentTools || []).filter((row) => !row.agent_role || row.agent_role === "inbound_manager");
  const root = ui.el("div", { class: "setter-studio" });
  const editor = ui.el("div", { class: "setter-editor" });
  const bar = ui.el("div", { class: "setter-bar" });
  const select = ui.el("select", { "aria-label": "Prompt version" });
  if (!versions.length) select.append(ui.el("option", { value: "", text: "No versions yet" }));
  versions.forEach((row) => {
    const label = "v" + row.version + (row.id === ui.state.setterCurrentId ? " · current" : "");
    select.append(ui.el("option", { value: row.id, text: label }));
  });
  select.value = current && current.id || "";
  select.addEventListener("change", () => {
    versionId = select.value;
    draft = null;
    ui.paint();
  });
  bar.append(select);
  const status = syncLabel(ui);
  if (status) bar.append(ui.el("span", { class: "integration-status " + status.tone, id: "setter-sync", text: status.label, title: (ui.state.isAdmin && status.detail) || status.label }));
  if (ui.state.canEdit) {
    bar.append(ui.button("Save", () => savePrompt(ui)));
  }
  editor.append(bar);
  if (status && status.detail && ui.state.isAdmin) editor.append(ui.el("p", { class: "tool-hint", id: "setter-sync-detail", text: status.detail }));
  editor.append(ui.el("p", { class: "tool-hint", text: toolHint(tools) }));
  const accordion = ui.el("div", { class: "setter-accordion" });
  SETTER_SECTION_DEFS.forEach((section) => {
    const block = ui.el("section", { class: "setter-section" + (openSection === section.id ? " open" : "") });
    const head = ui.el("button", { type: "button", class: "setter-section-toggle", "aria-expanded": openSection === section.id ? "true" : "false" }, [section.title]);
    head.addEventListener("click", () => {
      openSection = openSection === section.id ? "" : section.id;
      ui.paint();
    });
    block.append(head);
    if (openSection === section.id) {
      const area = ui.el("textarea", { rows: "12", "aria-label": section.title });
      area.value = draft.sections[section.id] || "";
      area.addEventListener("input", () => {
        draft.sections[section.id] = area.value;
      });
      block.append(area);
    }
    accordion.append(block);
  });
  editor.append(accordion);
  editor.append(renderTools(ui, tools));
  root.append(editor, renderPlayground(ui));
  return root;
}

function emptySections() {
  const sections = {};
  SETTER_SECTION_DEFS.forEach((section) => {
    sections[section.id] = "";
  });
  return sections;
}

function toolHint(tools) {
  if (!tools.length) return "Tools you add show up here, so Workflow Logic and follow-ups can name them.";
  const names = tools.map((tool) => toolPhrase(tool)).join(", ");
  return "Available tools: " + names + ".";
}

function toolPhrase(tool) {
  if (tool.kind === "media" && tool.config && tool.config.media_type === "voice") return "send voice note " + tool.name;
  return tool.name;
}

function syncLabel(ui) {
  if (ui.businessSync) return ui.businessSync({ full: true });
  return businessSync({
    outbox: (ui.state.setterOutbox || []).concat(ui.state.outbox || []),
    igStatus: ui.state.ig && ui.state.ig.status,
    systemEnabled: Boolean(ui.state.settings && ui.state.settings.system_enabled),
    externalAgentId: ui.state.setterLink && ui.state.setterLink.external_agent_id
  });
}

async function savePrompt(ui) {
  const sections = Object.assign(emptySections(), draft && draft.sections || {});
  const missing = SETTER_SECTION_DEFS.find((section) => !String(sections[section.id] || "").trim());
  if (missing) {
    ui.toast("Add text to " + missing.title + " before saving.", "bad");
    return;
  }
  if (!ui.state.supabase) {
    ui.toast("Syncing");
    return;
  }
  const saved = await ui.state.supabase.rpc("acq_save_inbound_prompt", {
    p_business: ui.state.businessId,
    p_sections: sections
  });
  if (saved.error) {
    ui.toast(saved.error.message, "bad");
    return;
  }
  queueSyncNotice(ui.state.supabase, ui.state.businessId);
  ui.toast("Syncing");
  draft = null;
  versionId = "";
  await ui.bootBusiness(ui.state.businessId);
  ui.state.openDeskRequest = { kind: "inbound", key: "manager" };
  ui.go("inbound");
}

function renderPlayground(ui) {
  const pane = ui.el("aside", { class: "setter-play", "aria-label": "Test chat" });
  pane.append(ui.el("h3", { text: "Test" }));
  pane.append(ui.el("p", { class: "mute", text: "Try the setter here. Nothing is sent to a lead." }));
  const log = ui.el("div", { class: "play-log" });
  const form = ui.el("form", { class: "play-form" });
  const input = ui.el("input", { type: "text", maxlength: "800", placeholder: "Write a test message", "aria-label": "Test message" });
  const send = ui.el("button", { class: "btn sm", type: "submit" }, ["Send"]);
  form.append(input, send);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    log.append(ui.el("p", { class: "play-me", text }));
    const reply = await testReply(ui, text);
    log.append(ui.el("p", { class: "play-ai", text: reply }));
    log.scrollTop = log.scrollHeight;
  });
  pane.append(log, form);
  return pane;
}

async function testReply(ui, text) {
  if (!ui.state.supabase) return "Test only. Nothing was sent to a lead.";
  const result = await ui.state.supabase.functions.invoke("roleflow-hooks", {
    body: {
      action: "prompt_test",
      business_id: ui.state.businessId,
      message: text,
      sections: draft && draft.sections || {}
    }
  });
  const reply = result.data && result.data.reply;
  if (reply) return String(reply);
  return "Test only. Nothing was sent to a lead.";
}

function renderTools(ui, tools) {
  const wrap = ui.el("section", { class: "agent-tools", id: "agent-tools" });
  const head = ui.el("div", { class: "setter-bar" });
  head.append(ui.el("h3", { text: "Tools" }));
  if (ui.state.canEdit) {
    const add = ui.button("Add tool", () => {
      editingId = "";
      toolOpen = !toolOpen;
      ui.paint();
    });
    head.append(add);
  }
  wrap.append(head);
  if (!tools.length) wrap.append(ui.el("p", { class: "mute", text: "No tools yet." }));
  const list = ui.el("ul", { class: "tool-list" });
  tools.forEach((tool) => {
    const item = ui.el("li", {});
    const kind = TOOL_KINDS.find((row) => row[0] === tool.kind);
    const voice = tool.kind === "media" && tool.config && tool.config.media_type === "voice";
    item.append(ui.el("strong", { text: tool.name }));
    item.append(ui.el("span", { text: voice ? "Media · voice note" : (kind ? kind[1] : tool.kind) }));
    if (ui.state.canEdit) {
      const change = ui.el("button", { type: "button", class: "btn ghost sm", text: "Change" });
      change.addEventListener("click", () => {
        editingId = tool.id;
        toolKind = tool.kind || "media";
        toolOpen = true;
        ui.paint();
      });
      item.append(change);
    }
    list.append(item);
  });
  wrap.append(list);
  if (toolOpen && ui.state.canEdit) wrap.append(toolPicker(ui));
  return wrap;
}

function toolPicker(ui) {
  const form = ui.el("form", { class: "tool-picker" });
  const kinds = ui.el("div", { class: "filters", role: "group", "aria-label": "Tool type" });
  TOOL_KINDS.forEach(([id, label]) => {
    const button = ui.el("button", { type: "button", text: label, "aria-pressed": toolKind === id ? "true" : "false" });
    button.addEventListener("click", () => {
      toolKind = id;
      ui.paint();
    });
    kinds.append(button);
  });
  form.append(kinds);
  const name = field(ui, "Name", "Tool name");
  form.append(name.label);
  const extra = {};
  if (toolKind === "media") {
    const file = ui.el("input", { type: "file", accept: "image/*,audio/*,.pdf,.txt", "aria-label": "Media file" });
    const voice = ui.el("label", { class: "switch" });
    const check = ui.el("input", { type: "checkbox", "aria-label": "This is a voice note" });
    voice.append(check, document.createTextNode(" Voice note"));
    extra.file = file;
    extra.voice = check;
    form.append(file, voice);
  } else if (toolKind === "document") {
    extra.body = area(ui, form, "What the setter can use from this document");
  } else if (toolKind === "sheet") {
    extra.url = line(ui, form, "Sheet link");
    extra.tab = line(ui, form, "Tab");
  } else if (toolKind === "api") {
    extra.url = line(ui, form, "URL");
    extra.method = line(ui, form, "Method");
    extra.args = area(ui, form, "Arguments");
    extra.headers = area(ui, form, "Headers");
    extra.body = area(ui, form, "Body");
    extra.filter = line(ui, form, "Response filter");
  } else if (toolKind === "booking") {
    extra.url = line(ui, form, "Calendar link");
    extra.calendar = line(ui, form, "Google Calendar");
  } else {
    extra.body = area(ui, form, "When this event fires");
  }
  form.append(ui.button("Save tool", async () => {
    const label = name.input.value.trim();
    if (!label) {
      ui.toast("Name the tool.", "bad");
      return;
    }
    const config = configFrom(toolKind, extra);
    if (toolKind === "media" && extra.file && extra.file.files && extra.file.files[0]) {
      const stored = await storeToolFile(ui, extra.file.files[0], config.media_type === "voice");
      if (stored) Object.assign(config, stored);
      else config.filename = extra.file.files[0].name;
    }
    await saveTool(ui, label, config);
  }));
  return form;
}

function configFrom(kind, extra) {
  if (kind === "media") {
    return { media_type: extra.voice && extra.voice.checked ? "voice" : "file" };
  }
  if (kind === "document") return { body: value(extra.body) };
  if (kind === "sheet") return { url: value(extra.url), tab: value(extra.tab) };
  if (kind === "api") {
    return {
      url: value(extra.url),
      method: value(extra.method) || "POST",
      args: value(extra.args),
      headers: value(extra.headers),
      body: value(extra.body),
      response_filter: value(extra.filter)
    };
  }
  if (kind === "booking") return { calendar_link: value(extra.url), google_calendar: value(extra.calendar) };
  return { body: value(extra.body) };
}

function value(node) {
  return node && node.value ? node.value.trim() : "";
}

async function storeToolFile(ui, file, voice) {
  if (!ui.state.supabase || !file) return null;
  const bucket = voice ? "acq-voice" : "acq-value";
  const path = ui.state.businessId + "/tools/" + crypto.randomUUID() + "-" + file.name.replace(/[^\w.]+/g, "-").slice(0, 40);
  const uploaded = await ui.state.supabase.storage.from(bucket).upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (uploaded.error) return { filename: file.name };
  return { storage_path: path, bucket, filename: file.name, mime: file.type || "" };
}

async function saveTool(ui, name, config) {
  if (!ui.state.supabase) {
    ui.state.agentTools = (ui.state.agentTools || []).concat([{
      id: "preview-tool",
      agent_role: "inbound_manager",
      kind: toolKind,
      name,
      config
    }]);
    toolOpen = false;
    editingId = "";
    ui.toast("Syncing");
    ui.paint();
    return;
  }
  const args = {
    p_business: ui.state.businessId,
    p_role: "inbound_manager",
    p_kind: toolKind,
    p_name: name,
    p_config: config
  };
  if (editingId) args.p_tool = editingId;
  const saved = await ui.state.supabase.rpc("acq_save_agent_tool", args);
  if (saved.error) {
    ui.toast(saved.error.message, "bad");
    return;
  }
  queueSyncNotice(ui.state.supabase, ui.state.businessId);
  toolOpen = false;
  editingId = "";
  ui.toast("Syncing");
  await ui.bootBusiness(ui.state.businessId);
  ui.state.openDeskRequest = { kind: "inbound", key: "manager" };
  ui.go("inbound");
}

function field(ui, label, aria) {
  const wrap = ui.el("label", { text: label });
  const input = ui.el("input", { type: "text", "aria-label": aria });
  wrap.append(input);
  return { label: wrap, input };
}

function line(ui, form, label) {
  const built = field(ui, label, label);
  form.append(built.label);
  return built.input;
}

function area(ui, form, label) {
  const wrap = ui.el("label", { text: label });
  const input = ui.el("textarea", { rows: "3", "aria-label": label });
  wrap.append(input);
  form.append(wrap);
  return input;
}
