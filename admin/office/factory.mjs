export const STATIONS = [
  "research",
  "writers_room",
  "film_studio",
  "edit_bay",
  "shipping_dock",
  "client_floor",
  "chief_of_staff"
];

export const SETTER_STATIONS = [
  "leads_in",
  "qualify",
  "book_call",
  "follow_up",
  "report",
  "overseer"
];

export const STATION_OPTIONS = [
  ["", "Agent's station"],
  ["research", "Research"],
  ["writers_room", "Writers' Room"],
  ["film_studio", "Film Studio"],
  ["edit_bay", "Edit Bay"],
  ["shipping_dock", "Shipping Dock"],
  ["client_floor", "Client Floor"],
  ["chief_of_staff", "Chief of Staff"]
];

const HOMES = {
  "roleflow agent": "chief_of_staff",
  "lead gen manager": "research",
  "outbound rep": "writers_room",
  "content generator": "writers_room",
  "onboarding & client success": "client_floor",
  "onboarding prompt builder": "client_floor",
  "social media manager": "shipping_dock",
  "ads manager": "shipping_dock"
};

const LABELS = {
  research: "Research",
  writers_room: "Writers' Room",
  film_studio: "Film Studio",
  edit_bay: "Edit Bay",
  shipping_dock: "Shipping Dock",
  client_floor: "Client Floor",
  chief_of_staff: "Chief of Staff",
  leads_in: "Leads In",
  qualify: "Qualify",
  book_call: "Book Call",
  follow_up: "Follow-up",
  report: "Report",
  overseer: "Overseer",
  mail_room: "Mail Room",
  sales_desk: "Sales Desk",
  back_office: "Back Office"
};

const PROPS = {
  research: "research",
  film_studio: "studio",
  edit_bay: "edit",
  shipping_dock: "shipping",
  leads_in: "inbox",
  book_call: "handset",
  follow_up: "notes",
  report: "chart"
};

const KNOWN = new Set([...STATIONS, ...SETTER_STATIONS, "mail_room", "sales_desk", "back_office"]);

const RIGHT = { x: 0.70710678, z: -0.70710678 };
const FAR = { x: -0.70710678, z: -0.70710678 };
const SPAN = 7.6;

function at(index, far, lift) {
  return {
    x: RIGHT.x * index * SPAN + FAR.x * far,
    y: lift || 0,
    z: RIGHT.z * index * SPAN + FAR.z * far
  };
}

export function homeStation(agent) {
  if (agent && STATIONS.includes(agent.station)) return agent.station;
  const name = String((agent && agent.name) || "").trim().toLowerCase();
  return HOMES[name] || "";
}

export function taskStation(task, agent) {
  if (task && STATIONS.includes(task.station)) return task.station;
  return homeStation(agent);
}

export function cardSpot(task, agent) {
  if (!task || task.status === "done") return "";
  if (task.status === "needs_diego") return "approval";
  return taskStation(task, agent) || "";
}

export function hqPlan() {
  return {
    kind: "hq",
    brainSub: "",
    fallback: "client_floor",
    pipeline: [
      { id: "research", step: "Step 1", title: "Research", color: 0x2a3d55, prop: "research" },
      { id: "writers_room", step: "Step 2", title: "Writers' Room", color: 0x3a2d4e, prop: "" },
      { id: "film_studio", step: "Step 3", title: "Film Studio", color: 0x3d3428, prop: "studio" },
      { id: "edit_bay", step: "Step 4", title: "Edit Bay", color: 0x243e3a, prop: "edit" },
      { id: "shipping_dock", step: "Step 5", title: "Shipping Dock", color: 0x3a3224, prop: "shipping" }
    ],
    balcony: { id: "chief_of_staff", label: "Chief of Staff, on the balcony" },
    side: { id: "client_floor", title: "Client Floor", color: 0x2c3148 }
  };
}

