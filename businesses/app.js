import { getSupabase, isConfigured, logout } from "../auth/supabase.js";
import { clearAuthParams, clearCallbackMemory, rememberCallback, resolveSession } from "../auth/callback.js";
import { bindShell, markNav, toast } from "../auth/ui.js";
import { liveSections } from "../account/setter-model.js";
import { activitySeries, categoryTone, createdAgo, initials, last7, scrub, seriesTotal, stageChip, windowSeries, withinDays } from "./model.js";

bindShell();

const SECTIONS = [
  { id: "high_priority_rule", title: "HIGH PRIORITY RULE" },
  { id: "identity", title: "IDENTITY & MISSION" },
  { id: "nonnegotiables", title: "NON-NEGOTIABLES" },
  { id: "style", title: "STYLE, FORMATTING & TONE" },
  { id: "context", title: "CONTEXT & OUTREACH" },
  { id: "qualification", title: "QUALIFICATION LOGIC" },
  { id: "links", title: "LINK ASSETS" },
  { id: "workflow", title: "WORKFLOW LOGIC" },
  { id: "objections", title: "OBJECTION HANDLING" }
];

const DETAIL_TABS = [
  ["leads", "Leads"],
  ["workflow", "Workflow"],
  ["stats", "Stats"],
  ["campaigns", "Campaigns"]
];

const COLORS = ["#E8B04A", "#C0409A", "#FF8A3D", "#7B4DFF", "#9AA6C6", "#3DDC97"];
const LEAD_PAGE = 8;
const STATUS_LABELS = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  integrated: "Integrated",
  live: "Live"
};

const heading = document.getElementById("page-heading");
const sub = document.getElementById("page-sub");
const app = document.getElementById("biz-app");
const nav = document.getElementById("biz-nav");
const logoutBtn = document.getElementById("nav-logout");
logoutBtn.addEventListener("click", logout);

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

function hideBoot() {
  const boot = document.getElementById("boot-state");
  if (boot) boot.hidden = true;
}

function showState(title, message) {
  hideBoot();
  app.innerHTML = "";
  app.append(el("div", { class: "state" }, [
    el("h2", { text: title }),
    el("p", { text: message })
  ]));
}

function asObject(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_error) {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asSeries(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }
  return [];
}

function missingColumn(error) {
  return error && /schema cache|PGRST204|column/i.test(error.message || "");
}

function missingRelation(error) {
  return error && /schema cache|does not exist|PGRST205/i.test(error.message || "");
}

function parseRoute() {
  const raw = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(leads|workflow|stats|campaigns)$/i.exec(raw);
  if (!match) return { kind: "grid" };
  return { kind: "detail", id: match[1], section: match[2].toLowerCase() };
}

function go(hash) {
  if (window.location.hash === hash) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  window.location.hash = hash;
}

