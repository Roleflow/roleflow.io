import {
  QUESTIONS, CRM_STATES, DAYS, WEBHOOK_EVENTS, SCOPES, REPLY_BUCKETS,
  officeError, delayError, webhookError, tagError, scopeError,
  inRange, conversationsPerDay, agentPerformance, tagConversion, linkConversions,
  funnel, followupRate, replyBuckets, heatmaps, originBreakdown, topOrigins,
  projectRevenue, checklist, nextStep, commandItems, filterCommands, snippet, originCsv
} from "./studio-ops-model.js";

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function renderConfiguration(ui) {
  const wrap = ui.el("div", { class: "platform-home" });
  wrap.append(ui.pageHeader(ui, "Configuration", "Eight questions. Saving stays in this panel. Live setter sync is off.", "configuration", "settings"));
  const layout = ui.el("div", { class: "config-layout" });
  const list = ui.el("div", { class: "config-list" });
  const search = ui.el("input", { type: "search", placeholder: "Search settings", "aria-label": "Search settings" });
  const questions = ui.el("div");
  list.append(search, questions);
  const panel = ui.el("div", { id: "config-panel" });
  layout.append(list, panel);
  wrap.append(layout);
  const draw = () => {
    const query = search.value.trim().toLowerCase();
    questions.replaceChildren();
    QUESTIONS.filter((item) => !query || item.q.toLowerCase().includes(query)).forEach((item) => {
      const button = ui.el("button", { type: "button", "data-command": "cfg-" + item.id, "aria-pressed": ui.state.configKey === item.id ? "true" : "false" }, [item.q]);
      button.addEventListener("click", () => {
        ui.state.configKey = item.id;
        ui.paint();
      });
      questions.append(button);
    });
    if (!questions.childElementCount) questions.append(ui.el("p", { text: "No matching question." }));
    panel.replaceChildren(configBody(ui, ui.state.configKey));
  };
  search.addEventListener("input", draw);
  draw();
  return wrap;
}

function configBody(ui, key) {
  if (key === "who") return whoBody(ui);
  if (key === "stop") return stopBody(ui);
  if (key === "write") return writeBody(ui);
  if (key === "file") return fileBody(ui);
  if (key === "notify") return notifyBody(ui);
  if (key === "connect") return connectBody(ui);
  if (key === "business") return businessBody(ui);
  return replyBody(ui);
}

function replyBody(ui) {
  const settings = ui.state.settings || {};
  const card = ui.el("form", { class: "agent", "data-command": "cfg-reply" });
  card.append(ui.el("h3", { text: "When does the AI answer?" }));
  const enabled = switchLabel(ui, "AI answers messages", settings.system_enabled === true);
  const mode = ui.el("select", { "aria-label": "Office hours" });
  [["always", "24 hours"], ["same", "Same hours every day"], ["per_day", "Different hours each day"]].forEach(([value, label]) => {
    const option = ui.el("option", { value, text: label });
    if ((settings.office_mode || "same") === value) option.selected = true;
    mode.append(option);
  });
  const tz = ui.field("Timezone", settings.timezone || "Europe/Madrid");
  const start = ui.field("Opens", ui.shortTime(settings.office_start, "09:00"), "time");
  const end = ui.field("Closes", ui.shortTime(settings.office_end, "18:00"), "time");
  const min = ui.field("Reply delay from (seconds)", settings.reply_delay_seconds == null ? 30 : settings.reply_delay_seconds, "number");
  const max = ui.field("Reply delay to (seconds)", settings.reply_delay_max_seconds == null ? 120 : settings.reply_delay_max_seconds, "number");
  card.append(enabled.label, ui.el("label", { text: "Hours" }, [mode]), tz.label, start.label, end.label);
  const days = ui.el("div", { class: "day-hours" });
  const dayInputs = {};
  const stored = settings.hours_by_day || {};
  DAYS.forEach((day) => {
    const row = stored[day] || {};
    const open = ui.el("input", { type: "time", value: row.start || "09:00", "aria-label": day + " opens" });
    const close = ui.el("input", { type: "time", value: row.end || "18:00", "aria-label": day + " closes" });
    dayInputs[day] = { open, close };
    days.append(ui.el("p", {}, [ui.el("span", { text: day }), open, close]));
  });
  card.append(days, min.label, max.label);
  card.append(ui.el("p", { class: "mute", text: "The delay is a range. A reply waits a random time inside it. This save does not change the live setter." }));
  if (ui.state.canEdit) card.append(ui.button("Save", (event) => {
    event.preventDefault();
    const problem = officeError(mode.value) || delayError(min.input.value, max.input.value);
    if (problem) return ui.toast(problem, "bad");
    const hours = {};
    DAYS.forEach((day) => { hours[day] = { start: dayInputs[day].open.value || "09:00", end: dayInputs[day].close.value || "18:00" }; });
    ui.patchSettings({
      system_enabled: enabled.input.checked,
      office_mode: mode.value,
      timezone: tz.input.value.trim() || "Europe/Madrid",
      office_start: start.input.value || "09:00",
      office_end: end.input.value || "18:00",
      hours_by_day: hours,
      reply_delay_seconds: Number(min.input.value),
      reply_delay_max_seconds: Number(max.input.value)
    });
  }));
  card.addEventListener("submit", (event) => event.preventDefault());
  return card;
}

