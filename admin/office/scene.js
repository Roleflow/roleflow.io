import { smoothstep, standupPhase, standupReplay } from "./standup.mjs";

const STEP = 8.5;
const ROOM = 6.05;
const WALL_H = 0.98;
const WALL_T = 0.16;
const RING = [[0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1]];

let threePromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-hq-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1" || (src.endsWith("three.min.js") && window.THREE) || (src.endsWith("OrbitControls.js") && window.THREE && window.THREE.OrbitControls)) {
        existing.dataset.loaded = "1";
        resolve();
      } else {
        existing.addEventListener("load", () => resolve(), { once: true });
      }
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.dataset.hqSrc = src;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error("Could not load the 3D office."));
    document.head.append(script);
  });
}

function loadThree() {
  if (window.THREE && window.THREE.OrbitControls) return Promise.resolve(window.THREE);
  if (!threePromise) {
    threePromise = (async () => {
      await loadScript("/admin/hq/vendor/three.min.js");
      await loadScript("/admin/hq/vendor/OrbitControls.js");
      if (!window.THREE || !window.THREE.OrbitControls) throw new Error("Three.js did not load.");
      return window.THREE;
    })();
  }
  return threePromise;
}

function hexOf(color) {
  return /^#[0-9a-fA-F]{6}$/.test(color || "") ? parseInt(color.slice(1), 16) : 0xff7a18;
}

function mix(hex, amount) {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  const base = [46, 54, 72];
  const channel = (c, i) => Math.round(base[i] * (1 - amount) + c * amount);
  return (channel(r, 0) << 16) + (channel(g, 1) << 8) + channel(b, 2);
}

function doorOf(col, row) {
  if (col === 0 && row === 0) return "s";
  if (Math.abs(col) >= Math.abs(row)) return col > 0 ? "w" : "e";
  return row > 0 ? "n" : "s";
}

function inwardOf(door) {
  if (door === "e") return { x: 1, z: 0 };
  if (door === "w") return { x: -1, z: 0 };
  if (door === "n") return { x: 0, z: -1 };
  return { x: 0, z: 1 };
}

function yawOf(x, z) {
  return Math.atan2(x, z);
}

function pointOn(path, t) {
  const lengths = [];
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    const len = Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    lengths.push(len);
    total += len;
  }
  if (total <= 0) return { x: path[0].x, z: path[0].z, dx: 0, dz: 1 };
  let remain = Math.min(1, Math.max(0, t)) * total;
  for (let i = 1; i < path.length; i += 1) {
    const len = lengths[i - 1];
    if (remain <= len || i === path.length - 1) {
      const u = len === 0 ? 0 : Math.min(1, remain / len);
      return {
        x: path[i - 1].x + (path[i].x - path[i - 1].x) * u,
        z: path[i - 1].z + (path[i].z - path[i - 1].z) * u,
        dx: path[i].x - path[i - 1].x,
        dz: path[i].z - path[i - 1].z
      };
    }
    remain -= len;
  }
  const last = path[path.length - 1];
  return { x: last.x, z: last.z, dx: 0, dz: 1 };
}