function when(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function rateLabel(value, total) {
  if (!Number(total)) return "—";
  const rate = Number(value);
  if (!Number.isFinite(rate)) return "—";
  const shown = (rate * 100).toFixed(1).replace(/\.0$/, "");
  return shown + "%";
}

function contactLabel(lead) {
  const handle = String(lead.username || "").trim();
  if (handle) return handle.startsWith("@") ? handle : "@" + handle;
  const contact = String(lead.lead_contact || "").trim();
  return contact || "—";
}

function sparkline(days) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 36");
  svg.setAttribute("class", "spark");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Leads over the last 7 days");
  const max = Math.max(1, ...days.map((day) => day.count));
  const points = days.map((day, index) => {
    const x = days.length === 1 ? 0 : (index / (days.length - 1)) * 120;
    const y = 34 - (day.count / max) * 30;
    return x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("points", points);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "#E8B04A");
  line.setAttribute("stroke-width", "2");
  svg.append(line);
  return svg;
}

function submissionOf(person) {
  const raw = person && person.onboarding_submissions;
  if (Array.isArray(raw)) return raw[0] || null;
  return raw || null;
}

function clientLine(agent, peopleById) {
  if (!agent || !agent.client_id) return "Not linked";
  const person = peopleById && peopleById.get(agent.client_id);
  if (!person) return "Linked client";
  const name = person.full_name || person.business_name || person.email || "Linked client";
  const status = STATUS_LABELS[submissionOf(person)?.status] || "Not started";
  return name + " · " + status;
}

function entriesOf(counts) {
  return Object.entries(asObject(counts)).filter(([key, count]) => String(key).trim() && Number(count) > 0);
}

function donut(title, counts) {
  const block = el("section", { class: "panel chart-card" }, [el("h3", { text: title })]);
  const entries = entriesOf(counts);
  const total = entries.reduce((sum, [, count]) => sum + Number(count), 0);
  if (!total) {
    block.append(el("p", { class: "mute", text: "No breakdown was returned." }));
    return block;
  }
  let cursor = 0;
  const stops = entries.map(([, count], index) => {
    const start = cursor;
    cursor += (Number(count) / total) * 100;
    return COLORS[index % COLORS.length] + " " + start.toFixed(2) + "% " + cursor.toFixed(2) + "%";
  });
  const wrap = el("div", { class: "donut-wrap" });
  const ring = el("div", { class: "donut", role: "img", "aria-label": title });
  ring.style.background = "conic-gradient(" + stops.join(", ") + ")";
  const legend = el("ul", { class: "legend" });
  entries.forEach(([key, count], index) => {
    const pct = Math.round((Number(count) / total) * 100);
    const item = el("li", {}, [
      el("i", { class: "swatch" }),
      el("span", { class: "legend-name", text: key }),
      el("b", { class: "legend-pct", text: pct + "%" })
    ]);
    item.querySelector(".swatch").style.background = COLORS[index % COLORS.length];
    legend.append(item);
  });
  wrap.append(ring, legend);
  block.append(wrap);
  return block;
}

function sourceBars(counts) {
  const block = el("section", { class: "panel chart-card" }, [el("h3", { text: "Lead source" })]);
  const entries = entriesOf(counts);
  if (!entries.length) {
    block.append(el("p", { class: "mute", text: "No source was returned." }));
    return block;
  }
  const max = Math.max(...entries.map(([, count]) => Number(count)));
  const rows = el("div", { class: "status-bars" });
  entries.forEach(([key, count]) => {
    const width = max ? Math.round((Number(count) / max) * 100) : 0;
    const row = el("div", { class: "row" }, [
      el("span", { text: key }),
      el("span", { class: "track" }, [el("i", { class: "fill" })]),
      el("b", { text: String(count) })
    ]);
    row.querySelector(".fill").style.setProperty("--w", width + "%");
    rows.append(row);
  });
  block.append(rows);
  return block;
}

function dayChart(series) {
  const block = el("section", { class: "panel chart-card" }, [el("h3", { text: "Chats per day" })]);
  const days = asSeries(series);
  if (!days.length) {
    block.append(el("p", { class: "mute", text: "No daily counts were returned." }));
    return block;
  }
  const max = Math.max(1, ...days.map((day) => Number(day.count) || 0));
  const chart = el("div", { class: "chart", role: "img", "aria-label": "Chats per day" });
  days.forEach((day) => {
    const count = Number(day.count) || 0;
    const bar = el("div", { class: "bar" }, [
      el("span", { class: "bar-value", text: String(count) }),
      el("i"),
      el("small", { text: String(day.day || "").slice(5) })
    ]);
    bar.querySelector("i").style.setProperty("--h", Math.round((count / max) * 100) + "%");
    chart.append(bar);
  });
  block.append(chart);
  return block;
}

const arriving = rememberCallback(window.location.href);
if (arriving.type === "recovery") {
  window.location.replace("/reset/" + window.location.hash);
} else if (!isConfigured()) {
  showState("Accounts unavailable", "Paste SUPABASE_URL and SUPABASE_ANON_KEY into supabase/config.js, then refresh.");
} else {
  const supabase = getSupabase();
  const resolved = await resolveSession(supabase, window.location.href);
  if (!resolved.session) {
    const notice = resolved.errorMessage;
    window.location.replace(notice
      ? "/signup/?mode=login&notice=" + encodeURIComponent(notice) + "&next=/businesses/"
      : "/login/?next=/businesses/");
  } else {
    clearAuthParams();
    clearCallbackMemory();
    logoutBtn.hidden = false;
    const user = resolved.session.user;
    await boot(supabase, user);
  }
}

async function boot(supabase, user) {
  const profileRes = await supabase.from("profiles").select("full_name, email, business_name").eq("id", user.id).maybeSingle();
  let profile = profileRes.data;
  if (missingColumn(profileRes.error)) {
    const slim = await supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();
    profile = slim.data;
  }
  const name = profile?.full_name || user.user_metadata?.full_name || "Account";
  const email = profile?.email || user.email || "";
  const chip = document.getElementById("user-chip");
  document.getElementById("user-name").textContent = name;
  document.getElementById("user-email").textContent = email;
  chip.hidden = false;

  const adminRes = await supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
  const isAdmin = Boolean(adminRes.data);
  if (isAdmin) {
    nav.append(el("nav", { class: "app-nav", id: "admin-links", "aria-label": "Admin" }, [
      el("a", { href: "/businesses/" }, ["Businesses"]),
      el("a", { href: "/admin/#clients" }, ["Clients"]),
      el("a", { href: "/admin/#publish" }, ["Publish queue"]),
      el("a", { href: "/admin/#crm" }, ["CRM/Insights"]),
      el("a", { href: "/account/#profile" }, ["Your account"])
    ]));
    markNav();
  }

  const peopleById = new Map();
  let peopleRes = await supabase.from("profiles").select("id, full_name, email, business_name, onboarding_submissions(status)");
  if (peopleRes.error) {
    peopleRes = await supabase.from("profiles").select("id, full_name, email, onboarding_submissions(status)");
  }
  if (peopleRes.error) {
    peopleRes = await supabase.from("profiles").select("id, full_name, email");
  }
  if (!peopleRes.error) {
    (peopleRes.data || []).forEach((person) => peopleById.set(person.id, person));
  }

  let agentsRes = await supabase.from("client_ai_setters").select("id, client_id, agent_name, status, prompt_sections, prompt_updated_at, last_activity_at, created_at");
  if (missingColumn(agentsRes.error)) {
    agentsRes = await supabase.from("client_ai_setters").select("id, client_id, agent_name, status, prompt_sections, prompt_updated_at, last_activity_at");
  }
  if (agentsRes.error) {
    hideBoot();
    const message = missingRelation(agentsRes.error)
      ? "Apply the businesses migration, then refresh."
      : scrub(agentsRes.error.message);
    showState("Your businesses could not be loaded", message);
    paintSide(user, [], null);
    return;
  }

  let statsRes = await supabase.from("client_ai_setter_stats").select("agent_id, total_leads, by_status, by_source, by_category, converted_count, conversion_rate, last_activity_at, leads_per_day");
  if (missingColumn(statsRes.error)) {
    statsRes = await supabase.from("client_ai_setter_stats").select("agent_id, total_leads, by_status, by_source, converted_count, conversion_rate, last_activity_at, leads_per_day");
  }
  const statsById = new Map();
  (statsRes.data || []).forEach((row) => statsById.set(row.agent_id, row));
  const agents = agentsRes.data || [];
  const statsError = statsRes.error ? scrub(statsRes.error.message) : "";

  function paint() {
    const route = parseRoute();
    hideBoot();
    if (route.kind === "grid") paintGrid(supabase, user, agents, statsById, peopleById, isAdmin, statsError);
    else paintDetail(supabase, user, agents, statsById, route, isAdmin, peopleById);
    paintSide(user, agents, route.kind === "detail" ? route : null);
  }

  window.addEventListener("hashchange", paint);
  paint();
}

function paintSide(user, agents, route) {
  const existing = document.getElementById("biz-switch");
  if (existing) existing.remove();
  const block = el("div", { id: "biz-switch" });
  const links = el("nav", { class: "app-nav", "aria-label": "Business" });
  const home = el("a", { href: "/businesses/#list" }, ["All businesses"]);
  if (!route) home.setAttribute("aria-current", "page");
  home.addEventListener("click", (event) => {
    event.preventDefault();
    go("#list");
  });
  links.append(home);
  if (route && agents.length) {
    const label = el("label", { class: "switcher", text: "Business" });
    const select = el("select", { id: "agent-switch", "aria-label": "Choose a business" });
    agents.forEach((agent) => {
      const option = el("option", { value: agent.id, text: agent.agent_name || "AI Setter" });
      if (agent.id === route.id) option.selected = true;
      select.append(option);
    });
    select.addEventListener("change", () => go("#" + select.value + "/" + route.section));
    label.append(select);
    block.append(label);
    DETAIL_TABS.forEach(([id, title]) => {
      const link = el("a", { href: "#" + route.id + "/" + id }, [title]);
      if (route.section === id) link.setAttribute("aria-current", "page");
      link.addEventListener("click", (event) => {
        event.preventDefault();
        go("#" + route.id + "/" + id);
      });
      links.append(link);
    });
  }
  block.append(links);
  if (!document.getElementById("admin-links")) {
    const onboarding = el("a", { href: "/account/#onboarding" }, ["Edit onboarding"]);
    links.append(onboarding);
  }
  const adminLinks = document.getElementById("admin-links");
  if (adminLinks) adminLinks.after(block);
  else nav.prepend(block);
}

function paintGrid(supabase, user, agents, statsById, peopleById, isAdmin, statsError) {
  heading.innerHTML = isAdmin ? 'Businesses' : 'Your <span class="g">businesses</span>';
  document.title = isAdmin ? "Businesses · Roleflow" : "Your businesses · Roleflow";
  const owned = agents.some((agent) => agent.client_id === user.id);
  sub.textContent = agents.length
    ? (isAdmin ? "Every setter in the cache, including ones with no linked client." : "Each card opens leads, workflow, stats, and campaigns.")
    : (isAdmin ? "No setters are in the cache yet." : "No business is linked to this account yet.");
  app.innerHTML = "";
  if (statsError) {
    app.append(el("p", { class: "err", text: "Stats could not be loaded. " + statsError }));
  }
  const grid = el("div", { class: "biz-grid" });
  if (!agents.length) {
    grid.append(el("div", { class: "state" }, [
      el("h2", { text: "No businesses yet" }),
      el("p", { text: isAdmin ? "Setters show here after they are in the cache, even before a client is linked." : "Add the business name, or wait until an admin links one." })
    ]));
  }
  agents.forEach((agent) => {
    const stats = statsById.get(agent.id) || {};
    const week = last7(asSeries(stats.leads_per_day));
    const total = Number(stats.total_leads);
    const shown = Number.isFinite(total) ? total : week.total;
    const active = agent.status !== "paused";
    const card = el("a", { class: "biz-card", href: "#" + agent.id + "/leads" });
    card.addEventListener("click", (event) => {
      event.preventDefault();
      go("#" + agent.id + "/leads");
    });
    const status = el("p", { class: "status-line" }, [
      el("i", { class: active ? "dot on" : "dot" }),
      active ? "AI active" : "Paused"
    ]);
    const open = el("span", { class: "ext", "aria-hidden": "true" });
    open.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="2" d="M14 5h5v5M19 5l-9 9"/><path fill="none" stroke="currentColor" stroke-width="2" d="M16 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h5"/></svg>';
    card.append(
      open,
      status,
      el("h2", { text: agent.agent_name || "AI Setter" }),
      el("p", { class: "card-client", text: clientLine(agent, peopleById) }),
      el("p", { class: "mute", text: createdAgo(agent.created_at) }),
      sparkline(week.days),
      el("p", { class: "lead-count", text: String(shown) }),
      el("p", { class: "mute", text: Number.isFinite(total) ? "Conversations in the sync" : "Leads in the last 7 days" })
    );
    grid.append(card);
  });
  if (!isAdmin) grid.append(addCard(supabase, user, owned));
  app.append(grid);
}

function addCard(supabase, user, owned) {
  const card = el("article", { class: "biz-card add", id: "add-business" });
  card.append(el("h2", { text: "Add business" }));
  if (owned) {
    card.append(el("p", { text: "This account already has a business. Linking another one stays in admin." }));
    return card;
  }
  const form = el("form", { id: "add-business-form" });
  const input = el("input", { name: "name", type: "text", required: true, placeholder: "Business name", "aria-label": "Business name" });
  const button = el("button", { class: "btn", type: "submit" }, ["Add business"]);
  const note = el("p", { class: "mute", id: "add-business-note" });
  form.append(input, button, note);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    button.disabled = true;
    const result = await supabase.rpc("link_business", { p_name: name });
    button.disabled = false;
    if (result.error) {
      const message = missingRelation(result.error)
        ? "Apply the businesses migration, then refresh."
        : scrub(result.error.message);
      note.textContent = message;
      toast(message, "bad");
      return;
    }
    if (result.data) {
      toast("Matched and linked.");
      window.location.reload();
      return;
    }
    note.textContent = "Saved. It will show here once a business with this name is linked.";
    toast(note.textContent);
  });
  card.append(form, el("p", { class: "mute", text: "One account links to one business. The name is matched exactly." }));
  return card;
}

