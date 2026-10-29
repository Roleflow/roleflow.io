import { ROLES } from "./model.js";
import { CRM_STATES, filterLeads } from "./studio-model.js";
import { aggregateFromLeads, bubbleKind, bubbleLabel, emptySummary, summaryFields } from "./chat-summary.js";
import { exportThread, matchKeyword, reminderBucket, reminderKpis, stepError, volumeByDay, welcomeError } from "./studio-flow-model.js";
import { sectionAlert, sectionEmpty, sectionText } from "./section-copy.js";

function box(ui) {
  if (!ui.state.flow) ui.state.flow = { chat: "", chatQuery: "", chatState: "all", chatTag: "", chatAi: "all", chatUnread: "all", reminderFilter: "open", ctaPreview: "" };
  return ui.state.flow;
}

function header(ui, title, text, how, icon) {
  if (ui.pageHeader) return ui.pageHeader(ui, title, text, how, icon);
  const block = ui.el("section", { class: "agent" });
  block.append(ui.el("h2", { text: title }), ui.el("p", { text }));
  return block;
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function renderFollowups(ui) {
  const wrap = ui.el("div", { class: "studio" });
  wrap.append(header(ui, "Follow-ups", "A ladder inside the 24-hour messaging window, plus welcome messages and a 7-day list a person sends.", "followups", "send"));
  wrap.append(ui.el("p", { text: "Instagram only delivers a business reply inside 24 hours of the lead's last message. Steps are 1 to 23 hours so the last one still fits. Nothing here is sent while live sync is off." }));
  const settings = ui.state.settings || {};
  const options = ui.el("section", { class: "agent" });
  options.append(ui.el("h3", { text: "Window options" }));
  const restart = check(ui, "Restart the ladder when the lead replies", settings.followup_restart_on_reply === true);
  const before = check(ui, "Send the next step before office hours end", settings.followup_before_close === true);
  options.append(restart.label, before.label);
  if (ui.state.canEdit) {
    options.append(ui.button("Save options", () => ui.saveFollowupOptions({
      followup_restart_on_reply: restart.input.checked,
      followup_before_close: before.input.checked
    })));
  }
  wrap.append(options);
  wrap.append(ladder(ui));
  wrap.append(welcome(ui));
  wrap.append(manual(ui));
  return wrap;
}

function ladder(ui) {
  const section = ui.el("section", { class: "agent" });
  section.append(ui.el("h3", { text: "24-hour ladder" }));
  const steps = ui.state.followupSteps || [];
  if (!steps.length) section.append(ui.el("p", { text: "No steps yet." }));
  steps.forEach((step) => {
    const state = step.crm_state ? stateName(step.crm_state) : "Any state";
    const line = ui.el("p", { text: step.hours + "h · " + (step.mode === "ai" ? "AI instructions" : "Literal text") + " · " + state + " — " + step.body });
    if (ui.state.canEdit) line.append(" ", ui.button("Remove", () => ui.deleteFlowRow("acq_followup_steps", step.id)));
    section.append(line);
  });
  if (!ui.state.canEdit) return section;
  const form = ui.el("form", { class: "grid-2" });
  const hours = ui.el("select", { "aria-label": "Hours" });
  for (let hour = 1; hour <= 23; hour += 1) hours.append(ui.el("option", { value: String(hour), text: hour + " hours" }));
  const mode = ui.el("select", { "aria-label": "Step mode" });
  [["ai", "AI instructions"], ["text", "Literal text"]].forEach(([value, label]) => mode.append(ui.el("option", { value, text: label })));
  const state = ui.el("select", { "aria-label": "Lead state variant" });
  state.append(ui.el("option", { value: "any", text: "Any state" }));
  CRM_STATES.forEach(([value, label]) => state.append(ui.el("option", { value, text: label })));
  const body = ui.el("textarea", { rows: "3", "aria-label": "Step text" });
  const asset = ui.el("select", { "aria-label": "Attach content" });
  asset.append(ui.el("option", { value: "", text: "No attachment" }));
  (ui.state.valueAssets || []).forEach((item) => asset.append(ui.el("option", { value: item.id, text: item.title || item.kind })));
  form.append(hours, mode, state, body, asset);
  form.append(ui.button("Add step", (event) => {
    event.preventDefault();
    const errors = stepError({ hours: hours.value, mode: mode.value, body: body.value, state: state.value, states: CRM_STATES.map((item) => item[0]) });
    if (errors.length) return ui.toast(errors[0], "bad");
    ui.saveFollowupStep({
      hours: Number(hours.value),
      mode: mode.value,
      body: body.value.trim(),
      crm_state: state.value === "any" ? null : state.value,
      asset_id: asset.value || null
    });
  }));
  form.addEventListener("submit", (event) => event.preventDefault());
  section.append(form);
  return section;
}

function welcome(ui) {
  const section = ui.el("section", { class: "agent" });
  section.append(ui.el("h3", { text: "Welcome follow-ups" }));
  section.append(ui.el("p", { text: "Two messages at most, both inside 24 hours of the first reply." }));
  const rows = ui.state.welcomeSteps || [];
  if (!rows.length) section.append(ui.el("p", { text: "No welcome messages yet." }));
  rows.forEach((row) => section.append(ui.el("p", { text: "Message " + row.position + " · " + row.delay_hours + "h — " + row.body })));
  if (!ui.state.canEdit || rows.length >= 2) return section;
  const form = ui.el("form", { class: "grid-2" });
  const delay = ui.field("Delay in hours", "1", "number");
  const body = ui.el("textarea", { rows: "2", "aria-label": "Welcome text" });
  form.append(delay.label, body);
  form.append(ui.button("Add welcome message", (event) => {
    event.preventDefault();
    const next = rows.concat([{ delay_hours: delay.input.value, body: body.value }]);
    const errors = welcomeError(next);
    if (errors.length) return ui.toast(errors[0], "bad");
    ui.saveWelcomeStep({ position: rows.length + 1, delay_hours: Number(delay.input.value), body: body.value.trim(), mode: "text" });
  }));
  form.addEventListener("submit", (event) => event.preventDefault());
  section.append(form);
  return section;
}

function manual(ui) {
  const section = ui.el("section", { class: "agent" });
  section.append(ui.el("h3", { text: "7-day manual follow-ups" }));
  section.append(ui.el("p", { text: "The model can draft these. A person sends them. Marking one sent does not message the lead." }));
  const rows = (ui.state.manualFollowups || []).filter((row) => row.status === "pending");
  if (!rows.length) section.append(ui.el("p", { text: "No pending drafts." }));
  rows.forEach((row) => {
    const line = ui.el("p", { text: row.body });
    if (ui.state.canEdit) line.append(" ", ui.button("I sent this", () => ui.markFollowupSent(row.id)));
    section.append(line);
  });
  if (!ui.state.canEdit) return section;
  const form = ui.el("form");
  const body = ui.el("textarea", { rows: "2", "aria-label": "Manual follow-up" });
  form.append(body);
  form.append(ui.button("Save draft", (event) => {
    event.preventDefault();
    if (!body.value.trim()) return ui.toast("Write the draft first.", "bad");
    ui.saveManualFollowup({ body: body.value.trim() });
  }));
  form.append(ui.button("Draft with AI", () => ui.draftManualFollowup()));
  form.addEventListener("submit", (event) => event.preventDefault());
  section.append(form);
  return section;
}

export function renderReminders(ui) {
  const flow = box(ui);
  const wrap = ui.el("div", { class: "studio" });
  wrap.append(header(ui, "Reminders", "Tasks and conversations to resume. A person confirms anything the model suggests.", "reminders", "clipboard"));
  const reminders = ui.state.reminders || [];
  const kpis = reminderKpis(reminders, new Date());
  const cards = ui.el("div", { class: "kpi-row" });
  [["Overdue", kpis.overdue], ["Today", kpis.today], ["Next 7 days", kpis.week]].forEach(([label, value]) => {
    const card = ui.el("article", { class: "kpi" });
    card.append(ui.el("span", { text: label }), ui.el("strong", { text: String(value) }));
    cards.append(card);
  });
  wrap.append(cards);
  const volume = volumeByDay(reminders, 14, new Date());
  const chart = ui.el("div", { class: "volume", "aria-label": "Reminders created over 14 days" });
  const max = Math.max(1, ...volume.map((day) => day.count));
  volume.forEach((day) => {
    const bar = ui.el("i");
    bar.style.height = Math.max(4, Math.round((day.count / max) * 72)) + "px";
    bar.title = day.day + ": " + day.count;
    chart.append(bar);
  });
  wrap.append(chart);
  const filters = ui.el("div", { class: "filters" });
  [["open", "Open"], ["overdue", "Overdue"], ["done", "Done"]].forEach(([id, label]) => {
    const button = ui.el("button", { type: "button", "aria-pressed": flow.reminderFilter === id ? "true" : "false" }, [label]);
    button.addEventListener("click", () => { flow.reminderFilter = id; ui.paint(); });
    filters.append(button);
  });
  wrap.append(filters);
  const shown = reminders.filter((reminder) => {
    if (flow.reminderFilter === "done") return reminder.status === "done";
    if (flow.reminderFilter === "overdue") return reminderBucket(reminder, new Date()) === "overdue";
    return reminder.status !== "done";
  });
  if (!shown.length) wrap.append(ui.el("p", { text: "No reminders in this filter." }));
  shown.forEach((reminder) => {
    const card = ui.el("article", { class: "agent" });
    card.append(ui.el("h3", { text: reminder.title }));
    card.append(ui.el("p", { text: (reminder.kind === "resume" ? "Resume conversation" : "Task") + " · " + (reminder.source === "ai" ? "Suggested" : "Manual") + " · " + new Date(reminder.due_at).toLocaleString() }));
    if (ui.state.canEdit && reminder.status !== "done") card.append(ui.button("Mark done", () => ui.finishReminder(reminder.id)));
    wrap.append(card);
  });
  if (ui.state.canEdit) wrap.append(reminderForm(ui));
  return wrap;
}

function reminderForm(ui) {
  const form = ui.el("form", { class: "agent" });
  form.append(ui.el("h3", { text: "Add a reminder" }));
  const title = ui.field("Title", "");
  const due = ui.field("Due", "", "datetime-local");
  const kind = ui.el("select", { "aria-label": "Reminder kind" });
  [["task", "Task"], ["resume", "Resume conversation"]].forEach(([value, label]) => kind.append(ui.el("option", { value, text: label })));
  form.append(title.label, due.label, kind);
  form.append(ui.button("Save reminder", (event) => {
    event.preventDefault();
    if (!title.input.value.trim() || !due.input.value) return ui.toast("Add a title and a time.", "bad");
    ui.saveReminder({ title: title.input.value.trim(), due_at: new Date(due.input.value).toISOString(), kind: kind.value, source: "manual" });
  }));
  form.addEventListener("submit", (event) => event.preventDefault());
  return form;
}

export function renderCtas(ui) {
  const flow = box(ui);
  const wrap = ui.el("div", { class: "studio" });
  wrap.append(header(ui, "Calls to action", "A comment keyword can open a private conversation. A story keyword can hand the reply to one agent.", "ctas", "inbox"));
  const comments = ui.state.commentCtas || [];
  if (!comments.length) wrap.append(ui.el("p", { text: "No comment keywords yet." }));
  comments.forEach((row) => {
    const card = ui.el("article", { class: "agent" });
    card.append(ui.el("h3", { text: row.keyword }));
    card.append(ui.el("p", { text: (row.match_mode === "equals" ? "Equals" : "Contains") + (row.agent_role ? " · " + roleName(row.agent_role) : "") }));
    if (row.dm_text) card.append(ui.el("p", { text: row.dm_text }));
    if (ui.state.canEdit) card.append(ui.button("Remove", () => ui.deleteFlowRow("acq_comment_ctas", row.id)));
    wrap.append(card);
  });
  if (ui.state.canEdit) wrap.append(commentForm(ui, flow));
  wrap.append(phone(ui, flow));
  wrap.append(stories(ui));
  return wrap;
}

function commentForm(ui, flow) {
  const form = ui.el("form", { class: "agent" });
  form.append(ui.el("h3", { text: "Comment keyword" }));
  const keyword = ui.field("Keyword", "");
  const mode = ui.el("select", { "aria-label": "Match" });
  [["contains", "Contains"], ["equals", "Equals"]].forEach(([value, label]) => mode.append(ui.el("option", { value, text: label })));
  const dm = ui.field("Private message", "");
  const buttonLabel = ui.field("Link button label", "");
  const buttonUrl = ui.field("Link URL", "https://");
  const agent = ui.el("select", { "aria-label": "Agent" });
  agent.append(ui.el("option", { value: "", text: "Any agent" }));
  ROLES.forEach((role) => agent.append(ui.el("option", { value: role.id, text: role.name })));
  const reply = check(ui, "Reply to the comment in public", false);
  const anyone = check(ui, "Message anyone who comments", false);
  const canned = ui.el("textarea", { rows: "3", "aria-label": "Public replies", placeholder: "One public reply per line" });
  form.append(keyword.label, mode, dm.label, buttonLabel.label, buttonUrl.label, agent, reply.label, anyone.label, canned);
  const preview = () => {
    const lines = canned.value.split("\n").map((line) => line.trim()).filter(Boolean);
    const shown = lines.length ? lines[Math.floor(Math.random() * lines.length)] : "";
    flow.ctaPreview = {
      keyword: keyword.input.value.trim(),
      mode: mode.value,
      dm: dm.input.value.trim(),
      button: buttonLabel.input.value.trim(),
      replies: lines,
      shown
    };
    ui.paint();
  };
  form.append(ui.button("Preview", (event) => { event.preventDefault(); preview(); }));
  form.append(ui.button("Save keyword", (event) => {
    event.preventDefault();
    if (!keyword.input.value.trim()) return ui.toast("Add a keyword.", "bad");
    if (buttonLabel.input.value.trim().length > 20) return ui.toast("Button label is 20 characters at most.", "bad");
    const url = buttonUrl.input.value.trim();
    if (url && url !== "https://" && !/^https:\/\//i.test(url)) return ui.toast("URL must start with https://", "bad");
    ui.saveCommentCta({
      keyword: keyword.input.value.trim(),
      match_mode: mode.value,
      dm_text: dm.input.value.trim(),
      button_label: buttonLabel.input.value.trim().slice(0, 20),
      button_url: /^https:\/\//i.test(url) ? url : "",
      agent_role: agent.value,
      reply_to_comments: reply.input.checked,
      dm_anyone: anyone.input.checked,
      public_replies: canned.value.split("\n").map((line) => line.trim()).filter(Boolean)
    });
  }));
  form.addEventListener("submit", (event) => event.preventDefault());
  return form;
}

function phone(ui, flow) {
  const section = ui.el("section", { class: "agent phone-wrap" });
  section.append(ui.el("h3", { text: "Preview" }));
  const preview = flow.ctaPreview || {};
  const phoneNode = ui.el("div", { class: "phone" });
  const sample = preview.keyword || "the keyword";
  const hit = preview.keyword ? matchKeyword(sample, preview.keyword, preview.mode || "contains") : false;
  phoneNode.append(ui.el("p", { class: "phone-comment", text: "Comment: " + sample }));
  phoneNode.append(ui.el("p", { text: preview.shown ? "Public reply: " + preview.shown : "No public reply yet." }));
  phoneNode.append(ui.el("p", { class: "phone-dm", text: hit || !preview.keyword ? (preview.dm || "The private message appears here.") : "This comment does not match." }));
  if (preview.button) phoneNode.append(ui.el("p", { class: "phone-btn", text: preview.button }));
  section.append(phoneNode);
  return section;
}

function stories(ui) {
  const section = ui.el("section", { class: "agent" });
  section.append(ui.el("h3", { text: "Story keywords" }));
  const rows = ui.state.storyCtas || [];
  if (!rows.length) section.append(ui.el("p", { text: "No story keywords yet." }));
  rows.forEach((row) => {
    const line = ui.el("p", { text: row.keyword + (row.agent_role ? " · " + roleName(row.agent_role) : "") + (row.extra_instructions ? " — " + row.extra_instructions : "") });
    if (ui.state.canEdit) line.append(" ", ui.button("Remove", () => ui.deleteFlowRow("acq_story_ctas", row.id)));
    section.append(line);
  });
  if (!ui.state.canEdit) return section;
  const form = ui.el("form", { class: "grid-2" });
  const keyword = ui.field("Keyword", "");
  const agent = ui.el("select", { "aria-label": "Story agent" });
  agent.append(ui.el("option", { value: "", text: "Any agent" }));
  ROLES.forEach((role) => agent.append(ui.el("option", { value: role.id, text: role.name })));
  const extra = ui.el("textarea", { rows: "2", "aria-label": "Extra instructions" });
  form.append(keyword.label, agent, extra);
  form.append(ui.button("Save story keyword", (event) => {
    event.preventDefault();
    if (!keyword.input.value.trim()) return ui.toast("Add a keyword.", "bad");
    ui.saveStoryCta({ keyword: keyword.input.value.trim(), agent_role: agent.value, extra_instructions: extra.value.trim() });
  }));
  form.addEventListener("submit", (event) => event.preventDefault());
  section.append(form);
  return section;
}

export function renderChats(ui) {
  const flow = box(ui);
  const lang = ui.language ? ui.language() : "en";
  const wrap = ui.el("div", { class: "studio" });
  wrap.append(header(ui, sectionText(lang, "chatsTitle"), sectionText(lang, "chatsBody"), "inbox", "inbox"));
  const alert = sectionAlert(ui, "chats");
  if (alert) wrap.append(alert);
  const leads = ui.collectLeads ? ui.collectLeads(ui.state.contacts, ui.state.targets) : [];
  const tags = [...new Set(leads.flatMap((lead) => lead.tags || []))].sort();
  const matched = filterLeads(leads, {
    q: flow.chatQuery || "",
    state: flow.chatState || "all",
    tag: flow.chatTag || "",
    ai: flow.chatAi || "all",
    unread: flow.chatUnread || "all",
    desk: flow.desk || "all"
  });
  if (!flow.chat && matched[0]) flow.chat = matched[0].kind + ":" + matched[0].id;
  const layout = ui.el("div", { class: "chats" + (flow.analysisShut ? " analysis-shut" : "") });
  const list = ui.el("div", { class: "chat-list" });
  const filters = ui.el("form", { class: "chat-search" });
  const query = ui.el("input", { id: "chat-search", type: "search", value: flow.chatQuery || "", placeholder: lang === "es" ? "Buscar" : "Search", "aria-label": "Search" });
  const filterBtn = ui.el("button", { type: "button", class: "icon-btn", "aria-label": lang === "es" ? "Filtros" : "Filters", "aria-expanded": flow.chatFilters ? "true" : "false" }, ["▾"]);
  filters.append(query, filterBtn);
  const more = ui.el("div", { class: "filters-pop", hidden: flow.chatFilters ? null : true });
  const state = ui.el("select", { "aria-label": "Chat state" });
  state.append(ui.el("option", { value: "all", text: "Any state" }));
  CRM_STATES.forEach(([value, label]) => state.append(ui.el("option", { value, text: label })));
  state.value = flow.chatState || "all";
  const tag = ui.el("select", { "aria-label": "Chat tag" });
  tag.append(ui.el("option", { value: "", text: "Any tag" }));
  tags.forEach((name) => tag.append(ui.el("option", { value: name, text: name })));
  tag.value = tags.includes(flow.chatTag) ? flow.chatTag : "";
  const ai = ui.el("select", { "aria-label": "AI replies" });
  [["all", "AI on or off"], ["on", "AI on"], ["off", "AI paused"]].forEach(([value, label]) => ai.append(ui.el("option", { value, text: label })));
  ai.value = flow.chatAi || "all";
  const unread = ui.el("select", { "aria-label": "Unread" });
  [["all", "Read and unread"], ["yes", "Unread"], ["no", "Read"]].forEach(([value, label]) => unread.append(ui.el("option", { value, text: label })));
  unread.value = flow.chatUnread || "all";
  more.append(state, tag, ai, unread);
  filterBtn.addEventListener("click", () => { flow.chatFilters = !flow.chatFilters; ui.paint(); });
  filters.addEventListener("submit", (event) => {
    event.preventDefault();
    flow.chatQuery = query.value.trim().toLowerCase().replace(/^@/, "");
    flow.chatState = state.value;
    flow.chatTag = tag.value;
    flow.chatAi = ai.value;
    flow.chatUnread = unread.value;
    ui.paint();
  });
  state.addEventListener("change", () => filters.requestSubmit());
  list.append(filters, more, deskChips(ui, flow));
  if (ui.state.chatsPending) {
    const skel = ui.el("div", { class: "chat-skel", role: "status", "aria-busy": "true" });
    for (let index = 0; index < 6; index += 1) skel.append(ui.el("span", { class: "skel" }));
    list.append(skel);
  } else {
    if (!matched.length && !alert) list.append(leads.length ? sectionEmpty(ui, "chatsNone") : sectionEmpty(ui, "chatsEmpty"));
    matched.forEach((lead) => list.append(chatRow(ui, flow, lead)));
  }
  const open = matched.find((lead) => lead.kind + ":" + lead.id === flow.chat) || null;
  layout.append(list, threadPane(ui, open), leadPane(ui, open));
  wrap.append(layout, summarySection(ui, open, leads));
  return wrap;
}

function deskChips(ui, flow) {
  const row = ui.el("div", { class: "desk-filters" });
  [["all", "All"], ["new", "New"], ["qualified", "Qualified"], ["booked", "Booked"], ["lost", "Lost"], ["ai", "AI"], ["manual", "Manual"], ["unread", "Unread"]].forEach(([id, label]) => {
    const pressed = id === "unread" ? flow.chatUnread === "yes" && (flow.desk || "all") === "all" : (flow.desk || "all") === id && flow.chatUnread !== "yes";
    const button = ui.el("button", { type: "button", "aria-pressed": pressed ? "true" : "false" }, [label]);
    button.addEventListener("click", () => {
      if (id === "unread") {
        flow.chatUnread = "yes";
        flow.desk = "all";
      } else {
        flow.desk = id;
        flow.chatUnread = "all";
      }
      ui.paint();
    });
    row.append(button);
  });
  return row;
}

function chatRow(ui, flow, lead) {
  const title = lead.name || (lead.handle ? "@" + lead.handle : "Unnamed");
  const button = ui.el("button", {
    type: "button",
    class: "chat-row",
    "aria-pressed": flow.chat === lead.kind + ":" + lead.id ? "true" : "false"
  });
  button.append(ui.el("span", { class: "biz-avatar", text: title.trim().charAt(0).toUpperCase() || "R" }));
  const copy = ui.el("span", { class: "chat-copy" });
  const line = ui.el("span", { class: "chat-line" });
  line.append(ui.el("strong", { text: title }));
  line.append(ui.el("span", { class: "when", text: ui.when ? ui.when(lead.lastMessageAt) : "" }));
  copy.append(line);
  copy.append(ui.el("span", { class: "preview", text: lead.report || (lead.handle ? "@" + lead.handle : "") }));
  const meta = ui.el("span", { class: "chat-meta" });
  meta.append(ui.el("span", { class: "status-pill " + pillTone(lead.state), text: stateName(lead.state) }));
  if (lead.ai) meta.append(ui.el("span", { class: "ai-badge", text: "AI" }));
  if (Number(lead.unread) > 0) meta.append(ui.el("span", { class: "unread-dot", "aria-label": String(lead.unread) }));
  button.append(copy, meta);
  button.addEventListener("click", () => {
    if (ui.openChat) ui.openChat(lead);
    else { flow.chat = lead.kind + ":" + lead.id; ui.paint(); }
  });
  return button;
}

function pillTone(state) {
  if (state === "discovering") return "discovering";
  if (state === "lost" || state === "unqualified") return "lost";
  if (state === "booked" || state === "proposal") return "booked";
  if (state === "paid") return "paid";
  return "open";
}

function threadPane(ui, lead) {
  const pane = ui.el("section", { class: "chat-thread" });
  const lang = ui.language ? ui.language() : "en";
  const flow = box(ui);
  if (!lead) {
    pane.append(sectionEmpty(ui, "chatsPick"));
    return pane;
  }
  const name = lead.name || (lead.handle ? "@" + lead.handle : "Chat");
  const head = ui.el("div", { class: "thread-head" });
  head.append(ui.el("span", { class: "biz-avatar", text: name.trim().charAt(0).toUpperCase() || "R" }));
  const who = ui.el("div");
  who.append(ui.el("strong", { text: name }));
  if (lead.handle) who.append(ui.el("small", { text: "@" + lead.handle }));
  const status = ui.el("select", { class: "status-pill " + pillTone(lead.state), "aria-label": "Status" });
  CRM_STATES.forEach(([value, label]) => status.append(ui.el("option", { value, text: label })));
  status.value = CRM_STATES.some(([value]) => value === lead.state) ? lead.state : "open";
  status.addEventListener("change", () => {
    if (ui.saveLead && ui.state.canEdit) ui.saveLead(lead, { crm_state: status.value, assigned_agent: lead.agent, ai_enabled: lead.ai, tags: lead.tags || [] });
  });
  const takeover = ui.el("button", {
    type: "button",
    id: "chat-ai-toggle",
    class: "status-pill",
    "aria-pressed": lead.ai ? "false" : "true"
  }, [lead.ai ? "AI on" : "Manual"]);
  takeover.addEventListener("click", () => {
    if (ui.saveLead && ui.state.canEdit) ui.saveLead(lead, { crm_state: status.value, assigned_agent: lead.agent, ai_enabled: !lead.ai, tags: lead.tags || [] });
  });
  const tools = ui.el("div", { class: "composer-tools" });
  const find = ui.el("button", { type: "button", class: "icon-btn", "aria-label": "Search" }, ["⌕"]);
  find.addEventListener("click", () => { const boxNode = document.getElementById("chat-search"); if (boxNode) boxNode.focus(); });
  const bell = ui.el("button", { type: "button", class: "icon-btn", "aria-label": "Notifications" }, ["!"]);
  bell.addEventListener("click", () => { const panel = document.getElementById("notify-panel"); if (panel) panel.hidden = !panel.hidden; });
  const refresh = ui.el("button", { type: "button", class: "icon-btn", "aria-label": "Refresh" }, ["↻"]);
  refresh.addEventListener("click", () => { if (ui.bootBusiness && ui.state.businessId) ui.bootBusiness(ui.state.businessId); });
  const toggle = ui.el("button", { type: "button", class: "icon-btn", "aria-label": sectionText(lang, "analysis") }, ["☰"]);
  toggle.addEventListener("click", () => { flow.analysisShut = !flow.analysisShut; ui.paint(); });
  tools.append(find, bell, refresh, toggle);
  head.append(who, status, takeover, tools);
  pane.append(head);
  const messages = threadMessages(ui, lead);
  const log = ui.el("div", { class: "bubbles" });
  if (!messages.length) log.append(ui.el("p", { text: "No chat history yet. Status and a summary sync today." }));
  let day = "";
  messages.forEach((message) => {
    const stamp = message.at ? String(message.at).slice(0, 10) : "";
    if (stamp && stamp !== day) {
      day = stamp;
      log.append(ui.el("p", { class: "day-sep", text: stamp }));
    }
    const kind = bubbleKind(message);
    const failed = message.delivery_status === "failed";
    const line = ui.el("div", { class: "bubble " + kind + (failed ? " failed" : "") });
    line.append(ui.el("span", { class: "who", text: bubbleLabel(kind) }));
    if (message.body) line.append(ui.el("p", { text: message.body }));
    if (message.at) line.append(ui.el("time", { text: ui.when ? ui.when(message.at) : String(message.at).slice(0, 16).replace("T", " ") }));
    if (message.delivery_status === "sending") line.append(ui.el("span", { class: "send-state", text: "Sending" }));
    if (message.delivery_status === "sent" && kind !== "lead") line.append(ui.el("span", { class: "send-state", text: "Sent" }));
    if (failed) {
      line.append(ui.el("span", { class: "send-state", text: "Failed" }));
      if (ui.sendInboxReply) line.append(ui.button("Retry", () => ui.sendInboxReply(lead, message.body, message.id)));
    }
    if (message.playbackUrl) line.append(ui.el("audio", { controls: true, preload: "none", src: message.playbackUrl }));
    log.append(line);
  });
  const pending = ui.state.chatSend;
  if (pending && pending.contactId === lead.id && pending.status !== "sent") {
    const pendingLine = ui.el("div", { class: "bubble human" + (pending.status === "failed" ? " failed" : "") });
    pendingLine.append(ui.el("span", { class: "who", text: "You" }));
    pendingLine.append(ui.el("p", { text: pending.body || "" }));
    pendingLine.append(ui.el("span", { class: "send-state", text: pending.status === "failed" ? "Failed" : "Sending" }));
    if (pending.status === "failed" && ui.sendInboxReply) pendingLine.append(ui.button("Retry", () => ui.sendInboxReply(lead, pending.body, pending.messageId)));
    log.append(pendingLine);
  }
  pane.append(log);
  if (ui.state.threadMore && ui.loadEarlier) pane.append(ui.button("Load earlier", () => ui.loadEarlier()));
  if (ui.state.canEdit && lead.kind === "contact") pane.append(composer(ui, lead, messages, lang));
  else if (ui.state.canEdit) pane.append(ui.button("Draft a reply", () => ui.draftReply(lead, messages)));
  return pane;
}

function composer(ui, lead, messages, lang) {
  const flow = box(ui);
  const composerNode = ui.el("form", { class: "chat-composer composer" });
  const reply = ui.el("textarea", { rows: "3", "aria-label": "Reply" });
  reply.value = ui.state.chatDraft || "";
  reply.addEventListener("input", () => { ui.state.chatDraft = reply.value; });
  const tools = ui.el("div", { class: "composer-tools" });
  const emoji = ui.el("button", { type: "button", class: "icon-btn", "aria-label": "Emoji" }, ["☺"]);
  const emojiRow = ui.el("div", { class: "composer-tools", hidden: true });
  ["👍", "🙌", "✨"].forEach((mark) => {
    const pick = ui.el("button", { type: "button" }, [mark]);
    pick.addEventListener("click", () => { reply.value += mark; ui.state.chatDraft = reply.value; reply.focus(); });
    emojiRow.append(pick);
  });
  emoji.addEventListener("click", () => { emojiRow.hidden = !emojiRow.hidden; });
  const file = ui.el("input", { type: "file", hidden: true, "aria-label": "Attach" });
  const attach = ui.el("button", { type: "button", class: "icon-btn", "aria-label": "Attach" }, ["＋"]);
  attach.addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    file.value = "";
    ui.toast(lang === "es" ? "El archivo se queda en este panel. No se envía." : "The file stays in this panel. Nothing is sent.");
  });
  const follow = ui.el("select", { "aria-label": sectionText(lang, "followSelect") });
  [["4", sectionText(lang, "followSelect")], ["1", "1h"], ["12", "12h"], ["23", "23h"]].forEach(([value, label]) => follow.append(ui.el("option", { value, text: label })));
  follow.value = flow.followHours || "4";
  follow.addEventListener("change", () => { flow.followHours = follow.value; });
  const voice = ui.el("button", { type: "button", class: "icon-btn", "aria-label": lang === "es" ? "Nota de voz" : "Voice note" }, ["♫"]);
  voice.addEventListener("click", () => ui.toast(lang === "es" ? "Las notas de voz se eligen en Contenido. Desde aquí no se graba nada." : "Voice notes are chosen in Content. Nothing is recorded here."));
  const text = ui.el("button", { type: "button", class: "icon-btn", "aria-label": lang === "es" ? "Texto" : "Text" }, ["T"]);
  text.addEventListener("click", () => reply.focus());
  const assign = ui.el("button", { type: "button", class: "icon-btn", "aria-label": lang === "es" ? "Asignar" : "Assign" }, ["@" ]);
  assign.addEventListener("click", () => ui.toast(lang === "es" ? "La asignación se queda en este panel. No se envía nada." : "Assignment stays in this panel. Nothing is sent."));
  const ai = ui.el("button", { type: "button", class: "icon-btn", "aria-label": "AI" }, ["AI"]);
  ai.addEventListener("click", () => ui.toast(lang === "es" ? "La IA no se enciende desde aquí. No se envía nada." : "AI is not switched on from here. Nothing is sent."));
  const schedule = ui.el("button", { type: "button", class: "icon-btn", "aria-label": lang === "es" ? "Programar" : "Schedule" }, ["◷"]);
  schedule.addEventListener("click", () => ui.toast(lang === "es" ? "Nada se programa ni se envía desde aquí." : "Nothing is scheduled or sent from here."));
  tools.append(emoji, text, attach, file, follow, assign, ai, schedule, voice);
  const actions = ui.el("div", { class: "filters" });
  actions.append(ui.button("Send reply", (event) => {
    event.preventDefault();
    if (ui.sendInboxReply) ui.sendInboxReply(lead, reply.value);
  }));
  actions.append(ui.button("Draft a reply", (event) => {
    event.preventDefault();
    ui.draftReply(lead, messages);
  }));
  composerNode.append(tools, emojiRow, reply, actions);
  composerNode.addEventListener("submit", (event) => event.preventDefault());
  if (!lead.ai) composerNode.append(ui.el("p", { class: "mute", text: "AI is paused on this chat. A reply you send still goes out." }));
  return composerNode;
}

