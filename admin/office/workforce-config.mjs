// Per-business AI Workforce office.
//
// Phase 1 stores one template in this file. loadOfficeConfig is the only
// read path. Phase 2 should replace that function with a Supabase read and
// leave the renderer alone. The scene paints whatever this object names:
// overseer, Brand Brain, stations, descriptions, and Next-step edges.

const ID_RE = /^[a-z][a-z0-9_]*$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const VAM_BUSINESS_ID = "463e2794-cb8f-462e-9325-95a7cb1da65c";

export const DEFAULT_OFFICE_CONFIG = {
  id: "default",
  overseer: {
    id: "overseer",
    role: "Chief of Staff",
    description: "Sends each station its next task and watches the handoffs.",
    color: "#ff2d95",
    taskStations: ["overseer"]
  },
  brandBrain: {
    id: "brand_brain",
    role: "Brand Brain",
    description: "Prompt version and the last time it was updated.",
    color: "#ff4d8d"
  },
  stations: [
    {
      id: "dm_setter",
      role: "DM Setter",
      description: "Instagram DMs, then qualify and book.",
      color: "#ff4d8d",
      taskStations: ["leads_in", "qualify", "book_call"],
      workforceRole: "setting",
      metric: "instagram_dm"
    },
    {
      id: "follow_ups",
      role: "Follow-ups",
      description: "Quiet threads get another note.",
      color: "#c040ff",
      taskStations: ["follow_up"],
      workforceRole: "follow_up",
      metric: "followups"
    },
    {
      id: "outreach",
      role: "Outreach",
      description: "Starts new conversations.",
      color: "#ff8a3d",
      taskStations: ["outreach"],
      workforceRole: "outreach",
      metric: "workforce"
    },
    {
      id: "target_comments",
      role: "Target Comments",
      description: "Comments on target posts. No live source yet.",
      color: "#7a4dff",
      taskStations: ["target_comments"],
      workforceRole: "target_comments",
      metric: "comments_inbound"
    },
    {
      id: "stats",
      role: "Stats Tracking",
      description: "Reads totals from every station.",
      color: "#4d9dff",
      taskStations: ["report"],
      workforceRole: "",
      metric: "stats"
    }
  ],
  edges: [
    { from: "overseer", to: "dm_setter", kind: "assign", label: "Next step: DM Setter" },
    { from: "overseer", to: "follow_ups", kind: "assign", label: "Next step: Follow-ups" },
    { from: "overseer", to: "outreach", kind: "assign", label: "Next step: Outreach" },
    { from: "overseer", to: "target_comments", kind: "assign", label: "Next step: Target Comments" },
    { from: "overseer", to: "stats", kind: "assign", label: "Next step: Stats Tracking" },
    { from: "outreach", to: "dm_setter", kind: "handoff", label: "Next step: DM Setter" },
    { from: "dm_setter", to: "follow_ups", kind: "handoff", label: "Next step: Follow-ups" },
    { from: "outreach", to: "stats", kind: "read", label: "Next step: Stats Tracking" },
    { from: "dm_setter", to: "stats", kind: "read", label: "Next step: Stats Tracking" },
    { from: "follow_ups", to: "stats", kind: "read", label: "Next step: Stats Tracking" },
    { from: "target_comments", to: "stats", kind: "read", label: "Next step: Stats Tracking" }
  ]
};

function clone(value) {
  return structuredClone(value);
}

function text(value) {
  return String(value == null ? "" : value).trim();
}

function requireText(value, path, errors) {
  const clean = text(value);
  if (!clean) errors.push(path + " is required.");
  return clean;
}

function requireId(value, path, errors) {
  const clean = requireText(value, path, errors);
  if (clean && !ID_RE.test(clean)) errors.push(path + " must be a lowercase id.");
  return clean;
}

