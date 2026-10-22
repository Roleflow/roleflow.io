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
  const [profiles, settings, workforce, links, ig, workers, targets] = await Promise.all([
    ownerIds.length
      ? supabase.from("profiles").select("id, email, full_name").in("id", ownerIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("acq_settings").select("agent_id, setter_provider, daily_cap, system_enabled, onboarding_step, timezone").in("agent_id", ids),
    supabase.from("business_workforce").select("agent_id, role, status, daily_count, daily_count_on, last_run_at").in("agent_id", ids).in("role", [...ROLE_SET]).limit(2000),
    supabase.from("acq_setter_links").select("business_id, status, requested_handle, provider, last_synced_at, webhook_seen_at, external_agent_id, last_sync_error").in("business_id", ids),
    supabase.from("ig_connections").select("business_id, username, status, connected_at").in("business_id", ids),
    supabase.from("acq_workers").select("business_id, status, enabled, last_heartbeat_at").in("business_id", ids),
    supabase.from("acq_targets").select("agent_id, created_at").gte("created_at", new Date(Date.now() - 6 * 86400000).toISOString()).limit(2000)
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
      leads: targets.error ? null : (targetsById.get(business.id) || [])
    }));
  });
  const add = el("section", { class: "biz-tile add" });
  add.append(el("h2", { text: "Add business" }));
  add.append(el("p", { text: "A business appears here when its owner signs up. Opening this page does not create one." }));
  root.append(add);
  app.replaceChildren(root);
}

function gridCard(business, data) {
  const tile = el("article", { class: "biz-tile" });
  const on = Boolean(data.settings && data.settings.system_enabled);
  const head = el("div", { class: "roster-head" });
  head.append(el("span", { class: on ? "ai-dot on" : "ai-dot", title: on ? "AI active" : "AI off" }));
  head.append(el("strong", { text: on ? "AI active" : "AI off" }));
  tile.append(head);
  tile.append(el("h2", { text: business.name || "Untitled business" }));
  tile.append(el("p", { class: "roster-meta", text: "Created " + createdLabel(business.created_at) }));
  tile.append(el("p", { class: "roster-meta", text: ownerLine(data.profile) }));
  const days = sparkDays(data.leads);
  const total = days.reduce((sum, day) => sum + day.count, 0);
  tile.append(sparkSvg(days));
  tile.append(el("p", { text: data.leads == null ? "Lead history could not be read." : total + " leads in the last 7 days" }));
  tile.append(el("p", { text: instagramLine(data.ig, data.link) }));
  tile.append(el("p", { text: setterLinkLine(data.link, data.settings) }));
  const actions = el("div", { class: "filters" });
  actions.append(el("a", {
    class: "btn sm",
    href: "/account/acquisition/?business=" + encodeURIComponent(business.id) + "#dashboard"
  }, ["Open"]));
  actions.append(el("a", {
    class: "btn sm ghost",
    href: "/account/acquisition/?business=" + encodeURIComponent(business.id) + "#pipeline"
  }, ["CRM"]));
  tile.append(actions);
  return tile;
}

function sparkDays(rows) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    days.push({ key: day.toISOString().slice(0, 10), count: 0 });
  }
  (rows || []).forEach((row) => {
    const key = String(row.created_at || "").slice(0, 10);
    const bucket = days.find((item) => item.key === key);
    if (bucket) bucket.count += 1;
  });
  return days;
}