function gridTexture(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#2a3142";
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = "#46506c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0.5);
  ctx.lineTo(64, 0.5);
  ctx.moveTo(0.5, 0);
  ctx.lineTo(0.5, 64);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export async function createScene(host, hooks) {
  const THREE = await loadThree();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  if (!renderer.getContext()) {
    renderer.dispose();
    throw new Error("WebGL is not available.");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x0a1226, 1);
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1226);
  const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 400);
  camera.position.set(42, 36, 42);
  camera.lookAt(0, 0, 0);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.4, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = 0.78;
  controls.maxPolarAngle = 1.12;
  controls.minZoom = 0.55;
  controls.maxZoom = 2.8;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xfff6ea, 0x1a2233, 0.88));
  const sun = new THREE.DirectionalLight(0xfff8f0, 0.72);
  sun.position.set(-16, 28, 10);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xc9d4ea, 0.28);
  fill.position.set(12, 10, -16);
  scene.add(fill);

  const geos = new Map();
  const mats = new Map();
  const owned = new Set();
  const boxGeo = (w, h, d) => {
    const key = w + "x" + h + "x" + d;
    if (!geos.has(key)) {
      const geo = new THREE.BoxGeometry(w, h, d);
      geos.set(key, geo);
      owned.add(geo);
    }
    return geos.get(key);
  };
  const lambert = (color) => {
    const key = String(color);
    if (!mats.has(key)) {
      const mat = new THREE.MeshLambertMaterial({ color });
      mats.set(key, mat);
      owned.add(mat);
    }
    return mats.get(key);
  };
  const box = (w, h, d, mat) => new THREE.Mesh(boxGeo(w, h, d), mat);
  const put = (mesh, x, y, z) => {
    mesh.position.set(x, y, z);
    return mesh;
  };

  const wallMat = lambert(0xe7d3b3);
  const deskMat = lambert(0x2f6b56);
  const deskLeg = lambert(0x1b2430);
  const bezel = lambert(0x141820);
  const potMat = lambert(0xc47a45);
  const leafMat = lambert(0x3aaa55);
  const leafMat2 = lambert(0x2c8a48);
  const cabMat = lambert(0xd8c09a);
  const cabDark = lambert(0xb08960);
  const chairMat = lambert(0x6d4c32);
  const pantsMat = lambert(0x2a3144);
  const skinMat = lambert(0xf2c7a4);
  const hairMat = lambert(0x2b211c);
  const shoeMat = lambert(0x1b1e27);
  const eyeMat = lambert(0x1a1a1a);
  const skirtMat = lambert(0x1c2230);

  const people = new Map();
  let built = [];
  let pickables = [];
  let builtKey = "";
  let frame = 0;
  let stopped = false;
  let replayStart = 0;
  let replaying = false;
  let loopReader = () => false;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clock = new THREE.Clock();
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const projector = new THREE.Vector3();
  let down = null;

  function addPick(object, id) {
    object.userData.pick = id;
    pickables.push(object);
  }

  function clearBuilt() {
    built.forEach((object) => scene.remove(object));
    built = [];
    pickables = [];
    people.clear();
  }

  function walls(parent, door, openings) {
    const y = WALL_H / 2 + 0.1;
    const len = ROOM;
    const doorW = 1.85;
    const side = (len - doorW) / 2;
    const open = (dir) => door === dir || (openings && openings.includes(dir));
    const segX = (width, x, z) => parent.add(put(box(width, WALL_H, WALL_T, wallMat), x, y, z));
    const segZ = (depth, x, z) => parent.add(put(box(WALL_T, WALL_H, depth, wallMat), x, y, z));
    if (open("n")) {
      segX(side, -(doorW + side) / 2, -ROOM / 2);
      segX(side, (doorW + side) / 2, -ROOM / 2);
    } else segX(len + WALL_T, 0, -ROOM / 2);
    if (open("s")) {
      segX(side, -(doorW + side) / 2, ROOM / 2);
      segX(side, (doorW + side) / 2, ROOM / 2);
    } else segX(len + WALL_T, 0, ROOM / 2);
    if (open("w")) {
      segZ(side, -ROOM / 2, -(doorW + side) / 2);
      segZ(side, -ROOM / 2, (doorW + side) / 2);
    } else segZ(len, -ROOM / 2, 0);
    if (open("e")) {
      segZ(side, ROOM / 2, -(doorW + side) / 2);
      segZ(side, ROOM / 2, (doorW + side) / 2);
    } else segZ(len, ROOM / 2, 0);
  }

  function plant(parent, x, z) {
    parent.add(put(box(0.42, 0.32, 0.42, potMat), x, 0.28, z));
    parent.add(put(new THREE.Mesh(new THREE.SphereGeometry(0.34, 7, 6), leafMat), x, 0.72, z));
    parent.add(put(new THREE.Mesh(new THREE.SphereGeometry(0.22, 7, 5), leafMat2), x + 0.22, 0.84, z + 0.08));
    owned.add(parent.children[parent.children.length - 1].geometry);
    owned.add(parent.children[parent.children.length - 2].geometry);
  }

  function cabinet(parent, x, z, rot) {
    const cab = new THREE.Group();
    cab.add(put(box(0.9, 1.05, 0.42, cabMat), 0, 0.62, 0));
    cab.add(put(box(0.78, 0.04, 0.44, cabDark), 0, 0.72, 0));
    cab.add(put(box(0.78, 0.04, 0.44, cabDark), 0, 1.02, 0));
    cab.position.set(x, 0, z);
    cab.rotation.y = rot;
    parent.add(cab);
  }

  function monitors(parent, x, z, inward, color) {
    const screenMat = new THREE.MeshLambertMaterial({ color: 0x102033, emissive: color, emissiveIntensity: 0.72 });
    owned.add(screenMat);
    const across = inward.x === 0;
    const mx = x - inward.x * 0.28;
    const mz = z - inward.z * 0.28;
    const left = put(box(0.62, 0.42, 0.05, screenMat), mx + (across ? 0 : 0.38), 1.08, mz + (across ? -0.38 : 0));
    const right = put(box(0.5, 0.36, 0.05, screenMat), mx + (across ? 0 : -0.36), 1.02, mz + (across ? 0.36 : 0));
    const stand = put(box(0.08, 0.22, 0.08, bezel), mx, 0.84, mz);
    [left, right].forEach((mesh) => {
      mesh.position.x += inward.x * 0.06;
      mesh.position.z += inward.z * 0.06;
      if (!across) mesh.rotation.y = Math.PI / 2;
      const frame = put(box(mesh === left ? 0.7 : 0.58, mesh === left ? 0.5 : 0.44, 0.07, bezel), mesh.position.x - inward.x * 0.06, mesh.position.y, mesh.position.z - inward.z * 0.06);
      if (!across) frame.rotation.y = Math.PI / 2;
      parent.add(frame);
      parent.add(mesh);
    });
    parent.add(stand);
  }

  function deskAt(parent, x, z, inward) {
    const across = inward.x === 0;
    const top = put(box(across ? 1.7 : 0.9, 0.08, across ? 0.9 : 1.7, deskMat), x, 0.74, z);
    parent.add(top);
    [[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]].forEach(([lx, lz]) => {
      const px = x + (across ? lx : lz);
      const pz = z + (across ? lz : lx);
      parent.add(put(box(0.08, 0.66, 0.08, deskLeg), px, 0.38, pz));
    });
    parent.add(put(box(0.34, 0.03, 0.16, bezel), x + inward.x * 0.12, 0.8, z + inward.z * 0.12));
  }