export function setterPlan(name) {
  return {
    kind: "setter",
    brainSub: String(name || "").trim(),
    fallback: "qualify",
    pipeline: [
      { id: "leads_in", step: "Step 1", title: "Leads In", color: 0x2a3d55, prop: "inbox" },
      { id: "qualify", step: "Step 2", title: "Qualify", color: 0x3a2d4e, prop: "" },
      { id: "book_call", step: "Step 3", title: "Book Call", color: 0x3d3428, prop: "handset" },
      { id: "follow_up", step: "Step 4", title: "Follow-up", color: 0x243e3a, prop: "notes" },
      { id: "report", step: "Step 5", title: "Report", color: 0x3a3224, prop: "chart" }
    ],
    balcony: { id: "overseer", label: "Overseer, on the balcony" },
    side: null
  };
}

export function planIds(plan) {
  const ids = new Set();
  ((plan && plan.pipeline) || []).forEach((station) => ids.add(station.id));
  if (plan && plan.balcony) ids.add(plan.balcony.id);
  if (plan && plan.side) ids.add(plan.side.id);
  return ids;
}

export function withAssigned(plan, ids) {
  const base = plan || setterPlan("");
  const present = planIds(base);
  const pipeline = base.pipeline.slice();
  (ids || []).forEach((raw) => {
    const id = String(raw || "").trim();
    if (!id || present.has(id) || !LABELS[id]) return;
    present.add(id);
    pipeline.push({
      id,
      step: "Step " + (pipeline.length + 1),
      title: LABELS[id],
      color: 0x2c3148,
      prop: PROPS[id] || ""
    });
  });
  if (pipeline.length === base.pipeline.length) return base;
  return Object.assign({}, base, { pipeline });
}

export function pointsFor(plan) {
  const pipeline = (plan && plan.pipeline) || [];
  const count = Math.max(pipeline.length, 1);
  const start = -((count - 1) / 2);
  const points = {};
  pipeline.forEach((station, index) => {
    points[station.id] = at(start + index, 0);
  });
  points.approval = at(start + 1.55, 1.35);
  if (plan && plan.side) points[plan.side.id] = at(start - 0.15, -6.4);
  if (plan && plan.balcony) points[plan.balcony.id] = at(0.15, 5.6, 1.25);
  points.brand_brain = at(0, 11.2, 3.5);
  points.meetup = at(0, 3.1);
  return points;
}

export function factoryPoints() {
  return pointsFor(hqPlan());
}

export function factoryBounds(points) {
  const spots = Object.values(points || factoryPoints());
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  spots.forEach((spot) => {
    minX = Math.min(minX, spot.x - 3.4);
    maxX = Math.max(maxX, spot.x + 3.4);
    minZ = Math.min(minZ, spot.z - 3.4);
    maxZ = Math.max(maxZ, spot.z + 3.4);
  });
  return { minX, maxX, minZ, maxZ };
}

export function screenOrder(point) {
  return point.x * RIGHT.x + point.z * RIGHT.z;
}

export function setterHome(agent, plan, businessId) {
  const name = String((agent && agent.name) || "").trim().toLowerCase();
  if (name === "onboarding & client success" || name === "onboarding prompt builder") return "overseer";
  if (businessId && agent && agent.id === businessId) return "qualify";
  const ids = planIds(plan);
  if (agent && ids.has(agent.station)) return agent.station;
  const hq = homeStation(agent);
  if (hq && ids.has(hq)) return hq;
  if (ids.has("qualify")) return "qualify";
  const first = plan && plan.pipeline && plan.pipeline[0];
  return (first && first.id) || "qualify";
}

export function inferSetterStation(task) {
  const text = ((task && task.title) || "") + " " + ((task && task.description) || "");
  const hay = text.toLowerCase();
  if (/report|recap|summary/.test(hay)) return "report";
  if (/follow/.test(hay)) return "follow_up";
  if (/book|call|calendar/.test(hay)) return "book_call";
  if (/qualif/.test(hay)) return "qualify";
  if (/inbox|lead|\bdm\b/.test(hay)) return "leads_in";
  return "";
}

export function setterTaskStation(task, agent, plan, businessId) {
  if (task && KNOWN.has(task.station)) return task.station;
  const inferred = inferSetterStation(task);
  const ids = planIds(plan);
  if (inferred && ids.has(inferred)) return inferred;
  return setterHome(agent, plan, businessId);
}

export function setterCardSpot(task, agent, plan, businessId) {
  if (!task || task.status === "done") return "";
  if (task.status === "needs_diego") return "approval";
  return setterTaskStation(task, agent, plan, businessId) || "";
}