async function paintDetail(supabase, user, agents, statsById, route, isAdmin, peopleById) {
  const agent = agents.find((item) => item.id === route.id);
  if (!agent) {
    heading.textContent = "Business";
    sub.textContent = "That business is not on this account.";
    app.innerHTML = "";
    app.append(el("div", { class: "state" }, [
      el("h2", { text: "Business not found" }),
      el("p", { text: "It may belong to another account, or the link was removed." }),
      el("a", { class: "btn", href: "/businesses/#list" }, ["Back to your businesses"])
    ]));
    return;
  }
  heading.textContent = agent.agent_name || "AI Setter";
  document.title = (agent.agent_name || "Business") + " · Roleflow";
  const tab = DETAIL_TABS.find(([id]) => id === route.section)?.[1] || "";
  sub.textContent = clientLine(agent, peopleById) + (tab ? " · " + tab : "");
  app.innerHTML = "";
  app.append(el("div", { class: "state", id: "section-loading", role: "status" }, [
    el("span", { class: "skel" }),
    el("p", { text: "Loading…" })
  ]));
  if (route.section === "leads") await paintLeads(supabase, agent.id, statsById.get(agent.id));
  else if (route.section === "workflow") await paintWorkflow(supabase, agent);
  else if (route.section === "stats") await paintStats(supabase, agent, statsById.get(agent.id));
  else paintCampaigns(isAdmin);
}