function leadPane(ui, lead) {
  const pane = ui.el("aside", { class: "chat-lead analysis" });
  const lang = ui.language ? ui.language() : "en";
  pane.append(ui.el("h3", { text: sectionText(lang, "analysis") }));
  if (!lead) {
    pane.append(ui.el("p", { text: "Lead details appear here." }));
    return pane;
  }
  const messages = threadMessages(ui, lead);
  const name = lead.name || (lead.handle ? "@" + lead.handle : "Lead");
  const info = ui.el("details", { open: true });
  info.append(ui.el("summary", { text: sectionText(lang, "clientInfo") }));
  const person = ui.el("div", { class: "person" });
  person.append(ui.el("span", { class: "biz-avatar", text: name.trim().charAt(0).toUpperCase() || "R" }), ui.el("strong", { text: name }));
  const automated = check(ui, sectionText(lang, "automated"), lead.ai);
  const channel = ui.el("div", { class: "info-tile" });
  channel.append(ui.el("span", { text: "Instagram" }), ui.el("strong", { text: lead.handle ? "@" + lead.handle : "—" }));
  const followers = ui.el("div", { class: "info-tile" });
  const followBits = [
    lead.followers == null ? "" : String(lead.followers),
    lead.theyFollow ? (lang === "es" ? "te sigue" : "follows you") : "",
    lead.weFollow ? (lang === "es" ? "lo sigues" : "you follow") : ""
  ].filter(Boolean).join(" · ");
  followers.append(ui.el("span", { text: lang === "es" ? "Seguidores" : "Followers" }), ui.el("strong", { text: followBits || "—" }));
  info.append(person, automated.label, channel, followers, ui.el("p", { text: lead.bio || (lang === "es" ? "Sin perfil público guardado." : "No public profile stored.") }), ui.el("p", { text: (lang === "es" ? "Etapa: " : "Stage: ") + stateName(lead.state) }));
  const tags = ui.field("Tags", (lead.tags || []).join(", "));
  info.append(tags.label);
  if (ui.state.canEdit) {
    info.append(ui.button("Save chat lead", () => ui.saveLead(lead, {
      crm_state: lead.state,
      assigned_agent: lead.agent,
      ai_enabled: automated.input.checked,
      tags: tags.input.value.split(",").map((tag) => tag.trim()).filter(Boolean)
    })));
  }
  const notes = ui.el("details");
  notes.append(ui.el("summary", { text: sectionText(lang, "notes") }));
  const reminders = (ui.state.reminders || []).filter((reminder) => reminder.status !== "done" && (lead.kind === "contact" ? reminder.contact_id === lead.id : reminder.target_id === lead.id));
  if (!reminders.length) notes.append(ui.el("p", { text: "No open reminders." }));
  reminders.forEach((reminder) => notes.append(ui.el("p", { text: reminder.title })));
  const title = ui.field("Reminder", "");
  const due = ui.field("Due", "", "datetime-local");
  notes.append(title.label, due.label);
  if (ui.state.canEdit) {
    notes.append(ui.button("Save reminder", () => {
      if (!title.input.value.trim() || !due.input.value) return ui.toast("Add a title and a time.", "bad");
      ui.saveReminder({
        contact_id: lead.kind === "contact" ? lead.id : null,
        target_id: lead.kind === "target" ? lead.id : null,
        title: title.input.value.trim(),
        due_at: new Date(due.input.value).toISOString(),
        kind: "task",
        source: "manual"
      });
    }));
  }
  const noteBox = ui.el("textarea", { rows: "3", "aria-label": "Notes" });
  const savedNotes = (ui.state.leadNotes || []).filter((note) => lead.kind === "contact" ? note.contact_id === lead.id : note.target_id === lead.id);
  savedNotes.forEach((note) => notes.append(ui.el("p", { text: note.body })));
  const report = ui.el("details");
  report.append(ui.el("summary", { text: "Conversation summary" }));
  const reportBody = ui.el("p", { text: lead.report || (lang === "es" ? "Todavía no hay informe." : "No report yet.") });
  const getReport = ui.button(sectionText(lang, "getReport"), () => {
    if (lead.report) reportBody.textContent = lead.report;
    else window.dispatchEvent(new CustomEvent("roleflow-ask", { detail: { message: "Summarize this conversation.", mode: "report" } }));
  });
  report.hidden = true;
  const exp = ui.el("details");
  exp.append(ui.el("summary", { text: sectionText(lang, "exportChat") }));
  const row = ui.el("div", { class: "filters" });
  row.append(ui.button("CSV", () => download("chat.csv", exportThread(messages, "csv"), "text/csv")));
  row.append(ui.button("JSON", () => download("chat.json", exportThread(messages, "json"), "application/json")));
  row.append(ui.button("TXT", () => download("chat.txt", exportThread(messages, "txt"), "text/plain")));
  row.append(ui.button("XML", () => download("chat.xml", exportXml(messages), "application/xml")));
  exp.append(row);
  if (ui.state.canEdit && ui.addLeadNote) notes.append(noteBox, ui.button("Save note", () => ui.addLeadNote(lead, noteBox.value)));
  pane.append(info, notes, exp);
  return pane;
}

