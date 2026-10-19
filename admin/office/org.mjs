// Roleflow org for the Agentic HQ office.
//
// Seat geometry lives here. The agent-hq edge function only returns the
// calling agent's own tasks and schedules, so it cannot place the floor.
// Who sits in each seat, the "N of M agents below the C-suite" pill, and the
// desk line come from the admin client's hq_agents / hq_tasks / hq_activity /
// hq_schedules rows (see currentDesk in desk.mjs). Live names such as
// "Chief Revenue Officer (CRO)" match the canonical seat or a previous HQ name.

export function belowLine(below, total) {
  return below + " of " + total + " agents below the C-suite";
}

const CHIEF_R = 4.7;
const L2_R = 6.75;
const L3_R = 8.85;
const GAP = 1.7;

const AGENTS = [
  { key: "cos", name: "Chief of Staff", badge: "Chief of Staff", level: "L1", department: "Executive", zone: "executive", reportsTo: null, reportsToLabel: "Diego (CEO)", hq: "roleflow-agent", station: "chief_of_staff", color: "#ff2d95", sort: 10, aliases: ["Roleflow Agent", "roleflow-agent"] },
  { key: "cro", name: "Chief Revenue Officer", badge: "CRO", level: "L1", department: "Revenue", zone: "revenue", reportsTo: "cos", reportsToLabel: "Chief of Staff", hq: "sales-desk", station: "sales_desk", color: "#ff4d8d", sort: 20, aliases: ["CRO", "Sales Desk", "sales-desk"] },
  { key: "cco", name: "Chief Content Officer", badge: "CCO", level: "L1", department: "Content", zone: "content", reportsTo: "cos", reportsToLabel: "Chief of Staff", hq: "content-generator", station: "writers_room", color: "#c040ff", sort: 30, aliases: ["CCO", "Content Generator", "content-generator"] },
  { key: "coo", name: "Chief Operating Officer", badge: "COO", level: "L1", department: "Operations", zone: "operations", reportsTo: "cos", reportsToLabel: "Chief of Staff", hq: "onboarding", station: "client_floor", color: "#7a4dff", sort: 40, aliases: ["COO", "SAAS Builder", "Onboarding & Client Success", "Onboarding Prompt Builder", "onboarding"] },
  { key: "cfo", name: "Chief Financial Officer", badge: "CFO", level: "L1", department: "Finance", zone: "finance", reportsTo: "cos", reportsToLabel: "Chief of Staff", hq: "finance", station: "back_office", color: "#ffe56a", sort: 50, aliases: ["CFO", "Finance", "Finance Manager", "finance"] },
  { key: "cto", name: "Chief Technology Officer", badge: "CTO", level: "L1", department: "Technology", zone: "technology", reportsTo: "cos", reportsToLabel: "Chief of Staff", hq: "cto", station: "back_office", color: "#4d9dff", sort: 60, aliases: ["CTO", "cto"] },
  { key: "lgm", name: "Lead Generation Manager", badge: "Lead Gen", level: "L2", department: "Revenue", zone: "revenue", reportsTo: "cro", reportsToLabel: "Chief Revenue Officer", hq: "lead-gen", station: "research", color: "#ff7a9a", sort: 21, aliases: ["Lead Gen Manager", "lead-gen"] },
  { key: "sdr", name: "Outbound SDR", badge: "SDR", level: "L3", department: "Revenue", zone: "revenue", reportsTo: "lgm", reportsToLabel: "Lead Generation Manager", hq: "outbound-rep", station: "writers_room", color: "#ff9a4a", sort: 22, aliases: ["Outbound Rep", "outbound-rep"] },
  { key: "its", name: "Inbound Triage Specialist", badge: "Inbound", level: "L3", department: "Revenue", zone: "revenue", reportsTo: "cro", reportsToLabel: "Chief Revenue Officer", hq: "mail-room", station: "mail_room", color: "#ff7a9a", sort: 23, aliases: ["Mail Room", "mail-room"] },
  { key: "crm", name: "CRM Database Administrator", badge: "CRM", level: "L3", department: "Revenue", zone: "revenue", reportsTo: "cro", reportsToLabel: "Chief Revenue Officer", hq: "crm-admin", station: "sales_desk", color: "#ff7a9a", sort: 24, aliases: ["crm-admin"] },
  { key: "smdm", name: "Social Media Distribution Manager", badge: "Distribution", level: "L2", department: "Content", zone: "content", reportsTo: "cco", reportsToLabel: "Chief Content Officer", hq: "ads-manager", station: "shipping_dock", color: "#d070ff", sort: 31, aliases: ["Social Media Manager", "Ads Manager", "ads-manager"] },
  { key: "ces", name: "Community Engagement Specialist", badge: "Community", level: "L3", department: "Content", zone: "content", reportsTo: "smdm", reportsToLabel: "Social Media Distribution Manager", hq: "community-engagement", station: "shipping_dock", color: "#d070ff", sort: 32, aliases: ["community-engagement"] },
  { key: "pmp", name: "Paid Media & Partnerships Specialist", badge: "Paid Media", level: "L3", department: "Content", zone: "content", reportsTo: "cco", reportsToLabel: "Chief Content Officer", hq: "paid-media", station: "shipping_dock", color: "#d070ff", sort: 33, aliases: ["paid-media"] },
  { key: "qaa", name: "Quality Assurance Analyst", badge: "QA Analyst", level: "L3", department: "Operations", zone: "operations", reportsTo: "coo", reportsToLabel: "Chief Operating Officer", hq: "setter-qa", station: "client_floor", color: "#9a78ff", sort: 41, aliases: ["Setter QA", "setter-qa"] },
  { key: "pcs", name: "Proof & Case Study Specialist", badge: "Proof", level: "L3", department: "Operations", zone: "operations", reportsTo: "coo", reportsToLabel: "Chief Operating Officer", hq: "proof-builder", station: "client_floor", color: "#9a78ff", sort: 42, aliases: ["Proof Builder", "proof-builder"] },
  { key: "fe", name: "Frontend Engineer", badge: "Frontend", level: "L3", department: "Technology", zone: "technology", reportsTo: "cto", reportsToLabel: "Chief Technology Officer", hq: "frontend", station: "back_office", color: "#7ab6ff", sort: 61, aliases: ["frontend"] },
  { key: "be", name: "Backend & Database Engineer", badge: "Backend", level: "L3", department: "Technology", zone: "technology", reportsTo: "cto", reportsToLabel: "Chief Technology Officer", hq: "backend", station: "back_office", color: "#7ab6ff", sort: 62, aliases: ["backend"] },
  { key: "ie", name: "Integrations Engineer", badge: "Integrations", level: "L3", department: "Technology", zone: "technology", reportsTo: "cto", reportsToLabel: "Chief Technology Officer", hq: "integrations", station: "back_office", color: "#7ab6ff", sort: 63, aliases: ["integrations"] },
  { key: "qr", name: "QA & Release Engineer", badge: "QA Release", level: "L3", department: "Technology", zone: "technology", reportsTo: "cto", reportsToLabel: "Chief Technology Officer", hq: "qa-release", station: "back_office", color: "#7ab6ff", sort: 64, aliases: ["qa-release"] },
  { key: "sec", name: "Security & Access Admin", badge: "Security", level: "L3", department: "Technology", zone: "technology", reportsTo: "cto", reportsToLabel: "Chief Technology Officer", hq: "security", station: "back_office", color: "#7ab6ff", sort: 65, aliases: ["security"] }
];