async function paintLeads(supabase, agentId, cached) {
  let result = await supabase.from("client_ai_setter_leads").select("agent_id, lead_name, username, stage, last_message_time, is_converted, category, lead_contact").eq("agent_id", agentId).order("last_message_time", { ascending: false }).limit(500);
  if (missingColumn(result.error)) {
    result = await supabase.from("client_ai_setter_leads").select("agent_id, lead_name, username, stage, last_message_time, is_converted, category").eq("agent_id", agentId).order("last_message_time", { ascending: false }).limit(500);
  }
  app.innerHTML = "";
  if (result.error) {
    app.append(el("div", { class: "state" }, [
      el("h2", { text: "Leads could not be loaded" }),
      el("p", { text: scrub(result.error.message) })
    ]));
    return;
  }
  const leads = result.data || [];
  const tools = el("div", { class: "crm-tools" });
  const search = el("input", { id: "lead-search", type: "search", placeholder: "Search name, contact, status, or category", "aria-label": "Search leads" });
  const count = el("p", { class: "mute", id: "lead-count" });
  tools.append(search, count);
  const scroller = el("div", { class: "crm-scroll panel" });
  const table = el("table", { class: "crm-table" });
  table.append(el("thead", {}, [el("tr", {}, ["Name", "Contact", "Status", "Category", "Last message"].map((label) => el("th", { text: label })))]));
  const body = el("tbody");
  table.append(body);
  scroller.append(table);
  const pager = el("nav", { class: "pager", id: "lead-pager", "aria-label": "Lead pages" });
  const caption = el("p", { class: "mute", text: "The time of the last message. Message text is not in the synced data." });
  app.append(tools, scroller, pager, caption);
  let page = 0;

  function draw() {
    const query = search.value.trim().toLowerCase();
    const rows = leads.filter((lead) => {
      if (!query) return true;
      return [lead.lead_name, contactLabel(lead), lead.stage, lead.category, when(lead.last_message_time)].join(" ").toLowerCase().includes(query);
    });
    const pages = Math.max(1, Math.ceil(rows.length / LEAD_PAGE));
    if (page > pages - 1) page = pages - 1;
    if (page < 0) page = 0;
    const slice = rows.slice(page * LEAD_PAGE, page * LEAD_PAGE + LEAD_PAGE);
    body.innerHTML = "";
    count.textContent = rows.length + " of " + leads.length + (leads.length >= 500 ? "+" : "") + " leads";
    if (!leads.length) {
      const total = Number(cached && cached.total_leads);
      const empty = Number.isFinite(total) && total > 0
        ? "The sync counted " + total + " conversations, but no lead rows were returned."
        : "No leads in the last sync.";
      body.append(el("tr", {}, [el("td", { colspan: "5", text: empty })]));
    } else if (!rows.length) {
      body.append(el("tr", {}, [el("td", { colspan: "5", text: "No leads match this search." })]));
    } else {
      slice.forEach((lead) => body.append(leadRow(lead)));
    }
    paintPager(pager, page, rows.length ? pages : 1, (next) => {
      page = next;
      draw();
    });
  }
  search.addEventListener("input", () => {
    page = 0;
    draw();
  });
  draw();
}