function normalizeNode(raw, path, errors) {
  const node = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) errors.push(path + " must be an object.");
  const color = text(node.color);
  if (color && !COLOR_RE.test(color)) errors.push(path + ".color must be a #rrggbb color.");
  const taskStations = Array.isArray(node.taskStations) ? node.taskStations.map((item) => text(item)).filter(Boolean) : [];
  if (node.taskStations != null && !Array.isArray(node.taskStations)) errors.push(path + ".taskStations must be a list.");
  taskStations.forEach((station, index) => {
    if (!ID_RE.test(station)) errors.push(path + ".taskStations[" + index + "] must be a lowercase id.");
  });
  return {
    id: requireId(node.id, path + ".id", errors),
    role: requireText(node.role, path + ".role", errors),
    description: requireText(node.description, path + ".description", errors),
    color: color || "#ff4d8d",
    taskStations,
    workforceRole: text(node.workforceRole),
    metric: text(node.metric) || "none"
  };
}

export function validateOfficeConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ok: false, errors: ["Config must be an object."] };
  }
  const overseer = normalizeNode(config.overseer, "overseer", errors);
  const brandBrain = normalizeNode(config.brandBrain, "brandBrain", errors);
  if (!Array.isArray(config.stations) || !config.stations.length) errors.push("stations must be a non-empty list.");
  const stations = (Array.isArray(config.stations) ? config.stations : []).map((station, index) => normalizeNode(station, "stations[" + index + "]", errors));
  const ids = new Set();
  const claim = (id, path) => {
    if (!id) return;
    if (ids.has(id)) errors.push(path + " duplicates id " + id + ".");
    ids.add(id);
  };
  claim(overseer.id, "overseer.id");
  claim(brandBrain.id, "brandBrain.id");
  stations.forEach((station, index) => claim(station.id, "stations[" + index + "].id"));
  if (!Array.isArray(config.edges)) errors.push("edges must be a list.");
  const seenEdges = new Set();
  const edges = (Array.isArray(config.edges) ? config.edges : []).map((edge, index) => {
    const path = "edges[" + index + "]";
    const from = requireId(edge && edge.from, path + ".from", errors);
    const to = requireId(edge && edge.to, path + ".to", errors);
    const label = requireText(edge && edge.label, path + ".label", errors);
    const kind = text(edge && edge.kind) || "route";
    if (from && to && from === to) errors.push(path + " cannot point at itself.");
    if (from && !ids.has(from)) errors.push(path + ".from is not a station.");
    if (to && !ids.has(to)) errors.push(path + ".to is not a station.");
    const key = from + ">" + to;
    if (from && to && seenEdges.has(key)) errors.push(path + " duplicates " + key + ".");
    seenEdges.add(key);
    return { from, to, kind, label };
  });
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    value: {
      id: text(config.id) || "default",
      overseer,
      brandBrain,
      stations,
      edges
    }
  };
}

// Code default for an office that has no saved row. readOffice in
// office-editor.mjs is the phase 2 read: it loads a saved config and falls
// back to this template when the office tables are not there yet.
export async function loadOfficeConfig(businessId) {
  void businessId;
  return clone(DEFAULT_OFFICE_CONFIG);
}

function polar(deg, radius) {
  const rad = deg * Math.PI / 180;
  return { x: Math.cos(rad) * radius, z: Math.sin(rad) * radius };
}

// Behind the ring and above the desk signs. A full-size sign in the middle
// sits under the Chief of Staff. This spot keeps both the default floor and
// a 7-station floor clear without pulling the camera back.
function brainPlacement() {
  return { x: -4.5, z: -10, signY: 7.2, signH: 1.9, signW: 4 };
}

export const SIGN_WIDTH = 5.6;
export const SIGN_HEIGHT = 2.34;
export const SIGN_HALF_WIDTH = SIGN_WIDTH / 2;
const STATION_SIGN_Y = 3.15;
const BRAIN_SIGN_Y = 3.15;
const TAG_HEIGHT = 20;
const SIDEBAR_WIDTH = 248;

