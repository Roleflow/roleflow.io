import { openAddBusiness } from "../acquire/add-business.js";
import { scrubChannelCopy } from "../acquire/connect-instagram.js";
import { addBusinessCard, businessCard } from "../businesses/biz-board.js";
import { createdPhrase } from "../businesses/model.js";

const ICP = "icp_acquisition";
const WARMUP = "engagement_warmup";
const OUTREACH = "personalised_outreach";
const SETTER_ROLES = ["comment_to_dm", "qualification", "conversation_recovery", "appointment_booking"];
const ROLE_SET = new Set([ICP, WARMUP, OUTREACH, ...SETTER_ROLES]);

export async function renderAcquisitionRoster(supabase, app) {
  app.replaceChildren();
  app.append(el("div", { class: "state", role: "status" }, [
    el("span", { class: "skel" }),
    el("p", {}, ["Loading businesses…"])
  ]));
  const listed = await supabase.from("acq_workspaces").select("id, name, owner_id, created_at").order("name", { ascending: true });
  if (listed.error) {
    showProblem(app, "Could not load businesses", listed.error.message);
    return;
  }
  const businesses = listed.data || [];
  if (!businesses.length) {
    showProblem(app, "No businesses yet", "A workspace appears here after someone signs up. Nothing is provisioned until then.");
    return;
  }
  const ids = businesses.map((row) => row.id);
  const ownerIds = [...new Set(businesses.map((row) => row.owner_id).filter(Boolean))];
  const [profiles, settings, workforce, links, ig, workers, targets, requests] = await Promise.all([
    ownerIds.length
      ? supabase.from("profiles").select("id, email, full_name").in("id", ownerIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("acq_settings").select("agent_id, setter_provider, daily_cap, system_enabled, onboarding_step, timezone").in("agent_id", ids),
    supabase.from("business_workforce").select("agent_id, role, status, daily_count, daily_count_on, last_run_at").in("agent_id", ids).in("role", [...ROLE_SET]).limit(2000),
    supabase.from("acq_setter_links").select("business_id, status, requested_handle, provider, last_synced_at, webhook_seen_at, external_agent_id, last_sync_error").in("business_id", ids),
    supabase.from("ig_connections").select("business_id, username, status, connected_at").in("business_id", ids),
    supabase.from("acq_workers").select("business_id, status, enabled, last_heartbeat_at").in("business_id", ids),
    supabase.from("acq_targets").select("agent_id, created_at").gte("created_at", new Date(Date.now() - 6 * 86400000).toISOString()).limit(2000),
    supabase.from("acq_channel_connect_requests").select("id, workspace_id, username, status, notes, created_at").in("status", ["pending", "in_progress"]).order("created_at", { ascending: true })
  ]);
  const failed = [profiles, settings, workforce, links, ig, workers].find((res) => res.error);
  if (failed) {
    showProblem(app, "Could not read agent status", failed.error.message);
    return;
  }
  const profileById = new Map((profiles.data || []).map((row) => [row.id, row]));
  const settingsById = new Map((settings.data || []).map((row) => [row.agent_id, row]));
  const workforceById = group(workforce.data || [], "agent_id");
  const linkById = new Map((links.data || []).map((row) => [row.business_id, row]));
  const igById = new Map((ig.data || []).map((row) => [row.business_id, row]));
  const workersById = group(workers.data || [], "business_id");
  const targetsById = group(targets.error ? [] : targets.data || [], "agent_id");
  const waiting = requests.error ? [] : requests.data || [];
  const shared = new Set();
  const members = await supabase.from("business_members").select("agent_id, status").in("agent_id", ids).eq("status", "active");
  if (!members.error) (members.data || []).forEach((row) => shared.add(row.agent_id));
  const shell = el("div");
  const queue = connectQueue(waiting, businesses, (row, status, buttons) => resolveConnectRequest(supabase, app, row, status, buttons), rosterLang());
  if (queue) shell.append(queue);
  if (requests.error && !/schema cache|does not exist|PGRST205/i.test(requests.error.message || "")) {
    shell.append(el("p", { class: "roster-note", text: "Connect requests could not be read." }));
  }
  if (waiting.length && !window.__rfConnectQueueNoted) {
    window.__rfConnectQueueNoted = true;
    window.dispatchEvent(new CustomEvent("roleflow-notice", {
      detail: { text: waiting.length === 1 ? "An Instagram connection is waiting." : waiting.length + " Instagram connections are waiting." }
    }));
  }
  const lang = rosterLang();
  const title = document.getElementById("admin-title");
  if (title) title.textContent = lang === "es" ? "Tus negocios" : "Your businesses";
  const root = el("div", { class: "biz-grid", id: "admin-roster" });
  if (targets.error) {
    root.append(el("p", { class: "roster-note", text: "Lead history could not be read." }));
  }
  businesses.forEach((business) => {
    root.append(gridCard(business, {
      profile: profileById.get(business.owner_id),
      settings: settingsById.get(business.id) || null,
      roles: workforceById.get(business.id) || [],
      link: linkById.get(business.id) || null,
      ig: igById.get(business.id) || null,
      workers: workersById.get(business.id) || [],
      leads: targets.error ? null : (targetsById.get(business.id) || []),
      shared: shared.has(business.id)
    }, lang));
  });
  root.append(addBusinessCard({ id: "add-business", text: lang === "es" ? "Añadir negocio" : "Add business", onClick: () => openAddBusiness({ supabase, preview: false }) }));
  shell.append(root);
  app.replaceChildren(shell);
}

export function renderAddPreview(app) {
  const root = el("div", { class: "biz-grid", id: "admin-roster" });
  const sample = el("section", { class: "biz-tile" });
  sample.append(el("h2", { text: "Roleflow" }));
  sample.append(el("p", { text: "Live" }));
  root.append(sample);
  root.append(addBusinessCard({ text: "Add business", onClick: () => openAddBusiness({ supabase: null, preview: true }) }));
  app.replaceChildren(root);
}

export function renderRosterPreview(app) {
  const params = new URLSearchParams(location.search);
  const title = document.getElementById("admin-title");
  if (title) title.textContent = params.get("lang") === "es" ? "Tus negocios" : "Your businesses";
  const now = Date.now();
  const businesses = [
    { id: "w1", name: "Chad Owens", created_at: new Date(now - 86400000 * 90).toISOString() },
    { id: "w2", name: "Thomas Miller", created_at: new Date(now - 86400000 * 120).toISOString() },
    { id: "w3", name: "Value Add Marketing", created_at: new Date(now - 86400000 * 120).toISOString() },
    { id: "w4", name: "Shadow Boys", created_at: new Date(now - 86400000 * 60).toISOString() }
  ];
  const leads = new Map([
    ["w1", previewLeadRows(10)],
    ["w2", []],
    ["w3", []],
    ["w4", []]
  ]);
  const waiting = params.get("connect") === "1" ? [
    { id: "preview-a", workspace_id: "w1", username: "vam.coach", status: "pending", notes: "Business account" }
  ] : [];
  const lang = params.get("lang") === "es" ? "es" : "en";
  const shell = el("div");
  const queue = connectQueue(waiting, businesses, (row, status) => {
    row.status = status;
    renderRosterPreview(app);
  }, lang);
  if (queue) shell.append(queue);
  const root = el("div", { class: "biz-grid", id: "admin-roster" });
  businesses.forEach((business) => {
    root.append(gridCard(business, {
      settings: { system_enabled: true },
      link: null,
      ig: null,
      leads: leads.get(business.id) || [],
      shared: business.id === "w4"
    }, lang));
  });
  root.append(addBusinessCard({
    text: lang === "es" ? "Añadir negocio" : "Add business",
    onClick: () => openAddBusiness({ supabase: null, preview: true })
  }));
  shell.append(root);
  app.replaceChildren(shell);
}

function previewLeadRows(total) {
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  const rows = [];
  for (let i = 0; i < total; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() - (i % 5));
    rows.push({ created_at: day.toISOString() });
  }
  return rows;
}

