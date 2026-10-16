const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";

// Cells are a plus on the grid. (0, 1) is empty so another agent room can be added later.
const CELLS = [
  { id: "hub", gx: 0, gz: 0 },
  { id: "outreach", gx: 0, gz: -1 },
  { id: "follow_up", gx: -1, gz: 0 },
  { id: "setting", gx: 1, gz: 0 }
];

const CELL = 4.8;
const HALF = CELL / 2;
const WALL_H = 1.08;
const WALL_T = 0.42;
const DOOR = 1.6;

export async function mountOffice(stage, spec) {
  const THREE = await import(THREE_URL);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = new THREE.Group();
  const overlay = document.createElement("div");
  overlay.className = "office-overlay";
  overlay.addEventListener("open-role", (event) => spec.onOpen(event.detail));
  stage.append(overlay);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  if (!renderer.getContext()) throw new Error("webgl");
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x0a1226, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.domElement.setAttribute("aria-hidden", "true");
  stage.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(root);
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 80);
  camera.position.set(20, 20, 20);
  camera.lookAt(0, 0.15, 0);

  scene.add(new THREE.AmbientLight(0xfff3e2, 0.46));
  scene.add(new THREE.HemisphereLight(0x243049, 0xe6c79a, 0.42));
  const sun = new THREE.DirectionalLight(0xfff6ea, 0.72);
  sun.position.set(8, 14, 10);
  scene.add(sun);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x12141a, roughness: 0.92, metalness: 0 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xe6c79a, roughness: 0.84, metalness: 0 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0xb5814a, roughness: 0.7, metalness: 0 });
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x1a1c24, roughness: 0.72, metalness: 0.04 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x16181f, roughness: 0.6, metalness: 0.08 });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xc0409a,
    emissive: 0xc0409a,
    emissiveIntensity: 1.35,
    roughness: 0.28,
    metalness: 0.04
  });

  const takenEdges = new Set();
  const takenPosts = new Set();
  const occupied = new Set(CELLS.map((cell) => cell.gx + "," + cell.gz));

  CELLS.forEach((cell) => {
    const ox = cell.gx * CELL;
    const oz = cell.gz * CELL;
    const tile = new THREE.Mesh(new THREE.BoxGeometry(CELL - 0.06, 0.2, CELL - 0.06), floorMat);
    tile.position.set(ox, -0.1, oz);
    if (cell.id !== "hub") tile.userData.roleId = cell.id;
    root.add(tile);
    const corners = [
      [ox - HALF, oz - HALF],
      [ox + HALF, oz - HALF],
      [ox + HALF, oz + HALF],
      [ox - HALF, oz + HALF]
    ];
    const neighbors = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (let i = 0; i < 4; i += 1) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      const key = edgeKey(a[0], a[1], b[0], b[1]);
      addPost(a[0], a[1]);
      if (takenEdges.has(key)) continue;
      takenEdges.add(key);
      const next = neighbors[i];
      const shared = occupied.has((cell.gx + next[0]) + "," + (cell.gz + next[1]));
      addWall(a[0], a[1], b[0], b[1], shared);
    }
  });

  const core = new THREE.Group();
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.46, 8), darkMat);
  pillar.position.y = 0.23;
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 12), accentMat);
  sphere.position.y = 0.72;
  core.add(pillar, sphere);
  root.add(core);
  const coreLight = new THREE.PointLight(0xc0409a, 36, 18, 2);
  coreLight.position.set(0, 0.9, 0);
  root.add(coreLight);
  const rings = [0, 1, 2].map((index) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.55, 48),
      new THREE.MeshBasicMaterial({ color: 0xc0409a, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    ring.userData.phase = index / 3;
    root.add(ring);
    return ring;
  });

  const agents = spec.agents.map((agent) => buildAgent(THREE, agent));
  agents.forEach((agent) => root.add(agent.rig));

  const hubPanel = panelElement("Meeting room", "Queue", spec.queue, spec.queueFooter, null);
  overlay.append(hubPanel);
  const hubAnchor = new THREE.Vector3(0.15, 0.2, 2.15);
  const hubLabel = document.createElement("div");
  hubLabel.className = "room-label";
  hubLabel.textContent = "Meeting room";
  overlay.append(hubLabel);

  const clock = new THREE.Clock();
  let nextWalk = 7.5;
  let alive = true;
  const projected = new THREE.Vector3();
  const head = new THREE.Vector3();

  function resize() {
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const radius = CELL * 2.2;
    let halfH = radius;
    let halfW = halfH * aspect;
    if (halfW < radius) {
      halfW = radius;
      halfH = halfW / aspect;
    }
    const pad = aspect < 1 ? 1.18 : 1.04;
    halfH *= pad;
    halfW *= pad;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
  }

  const observer = new ResizeObserver(() => resize());
  observer.observe(stage);
  resize();

  renderer.domElement.addEventListener("pointerup", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const hits = raycaster.intersectObjects(root.children, true);
    for (const hit of hits) {
      let node = hit.object;
      while (node) {
        if (node.userData && node.userData.roleId) {
          spec.onOpen(node.userData.roleId);
          return;
        }
        node = node.parent;
      }
    }
  });

  function frame() {
    if (!alive || !stage.isConnected) {
      alive = false;
      observer.disconnect();
      renderer.dispose();
      renderer.forceContextLoss();
      return;
    }
    const dt = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.elapsedTime;
    if (!reduce) {
      rings.forEach((ring) => {
        const cycle = (elapsed * 0.18 + ring.userData.phase) % 1;
        const scale = 1 + cycle * 11;
        ring.scale.setScalar(scale);
        ring.material.opacity = 0.5 * (1 - cycle);
      });
      if (elapsed > nextWalk) {
        const idle = agents.filter((agent) => agent.status === "active" && agent.mode === "sit");
        if (idle.length) {
          const pick = idle[Math.floor(Math.random() * idle.length)];
          pick.mode = "rise";
          pick.modeT = 0;
        }
        nextWalk = elapsed + 9 + Math.random() * 3;
      }
    } else {
      rings.forEach((ring, index) => {
        ring.scale.setScalar(2.2 + index * 1.4);
        ring.material.opacity = 0.22;
      });
    }
    agents.forEach((agent) => stepAgent(agent, dt, elapsed, reduce));
    renderer.render(scene, camera);
    place(hubLabel, new THREE.Vector3(0, 1.35, 0), "-50%", "-130%");
    place(hubPanel, hubAnchor, "-50%", "-50%");
    agents.forEach((agent) => {
      agent.head.getWorldPosition(head);
      place(agent.pill, head, "-50%", "-125%");
      place(agent.panel, agent.panelAnchor, "-50%", "-40%");
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function place(node, world, xShift, yShift) {
    projected.copy(world).project(camera);
    const x = (projected.x * 0.5 + 0.5) * stage.clientWidth;
    const y = (-projected.y * 0.5 + 0.5) * stage.clientHeight;
    node.style.transform = "translate(" + xShift + ", " + yShift + ")";
    node.style.left = x + "px";
    node.style.top = y + "px";
  }

  function stepAgent(agent, dt, elapsed, still) {
    if (agent.mode === "rise") {
      agent.modeT += dt;
      agent.sit = Math.max(0, 1 - agent.modeT / 0.35);
      if (agent.sit === 0) {
        agent.mode = "to-hub";
        agent.modeT = 0;
      }
    } else if (agent.mode === "to-hub" || agent.mode === "to-home") {
      const target = agent.mode === "to-hub" ? agent.hub : agent.home;
      const offset = target.clone().sub(agent.rig.position);
      const dist = offset.length();
      const step = 2.15 * dt;
      if (dist <= step) {
        agent.rig.position.copy(target);
        agent.mode = agent.mode === "to-hub" ? "hold" : "lower";
        agent.modeT = 0;
      } else {
        offset.multiplyScalar(step / dist);
        agent.rig.position.add(offset);
        agent.rig.rotation.y = Math.atan2(offset.x, offset.z);
      }
      agent.walk += dt * 8;
    } else if (agent.mode === "hold") {
      agent.modeT += dt;
      agent.walk += dt * 4;
      if (agent.modeT > 0.45) {
        agent.mode = "to-home";
        agent.modeT = 0;
      }
    } else if (agent.mode === "lower") {
      agent.modeT += dt;
      agent.sit = Math.min(1, agent.modeT / 0.35);
      agent.rig.position.copy(agent.home);
      agent.rig.rotation.y = agent.homeYaw;
      if (agent.sit === 1) agent.mode = "sit";
    } else {
      agent.rig.position.copy(agent.home);
      agent.rig.rotation.y = agent.homeYaw;
      agent.sit = 1;
    }
    const typing = still || agent.status !== "active" ? 0 : elapsed * 7 + agent.phase;
    const walking = agent.mode === "to-hub" || agent.mode === "to-home" || agent.mode === "hold" || agent.mode === "rise";
    applyPose(agent, walking ? agent.walk : typing);
    const dim = agent.status !== "active";
    agent.body.color.copy(agent.base).multiplyScalar(dim ? 0.32 : 1);
    agent.screen.emissiveIntensity = dim ? 0.04 : 0.85 + Math.sin(elapsed * 2.4 + agent.phase) * 0.4;
    agent.screenLight.intensity = dim ? 0 : 1.4;
    const busy = agent.status === "active" && agent.mode !== "sit";
    if (agent.pill.dataset.busy !== String(busy)) agent.pill.dataset.busy = busy ? "true" : "false";
    const bob = walking && agent.sit < 0.2 ? Math.abs(Math.sin(agent.walk * 2)) * 0.05 : 0;
    agent.rig.position.y = bob - agent.sit * 0.08;
  }

  function setStatus(id, status) {
    const agent = agents.find((item) => item.id === id);
    if (!agent) return;
    agent.status = status;
    agent.pill.dataset.status = status;
    const dot = agent.pill.querySelector(".dot");
    if (dot) dot.className = status === "active" ? "dot on" : "dot";
    if (status !== "active" && agent.mode !== "sit" && agent.mode !== "lower") {
      agent.mode = "to-home";
      agent.modeT = 0;
    }
  }

  function edgeKey(x1, z1, x2, z2) {
    const a = round(x1) + "," + round(z1);
    const b = round(x2) + "," + round(z2);
    return a < b ? a + "|" + b : b + "|" + a;
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function addPost(x, z) {
    const key = round(x) + "," + round(z);
    if (takenPosts.has(key)) return;
    takenPosts.add(key);
    const post = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, WALL_H, WALL_T), wallMat);
    post.position.set(x, WALL_H / 2, z);
    root.add(post);
  }

  function addWall(x1, z1, x2, z2, open) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const inset = WALL_T * 0.45;
    const gap = open ? DOOR : 0;
    const usable = len - inset * 2;
    const startX = x1 + ux * inset;
    const startZ = z1 + uz * inset;
    const endX = x2 - ux * inset;
    const endZ = z2 - uz * inset;
    if (gap <= 0 || gap >= usable) {
      addSegment(startX, startZ, endX, endZ);
      return;
    }
    const side = (usable - gap) / 2;
    addSegment(startX, startZ, startX + ux * side, startZ + uz * side);
    addSegment(endX - ux * side, endZ - uz * side, endX, endZ);
  }

  function addSegment(x1, z1, x2, z2) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.08) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, WALL_H, len), wallMat);
    mesh.position.set((x1 + x2) / 2, WALL_H / 2, (z1 + z2) / 2);
    mesh.rotation.y = Math.atan2(dx, dz);
    root.add(mesh);
  }

  function buildAgent(three, agent) {
    const gx = agent.gx;
    const gz = agent.gz;
    const ox = gx * CELL;
    const oz = gz * CELL;
    const outX = Math.sign(gx);
    const outZ = Math.sign(gz);
    const seat = new three.Vector3(ox + outX * 0.25, 0, oz + outZ * 0.25);
    const homeYaw = Math.PI / 4 - 0.55;
    const faceX = Math.sin(homeYaw);
    const faceZ = Math.cos(homeYaw);
    const sideX = Math.cos(homeYaw);
    const sideZ = -Math.sin(homeYaw);
    const deskAt = new three.Vector3(seat.x + faceX * 0.92 + sideX * 0.28, 0, seat.z + faceZ * 0.92 + sideZ * 0.28);
    const body = new three.MeshStandardMaterial({ color: agent.color, roughness: 0.42, metalness: 0.05 });
    const rig = buildRobot(three, body);
    rig.userData.roleId = agent.id;
    rig.scale.setScalar(1.12);
    rig.position.copy(seat);
    rig.rotation.y = homeYaw;
    const chair = buildChair(three, chairMat);
    chair.position.copy(seat);
    chair.rotation.y = homeYaw;
    chair.userData.roleId = agent.id;
    const desk = buildDesk(three, woodMat, darkMat);
    desk.group.position.copy(deskAt);
    desk.group.rotation.y = homeYaw + Math.PI;
    desk.group.userData.roleId = agent.id;
    const screenLight = new three.PointLight(0x9ad7ff, 0.8, 3.2, 2);
    screenLight.position.set(0, 0.95, 0.3);
    desk.group.add(screenLight);
    root.add(chair, desk.group);
    agent.onOpen = () => spec.onOpen(agent.id);
    const pill = pillElement(agent);
    const panel = panelElement(agent.room, "", agent.lines, agent.pendingLabel, agent.id);
    overlay.append(pill, panel);
    const headAnchor = new three.Object3D();
    headAnchor.position.set(0, 1.42, 0);
    rig.add(headAnchor);
    const panelAnchor = new three.Vector3(
      ox + (gx < 0 ? -1.55 : gx > 0 ? 1.45 : -0.95),
      0.2,
      oz + (gz < 0 ? -1.45 : 1.25)
    );
    return {
      id: agent.id,
      status: agent.status,
      color: agent.color,
      base: new three.Color(agent.color),
      body,
      screen: desk.screen,
      screenLight,
      rig,
      head: headAnchor,
      pill,
      panel,
      panelAnchor,
      home: seat.clone(),
      hub: hubStand(three, gx, gz),
      homeYaw,
      sit: 1,
      walk: 0,
      mode: "sit",
      modeT: 0,
      phase: agent.phase
    };
  }

  function hubStand(three, gx, gz) {
    if (gz < 0) return new three.Vector3(0.55, 0, -1.05);
    if (gx < 0) return new three.Vector3(-1.05, 0, 0.45);
    return new three.Vector3(1.05, 0, -0.45);
  }

  return {
    setStatus,
    stop() {
      alive = false;
    }
  };
}

