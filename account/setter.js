import { isBooked, isQualified, leadTitle, liveSections, setterFigures, setterStatus } from "./setter-model.js";

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

function unavailable(error) {
  const message = error?.message || "";
  if (/schema cache|does not exist|PGRST205|PGRST204/i.test(message)) return true;
  return false;
}

function panel(text) {
  return el("div", { class: "panel" }, [el("p", {}, [text])]);
}

function kpi(label, value) {
  return el("article", { class: "kpi" }, [
    el("b", {}, [value]),
    el("span", {}, [label])
  ]);
}

function bars(series, label, labelStep) {
  const max = Math.max(1, ...series.map((item) => num(item.count)));
  const chart = el("div", { class: "chart", role: "img", "aria-label": label });
  series.forEach((item, index) => {
    const count = num(item.count);
    const showLabel = !labelStep || index % labelStep === 0 || index === series.length - 1;
    chart.append(el("div", { class: "bar" }, [
      el("i", { style: "--h:" + Math.round((count / max) * 100) + "%", title: count + " on " + item.day }),
      el("small", {}, [showLabel ? dayLabel(item.day) : ""])
    ]));
  });
  return chart;
}

function statusChart(byStatus) {
  const entries = Object.entries(byStatus || {});
  if (!entries.length) return el("p", { class: "mute" }, ["No stages yet."]);
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

export async function renderSetter(supabase, userId, root) {
  if (!root) return;
  root.innerHTML = "";
  root.append(el("p", { class: "mute" }, ["Loading your setter…"]));
  const agentRes = await supabase.from("client_ai_setters").select("id, client_id, agent_name, status, prompt_sections, prompt_updated_at, last_activity_at").eq("client_id", userId).maybeSingle();
  if (agentRes.error) {
    root.innerHTML = "";
    root.append(panel(unavailable(agentRes.error) ? "Your AI setter will show here once it is connected." : "Your AI setter could not be loaded."));
    return;
  }
  const agent = agentRes.data;
  if (!agent) {
    root.innerHTML = "";
    root.append(panel("No setter is linked to this account yet."));
    return;
  }

  const [statRes, leadRes] = await Promise.all([
    supabase.from("client_ai_setter_stats").select("agent_id, total_leads, by_status, by_source, by_category, converted_count, conversion_rate, last_activity_at, leads_per_day").eq("agent_id", agent.id).maybeSingle(),
    supabase.from("client_ai_setter_leads").select("lead_name, username, stage, last_message_time, is_converted").eq("agent_id", agent.id).order("last_message_time", { ascending: false, nullsFirst: false }).limit(20)
  ]);
  root.innerHTML = "";
  if (statRes.error || leadRes.error) {
    root.append(panel("Your AI setter could not be loaded."));
    return;
  }

  const figures = setterFigures(statRes.data || {});
  const status = setterStatus(agent.status);
  const summary = el("div", { id: "setter-summary" });
  summary.append(el("div", { class: "setter-head" }, [
    el("h3", {}, [agent.agent_name || "AI Setter"]),
    el("span", { class: status === "Paused" ? "badge paused" : "badge", id: "setter-status" }, [status])
  ]));
  summary.append(el("p", { class: "mute" }, [
    "Last activity " + when(figures.last || agent.last_activity_at) + ". Prompt updated " + when(agent.prompt_updated_at) + "."
  ]));
  const hot = figures.byStatus.hot;
  const warm = figures.byStatus.warm;
  const cold = figures.byStatus.cold;
  summary.append(el("div", { class: "kpi-grid" }, [
    kpi("Conversations", String(figures.conversations)),
    kpi("Leads", String(figures.leads)),
    kpi("Booked calls", String(figures.booked)),
    kpi("Booking rate", formatRate(figures.rate, figures.conversations)),
    kpi("Hot", String(num(hot))),
    kpi("Warm", String(num(warm))),
    kpi("Cold", String(num(cold)))
  ]));

  summary.append(el("h3", {}, ["By stage"]));
  summary.append(statusChart(figures.byStatus));
  const sources = Object.entries(figures.bySource);
  summary.append(el("h3", {}, ["By source"]));
  summary.append(sources.length ? statusChart(figures.bySource) : el("p", { class: "mute" }, ["No source was returned for these leads."]));
  const series = figures.perDay;
  const week = series.slice(-7);
  summary.append(el("h3", {}, ["Last 7 days"]));
  summary.append(week.length ? bars(week, "Conversations per day over the last 7 days") : el("p", { class: "mute" }, ["No daily counts yet."]));
  summary.append(el("h3", {}, ["Last 30 days"]));
  summary.append(series.length ? bars(series, "Conversations per day over the last 30 days", 5) : el("p", { class: "mute" }, ["No daily counts yet."]));

  summary.append(el("h3", {}, ["Recent leads"]));
  const leads = leadRes.data || [];
  if (!leads.length) {
    summary.append(el("p", { class: "mute" }, ["No leads yet."]));
  } else {
    const table = el("table", { class: "crm-table" });
    table.append(el("thead", {}, [el("tr", {}, [
      "Name", "Stage", "Last message", "Qualified", "Booked"
    ].map((label) => el("th", { scope: "col" }, [label])))]));
    const body = el("tbody");
    leads.forEach((lead) => {
      body.append(el("tr", {}, [
        el("td", {}, [leadTitle(lead)]),
        el("td", {}, [lead.stage || "—"]),
        el("td", {}, [when(lead.last_message_time)]),
        el("td", {}, [isQualified(lead) ? "Yes" : "No"]),
        el("td", {}, [isBooked(lead) ? "Yes" : "No"])
      ]));
    });
    table.append(body);
    summary.append(el("div", { class: "crm-scroll" }, [table]));
  }

  const prompt = el("div", { id: "setter-prompt" });
  prompt.append(el("h3", {}, ["Live prompt"]));
  prompt.append(el("p", { class: "mute" }, ["Read only. These are the nine sections currently live."]));
  const list = el("div", { class: "section-list" });
  liveSections(agent.prompt_sections).forEach((section, index) => {
    list.append(el("article", { class: "section-block" }, [
      el("h3", {}, [(index + 1) + ". " + section.title]),
      el("pre", { class: "prompt" }, [section.text || "Not in the live prompt yet."])
    ]));
  });
  prompt.append(list);
  root.append(summary, prompt);
}