export function renderConnectPreview(app) {
  const rows = [
    { id: "preview-a", workspace_id: "w1", username: "vam.coach", status: "pending", notes: "Business account" },
    { id: "preview-b", workspace_id: "w2", username: "northstar.coach", status: "in_progress", notes: "" }
  ];
  const businesses = [
    { id: "w1", name: "Value Add Marketing" },
    { id: "w2", name: "Northstar Coaching" }
  ];
  const draw = () => {
    const waiting = rows.filter((row) => row.status === "pending" || row.status === "in_progress");
    const queue = connectQueue(waiting, businesses, (row, status) => {
      row.status = status;
      draw();
    });
    app.replaceChildren(queue || el("p", { class: "roster-note", text: waiting.length ? "" : "" }));
  };
  draw();
}

function resolveConnectRequest(supabase, app, row, status, buttons) {
  buttons.forEach((button) => { button.disabled = true; });
  return supabase.rpc("acq_admin_resolve_instagram_connection", {
    p_request: row.id,
    p_status: status
  }).then((saved) => {
    if (saved.error) {
      buttons.forEach((button) => { button.disabled = false; });
      const note = document.createElement("p");
      note.textContent = scrubChannelCopy(saved.error.message || "That connection request could not be updated.");
      buttons[0].parentElement.append(note);
      return;
    }
    return renderAcquisitionRoster(supabase, app);
  });
}

function rosterLang() {
  try { return localStorage.getItem("roleflow.lang") === "es" ? "es" : "en"; } catch (_error) { return "en"; }
}