function pillElement(agent) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "agent-pill";
  button.dataset.role = agent.id;
  button.dataset.status = agent.status;
  button.dataset.busy = "false";
  const copy = document.createElement("span");
  copy.className = "pill-copy";
  const name = document.createElement("strong");
  name.textContent = agent.name;
  const room = document.createElement("small");
  room.textContent = agent.room;
  copy.append(name, room);
  const status = document.createElement("span");
  status.className = "pill-status";
  const dot = document.createElement("i");
  dot.className = agent.status === "active" ? "dot on" : "dot";
  const wave = document.createElement("span");
  wave.className = "wave";
  wave.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 3; i += 1) wave.append(document.createElement("i"));
  status.append(dot, wave);
  button.append(copy, status);
  button.addEventListener("click", () => agent.onOpen());
  return button;
}

function panelElement(title, kicker, rows, footer, roleId) {
  const panel = document.createElement("div");
  panel.className = "floor-panel";
  if (roleId) panel.dataset.role = roleId;
  const heading = document.createElement("strong");
  heading.textContent = title;
  panel.append(heading);
  if (kicker) {
    const label = document.createElement("span");
    label.className = "panel-kicker";
    label.textContent = kicker;
    panel.append(label);
  }
  const list = document.createElement("ul");
  (rows || []).forEach((row) => {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = row.label;
    const value = document.createElement("b");
    value.textContent = row.value;
    item.append(name, value);
    list.append(item);
  });
  panel.append(list);
  const foot = document.createElement("p");
  foot.className = "panel-foot";
  foot.textContent = footer;
  panel.append(foot);
  if (roleId) {
    panel.tabIndex = 0;
    panel.setAttribute("role", "button");
    panel.addEventListener("click", () => panel.dispatchEvent(new CustomEvent("open-role", { bubbles: true, detail: roleId })));
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        panel.click();
      }
    });
  }
  return panel;
}