function whoBody(ui) {
  const settings = ui.state.settings || {};
  const card = ui.el("form", { class: "agent", "data-command": "cfg-who" });
  card.append(ui.el("h3", { text: "Who does it answer?" }));
  const keyword = switchLabel(ui, "Only answer when a keyword matches", settings.keyword_only === true);
  const skip = switchLabel(ui, "Skip accounts this business already follows", settings.skip_followed === true);
  const batch = ui.el("textarea", { rows: "4", "aria-label": "Ignored users", placeholder: "One handle per line" });
  card.append(keyword.label, skip.label, ui.el("h3", { text: "Ignored users" }));
  if (!(ui.state.dnc || []).length) card.append(ui.el("p", { text: "No ignored handles yet." }));
  (ui.state.dnc || []).forEach((row) => card.append(ui.el("p", { text: "@" + row.handle })));
  card.append(batch);
  if (ui.state.canEdit && ui.importDnc) card.append(ui.button("Import do-not-contact list", () => ui.importDnc()));
  if (ui.state.canEdit) card.append(ui.button("Save", async (event) => {
    event.preventDefault();
    await ui.patchSettings({ keyword_only: keyword.input.checked, skip_followed: skip.input.checked });
    const handles = batch.value.split(/\n+/).map((line) => line.trim().replace(/^@/, "").toLowerCase()).filter((line) => /^[a-z0-9._]{1,30}$/.test(line));
    if (handles.length && ui.ignoreHandles) await ui.ignoreHandles(handles);
    else ui.toast("Saved.");
  }));
  card.addEventListener("submit", (event) => event.preventDefault());
  return card;
}

function stopBody(ui) {
  const settings = ui.state.settings || {};
  const card = ui.el("form", { class: "agent", "data-command": "cfg-stop" });
  card.append(ui.el("h3", { text: "When does it stop?" }));
  const human = switchLabel(ui, "A person replied in Instagram, so this thread becomes manual", settings.stop_on_human !== false);
  const first = switchLabel(ui, "The business wrote first, so the thread stays manual", settings.stop_on_business_first !== false);
  const link = switchLabel(ui, "Stop after a sales link is sent", settings.stop_after_link === true);
  const condition = ui.field("Custom condition for the AI", settings.stop_condition || "");
  card.append(human.label, first.label, link.label, condition.label);
  card.append(ui.el("p", { class: "mute", text: "These rules are stored here. They are not pushed to the live setter." }));
  if (ui.state.canEdit) card.append(ui.button("Save", (event) => {
    event.preventDefault();
    ui.patchSettings({
      stop_on_human: human.input.checked,
      stop_on_business_first: first.input.checked,
      stop_after_link: link.input.checked,
      stop_condition: condition.input.value.trim().slice(0, 500)
    });
  }));
  card.addEventListener("submit", (event) => event.preventDefault());
  return card;
}

function writeBody(ui) {
  const settings = ui.state.settings || {};
  const card = ui.el("form", { class: "agent", "data-command": "cfg-write" });
  card.append(ui.el("h3", { text: "How does it write?" }));
  const strip = switchLabel(ui, "Remove ¿ and ¡", settings.strip_inverted_punct === true);
  const notice = switchLabel(ui, "Add an AI disclosure when someone asks", settings.disclosure_enabled !== false);
  const text = ui.el("textarea", { rows: "3", "aria-label": "Disclosure text" });
  text.value = settings.disclosure_text || "Diego's team uses an AI assistant to keep up with conversations. Diego personally reviews them and takes the calls.";
  card.append(strip.label, notice.label, text);
  if (ui.state.canEdit) card.append(ui.button("Save", (event) => {
    event.preventDefault();
    ui.patchSettings({
      strip_inverted_punct: strip.input.checked,
      disclosure_enabled: notice.input.checked,
      disclosure_text: text.value.trim().slice(0, 400)
    });
  }));
  card.addEventListener("submit", (event) => event.preventDefault());
  return card;
}