const ZONES = [
  { id: "revenue", title: "Revenue", chief: "cro", angle: 180, color: 0xff4d8d },
  { id: "content", title: "Content", chief: "cco", angle: 252, color: 0xc040ff },
  { id: "operations", title: "Operations", chief: "coo", angle: 324, color: 0x7a4dff },
  { id: "finance", title: "Finance", chief: "cfo", angle: 36, color: 0xffe56a },
  { id: "technology", title: "Technology", chief: "cto", angle: 108, color: 0x4d9dff }
];

const BY_KEY = new Map(AGENTS.map((agent) => [agent.key, agent]));

function norm(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function polar(deg, radius) {
  const rad = deg * Math.PI / 180;
  return { x: Math.cos(rad) * radius, z: Math.sin(rad) * radius };
}

function place(deg, radius, index, count) {
  const center = polar(deg, radius);
  const side = (index - (count - 1) / 2) * GAP;
  const tangent = polar(deg + 90, side);
  return { x: center.x + tangent.x, y: 0, z: center.z + tangent.z };
}

function childrenOf(key) {
  return AGENTS.filter((agent) => agent.reportsTo === key).slice().sort((a, b) => a.sort - b.sort);
}

function hasChildren(key) {
  return AGENTS.some((agent) => agent.reportsTo === key);
}

function fanOrder(kids) {
  const managers = kids.filter((agent) => hasChildren(agent.key));
  const leaves = kids.filter((agent) => !hasChildren(agent.key));
  const slots = Array(kids.length).fill(null);
  const mid = (kids.length - 1) / 2;
  managers.forEach((agent, index) => {
    const slot = Math.round(mid - (managers.length - 1) / 2 + index);
    slots[slot] = agent;
  });
  let leaf = 0;
  for (let i = 0; i < slots.length; i += 1) {
    if (!slots[i]) slots[i] = leaves[leaf++];
  }
  return slots;
}

function angleOf(point) {
  return Math.atan2(point.z, point.x) * 180 / Math.PI;
}

function dist(point) {
  return Math.hypot(point.x, point.z);
}

function belowIn(zoneId) {
  return AGENTS.filter((agent) => agent.zone === zoneId && agent.level !== "L1").length;
}

export function zoneLabel(zoneId) {
  const zone = ZONES.find((item) => item.id === zoneId);
  if (!zone) return "";
  const below = belowIn(zoneId);
  if (!below) return zone.title;
  return zone.title + " · " + below;
}

function layoutSeats() {
  const seats = [];
  seats.push({ key: "cos", x: 0, y: 0.2, z: 0.85, role: "chief" });
  ZONES.forEach((zone) => {
    const chief = polar(zone.angle, 4.9);
    seats.push({ key: zone.chief, x: chief.x, y: 0, z: chief.z, role: "chief" });
    const flat = childrenOf(zone.chief).flatMap((agent) => [agent].concat(childrenOf(agent.key)));
    const count = flat.length;
    const spread = count <= 1 ? 0 : Math.min(56, (count - 1) * 14);
    flat.forEach((agent, index) => {
      const ang = zone.angle - spread / 2 + (count <= 1 ? 0 : (spread / (count - 1)) * index);
      const spot = polar(ang, 8);
      seats.push({
        key: agent.key,
        x: spot.x,
        y: 0,
        z: spot.z,
        role: hasChildren(agent.key) ? "manager" : "specialist"
      });
    });
  });
  return seats;
}

let cachedSeats = null;

function seats() {
  if (!cachedSeats) cachedSeats = layoutSeats();
  return cachedSeats;
}

function withAgent(spot) {
  const agent = BY_KEY.get(spot.key);
  return Object.assign({}, agent, spot, { aliases: agent.aliases.concat([agent.name, agent.hq]) });
}

export function orgAgents() {
  return AGENTS.map((agent) => Object.assign({}, agent));
}

export function orgCounts() {
  const total = AGENTS.length;
  const cSuite = AGENTS.filter((agent) => agent.level === "L1").length;
  const below = total - cSuite;
  return { total, cSuite, below, headline: belowLine(below, total), of: below + " of " + total };
}

function rowsInside(agents) {
  return (agents || []).some((agent) => (
    agent &&
    agent.status !== "retired" &&
    agent.status !== "archived" &&
    !agent.outside_org &&
    agent.department !== "Outside"
  ));
}

export function rosterCounts(agents) {
  const rows = (agents || []).filter((agent) => (
    agent &&
    agent.status !== "retired" &&
    agent.status !== "archived" &&
    !agent.outside_org &&
    agent.department !== "Outside"
  ));
  const total = rows.length;
  const roots = rows.filter((agent) => !agent.reports_to);
  const chiefOfStaff = roots.find((agent) => norm(agent.name).startsWith("chief of staff")) || roots[0] || null;
  const rootIds = new Set(chiefOfStaff ? [chiefOfStaff.id] : roots.map((agent) => agent.id));
  const cSuite = rows.filter((agent) => rootIds.has(agent.id) || (agent.reports_to && rootIds.has(agent.reports_to))).length;
  const below = total - cSuite;
  return { total, cSuite, below, headline: belowLine(below, total), of: below + " of " + total };
}

const HANDOFFS = [
  ["sdr", "crm"],
  ["its", "crm"],
  ["qr", "fe"],
  ["qr", "be"],
  ["qr", "ie"]
];

function deptZone(department) {
  const text = norm(department);
  if (text.startsWith("rev")) return "revenue";
  if (text.startsWith("cont") || text === "marketing") return "content";
  if (text.startsWith("op")) return "operations";
  if (text.startsWith("fin")) return "finance";
  if (text.startsWith("tech")) return "technology";
  return "";
}

export function clustersFromReports(agents) {
  const rows = (agents || []).filter((agent) => (
    agent &&
    agent.id &&
    agent.status !== "retired" &&
    agent.status !== "archived" &&
    !agent.outside_org &&
    agent.department !== "Outside"
  ));
  const cos = rows.find((agent) => !agent.reports_to && norm(agent.name).startsWith("chief of staff")) || rows.find((agent) => !agent.reports_to) || null;
  const chiefs = rows.filter((agent) => cos && agent.reports_to === cos.id);
  const subtree = (id) => rows.filter((agent) => agent.reports_to === id).flatMap((child) => [child].concat(subtree(child.id)));
  return {
    cos,
    zones: chiefs.map((chief) => ({
      chief,
      zone: deptZone(chief.department) || "operations",
      members: subtree(chief.id)
    }))
  };
}

export function rocketEdges(list) {
  const rows = list || seats().map(withAgent);
  const edges = [];
  const seen = new Set();
  const add = (from, to, hop) => {
    if (!from || !to || from === to) return;
    const id = from + ">" + to;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ from, to, hop });
  };
  rows.forEach((agent) => {
    if (!agent || !agent.reportsTo || agent.key === "cos") return;
    add(agent.reportsTo, agent.key, agent.reportsTo === "cos" ? "chief" : "desk");
  });
  HANDOFFS.forEach(([from, to]) => add(from, to, "handoff"));
  return edges;
}