function buildRobot(THREE, body) {
  const joint = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.55 });
  const eye = new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.3 });
  const pupil = new THREE.MeshStandardMaterial({ color: 0x16181e });
  const rig = new THREE.Group();
  const torso = mesh(THREE, 0.44, 0.4, 0.28, body);
  torso.position.y = 0.78;
  const chest = mesh(THREE, 0.2, 0.1, 0.04, joint);
  chest.position.set(0, 0.8, 0.14);
  const head = mesh(THREE, 0.38, 0.3, 0.32, body);
  head.position.y = 1.16;
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 6), body);
  antenna.position.y = 1.38;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), body);
  tip.position.y = 1.5;
  rig.add(torso, chest, head, antenna, tip);
  [-0.09, 0.09].forEach((x) => {
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 6), eye);
    white.position.set(x, 1.19, 0.15);
    const dark = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), pupil);
    dark.position.set(x, 1.19, 0.2);
    rig.add(white, dark);
  });
  const smile = mesh(THREE, 0.12, 0.03, 0.03, pupil);
  smile.position.set(0, 1.07, 0.16);
  rig.add(smile);
  const parts = { left: limb(THREE, body, -1), right: limb(THREE, body, 1) };
  rig.add(parts.left.arm, parts.right.arm, parts.left.leg, parts.right.leg);
  rig.userData.parts = parts;
  return rig;
}

