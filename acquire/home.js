import { renderOffice } from "./office.js";

const GROUPS = [
  { label: "Onboarding", items: [{ tab: "onboarding", label: "Setter questions", icon: "clipboard", tone: "t1" }] },
  { label: "Strategy", items: [
    { tab: "links", label: "Sales links", icon: "link", tone: "t2" },
    { tab: "content", label: "Value content", icon: "folder", tone: "t3" }
  ] },
  { label: "AI Workforce", items: [
    { tab: "outbound", label: "Outbound Manager", icon: "send", tone: "t4" },
    { tab: "inbound", label: "Inbound Manager", icon: "inbox", tone: "t5" },
    { tab: "pipeline", label: "CRM", icon: "users", tone: "t1" }
  ] },
  { label: "Analysis", items: [
    { tab: "stats", label: "Stats", icon: "chart", tone: "t2" },
    { tab: "performance", label: "Performance", icon: "trend", tone: "t3" }
  ] },
  { label: "Settings", items: [
    { tab: "configuration", label: "Configuration", icon: "settings", tone: "t4" },
    { tab: "team", label: "Team", icon: "userplus", tone: "t5" }
  ] }
];

const RAIL = [
  { tab: "dashboard", label: "Dashboard", icon: "grid", tone: "t1" },
  { tab: "onboarding", label: "Onboarding", icon: "clipboard", tone: "t2" },
  { tab: "links", label: "Strategy", icon: "link", tone: "t3" },
  { tab: "outbound", label: "Outbound", icon: "send", tone: "t4" },
  { tab: "inbound", label: "Inbound", icon: "inbox", tone: "t5" },
  { tab: "pipeline", label: "CRM", icon: "users", tone: "t1" },
  { tab: "stats", label: "Stats", icon: "chart", tone: "t2" },
  { tab: "configuration", label: "Settings", icon: "settings", tone: "t3" }
];

const ICONS = {
  grid: ["M3 3h7v7H3z", "M14 3h7v7h-7z", "M14 14h7v7h-7z", "M3 14h7v7H3z"],
  clipboard: ["M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2", "M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z", "M9 12h6", "M9 16h6"],
  link: ["M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71", "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"],
  folder: ["M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"],
  send: ["M14.5 21.5a.5.5 0 0 0 .94 0l6.5-19a.5.5 0 0 0-.64-.64l-19 6.5a.5.5 0 0 0 0 .94l7.9 3.16a2 2 0 0 1 1.12 1.11z", "M21.9 2.1 11 13"],
  inbox: ["M22 12h-6l-2 3H10l-2-3H2", "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"],
  users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  chart: ["M3 3v18h18", "M18 17V9", "M13 17V5", "M8 17v-3"],
  trend: ["M22 7 13.5 15.5l-5-5L2 17", "M16 7h6v6"],
  settings: ["M12.2 2h-.4a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  userplus: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M19 8v6", "M22 11h-6"],
  pin: ["M12 17v5", "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"]
};

const HOW = {
  dashboard: "This is the home for one business. Accounts shows whether Instagram is connected. Alerts lists pauses, pending sync, and exceptions. Nothing here is a sample number.",
  onboarding: "These questions describe the niche, offer, Instagram, worker, and voice notes. Saving them updates this business. Open the prompt preview when you want to read the setter prompt and send it to the engine.",
  links: "Sales links are the URLs the setter is allowed to send. The booking link is used when Calendar is not connected.",
  content: "Value content is what the setter can send mid-conversation. Voice notes are recordings you make. Each active recording fills one slot: opener, gap, follow-up, booking, or reminder.",
  outbound: "Outbound Manager runs ICP Target Acquisition, Engagement Warm-Up, and Personalised Outreach. The daily cap is 20 to 30 new targets. Pending openers are drafts waiting in the queue.",
  inbound: "Inbound Manager is the Roleflow Setter Engine: comment-to-DM, story DMs, qualification, follow-ups, and booking. Pending activation means the engine agent is not linked yet. Syncing means a change is waiting to be applied.",
  pipeline: "CRM is the pipeline for this business. Cold, warm, hot, converted, and dead come from the lead status on each contact.",
  stats: "Stats counts only rows in the date range you pick. Conversion rate is converted divided by targets in that range. Attributed growth is the sum of attributed deals. Roleflow's share is 10%.",
  performance: "Performance groups the same targets by source. Outbound is discovery. Inbound is Instagram and comments. A source with no rows is omitted.",
  configuration: "Each question on the left is a real setting: hours, who gets a reply, when a human takes over, how the setter writes, how a lead is classified, and which accounts are connected.",
  team: "Team lists people who can open this business. The invite link uses this workspace's join code. Someone with an account pastes that code to join as an editor."
};