function summarySection(ui, lead, leads) {
  const section = ui.el("section", { class: "chat-summary", id: "conversation-summary" });
  const flow = box(ui);
  const days = flow.summaryDays || 7;
  section.append(ui.el("h3", { text: "Conversation summary" }));
  const chips = ui.el("div", { class: "desk-filters" });
  [7, 30].forEach((span) => {
    const button = ui.el("button", { type: "button", "aria-pressed": days === span ? "true" : "false" }, [span + " days"]);
    button.addEventListener("click", () => {
      flow.summaryDays = span;
      if (ui.loadChatSummary) ui.loadChatSummary(lead, false);
      else ui.paint();
    });
    chips.append(button);
  });
  section.append(chips);
  if (ui.loadChatSummary) section.append(ui.button("Regenerate", () => ui.loadChatSummary(lead, true)));
  const summary = ui.state.chatSummary || emptySummary(leads);
  if (!leads.length || summary.empty) {
    section.append(ui.el("p", { text: "No conversations in this period." }));
    return section;
  }
  const aggregate = summary.aggregate || aggregateFromLeads(leads);
  const counts = ui.el("div", { class: "kpi-row" });
  [["Conversations", aggregate.conversations], ["Booked calls", aggregate.booked], ["Need a person", aggregate.needsHuman]].forEach(([label, value]) => {
    const card = ui.el("article", { class: "kpi" });
    card.append(ui.el("span", { text: label }), ui.el("strong", { text: String(value || 0) }));
    counts.append(card);
  });
  section.append(counts);
  const outcomes = aggregate.byOutcome || {};
  section.append(ui.el("p", { text: "New " + (outcomes.new || 0) + " · Qualified " + (outcomes.qualified || 0) + " · Booked " + (outcomes.booked || 0) + " · Lost " + (outcomes.lost || 0) }));
  const sentVoices = (ui.state.voiceSends || []).filter((row) => row.result === "sent");
  if (sentVoices.length) section.append(ui.el("p", { text: "Voice notes sent: " + sentVoices.length }));
  section.append(ui.el("p", { text: "Common objections: " + ((aggregate.objections || []).join("; ") || "—") }));
  section.append(ui.el("p", { text: "Top questions: " + ((aggregate.questions || []).join("; ") || "—") }));
  if (lead) {
    const fields = summaryFields(summary.conversation);
    const card = ui.el("article", { class: "agent" });
    card.append(ui.el("h3", { text: "This conversation" }));
    if (!summary.conversation) card.append(ui.el("p", { text: "No summary for this conversation yet." }));
    else {
      card.append(ui.el("p", { text: "Situation: " + (fields.situation || "—") }));
      card.append(ui.el("p", { text: "Goal: " + (fields.goal || "—") }));
      card.append(ui.el("p", { text: "Objections: " + (fields.objections.length ? fields.objections.join("; ") : "—") }));
      card.append(ui.el("p", { text: "Offer: " + (fields.offer || "—") }));
      card.append(ui.el("p", { text: "Outcome: " + (fields.outcome || "—") }));
      card.append(ui.el("p", { text: "Next step: " + (fields.next || "—") }));
    }
    section.append(card);
  }
  return section;
}