function reaches(key, hot) {
  if (hot.has(key)) return true;
  return childrenOf(key).some((child) => reaches(child.key, hot));
}

export function launchPlan(hotKeys, reduceMotion) {
  const hot = new Set(hotKeys || []);
  const any = hot.size > 0;
  return rocketEdges().map((edge, index) => {
    let mode = "idle";
    if (reduceMotion) mode = "rest";
    else if (any && reaches(edge.to, hot)) mode = "active";
    else mode = "idle";
    return Object.assign({}, edge, { mode, offset: index * 0.17 });
  });
}

export function placeRoster(liveAgents) {
  const bound = bindRoster(liveAgents);
  const clusters = clustersFromReports(liveAgents);
  const byKey = new Map(bound.map((seat) => [seat.key, seat]));
  const idToKey = new Map();
  bound.forEach((seat) => {
    if (seat.live) idToKey.set(seat.live.id, seat.key);
  });
  const placed = [];
  const used = new Set();
  const cosKey = clusters.cos ? (idToKey.get(clusters.cos.id) || "cos") : "cos";
  const cosSeat = byKey.get(cosKey) || { key: "cos", name: "Chief of Staff", badge: "Chief of Staff", color: "#ff2d95", level: "L1", reportsTo: null };
  placed.push(Object.assign({}, cosSeat, { x: 0, y: 0.2, z: 0.85, role: "chief", zone: "executive", reportsTo: null }));
  used.add(cosKey);
  clusters.zones.forEach((cluster) => {
    const meta = ZONES.find((zone) => zone.id === cluster.zone) || ZONES[0];
    const chiefKey = idToKey.get(cluster.chief.id);
    if (!chiefKey || !byKey.get(chiefKey)) return;
    const chiefPos = polar(meta.angle, 4.9);
    placed.push(Object.assign({}, byKey.get(chiefKey), { x: chiefPos.x, y: 0, z: chiefPos.z, role: "chief", zone: meta.id, reportsTo: cosKey }));
    used.add(chiefKey);
    const members = cluster.members.map((row) => idToKey.get(row.id)).filter((key) => key && byKey.get(key));
    const count = members.length;
    const spread = count <= 1 ? 0 : Math.min(56, (count - 1) * 14);
    members.forEach((key, index) => {
      const ang = meta.angle - spread / 2 + (count <= 1 ? 0 : (spread / (count - 1)) * index);
      const spot = polar(ang, 8);
      const seat = byKey.get(key);
      const parent = cluster.members.find((row) => idToKey.get(row.id) === key);
      const parentKey = parent && idToKey.get(parent.reports_to);
      placed.push(Object.assign({}, seat, {
        x: spot.x,
        y: 0,
        z: spot.z,
        role: seat.level === "L2" ? "manager" : "specialist",
        zone: meta.id,
        reportsTo: parentKey || chiefKey
      }));
      used.add(key);
    });
  });
  bound.forEach((seat) => {
    if (!used.has(seat.key)) placed.push(seat);
  });
  return placed;
}