function fileBody(ui) {
  const card = ui.el("div", { class: "agent", "data-command": "cfg-file" });
  card.append(ui.el("h3", { text: "How is the lead filed?" }));
  card.append(ui.el("p", { text: "Each state can have a condition the AI uses when it files a lead. Tags can match an AI judgment, a phrase, or an attachment." }));
  const rules = ui.state.stateRules || [];
  CRM_STATES.forEach((state) => {
    const current = rules.find((row) => row.crm_state === state);
    const field = ui.field(state, current ? current.condition : "");
    card.append(field.label);
    if (ui.state.canEdit) {
      const save = ui.button("Save " + state, () => ui.saveStateRule({ crm_state: state, condition: field.input.value.trim().slice(0, 400) }));
      save.classList.add("sm", "ghost");
      card.append(save);
    }
  });
  card.append(ui.el("h3", { text: "Tags" }));
  const tags = ui.state.tagRules || [];
  if (!tags.length) card.append(ui.el("p", { text: "No tag rules yet." }));
  tags.forEach((row) => {
    card.append(ui.el("p", { text: row.name + " · " + row.rule_kind + (row.notify_email ? " · email " + row.notify_email : "") }));
  });
  if (ui.state.canEdit) {
    const name = ui.field("Tag name", "");
    const kind = ui.el("select", { "aria-label": "Tag rule" });
    [["ai", "AI"], ["text", "Text"], ["attachment", "Attachment"]].forEach(([value, label]) => kind.append(ui.el("option", { value, text: label })));
    const rule = ui.field("Rule", "");
    const email = ui.field("Email to notify", "");
    card.append(name.label, kind, rule.label, email.label, ui.button("Add tag", () => {
      const row = { name: name.input.value, rule_kind: kind.value, rule_text: rule.input.value, notify_email: email.input.value.trim() };
      const problem = tagError(row);
      if (problem) return ui.toast(problem, "bad");
      ui.saveTagRule(row);
    }));
  }
  return card;
}

function notifyBody(ui) {
  const settings = ui.state.settings || {};
  const card = ui.el("form", { class: "agent", "data-command": "cfg-notify" });
  card.append(ui.el("h3", { text: "Who do we notify?" }));
  const booked = ui.field("Closer email when a lead is Booked", settings.notify_booked || "");
  const proposal = ui.field("Closer email when a lead is Proposal", settings.notify_proposal || "");
  const paid = ui.field("Closer email when a lead is Paid", settings.notify_paid || "");
  const manual = ui.field("Closer email when a thread becomes manual", settings.notify_manual || "");
  const extra = ui.el("textarea", { rows: "3", "aria-label": "Extra recipients" });
  extra.value = settings.notify_extra || "";
  card.append(booked.label, proposal.label, paid.label, manual.label, ui.el("p", { text: "Extra recipients, one email per line." }), extra);
  if (ui.state.canEdit) card.append(ui.button("Save", (event) => {
    event.preventDefault();
    const emails = [booked, proposal, paid, manual].map((field) => field.input.value.trim());
    if (emails.some((value) => value && !value.includes("@"))) return ui.toast("Use a full email address.", "bad");
    ui.patchSettings({
      notify_booked: emails[0],
      notify_proposal: emails[1],
      notify_paid: emails[2],
      notify_manual: emails[3],
      notify_extra: extra.value.trim().slice(0, 1000)
    });
  }));
  card.addEventListener("submit", (event) => event.preventDefault());
  return card;
}

