// Admin CRM. Reads cached TailorTalk rows only. Tokens are saved through
// the tailortalk-sync function and are never selected here.

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
    throw new Error(message);
  }
  if (data && data.error) throw new Error(String(data.error));
  return data || {};
}

export async function renderCrm(supabase, user, { app, hello }) {
  hello.textContent = "TailorTalk CRM";
  app.innerHTML = "";
  const root = el("div", { class: "crm" });
  const live = el("div", { class: "sr", role: "status", "aria-live": "polite" });
  app.append(root, live);

  let agents = [];
  let stats = new Map();
  let profiles = [];
  let view = { name: "overview" };
  let showArchived = false;
  let paintGeneration = 0;

  async function load() {
    const [agentRes, statRes, profileRes] = await Promise.all([
      supabase.from("tailortalk_agents").select("id, tailortalk_agent_id, agent_name, label, profile_id, channels, prompt_version_id, prompt_updated_at, tailortalk_created_at, archived, last_synced_at, last_sync_error, last_activity_at").order("agent_name"),
      supabase.from("tailortalk_agent_stats").select("agent_id, total_leads, by_status, by_source, converted_count, conversion_rate, last_activity_at, leads_per_day"),
      supabase.from("profiles").select("id, full_name, email, instagram").order("full_name")
    ]);
    const error = agentRes.error || statRes.error || profileRes.error;
    if (error) {
      root.innerHTML = "";
      const text = missingTable(error)
        ? "Apply supabase/migrations/20261014160000_tailortalk_crm.sql and supabase/migrations/20261014180000_tailortalk_registry.sql in the Supabase SQL editor, then refresh."
        : error.message;
      root.append(el("div", { class: "panel" }, [el("p", {}, [text])]));
      return false;
    }
    agents = agentRes.data || [];
    profiles = profileRes.data || [];
    stats = new Map((statRes.data || []).map((row) => [row.agent_id, row]));
    return true;
  }

  function profileOf(agent) {
    return profiles.find((profile) => profile.id === agent.profile_id) || null;
  }

  function statOf(agent) {
    return stats.get(agent.id) || null;
  }

  function agentName(agent) {
    return agent.agent_name || agent.label || "Agent";
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
    let last = null;
    agents.filter((agent) => !agent.archived).forEach((agent) => {
      const row = statOf(agent);
      total += num(row?.total_leads);
      converted += num(row?.converted_count);
      const status = asObject(row?.by_status);
      Object.entries(status).forEach(([key, count]) => {
        byStatus[key] = (byStatus[key] || 0) + num(count);
      });
      const activity = row?.last_activity_at || agent.last_activity_at;
      if (activity && (!last || new Date(activity) > new Date(last))) last = activity;
    });
    return {
      total,
      converted,
      rate: total ? converted / total : null,
      byStatus,
      last
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
      kpi("Total leads", String(totals.total)),
      kpi("Hot", String(num(status.hot))),
      kpi("Warm", String(num(status.warm))),
      kpi("Cold", String(num(status.cold))),
      kpi("Converted", String(totals.converted)),
      kpi("Conversion rate", formatRate(totals.rate, totals.total)),
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
        el("i", { style: "--h:" + Math.round((count / max) * 100) + "%", title: count + " on " + item.day }),
        el("small", {}, [showLabel ? dayLabel(item.day) : ""])
      ]);
      chart.append(column);
    });
    return chart;
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
      return el("p", { class: "mute", id: "crm-no-source" }, ["TailorTalk did not return a source on these leads."]);
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

    root.append(el("h2", {}, ["Overview"]));
    root.append(el("p", { class: "mute crm-note" }, [
      "Agents appear when the TailorTalk registry upsert runs. Sync now reads leads for every agent that is not archived. Message counts are not in the Get Leads response, so they are not shown."
    ]));
    root.append(tools);
    root.append(kpiRow(totals, true));

    const table = el("table", { class: "crm-table" });
    table.append(el("thead", {}, [el("tr", {}, [
      "Agent", "Client", "Leads", "Hot", "Warm", "Cold", "Converted", "Rate", "Last activity", ""
    ].map((label) => el("th", { scope: "col" }, [label])))]));
    const body = el("tbody");
    const rows = visibleAgents();
    if (!rows.length) {
      body.append(el("tr", {}, [el("td", { colspan: "10" }, ["No agents in the registry yet. Run supabase/tailortalk_registry_upsert.sql."])]));
    }
    rows.forEach((agent) => {
      const row = statOf(agent);
      const status = asObject(row?.by_status);
      const open = el("button", { type: "button", class: "btn ghost sm crm-open" }, ["Open"]);
      open.addEventListener("click", () => {
        view = { name: "detail", id: agent.id };
        paint();
      });
      const edit = el("button", { type: "button", class: "btn ghost sm" }, ["Edit"]);
      edit.addEventListener("click", () => {
        view = { name: "form", agent };
        paint();
      });
      const actions = el("div", { class: "crm-row-actions" }, [open, edit]);
      const nameCell = el("td", {}, [
        el("strong", {}, [agentName(agent)]),
        el("span", { class: "mute agent-meta" }, [
          (agent.tailortalk_agent_id || "No TailorTalk id")
            + (channelList(agent).length ? " · " + channelList(agent).join(", ") : "")
            + (agent.archived ? " · archived" : "")
        ])
      ]);
      body.append(el("tr", {}, [
        nameCell,
        el("td", {}, [clientLabel(profileOf(agent))]),
        el("td", {}, [String(num(row?.total_leads))]),
        el("td", {}, [String(num(status.hot))]),
        el("td", {}, [String(num(status.warm))]),
        el("td", {}, [String(num(status.cold))]),
        el("td", {}, [String(num(row?.converted_count))]),
        el("td", {}, [formatRate(row ? row.conversion_rate : null, num(row?.total_leads))]),
        el("td", {}, [when(row?.last_activity_at || agent.last_activity_at)]),
        el("td", {}, [actions])
      ]));
      if (agent.last_sync_error) {
        body.append(el("tr", {}, [el("td", { colspan: "10", class: "sync-error" }, ["Last sync: " + agent.last_sync_error])]));
      }
    });
    table.append(body);
    root.append(el("div", { class: "crm-scroll" }, [table]));
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
      root.append(back, el("p", {}, ["New agents show up here after the registry upsert. There is no manual add."]));
      return;
    }
    const form = el("form", { class: "auth-form", id: "crm-form" });
    const client = el("select", { id: "crm-client" }, [el("option", { value: "" }, ["Not linked"])]);
    profiles.forEach((profile) => {
      const option = el("option", { value: profile.id }, [clientLabel(profile)]);
      if (agent.profile_id === profile.id) option.selected = true;
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
    form.append(el("p", { class: "mute" }, [agentName(agent) + (agent.tailortalk_agent_id ? " · " + agent.tailortalk_agent_id : "")]));
    form.append(el("label", {}, ["Onboarding client", client]));
    form.append(el("label", {}, [
      "Replace agent token",
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
    const list = asList(sections).filter((item) => item && (item.node || item.instruction));
    if (!list.length) return el("p", { class: "mute" }, ["No prompt sections stored yet."]);
    const wrap = el("div", { class: "section-list" });
    list.forEach((item) => {
      const instruction = item.instruction == null ? "" : String(item.instruction);
      const copy = el("button", { type: "button", class: "btn ghost sm" }, ["Copy section"]);
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(instruction);
          note.textContent = "Copied " + (item.node || "section") + ".";
          note.className = "copy-note ok";
        } catch {
          note.textContent = "Couldn't copy automatically.";
          note.className = "copy-note bad";
        }
      });
      wrap.append(el("article", { class: "section-block" }, [
        el("header", {}, [el("h3", {}, [item.node || "Section"]), copy]),
        el("pre", { class: "prompt" }, [instruction || "—"])
      ]));
    });
    return wrap;
  }

  async function paintDetail(generation) {
    const agent = agents.find((item) => item.id === view.id);
    root.innerHTML = "";
    const back = el("button", { type: "button", class: "btn ghost sm", id: "crm-back" }, ["Back to overview"]);
    back.addEventListener("click", () => {
      view = { name: "overview" };
      paint();
    });
    root.append(back);
    if (!agent) {
      root.append(el("p", {}, ["That agent is no longer in the cache."]));
      return;
    }
    const row = statOf(agent);
    const byStatus = asObject(row?.by_status);
    const bySource = asObject(row?.by_source);
    const series = asSeries(row?.leads_per_day);
    const week = series.slice(-7);
    const promptRes = await supabase.from("tailortalk_agents").select("prompt_sections").eq("id", agent.id).maybeSingle();
    const historyRes = await supabase.from("tailortalk_prompt_versions").select("version_id, deployed_at, sections").eq("agent_id", agent.id).order("deployed_at", { ascending: false });
    if (generation !== paintGeneration) return;
    root.append(el("h2", {}, [agentName(agent)]));
    root.append(el("p", { class: "mute" }, [
      (agent.tailortalk_agent_id || "No TailorTalk id")
        + " · Channels: " + (channelList(agent).length ? channelList(agent).join(", ") : "—")
        + " · Created " + when(agent.tailortalk_created_at)
    ]));
    root.append(el("p", { class: "mute" }, [
      "Live version " + (agent.prompt_version_id || "—") + " · Updated " + when(agent.prompt_updated_at)
        + " · Linked client: " + clientLabel(profileOf(agent))
    ]));
    const sync = el("button", { type: "button", class: "btn", id: "crm-sync-one" }, ["Sync now"]);
    sync.addEventListener("click", () => runSync(sync, agent.id));
    root.append(el("div", { class: "crm-actions" }, [sync]));
    if (agent.last_sync_error) root.append(el("p", { class: "sync-error" }, [agent.last_sync_error]));
    const copyNote = el("p", { class: "copy-note", role: "status" });
    root.append(el("h3", {}, ["Live prompt"]));
    if (promptRes.error) root.append(el("p", { class: "sync-error" }, [promptRes.error.message]));
    else root.append(sectionBlocks(promptRes.data?.prompt_sections, copyNote));
    root.append(copyNote);
    root.append(el("h3", {}, ["Prompt version history"]));
    if (historyRes.error) root.append(el("p", { class: "sync-error" }, [historyRes.error.message]));
    else if (!(historyRes.data || []).length) root.append(el("p", { class: "mute" }, ["No earlier version has been recorded."]));
    else {
      const history = el("div", { class: "version-list" });
      historyRes.data.forEach((version) => {
        const body = el("div", { class: "version-body" });
        body.append(sectionBlocks(version.sections, copyNote));
        const details = el("details", { class: "version" });
        details.append(el("summary", {}, [
          (version.version_id || "Version") + " · " + when(version.deployed_at)
        ]));
        details.append(body);
        history.append(details);
      });
      root.append(history);
    }
    root.append(el("h3", {}, ["Leads and stats"]));
    root.append(kpiRow({
      total: num(row?.total_leads),
      converted: num(row?.converted_count),
      rate: row ? row.conversion_rate : null,
      byStatus,
      last: row?.last_activity_at || agent.last_activity_at
    }, true));

    root.append(el("h3", {}, ["Leads by status"]));
    root.append(statusChart(byStatus));
    root.append(el("h3", {}, ["Leads by source"]));
    root.append(sourceBlock(bySource));
    root.append(el("h3", {}, ["Leads per day, last 7 days"]));
    root.append(week.length ? bars(week, "Leads per day over the last 7 days") : el("p", { class: "mute" }, ["No daily series yet."]));
    root.append(el("h3", {}, ["Leads per day, last 30 days"]));
    root.append(series.length ? bars(series, "Leads per day over the last 30 days", 5) : el("p", { class: "mute" }, ["No daily series yet."]));

    const leadsRes = await supabase.from("tailortalk_leads").select("lead_name, lead_contact, lead_status, category, source, last_message_time, total_followups, is_converted").eq("agent_id", agent.id).order("last_message_time", { ascending: false }).limit(100);
    if (generation !== paintGeneration) return;
    root.append(el("h3", {}, ["Leads"]));
    if (leadsRes.error) {
      root.append(el("p", { class: "sync-error" }, [leadsRes.error.message]));
      return;
    }
    const leads = leadsRes.data || [];
    if (!leads.length) {
      root.append(el("p", { class: "mute" }, ["No cached leads. Use Sync now after the token is saved."]));
      return;
    }
    const table = el("table", { class: "crm-table" });
    table.append(el("thead", {}, [el("tr", {}, [
      "Name", "Contact", "Status", "Category", "Source", "Last message", "Follow-ups", "Converted"
    ].map((label) => el("th", { scope: "col" }, [label])))]));
    const body = el("tbody");
    leads.forEach((lead) => {
      body.append(el("tr", {}, [
        el("td", {}, [lead.lead_name || "—"]),
        el("td", {}, [lead.lead_contact || "—"]),
        el("td", {}, [lead.lead_status || "—"]),
        el("td", {}, [lead.category || "—"]),
        el("td", {}, [lead.source || "—"]),
        el("td", {}, [when(lead.last_message_time)]),
        el("td", {}, [lead.total_followups == null ? "—" : String(lead.total_followups)]),
        el("td", {}, [lead.is_converted ? "Yes" : "No"])
      ]));
    });
    table.append(body);
    root.append(el("p", { class: "mute" }, ["Showing the " + leads.length + " most recent cached leads. Totals above use the full sync."]));
    root.append(el("div", { class: "crm-scroll" }, [table]));
  }

  async function runSync(button, agentId) {
    button.disabled = true;
    live.textContent = "Syncing…";
    try {
      const result = await invoke(supabase, { action: "sync", agent_id: agentId || undefined });
      const failed = (result.results || []).filter((item) => item.error);
      live.textContent = failed.length ? failed.map((item) => item.error).join(" ") : "Sync finished.";
      if (!(await load())) return;
      paint();
    } catch (error) {
      live.textContent = error.message;
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

  if (await load()) paint();
  void user;
}