function exportXml(messages) {
  const body = (messages || []).map((message) => "<message role=\"" + (message.role || "") + "\"><body>" + String(message.body || "").replace(/[<>&]/g, "") + "</body></message>").join("");
  return "<?xml version=\"1.0\"?><conversation>" + body + "</conversation>";
}

function threadMessages(ui, lead) {
  if (lead.kind !== "contact") return [];
  const conversations = (ui.state.conversations || []).filter((row) => row.contact_id === lead.id).map((row) => row.id);
  return (ui.state.engineMessages || []).filter((row) => conversations.includes(row.conversation_id)).map((row) => ({
    role: row.role === "assistant" ? "assistant" : "user",
    sender: row.sender || "",
    body: row.body,
    at: row.sent_at || row.created_at,
    playbackUrl: row.playbackUrl || "",
    mediaKind: row.mediaKind || ""
  }));
}

function check(ui, label, checked) {
  const wrap = ui.el("label", { class: "switch", text: " " + label });
  const input = ui.el("input", { type: "checkbox" });
  input.checked = checked === true;
  wrap.prepend(input);
  return { label: wrap, input };
}

function roleName(id) {
  const found = ROLES.find((role) => role.id === id);
  return found ? found.name : id;
}

function stateName(id) {
  const found = CRM_STATES.find((state) => state[0] === id);
  return found ? found[1] : id;
}