function connectBody(ui) {
  const settings = ui.state.settings || {};
  const wrap = ui.el("div", { "data-command": "cfg-connect" });
  const hook = ui.el("form", { class: "agent" });
  hook.append(ui.el("h3", { text: "Custom webhook" }));
  hook.append(ui.el("p", { text: "Events are signed with HMAC-SHA256. The secret is stored encrypted and is not shown again." }));
  const rows = ui.state.webhooks || [];
  if (!rows.length) hook.append(ui.el("p", { text: "No webhook yet." }));
  rows.forEach((row) => {
    const line = ui.el("p", { text: row.url + (row.paused ? " · paused" : " · active") + (row.has_secret ? " · secret saved" : " · no secret") });
    hook.append(line);
    if (ui.state.canEdit) {
      const pause = ui.button(row.paused ? "Resume" : "Pause", () => ui.saveWebhook({ id: row.id, paused: !row.paused }));
      const test = ui.button("Send test", () => ui.testWebhook(row.id));
      pause.classList.add("sm", "ghost");
      test.classList.add("sm", "ghost");
      hook.append(pause, test);
    }
  });
  const url = ui.field("https URL", "https://");
  const secret = ui.field("Signing secret", "");
  secret.input.type = "password";
  const picked = new Set(["lead.created"]);
  const events = ui.el("div");
  WEBHOOK_EVENTS.forEach((name) => {
    const box = ui.el("input", { type: "checkbox" });
    box.checked = name === "lead.created";
    box.addEventListener("change", () => { if (box.checked) picked.add(name); else picked.delete(name); });
    events.append(ui.el("label", { class: "switch", text: " " + name }, [box]));
  });
  hook.append(url.label, secret.label, events);
  if (ui.state.canEdit) hook.append(ui.button("Save webhook", async (event) => {
    event.preventDefault();
    const problem = webhookError(url.input.value.trim(), [...picked]);
    if (problem) return ui.toast(problem, "bad");
    await ui.saveWebhook({ url: url.input.value.trim(), events: [...picked], secret: secret.input.value });
  }));
  hook.addEventListener("submit", (event) => event.preventDefault());
  wrap.append(hook);
  const soon = ui.el("section", { class: "agent" });
  soon.append(ui.el("h3", { text: "Other tools" }));
  ["GoHighLevel", "HubSpot", "Kommo", "Airtable"].forEach((name) => {
    soon.append(ui.el("p", { text: name + " · coming soon" }));
  });
  wrap.append(soon);
  const convert = ui.el("section", { class: "agent" });
  convert.append(ui.el("h3", { text: "Conversion tracking" }));
  const param = ui.field("Lead id parameter", settings.conversion_param || "lead");
  const target = ui.el("select", { "aria-label": "Move the lead to" });
  ["Booked", "Paid"].forEach((name) => {
    const option = ui.el("option", { value: name, text: name });
    if ((settings.conversion_state || "Booked") === name) option.selected = true;
    target.append(option);
  });
  const code = ui.el("textarea", { rows: "8", readonly: "readonly", "aria-label": "Conversion snippet" });
  const drawSnippet = () => {
    code.value = snippet(param.input.value, target.value, "https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/roleflow-hooks");
  };
  param.input.addEventListener("input", drawSnippet);
  target.addEventListener("change", drawSnippet);
  drawSnippet();
  convert.append(param.label, target, code);
  convert.append(ui.el("p", { class: "mute", text: "Replace YOUR_WORKSPACE_KEY with a key from below. The key is shown once." }));
  if (ui.state.canEdit) convert.append(ui.button("Save conversion", () => ui.patchSettings({
    conversion_param: (param.input.value.trim().replace(/[^a-z0-9_]/gi, "") || "lead").slice(0, 32),
    conversion_state: target.value
  })));
  wrap.append(convert);
  const keys = ui.el("section", { class: "agent" });
  keys.append(ui.el("h3", { text: "Workspace API keys" }));
  const list = ui.state.apiKeys || [];
  if (!list.length) keys.append(ui.el("p", { text: "No keys yet." }));
  list.forEach((row) => {
    keys.append(ui.el("p", { text: row.prefix + "… · " + (row.label || "Key") + (row.revoked_at ? " · revoked" : "") }));
    if (ui.state.canEdit && !row.revoked_at) {
      const revoke = ui.button("Revoke", () => ui.revokeApiKey(row.id));
      revoke.classList.add("sm", "ghost");
      keys.append(revoke);
    }
  });
  if (ui.state.revealedKey) keys.append(ui.el("p", { text: "Copy this key now. It will not be shown again: " + ui.state.revealedKey }));
  if (ui.state.canEdit) {
    const label = ui.field("Key label", "Website");
    keys.append(label.label, ui.button("Create key", () => ui.createApiKey(label.input.value.trim() || "Website")));
  }
  wrap.append(keys);
  const host = ui.el("div");
  if (ui.renderEngine) ui.renderEngine("integrations", host);
  wrap.append(host);
  return wrap;
}

function businessBody(ui) {
  const card = ui.el("form", { class: "agent", "data-command": "cfg-business" });
  card.append(ui.el("h3", { text: "Business" }));
  const current = (ui.state.businesses || []).find((row) => row.id === ui.state.businessId);
  card.append(ui.el("p", { text: current ? current.name : "This business" }));
  card.append(ui.el("p", { text: "Clone copies the brief, agent instructions, links, content titles, follow-ups, and these settings. Leads, uploaded files, and keys stay with the original. The new business starts with the AI off." }));
  const name = ui.field("New business name", current ? current.name + " copy" : "");
  card.append(name.label);
  if (ui.state.canEdit) card.append(ui.button("Clone business", (event) => {
    event.preventDefault();
    ui.cloneBusiness(name.input.value.trim());
  }));
  card.addEventListener("submit", (event) => event.preventDefault());
  return card;
}

