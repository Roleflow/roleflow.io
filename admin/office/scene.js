import { factoryBounds, factoryPoints, homeStation, hqPlan, pointsFor } from "./factory.mjs";
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.matchMedia("(max-width: 760px)").matches ? 1.25 : 1.5));
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
  controls.touches.ONE = THREE.TOUCH.PAN;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  controls.update();
  renderer.domElement.style.touchAction = "none";

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
  const errandSpots = {};
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
  let officeBounds = { minX: -STEP, maxX: STEP, minZ: -STEP, maxZ: STEP };
  let layoutPoints = null;
  const narrowQuery = window.matchMedia("(max-width: 760px)");
  const factoryMode = hooks && hooks.layout === "factory";
  const factoryPlan = factoryMode ? ((hooks && hooks.plan) || hqPlan()) : null;
  const cardItems = new Map();
  let approvalMat = null;

  function addPick(object, id) {
    object.userData.pick = id;
    pickables.push(object);
  }

  function clearBuilt() {
    built.forEach((object) => scene.remove(object));
    cardItems.forEach((item) => {
      if (item.mesh) scene.remove(item.mesh);
    });
    cardItems.clear();
    approvalMat = null;
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

  function sign(text, width, height, x, y, z) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 160;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 512, 160);
    ctx.fillStyle = "rgba(12,18,34,0.88)";
    ctx.fillRect(16, 28, 480, 104);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.strokeRect(16.5, 28.5, 479, 103);
    ctx.fillStyle = "#f4f7ff";
    ctx.font = "700 46px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(text || "").slice(0, 42), 256, 80);
    const tex = new THREE.CanvasTexture(canvas);
    owned.add(tex);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    owned.add(mat);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    owned.add(mesh.geometry);
    mesh.position.set(x, y, z);
    mesh.lookAt(camera.position.x, mesh.position.y, camera.position.z);
    return mesh;
  }

  function placeProp(prop, spot) {
    if (prop === "research") {
      const watch = sign("Competitor Watch", 2.2, 0.42, spot.x - 1.2, 0.7, spot.z + 1.15);
      const reader = sign("Transcript Reader", 2.2, 0.42, spot.x + 1.15, 0.7, spot.z + 1.15);
      scene.add(watch, reader);
      built.push(watch, reader);
      return;
    }
    if (prop === "studio") {
      const ringMat = new THREE.MeshLambertMaterial({ color: 0xfff1d2, emissive: 0xfff4e0, emissiveIntensity: 0.55 });
      owned.add(ringMat);
      const ringGeo = new THREE.TorusGeometry(0.72, 0.06, 10, 28);
      owned.add(ringGeo);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(spot.x + 0.85, 1.85, spot.z - 0.15);
      ring.rotation.x = Math.PI / 2.4;
      scene.add(ring);
      built.push(ring);
      const you = new THREE.Group();
      you.position.set(spot.x + 0.85, 0, spot.z + 0.15);
      you.add(put(box(0.7, 0.06, 0.7, lambert(0xe8b04a)), 0, 0.12, 0));
      you.add(sign("You", 1.1, 0.4, 0, 0.85, 0));
      addPick(you, "diego");
      scene.add(you);
      built.push(you);
      const shelf = new THREE.Group();
      shelf.position.set(spot.x - 1.35, 0, spot.z + 0.2);
      shelf.add(put(box(0.9, 1.15, 0.28, lambert(0x8d6a45)), 0, 0.7, 0));
      shelf.add(put(box(0.72, 0.08, 0.22, lambert(0xf4efe4)), 0, 0.95, 0.08));
      shelf.add(put(box(0.72, 0.08, 0.22, lambert(0xd7c4ff)), 0, 0.72, 0.08));
      shelf.add(put(box(0.72, 0.08, 0.22, lambert(0xf7f3ea)), 0, 0.5, 0.08));
      shelf.add(sign("Script Library", 1.8, 0.4, 0, 1.55, 0));
      scene.add(shelf);
      built.push(shelf);
      return;
    }
    if (prop === "edit") {
      const ratio = sign("1 in, 10 out", 1.8, 0.42, spot.x, 0.85, spot.z + 1.2);
      scene.add(ratio);
      built.push(ratio);
      return;
    }
    if (prop === "shipping") {
      const crates = new THREE.Group();
      crates.position.set(spot.x + 1.15, 0, spot.z + 0.4);
      crates.add(put(box(0.55, 0.45, 0.45, lambert(0xc9844a)), 0, 0.3, 0));
      crates.add(put(box(0.4, 0.35, 0.4, lambert(0x8d6a45)), 0.45, 0.25, 0.2));
      crates.add(put(box(0.48, 0.4, 0.42, lambert(0xd8c09a)), -0.15, 0.28, 0.45));
      crates.add(sign("Your Posts", 1.7, 0.42, 0.1, 1.05, 0));
      scene.add(crates);
      built.push(crates);
      return;
    }
    if (prop === "inbox") {
      const tray = new THREE.Group();
      tray.position.set(spot.x + 1.1, 0, spot.z + 0.35);
      tray.add(put(box(0.9, 0.12, 0.7, lambert(0x8d6a45)), 0, 0.2, 0));
      tray.add(put(box(0.7, 0.04, 0.5, lambert(0xf7f3ea)), 0, 0.32, 0));
      tray.add(put(box(0.55, 0.04, 0.4, lambert(0xd7c4ff)), 0.05, 0.38, 0));
      tray.add(sign("DM inbox", 1.6, 0.4, 0, 0.9, 0));
      scene.add(tray);
      built.push(tray);
      return;
    }
    if (prop === "handset") {
      const phone = new THREE.Group();
      phone.position.set(spot.x + 1.05, 0, spot.z + 0.4);
      phone.add(put(box(0.28, 0.12, 0.7, lambert(0x1b2430)), 0, 0.35, 0));
      phone.add(put(box(0.22, 0.1, 0.22, lambert(0x141820)), 0, 0.48, 0.22));
      scene.add(phone);
      built.push(phone);
      return;
    }
    if (prop === "notes") {
      const notes = new THREE.Group();
      notes.position.set(spot.x + 1.0, 0, spot.z + 0.45);
      notes.add(put(box(0.55, 0.04, 0.7, lambert(0xf7f3ea)), 0, 0.3, 0));
      notes.add(put(box(0.55, 0.04, 0.7, lambert(0xffe4f0)), 0.2, 0.36, 0.12));
      scene.add(notes);
      built.push(notes);
      return;
    }
    if (prop === "chart") {
      const board = new THREE.Group();
      board.position.set(spot.x + 1.15, 0, spot.z + 0.2);
      board.add(put(box(1.1, 0.9, 0.08, lambert(0x1b2430)), 0, 0.85, 0));
      board.add(put(box(0.16, 0.35, 0.06, lambert(0xff8a3d)), -0.28, 0.7, 0.08));
      board.add(put(box(0.16, 0.55, 0.06, lambert(0x3dbe6a)), 0, 0.8, 0.08));
      board.add(put(box(0.16, 0.75, 0.06, lambert(0x7a8cff)), 0.28, 0.9, 0.08));
      scene.add(board);
      built.push(board);
    }
  }

  function buildFactory(agents) {
    const plan = factoryPlan || hqPlan();
    const points = pointsFor(plan);
    layoutPoints = points;
    officeBounds = factoryBounds(points);
    const floorW = officeBounds.maxX - officeBounds.minX + 2;
    const floorD = officeBounds.maxZ - officeBounds.minZ + 2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorD), lambert(0x141a2c));
    owned.add(floor.geometry);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((officeBounds.minX + officeBounds.maxX) / 2, 0, (officeBounds.minZ + officeBounds.maxZ) / 2);
    scene.add(floor);
    built.push(floor);

    const pipeline = plan.pipeline || [];
    pipeline.forEach((station) => {
      const spot = points[station.id];
      const pad = new THREE.Group();
      pad.position.set(spot.x, 0, spot.z);
      pad.add(put(box(4.4, 0.08, 3.3, lambert(station.color || 0x2a3d55)), 0, 0.06, 0));
      pad.add(put(box(1.55, 0.08, 0.7, deskMat), 0.2, 0.7, 0.45));
      pad.add(sign(station.step || "Step", 1.5, 0.42, -1.15, 1.55, -1.15));
      pad.add(sign(station.title || station.id, 2.5, 0.55, 0.35, 1.7, -1.25));
      scene.add(pad);
      built.push(pad);
      if (station.prop) placeProp(station.prop, spot);
    });

    for (let i = 0; i < pipeline.length - 1; i += 1) {
      const from = points[pipeline[i].id];
      const to = points[pipeline[i + 1].id];
      const mid = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 };
      const arrow = new THREE.Group();
      arrow.position.set(mid.x, 0.2, mid.z);
      arrow.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
      arrow.add(put(box(0.16, 0.08, 1.35, lambert(0xff8a3d)), 0, 0, 0));
      arrow.add(put(box(0.42, 0.08, 0.28, lambert(0xff8a3d)), 0, 0, 0.72));
      arrow.add(sign("Next step:", 1.7, 0.42, 0, 0.55, 0));
      scene.add(arrow);
      built.push(arrow);
    }

    const approval = points.approval;
    const gate = new THREE.Group();
    gate.position.set(approval.x, 0, approval.z);
    approvalMat = new THREE.MeshLambertMaterial({ color: 0xff4d8d, emissive: 0xff4d8d, emissiveIntensity: 0.2 });
    owned.add(approvalMat);
    gate.add(put(box(0.16, 1.35, 0.16, approvalMat), -0.7, 0.75, 0));
    gate.add(put(box(0.16, 1.35, 0.16, approvalMat), 0.7, 0.75, 0));
    gate.add(put(box(1.7, 0.16, 0.16, approvalMat), 0, 1.4, 0));
    gate.add(sign("Your Approval", 2.2, 0.46, 0, 1.85, 0));
    scene.add(gate);
    built.push(gate);

    if (plan.side && points[plan.side.id]) {
      const client = points[plan.side.id];
      const clientPad = new THREE.Group();
      clientPad.position.set(client.x, 0, client.z);
      clientPad.add(put(box(4.6, 0.08, 3.4, lambert(plan.side.color || 0x2c3148)), 0, 0.06, 0));
      clientPad.add(sign(plan.side.title || "Client Floor", 2.3, 0.5, 0, 1.55, -1.2));
      scene.add(clientPad);
      built.push(clientPad);
    }

    let balcony = null;
    const balconyId = plan.balcony && plan.balcony.id;
    if (balconyId && points[balconyId]) {
      const chief = points[balconyId];
      balcony = new THREE.Group();
      balcony.position.set(chief.x, 0, chief.z);
      balcony.add(put(box(5.4, 0.22, 2.5, lambert(0x243049)), 0, 1.15, 0));
      [[-2.3, -1], [2.3, -1], [-2.3, 1], [2.3, 1]].forEach(([x, z]) => {
        balcony.add(put(box(0.16, 1.15, 0.16, lambert(0x8d6a45)), x, 0.55, z));
      });
      balcony.add(sign(plan.balcony.label || "Overseer, on the balcony", 3.4, 0.48, 0, 2.15, 0));
      scene.add(balcony);
      built.push(balcony);
    }

    const brainPoint = points.brand_brain;
    const brain = new THREE.Group();
    brain.position.set(brainPoint.x, brainPoint.y, brainPoint.z);
    const orbMat = new THREE.MeshLambertMaterial({
      color: 0xff8a3d,
      emissive: 0xc0409a,
      emissiveIntensity: 1.2,
      transparent: true,
      opacity: 0.92
    });
    const glowMat = new THREE.MeshLambertMaterial({
      color: 0xff8a3d,
      emissive: 0xff4d8d,
      emissiveIntensity: 0.7,
      transparent: true,
      opacity: 0.18,
      depthWrite: false
    });
    owned.add(orbMat);
    owned.add(glowMat);
    const orbGeo = new THREE.SphereGeometry(1.55, 28, 18);
    const glowGeo = new THREE.SphereGeometry(2.15, 24, 16);
    owned.add(orbGeo);
    owned.add(glowGeo);
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.name = "orb";
    const glow = new THREE.Mesh(glowGeo, glowMat);
    brain.add(orb, glow);
    brain.add(sign("Brand Brain", 2.2, 0.48, 0, 1.7, 0));
    if (plan.brainSub) brain.add(sign(plan.brainSub, 2.2, 0.4, 0, 2.25, 0));
    addPick(brain, "brand-brain");
    scene.add(brain);
    built.push(brain);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xff8ad0, transparent: true, opacity: 0.35 });
    owned.add(lineMat);
    const lineIds = pipeline.map((station) => station.id);
    if (balconyId) lineIds.push(balconyId);
    if (plan.side) lineIds.push(plan.side.id);
    lineIds.forEach((id) => {
      const spot = points[id];
      if (!spot) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute([
        brainPoint.x, brainPoint.y, brainPoint.z,
        spot.x, 0.4, spot.z
      ], 3));
      owned.add(geo);
      const line = new THREE.Line(geo, lineMat);
      scene.add(line);
      built.push(line);
    });
    people.set("brand-brain", {
      id: "brand-brain",
      anchor: { x: brainPoint.x, y: brainPoint.y + 1.8, z: brainPoint.z }
    });

    const face = yawOf(0.7, 0.7);
    const fallbackId = plan.fallback || (pipeline[0] && pipeline[0].id) || "qualify";
    const homes = new Map();
    agents.forEach((agent) => {
      const home = agent.home || homeStation(agent) || fallbackId;
      if (!homes.has(home)) homes.set(home, []);
      homes.get(home).push(agent);
    });
    const walking = agents.filter((agent) => agent.work !== "paused");
    homes.forEach((group, home) => {
      const base = points[home] || points[fallbackId] || points[pipeline[0] && pipeline[0].id];
      group.forEach((agent, index) => {
        const shift = (index - (group.length - 1) / 2) * 1.15;
        const seat = {
          x: base.x + RIGHT_X * shift,
          z: base.z + RIGHT_Z * shift
        };
        const elevated = Boolean(balcony) && home === balconyId;
        const color = hexOf(agent.color);
        const chair = makeChair();
        chair.rotation.y = face;
        const sitter = makeSitter(color);
        sitter.rotation.y = face;
        if (elevated) {
          sitter.add(put(box(0.04, 0.28, 0.04, lambert(0xd7dbe8)), 0, 1.62, 0));
          sitter.add(put(box(0.12, 0.12, 0.12, lambert(0xff8a3d)), 0, 1.82, 0));
          chair.position.set(shift, 1.32, 0);
          sitter.position.set(shift, 1.32, 0);
          balcony.add(chair, sitter);
        } else {
          chair.position.set(seat.x, 0, seat.z);
          sitter.position.set(seat.x, 0, seat.z);
          scene.add(chair, sitter);
          built.push(chair, sitter);
        }
        addPick(sitter, agent.id);
        const walker = makeWalker(color);
        walker.position.set(seat.x, 0, seat.z);
        walker.visible = false;
        addPick(walker, agent.id);
        scene.add(walker);
        built.push(walker);
        const attend = Math.max(0, walking.findIndex((item) => item.id === agent.id));
        const angle = walking.length ? -Math.PI / 2 + (attend / walking.length) * Math.PI * 2 : 0;
        const slot = {
          x: points.meetup.x + Math.cos(angle) * 1.8,
          z: points.meetup.z + Math.sin(angle) * 1.8
        };
        const errands = {};
        Object.entries(points).forEach(([id, spot]) => {
          errands[id] = [seat, { x: spot.x, z: spot.z }];
        });
        people.set(agent.id, {
          id: agent.id,
          work: agent.work,
          errand: agent.errand || "",
          sitter,
          walker,
          seat,
          pace: { x: seat.x + 0.45, z: seat.z + 0.35 },
          face,
          path: [seat, { x: points.meetup.x, z: points.meetup.z }, slot],
          errands,
          slot,
          anchor: { x: seat.x, y: elevated ? 3.3 : 2.2, z: seat.z }
        });
      });
    });
  }

  const RIGHT_X = 0.70710678;
  const RIGHT_Z = -0.70710678;

  function build(agents) {
    clearBuilt();
    layoutPoints = null;
    if (factoryMode) {
      buildFactory(agents);
      resize();
      return;
    }
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
    officeBounds = { minX, maxX, minZ, maxZ };
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

    const boardSpot = { x: -4.8, z: 0.35 };
    const fileSpot = { x: -4.8, z: -1.55 };
    const outSpot = { x: 4.85, z: -0.45 };
    const meetSpot = { x: 0.15, z: 2.25 };
    const board = new THREE.Group();
    board.position.set(boardSpot.x, 0, boardSpot.z);
    board.add(put(box(0.12, 1.7, 2.2, lambert(0xf4f1ea)), 0, 1.15, 0));
    board.add(put(box(0.08, 1.35, 1.7, lambert(0x2f6f73)), 0.08, 1.2, 0));
    board.add(put(box(0.35, 0.9, 0.7, lambert(0x8d6a45)), -0.2, 0.5, -1.15));
    scene.add(board);
    built.push(board);
    const outbox = new THREE.Group();
    outbox.position.set(outSpot.x, 0, outSpot.z);
    outbox.add(put(box(0.9, 0.16, 0.7, lambert(0xc9844a)), 0, 0.55, 0));
    outbox.add(put(box(0.7, 0.04, 0.5, lambert(0xf7f3ea)), 0, 0.66, 0));
    outbox.add(put(box(0.55, 0.7, 0.55, lambert(0x6d4c38)), 0, 0.4, 0));
    scene.add(outbox);
    built.push(outbox);
    errandSpots.meeting = meetSpot;
    errandSpots.board = boardSpot;
    errandSpots.files = fileSpot;
    errandSpots.outbox = outSpot;

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
      const errandPath = (spot) => [seatWorld, doorPoint, hallPoint, spot];
      people.set(item.agent.id, {
        id: item.agent.id,
        work: item.agent.work,
        errand: item.agent.errand || "",
        sitter,
        walker,
        seat: seatWorld,
        pace,
        face: yawOf(-inward.x, -inward.z),
        path,
        errands: {
          meeting: errandPath(errandSpots.meeting),
          board: errandPath(errandSpots.board),
          outbox: errandPath(errandSpots.outbox)
        },
        slot,
        anchor: { x: room.position.x, y: 2.55, z: room.position.z }
      });
    });
    people.set("meeting", {
      id: "meeting",
      anchor: { x: 0, y: 3.05, z: 0 }
    });
    resize();
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

  function dutyPose(person, elapsed) {
    const errand = person.errand || "";
    if (!errand) return null;
    if (errand === "desk") return { sitting: true, typing: true };
    const route = person.errands && person.errands[errand];
    if (!route || !route.length) return { sitting: true, typing: true };
    const period = 16;
    const shift = Math.abs(Math.sin(person.seat.x * 2.1)) * 3;
    const local = (elapsed + shift) % period;
    if (local < 4.5) {
      const point = pointOn(route, local / 4.5);
      return { sitting: false, x: point.x, z: point.z, face: yawOf(point.dx || 0, point.dz || 1), moving: true };
    }
    if (local < 8) {
      const end = route[route.length - 1];
      return { sitting: false, x: end.x, z: end.z, face: yawOf(-end.x, -end.z || 1), moving: false, working: true };
    }
    if (local < 12.5) {
      const point = pointOn(route, 1 - (local - 8) / 4.5);
      return { sitting: false, x: point.x, z: point.z, face: yawOf(-(point.dx || 0), -(point.dz || 1)), moving: true };
    }
    return { sitting: true, typing: true };
  }

  function parkAnchor(person) {
    if (!person.anchor) return;
    if (person.walker && person.walker.visible) {
      person.anchor.x = person.walker.position.x;
      person.anchor.z = person.walker.position.z;
    } else {
      person.anchor.x = person.seat.x;
      person.anchor.z = person.seat.z;
    }
  }

  function applyPose(person, phase, elapsed) {
    if (!person.walker) return;
    const paused = person.work === "paused";
    let mode = paused ? "desk" : phase.mode;
    if (reduceMotion && mode !== "desk") mode = "meet";
    const typing = person.work === "active" || person.errand === "desk";
    const pacing = !person.errand && person.work !== "paused" && mode === "desk";
    let x = person.seat.x;
    let z = person.seat.z;
    let face = person.face;
    let sitting = true;
    let moving = false;
    let working = false;
    const duty = mode === "desk" && !paused ? dutyPose(person, elapsed) : null;
    if (duty) {
      sitting = duty.sitting;
      x = duty.x == null ? person.seat.x : duty.x;
      z = duty.z == null ? person.seat.z : duty.z;
      face = duty.face == null ? person.face : duty.face;
      moving = Boolean(duty.moving);
      working = Boolean(duty.working);
    } else if (mode === "to" || mode === "back") {
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
      const wave = (typing || (duty && duty.typing)) ? Math.sin(elapsed * 9) * 0.35 : 0;
      if (arms[0]) arms[0].rotation.x = wave;
      if (arms[1]) arms[1].rotation.x = -wave * 0.8;
      parkAnchor(person);
      return;
    }
    person.walker.position.set(x, 0, z);
    person.walker.rotation.y = face;
    const step = Math.sin(elapsed * 7.2);
    const joints = person.walker.userData.joints;
    const walking = moving || (!duty && mode !== "meet");
    if (joints) {
      joints.legL.rotation.x = walking ? step * 0.7 : 0;
      joints.legR.rotation.x = walking ? -step * 0.7 : 0;
      joints.armL.rotation.x = walking ? -step * 0.5 : Math.sin(elapsed * (working ? 8 : 1.5)) * (working ? 0.45 : 0.08);
      joints.armR.rotation.x = walking ? step * 0.5 : -Math.sin(elapsed * (working ? 8 : 1.5)) * (working ? 0.35 : 0.08);
    }
    parkAnchor(person);
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
    const narrow = narrowQuery.matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, narrow ? 1.25 : 1.5));
    renderer.setSize(width, height, false);
    const aspect = width / Math.max(height, 1);
    let view = 19.5;
    const samples = [
      [officeBounds.minX, 0, officeBounds.minZ],
      [officeBounds.maxX, 0, officeBounds.minZ],
      [officeBounds.minX, 0, officeBounds.maxZ],
      [officeBounds.maxX, 0, officeBounds.maxZ]
    ];
    if (layoutPoints) {
      Object.values(layoutPoints).forEach((spot) => samples.push([spot.x, spot.y || 0, spot.z]));
    }
    if (narrow || layoutPoints) {
      camera.left = -view * aspect;
      camera.right = view * aspect;
      camera.top = view;
      camera.bottom = -view;
      camera.updateProjectionMatrix();
      let minNX = Infinity;
      let maxNX = -Infinity;
      let minNY = Infinity;
      let maxNY = -Infinity;
      samples.forEach(([x, y, z]) => {
        projector.set(x, y, z);
        projector.project(camera);
        minNX = Math.min(minNX, projector.x);
        maxNX = Math.max(maxNX, projector.x);
        minNY = Math.min(minNY, projector.y);
        maxNY = Math.max(maxNY, projector.y);
      });
      const span = maxNX - minNX;
      const spanY = maxNY - minNY;
      if (span > 0.2) view = Math.max(8, view * (span / 1.72));
      if (layoutPoints && spanY > 0.2) view = Math.max(view, 8, 19.5 * (spanY / 1.55));
    }
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

  function onVisibility() {
    if (stopped) return;
    cancelAnimationFrame(frame);
    if (!document.hidden) frame = requestAnimationFrame(animate);
  }

  function dropPick(object) {
    const drop = new Set();
    object.traverse((node) => drop.add(node));
    pickables = pickables.filter((item) => !drop.has(item));
  }

  function cardTarget(spot, index) {
    const points = layoutPoints || factoryPoints();
    const fallbackId = factoryPlan && factoryPlan.fallback;
    const point = points[spot] || (fallbackId && points[fallbackId]) || points.writers_room || points.qualify;
    const shift = index * 0.55;
    return {
      x: point.x + RIGHT_X * shift,
      y: (point.y || 0) + 0.7,
      z: point.z + RIGHT_Z * shift
    };
  }

  function makeCard(title, glow) {
    const group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({
      color: glow ? 0xffe4f0 : 0xf7f3ea,
      emissive: glow ? 0xff4d8d : 0x221018,
      emissiveIntensity: glow ? 0.55 : 0
    });
    owned.add(mat);
    group.add(box(1.25, 0.08, 0.84, mat));
    const label = sign(String(title || "Task").slice(0, 22), 1.3, 0.38, 0, 0.34, 0);
    group.add(label);
    group.userData.cardMat = mat;
    group.userData.label = label;
    return group;
  }

  function syncCards(cards) {
    if (!factoryMode) return;
    const list = (cards || []).filter((card) => card && card.id && card.spot);
    const counts = new Map();
    const keep = new Set();
    list.forEach((card) => {
      const index = counts.get(card.spot) || 0;
      counts.set(card.spot, index + 1);
      const target = cardTarget(card.spot, index);
      keep.add(card.id);
      let item = cardItems.get(card.id);
      const glow = Boolean(card.glow);
      if (!item || item.title !== card.title) {
        const previous = item ? item.mesh.position.clone() : null;
        if (item) {
          dropPick(item.mesh);
          scene.remove(item.mesh);
        }
        const mesh = makeCard(card.title, glow);
        mesh.position.copy(previous || target);
        addPick(mesh, "task:" + card.id);
        scene.add(mesh);
        item = { mesh, title: card.title, glow, target, spot: card.spot };
        cardItems.set(card.id, item);
      }
      item.spot = card.spot;
      item.target = target;
      item.glow = glow;
      const mat = item.mesh.userData.cardMat;
      if (mat) {
        mat.color.setHex(glow ? 0xffe4f0 : 0xf7f3ea);
        mat.emissive.setHex(glow ? 0xff4d8d : 0x221018);
        if (!glow) mat.emissiveIntensity = 0;
      }
    });
    cardItems.forEach((item, id) => {
      if (keep.has(id)) return;
      dropPick(item.mesh);
      scene.remove(item.mesh);
      cardItems.delete(id);
    });
  }

  function animate() {
    if (stopped || document.hidden) return;
    frame = requestAnimationFrame(animate);
    const elapsed = clock.getElapsedTime();
    const phase = phaseNow(elapsed);
    let hot = false;
    cardItems.forEach((item) => {
      const mesh = item.mesh;
      const dx = item.target.x - mesh.position.x;
      const dy = item.target.y - mesh.position.y;
      const dz = item.target.z - mesh.position.z;
      const dist = Math.hypot(dx, dy, dz);
      const step = reduceMotion ? 1 : 0.07;
      if (dist > 0.04) {
        mesh.position.x += dx * step;
        mesh.position.y += dy * step;
        mesh.position.z += dz * step;
      } else {
        mesh.position.set(item.target.x, item.target.y + Math.sin(elapsed * 2.2 + item.target.x) * 0.035, item.target.z);
      }
      if (item.glow && mesh.userData.cardMat) {
        hot = true;
        mesh.userData.cardMat.emissiveIntensity = 0.45 + Math.sin(elapsed * 4) * 0.4;
      }
      if (mesh.userData.label) mesh.userData.label.lookAt(camera.position);
    });
    if (approvalMat) approvalMat.emissiveIntensity = hot ? 0.85 + Math.sin(elapsed * 3) * 0.25 : 0.15;
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
  document.addEventListener("visibilitychange", onVisibility);
  resize();

  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";

  const handle = {
    update(agents, cards) {
      const key = agents.map((agent) => agent.id + (agent.outside ? ":o" : ":i") + ":" + agent.color + ":" + (agent.home || "")).join("|");
      if (key !== builtKey) {
        build(agents);
        builtKey = key;
      }
      agents.forEach((agent) => {
        const person = people.get(agent.id);
        if (!person) return;
        person.work = agent.work;
        person.errand = agent.errand || "";
      });
      if (factoryMode) syncCards(cards || []);
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
      document.removeEventListener("visibilitychange", onVisibility);
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