function sparkSvg(days) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 46");
  svg.setAttribute("class", "spark");
  svg.setAttribute("aria-hidden", "true");
  const max = Math.max(1, ...days.map((day) => day.count));
  const points = days.map((day, index) => {
    const x = days.length === 1 ? 0 : (index / (days.length - 1)) * 100;
    const y = 42 - (day.count / max) * 36;
    return x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("points", points);
  svg.append(line);
  return svg;
}

function createdLabel(value) {
  if (!value) return "date not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "date not recorded";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function businessCard(business, data) {
  const section = el("section", { class: "roster-biz" });
  const head = el("div", { class: "roster-head" });
  head.append(el("h2", { text: business.name || "Untitled business" }));
  const actions = el("div", { class: "filters" });
  actions.append(el("a", {
    class: "btn sm",
    href: "/account/acquisition/?business=" + encodeURIComponent(business.id) + "#dashboard"
  }, ["Open"]));
  actions.append(el("a", {
    class: "btn sm ghost",
    href: "/account/acquisition/?business=" + encodeURIComponent(business.id) + "#pipeline"
  }, ["CRM"]));
  head.append(actions);
  section.append(head);
  section.append(el("p", { class: "roster-meta", text: ownerLine(data.profile) }));
  section.append(el("p", { text: instagramLine(data.ig, data.link) }));
  section.append(el("p", { text: setterLinkLine(data.link, data.settings) }));
  section.append(el("p", { text: workerLine(data.workers) }));
  section.append(el("p", { text: systemLine(data.settings) }));
  const provisioned = data.roles.filter((row) => ROLE_SET.has(row.role));
  if (!provisioned.length) {
    section.append(el("p", { text: "No agents provisioned yet. Open the CRM and finish setup." }));
    return section;
  }
  const agents = el("div", { class: "agents" });
  const icp = data.roles.find((row) => row.role === ICP);
  const warmup = data.roles.find((row) => row.role === WARMUP);
  const outreach = data.roles.find((row) => row.role === OUTREACH);
  const setterRows = SETTER_ROLES.map((role) => data.roles.find((row) => row.role === role)).filter(Boolean);
  if (icp) agents.append(icpCard(icp, data));
  if (warmup || outreach) agents.append(warmupCard(warmup, outreach, data));
  if (setterRows.length) agents.append(setterCard(setterRows, data));
  section.append(agents);
  return section;
}

function icpCard(row, data) {
  const status = roleStatus(row);
  const cap = data.settings && data.settings.daily_cap;
  const lines = [
    cap ? "Today " + countToday(row, data.settings) + " / " + cap : "Daily cap not set",
    activityLine([row.last_run_at, newestHeartbeat(data.workers)])
  ];
  if (data.targetCount != null) lines.push(data.targetCount + " contacts at Target");
  return agentCard("ICP Target Acquisition", status, lines);
}

function warmupCard(warmup, outreach, data) {
  const present = [warmup, outreach].filter(Boolean);
  const status = bundleStatus(present);
  const lines = [];
  if (warmup) lines.push("Warm-up today " + countToday(warmup, data.settings));
  if (outreach) lines.push("Outreach today " + countToday(outreach, data.settings));
  lines.push(activityLine([
    warmup && warmup.last_run_at,
    outreach && outreach.last_run_at,
    newestHeartbeat(data.workers)
  ]));
  if (!data.ig || data.ig.status !== "connected") lines.push("Instagram not connected");
  return agentCard("Warm-up and outreach", status, lines);
}

function setterCard(rows, data) {
  const provider = (data.settings && data.settings.setter_provider) || "roleflow_meta";
  const linkStatus = data.link && data.link.status;
  const pending = provider === "engine" && (!data.link || linkStatus === "pending" || linkStatus === "disconnected");
  const status = linkStatus === "error"
    ? { label: "Needs attention", kind: "wait" }
    : pending
      ? { label: "Pending activation", kind: "wait" }
      : bundleStatus(rows);
  const lines = [
    activityLine([
      ...rows.map((row) => row.last_run_at),
      data.link && data.link.last_synced_at,
      data.link && data.link.webhook_seen_at
    ])
  ];
  if (data.link && data.link.last_sync_error) lines.push(data.link.last_sync_error);
  else if (pending) lines.push("The setter stays pending until the engine agent is linked.");
  return agentCard("Roleflow Setter Engine", status, lines);
}

function agentCard(name, status, lines) {
  const card = el("article", { class: "agent" });
  const head = el("header");
  head.append(el("h3", { text: name }), pill(status.label, status.kind));
  card.append(head);
  lines.filter(Boolean).forEach((line) => card.append(el("p", { text: line })));
  return card;
}

function roleStatus(row) {
  if (!row) return { label: "Not provisioned", kind: "off" };
  if (row.status === "active") return { label: "Active", kind: "on" };
  if (row.status === "paused") return { label: "Paused", kind: "off" };
  return { label: "Pending activation", kind: "wait" };
}

function bundleStatus(rows) {
  if (!rows.length) return { label: "Not provisioned", kind: "off" };
  const active = rows.filter((row) => row.status === "active").length;
  if (active === rows.length) return { label: "Active", kind: "on" };
  if (active === 0) return { label: "Paused", kind: "off" };
  return { label: "Mixed", kind: "wait" };
}

function ownerLine(profile) {
  if (!profile) return "Owner not on file";
  const name = String(profile.full_name || "").trim();
  const email = String(profile.email || "").trim();
  if (name && email) return name + " · " + email;
  return email || name || "Owner not on file";
}

function instagramLine(ig, link) {
  if (ig && ig.username && ig.status === "connected") return "Instagram @" + cleanHandle(ig.username);
  if (ig && ig.username && ig.status && ig.status !== "disconnected") return "Instagram @" + cleanHandle(ig.username) + " · " + ig.status;
  if (link && link.requested_handle) return "Instagram not connected · requested @" + cleanHandle(link.requested_handle);
  return "Instagram not connected";
}

function setterLinkLine(link, settings) {
  const provider = settings && settings.setter_provider === "engine" ? "Roleflow Setter Engine" : "Roleflow Meta engine";
  if (!link) return "Setter link: Not linked · " + provider;
  if (link.status === "pending") return "Setter link: Pending activation · " + provider;
  if (link.status === "connected") return "Setter link: Connected · " + provider;
  if (link.status === "error") return "Setter link: Needs attention · " + provider;
  return "Setter link: Not linked · " + provider;
}

function workerLine(workers) {
  if (!workers.length) return "No worker key yet";
  const live = workers.find((row) => row.enabled) || workers[0];
  const beat = live.last_heartbeat_at ? "Last heartbeat " + when(live.last_heartbeat_at) : "No heartbeat yet";
  if (!live.enabled || live.status === "paused") return "Worker paused · " + beat;
  return "Worker " + (live.status || "offline") + " · " + beat;
}

function systemLine(settings) {
  if (!settings) return "System not set up";
  const system = settings.system_enabled ? "System on" : "System off";
  const cap = settings.daily_cap ? "Daily cap " + settings.daily_cap + " targets" : "Daily cap not set";
  const setup = settings.onboarding_step && settings.onboarding_step !== "live" ? " · Setup not finished" : "";
  return system + " · " + cap + setup;
}

function countToday(row, settings) {
  if (!row || row.daily_count_on == null) return 0;
  const today = localToday(settings && settings.timezone);
  return String(row.daily_count_on).slice(0, 10) === today ? Number(row.daily_count) || 0 : 0;
}

function activityLine(values) {
  const stamp = latestStamp(values);
  return stamp ? "Last activity " + when(stamp) : "No activity yet";
}

function newestHeartbeat(workers) {
  return latestStamp((workers || []).map((row) => row.last_heartbeat_at));
}

function latestStamp(values) {
  const times = (values || []).filter(Boolean).map((value) => new Date(value).getTime()).filter((time) => !Number.isNaN(time));
  if (!times.length) return "";
  return new Date(Math.max(...times)).toISOString();
}

function localToday(timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
}

function cleanHandle(value) {
  return String(value || "").trim().replace(/^@/, "");
}

function when(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "never";
  return date.toLocaleString();
}

function pill(label, kind) {
  return el("span", { class: "status-pill " + (kind || "off"), text: label });
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
