// Admin CRM. Reads cached setter rows. Tokens stay in the edge function.
import { liveSections } from "../account/setter-model.js";
import { toast } from "../auth/ui.js";

function shown(message) {
  return String(message || "").replace(/tailortalk/ig, "the setter service");
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  });
  (children || []).forEach((child) => {
    if (child == null || child === false) return;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return node;
}

function when(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function dayLabel(iso) {
  const parts = String(iso || "").split("-").map(Number);
  if (parts.length < 3 || parts.some((part) => !part)) return String(iso || "");
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

function asObject(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try { return JSON.parse(value) || {}; } catch { return {}; }
  }
  return value;
}

function asSeries(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed : [];
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatRate(rate, total) {
  if (!total || rate == null || rate === "") return "—";
  const n = Number(rate);
  if (!Number.isFinite(n)) return "—";
  const pct = Math.round(n * 1000) / 10;
  return String(pct).replace(/\.0$/, "") + "%";
}

function clientLabel(profile) {
  if (!profile) return "Not linked";
  const handle = profile.instagram ? " (@" + String(profile.instagram).replace(/^@/, "") + ")" : "";
  return (profile.full_name || profile.email || "Client") + handle;
}

function missingTable(error) {
  return /schema cache|does not exist|PGRST205|PGRST204/i.test(error?.message || "");
}

export async function saveAgentLink(supabase, agentId, clientId) {
  return invoke(supabase, {
    action: "save",
    id: agentId,
    client_id: clientId || null,
    profile_id: clientId || null
  });
}

async function invoke(supabase, body) {
  const { data, error } = await supabase.functions.invoke("tailortalk-sync", { body });
  if (error) {
    let message = error.message || "The request failed.";
    const context = error.context;
    if (context && typeof context.json === "function") {
      try {
        const payload = await context.json();
        if (payload && payload.error) message = String(payload.error);
      } catch { /* keep the original message */ }
    }
    throw new Error(shown(message));
  }
  if (data && data.error) throw new Error(shown(data.error));
  return data || {};
}

export async function renderCrm(supabase, user, { app, hello }) {
  app.innerHTML = "";
  const root = el("div", { class: "crm" });
  const live = el("div", { class: "sr", role: "status", "aria-live": "polite" });
  app.append(root, live);

  let agents = [];
  let stats = new Map();
  let profiles = [];
  let view = { name: "overview" };
  let showArchived = false;
  let setterQuery = "";
  let sortKey = "name";
  let paintGeneration = 0;
  let detailTab = "leads";
  let leadQuery = "";
  let stageFilter = "all";
  let selectedKey = "";
  let confirmState = null;
  const templateCache = new Map();
  const sendCache = new Map();

  async function load() {
    const [agentRes, statRes, profileRes] = await Promise.all([
      supabase.from("tailortalk_agents").select("id, tailortalk_agent_id, agent_name, label, profile_id, client_id, channels, prompt_version_id, prompt_updated_at, tailortalk_created_at, archived, last_synced_at, last_sync_error, last_activity_at").order("agent_name"),
      supabase.from("tailortalk_agent_stats").select("agent_id, total_leads, by_status, by_source, by_category, converted_count, conversion_rate, last_activity_at, leads_per_day"),
      supabase.from("profiles").select("id, full_name, email, instagram").order("full_name")
    ]);
    const error = agentRes.error || statRes.error || profileRes.error;
    if (error) {
      root.innerHTML = "";
      const text = missingTable(error)
        ? "Apply the CRM migrations in the Supabase SQL editor, then refresh."
        : error.message;
      root.append(el("div", { class: "panel" }, [el("p", {}, [text])]));
      return false;
    }
    agents = agentRes.data || [];
    profiles = profileRes.data || [];
    stats = new Map((statRes.data || []).map((row) => [row.agent_id, row]));
    return true;
  }

  function linkedId(agent) {
    return agent.client_id || agent.profile_id || "";
  }

  function profileOf(agent) {
    const id = linkedId(agent);
    return profiles.find((profile) => profile.id === id) || null;
  }

  function statOf(agent) {
    return stats.get(agent.id) || null;
  }

  function agentName(agent) {
    return agent.agent_name || agent.label || "Agent";
  }

  function clientSelect(agent) {
    const select = el("select", {
      class: "crm-link",
      id: "crm-link-" + agent.id,
      "aria-label": "Link " + agentName(agent) + " to a client"
    }, [el("option", { value: "" }, ["Not linked"])]);
    profiles.forEach((profile) => {
      const option = el("option", { value: profile.id }, [clientLabel(profile)]);
      if (linkedId(agent) === profile.id) option.selected = true;
      select.append(option);
    });
    select.addEventListener("change", () => linkClient(agent, select));
    return select;
  }

  async function linkClient(agent, select) {
    const previous = linkedId(agent);
    select.disabled = true;
    live.textContent = "Saving client link…";
    try {
      await invoke(supabase, {
        action: "save",
        id: agent.id,
        client_id: select.value || null,
        profile_id: select.value || null
      });
      live.textContent = "Client link saved.";
      if (!(await load())) return;
      paint();
    } catch (error) {
      select.value = previous;
      select.disabled = false;
      live.textContent = error.message;
    }
  }

  function channelList(agent) {
    return asList(agent.channels);
  }

  function visibleAgents() {
    return agents.filter((agent) => showArchived || !agent.archived);
  }

  function overviewTotals() {
    const byStatus = {};
    let total = 0;
    let converted = 0;
    let sales = 0;
    let salesKnown = false;
    let last = null;
    const perDay = new Map();
    agents.filter((agent) => !agent.archived).forEach((agent) => {
      const row = statOf(agent);
      total += num(row?.total_leads);
      converted += num(row?.converted_count);
      const categories = asObject(row?.by_category);
      if (Object.keys(categories).length) {
        salesKnown = true;
        sales += num(categories.sales);
      }
      const status = asObject(row?.by_status);
      Object.entries(status).forEach(([key, count]) => {
        byStatus[key] = (byStatus[key] || 0) + num(count);
      });
      asSeries(row?.leads_per_day).forEach((item) => {
        perDay.set(item.day, (perDay.get(item.day) || 0) + num(item.count));
      });
      const activity = row?.last_activity_at || agent.last_activity_at;
      if (activity && (!last || new Date(activity) > new Date(last))) last = activity;
    });
    const series = Array.from(perDay.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([day, count]) => ({ day, count }));
    return {
      total,
      leads: salesKnown ? sales : total,
      converted,
      rate: total ? converted / total : null,
      byStatus,
      last,
      series
    };
  }

  function kpi(label, value) {
    return el("article", { class: "kpi" }, [
      el("b", {}, [value]),
      el("span", {}, [label])
    ]);
  }

  function kpiRow(totals, extraStatus) {
    const status = totals.byStatus || {};
    const cards = el("div", { class: "kpi-grid" }, [
      kpi("Conversations", String(totals.total)),
      kpi("Leads", String(totals.leads == null ? totals.total : totals.leads)),
      kpi("Hot", String(num(status.hot))),
      kpi("Warm", String(num(status.warm))),
      kpi("Cold", String(num(status.cold))),
      kpi("Booked calls", String(totals.converted)),
      kpi("Booking rate", formatRate(totals.rate, totals.total)),
      kpi("Last activity", when(totals.last))
    ]);
    if (extraStatus) {
      Object.entries(status).forEach(([key, count]) => {
        if (key === "hot" || key === "warm" || key === "cold") return;
        cards.append(kpi(key, String(count)));
      });
    }
    return cards;
  }

  function bars(series, label, labelStep) {
    const max = Math.max(1, ...series.map((item) => num(item.count)));
    const chart = el("div", { class: "chart", role: "img", "aria-label": label });
    series.forEach((item, index) => {
      const count = num(item.count);
      const showLabel = !labelStep || index % labelStep === 0 || index === series.length - 1;
      const column = el("div", { class: "bar" }, [
        el("span", { class: "bar-value" }, [count ? String(count) : ""]),
        el("i", { style: "--h:" + Math.round((count / max) * 100) + "%", title: count + " on " + item.day }),
        el("small", {}, [showLabel ? dayLabel(item.day) : ""])
      ]);
      chart.append(column);
    });
    return chart;
  }

  function funnel(totals) {
    const status = totals.byStatus || {};
    const steps = [
      ["Cold", num(status.cold)],
      ["Warm", num(status.warm)],
      ["Hot", num(status.hot)],
      ["Booked", num(totals.converted)]
    ];
    Object.entries(status).forEach(([key, count]) => {
      if (key === "hot" || key === "warm" || key === "cold") return;
      steps.splice(steps.length - 1, 0, [key, num(count)]);
    });
    const max = Math.max(1, ...steps.map(([, count]) => count));
    const wrap = el("div", { class: "status-bars", id: "crm-funnel" });
    steps.forEach(([key, count]) => {
      wrap.append(el("div", { class: "row" }, [
        el("span", {}, [key]),
        el("div", { class: "track" }, [el("i", { class: "fill", style: "--w:" + Math.round((count / max) * 100) + "%" })]),
        el("b", {}, [String(count)])
      ]));
    });
    return wrap;
  }

  function statusChart(byStatus) {
    const entries = Object.entries(byStatus);
    if (!entries.length) return el("p", { class: "mute" }, ["No lead statuses yet."]);
    const max = Math.max(1, ...entries.map(([, count]) => num(count)));
    const wrap = el("div", { class: "status-bars" });
    entries.sort((a, b) => num(b[1]) - num(a[1])).forEach(([key, count]) => {
      wrap.append(el("div", { class: "row" }, [
        el("span", {}, [key]),
        el("div", { class: "track" }, [el("i", { class: "fill", style: "--w:" + Math.round((num(count) / max) * 100) + "%" })]),
        el("b", {}, [String(count)])
      ]));
    });
    return wrap;
  }

  function sourceBlock(bySource) {
    const entries = Object.entries(bySource);
    if (!entries.length) {
      return el("p", { class: "mute", id: "crm-no-source" }, ["No source was returned for these leads."]);
    }
    return statusChart(bySource);
  }

  function paintOverview() {
    root.innerHTML = "";
    const totals = overviewTotals();
    const tools = el("div", { class: "crm-actions" });
    const sync = el("button", { type: "button", class: "btn", id: "crm-sync" }, ["Sync now"]);
    const archivedCount = agents.filter((agent) => agent.archived).length;
    const archivedToggle = el("button", { type: "button", class: "btn ghost", id: "crm-archived" }, [
      showArchived ? "Hide archived" : "Show archived (" + archivedCount + ")"
    ]);
    tools.append(sync);
    if (archivedCount) tools.append(archivedToggle);
    sync.addEventListener("click", () => runSync(sync, null));
    archivedToggle.addEventListener("click", () => {
      showArchived = !showArchived;
      paint();
    });

    root.append(el("h2", {}, ["Insights"]));
    root.append(el("p", { class: "mute crm-note" }, [
      "This is the combined picture. Leads, workflow, and stats open on each business, so they are not repeated here. Sync now reads leads for every setter that is not archived."
    ]));
    root.append(tools);
    root.append(kpiRow(totals, true));
    root.append(el("h3", {}, ["Stage mix"]));
    root.append(funnel(totals));
    root.append(el("h3", {}, ["Last 7 days"]));
    const week = totals.series.slice(-7);
    root.append(week.length ? bars(week, "Conversations per day over the last 7 days") : el("p", { class: "mute" }, ["No daily counts yet."]));
    root.append(el("h3", {}, ["Last 30 days"]));
    root.append(totals.series.length ? bars(totals.series, "Conversations per day over the last 30 days", 5) : el("p", { class: "mute" }, ["No daily counts yet."]));

    const actions = el("section", { class: "panel", id: "crm-actions-panel" });
    actions.append(el("h3", {}, ["Channels and templates"]));
    actions.append(el("p", { class: "mute" }, ["Pick a business for channel settings and template sends. The lead list stays on that business."]));
    const picker = el("select", { id: "crm-action-agent", "aria-label": "Business for channels and templates" }, [
      el("option", { value: "" }, ["Choose a business"])
    ]);
    visibleAgents().forEach((agent) => {
      picker.append(el("option", { value: agent.id }, [agentName(agent)]));
    });
    const slot = el("div", { id: "crm-action-slot" });
    picker.addEventListener("change", () => {
      slot.innerHTML = "";
      const agent = agents.find((item) => item.id === picker.value);
      if (!agent) return;
      slot.append(el("p", {}, [
        el("a", { href: "/businesses/#" + agent.id + "/leads" }, ["Open leads, workflow, and stats"])
      ]));
      slot.append(channelPanel(agent));
      slot.append(sendsPanel(agent));
    });
    actions.append(picker, slot);
    root.append(actions);
    const errors = agents.filter((agent) => agent.last_sync_error);
    if (errors.length) {
      const notes = el("section", { class: "panel" }, [el("h3", {}, ["Sync notes"])]);
      errors.forEach((agent) => notes.append(el("p", { class: "sync-error" }, [agentName(agent) + ": " + shown(agent.last_sync_error)])));
      root.append(notes);
    }
  }

  function paintForm() {
    const agent = view.agent;
    root.innerHTML = "";
    const back = el("button", { type: "button", class: "btn ghost sm", id: "crm-back" }, ["Back"]);
    back.addEventListener("click", () => {
      view = { name: "overview" };
      paint();
    });
    if (!agent) {
      root.append(back, el("p", {}, ["New setters show up here after the registry is updated. There is no manual add."]));
      return;
    }
    const form = el("form", { class: "auth-form", id: "crm-form" });
    const client = el("select", { id: "crm-client" }, [el("option", { value: "" }, ["Not linked"])]);
    profiles.forEach((profile) => {
      const option = el("option", { value: profile.id }, [clientLabel(profile)]);
      if (linkedId(agent) === profile.id) option.selected = true;
      client.append(option);
    });
    const token = el("input", {
      id: "crm-token",
      type: "password",
      autocomplete: "new-password",
      spellcheck: "false"
    });
    const msg = el("p", { class: "err", role: "status" });
    const save = el("button", { type: "submit", class: "btn" }, ["Save link"]);
    form.append(el("p", { class: "mute" }, [agentName(agent)]));
    form.append(el("label", {}, ["Client account", client]));
    form.append(el("label", {}, [
      "Replace access token",
      token,
      el("span", { class: "hint" }, [
        "Stored in the private schema and not shown again. Leave it blank to keep the current token. The registry upsert is the usual way the token is saved."
      ])
    ]));
    form.append(save, msg);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      msg.textContent = "";
      save.disabled = true;
      try {
        await invoke(supabase, {
          action: "save",
          id: agent.id,
          client_id: client.value || null,
          profile_id: client.value || null,
          token: token.value
        });
        token.value = "";
        live.textContent = "Link saved.";
        if (!(await load())) return;
        view = { name: "overview" };
        paint();
      } catch (error) {
        msg.textContent = error.message;
        save.disabled = false;
      }
    });
    root.append(back, el("div", { class: "panel" }, [
      el("h2", {}, ["Link client"]),
      form
    ]));
    client.focus();
  }

  function sectionBlocks(sections, note) {
    const slots = liveSections(sections);
    if (!slots.some((slot) => slot.text)) return el("p", { class: "mute" }, ["No prompt sections stored yet."]);
    const wrap = el("div", { class: "section-list" });
    slots.forEach((slot, index) => {
      const copy = el("button", { type: "button", class: "btn ghost sm" }, ["Copy section"]);
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(slot.text || "");
          note.textContent = "Copied " + slot.title + ".";
          note.className = "copy-note ok";
        } catch {
          note.textContent = "Couldn't copy automatically.";
          note.className = "copy-note bad";
        }
      });
      wrap.append(el("article", { class: "section-block" }, [
        el("header", {}, [el("h3", {}, [(index + 1) + ". " + slot.title]), copy]),
        el("pre", { class: "prompt" }, [slot.text || "Not in the live prompt yet."])
      ]));
    });
    return wrap;
  }

  function contactUsable(lead) {
    const contact = String(lead?.lead_contact || "").trim();
    return Boolean(contact) && !contact.includes("*");
  }

  function leadKey(lead) {
    return String(lead?.external_id || "") + "|" + String(lead?.lead_contact || "") + "|" + String(lead?.lead_name || "");
  }

  function filteredLeads(leads) {
    const query = leadQuery.trim().toLowerCase();
    return leads.filter((lead) => {
      const stage = String(lead.lead_status || "").toLowerCase();
      if (stageFilter === "booked" && lead.is_converted !== true) return false;
      if (stageFilter !== "all" && stageFilter !== "booked" && stage !== stageFilter) return false;
      if (!query) return true;
      const haystack = [lead.lead_name, lead.username, lead.lead_contact, lead.lead_status, lead.source].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }

  function paintLeadDetail(agent, lead) {
    const panel = el("div", { class: "panel", id: "crm-lead-detail" });
    if (!lead) {
      panel.append(el("p", { class: "mute" }, ["Select a lead to see its stage, last message time, and booked flag."]));
      return panel;
    }
    const usable = contactUsable(lead);
    panel.append(el("h3", {}, [lead.lead_name || lead.username || "Lead"]));
    const lines = [
      ["Username", lead.username ? "@" + String(lead.username).replace(/^@/, "") : "—"],
      ["Contact", lead.lead_contact || "—"],
      ["Stage", lead.lead_status || "—"],
      ["Category", lead.category || "—"],
      ["Source", lead.source || "—"],
      ["Last message", when(lead.last_message_time)],
      ["Joined", when(lead.joined_at)],
      ["Follow-ups", lead.total_followups == null ? "—" : String(lead.total_followups)],
      ["Qualified", /^(hot|qualified)$/i.test(String(lead.lead_status || "")) ? "Yes" : "No"],
      ["Booked", lead.is_converted ? "Yes" : "No"]
    ];
    const list = el("dl");
    lines.forEach(([label, value]) => {
      list.append(el("dt", {}, [label]), el("dd", {}, [value]));
    });
    panel.append(list);
    panel.append(el("p", { class: "mute", id: "crm-no-history" }, ["Message history is not included in the lead feed."]));
    const actions = el("div", { class: "crm-actions" });
    const book = el("button", { type: "button", class: "btn sm", id: "crm-mark-booked" }, ["Mark booked"]);
    const send = el("button", { type: "button", class: "btn ghost sm", id: "crm-send-template" }, ["Send template"]);
    if (!usable || lead.is_converted) book.disabled = true;
    if (!usable) send.disabled = true;
    if (!usable) panel.append(el("p", { class: "mute" }, ["This contact is hidden, so it can't be updated from here."]));
    book.addEventListener("click", () => {
      confirmState = { kind: "booked", lead };
      paint();
    });
    send.addEventListener("click", () => {
      confirmState = { kind: "template", lead, templateName: "", params: "" };
      detailTab = "leads";
      paint();
    });
    actions.append(book, send);
    panel.append(actions);
    if (confirmState && leadKey(confirmState.lead) === leadKey(lead)) panel.append(confirmBox(agent, lead));
    return panel;
  }

  function confirmBox(agent, lead) {
    const box = el("div", { class: "confirm-box", id: "crm-confirm", role: "dialog", "aria-modal": "true" });
    const yes = el("button", { type: "button", class: "btn sm", id: "crm-confirm-yes" }, ["Confirm"]);
    const no = el("button", { type: "button", class: "btn ghost sm", id: "crm-confirm-no" }, ["Cancel"]);
    const msg = el("p", { class: "err", role: "status" });
    no.addEventListener("click", () => {
      confirmState = null;
      paint();
    });
    if (confirmState.kind === "booked") {
      box.append(el("h3", {}, ["Mark this lead as booked?"]));
      box.append(el("p", {}, ["This stays booked. It can't be undone from here."]));
      yes.addEventListener("click", async () => {
        yes.disabled = true;
        try {
          await invoke(supabase, { action: "mark_booked", agent_id: agent.id, contact_id: lead.lead_contact });
          confirmState = null;
          live.textContent = "Lead marked booked.";
          paint();
        } catch (error) {
          msg.textContent = error.message;
          yes.disabled = false;
        }
      });
    } else {
      const templates = templateCache.get(agent.id) || [];
      const approved = templates.filter((item) => String(item.template_status).toUpperCase() === "APPROVED");
      const select = el("select", { id: "crm-template-name" }, [el("option", { value: "" }, ["Choose a template"])]);
      approved.forEach((item) => select.append(el("option", { value: item.template_name }, [item.template_name])));
      if (confirmState.templateName) select.value = confirmState.templateName;
      const params = el("input", { id: "crm-template-params", value: confirmState.params || "", placeholder: "Template values, separated by commas" });
      box.append(el("h3", {}, ["Send a WhatsApp template?"]));
      box.append(el("p", {}, ["This sends the template to " + (lead.lead_name || "this lead") + " and can't be recalled."]));
      if (!templates.length) box.append(el("p", { class: "mute" }, ["Load templates on the Channels tab first. Only approved templates can be sent."]));
      box.append(el("label", {}, ["Template", select]));
      box.append(el("label", {}, ["Values", params]));
      yes.addEventListener("click", async () => {
        if (!select.value) {
          msg.textContent = "Choose a template.";
          return;
        }
        yes.disabled = true;
        const values = params.value.split(",").map((item) => item.trim()).filter(Boolean);
        try {
          const result = await invoke(supabase, {
            action: "send_template",
            agent_id: agent.id,
            lead_contact: lead.lead_contact,
            lead_name: lead.lead_name || "",
            template_name: select.value,
            template_params: values
          });
          confirmState = null;
          live.textContent = result.message_id ? "Template sent." : "Template sent.";
          paint();
        } catch (error) {
          msg.textContent = error.message;
          yes.disabled = false;
        }
      });
    }
    box.append(el("div", { class: "crm-actions" }, [yes, no]), msg);
    return box;
  }

  async function paintDetail(generation) {
    const agent = agents.find((item) => item.id === view.id);
    root.innerHTML = "";
    const back = el("button", { type: "button", class: "btn ghost sm", id: "crm-back" }, ["Back to setters"]);
    back.addEventListener("click", () => {
      confirmState = null;
      view = { name: "overview" };
      paint();
    });
    root.append(back);
    if (!agent) {
      root.append(el("p", {}, ["That setter is no longer in the cache."]));
      return;
    }
    const row = statOf(agent);
    const byStatus = asObject(row?.by_status);
    const bySource = asObject(row?.by_source);
    const series = asSeries(row?.leads_per_day);
    const categories = asObject(row?.by_category);
    const salesKnown = Object.keys(categories).length > 0;
    const promptRes = await supabase.from("tailortalk_agents").select("prompt_sections").eq("id", agent.id).maybeSingle();
    const historyRes = await supabase.from("tailortalk_prompt_versions").select("version_id, deployed_at, sections").eq("agent_id", agent.id).order("deployed_at", { ascending: false });
    const leadsRes = await supabase.from("tailortalk_leads").select("external_id, lead_name, username, lead_contact, lead_status, category, source, last_message_time, joined_at, total_followups, is_converted, converted_at").eq("agent_id", agent.id).order("last_message_time", { ascending: false }).limit(500);
    if (generation !== paintGeneration) return;
    const leads = leadsRes.data || [];
    root.append(el("h2", {}, [agentName(agent)]));
    root.append(el("p", { class: "mute" }, [
      (agent.archived ? "Paused" : "Active")
        + " · Channels: " + (channelList(agent).length ? channelList(agent).join(", ") : "none recorded")
        + " · Linked client: " + clientLabel(profileOf(agent))
    ]));
    const sync = el("button", { type: "button", class: "btn", id: "crm-sync-one" }, ["Sync now"]);
    sync.addEventListener("click", () => runSync(sync, agent.id));
    root.append(el("div", { class: "crm-actions" }, [sync]));
    if (agent.last_sync_error) root.append(el("p", { class: "sync-error" }, [shown(agent.last_sync_error)]));
    root.append(kpiRow({
      total: num(row?.total_leads),
      leads: salesKnown ? num(categories.sales) : num(row?.total_leads),
      converted: num(row?.converted_count),
      rate: row ? row.conversion_rate : null,
      byStatus,
      last: row?.last_activity_at || agent.last_activity_at
    }, true));
    root.append(el("h3", {}, ["Stage mix"]));
    root.append(funnel({ byStatus, converted: num(row?.converted_count) }));
    root.append(el("h3", {}, ["Last 7 days"]));
    root.append(series.slice(-7).length ? bars(series.slice(-7), "Conversations per day over the last 7 days") : el("p", { class: "mute" }, ["No daily counts yet."]));
    root.append(el("h3", {}, ["Last 30 days"]));
    root.append(series.length ? bars(series, "Conversations per day over the last 30 days", 5) : el("p", { class: "mute" }, ["No daily counts yet."]));
    root.append(el("h3", {}, ["By source"]));
    root.append(sourceBlock(bySource));

    const tabs = el("div", { class: "auth-tabs crm-tabs", id: "crm-tabs", role: "tablist" });
    ["leads", "prompt", "channels", "sends"].forEach((name) => {
      const labels = { leads: "Leads", prompt: "Prompt", channels: "Channels", sends: "Template sends" };
      const button = el("button", {
        type: "button",
        id: "crm-tab-" + name,
        role: "tab",
        "aria-selected": detailTab === name ? "true" : "false"
      }, [labels[name]]);
      button.addEventListener("click", () => {
        detailTab = name;
        paint();
      });
      tabs.append(button);
    });
    root.append(tabs);
    const panel = el("div", { id: "crm-tab-panel" });
    root.append(panel);
    if (detailTab === "prompt") panel.append(promptPanel(promptRes, historyRes));
    else if (detailTab === "channels") panel.append(channelPanel(agent));
    else if (detailTab === "sends") panel.append(sendsPanel(agent));
    else panel.append(leadsPanel(agent, leads, leadsRes.error));
  }

  function leadsPanel(agent, leads, error) {
    const wrap = el("div", { id: "crm-leads" });
    if (error) {
      wrap.append(el("p", { class: "sync-error" }, [shown(error.message)]));
      return wrap;
    }
    const stages = Array.from(new Set(leads.map((lead) => String(lead.lead_status || "").trim()).filter(Boolean))).sort();
    const search = el("input", { id: "crm-lead-search", type: "search", value: leadQuery, placeholder: "Search name or username" });
    const filter = el("select", { id: "crm-stage-filter" }, [el("option", { value: "all" }, ["All stages"]), el("option", { value: "booked" }, ["Booked"])]);
    stages.forEach((stage) => filter.append(el("option", { value: stage.toLowerCase() }, [stage])));
    filter.value = stageFilter;
    search.addEventListener("input", () => {
      leadQuery = search.value;
      const existing = document.getElementById("crm-lead-results");
      if (existing) existing.replaceWith(leadResults(agent, leads));
    });
    filter.addEventListener("change", () => {
      stageFilter = filter.value;
      const existing = document.getElementById("crm-lead-results");
      if (existing) existing.replaceWith(leadResults(agent, leads));
    });
    wrap.append(el("div", { class: "lead-search" }, [search, filter]));
    wrap.append(leadResults(agent, leads));
    wrap.append(el("p", { class: "mute" }, ["Showing cached leads, newest message first. Totals above use the full sync."]));
    return wrap;
  }

  function leadResults(agent, leads) {
    const shownLeads = filteredLeads(leads);
    const wrap = el("div", { class: "crm-detail-grid", id: "crm-lead-results" });
    wrap.append(el("p", { class: "mute" }, [shownLeads.length + " of " + leads.length + " leads"]));
    if (!shownLeads.length) {
      wrap.append(el("p", { class: "mute" }, [leads.length ? "No leads match that search." : "No cached leads yet. Use Sync now."]));
      wrap.append(paintLeadDetail(agent, null));
      return wrap;
    }
    const table = el("table", { class: "crm-table" });
    table.append(el("thead", {}, [el("tr", {}, ["Name", "Stage", "Last message", "Booked"].map((label) => el("th", { scope: "col" }, [label])))]));
    const body = el("tbody");
    if (!shownLeads.some((lead) => leadKey(lead) === selectedKey)) selectedKey = leadKey(shownLeads[0]);
    shownLeads.forEach((lead) => {
      const open = el("button", { type: "button", class: "btn ghost sm" }, [lead.lead_name || lead.username || "Lead"]);
      open.addEventListener("click", () => {
        selectedKey = leadKey(lead);
        confirmState = null;
        const existing = document.getElementById("crm-lead-results");
        if (existing) existing.replaceWith(leadResults(agent, leads));
      });
      body.append(el("tr", {}, [
        el("td", {}, [open]),
        el("td", {}, [lead.lead_status || "—"]),
        el("td", {}, [when(lead.last_message_time)]),
        el("td", {}, [lead.is_converted ? "Yes" : "No"])
      ]));
    });
    table.append(body);
    const selected = shownLeads.find((lead) => leadKey(lead) === selectedKey) || shownLeads[0];
    wrap.append(el("div", { class: "crm-scroll" }, [table]), paintLeadDetail(agent, selected));
    return wrap;
  }

  function promptPanel(promptRes, historyRes) {
    const wrap = el("div", { id: "crm-prompt" });
    const copyNote = el("p", { class: "copy-note", role: "status" });
    wrap.append(el("h3", {}, ["Live prompt"]));
    wrap.append(el("p", { class: "mute" }, ["Read only. The connected account has no way to edit or publish the prompt from here."]));
    if (promptRes.error) wrap.append(el("p", { class: "sync-error" }, [shown(promptRes.error.message)]));
    else wrap.append(sectionBlocks(promptRes.data?.prompt_sections, copyNote));
    wrap.append(copyNote);
    wrap.append(el("h3", {}, ["Prompt version history"]));
    if (historyRes.error) wrap.append(el("p", { class: "sync-error" }, [shown(historyRes.error.message)]));
    else if (!(historyRes.data || []).length) wrap.append(el("p", { class: "mute" }, ["No earlier version has been recorded."]));
    else {
      const history = el("div", { class: "version-list" });
      historyRes.data.forEach((version) => {
        const body = el("div", { class: "version-body" });
        body.append(sectionBlocks(version.sections, copyNote));
        const details = el("details", { class: "version" });
        details.append(el("summary", {}, [(version.version_id || "Version") + " · " + when(version.deployed_at)]));
        details.append(body);
        history.append(details);
      });
      wrap.append(history);
    }
    return wrap;
  }

  function channelPanel(agent) {
    const wrap = el("div", { id: "crm-channels" });
    const channels = channelList(agent);
    wrap.append(el("h3", {}, ["Recorded channels"]));
    wrap.append(el("p", {}, [channels.length ? channels.join(", ") : "No channel list is stored for this setter."]));
    wrap.append(el("h3", {}, ["Settings on file"]));
    const settings = el("dl");
    [
      ["Status", agent.archived ? "Paused" : "Active"],
      ["Created", when(agent.tailortalk_created_at)],
      ["Prompt updated", when(agent.prompt_updated_at)],
      ["Live version", agent.prompt_version_id || "—"],
      ["Linked client", clientLabel(profileOf(agent))]
    ].forEach(([label, value]) => settings.append(el("dt", {}, [label]), el("dd", {}, [value])));
    wrap.append(settings);
    wrap.append(el("p", { class: "mute" }, ["Follow-ups, escalation, hours, and channel logins are not available from the connected account."]));
    const load = el("button", { type: "button", class: "btn sm", id: "crm-load-templates" }, ["Load WhatsApp templates"]);
    const slot = el("div", { id: "crm-templates" });
    load.addEventListener("click", () => loadTemplates(agent, load, slot));
    wrap.append(el("h3", {}, ["WhatsApp templates"]));
    wrap.append(el("div", { class: "crm-actions" }, [load]), slot);
    if (templateCache.has(agent.id)) slot.append(templateTable(templateCache.get(agent.id)));
    return wrap;
  }

  function templateTable(templates) {
    if (!templates.length) return el("p", { class: "mute" }, ["No templates were returned."]);
    const table = el("table", { class: "crm-table" });
    table.append(el("thead", {}, [el("tr", {}, ["Template", "Status", "Type", "Language"].map((label) => el("th", { scope: "col" }, [label])))]));
    const body = el("tbody");
    templates.forEach((item) => {
      body.append(el("tr", {}, [
        el("td", {}, [item.template_name || "—"]),
        el("td", {}, [item.template_status || "—"]),
        el("td", {}, [item.template_type || "—"]),
        el("td", {}, [item.language || "—"])
      ]));
    });
    table.append(body);
    return el("div", { class: "crm-scroll" }, [table]);
  }

  async function loadTemplates(agent, button, slot) {
    button.disabled = true;
    live.textContent = "Loading templates…";
    try {
      const result = await invoke(supabase, { action: "templates", agent_id: agent.id });
      templateCache.set(agent.id, result.templates || []);
      slot.innerHTML = "";
      slot.append(templateTable(result.templates || []));
      live.textContent = "Templates loaded.";
    } catch (error) {
      live.textContent = error.message;
      slot.innerHTML = "";
      slot.append(el("p", { class: "sync-error" }, [error.message]));
    } finally {
      button.disabled = false;
    }
  }

  function sendsPanel(agent) {
    const wrap = el("div", { id: "crm-sends" });
    wrap.append(el("p", { class: "mute" }, ["These are WhatsApp template messages sent through the API. Bulk campaigns sent outside Roleflow are not included."]));
    const load = el("button", { type: "button", class: "btn sm", id: "crm-load-sends" }, ["Load template sends"]);
    const slot = el("div", { id: "crm-send-list" });
    load.addEventListener("click", () => loadSends(agent, load, slot));
    wrap.append(el("div", { class: "crm-actions" }, [load]), slot);
    if (sendCache.has(agent.id)) slot.append(sendsTable(sendCache.get(agent.id)));
    return wrap;
  }

  function sendsTable(logs) {
    if (!logs.length) return el("p", { class: "mute" }, ["No template sends were returned."]);
    const table = el("table", { class: "crm-table" });
    table.append(el("thead", {}, [el("tr", {}, ["Template", "Contact", "Status", "Error"].map((label) => el("th", { scope: "col" }, [label])))]));
    const body = el("tbody");
    logs.forEach((item) => {
      body.append(el("tr", {}, [
        el("td", {}, [item.template_name || "—"]),
        el("td", {}, [item.contact_number || "—"]),
        el("td", {}, [item.status || "—"]),
        el("td", {}, [item.error || "—"])
      ]));
    });
    table.append(body);
    return el("div", { class: "crm-scroll" }, [table]);
  }

  async function loadSends(agent, button, slot) {
    button.disabled = true;
    live.textContent = "Loading template sends…";
    try {
      const result = await invoke(supabase, { action: "template_sends", agent_id: agent.id });
      sendCache.set(agent.id, result.logs || []);
      slot.innerHTML = "";
      slot.append(sendsTable(result.logs || []));
      live.textContent = "Template sends loaded.";
    } catch (error) {
      live.textContent = error.message;
      slot.innerHTML = "";
      slot.append(el("p", { class: "sync-error" }, [error.message]));
    } finally {
      button.disabled = false;
    }
  }

  async function runSync(button, agentId) {
    button.disabled = true;
    live.textContent = "Syncing…";
    try {
      const result = await invoke(supabase, { action: "sync", agent_id: agentId || undefined });
      const failed = (result.results || []).filter((item) => item.error);
      live.textContent = failed.length ? failed.map((item) => item.error).join(" ") : "Sync finished.";
      toast(live.textContent, failed.length ? "bad" : "ok");
      if (!(await load())) return;
      paint();
    } catch (error) {
      live.textContent = error.message;
      toast(error.message, "bad");
      button.disabled = false;
      root.append(el("p", { class: "sync-error", role: "status" }, [error.message]));
    }
  }

  function paint() {
    const generation = ++paintGeneration;
    if (view.name === "form") paintForm();
    else if (view.name === "detail") paintDetail(generation);
    else paintOverview();
  }

  root.append(el("div", { class: "state", id: "crm-loading" }, [
    el("span", { class: "skel" }),
    el("span", { class: "skel short" }),
    el("p", {}, ["Loading setters…"])
  ]));
  if (await load()) paint();
  void user;
}