export function orgLayout(liveAgents) {
  const placed = rowsInside(liveAgents) ? placeRoster(liveAgents) : seats().map(withAgent);
  const points = {
    brand_brain: { x: 0, y: 1.75, z: 0 },
    meetup: { x: 1.35, y: 0, z: 1.35 },
    approval: { x: 0.2, y: 0, z: 2.5 },
    room_a: { x: -12.4, y: 0, z: -12.4 },
    room_b: { x: 12.4, y: 0, z: -12.4 },
    room_c: { x: -12.4, y: 0, z: 12.2 },
    room_d: { x: 12.4, y: 0, z: 12.2 }
  };
  placed.forEach((seat) => {
    points[seat.key] = { x: seat.x, y: seat.y, z: seat.z };
  });
  points.chief_of_staff = points.cos;
  const zones = ZONES.map((zone) => {
    const members = placed.filter((seat) => seat.zone === zone.id);
    return {
      id: zone.id,
      title: zone.title,
      label: zoneLabel(zone.id),
      chief: zone.chief,
      color: zone.color,
      angle: zone.angle,
      below: belowIn(zone.id),
      members
    };
  });
  zones.forEach((zone) => {
    const chief = points[zone.chief];
    points[zone.id] = { x: chief.x, y: chief.y, z: chief.z };
  });
  const counts = orgCounts();
  return {
    headline: counts.headline,
    of: counts.of,
    total: counts.total,
    cSuite: counts.cSuite,
    below: counts.below,
    seats: placed,
    zones,
    points,
    edges: rocketEdges(placed),
    cameras: [{ id: "chief_of_staff", tab: "Chief of Staff" }].concat(zones.map((zone) => ({ id: zone.id, tab: zone.label }))),
    brain: points.brand_brain
  };
}

