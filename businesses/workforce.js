import { toast } from "../auth/ui.js";
import {
  activityDays,
  activityEvents,
  conversationWindow,
  finiteCount,
  funnelFromLeads,
  healthScore,
  warmQuietCount
} from "./console-model.js";

const ROLES = [
  {
    id: "outreach",
    name: "Outreach Agent",
    short: "Outreach",
    tone: "var(--gold)",
    text: "Sends targeted messages to new followers, reads Instagram continuously, and sends messages or voice notes in reply to comments."
  },
  {
    id: "follow_up",
    name: "Follow Up Agent",
    short: "Follow Up",
    tone: "var(--m)",
    text: "Follows up with leads who warmed up but stopped midway."
  },
  {
    id: "setting",
    name: "Setting Agent",
    short: "Setting",
    tone: "var(--o)",
    text: "Replies to every inbound message. This is the live setter for this business."
  }
];

const SUBS = [
  ["assets", "Assets"],
  ["leads", "Leads"],
  ["workflow", "Workflow"],
  ["stats", "Stats"]
];

const STATUSES = [
  ["active", "Active"],
  ["paused", "Paused"],
  ["not_set_up", "Not set up"]
];

const ANGLES = { outreach: -90, follow_up: 150, setting: 30 };

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

function svgEl(tag, attrs, children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value != null) node.setAttribute(key, String(value));
  });
  (children || []).forEach((child) => node.append(child));
  return node;
}

function scrub(message) {
  return String(message || "").replace(/tailortalk|zerochats/ig, "the setter service");
}

function missing(error) {
  return error && /schema cache|does not exist|PGRST205|PGRST204|column/i.test(error.message || "");
}

function shown(value) {
  const number = finiteCount(value);
  if (number == null && (value == null || value === "")) return "—";
  return number == null ? "—" : String(number);
}

function statusLabel(status) {
  return STATUSES.find(([id]) => id === status)?.[1] || "Not set up";
}

function defaultStatus(role, agent) {
  if (role !== "setting") return "not_set_up";
  return agent.status === "paused" ? "paused" : "active";
}

function metricRows(role, counts) {
  if (role === "outreach") return [["New-follower messages", null], ["Comment replies", null]];
  if (role === "follow_up") return [["Follow-ups recorded", counts.followups], ["Warm, quiet 3 days", counts.warm_quiet]];
  return [["Conversations", counts.conversations], ["Booked", counts.booked]];
}

