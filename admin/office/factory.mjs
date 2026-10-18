export const STATIONS = [
  "research",
  "writers_room",
  "film_studio",
  "edit_bay",
  "shipping_dock",
  "client_floor",
  "chief_of_staff"
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

export function factoryPoints() {
  return {
    research: at(-2, 0),
    writers_room: at(-1, 0),
    approval: at(-0.45, 1.35),
    film_studio: at(0, 0),
    edit_bay: at(1, 0),
    shipping_dock: at(2, 0),
    client_floor: at(-2.15, -6.4),
    chief_of_staff: at(0.15, 5.6, 1.25),
    brand_brain: at(0, 11.2, 3.5),
    meetup: at(0, 3.1)
  };
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