function aliasIndex() {
  const map = new Map();
  AGENTS.forEach((agent) => {
    [agent.name, agent.hq].concat(agent.aliases).forEach((alias) => {
      const key = norm(alias);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(agent.key);
    });
  });
  return map;
}

const ALIASES = aliasIndex();

function matchesFor(agent) {
  const fields = [norm(agent && agent.name), norm(agent && agent.title)].filter(Boolean);
  const found = [];
  ALIASES.forEach((keys, alias) => {
    const hit = fields.some((text) => text === alias || text.startsWith(alias + " ") || text.startsWith(alias + "("));
    if (!hit) return;
    keys.forEach((key) => {
      const canonical = norm(BY_KEY.get(key).name) === alias ? 1000 : 0;
      found.push({ key, score: alias.length + canonical });
    });
  });
  found.sort((a, b) => b.score - a.score);
  return found;
}

export function bindRoster(liveAgents) {
  const layout = orgLayout();
  const taken = new Set();
  const liveByKey = new Map();
  const rows = (liveAgents || []).filter((agent) => agent && agent.status !== "retired" && agent.status !== "archived" && !agent.outside_org && agent.department !== "Outside");
  const ranked = rows.map((agent) => ({ agent, matches: matchesFor(agent) })).filter((row) => row.matches.length);
  ranked.sort((a, b) => b.matches[0].score - a.matches[0].score || (Number(a.agent.sort_order) || 0) - (Number(b.agent.sort_order) || 0) || norm(a.agent.name).localeCompare(norm(b.agent.name)));
  ranked.forEach((row) => {
    const match = row.matches.find((item) => !taken.has(item.key));
    if (!match) return;
    taken.add(match.key);
    liveByKey.set(match.key, row.agent);
  });
  return layout.seats.map((seat) => {
    const live = liveByKey.get(seat.key) || null;
    const avatar = live && live.avatar && typeof live.avatar === "object" ? live.avatar.color : "";
    return Object.assign({}, seat, {
      id: live ? live.id : "org:" + seat.key,
      live,
      color: avatar || seat.color,
      status: live ? live.status : "active"
    });
  });
}