export function renderStats(ui) {
  const wrap = ui.el("div", { class: "platform-home" });
  wrap.append(ui.pageHeader(ui, "Stats", "Counts for the range you pick. A chart with no rows says so.", "stats", "chart"));
  const filters = ui.el("div", { class: "filters", role: "toolbar", "aria-label": "Date range" });
  [7, 30, 90, 365].forEach((days) => {
    const chip = ui.el("button", { type: "button", "aria-pressed": ui.state.rangeDays === days ? "true" : "false" }, [days === 365 ? "Last 12 months" : "Last " + days + " days"]);
    chip.addEventListener("click", () => { ui.state.rangeDays = days; ui.paint(); });
    filters.append(chip);
  });
  wrap.append(filters);
  const days = ui.state.rangeDays || 30;
  const leads = inRange(snapshotLeads(ui), days, "updated");
  const targets = inRange(ui.state.targets, days);
  const paid = leads.filter((row) => String(row.crm_state).toLowerCase() === "paid" || row.lead_status === "converted").length;
  const booked = leads.filter((row) => ["booked", "paid"].includes(String(row.crm_state).toLowerCase()) || row.lead_status === "converted").length;
  const kpis = ui.el("div", { class: "kpis" });
  [
    ["Leads", String(leads.length), leads.length ? "In this range" : "No leads in this range"],
    ["Booked or paid", String(booked), booked ? "Booked and paid" : "None in this range"],
    ["Paid", String(paid), paid ? "Paid leads" : "No paid leads in this range"],
    ["Follow-up response", rateText(ui, followupRate(targets)), "Among targets with a follow-up"]
  ].forEach(([label, value, note]) => {
    const card = ui.el("article", { class: "kpi" });
    card.append(ui.el("span", { text: label }), ui.el("strong", { text: value }), ui.el("em", { text: note }));
    kpis.append(card);
  });
  wrap.append(kpis);
  const stamps = leads.map((row) => ({ at: row.updated || row.created_at }));
  wrap.append(chartBlock(ui, "Conversations per day", conversationsPerDay(stamps, Math.min(days, 31)).map((row) => ({ label: row.day.slice(5), value: row.count })), "How many conversations happened each day in this range?"));
  wrap.append(tableBlock(ui, "Per agent", ["Agent", "Leads", "Paid"], agentPerformance(leads).map((row) => [row.agent, String(row.leads), String(row.paid)]), "No assigned agents in this range.", "How are agents performing in this range?"));
  const tags = tagConversion(leads);
  wrap.append(tableBlock(ui, "Tag conversion", ["Tag", "Leads", "Paid", "Rate"], tags.map((row) => [row.tag, String(row.leads), String(row.paid), rateText(ui, row.rate)]), "No tags in this range.", "Which tags convert?"));
  wrap.append(tableBlock(ui, "Sales links", ["Link", "Leads", "Paid", "Rate"], linkConversions(leads, ui.state.offerLinks).map((row) => [row.name, String(row.leads), String(row.paid), rateText(ui, row.rate)]), "No sales links yet.", "Which sales links convert?"));
  const assets = ui.state.valueAssets || [];
  wrap.append(tableBlock(ui, "Value content", ["Content", "Sends"], assets.map((row) => [row.title || row.kind, "No sends recorded"]), "No value content yet.", "Which content is being sent?"));
  const welcome = ui.el("section", { class: "agent" });
  welcome.append(ui.el("h3", { text: "Welcome message response" }), ui.el("p", { text: "Not enough welcome sends to rate." }), explainButton(ui, "What is the welcome message response rate?"));
  wrap.append(welcome);
  const mode = ui.state.funnelMode || "all";
  const funnelCard = ui.el("section", { class: "agent" });
  funnelCard.append(ui.el("h3", { text: "Funnel" }));
  const modes = ui.el("div", { class: "filters" });
  ["all", "outbound", "inbound"].forEach((name) => {
    const chip = ui.el("button", { type: "button", "aria-pressed": mode === name ? "true" : "false" }, [name]);
    chip.addEventListener("click", () => { ui.state.funnelMode = name; ui.paint(); });
    modes.append(chip);
  });
  funnelCard.append(modes);
  funnel(targets, mode).forEach((row) => funnelCard.append(ui.el("p", { text: row.stage + " · " + row.count })));
  funnelCard.append(explainButton(ui, "Explain the " + mode + " funnel."));
  wrap.append(funnelCard);
  const buckets = replyBuckets(ui.state.engineMessages || []);
  const bucketCard = ui.el("section", { class: "agent" });
  bucketCard.append(ui.el("h3", { text: "Reply time" }));
  if (!buckets.pairs) bucketCard.append(ui.el("p", { text: "No reply pairs in the stored messages yet." }));
  REPLY_BUCKETS.forEach((bucket) => bucketCard.append(ui.el("p", { text: bucket.label + " · " + buckets.counts[bucket.id] })));
  bucketCard.append(explainButton(ui, "Explain the reply time buckets."));
  wrap.append(bucketCard);
  const heat = heatmaps(leads.map((row) => row.updated).filter(Boolean));
  wrap.append(heatBlock(ui, "Weekday", WEEK.map((label, index) => ({ label, value: heat.weekday[index] })), "Which weekdays are busiest?"));
  wrap.append(heatBlock(ui, "Hour (UTC)", heat.hour.map((value, index) => ({ label: String(index), value })), "Which hours are busiest?"));
  return wrap;
}