function leadRow(lead) {
  const tone = stageChip(lead.stage);
  const raw = String(lead.stage || "").trim();
  const label = tone === "other"
    ? (raw || "Unknown")
    : raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  const category = String(lead.category || "").trim();
  const who = el("td", { class: "who" }, [
    el("span", { class: "avatar", "aria-hidden": "true", text: initials(lead.lead_name) }),
    lead.lead_name || "—"
  ]);
  who.querySelector(".avatar").style.background = COLORS[Math.abs(hashCode(lead.lead_name)) % 4];
  return el("tr", {}, [
    who,
    el("td", { text: contactLabel(lead) }),
    el("td", {}, [el("span", { class: "chip " + tone, text: label })]),
    el("td", {}, [category
      ? el("span", { class: "chip " + categoryTone(category), text: category.charAt(0).toUpperCase() + category.slice(1) })
      : "—"]),
    el("td", { text: when(lead.last_message_time) })
  ]);
}

function sectionText(raw, id) {
  const slot = liveSections(raw).find((item) => item.id === id);
  return slot && slot.text ? String(slot.text).trim() : "";
}

function hashCode(value) {
  return String(value || "?").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function paintPager(pager, page, pages, goPage) {
  pager.innerHTML = "";
  const prev = el("button", { type: "button", class: "btn ghost sm" }, ["Previous"]);
  const next = el("button", { type: "button", class: "btn ghost sm" }, ["Next"]);
  prev.disabled = page <= 0;
  next.disabled = page >= pages - 1;
  prev.addEventListener("click", () => goPage(page - 1));
  next.addEventListener("click", () => goPage(page + 1));
  pager.append(prev, el("span", { text: (page + 1) + " / " + pages }), next);
}

async function paintWorkflow(supabase, agent) {
  const versionsRes = await supabase.from("client_prompt_versions").select("agent_id, version_id, deployed_at, sections, recorded_at").eq("agent_id", agent.id).order("deployed_at", { ascending: false });
  app.innerHTML = "";
  let showing = agent.prompt_sections;
  let showingLabel = agent.prompt_updated_at ? "Current · " + when(agent.prompt_updated_at) : "Current";
  const tools = el("div", { class: "crm-tools" });
  const select = el("select", { id: "version-select", "aria-label": "Prompt version" });
  select.append(el("option", { value: "", text: showingLabel }));
  const versions = versionsRes.error ? [] : (versionsRes.data || []);
  versions.forEach((version, index) => {
    select.append(el("option", { value: String(index), text: "Version " + (version.version_id || index + 1) + " · " + when(version.deployed_at || version.recorded_at) }));
  });
  tools.append(select);
  const host = el("div", { id: "workflow-sections" });
  const test = el("section", { class: "panel", id: "test-chat" }, [
    el("h3", { text: "Test chat" }),
    el("p", { text: "Test chat available in admin." })
  ]);
  app.append(tools, host, test);
  if (versionsRes.error && !missingRelation(versionsRes.error)) {
    app.append(el("p", { class: "err", text: scrub(versionsRes.error.message) }));
  } else if (versionsRes.error) {
    app.append(el("p", { class: "mute", text: "Version history will show after the businesses migration is applied." }));
  }

  let sectionIndex = 0;

  function draw() {
    host.innerHTML = "";
    const hasAny = SECTIONS.some((section) => sectionText(showing, section.id));
    if (!hasAny) {
      host.append(el("div", { class: "state" }, [
        el("h2", { text: "No prompt stored" }),
        el("p", { text: "Sections appear here after a prompt is saved for this business." })
      ]));
      return;
    }
    if (sectionIndex > SECTIONS.length - 1) sectionIndex = 0;
    const layout = el("div", { class: "workflow-layout" });
    const rail = el("nav", { class: "section-rail", "aria-label": "Prompt sections" });
    SECTIONS.forEach((section, index) => {
      const button = el("button", { type: "button" }, [
        el("b", { text: String(index + 1) }),
        section.title
      ]);
      if (index === sectionIndex) button.setAttribute("aria-current", "true");
      button.addEventListener("click", () => {
        sectionIndex = index;
        draw();
      });
      rail.append(button);
    });
    const section = SECTIONS[sectionIndex];
    const text = sectionText(showing, section.id);
    const body = el("section", { class: "section-block", id: "workflow-body" }, [
      el("p", { class: "mute", text: showingLabel }),
      el("h3", { text: (sectionIndex + 1) + ". " + section.title }),
      el("pre", { class: "prompt", text: text || "Not stored." })
    ]);
    layout.append(rail, body);
    host.append(layout);
  }

  select.addEventListener("change", () => {
    if (select.value === "") {
      showing = agent.prompt_sections;
      showingLabel = agent.prompt_updated_at ? "Current · " + when(agent.prompt_updated_at) : "Current";
    } else {
      const version = versions[Number(select.value)];
      showing = version && version.sections;
      showingLabel = "Version " + (version.version_id || "") + " · " + when(version.deployed_at || version.recorded_at);
    }
    sectionIndex = 0;
    draw();
  });
  draw();
}

async function paintStats(supabase, agent, cached) {
  const stats = cached || {};
  let leadsRes = await supabase.from("client_ai_setter_leads").select("agent_id, stage, last_message_time, is_converted, category").eq("agent_id", agent.id).limit(500);
  if (leadsRes.error) leadsRes = { data: null, error: leadsRes.error };
  app.innerHTML = "";
  const leads = leadsRes.data || [];
  const ranges = el("div", { class: "ranges", id: "range-control", role: "radiogroup", "aria-label": "Date range" });
  const charts = el("div", { class: "chart-grid" });
  const kpis = el("div", { class: "kpi-grid", role: "group", "aria-label": "Business stats" });
  app.append(ranges, kpis);
  let range = "30";

  function paint(next) {
    range = next;
    ranges.innerHTML = "";
    [["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["all", "All"]].forEach(([value, label]) => {
      const button = el("button", { type: "button", role: "radio", "aria-checked": range === value ? "true" : "false" }, [label]);
      button.addEventListener("click", () => paint(value));
      ranges.append(button);
    });
    const days = range === "all" ? 0 : Number(range);
    const rows = range === "all" ? leads : leads.filter((lead) => withinDays(lead.last_message_time, days));
    const converted = rows.filter((lead) => lead.is_converted === true).length;
    const cachedTotal = Number(stats.total_leads);
    const hasCache = Number.isFinite(cachedTotal);
    const windowEmpty = range !== "all" && !rows.length;
    const conversations = range === "all" || windowEmpty
      ? (hasCache ? cachedTotal : rows.length)
      : rows.length;
    const people = rows.length >= 500 && conversations > rows.length ? rows.length + "+" : String(rows.length);
    const rate = (range === "all" || windowEmpty) && hasCache
      ? rateLabel(stats.conversion_rate, stats.total_leads)
      : rateLabel(rows.length ? converted / rows.length : null, rows.length);
    kpis.innerHTML = "";
    [
      ["Conversations", String(conversations)],
      ["People", people],
      ["Converted", (range === "all" || windowEmpty) && stats.converted_count != null && !rows.length ? String(stats.converted_count) : String(converted)],
      ["Conversion rate", rate]
    ].forEach(([label, value]) => {
      kpis.append(el("div", { class: "kpi" }, [el("b", { text: value }), el("span", { text: label })]));
    });
    charts.innerHTML = "";
    if (!cached && !rows.length && !hasCache) {
      charts.append(el("p", { class: "mute", text: "Stats will show after the next sync." }));
      return;
    }
    if (windowEmpty && hasCache) {
      charts.append(el("p", { class: "mute", text: "No messages in this range. Showing the full sync (" + cachedTotal + " conversations)." }));
    } else if (range !== "all" && hasCache) {
      charts.append(el("p", { class: "mute", text: "Full sync: " + cachedTotal + " conversations." }));
    }
    const byCategory = tally(rows, (lead) => lead.category);
    const byStatus = tally(rows, (lead) => lead.stage);
    const categoryCounts = rows.length ? byCategory : (hasCache ? stats.by_category : {});
    const statusCounts = rows.length ? byStatus : (hasCache ? stats.by_status : {});
    charts.append(donut("Chats by category", categoryCounts));
    charts.append(donut("Lead status", statusCounts));
    charts.append(sourceBars(stats.by_source));
    if (range !== "all") {
      charts.append(el("p", { class: "mute source-note", text: "Lead source is stored as an all-time total, so that chart stays on the full sync." }));
    }
    const stored = asSeries(stats.leads_per_day);
    const daily = seriesTotal(stored) > 0 ? windowSeries(stored, days || 0) : activitySeries(leads, days || 30);
    if (seriesTotal(stored) === 0 && leads.length) {
      charts.append(el("p", { class: "mute", text: "Chats per day use cached last-message times. The stored join series is empty." }));
    }
    charts.append(dayChart(daily));
  }
  app.append(charts);
  paint(range);
}

function tally(rows, pick) {
  const out = {};
  rows.forEach((row) => {
    const key = String(pick(row) || "").trim();
    if (!key) return;
    out[key] = (out[key] || 0) + 1;
  });
  return out;
}

function paintCampaigns(isAdmin) {
  app.innerHTML = "";
  const panel = el("div", { class: "state", id: "campaigns-empty" }, [
    el("h2", { text: "No campaign feed" }),
    el("p", { text: "Broadcasts are not included in the synced business data, so this page does not invent them." })
  ]);
  if (isAdmin) {
    panel.append(el("p", {}, [
      el("a", { href: "/admin/#crm" }, ["Template sends are on the CRM desk."])
    ]));
  }
  app.append(panel);
}