export function unmatchedRoster(liveAgents) {
  const bound = new Set(bindRoster(liveAgents).map((seat) => seat.live && seat.live.id).filter(Boolean));
  return (liveAgents || []).filter((agent) => agent && agent.status !== "retired" && agent.status !== "archived" && !bound.has(agent.id));
}

export function stackModel(liveAgents) {
  const seats = bindRoster(liveAgents);
  const byKey = new Map(seats.map((seat) => [seat.key, seat]));
  const nest = (managerKey) => AGENTS.filter((agent) => agent.reportsTo === managerKey).sort((a, b) => a.sort - b.sort).map((agent) => ({
    seat: byKey.get(agent.key),
    reports: nest(agent.key)
  }));
  const counts = rowsInside(liveAgents) ? rosterCounts(liveAgents) : orgCounts();
  return {
    headline: counts.headline,
    of: counts.of,
    total: counts.total,
    cSuite: counts.cSuite,
    below: counts.below,
    cos: byKey.get("cos"),
    zones: ZONES.map((zone) => ({
      id: zone.id,
      label: zoneLabel(zone.id),
      title: zone.title,
      below: belowIn(zone.id),
      chief: byKey.get(zone.chief),
      people: nest(zone.chief)
    }))
  };
}

function previewId(n) {
  return "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
}

export function orgPreviewFixture() {
  const seats = bindRoster([]);
  const idOf = new Map(seats.map((seat, index) => [seat.key, previewId(index + 1)]));
  const agents = seats.map((seat, index) => ({
    id: idOf.get(seat.key),
    source_id: null,
    name: seat.name,
    title: seat.name,
    department: seat.department,
    reports_to: seat.reportsTo ? idOf.get(seat.reportsTo) : null,
    reports_to_label: seat.reportsToLabel,
    status: "active",
    role: seat.level + " · " + seat.department,
    notes: "",
    standing_need: "",
    outside_org: false,
    is_lead: seat.level === "L1",
    sort_order: seat.sort,
    station: seat.station,
    avatar: { color: seat.color, initials: seat.badge.slice(0, 2).toUpperCase() },
    last_active_at: "2026-10-19T08:00:00.000Z"
  }));
  const cro = idOf.get("cro");
  const ces = idOf.get("ces");
  const tasks = [
    {
      id: previewId(101),
      agent_id: cro,
      title: "Call brief for the Tuesday demo",
      description: "Draft for Diego.",
      status: "in_progress",
      priority: "high",
      due: null,
      result: "",
      station: "sales_desk",
      estimate_minutes: 30,
      started_at: new Date(Date.now() - 12 * 60000).toISOString(),
      created_at: "2026-10-19T08:00:00.000Z",
      updated_at: "2026-10-19T08:10:00.000Z"
    },
    {
      id: previewId(102),
      agent_id: ces,
      title: "Reply to comments on yesterday's Reel",
      description: "Draft replies only.",
      status: "queued",
      priority: "normal",
      due: null,
      result: "",
      station: "shipping_dock",
      estimate_minutes: 20,
      started_at: null,
      created_at: "2026-10-19T09:00:00.000Z",
      updated_at: "2026-10-19T09:00:00.000Z"
    }
  ];
  return { agents, tasks, comments: [], schedules: [], activity: [], keys: [] };
}

export function seatDistance(seat) {
  return dist(seat);
}