const CONFIG = [
  { id: "reply", q: "When does the AI reply?" },
  { id: "who", q: "Who does it reply to?" },
  { id: "stop", q: "When does it stop replying?" },
  { id: "write", q: "How does it write?" },
  { id: "classify", q: "How is the lead classified?" },
  { id: "notify", q: "Who do we notify?" },
  { id: "connect", q: "What tools does it connect to?" },
  { id: "business", q: "Business and team" }
];

export function mountNav(ui) {
  const rail = document.getElementById("rail-nav");
  const slide = document.getElementById("slide-nav");
  const name = document.getElementById("panel-biz-name");
  if (!rail || !slide) return;
  const business = ui.state.businesses.find((row) => row.id === ui.state.businessId);
  if (name) name.textContent = business && business.agent_name ? business.agent_name : "This business";
  paintGlyph("pin-ico", "pin");
  paintGlyph("menu-pin-ico", "pin");
  paintGlyph("logout-ico", "logout");
  paintGlyph("panel-logout-ico", "logout");
  rail.replaceChildren();
  RAIL.forEach((item) => rail.append(navLink(ui, item, true)));
  slide.replaceChildren();
  const home = ui.el("a", { href: "#dashboard", "data-tab": "dashboard" }, [iconTile("grid", "t1"), "Dashboard"]);
  home.addEventListener("click", (event) => {
    event.preventDefault();
    ui.go("dashboard");
  });
  slide.append(home);
  GROUPS.forEach((group) => {
    const block = ui.el("div", { class: "nav-group" });
    block.append(ui.el("h2", { text: group.label }));
    group.items.forEach((item) => block.append(navLink(ui, item, false)));
    slide.append(block);
  });
  const current = ui.tabGroup(ui.state.tab);
  document.querySelectorAll("#rail-nav a, #slide-nav a, #acq-nav a").forEach((link) => {
    if (ui.tabGroup(link.dataset.tab) === current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

export function renderIntro(ui, tab) {
  const copy = {
    onboarding: ["Onboarding", "These questions build the setter. Saving them updates this business. The prompt preview is under the setter prompt page.", "onboarding", "clipboard"],
    pipeline: ["CRM", "Cold, warm, hot, converted, and dead for this business.", "pipeline", "users"],
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
  const pending = (ui.state.outbox || []).filter((row) => row.status === "pending").length;
  const exceptions = ui.state.exceptions.length;
  alerts.append(ui.el("p", { class: "metric-value sm", text: exceptions ? exceptions + " open exceptions" : "No open exceptions" }));
  alerts.append(ui.el("p", { class: "metric-note", text: pending === 1 ? "1 change syncing" : pending ? pending + " changes syncing" : "No changes waiting to sync" }));
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
  banner.append(ui.el("p", { text: (on ? "The system is on." : "The system is off.") + (cap ? " Daily cap " + cap + "." : " Daily cap not set.") + (pending ? " Syncing…" : "") }));
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
  caps.append(ui.el("p", { class: "metric-value sm", text: ui.setterLinkText() }));
  caps.append(ui.el("p", { class: "metric-note", text: ui.instagramLine() }));
  if ((ui.state.outbox || []).some((row) => row.status === "pending")) caps.append(ui.el("p", { text: "Syncing…" }));
  wrap.append(caps);
  return wrap;
}

export function renderStats(ui) {
  const wrap = ui.el("div", { class: "platform-home" });
  wrap.append(pageHeader(ui, "Stats", "Counts for the range you pick. Empty means that event has not happened.", "stats", "chart"));
  const filters = ui.el("div", { class: "filters", role: "toolbar", "aria-label": "Date range" });
  [7, 30, 90].forEach((days) => {
    const chip = ui.el("button", { type: "button", "aria-pressed": ui.state.rangeDays === days ? "true" : "false" }, ["Last " + days + " days"]);
    chip.addEventListener("click", () => {
      ui.state.rangeDays = days;
      ui.paint();
    });
    filters.append(chip);
  });
  wrap.append(filters);
  const rows = inRange(ui.state.targets, ui.state.rangeDays);
  const contacts = inRange(ui.state.contacts, ui.state.rangeDays, "last_message_at");
  const bookings = inRange(ui.state.bookings, ui.state.rangeDays, "created_at");
  const deals = inRange(ui.state.deals, ui.state.rangeDays, "closed_on");
  const qualified = rows.filter((row) => ["qualified", "booked", "showed", "closed"].includes(row.stage) || row.lead_status === "hot").length;
  const converted = rows.filter((row) => row.lead_status === "converted" || row.is_converted === true).length;
  const conversations = contacts.length || ui.state.threads.filter((row) => within(row.updated_at, ui.state.rangeDays)).length;
  const revenue = ui.attributedCents(deals);
  const share = ui.shareCents(revenue, ui.state.settings && ui.state.settings.share_bps);
  const rate = rows.length ? converted / rows.length : null;
  const kpis = ui.el("div", { class: "kpis" });
  [
    ["Targets", String(rows.length), rows.length ? "In this range" : "No targets in this range"],
    ["Conversations", String(conversations), conversations ? "Contacts or threads in range" : "No conversations in this range"],
    ["Qualified", String(qualified), qualified ? "Hot or qualified stages" : "No qualified leads in this range"],
    ["Booked", String(bookings.length), bookings.length ? "Booked calls" : "No calls booked yet"],
    ["Converted", String(converted), converted ? "Converted leads" : "No converted leads in this range"],
    ["Conversion rate", rate == null ? "—" : ui.percent(rate), rows.length ? "Converted / targets" : "Needs targets first"],
    ["Attributed growth", ui.money(revenue), revenue ? "Deals marked attributed" : "No attributed revenue yet"],
    ["Roleflow share", ui.money(share), "10% of attributed growth"]
  ].forEach(([label, value, note]) => {
    const card = ui.el("article", { class: "kpi" });
    card.append(ui.el("span", { text: label }), ui.el("strong", { text: value }), ui.el("em", { text: note }));
    kpis.append(card);
  });
  wrap.append(kpis);
  wrap.append(ui.el("h2", { class: "section-title", text: "Daily targets" }));
  wrap.append(chart(ui, rows, ui.state.rangeDays));
  if (ui.state.canEdit) {
    const actions = ui.el("div", { class: "filters" });
    actions.append(ui.button("Run daily summary", ui.runChief));
    wrap.append(actions);
  }
  return wrap;
}

export function renderPerformance(ui) {
  const wrap = ui.el("div", { class: "platform-home" });
  wrap.append(pageHeader(ui, "Performance", "Where leads came from in the selected range.", "performance", "trend"));
  const rows = inRange(ui.state.targets, ui.state.rangeDays);
  const outboundSources = new Set(["competitor_followers", "keyword", "hashtag", "manual"]);
  const inboundSources = new Set(["instagram", "comment"]);
  const outbound = rows.filter((row) => outboundSources.has(row.source));
  const inbound = rows.filter((row) => inboundSources.has(row.source));
  const table = ui.el("table", { class: "leads" });
  const head = ui.el("tr");
  ["Source", "Targets", "Qualified", "Booked", "Converted"].forEach((label) => head.append(ui.el("th", { text: label })));
  table.append(ui.el("thead", {}, [head]));
  const body = ui.el("tbody");
  [
    ["Outbound", outbound],
    ["Inbound", inbound]
  ].forEach(([label, list]) => body.append(sourceRow(ui, label, list)));
  const bySource = new Map();
  rows.forEach((row) => {
    const key = sourceLabel(row.source);
    bySource.set(key, (bySource.get(key) || []).concat(row));
  });
  const ranked = [...bySource.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10);
  ranked.forEach(([label, list]) => body.append(sourceRow(ui, label, list)));
  if (!rows.length) {
    body.append(ui.el("tr", {}, [ui.el("td", { colspan: "5", text: "No targets in this range yet." })]));
  }
  table.append(body);
  wrap.append(ui.el("div", { class: "table-wrap" }, [table]));
  return wrap;
}

export function renderLinks(ui) {
  const wrap = ui.el("div", { class: "platform-home" });
  wrap.append(pageHeader(ui, "Sales links", "Links the setter can send in a conversation.", "links", "link"));
  const settings = ui.state.settings || {};
  const form = ui.el("form", { class: "agent" });
  const booking = ui.field("Booking link", settings.booking_fallback_url || "https://calendar.app.google/8i1gomkozavqYU5b8");
  form.append(ui.el("p", { text: "Sent when Google Calendar is not connected." }));
  form.append(booking.label);
  if (ui.state.canEdit) {
    form.append(ui.button("Save link", async (event) => {
      event.preventDefault();
      await ui.patchSettings(
        { booking_fallback_url: booking.input.value.trim() || "https://calendar.app.google/8i1gomkozavqYU5b8" },
        { booking_link: booking.input.value.trim() || "https://calendar.app.google/8i1gomkozavqYU5b8" }
      );
    }));
  }
  form.addEventListener("submit", (event) => event.preventDefault());
  wrap.append(form);
  const checkout = ui.el("section", { class: "agent" });
  checkout.append(ui.el("h3", { text: "Checkout link" }));
  checkout.append(ui.el("p", { text: "No checkout link is stored for this business yet." }));
  wrap.append(checkout);
  return wrap;
}

export function renderContent(ui) {
  const wrap = ui.el("div", { class: "platform-home" });
  wrap.append(pageHeader(ui, "Value content", "Recordings and files the setter can send.", "content", "folder"));
  const files = ui.el("section", { class: "agent" });
  files.append(ui.el("h3", { text: "Files and video" }));
  files.append(ui.el("p", { text: "No video or file library is stored for this business yet. Voice notes below are the recordings the setter can send." }));
  wrap.append(files);
  wrap.append(ui.voiceLibrary());
  return wrap;
}

export function renderTeam(ui) {
  const wrap = ui.el("div", { class: "platform-home" });
  wrap.append(pageHeader(ui, "Team", "Who can open this business, and the link that adds an editor.", "team", "userplus"));
  const business = ui.state.businesses.find((row) => row.id === ui.state.businessId);
  const code = business && business.join_code;
  const card = ui.el("section", { class: "agent" });
  card.append(ui.el("h3", { text: "Invite link" }));
  if (!code) card.append(ui.el("p", { text: "This business has no join code yet." }));
  else {
    const link = location.origin + "/signup/?join=" + encodeURIComponent(code);
    card.append(ui.el("p", { text: link }));
    card.append(ui.el("p", { class: "mute", text: "Share this link. They create an account, then paste the code to join as an editor. Email invites are not sent from this panel." }));
    card.append(ui.el("p", { text: "Join code: " + code }));
  }
  wrap.append(card);
  const list = ui.el("section", { class: "agent" });
  list.append(ui.el("h3", { text: "Shared with" }));
  const rows = ui.state.memberRows || [];
  if (!rows.length) list.append(ui.el("p", { text: "No members on file yet. The owner is the signed-in account that created the business." }));
  rows.forEach((row) => {
    const profile = (ui.state.memberProfiles || []).find((item) => item.id === row.user_id);
    const who = profile && (profile.email || profile.full_name) ? (profile.email || profile.full_name) : "Member";
    const role = row.role === "owner" ? "Owner" : row.role === "editor" ? "Editor" : "Viewer";
    const status = row.status === "active" ? "Active" : "Invited";
    list.append(ui.el("p", { text: who + " · " + role + " · " + status }));
  });
  list.append(ui.el("p", { class: "mute", text: "Owner can edit. Editor can edit. Viewer can read. The join link grants editor." }));
  wrap.append(list);
  return wrap;
}

export function renderConfiguration(ui) {
  const wrap = ui.el("div", { class: "platform-home" });
  wrap.append(pageHeader(ui, "Configuration", "The questions that control this setter.", "configuration", "settings"));
  const layout = ui.el("div", { class: "config-layout" });
  const list = ui.el("div", { class: "config-list" });
  const search = ui.el("input", { type: "search", placeholder: "Search settings", "aria-label": "Search settings" });
  list.append(search);
  const questions = ui.el("div");
  list.append(questions);
  const panel = ui.el("div", { id: "config-panel" });
  layout.append(list, panel);
  wrap.append(layout);
  const draw = () => {
    const query = search.value.trim().toLowerCase();
    questions.replaceChildren();
    CONFIG.filter((item) => !query || item.q.toLowerCase().includes(query)).forEach((item) => {
      const button = ui.el("button", { type: "button", "aria-pressed": ui.state.configKey === item.id ? "true" : "false" }, [item.q]);
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
  const settings = ui.state.settings || {};
  if (key === "connect") {
    const host = ui.el("div");
    ui.renderEngine("integrations", host);
    const billing = ui.el("div");
    ui.renderEngine("billing", billing);
    const wrap = ui.el("div");
    wrap.append(host, billing);
    return wrap;
  }
  if (key === "notify") {
    const card = ui.el("section", { class: "agent" });
    card.append(ui.el("h3", { text: "Who do we notify?" }));
    card.append(ui.el("p", { text: "Closer email notifications are not stored for this business yet." }));
    return card;
  }
  if (key === "business") {
    const card = ui.el("section", { class: "agent" });
    card.append(ui.el("h3", { text: "Business and team" }));
    card.append(ui.el("p", { text: (settings.niche ? "Niche: " + settings.niche : "Niche is not set yet.") }));
    card.append(ui.el("p", { text: settings.offer_summary ? settings.offer_summary : "No offer summary yet." }));
    card.append(ui.el("a", { class: "btn sm", href: "#onboarding" }, ["Edit onboarding"]));
    card.append(ui.el("a", { class: "btn sm ghost", href: "#team" }, ["Open team"]));
    return card;
  }
  if (key === "who") {
    const card = ui.el("form", { class: "agent" });
    card.append(ui.el("h3", { text: "Who does it reply to?" }));
    const comment = ui.roleParams("comment_to_dm");
    const keywords = ui.field("Comment trigger keywords", comment.trigger_keywords || "");
    const message = ui.field("Comment-to-DM message", comment.trigger_message || "");
    card.append(keywords.label, message.label);
    card.append(ui.el("h3", { text: "Ignored users" }));
    if (!(ui.state.dnc || []).length) card.append(ui.el("p", { text: "No ignored handles yet." }));
    (ui.state.dnc || []).forEach((row) => card.append(ui.el("p", { text: "@" + row.handle + (row.reason ? " · " + row.reason : "") })));
    const handle = ui.field("Ignore this handle", "");
    card.append(handle.label);
    if (ui.state.canEdit) {
      card.append(ui.button("Save", async (event) => {
        event.preventDefault();
        await ui.mergeParams("comment_to_dm", {
          trigger_keywords: keywords.input.value.trim(),
          trigger_message: message.input.value.trim()
        });
        const next = handle.input.value.trim().replace(/^@/, "").toLowerCase();
        if (next) {
          const saved = await ui.state.supabase.from("acq_dnc").insert({ business_id: ui.state.businessId, handle: next, reason: "Ignored in configuration" });
          if (saved.error) ui.toast(saved.error.message, "bad");
        }
        if (ui.usesEngine()) {
          try {
            await ui.enqueueEngine("update_settings", {
              trigger_keywords: keywords.input.value.trim(),
              trigger_message: message.input.value.trim()
            });
            ui.toast("Syncing…");
          } catch (error) {
            ui.toast(error.message, "bad");
          }
        } else ui.toast("Saved.");
        await ui.bootBusiness(ui.state.businessId);
      }));
    }
    card.addEventListener("submit", (event) => event.preventDefault());
    return card;
  }
  if (key === "stop") {
    const card = ui.el("form", { class: "agent" });
    card.append(ui.el("h3", { text: "When does it stop replying?" }));
    card.append(ui.el("p", { text: "A thread locked for a person is not answered by the setter. Follow-ups stop after the count below. An Instagram warning pauses the outreach worker and leaves official DMs running." }));
    const hours = ui.field("Hours between recovery follow-ups", settings.followup_hours || 6, "number");
    const count = ui.field("Recovery follow-ups inside 24h", settings.followup_count || 3, "number");
    card.append(hours.label, count.label);
    const locked = (ui.state.threads || []).filter((row) => row.human_locked).length;
    card.append(ui.el("p", { text: locked ? locked + " threads are locked for a person." : "No threads are locked for a person." }));
    if (settings.ig_paused) card.append(ui.el("p", { text: "The outreach worker is paused (" + (settings.ig_pause_reason || "warning") + ")." }));
    if (ui.state.canEdit) card.append(ui.button("Save", (event) => {
      event.preventDefault();
      ui.patchSettings({
        followup_hours: Math.min(23, Math.max(1, Number(hours.input.value) || 6)),
        followup_count: Math.min(5, Math.max(1, Number(count.input.value) || 3))
      }, {
        followup_hours: Math.min(23, Math.max(1, Number(hours.input.value) || 6)),
        followup_count: Math.min(5, Math.max(1, Number(count.input.value) || 3))
      });
    }));
    card.addEventListener("submit", (event) => event.preventDefault());
    return card;
  }
  if (key === "write") {
    const card = ui.el("section", { class: "agent" });
    card.append(ui.el("h3", { text: "How does it write?" }));
    card.append(ui.el("p", { text: "AI disclosure, when someone asks if they are talking to a bot: Diego's team uses an AI assistant to keep up with conversations. Diego personally reviews them and takes the calls." }));
    card.append(ui.el("p", { text: settings.knowledge_base ? settings.knowledge_base : "No extra writing notes are saved yet. Add them in onboarding." }));
    card.append(ui.el("a", { class: "btn sm", href: "#prompts" }, ["Preview setter prompt"]));
    return card;
  }
  if (key === "classify") {
    const card = ui.el("form", { class: "agent" });
    card.append(ui.el("h3", { text: "How is the lead classified?" }));
    const qual = ui.roleParams("qualification");
    const budget = ui.field("Budget rule", qual.budget_rule || "");
    const timeline = ui.field("Timeline rule", qual.timeline_rule || "");
    const maker = ui.field("Decision-maker rule", qual.decision_maker_rule || "");
    const fit = ui.field("Fit rule", qual.fit_rule || "");
    const statuses = ui.field("Lead statuses", qual.lead_statuses || "cold, warm, hot, converted, dead");
    card.append(budget.label, timeline.label, maker.label, fit.label, statuses.label);
    card.append(ui.el("p", { class: "mute", text: "Statuses in the CRM are cold, warm, hot, converted, and dead." }));
    if (ui.state.canEdit) card.append(ui.button("Save", async (event) => {
      event.preventDefault();
      await ui.mergeParams("qualification", {
        budget_rule: budget.input.value.trim(),
        timeline_rule: timeline.input.value.trim(),
        decision_maker_rule: maker.input.value.trim(),
        fit_rule: fit.input.value.trim(),
        lead_statuses: statuses.input.value.trim() || "cold, warm, hot, converted, dead"
      });
      if (ui.usesEngine()) {
        try {
          await ui.enqueueEngine("update_settings", {
            budget_rule: budget.input.value.trim(),
            timeline_rule: timeline.input.value.trim(),
            decision_maker_rule: maker.input.value.trim(),
            fit_rule: fit.input.value.trim(),
            lead_statuses: statuses.input.value.trim()
          });
          ui.toast("Syncing…");
        } catch (error) {
          ui.toast(error.message, "bad");
        }
      } else ui.toast("Saved.");
      await ui.bootBusiness(ui.state.businessId);
    }));
    card.addEventListener("submit", (event) => event.preventDefault());
    return card;
  }
  const card = ui.el("form", { class: "agent" });
  card.append(ui.el("h3", { text: "When does the AI reply?" }));
  const enabled = ui.el("label", { class: "switch", text: " System on" });
  const enabledInput = ui.el("input", { type: "checkbox" });
  enabledInput.checked = settings.system_enabled === true;
  enabledInput.disabled = !ui.state.canEdit;
  enabled.prepend(enabledInput);
  const tz = ui.field("Timezone", settings.timezone || "Europe/Madrid");
  const start = ui.field("Quiet hours start", ui.shortTime(settings.quiet_start, "22:00"), "time");
  const end = ui.field("Quiet hours end", ui.shortTime(settings.quiet_end, "08:00"), "time");
  const delay = ui.field("Reply delay seconds (0–300)", settings.reply_delay_seconds == null ? 60 : settings.reply_delay_seconds, "number");
  const cap = ui.field("Daily cap (20–30)", settings.daily_cap || 30, "number");
  card.append(enabled, tz.label, start.label, end.label, delay.label, cap.label);
  card.append(ui.el("p", { class: "mute", text: "Quiet hours are when new outreach waits. The daily cap limits new targets." }));
  if (ui.state.canEdit) card.append(ui.button("Save", (event) => {
    event.preventDefault();
    const nextCap = Number(cap.input.value);
    if (nextCap < 20 || nextCap > 30) {
      ui.toast("Daily cap stays between 20 and 30.", "bad");
      return;
    }
    ui.patchSettings({
      system_enabled: enabledInput.checked,
      timezone: tz.input.value.trim() || "Europe/Madrid",
      quiet_start: start.input.value || "22:00",
      quiet_end: end.input.value || "08:00",
      reply_delay_seconds: Math.min(300, Math.max(0, Number(delay.input.value) || 0)),
      daily_cap: nextCap
    }, {
      timezone: tz.input.value.trim() || "Europe/Madrid",
      reply_delay_seconds: Math.min(300, Math.max(0, Number(delay.input.value) || 0))
    });
  }));
  card.addEventListener("submit", (event) => event.preventDefault());
  return card;
}

function pageHeader(ui, title, text, how, iconName) {
  const card = ui.el("section", { class: "page-card" });
  const copy = ui.el("div", { class: "page-copy" });
  copy.append(iconTile(iconName || "grid", "t1"), ui.el("div", {}, [ui.el("h2", { text: title }), ui.el("p", { text })]));
  const button = ui.button("How it works", () => openHow(title, HOW[how] || text));
  button.classList.add("ghost");
  card.append(copy, button, ui.el("span", { class: "page-rule" }));
  return card;
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
  const go = ui.el("a", { class: "btn", href: "#configuration" }, ["Connect Instagram"]);
  go.addEventListener("click", () => {
    ui.state.configKey = "connect";
    modal.hidden = true;
  });
  body.append(go);
  modal.hidden = false;
}

function navLink(ui, item, rail) {
  const link = ui.el("a", { href: "#" + item.tab, "data-tab": item.tab });
  const tile = iconTile(item.icon, item.tone);
  if (rail) {
    link.dataset.tip = item.label;
    link.title = item.label;
    const scale = document.createElement("span");
    scale.className = "dock-scale";
    scale.append(tile);
    link.append(scale);
  } else {
    link.append(tile, document.createTextNode(item.label));
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