function polar(cx, cy, radius, deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

function whenLabel(value) {
  if (!value) return "Time not in the sync";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time not in the sync";
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function syncWhen(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const hours = (Date.now() - date.getTime()) / 36e5;
  let relative = "just now";
  if (hours >= 48) relative = Math.round(hours / 24) + " days ago";
  else if (hours >= 24) relative = "1 day ago";
  else if (hours >= 2) relative = Math.round(hours) + " hours ago";
  else if (hours >= 1) relative = "1 hour ago";
  const absolute = date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return relative + " · " + absolute;
}

function robot() {
  return svgEl("svg", { viewBox: "0 0 48 48", "aria-hidden": "true" }, [
    svgEl("path", { d: "M24 6v6", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round" }),
    svgEl("circle", { cx: "24", cy: "5", r: "2.2", fill: "currentColor" }),
    svgEl("rect", { x: "10", y: "14", width: "28", height: "22", rx: "8", fill: "currentColor", opacity: "0.16" }),
    svgEl("rect", { x: "13", y: "17", width: "22", height: "16", rx: "5", fill: "none", stroke: "currentColor", "stroke-width": "2" }),
    svgEl("circle", { cx: "20", cy: "25", r: "1.8", fill: "currentColor" }),
    svgEl("circle", { cx: "28", cy: "25", r: "1.8", fill: "currentColor" }),
    svgEl("path", { d: "M20 30h8", fill: "none", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round" })
  ]);
}

function dot(status) {
  return el("i", { class: status === "active" ? "dot on live" : "dot", "aria-hidden": "true" });
}

export async function mountWorkforce(supabase, agent, host, canEdit, cachedStats) {
  host.innerHTML = "";
  const panel = el("section", { id: "workforce", class: "wf-console" });
  const rest = el("div", { class: "wf-rest" });
  const head = el("header", { class: "wf-head" }, [
    el("h2", { text: "Workforce" }),
    el("p", { text: "Operator console for this business. Numbers come from the lead sync. A dash means that figure is not in the sync." })
  ]);
  const grid = el("div", { class: "wf-grid", id: "wf-grid", "aria-busy": "true" }, [
    el("div", { class: "wf-card wf-metrics" }, [
      el("span", { class: "skel" }),
      el("span", { class: "skel short" }),
      el("span", { class: "skel" })
    ])
  ]);
  const note = el("p", { id: "workforce-note", class: "mute", role: "status" });
  const backdrop = el("div", { class: "wf-backdrop", hidden: true });
  const drawer = el("aside", {
    id: "agent-drawer",
    class: "wf-drawer",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "agent-drawer-title",
    hidden: true
  });
  rest.append(head, grid, note);
  panel.append(rest, backdrop, drawer);
  host.append(panel);

  const stored = new Map();
  const statusRes = await supabase.from("business_workforce").select("role, status").eq("agent_id", agent.id);
  if (statusRes.error && !missing(statusRes.error)) note.textContent = scrub(statusRes.error.message);
  (statusRes.data || []).forEach((row) => stored.set(row.role, row.status));

  let counts = { conversations: null, booked: null, followups: null, warm_quiet: null };
  let countsKnown = false;
  const countRes = await supabase.rpc("business_workforce_counts", { p_agent: agent.id });
  if (countRes.data && typeof countRes.data === "object" && !countRes.error) {
    counts = { ...counts, ...countRes.data };
    countsKnown = true;
  } else if (cachedStats) {
    counts.conversations = finiteCount(cachedStats.total_leads);
    counts.booked = finiteCount(cachedStats.converted_count);
  }

  const leadSelect = "agent_id, lead_name, stage, last_message_time, is_converted, joined_at, converted_at";
  let leadsRes = await supabase.from("client_ai_setter_leads").select(leadSelect).eq("agent_id", agent.id).limit(500);
  if (leadsRes.error && missing(leadsRes.error)) {
    leadsRes = await supabase.from("client_ai_setter_leads").select("agent_id, lead_name, stage, last_message_time, is_converted").eq("agent_id", agent.id).limit(500);
  }
  const leads = leadsRes.error ? null : (leadsRes.data || []);
  if (!countsKnown && Array.isArray(leads)) counts.warm_quiet = warmQuietCount(leads);

  const syncRes = await supabase.from("client_ai_setters").select("id, last_synced_at, last_sync_error").eq("id", agent.id).maybeSingle();
  const syncRow = !syncRes.error && syncRes.data ? syncRes.data : null;
  const syncKnown = Boolean(syncRow && ("last_synced_at" in syncRow || "last_sync_error" in syncRow));

  let assets = [];
  const assetRes = await supabase.from("business_assets").select("id, kind, title, when_to_use, available_to_agent").eq("agent_id", agent.id);
  if (!assetRes.error) assets = (assetRes.data || []).filter((row) => row.available_to_agent !== false);

  const series = cachedStats && cachedStats.leads_per_day;
  const windowed = conversationWindow(series);
  const strip = activityDays(series);
  const events = activityEvents(leads || []);
  const funnel = funnelFromLeads(leads, counts.booked);
  const currentStatus = (role) => stored.get(role.id) || defaultStatus(role.id, agent);
  let opener = null;
  let openId = null;

  backdrop.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", function onKey(event) {
    if (!panel.isConnected) {
      document.removeEventListener("keydown", onKey);
      return;
    }
    if (event.key === "Escape" && !drawer.hidden) {
      event.preventDefault();
      closeDrawer();
    }
  });

  paint();

  function paint() {
    const statuses = ROLES.map((role) => currentStatus(role));
    const health = healthScore({
      statuses,
      syncedAt: syncKnown ? syncRow.last_synced_at : null,
      syncErrorKnown: syncKnown,
      syncError: syncKnown ? syncRow.last_sync_error : ""
    });
    grid.innerHTML = "";
    grid.removeAttribute("aria-busy");
    grid.append(metrics(), brainCard(), healthCard(health), rosterCard(statuses), logCard(), funnelCard());
    if (openId) fillDrawer(ROLES.find((role) => role.id === openId));
  }

  function metrics() {
    const wrap = el("div", { class: "wf-metrics" });
    const active = ROLES.filter((role) => currentStatus(role) === "active").length;
    const cards = [
      ["Active agents", String(active), "of " + ROLES.length],
      ["Conversations", windowed.today == null ? "—" : String(windowed.today), windowed.week == null ? "This week —" : "This week " + windowed.week],
      ["Follow-ups due", shown(counts.warm_quiet), counts.warm_quiet == null ? "Not in the sync" : "Warm, quiet 3 days"],
      ["Calls booked", shown(counts.booked), counts.booked == null ? "Not in the sync" : "Converted in the sync"]
    ];
    cards.forEach(([label, value, sub]) => {
      wrap.append(el("article", { class: "wf-card wf-metric" }, [
        el("span", { text: label }),
        el("strong", { text: value }),
        el("small", { text: sub })
      ]));
    });
    return wrap;
  }

  function brainCard() {
    const card = el("article", { class: "wf-card wf-brain" });
    card.append(el("p", { class: "wf-kicker", text: "Setter graph" }));
    card.append(el("h3", { text: agent.agent_name || "AI Setter" }));
    const tip = el("p", { class: "wf-float", role: "tooltip", hidden: true });
    const full = brainSvg("full");
    const simple = brainSvg("simple");
    full.classList.add("brain-full");
    simple.classList.add("brain-simple");
    card.append(full, simple, tip);
    card.addEventListener("pointerover", (event) => showTip(event.target, tip, card));
    card.addEventListener("pointerout", (event) => {
      if (!event.relatedTarget || !event.relatedTarget.closest || !event.relatedTarget.closest(".wf-node")) tip.hidden = true;
    });
    card.addEventListener("focusin", (event) => showTip(event.target, tip, card));
    card.addEventListener("focusout", () => { tip.hidden = true; });
    card.addEventListener("click", (event) => {
      const node = event.target.closest && event.target.closest(".wf-node");
      if (!node || !node.dataset.role) return;
      openDrawer(node.dataset.role, node.dataset.focus || "", node);
    });
    card.addEventListener("keydown", (event) => {
      const node = event.target.closest && event.target.closest(".wf-node");
      if (!node || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      openDrawer(node.dataset.role, node.dataset.focus || "", node);
    });
    return card;
  }

  function showTip(target, tip, card) {
    const node = target.closest && target.closest(".wf-node");
    if (!node) return;
    tip.hidden = false;
    tip.textContent = node.dataset.tip || "";
    const hostBox = card.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    tip.style.left = (box.left - hostBox.left + box.width / 2) + "px";
    tip.style.top = (box.top - hostBox.top) + "px";
  }

  function brainSvg(mode) {
    const simple = mode === "simple";
    const cx = simple ? 180 : 340;
    const cy = simple ? 176 : 286;
    const orbit = simple ? 112 : 132;
    const picture = svgEl("svg", {
      viewBox: simple ? "0 0 360 360" : "0 0 680 580",
      class: "wf-svg",
      role: "img",
      "aria-label": "Setter at the centre, with Outreach, Follow Up, and Setting"
    });
    const accentId = "wf-accent-" + mode;
    const defs = svgEl("defs", {}, [
      svgEl("linearGradient", { id: accentId, x1: "0", y1: "0", x2: "1", y2: "1" }, [
        svgEl("stop", { offset: "0", "stop-color": "#E8B04A" }),
        svgEl("stop", { offset: "0.55", "stop-color": "#C0409A" }),
        svgEl("stop", { offset: "1", "stop-color": "#FF8A3D" })
      ])
    ]);
    picture.append(defs);
    const lines = svgEl("g", { class: "wf-links" });
    const nodes = svgEl("g", {});
    const center = polar(cx, cy, 0, 0);
    nodes.append(nodeGroup({
      cx, cy, hit: simple ? 46 : 52, ring: simple ? 40 : 46,
      label: "Setter",
      labelAt: { x: cx, y: cy + 4 },
      inside: true,
      tip: (agent.agent_name || "Setter") + ". The business setter. Choose an agent to open it.",
      tone: "var(--gold)"
    }));
    ROLES.forEach((role) => {
      const at = polar(cx, cy, orbit, ANGLES[role.id]);
      lines.append(link(center, at, accentId, false));
      const status = currentStatus(role);
      nodes.append(nodeGroup({
        cx: at.x, cy: at.y, hit: simple ? 36 : 30, ring: simple ? 30 : 26,
        label: role.short,
        labelAt: polar(cx, cy, orbit - (simple ? 52 : 48), ANGLES[role.id]),
        role: role.id,
        focus: "",
        tip: role.name + " · " + statusLabel(status) + ". " + role.text,
        tone: role.tone
      }));
      if (simple) return;
      SUBS.forEach(([focus, label], index) => {
        const deg = ANGLES[role.id] + [-51, -17, 17, 51][index];
        const sub = polar(at.x, at.y, 104, deg);
        lines.append(link(at, sub, accentId, true));
        nodes.append(nodeGroup({
          cx: sub.x, cy: sub.y, hit: 20, ring: 14,
          label,
          labelAt: polar(at.x, at.y, 128, deg),
          role: role.id,
          focus,
          tip: role.short + " · " + label + ". Opens this agent.",
          tone: "var(--mute)",
          small: true
        }));
      });
    });
    picture.append(lines, nodes);
    return picture;
  }

  function link(from, to, accentId, sub) {
    return svgEl("line", {
      x1: from.x.toFixed(1),
      y1: from.y.toFixed(1),
      x2: to.x.toFixed(1),
      y2: to.y.toFixed(1),
      class: sub ? "wf-link sub" : "wf-link",
      stroke: "url(#" + accentId + ")"
    });
  }

  function nodeGroup(spec) {
    const group = svgEl("g", {
      class: spec.role ? "wf-node" : "wf-node wf-hub",
      "data-tip": spec.tip
    });
    if (spec.role) {
      group.setAttribute("data-role", spec.role);
      group.setAttribute("data-focus", spec.focus || "");
      group.setAttribute("role", "button");
      group.setAttribute("tabindex", "0");
    }
    group.style.color = spec.tone;
    group.append(svgEl("circle", { cx: spec.cx, cy: spec.cy, r: spec.hit, class: "wf-hit" }));
    group.append(svgEl("circle", { cx: spec.cx, cy: spec.cy, r: spec.ring, class: spec.role ? "wf-ring" : "wf-hubring" }));
    const text = svgEl("text", {
      x: spec.inside ? spec.cx : spec.labelAt.x,
      y: spec.inside ? spec.cy + 5 : spec.labelAt.y,
      class: spec.small ? "wf-label small" : "wf-label",
      "text-anchor": "middle"
    });
    text.textContent = spec.label;
    group.append(text);
    return group;
  }

  function healthCard(health) {
    const card = el("article", { class: "wf-card wf-health" });
    const top = el("div", { class: "wf-health-top" });
    top.append(healthRing(health.score));
    const copy = el("div", {}, [
      el("p", { class: "wf-kicker", text: "Operator console" }),
      el("h3", { text: "Workforce health" })
    ]);
    const tipBtn = el("button", { type: "button", class: "btn ghost sm wf-tipbtn", "aria-expanded": "false", "aria-controls": "health-tip" }, ["How this is scored"]);
    const pop = el("div", { id: "health-tip", class: "wf-tippop", role: "tooltip", hidden: true });
    pop.append(el("p", { text: "Known signals are weighted and scaled to 100. A missing sync time or error state is left out. It is not treated as a failure." }));
    tipBtn.addEventListener("click", () => {
      const open = pop.hidden;
      pop.hidden = !open;
      tipBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    copy.append(tipBtn);
    top.append(copy);
    card.append(top, pop);
    const signals = el("ul", { class: "wf-signals" });
    health.parts.forEach((part) => signals.append(el("li", { text: part.label })));
    card.append(signals);
    const live = ROLES.filter((role) => currentStatus(role) === "active");
    card.append(el("p", { class: "wf-kicker", text: "Agents live" }));
    if (!live.length) card.append(el("p", { class: "mute", text: "No agents are live." }));
    else {
      const ul = el("ul", { class: "wf-live" });
      live.forEach((role) => ul.append(el("li", {}, [dot("active"), role.name])));
      card.append(ul);
    }
    const synced = syncKnown ? syncWhen(syncRow.last_synced_at) : null;
    card.append(el("p", { class: "wf-sync" }, [
      el("span", { class: "wf-kicker", text: "Last sync" }),
      document.createTextNode(synced || "—")
    ]));
    if (syncKnown && String(syncRow.last_sync_error || "").trim()) {
      card.append(el("p", { class: "err", text: scrub(syncRow.last_sync_error) }));
    }
    return card;
  }

  function healthRing(score) {
    const radius = 46;
    const circ = 2 * Math.PI * radius;
    const picture = svgEl("svg", { viewBox: "0 0 120 120", class: "wf-ring", "aria-hidden": "true" });
    picture.append(svgEl("defs", {}, [
      svgEl("linearGradient", { id: "wf-health", x1: "0", y1: "0", x2: "1", y2: "1" }, [
        svgEl("stop", { offset: "0", "stop-color": "#E8B04A" }),
        svgEl("stop", { offset: "1", "stop-color": "#C0409A" })
      ])
    ]));
    picture.append(svgEl("circle", { cx: "60", cy: "60", r: String(radius), class: "wf-track" }));
    if (score != null) {
      picture.append(svgEl("circle", {
        cx: "60", cy: "60", r: String(radius),
        class: "wf-arc",
        stroke: "url(#wf-health)",
        "stroke-dasharray": circ.toFixed(2),
        "stroke-dashoffset": (circ * (1 - score / 100)).toFixed(2)
      }));
    }
    const text = svgEl("text", { x: "60", y: "68", "text-anchor": "middle" });
    text.textContent = score == null ? "—" : String(score);
    picture.append(text);
    return picture;
  }

  function rosterCard() {
    const card = el("article", { class: "wf-card wf-roster" });
    card.append(el("p", { class: "wf-kicker", text: "Agent roster" }));
    card.append(el("h3", { text: "Three agents" }));
    ROLES.forEach((role) => {
      const status = currentStatus(role);
      const button = el("button", { type: "button", class: "wf-agent", "data-role": role.id, "data-status": status });
      const avatar = el("span", { class: "wf-avatar", style: "color:" + role.tone }, [robot()]);
      const copy = el("span", { class: "wf-agent-copy" }, [
        el("strong", { text: role.name }),
        el("span", { class: "wf-roleline" }, [dot(status), statusLabel(status) + " · " + role.short])
      ]);
      button.append(avatar, copy, stripFor(role));
      button.addEventListener("click", () => openDrawer(role.id, "", button));
      card.append(button);
    });
    return card;
  }

  function stripFor(role) {
    const mine = role.id === "setting";
    const days = mine ? strip : activityDays(null);
    const row = el("span", { class: "wf-strip", style: "color:" + role.tone });
    const filled = mine ? days.filter((day) => day.count > 0).length : 0;
    row.setAttribute("aria-label", mine
      ? (filled ? filled + " days with conversations in the last 30" : "No conversations recorded on the daily series")
      : "Daily activity for this agent is not in the sync");
    days.forEach((day) => {
      const level = !mine || day.count == null || day.count <= 0 ? "" : day.count >= 3 ? " fill high" : day.count === 2 ? " fill mid" : " fill";
      const mark = el("i", { class: "wf-day" + level });
      const countLabel = !mine || day.count == null ? "not in the sync" : String(day.count);
      mark.title = day.day + " · " + countLabel;
      row.append(mark);
    });
    return row;
  }

  function logCard() {
    const card = el("article", { class: "wf-card wf-log" });
    card.append(el("p", { class: "wf-kicker", text: "Activity" }));
    card.append(el("h3", { text: "Recent events" }));
    if (!events.length) {
      card.append(el("p", { class: "mute", text: leads ? "No recent events in the sync." : "Events show after leads load." }));
      return card;
    }
    const list = el("ul", { class: "wf-feed" });
    events.forEach((event) => {
      list.append(el("li", {}, [
        el("i", { class: "wf-mark " + event.kind, "aria-hidden": "true" }),
        el("span", {}, [
          el("strong", { text: event.name }),
          el("span", { class: "mute", text: event.label })
        ]),
        el("time", { text: event.at ? whenLabel(event.at) : "Time not in the sync" })
      ]));
    });
    card.append(list);
    return card;
  }

  function funnelCard() {
    const card = el("article", { class: "wf-card wf-funnel" });
    card.append(el("p", { class: "wf-kicker", text: "Funnel" }));
    card.append(el("h3", { text: "From first touch to booked" }));
    const stages = [
      ["First touch", funnel.first],
      ["Engaged", funnel.engaged],
      ["Qualified", funnel.qualified],
      ["Booked", funnel.booked]
    ];
    const numbers = stages.map(([, value]) => finiteCount(value)).filter((value) => value != null);
    if (!numbers.length && !Array.isArray(leads) && counts.booked == null) {
      card.append(el("p", { class: "mute", text: "The funnel appears after the next sync." }));
      return card;
    }
    const max = Math.max(1, ...numbers);
    const row = el("div", { class: "wf-funnel-row" });
    stages.forEach(([label, value]) => {
      const number = finiteCount(value);
      const bar = el("span", { class: "wf-bar" });
      if (number > 0) bar.style.width = Math.max(8, Math.round((number / max) * 100)) + "%";
      row.append(el("div", {}, [
        el("span", { class: "mute", text: label }),
        el("strong", { text: number == null ? "—" : String(number) }),
        el("span", { class: "wf-trackbar" }, [bar])
      ]));
    });
    card.append(row);
    card.append(el("p", { class: "mute wf-funnel-note", text: funnel.vocabulary
      ? "Booked uses converted leads. The other stages count only when a lead’s stage uses that name."
      : "Booked uses converted leads. First touch, Engaged, and Qualified stay blank until the sync uses those stage names." }));
    return card;
  }

  function openDrawer(roleId, focus, source) {
    const role = ROLES.find((item) => item.id === roleId);
    if (!role) return;
    opener = source || opener;
    openId = roleId;
    fillDrawer(role);
    backdrop.hidden = false;
    drawer.hidden = false;
    rest.inert = true;
    document.body.classList.add("wf-lock");
    const block = focus && drawer.querySelector('[data-block="' + focus + '"]');
    if (block) block.scrollIntoView({ block: "nearest" });
    const close = drawer.querySelector(".wf-close");
    if (close) close.focus();
  }

  function closeDrawer() {
    if (drawer.hidden) return;
    backdrop.hidden = true;
    drawer.hidden = true;
    rest.inert = false;
    document.body.classList.remove("wf-lock");
    openId = null;
    if (opener && opener.isConnected) opener.focus();
    opener = null;
  }

  function fillDrawer(role) {
    if (!role) return;
    const status = currentStatus(role);
    drawer.innerHTML = "";
    const headRow = el("div", { class: "wf-drawer-head" });
    const who = el("div", { class: "wf-drawer-who" }, [
      el("span", { class: "wf-avatar lg", style: "color:" + role.tone }, [robot()]),
      el("div", {}, [
        el("p", { class: "wf-kicker", text: role.short }),
        el("h3", { id: "agent-drawer-title", text: role.name })
      ])
    ]);
    const close = el("button", { type: "button", class: "btn ghost sm wf-close" }, ["Close"]);
    close.addEventListener("click", closeDrawer);
    headRow.append(who, close);
    drawer.append(headRow);
    drawer.append(el("p", { text: role.text }));
    drawer.append(el("p", { class: "wf-roleline" }, [dot(status), statusLabel(status)]));
    if (canEdit && !statusRes.error) {
      const group = el("div", { class: "status-toggle", role: "group", "aria-label": role.name + " status" });
      STATUSES.forEach(([id, title]) => {
        const button = el("button", {
          type: "button",
          class: "btn ghost sm",
          "aria-pressed": id === status ? "true" : "false"
        }, [title]);
        button.addEventListener("click", () => saveStatus(role, id, button));
        group.append(button);
      });
      drawer.append(group);
    } else if (statusRes.error && missing(statusRes.error)) {
      drawer.append(el("p", { class: "mute", text: "Status can be saved after the assets migration." }));
    }
    const statsBlock = el("section", { "data-block": "stats" }, [
      el("h3", { text: "Counts" })
    ]);
    const gridMetrics = el("dl", { class: "desk-metrics" });
    metricRows(role.id, counts).forEach(([label, value]) => {
      gridMetrics.append(el("div", {}, [el("dt", { text: label }), el("dd", { text: shown(value) })]));
    });
    statsBlock.append(gridMetrics);
    const leadsBlock = el("section", { "data-block": "leads" }, [
      el("h3", { text: "Leads" }),
      el("p", { class: "mute", text: "The lead list for this business is shared. This agent does not have its own lead table." }),
      el("a", { class: "btn ghost sm", href: "#" + agent.id + "/leads" }, ["Open leads"])
    ]);
    const flowBlock = el("section", { "data-block": "workflow" }, [
      el("h3", { text: "Workflow" }),
      el("p", { class: "mute", text: role.text }),
      el("a", { class: "btn ghost sm", href: "#" + agent.id + "/workflow" }, ["Open workflow"])
    ]);
    const assetBlock = el("section", { "data-block": "assets", id: "drawer-assets" }, [
      el("h3", { text: "Assets" }),
      el("p", { class: "mute", text: "Available to agent on this business. They are not split by role, and replies do not use them yet." })
    ]);
    if (!assets.length) assetBlock.append(el("p", { text: "No assets yet." }));
    else {
      const list = el("ul", { class: "wf-assets" });
      assets.forEach((item) => {
        const bits = [item.title || "Untitled", item.kind || ""];
        if (item.when_to_use) bits.push(item.when_to_use);
        list.append(el("li", { text: bits.filter(Boolean).join(" · ") }));
      });
      assetBlock.append(list);
    }
    assetBlock.append(el("a", { class: "btn ghost sm", href: "#" + agent.id + "/assets" }, ["Open assets"]));
    drawer.append(statsBlock, leadsBlock, flowBlock, assetBlock);
  }

  async function saveStatus(role, status, button) {
    note.textContent = "";
    note.className = "mute";
    button.disabled = true;
    const saved = await supabase.from("business_workforce").upsert({
      agent_id: agent.id,
      role: role.id,
      status,
      updated_at: new Date().toISOString()
    }, { onConflict: "agent_id,role" });
    button.disabled = false;
    if (saved.error) {
      const message = missing(saved.error) ? "Apply the assets migration, then refresh." : scrub(saved.error.message);
      note.className = "err";
      note.textContent = message;
      toast(message, "bad");
      return;
    }
    stored.set(role.id, status);
    const keep = opener;
    paint();
    openDrawer(role.id, "", keep);
    const pressed = drawer.querySelector("[aria-pressed=true]");
    if (pressed) pressed.focus();
    toast(role.name + " is " + statusLabel(status) + ".");
  }
}
