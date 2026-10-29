import { navLabel, NAV_GROUPS } from "./client-nav.mjs";
import { sectionText } from "./section-copy.js";
import { renderOffice } from "./office.js";
import { persistCollapsedGroups, readCollapsedGroups } from "./sidebar-state.js";
import { renderConfiguration as opsConfig, renderPerformance as opsPerformance, renderStats as opsStats, renderTeam as opsTeam } from "./studio-ops.js";

const ICONS = {
  grid: ["M3 3h7v7H3z", "M14 3h7v7h-7z", "M14 14h7v7h-7z", "M3 14h7v7H3z"],
  clipboard: ["M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2", "M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z", "M9 12h6", "M9 16h6"],
  link: ["M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71", "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"],
  folder: ["M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"],
  send: ["M14.5 21.5a.5.5 0 0 0 .94 0l6.5-19a.5.5 0 0 0-.64-.64l-19 6.5a.5.5 0 0 0 0 .94l7.9 3.16a2 2 0 0 1 1.12 1.11z", "M21.9 2.1 11 13"],
  comment: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  inbox: ["M22 12h-6l-2 3H10l-2-3H2", "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"],
  users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  chart: ["M3 3v18h18", "M18 17V9", "M13 17V5", "M8 17v-3"],
  trend: ["M22 7 13.5 15.5l-5-5L2 17", "M16 7h6v6"],
  settings: ["M12.2 2h-.4a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  userplus: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M19 8v6", "M22 11h-6"],
  pin: ["M9 18l6-6-6-6"],
  chevron: ["M6 9l6 6 6-6"],
  chevronLeft: ["M15 18l-6-6 6-6"],
  chevronRight: ["M9 18l6-6-6-6"],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"]
};

const HOW = {
  dashboard: "This is the home for one business. Accounts shows whether Instagram is connected. Alerts lists pauses, pending sync, and exceptions. Nothing here is a sample number.",
  onboarding: "These questions describe the niche, offer, Instagram, worker, and voice notes. Saving them updates this business. Open the prompt preview when you want to read the setter prompt and send it to the engine.",
  brief: "Paste the SOP workflow and the top-converting conversations. Build my setter drafts a prompt from those two. Missing sections are flagged. Nothing goes live until you save it as a new prompt version.",
  links: "Sales links have a name, text, URL, coupon, average ticket, and sending instructions. A link can be sent as a button and limited to chosen agents. Scheduling endpoints for Calendly, GoHighLevel, or a custom URL are stored here. An optional key is saved privately and is not shown again.",
  content: "Value content can be an image, audio, video, link, or button, with sending instructions and a placement: before the messages, after the messages, or left to the AI. Upload limits are 8 MB, 20 MB, and 50 MB. Voice notes stay in the library below.",
  outbound: "Outbound Manager runs ICP Target Acquisition, Engagement Warm-Up, and Personalised Outreach. The daily cap is 20 to 30 new targets. Pending openers are drafts waiting in the queue.",
  inbound: "Inbound Manager is the Roleflow Setter Engine: comment-to-DM, story DMs, qualification, follow-ups, and booking. Pending activation means the engine agent is not linked yet. Syncing means a change is waiting to be applied.",
  pipeline: "CRM states are Open, Discovering, Qualifying, Proposal, Booked, Paid, Lost, Unqualified, and Postponed. List and board show the leads stored for this business. Filters, notes, and the message queue stay here. Nothing in the queue is sent while live sync is off.",
  followups: "Follow-ups stay inside the 24-hour messaging window. Steps run from 1 to 23 hours, as AI instructions or literal text, with a variant per lead state. Welcome messages are two at most. The 7-day list is drafted here and sent by a person.",
  reminders: "Reminders are tasks or a conversation to resume. Overdue, today, and the next 7 days are counted from the due time. A suggestion from the model is saved only after you add it.",
  ctas: "Posts and Reels hold the comment keywords. A public reply is chosen from the lines you wrote. The private message is prepared from the commenter's profile and is not sent while DMs are off. Stories hand a keyword to one agent.",
  inbox: "Chats lists the leads stored for this business. The thread shows messages we have. A scheduled message stays in the queue. Live sync is off, so nothing is sent.",
  stats: "Stats counts leads, agents, tags, links, the funnel, follow-ups, and reply time for the range you pick. Explain with assistant asks about that chart. Empty means that event has not happened.",
  performance: "Performance groups leads by origin: story, post, reel, ad, or a keyword you name. The 12-month figure is a projection from numbers you type, not revenue already earned.",
  configuration: "Eight questions control when the AI answers, who it answers, when it stops, how it writes, how a lead is filed, who is notified, integrations, and cloning this business. A save stays in this panel.",
  team: "Team lists people on this business. An email invite carries Conversations, Configuration, or Analysis. Regenerating the link replaces the join code."
};