// The readout is position:absolute; left:12px; width:min(300px, 100% - 24px);
// bottom:64px; max-height:36%. At a 1440 window the stage is 1192px wide,
// so the panel is 300px and the content gutter is its right edge plus 8px.
export const READOUT_LEFT = 12;
export const READOUT_WIDTH = 300;
export const READOUT_BOTTOM = 64;
export const READOUT_MAX_HEIGHT = 0.36;

export function canvasForWindow(windowWidth, windowHeight) {
  const width = windowWidth > 760 ? windowWidth - SIDEBAR_WIDTH : windowWidth;
  return { width, height: windowHeight, portrait: windowHeight > windowWidth };
}

export function readoutRect(canvas) {
  const height = Math.min(canvas.height * READOUT_MAX_HEIGHT, canvas.height - READOUT_BOTTOM);
  return {
    x: READOUT_LEFT,
    y: canvas.height - READOUT_BOTTOM - height,
    w: Math.min(READOUT_WIDTH, canvas.width - 24),
    h: height
  };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function norm(v) {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function addScaled(origin, dir, scale) {
  return { x: origin.x + dir.x * scale, y: origin.y + dir.y * scale, z: origin.z + dir.z * scale };
}

export function workforceSignNodes(layout) {
  const nodes = [];
  const push = (node, fallbackY) => {
    if (!node || !node.id) return;
    const signY = Number.isFinite(node.signY) ? node.signY : fallbackY;
    const signH = Number.isFinite(node.signH) ? node.signH : SIGN_HEIGHT;
    const signW = Number.isFinite(node.signW) ? node.signW : SIGN_WIDTH;
    nodes.push({
      id: node.id,
      role: node.role || node.id,
      x: node.x || 0,
      z: node.z || 0,
      signY,
      signH,
      signW,
      anchorY: signY + signH / 2 + 0.03
    });
  };
  (layout.seats || []).forEach((seat) => push(seat, STATION_SIGN_Y));
  push(layout.overseer, STATION_SIGN_Y);
  push(layout.brain, BRAIN_SIGN_Y);
  return nodes;
}

function cameraBasis(camera, target) {
  const look = norm(sub(target, camera));
  const right = norm(cross(look, { x: 0, y: 1, z: 0 }));
  const up = cross(right, look);
  return { look, right, up };
}

function projectPoint(point, camera, basis, canvas) {
  const fov = 32 * Math.PI / 180;
  const f = 1 / Math.tan(fov / 2);
  const aspect = canvas.width / Math.max(canvas.height, 1);
  const rel = sub(point, camera);
  const vx = dot(rel, basis.right);
  const vy = dot(rel, basis.up);
  const vz = dot(rel, basis.look);
  const ndcX = (vx / vz) * (f / aspect);
  const ndcY = (vy / vz) * f;
  return {
    x: (ndcX * 0.5 + 0.5) * canvas.width,
    y: (-ndcY * 0.5 + 0.5) * canvas.height
  };
}

function signAxes(node, camera) {
  const toCam = norm({ x: camera.x - node.x, y: 0, z: camera.z - node.z });
  const right = norm(cross({ x: 0, y: 1, z: 0 }, toCam));
  return { right, up: { x: 0, y: 1, z: 0 } };
}

function rectOf(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function overlaps(a, b) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0.5 && oy > 0.5;
}

function tagBox(role) {
  return { w: labelBox(role).w, h: TAG_HEIGHT };
}

// Desktop pills use translate(-50%, -130%) and may nudge up to 18px.
function separateDesktopTags(tags) {
  const items = tags.map((tag) => ({
    id: tag.id,
    x: tag.anchorX,
    y: tag.anchorY,
    ox: tag.anchorX,
    oy: tag.anchorY,
    w: tag.w,
    h: tag.h
  }));
  const limit = 18;
  for (let pass = 0; pass < 8; pass += 1) {
    let moved = false;
    for (let i = 0; i < items.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        const a = items[i];
        const b = items[j];
        const overlapX = (a.w + b.w) / 2 + 6 - Math.abs(a.x - b.x);
        const overlapY = (a.h + b.h) / 2 + 4 - Math.abs(a.y - b.y);
        if (overlapX <= 0 || overlapY <= 0) continue;
        if (overlapY <= overlapX) a.y += (a.y >= b.y ? 1 : -1) * Math.min(overlapY, 6);
        else a.x += (a.x >= b.x ? 1 : -1) * Math.min(overlapX, 6);
        a.x = Math.max(a.ox - limit, Math.min(a.ox + limit, a.x));
        a.y = Math.max(a.oy - limit, Math.min(a.oy + limit, a.y));
        moved = true;
      }
    }
    if (!moved) break;
  }
  return items.map((item) => ({
    id: item.id,
    x: item.x - item.w / 2,
    y: item.y - item.h * 1.3,
    w: item.w,
    h: item.h
  }));
}

function fitSamples(nodes, camera) {
  const samples = [];
  nodes.forEach((node) => {
    const axes = signAxes(node, camera);
    const center = { x: node.x, y: node.signY, z: node.z };
    samples.push({ x: node.x, y: 0.2, z: node.z });
    [-1, 1].forEach((side) => {
      [-1, 1].forEach((vert) => {
        samples.push({
          x: center.x + axes.right.x * (node.signW / 2) * side,
          y: center.y + vert * (node.signH / 2),
          z: center.z + axes.right.z * (node.signW / 2) * side
        });
      });
    });
  });
  return samples;
}

function cameraFor(target, distance) {
  const dir = norm({ x: 1, y: 0.78, z: 1 });
  return addScaled(target, dir, distance);
}

// Landscape framing. Portrait keeps the scene's existing phone fit.
export function projectWorkforce(layout, canvas) {
  const width = canvas.width;
  const height = canvas.height;
  const nodes = workforceSignNodes(layout);
  const target = { x: 0, y: 0.8, z: 0 };
  const left = READOUT_LEFT + Math.min(READOUT_WIDTH, width - 24) + 8;
  const right = 8;
  const top = 150;
  const bottom = 72;
  let lo = 10;
  let hi = 220;
  let best = 220;
  for (let step = 0; step < 22; step += 1) {
    const distance = (lo + hi) / 2;
    const camera = cameraFor(target, distance);
    const basis = cameraBasis(camera, target);
    const samples = fitSamples(nodes, camera);
    let fits = true;
    for (let i = 0; i < samples.length; i += 1) {
      const point = projectPoint(samples[i], camera, basis, canvas);
      if (point.x < left || point.x > width - right || point.y < top || point.y > height - bottom) {
        fits = false;
        break;
      }
    }
    if (fits) {
      best = distance;
      hi = distance;
    } else lo = distance;
  }
  const camera = cameraFor(target, best);
  const basis = cameraBasis(camera, target);
  const signs = nodes.map((node) => {
    const axes = signAxes(node, camera);
    const center = { x: node.x, y: node.signY, z: node.z };
    const corners = [-1, 1].flatMap((side) => [-1, 1].map((vert) => projectPoint({
      x: center.x + axes.right.x * (node.signW / 2) * side,
      y: center.y + vert * (node.signH / 2),
      z: center.z + axes.right.z * (node.signW / 2) * side
    }, camera, basis, canvas)));
    return Object.assign({ id: node.id, role: node.role }, rectOf(corners));
  });
  const tags = separateDesktopTags(nodes.map((node) => {
    const anchor = projectPoint({ x: node.x, y: node.anchorY, z: node.z }, camera, basis, canvas);
    const box = tagBox(node.role);
    return { id: node.id, anchorX: anchor.x, anchorY: anchor.y, w: box.w, h: box.h };
  }));
  const seats = nodes.map((node) => {
    const point = projectPoint({ x: node.x, y: 0.2, z: node.z }, camera, basis, canvas);
    return { id: node.id, x: point.x, y: point.y };
  });
  return { distance: best, signs, tags, seats, readout: readoutRect(canvas) };
}

export function workforceFrameFits(frame, canvas) {
  const boxes = frame.signs.map((box) => Object.assign({ kind: "sign" }, box))
    .concat(frame.tags.map((box) => Object.assign({ kind: "tag" }, box)));
  for (let i = 0; i < boxes.length; i += 1) {
    const box = boxes[i];
    if (box.x < -0.01 || box.y < -0.01) return false;
    if (box.x + box.w > canvas.width + 0.01 || box.y + box.h > canvas.height + 0.01) return false;
    if (overlaps(box, frame.readout)) return false;
    for (let j = i + 1; j < boxes.length; j += 1) {
      const other = boxes[j];
      if (box.id === other.id && box.kind !== other.kind) continue;
      if (overlaps(box, other)) return false;
    }
  }
  return frame.seats.every((seat) => seat.x >= frame.readout.x + frame.readout.w - 0.01);
}

export function layoutOffice(config) {
  const stations = (config && config.stations) || [];
  const count = Math.max(stations.length, 1);
  const radius = 6.4 + count * 0.9;
  const seats = stations.map((station, index) => {
    const angle = -90 + (360 / count) * index;
    const spot = polar(angle, radius);
    return Object.assign({}, station, { x: spot.x, y: 0, z: spot.z, angle });
  });
  const overseer = Object.assign({}, config.overseer, { x: 0, y: 0.55, z: 1.35, center: true });
  const brainSpot = brainPlacement();
  const brain = Object.assign({}, config.brandBrain, {
    x: brainSpot.x,
    y: 1.85,
    z: brainSpot.z,
    signY: brainSpot.signY,
    signH: brainSpot.signH,
    signW: brainSpot.signW
  });
  const points = {};
  seats.forEach((seat) => {
    points[seat.id] = { x: seat.x, y: seat.y, z: seat.z };
  });
  points[overseer.id] = { x: overseer.x, y: overseer.y, z: overseer.z };
  points[brain.id] = { x: brain.x, y: brain.y, z: brain.z };
  return {
    radius,
    seats,
    overseer,
    brain,
    points,
    edges: (config.edges || []).map((edge) => Object.assign({}, edge))
  };
}

export function labelBox(role) {
  const width = Math.min(180, Math.ceil(String(role || "").length * 7 + 22));
  return { w: Math.max(64, width), h: 24 };
}

// Phone chips. Wrapped rows, centered, pinned to the bottom of the stage
// when there is room. The boxes are the ones the 390px tests measure.
export function fitLabels(layout, viewport) {
  const width = Math.max(1, Number(viewport && viewport.width) || 1);
  const height = Math.max(1, Number(viewport && viewport.height) || 1);
  const pad = 8;
  const gap = 4;
  const items = [];
  const push = (node) => {
    if (!node || !node.id) return;
    const size = labelBox(node.role || node.id);
    items.push({ id: node.id, role: node.role || node.id, w: size.w, h: size.h });
  };
  if (layout) {
    push(layout.brain);
    push(layout.overseer);
    (layout.seats || []).forEach(push);
  }
  const rows = [];
  let row = [];
  let rowW = 0;
  const inner = Math.max(0, width - pad * 2);
  items.forEach((item) => {
    const next = rowW + (row.length ? gap : 0) + item.w;
    if (row.length && next > inner) {
      rows.push(row);
      row = [];
      rowW = 0;
    }
    const used = (row.length ? gap : 0) + item.w;
    row.push(item);
    rowW += used;
  });
  if (row.length) rows.push(row);
  const rowH = 24;
  const totalH = rows.length ? rows.length * rowH + (rows.length - 1) * gap : 0;
  let y = Math.max(pad, height - pad - totalH);
  const placed = [];
  rows.forEach((line) => {
    const used = line.reduce((sum, item, index) => sum + item.w + (index ? gap : 0), 0);
    let x = Math.max(pad, Math.floor((width - used) / 2));
    line.forEach((item) => {
      placed.push({ id: item.id, role: item.role, x, y, w: item.w, h: item.h });
      x += item.w + gap;
    });
    y += rowH + gap;
  });
  return placed;
}

export function labelsFit(boxes, viewport) {
  const width = Number(viewport && viewport.width) || 0;
  const height = Number(viewport && viewport.height) || 0;
  const list = boxes || [];
  for (let i = 0; i < list.length; i += 1) {
    const box = list[i];
    if (box.x < -0.01 || box.y < -0.01) return false;
    if (box.x + box.w > width + 0.01 || box.y + box.h > height + 0.01) return false;
    for (let j = i + 1; j < list.length; j += 1) {
      const other = list[j];
      const overlapX = Math.min(box.x + box.w, other.x + other.w) - Math.max(box.x, other.x);
      const overlapY = Math.min(box.y + box.h, other.y + other.h) - Math.max(box.y, other.y);
      if (overlapX > 0.5 && overlapY > 0.5) return false;
    }
  }
  return list.length > 0;
}

export function officeConfigWithStations(count) {
  const total = Math.max(1, count | 0);
  const stations = [];
  for (let index = 0; index < total; index += 1) {
    const n = index + 1;
    stations.push({
      id: "station_" + n,
      role: n === 1 ? "Target Comments" : "Station " + n,
      description: "Job " + n + " in this office.",
      color: "#ff4d8d",
      taskStations: [],
      workforceRole: "",
      metric: "none"
    });
  }
  const edges = [];
  stations.forEach((station) => {
    edges.push({
      from: "overseer",
      to: station.id,
      kind: "assign",
      label: "Next step: " + station.role
    });
  });
  for (let index = 0; index < stations.length - 1; index += 1) {
    edges.push({
      from: stations[index].id,
      to: stations[index + 1].id,
      kind: "handoff",
      label: "Next step: " + stations[index + 1].role
    });
  }
  return {
    id: "sample-" + total,
    overseer: {
      id: "overseer",
      role: "Chief of Staff",
      description: "Sends the next task."
    },
    brandBrain: {
      id: "brand_brain",
      role: "Brand Brain",
      description: "Prompt version for this business."
    },
    stations,
    edges
  };
}

function roleOf(config, id) {
  if (config.overseer && config.overseer.id === id) return config.overseer.role;
  if (config.brandBrain && config.brandBrain.id === id) return config.brandBrain.role;
  const station = (config.stations || []).find((item) => item.id === id);
  return station ? station.role : id;
}

export function routeSummary(config) {
  const edges = (config && config.edges) || [];
  const handoffs = edges.filter((edge) => edge.kind === "handoff");
  const chain = [];
  if (handoffs.length) {
    const incoming = new Set(handoffs.map((edge) => edge.to));
    let cursor = handoffs.find((edge) => !incoming.has(edge.from)) || handoffs[0];
    const guard = new Set();
    while (cursor && !guard.has(cursor.from + ">" + cursor.to)) {
      guard.add(cursor.from + ">" + cursor.to);
      if (!chain.length) chain.push(roleOf(config, cursor.from));
      chain.push(roleOf(config, cursor.to));
      cursor = handoffs.find((edge) => edge.from === cursor.to);
    }
  }
  const reads = edges.filter((edge) => edge.kind === "read");
  const parts = [];
  if (chain.length) parts.push(chain.join(" → "));
  if (reads.length) {
    const target = roleOf(config, reads[0].to);
    const sources = new Set(reads.map((edge) => edge.from));
    const workers = (config.stations || []).filter((station) => station.id !== reads[0].to);
    const all = workers.length > 0 && workers.every((station) => sources.has(station.id));
    parts.push((all ? "all" : reads.map((edge) => roleOf(config, edge.from)).join(", ")) + " → " + target);
  }
  return parts.join(" · ");
}