function limb(THREE, body, side) {
  const arm = new THREE.Group();
  arm.position.set(side * 0.28, 0.92, 0);
  const upper = mesh(THREE, 0.1, 0.26, 0.1, body);
  upper.position.y = -0.13;
  const elbow = new THREE.Group();
  elbow.position.y = -0.26;
  const fore = mesh(THREE, 0.09, 0.22, 0.09, body);
  fore.position.y = -0.1;
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), body);
  hand.position.y = -0.22;
  elbow.add(fore, hand);
  arm.add(upper, elbow);
  const leg = new THREE.Group();
  leg.position.set(side * 0.11, 0.56, 0);
  const thigh = mesh(THREE, 0.12, 0.26, 0.12, body);
  thigh.position.y = -0.13;
  const knee = new THREE.Group();
  knee.position.y = -0.26;
  const shin = mesh(THREE, 0.11, 0.24, 0.11, body);
  shin.position.y = -0.12;
  const foot = mesh(THREE, 0.12, 0.06, 0.18, body);
  foot.position.set(0, -0.26, 0.04);
  knee.add(shin, foot);
  leg.add(thigh, knee);
  return { arm, elbow, leg, knee };
}

function applyPose(agent, phase) {
  const parts = agent.rig.userData.parts;
  const sit = agent.sit;
  const swing = Math.sin(phase);
  parts.left.leg.rotation.x = sit * -1.15 + (1 - sit) * swing * 0.65;
  parts.right.leg.rotation.x = sit * -1.15 + (1 - sit) * -swing * 0.65;
  parts.left.knee.rotation.x = sit * 1.25 + (1 - sit) * Math.max(0, -swing) * 0.7;
  parts.right.knee.rotation.x = sit * 1.25 + (1 - sit) * Math.max(0, swing) * 0.7;
  parts.left.arm.rotation.z = 0.18;
  parts.right.arm.rotation.z = -0.18;
  parts.left.arm.rotation.x = sit * -0.35 + (1 - sit) * -swing * 0.45;
  parts.right.arm.rotation.x = sit * -0.35 + (1 - sit) * swing * 0.45;
  const typeL = sit > 0.8 && agent.status === "active" ? Math.sin(phase) * 0.22 : 0;
  const typeR = sit > 0.8 && agent.status === "active" ? Math.sin(phase + 1.1) * 0.22 : 0;
  parts.left.elbow.rotation.x = sit * (-1.05 + typeL) + (1 - sit) * -0.25;
  parts.right.elbow.rotation.x = sit * (-1.05 + typeR) + (1 - sit) * -0.25;
}