function makeChair() {
  const g = new THREE.Group();
  g.add(put(box(0.5, 0.08, 0.48, chairMat), 0, 0.42, -0.02));
  g.add(put(box(0.5, 0.46, 0.08, chairMat), 0, 0.68, -0.26));
  return g;
}

function makeSitter(color) {
  const g = new THREE.Group();
  const shirt = lambert(color);
  g.add(put(box(0.16, 0.14, 0.4, pantsMat), -0.12, 0.52, 0.2));
    g.add(put(box(0.16, 0.14, 0.4, pantsMat), 0.12, 0.52, 0.2));
    g.add(put(box(0.15, 0.34, 0.15, pantsMat), -0.12, 0.28, 0.38));
    g.add(put(box(0.15, 0.34, 0.15, pantsMat), 0.12, 0.28, 0.38));
    g.add(put(box(0.16, 0.08, 0.22, shoeMat), -0.12, 0.08, 0.42));
    g.add(put(box(0.16, 0.08, 0.22, shoeMat), 0.12, 0.08, 0.42));
    g.add(put(box(0.48, 0.46, 0.28, shirt), 0, 0.86, 0));
    g.add(put(box(0.32, 0.3, 0.3, skinMat), 0, 1.26, 0.02));
    g.add(put(box(0.34, 0.1, 0.32, hairMat), 0, 1.42, 0));
    g.add(put(box(0.06, 0.06, 0.03, eyeMat), -0.07, 1.28, 0.17));
    g.add(put(box(0.06, 0.06, 0.03, eyeMat), 0.07, 1.28, 0.17));
    const armL = new THREE.Group();
    armL.position.set(-0.32, 1.0, 0.08);
    armL.add(put(box(0.12, 0.12, 0.36, shirt), 0, -0.08, 0.16));
    const armR = new THREE.Group();
    armR.position.set(0.32, 1.0, 0.08);
    armR.add(put(box(0.12, 0.12, 0.36, shirt), 0, -0.08, 0.16));
    g.add(armL, armR);
    g.userData.arms = [armL, armR];
    return g;
  }

  function limb(y, x, side) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const upper = put(box(0.14, 0.42, 0.16, pantsMat), 0, -0.2, 0);
    const shin = new THREE.Group();
    shin.position.y = -0.4;
    shin.add(put(box(0.14, 0.38, 0.15, pantsMat), 0, -0.16, 0));
    shin.add(put(box(0.15, 0.08, 0.24, shoeMat), 0, -0.36, 0.05));
    pivot.add(upper, shin);
    pivot.userData.shin = shin;
    pivot.userData.side = side;
    return pivot;
  }

  function makeWalker(color) {
    const g = new THREE.Group();
    const shirt = lambert(color);
    const legL = limb(0.84, -0.12, "l");
    const legR = limb(0.84, 0.12, "r");
    const torso = put(box(0.46, 0.5, 0.26, shirt), 0, 1.12, 0);
    const head = put(box(0.32, 0.3, 0.3, skinMat), 0, 1.54, 0);
    const hair = put(box(0.34, 0.1, 0.32, hairMat), 0, 1.7, 0);
    const eyeL = put(box(0.06, 0.06, 0.03, eyeMat), -0.07, 1.56, 0.16);
    const eyeR = put(box(0.06, 0.06, 0.03, eyeMat), 0.07, 1.56, 0.16);
    const armL = new THREE.Group();
    armL.position.set(-0.32, 1.28, 0);
    armL.add(put(box(0.12, 0.42, 0.12, shirt), 0, -0.2, 0));
    const armR = new THREE.Group();
    armR.position.set(0.32, 1.28, 0);
    armR.add(put(box(0.12, 0.42, 0.12, shirt), 0, -0.2, 0));
    g.add(legL, legR, torso, head, hair, eyeL, eyeR, armL, armR);
    g.userData.joints = { legL, legR, armL, armR };
    return g;
  }

  function furnishRoom(parent, inward, color) {
    const dx = -inward.x * 1.65;
    const dz = -inward.z * 1.65;
    deskAt(parent, dx, dz, inward);
    monitors(parent, dx, dz, inward, color);
    const side = inward.x === 0 ? { x: 2.15, z: 0 } : { x: 0, z: 2.15 };
    plant(parent, side.x, -side.z * 0.2 + inward.z);
    const cabRot = inward.x === 0 ? Math.PI / 2 : 0;
    cabinet(parent, -side.x, inward.z * 0.2, cabRot);
  }

  function layout(agents) {
    const inside = agents.filter((agent) => !agent.outside);
    const outside = agents.filter((agent) => agent.outside);
    const placed = [];
    inside.forEach((agent, index) => {
      if (index < RING.length) placed.push({ agent, col: RING[index][0], row: RING[index][1] });
      else placed.push({ agent, col: 2, row: (index - RING.length) % 3 - 1 });
    });
    const overflow = Math.max(0, inside.length - RING.length);
    outside.forEach((agent, index) => {
      const slot = overflow + index;
      placed.push({ agent, col: 2 + Math.floor(slot / 3), row: (slot % 3) - 1 });
    });
    return placed;
  }

  function build(agents) {
    clearBuilt();
    const placed = layout(agents);
    const spots = placed.map((item) => ({
      x: item.col * STEP,
      z: item.row * STEP
    }));
    spots.push({ x: 0, z: 0 });
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    spots.forEach((spot) => {
      minX = Math.min(minX, spot.x - ROOM / 2 - 0.4);
      maxX = Math.max(maxX, spot.x + ROOM / 2 + 0.4);
      minZ = Math.min(minZ, spot.z - ROOM / 2 - 0.4);
      maxZ = Math.max(maxZ, spot.z + ROOM / 2 + 0.4);
    });
    const width = Math.max(STEP, maxX - minX);
    const depth = Math.max(STEP, maxZ - minZ);
    const tex = gridTexture(THREE);
    tex.repeat.set(width, depth);
    owned.add(tex);
    const hallMat = new THREE.MeshLambertMaterial({ map: tex });
    owned.add(hallMat);
    const hall = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), hallMat);
    owned.add(hall.geometry);
    hall.rotation.x = -Math.PI / 2;
    hall.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    scene.add(hall);
    built.push(hall);

    const meeting = new THREE.Group();
    meeting.position.y = 0;
    meeting.add(put(box(ROOM + 0.12, 0.05, ROOM + 0.12, skirtMat), 0, 0.04, 0));
    const meetFloor = put(box(ROOM, 0.08, ROOM, lambert(0x343c50)), 0, 0.09, 0);
    meeting.add(meetFloor);
    walls(meeting, "n", ["n", "s", "e", "w"]);
    const rugGeo = new THREE.CylinderGeometry(2.15, 2.15, 0.04, 28);
    owned.add(rugGeo);
    meeting.add(put(new THREE.Mesh(rugGeo, lambert(0x3e4a63)), 0, 0.15, 0));
    meeting.add(put(box(0.72, 0.78, 0.72, wallMat), 0, 0.52, 0));
    meeting.add(put(box(0.96, 0.1, 0.96, lambert(0xf4e7d2)), 0, 0.96, 0));
    const orbMat = new THREE.MeshLambertMaterial({
      color: 0xff8a3d,
      emissive: 0xc0409a,
      emissiveIntensity: 1.35,
      transparent: true,
      opacity: 0.72,
      depthWrite: false
    });
    const glowMat = new THREE.MeshLambertMaterial({
      color: 0xff8a3d,
      emissive: 0xff4d8d,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.16,
      depthWrite: false
    });
    owned.add(orbMat);
    owned.add(glowMat);
    const orbGeo = new THREE.SphereGeometry(0.48, 28, 18);
    const glowGeo = new THREE.SphereGeometry(0.86, 24, 16);
    owned.add(orbGeo);
    owned.add(glowGeo);
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.y = 1.52;
    orb.name = "orb";
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.y = 1.52;
    meeting.add(orb, glow);
    const ringGeo = new THREE.TorusGeometry(0.34, 0.035, 8, 24);
    owned.add(ringGeo);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshLambertMaterial({ color: 0xff8a3d, emissive: 0xc0409a, emissiveIntensity: 0.8 }));
    owned.add(ring.material);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.08;
    meeting.add(ring);
    const lamp = new THREE.PointLight(0xff7a4a, 1.35, 11, 2);
    lamp.position.set(0, 1.7, 0);
    meeting.add(lamp);
    plant(meeting, 2.15, 2.05);
    addPick(meeting, "meeting");
    scene.add(meeting);
    built.push(meeting);

    const walking = agents.filter((agent) => agent.work !== "paused");
    placed.forEach((item) => {
      const door = doorOf(item.col, item.row);
      const inward = inwardOf(door);
      const color = hexOf(item.agent.color);
      const room = new THREE.Group();
      room.position.set(item.col * STEP, 0, item.row * STEP);
      room.add(put(box(ROOM + 0.1, 0.05, ROOM + 0.1, skirtMat), 0, 0.04, 0));
      room.add(put(box(ROOM, 0.08, ROOM, lambert(mix(color, 0.22))), 0, 0.09, 0));
      walls(room, door);
      furnishRoom(room, inward, color);
      const seat = { x: -inward.x * 0.72, z: -inward.z * 0.72 };
      const facing = yawOf(-inward.x, -inward.z);
      const chair = makeChair();
      chair.position.set(seat.x, 0, seat.z);
      chair.rotation.y = facing;
      room.add(chair);
      const sitter = makeSitter(color);
      sitter.position.set(seat.x, 0, seat.z);
      sitter.rotation.y = facing;
      room.add(sitter);
      addPick(room, item.agent.id);
      scene.add(room);
      built.push(room);

      const walker = makeWalker(color);
      walker.position.set(room.position.x + seat.x, 0, room.position.z + seat.z);
      walker.visible = false;
      addPick(walker, item.agent.id);
      scene.add(walker);
      built.push(walker);

      const seatWorld = { x: room.position.x + seat.x, z: room.position.z + seat.z };
      const pace = { x: room.position.x + inward.x * 0.35, z: room.position.z + inward.z * 0.35 };
      const attend = walking.findIndex((agent) => agent.id === item.agent.id);
      const angle = walking.length ? -Math.PI / 2 + (attend / walking.length) * Math.PI * 2 : 0;
      const slot = { x: Math.cos(angle) * 2.05, z: Math.sin(angle) * 2.05 };
      const doorPoint = {
        x: room.position.x + inward.x * (ROOM * 0.46),
        z: room.position.z + inward.z * (ROOM * 0.46)
      };
      const hallPoint = {
        x: room.position.x + inward.x * (STEP * 0.5),
        z: room.position.z + inward.z * (STEP * 0.5)
      };
      const path = [seatWorld, { x: room.position.x, z: room.position.z }, doorPoint, hallPoint];
      if (Math.hypot(room.position.x, room.position.z) > STEP * 1.35) {
        path.push({ x: Math.sign(room.position.x) * STEP * 0.5, z: room.position.z * 0.2 });
      }
      path.push({ x: slot.x * 0.25 + inward.x * ROOM * 0.2, z: slot.z * 0.25 + inward.z * ROOM * 0.2 }, slot);
      people.set(item.agent.id, {
        id: item.agent.id,
        work: item.agent.work,
        sitter,
        walker,
        seat: seatWorld,
        pace,
        face: yawOf(-inward.x, -inward.z),
        path,
        slot,
        anchor: { x: room.position.x, y: 2.55, z: room.position.z }
      });
    });
    people.set("meeting", {
      id: "meeting",
      anchor: { x: 0, y: 3.05, z: 0 }
    });
  }

  function phaseNow(elapsed) {
    if (loopReader()) return standupReplay(elapsed % 16);
    if (replaying) {
      const replayElapsed = (performance.now() - replayStart) / 1000;
      if (replayElapsed >= 16) replaying = false;
      else return standupReplay(replayElapsed);
    }
    return standupPhase(new Date());
  }

  function applyPose(person, phase, elapsed) {
    if (!person.walker) return;
    const paused = person.work === "paused";
    let mode = paused ? "desk" : phase.mode;
    if (reduceMotion && mode !== "desk") mode = "meet";
    const typing = person.work === "active";
    const pacing = person.work === "clear" && mode === "desk";
    let x = person.seat.x;
    let z = person.seat.z;
    let face = person.face;
    let sitting = true;
    if (mode === "to" || mode === "back") {
      sitting = false;
      const t = mode === "to" ? smoothstep(phase.t) : 1 - smoothstep(phase.t);
      const point = pointOn(person.path, t);
      x = point.x;
      z = point.z;
      if (point.dx || point.dz) face = yawOf(mode === "back" ? -point.dx : point.dx, mode === "back" ? -point.dz : point.dz);
    } else if (mode === "meet") {
      sitting = false;
      const bob = Math.sin(elapsed * 2 + person.slot.x) * 0.05;
      x = person.slot.x + bob;
      z = person.slot.z;
      face = yawOf(-person.slot.x, -person.slot.z);
    } else if (pacing) {
      sitting = false;
      const swing = (Math.sin(elapsed * 0.65 + person.seat.x) + 1) / 2;
      x = person.seat.x + (person.pace.x - person.seat.x) * swing;
      z = person.seat.z + (person.pace.z - person.seat.z) * swing;
      face = yawOf(person.pace.x - person.seat.x, person.pace.z - person.seat.z);
    }
    person.sitter.visible = sitting;
    person.walker.visible = !sitting;
    if (sitting) {
      const arms = person.sitter.userData.arms || [];
      const wave = typing ? Math.sin(elapsed * 9) * 0.35 : 0;
      if (arms[0]) arms[0].rotation.x = wave;
      if (arms[1]) arms[1].rotation.x = -wave * 0.8;
      return;
    }
    person.walker.position.set(x, 0, z);
    person.walker.rotation.y = face;
    const step = Math.sin(elapsed * 7.2);
    const joints = person.walker.userData.joints;
    if (!joints) return;
    const moving = mode !== "meet";
    joints.legL.rotation.x = moving ? step * 0.7 : 0;
    joints.legR.rotation.x = moving ? -step * 0.7 : 0;
    joints.armL.rotation.x = moving ? -step * 0.5 : Math.sin(elapsed * 1.5) * 0.08;
    joints.armR.rotation.x = moving ? step * 0.5 : -Math.sin(elapsed * 1.5) * 0.08;
  }

  function projectLabels() {
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    const labels = [];
    people.forEach((person) => {
      projector.set(person.anchor.x, person.anchor.y, person.anchor.z);
      projector.project(camera);
      labels.push({
        id: person.id,
        x: (projector.x * 0.5 + 0.5) * width,
        y: (-projector.y * 0.5 + 0.5) * height,
        visible: projector.z < 1
      });
    });
    return labels;
  }

  function resize() {
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    renderer.setSize(width, height, false);
    const view = 19.5;
    const aspect = width / Math.max(height, 1);
    camera.left = -view * aspect;
    camera.right = view * aspect;
    camera.top = view;
    camera.bottom = -view;
    camera.updateProjectionMatrix();
  }

  function pickAt(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(pointer, camera);
    const hits = ray.intersectObjects(pickables, true);
    for (const hit of hits) {
      let object = hit.object;
      while (object) {
        if (object.userData && object.userData.pick) return object.userData.pick;
        object = object.parent;
      }
    }
    return "";
  }

  function onDown(event) {
    down = { x: event.clientX, y: event.clientY, id: pickAt(event) };
  }

  function onUp(event) {
    if (!down) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    const id = down.id;
    down = null;
    if (moved < 6 && id && hooks.onSelect) hooks.onSelect(id);
  }

  function animate() {
    if (stopped) return;
    frame = requestAnimationFrame(animate);
    const elapsed = clock.getElapsedTime();
    const phase = phaseNow(elapsed);
    const orb = scene.getObjectByName("orb");
    if (orb) {
      const pulse = 1 + Math.sin(elapsed * 2.1) * 0.06;
      orb.scale.setScalar(pulse);
      if (orb.parent) orb.parent.children.forEach((child) => {
        if (child.material && child.material.opacity && child.geometry && child.geometry.type === "SphereGeometry" && child !== orb) {
          child.scale.setScalar(1 + Math.sin(elapsed * 2.1) * 0.04);
        }
      });
    }
    people.forEach((person) => applyPose(person, phase, elapsed));
    controls.update();
    renderer.render(scene, camera);
    if (hooks.onFrame) hooks.onFrame({ labels: projectLabels(), phase });
    window.__officePhase = phase;
  }

  const observer = new ResizeObserver(() => resize());
  observer.observe(host);
  const onWindowResize = () => resize();
  window.addEventListener("resize", onWindowResize);
  requestAnimationFrame(() => resize());
  renderer.domElement.addEventListener("pointerdown", onDown);
  window.addEventListener("pointerup", onUp);
  resize();

  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";

  const handle = {
    update(agents) {
      const key = agents.map((agent) => agent.id + (agent.outside ? ":o" : ":i") + ":" + agent.color).join("|");
      if (key !== builtKey) {
        build(agents);
        builtKey = key;
      }
      agents.forEach((agent) => {
        const person = people.get(agent.id);
        if (person) person.work = agent.work;
      });
    },
    replay() {
      replaying = true;
      replayStart = performance.now();
    },
    setLoop(reader) {
      loopReader = reader;
    },
    zoom(factor) {
      camera.zoom = Math.min(controls.maxZoom, Math.max(controls.minZoom, camera.zoom * factor));
      camera.updateProjectionMatrix();
    },
    destroy() {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", onWindowResize);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      controls.dispose();
      owned.forEach((item) => {
        if (item && item.dispose) item.dispose();
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      if (local && window.__officeProject) window.__officeProject = null;
    }
  };

  if (local) {
    window.__officeProject = (id) => {
      const person = people.get(id);
      if (!person) return null;
      projector.set(person.anchor.x, 0.4, person.anchor.z);
      projector.project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return {
        x: rect.left + (projector.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-projector.y * 0.5 + 0.5) * rect.height
      };
    };
  }

  build([]);
  renderer.render(scene, camera);
  animate();
  window.__officeReady = true;
  return handle;
}