export function renderPerformance(ui) {
  const wrap = ui.el("div", { class: "platform-home" });
  wrap.append(ui.pageHeader(ui, "Performance", "Where leads started: story, post, reel, ad, or a keyword you name.", "performance", "trend"));
  const days = ui.state.rangeDays || 30;
  const leads = inRange(snapshotLeads(ui), days, "updated");
  const rows = originBreakdown(leads, ui.state.origins || []);
  const top = topOrigins(rows, 10);
  wrap.append(chartBlock(ui, "Top origins", top.map((row) => ({ label: row.origin, value: row.leads })), "Which origins bring leads?"));
  const table = ui.el("table", { class: "leads" });
  const head = ui.el("tr");
  ["Origin", "Leads", "Paid"].forEach((label) => head.append(ui.el("th", { text: label })));
  table.append(ui.el("thead", {}, [head]));
  const body = ui.el("tbody");
  if (!rows.length) body.append(ui.el("tr", {}, [ui.el("td", { colspan: "3", text: "No origin is recorded for this range yet." })]));
  rows.forEach((row) => body.append(ui.el("tr", {}, [ui.el("td", { text: row.origin }), ui.el("td", { text: String(row.leads) }), ui.el("td", { text: String(row.paid) })])));
  table.append(body);
  wrap.append(ui.el("div", { class: "table-wrap" }, [table]));
  const actions = ui.el("div", { class: "filters" });
  const csv = ui.button("Download CSV", () => download("origins.csv", originCsv(rows)));
  csv.classList.add("ghost");
  actions.append(csv, explainButton(ui, "Explain performance by origin."));
  wrap.append(actions);
  if (ui.state.canEdit) {
    const form = ui.el("form", { class: "agent" });
    form.append(ui.el("h3", { text: "Custom origin" }));
    const name = ui.field("Name", "");
    const keyword = ui.field("First-message keyword", "");
    form.append(name.label, keyword.label, ui.button("Add origin", (event) => {
      event.preventDefault();
      ui.saveOrigin({ name: name.input.value.trim(), keyword: keyword.input.value.trim() });
    }));
    form.addEventListener("submit", (event) => event.preventDefault());
    wrap.append(form);
  }
  const calc = ui.el("form", { class: "agent" });
  calc.append(ui.el("h3", { text: "12-month projection" }));
  calc.append(ui.el("p", { text: "This uses the ticket and the deals per month you type. It is not revenue already earned." }));
  const ticket = ui.field("Average ticket", "1500", "number");
  const deals = ui.field("Deals per month", "4", "number");
  const out = ui.el("p", { text: "" });
  const draw = () => {
    const projected = projectRevenue(Math.round(Number(ticket.input.value) * 100), Number(deals.input.value));
    out.textContent = "Year " + ui.money(projected.yearCents) + " · month " + ui.money(projected.monthlyCents) + " · Roleflow share " + ui.money(projected.shareCents);
  };
  ticket.input.addEventListener("input", draw);
  deals.input.addEventListener("input", draw);
  draw();
  calc.append(ticket.label, deals.label, out);
  calc.addEventListener("submit", (event) => event.preventDefault());
  wrap.append(calc);
  return wrap;
}