function connectQueue(rows, businesses, onResolve, lang) {
  if (!rows.length) return null;
  const section = el("section", { class: "connect-banner", id: "connect-requests" });
  const heading = lang === "es" ? "Solicitudes de conexión" : "Connect requests";
  section.append(el("h2", { text: heading + " · " + rows.length }));
  const es = lang === "es";
  const names = new Map((businesses || []).map((row) => [row.id, row.name || (es ? "Negocio sin nombre" : "Untitled business")]));
  rows.forEach((row) => {
    const block = el("article", { class: "roster-biz" });
    block.append(el("h3", { text: names.get(row.workspace_id) || (es ? "Este negocio" : "This business") }));
    block.append(el("p", { text: "@" + row.username + (row.notes ? " · " + row.notes : "") }));
    block.append(el("p", { text: row.status === "in_progress" ? (es ? "Sincronizando" : "Syncing") : (es ? "En espera" : "Waiting") }));
    const actions = el("div", { class: "filters" });
    const connected = el("button", { type: "button", class: "btn sm" }, [es ? "Marcar conectado" : "Mark connected"]);
    const failed = el("button", { type: "button", class: "btn sm ghost" }, [es ? "Marcar fallido" : "Mark failed"]);
    const buttons = [connected, failed];
    connected.addEventListener("click", () => onResolve(row, "connected", buttons));
    failed.addEventListener("click", () => onResolve(row, "failed", buttons));
    actions.append(connected, failed);
    block.append(actions);
    section.append(block);
  });
  return section;
}

function gridCard(business, data, lang) {
  const on = Boolean(data.settings && data.settings.system_enabled);
  const days = data.leads == null ? [] : sparkDays(data.leads);
  const total = data.leads == null ? null : days.reduce((sum, day) => sum + day.count, 0);
  const es = lang === "es";
  return businessCard({
    name: business.name || (es ? "Negocio sin nombre" : "Untitled business"),
    active: on,
    activeText: es ? "IA activa" : "AI active",
    shared: Boolean(data.shared),
    sharedText: es ? "Compartido" : "Shared",
    created: createdPhrase(business.created_at, es ? "es" : "en"),
    leadLabel: es ? "Leads · últimos 7 días" : "Leads · last 7 days",
    total,
    days,
    chartLabel: total ? "Leads over the last 7 days" : "No leads in the last 7 days",
    href: "/account/acquisition/?business=" + encodeURIComponent(business.id) + "#dashboard",
    menu: cardMenu(business, data)
  });
}

function cardMenu(business, data) {
  const id = encodeURIComponent(business.id);
  const wrap = el("div", { class: "biz-menu-wrap" });
  const button = el("button", {
    type: "button",
    class: "biz-kebab",
    "aria-label": "Business actions",
    "aria-expanded": "false"
  }, ["⋮"]);
  const menu = el("div", { class: "biz-menu", hidden: true });
  menu.append(el("a", { href: "/account/acquisition/?business=" + id + "#dashboard" }, ["Open"]));
  menu.append(el("a", { href: "/account/acquisition/?business=" + id + "#pipeline" }, ["CRM"]));
  menu.append(el("p", { text: instagramLine(data.ig, data.link) }));
  menu.append(el("p", { text: setterLinkLine(data.link, data.settings) }));
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const next = menu.hidden;
    document.querySelectorAll(".biz-menu").forEach((node) => { node.hidden = true; });
    menu.hidden = !next;
    button.setAttribute("aria-expanded", menu.hidden ? "false" : "true");
  });
  wrap.append(button, menu);
  return wrap;
}

function sparkDays(rows) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    days.push({ key: day.toISOString().slice(0, 10), count: 0, label: String(day.getDate()) });
  }
  (rows || []).forEach((row) => {
    const key = String(row.created_at || "").slice(0, 10);
    const bucket = days.find((item) => item.key === key);
    if (bucket) bucket.count += 1;
  });
  return days;
}


function instagramLine(ig) {
  if (ig && ig.username && ig.status === "connected") return "Instagram: @" + cleanHandle(ig.username);
  if (ig && ig.username && ig.status && ig.status !== "disconnected") return "Instagram: @" + cleanHandle(ig.username);
  return "Instagram: not connected";
}

function setterLinkLine(link, settings) {
  const provider = settings && settings.setter_provider === "engine" ? "Roleflow Setter Engine" : "Roleflow Meta engine";
  if (!link) return "Setter link: Not linked · " + provider;
  if (link.status === "pending") return "Setter link: Pending activation · " + provider;
  if (link.status === "connected") return "Setter link: Connected · " + provider;
  if (link.status === "error") return "Setter link: Needs attention · " + provider;
  return "Setter link: Not linked · " + provider;
}

function cleanHandle(value) {
  return String(value || "").trim().replace(/^@/, "");
}

function group(rows, key) {
  const map = new Map();
  rows.forEach((row) => {
    const id = row[key];
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  });
  return map;
}

function showProblem(app, title, text) {
  app.replaceChildren(el("div", { class: "state" }, [
    el("h2", {}, [title]),
    el("p", {}, [text])
  ]));
}

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