function groupStorage() {
  try {
    return localStorage;
  } catch (_error) {
    return null;
  }
}

export function mountNav(ui) {
  const slide = document.getElementById("slide-nav");
  const name = document.getElementById("panel-biz-name");
  if (!slide) return;
  const business = ui.state.businesses.find((row) => row.id === ui.state.businessId);
  if (name) name.textContent = business && business.agent_name ? business.agent_name : "This business";
  paintGlyph("logout-ico", "logout");
  const closed = new Set(readCollapsedGroups(groupStorage()));
  const language = ui.language ? ui.language() : "en";
  slide.replaceChildren();
  NAV_GROUPS.forEach((group) => {
    const shut = closed.has(group.id);
    const block = ui.el("div", { class: shut ? "nav-group is-collapsed" : "nav-group" });
    const items = ui.el("div", { class: "nav-group-items", id: "nav-group-" + group.id });
    const inner = ui.el("div", { class: "nav-group-inner" });
    group.items.forEach((item) => inner.append(navLink(ui, item)));
    items.append(inner);
    const head = ui.el("button", {
      type: "button",
      class: "nav-group-toggle",
      "aria-expanded": shut ? "false" : "true",
      "aria-controls": "nav-group-" + group.id
    });
    const chevron = ui.el("span", { class: "nav-chevron", "aria-hidden": "true" });
    chevron.append(glyph("chevron"));
    head.append(ui.el("span", { class: "nav-group-label", text: navLabel(group, language) }), chevron);
    head.addEventListener("click", () => {
      const next = block.classList.toggle("is-collapsed");
      head.setAttribute("aria-expanded", next ? "false" : "true");
      const ids = new Set(readCollapsedGroups(groupStorage()));
      if (next) ids.add(group.id);
      else ids.delete(group.id);
      persistCollapsedGroups(groupStorage(), ids);
      document.dispatchEvent(new Event("roleflow-nav"));
    });
    block.append(head, items);
    slide.append(block);
  });
  const current = ui.tabGroup(ui.state.tab);
  document.querySelectorAll("#slide-nav a, #acq-nav a").forEach((link) => {
    if (ui.tabGroup(link.dataset.tab) === current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.dispatchEvent(new Event("roleflow-nav"));
}

export function renderIntro(ui, tab) {
  const copy = {
    onboarding: ["Onboarding", "These questions build the setter. Saving them updates this business. The prompt preview is under the setter prompt page.", "onboarding", "clipboard"],
    prompts: ["Setter prompt", "Read the prompt the setter uses. Saving sends the change to the engine.", "onboarding", "clipboard"]
  }[tab];
  if (!copy) return null;
  return pageHeader(ui, copy[0], copy[1], copy[2], copy[3]);
}

export function renderDashboard(ui) {
  const wrap = ui.el("div", { class: "platform-home" });
  const step = ui.state.settings && ui.state.settings.onboarding_step;
  wrap.append(pageHeader(ui, "Dashboard", "Accounts, alerts, and whether this business is running.", "dashboard", "grid"));
  if (step && step !== "live") {
    const setup = ui.el("section", { class: "agent setup-call" });
    setup.append(ui.el("h3", { text: "Finish setup" }));
    setup.append(ui.el("p", { text: "Add the ICP, offer, Instagram connection, worker key, and voice notes. The CRM stays empty until a worker posts a profile or a setter syncs a lead." }));
    setup.append(ui.el("a", { class: "btn", href: "#onboarding" }, ["Continue setup"]));
    wrap.append(setup);
  }
  const grid = ui.el("div", { class: "home-grid" });
  const accounts = ui.el("section", { class: "home-card tone-accounts" });
  accounts.append(ui.el("h3", { text: "Accounts" }));
  accounts.append(ui.el("p", { class: "metric-value", text: ui.instagramLine() }));
  accounts.append(ui.el("p", { class: "metric-note", text: "WhatsApp is not connected." }));
  const manage = ui.button("Manage accounts", () => openAccounts(ui));
  accounts.append(manage);
  const alerts = ui.el("section", { class: "home-card tone-alerts" });
  alerts.append(ui.el("h3", { text: "Alerts" }));
  const sync = ui.businessSync ? ui.businessSync() : { label: "Setter ready" };
  const exceptions = ui.state.exceptions.length;
  alerts.append(ui.el("p", { class: "metric-value sm", text: exceptions ? exceptions + " open exceptions" : "No open exceptions" }));
  alerts.append(ui.el("p", { class: "metric-note", id: "home-sync", text: sync.label }));
  if (ui.setterPending()) alerts.append(ui.el("p", { text: "Setter link: Pending activation" }));
  const counts = ui.leadSnapshot();
  alerts.append(ui.el("p", { text: "Pipeline · Cold " + counts.cold + " · Warm " + counts.warm + " · Hot " + counts.hot + " · Converted " + counts.converted }));
  if (exceptions) {
    ui.state.exceptions.slice(0, 3).forEach((item) => alerts.append(ui.el("p", { text: item.message })));
  }
  alerts.append(ui.el("a", { class: "btn sm ghost", href: "#configuration" }, ["View alerts"]));
  grid.append(accounts, alerts);
  wrap.append(grid);
  const banner = ui.el("div", { class: "info-banner", role: "status" });
  const on = ui.state.settings && ui.state.settings.system_enabled;
  const cap = ui.state.settings && ui.state.settings.daily_cap;
  banner.append(ui.el("p", { text: (on ? "The system is on." : "The system is off.") + (cap ? " Daily cap " + cap + "." : " Daily cap not set.") + " " + sync.label }));
  wrap.append(banner);
  return wrap;
}

export function renderOutbound(ui) {
  const wrap = ui.el("div", { class: "platform-home" });
  wrap.append(pageHeader(ui, "Outbound Manager", "ICP Target Acquisition, warm-up, and personalised outreach for this business.", "outbound", "send"));
  wrap.append(renderOffice(ui, "outbound"));
  const queue = ui.el("section", { class: "agent" });
  queue.append(ui.el("h3", { text: "Drafted openers" }));
  const pending = (ui.state.outreach || []).filter((row) => row.decision === "pending" && row.opener);
  if (!pending.length) queue.append(ui.el("p", { text: "No drafted openers yet. They appear after a target is scored and the outreach agent writes one." }));
  pending.slice(0, 8).forEach((row) => {
    const target = (ui.state.targets || []).find((item) => item.id === row.target_id);
    queue.append(ui.el("p", { text: "@" + (target && target.handle ? target.handle : "profile") + " · " + row.opener }));
  });
  wrap.append(queue);
  return wrap;
}

export function renderInbound(ui) {
  const wrap = ui.el("div", { class: "platform-home" });
  wrap.append(pageHeader(ui, "Inbound Manager", "The Roleflow Setter Engine replies in Instagram DMs.", "inbound", "inbox"));
  wrap.append(renderOffice(ui, "inbound"));
  const caps = ui.el("section", { class: "agent" });
  caps.append(ui.el("h3", { text: "Setter status" }));
  const sync = ui.businessSync ? ui.businessSync() : { label: "Setter ready", tone: "wait" };
  caps.append(ui.el("p", { class: "metric-value sm", text: sync.label }));
  caps.append(ui.el("p", { class: "metric-note", text: ui.instagramLine() }));
  wrap.append(caps);
  return wrap;
}

export function renderStats(ui) {
  return opsStats(ui);
}

export function renderPerformance(ui) {
  return opsPerformance(ui);
}

export function renderTeam(ui) {
  return opsTeam(ui);
}

export function renderConfiguration(ui) {
  return opsConfig(ui);
}

const STRATEGY_TABS = [
  { tab: "sops", en: "SOPs", es: "SOPs" },
  { tab: "ctas", en: "CTAs", es: "CTAs" },
  { tab: "voice", en: "Voice Gen", es: "Voz" }
];

export function strategyTabs(ui) {
  const current = ui.state && ui.state.tab;
  if (!STRATEGY_TABS.some((item) => item.tab === current)) return null;
  const language = ui.language ? ui.language() : "en";
  const nav = ui.el("nav", { class: "section-tabs", "aria-label": language === "es" ? "Estrategia" : "Strategy" });
  STRATEGY_TABS.forEach((item) => {
    const link = ui.el("a", {
      href: "#" + item.tab,
      text: language === "es" ? item.es : item.en
    });
    if (item.tab === current) link.setAttribute("aria-current", "page");
    link.addEventListener("click", (event) => {
      if (!ui.go) return;
      event.preventDefault();
      ui.go(item.tab);
    });
    nav.append(link);
  });
  return nav;
}

export function pageHeader(ui, title, text, how, iconName) {
  const card = ui.el("section", { class: "page-card" });
  const copy = ui.el("div", { class: "page-copy" });
  copy.append(iconTile(iconName || "grid", "t1"), ui.el("div", {}, [ui.el("h2", { text: title }), ui.el("p", { text })]));
  const lang = ui.language ? ui.language() : "en";
  const button = ui.button(sectionText(lang, "howWorks"), () => openHow(title, HOW[how] || text));
  button.classList.add("ghost");
  const actions = ui.el("div", { class: "page-actions" });
  const quietSync = new Set(["dashboard", "warmer", "outreacher", "setter", "followup", "ctas"]);
  if (ui.businessSync && !(ui.state && quietSync.has(ui.state.tab))) {
    const sync = ui.businessSync();
    actions.append(ui.el("span", { id: "sync-state", class: "integration-status " + sync.tone, "data-sync": sync.key, text: sync.label }));
  }
  actions.append(button);
  card.append(copy, actions, ui.el("span", { class: "page-rule" }));
  const tabs = strategyTabs(ui);
  if (!tabs) return card;
  const stack = ui.el("div", { class: "page-stack" });
  stack.append(card, tabs);
  return stack;
}

function openHow(title, text) {
  const modal = document.getElementById("how-modal");
  document.getElementById("how-title").textContent = "How it works · " + title;
  document.getElementById("how-body").textContent = text;
  modal.hidden = false;
}

function openAccounts(ui) {
  const modal = document.getElementById("accounts-modal");
  const body = document.getElementById("accounts-body");
  body.replaceChildren();
  body.append(ui.el("p", { text: ui.instagramLine() }));
  body.append(ui.el("p", { text: "WhatsApp is not connected." }));
  const go = ui.el("a", { class: "btn", href: "#configuration/connect" }, ["Connect Instagram"]);
  go.addEventListener("click", () => {
    ui.state.configKey = "connect";
    modal.hidden = true;
  });
  body.append(go);
  modal.hidden = false;
}

function navLink(ui, item) {
  const label = typeof item.label === "string" ? item.label : navLabel(item, ui.language ? ui.language() : "en");
  const link = ui.el("a", { href: "#" + item.tab, "data-tab": item.tab, "data-tip": label, "data-tone": item.tone || "t1" });
  link.append(iconTile(item.icon, item.tone), ui.el("span", { class: "nav-label", text: label }));
  if (item.soon) {
    const language = ui.language ? ui.language() : "en";
    link.append(ui.el("span", { class: "soon-badge", text: language === "es" ? "Pronto" : "Soon" }));
  }
  link.addEventListener("click", (event) => {
    event.preventDefault();
    ui.go(item.tab);
  });
  return link;
}

function iconTile(name, tone) {
  const node = document.createElement("span");
  node.className = "nav-ico " + (tone || "t1");
  node.append(glyph(name));
  return node;
}

function paintGlyph(id, name) {
  const node = document.getElementById(id);
  if (!node || node.childElementCount) return;
  node.append(glyph(name));
}

function glyph(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  (ICONS[name] || ICONS.grid).forEach((d) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  });
  return svg;
}

function inRange(rows, days, field) {
  return (rows || []).filter((row) => within(row[field || "created_at"] || row.updated_at || row.added_on, days));
}

function within(value, days) {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  return time >= Date.now() - days * 86400000;
}

function chart(ui, rows, days) {
  const buckets = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const span = Math.min(days, 30);
  start.setDate(start.getDate() - (span - 1));
  for (let i = 0; i < span; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    buckets.push({ key: day.toISOString().slice(0, 10), count: 0 });
  }
  rows.forEach((row) => {
    const key = String(row.created_at || row.updated_at || "").slice(0, 10);
    const bucket = buckets.find((item) => item.key === key);
    if (bucket) bucket.count += 1;
  });
  const max = Math.max(0, ...buckets.map((item) => item.count));
  if (!max) return ui.el("p", { text: "No targets in this range yet." });
  const chartNode = ui.el("div", { class: "day-chart", role: "img", "aria-label": "Targets per day" });
  buckets.forEach((item) => {
    const bar = ui.el("i");
    bar.style.height = Math.max(4, Math.round((item.count / max) * 120)) + "px";
    bar.title = item.key + ": " + item.count;
    chartNode.append(bar);
  });
  return chartNode;
}

function sourceRow(ui, label, list) {
  const qualified = list.filter((row) => ["qualified", "booked", "showed", "closed"].includes(row.stage) || row.lead_status === "hot").length;
  const booked = list.filter((row) => ["booked", "showed", "closed"].includes(row.stage)).length;
  const converted = list.filter((row) => row.lead_status === "converted" || row.is_converted === true).length;
  return ui.el("tr", {}, [
    ui.el("td", { text: label }),
    ui.el("td", { text: String(list.length) }),
    ui.el("td", { text: String(qualified) }),
    ui.el("td", { text: String(booked) }),
    ui.el("td", { text: String(converted) })
  ]);
}

function sourceLabel(source) {
  const known = {
    competitor_followers: "Competitor followers",
    keyword: "Keyword",
    hashtag: "Hashtag",
    manual: "Manual",
    instagram: "Instagram",
    comment: "Comment"
  };
  return known[source] || "Other";
}