export function renderTeam(ui) {
  const wrap = ui.el("div", { class: "platform-home" });
  wrap.append(ui.pageHeader(ui, "Team", "Invite by email, choose what they can open, and share a link.", "team", "userplus"));
  const business = (ui.state.businesses || []).find((row) => row.id === ui.state.businessId);
  const code = business && business.join_code;
  const card = ui.el("section", { class: "agent" });
  card.append(ui.el("h3", { text: "Invite link" }));
  if (!code) card.append(ui.el("p", { text: "This business has no join code yet." }));
  else card.append(ui.el("p", { text: location.origin + "/signup/?join=" + encodeURIComponent(code) }));
  if (ui.state.canEdit) {
    const regen = ui.button("Regenerate link", () => ui.regenerateJoin());
    regen.classList.add("ghost");
    card.append(regen);
  }
  wrap.append(card);
  const form = ui.el("form", { class: "agent" });
  form.append(ui.el("h3", { text: "Invite by email" }));
  const email = ui.field("Email", "");
  const picked = new Set(["conversations"]);
  const scopes = ui.el("div");
  SCOPES.forEach((scope) => {
    const box = ui.el("input", { type: "checkbox" });
    box.checked = scope.id === "conversations";
    box.addEventListener("change", () => { if (box.checked) picked.add(scope.id); else picked.delete(scope.id); });
    scopes.append(ui.el("label", { class: "switch", text: " " + scope.label }, [box]));
  });
  form.append(email.label, scopes);
  if (ui.state.canEdit) form.append(ui.button("Create invite", async (event) => {
    event.preventDefault();
    const problem = scopeError([...picked]);
    if (problem) return ui.toast(problem, "bad");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.input.value.trim())) return ui.toast("Enter an email.", "bad");
    await ui.createInvite({ email: email.input.value.trim(), scopes: [...picked] });
  }));
  form.addEventListener("submit", (event) => event.preventDefault());
  wrap.append(form);
  const pending = ui.state.invites || [];
  const open = ui.el("section", { class: "agent" });
  open.append(ui.el("h3", { text: "Open invites" }));
  if (!pending.length) open.append(ui.el("p", { text: "No open email invites." }));
  pending.filter((row) => !row.accepted_at).forEach((row) => {
    open.append(ui.el("p", { text: row.email + " · " + (row.scopes || []).join(", ") }));
    open.append(ui.el("p", { class: "mute", text: location.origin + "/signup/?invite=" + encodeURIComponent(row.token) }));
  });
  wrap.append(open);
  const list = ui.el("section", { class: "agent" });
  list.append(ui.el("h3", { text: "People" }));
  const members = ui.state.memberRows || [];
  if (!members.length) list.append(ui.el("p", { text: "No members on file yet." }));
  members.forEach((row) => {
    const profile = (ui.state.memberProfiles || []).find((item) => item.id === row.user_id);
    const who = profile && (profile.email || profile.full_name) ? (profile.email || profile.full_name) : "Member";
    const role = row.role === "owner" ? "Owner" : row.role === "editor" ? "Editor" : "Viewer";
    const scopeText = (row.scopes || []).length ? row.scopes.join(", ") : "conversations, configuration, analysis";
    list.append(ui.el("p", { text: who + " · " + role + " · " + scopeText }));
  });
  wrap.append(list);
  return wrap;
}

export function bindOps(ui) {
  const modal = document.getElementById("command-modal");
  const input = document.getElementById("command-input");
  const results = document.getElementById("command-results");
  if (!modal || !input || !results) return;
  const close = () => { modal.hidden = true; };
  document.getElementById("command-close")?.addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      modal.hidden = false;
      input.value = "";
      draw("");
      input.focus();
    }
    if (event.key === "Escape") close();
  });
  input.addEventListener("input", () => draw(input.value));
  function draw(query) {
    results.replaceChildren();
    filterCommands(commandItems(), query).slice(0, 12).forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label + " · " + item.hint;
      button.addEventListener("click", () => {
        if (item.key) ui.state.configKey = item.key;
        ui.state.highlight = item.highlight || "";
        close();
        if (location.hash.replace("#", "") === item.tab) ui.paint();
        else location.hash = item.tab;
      });
      results.append(button);
    });
  }
  const bell = document.getElementById("notify-open");
  const panel = document.getElementById("notify-panel");
  if (bell && panel) bell.addEventListener("click", () => { panel.hidden = !panel.hidden; });
}

export function paintChrome(ui) {
  const host = document.getElementById("next-step");
  if (host) {
    const step = nextStep(checklist(ui.state));
    host.replaceChildren();
    if (!step) host.hidden = true;
    else {
      host.hidden = false;
      host.append(ui.el("p", { text: "Next step" }), ui.el("strong", { text: step.label }));
      const go = ui.el("a", { href: "#" + step.tab }, ["Open"]);
      go.addEventListener("click", () => {
        if (step.key) ui.state.configKey = step.key;
        ui.state.highlight = step.key ? "cfg-" + step.key : "";
      });
      host.append(go);
    }
  }
  const panel = document.getElementById("notify-panel");
  const bell = document.getElementById("notify-open");
  if (panel) {
    const rows = ui.state.notifications || [];
    const unread = rows.filter((row) => !row.read_at).length;
    if (bell) bell.textContent = unread ? "Notifications (" + unread + ")" : "Notifications";
    panel.replaceChildren();
    if (!rows.length) panel.append(ui.el("p", { text: "No notifications yet." }));
    rows.slice(0, 12).forEach((row) => {
      const line = ui.el("button", { type: "button" }, [row.title]);
      line.addEventListener("click", () => ui.markNotification(row.id));
      panel.append(line, ui.el("p", { class: "mute", text: row.body || "" }));
    });
  }
  if (ui.state.highlight) {
    const node = document.querySelector('[data-command="' + ui.state.highlight + '"]');
    if (node) node.classList.add("command-hit");
  }
}