function buildChair(THREE, material) {
  const group = new THREE.Group();
  const seat = mesh(THREE, 0.5, 0.08, 0.48, material);
  seat.position.y = 0.42;
  const back = mesh(THREE, 0.5, 0.5, 0.08, material);
  back.position.set(0, 0.7, -0.2);
  group.add(seat, back);
  [[-0.18, -0.16], [0.18, -0.16], [-0.18, 0.16], [0.18, 0.16]].forEach(([x, z]) => {
    const leg = mesh(THREE, 0.06, 0.42, 0.06, material);
    leg.position.set(x, 0.21, z);
    group.add(leg);
  });
  return group;
}

function buildDesk(THREE, wood, dark) {
  const group = new THREE.Group();
  const top = mesh(THREE, 1.15, 0.08, 0.62, wood);
  top.position.y = 0.64;
  group.add(top);
  [[-0.46, -0.22], [0.46, -0.22], [-0.46, 0.22], [0.46, 0.22]].forEach(([x, z]) => {
    const leg = mesh(THREE, 0.07, 0.64, 0.07, wood);
    leg.position.set(x, 0.32, z);
    group.add(leg);
  });
  const keys = mesh(THREE, 0.42, 0.03, 0.16, dark);
  keys.position.set(0, 0.7, 0.16);
  const stand = mesh(THREE, 0.08, 0.22, 0.08, dark);
  stand.position.set(0, 0.78, -0.08);
  const bezel = mesh(THREE, 0.52, 0.36, 0.05, dark);
  bezel.position.set(0, 1.05, -0.08);
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x102033,
    emissive: 0x8fd4ff,
    emissiveIntensity: 0.4,
    roughness: 0.25
  });
  const screen = mesh(THREE, 0.42, 0.26, 0.02, screenMat);
  screen.position.set(0, 1.05, -0.045);
  const screenBack = mesh(THREE, 0.42, 0.26, 0.02, screenMat);
  screenBack.position.set(0, 1.05, -0.115);
  group.add(keys, stand, bezel, screen, screenBack);
  return { group, screen: screenMat };
}

function mesh(THREE, width, height, depth, material) {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
}