function switchLabel(ui, text, checked) {
  const input = ui.el("input", { type: "checkbox" });
  input.checked = checked;
  input.disabled = !ui.state.canEdit;
  const label = ui.el("label", { class: "switch", text: " " + text }, [input]);
  return { input, label };
}

function rateText(ui, rate) {
  return rate == null ? "—" : ui.percent(rate);
}

function explainButton(ui, prompt) {
  const button = ui.button("Explain with assistant", () => {
    window.dispatchEvent(new CustomEvent("roleflow-ask", { detail: { message: prompt, mode: "ask" } }));
  });
  button.classList.add("ghost", "sm");
  return button;
}

function chartBlock(ui, title, rows, prompt) {
  const card = ui.el("section", { class: "agent" });
  card.append(ui.el("h3", { text: title }));
  if (!rows.length || rows.every((row) => !row.value)) card.append(ui.el("p", { text: "Nothing in this range yet." }));
  else card.append(bars(ui, rows));
  card.append(explainButton(ui, prompt));
  return card;
}

function bars(ui, rows) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  const host = ui.el("div", { class: "bars" });
  rows.slice(-14).forEach((row) => {
    const col = ui.el("div", { class: "bar-col" });
    const bar = ui.el("span");
    bar.style.height = Math.max(4, Math.round((row.value / max) * 72)) + "px";
    col.append(bar, ui.el("em", { text: row.label }));
    host.append(col);
  });
  return host;
}

function tableBlock(ui, title, headers, rows, empty, prompt) {
  const card = ui.el("section", { class: "agent" });
  card.append(ui.el("h3", { text: title }));
  if (!rows.length) card.append(ui.el("p", { text: empty }));
  else {
    const table = ui.el("table", { class: "leads" });
    const head = ui.el("tr");
    headers.forEach((label) => head.append(ui.el("th", { text: label })));
    table.append(ui.el("thead", {}, [head]));
    const body = ui.el("tbody");
    rows.forEach((row) => body.append(ui.el("tr", {}, row.map((cell) => ui.el("td", { text: cell })))));
    table.append(body);
    card.append(ui.el("div", { class: "table-wrap" }, [table]));
  }
  card.append(explainButton(ui, prompt));
  return card;
}

function heatBlock(ui, title, rows, prompt) {
  const card = ui.el("section", { class: "agent" });
  card.append(ui.el("h3", { text: title }));
  const max = Math.max(...rows.map((row) => row.value), 1);
  const grid = ui.el("div", { class: "heat" });
  rows.forEach((row) => {
    const cell = ui.el("span", { text: row.label, title: row.label + " " + row.value });
    const alpha = row.value ? 0.2 + (row.value / max) * 0.8 : 0.08;
    cell.style.background = "rgba(255, 138, 61, " + alpha.toFixed(2) + ")";
    grid.append(cell);
  });
  card.append(grid, explainButton(ui, prompt));
  return card;
}

function snapshotLeads(ui) {
  const contacts = (ui.state.contacts || []).map((row) => ({
    crm_state: row.crm_state || "",
    lead_status: row.lead_status || "",
    is_converted: row.is_converted === true,
    tags: Array.isArray(row.tags) ? row.tags : [],
    assigned_agent: row.assigned_agent || "Unassigned",
    sales_link_id: row.sales_link_id || null,
    updated: row.last_message_at || null,
    source: row.detail_source || "",
    source_detail: row.source_detail || "",
    followups: row.followups || 0
  }));
  const targets = (ui.state.targets || []).map((row) => ({
    crm_state: row.crm_state || "",
    lead_status: row.lead_status || "",
    tags: Array.isArray(row.tags) ? row.tags : [],
    assigned_agent: row.assigned_agent || "Unassigned",
    sales_link_id: null,
    updated: row.updated_at || row.created_at || null,
    source: row.source || "",
    source_detail: row.source_detail || "",
    followups: row.followups || 0,
    stage: row.stage,
    peak_stage: row.peak_stage
  }));
  return contacts.concat(targets);
}

function download(name, text) {
  const blob = new Blob([text], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
