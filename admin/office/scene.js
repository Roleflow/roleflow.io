import { factoryBounds, factoryPoints, homeStation, hqPlan, pointsFor } from "./factory.mjs";
import { launchPlan } from "./org.mjs";
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
  renderer.setClearColor(0x07060c, 1);
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07060c);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 800);
  camera.position.set(52, 44, 52);
  camera.lookAt(0, 0, 0);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.6, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = 0.42;
  controls.maxPolarAngle = 1.18;
  controls.minDistance = 14;
  controls.maxDistance = 180;
  controls.minZoom = 0.55;
  controls.maxZoom = 2.8;
  controls.touches.ONE = THREE.TOUCH.PAN;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  controls.update();
  renderer.domElement.style.touchAction = "none";

  scene.add(new THREE.HemisphereLight(0x3a2458, 0x07060c, 0.42));
  const sun = new THREE.DirectionalLight(0xfff0e6, 0.16);
  sun.position.set(-18, 32, 12);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xff4d8d, 0.12);
  fill.position.set(16, 12, -8);
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
  const sphereGeo = (r) => {
    const key = "s" + r;
    if (!geos.has(key)) {
      const geo = new THREE.SphereGeometry(r, 18, 14);
      geos.set(key, geo);
      owned.add(geo);
    }
    return geos.get(key);
  };
  const box = (w, h, d, mat) => new THREE.Mesh(boxGeo(w, h, d), mat);
  let purpleMat = null;
  let headMat = null;
  let pinkMat = null;
  const purple = () => {
    if (!purpleMat) {
      purpleMat = new THREE.MeshLambertMaterial({ color: 0x7a4dff, emissive: 0x5b22c8, emissiveIntensity: 0.7 });
      owned.add(purpleMat);
    }
    return purpleMat;
  };
  const headGlow = () => {
    if (!headMat) {
      headMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.7 });
      owned.add(headMat);
    }
    return headMat;
  };
  const pinkBasic = () => {
    if (!pinkMat) {
      pinkMat = new THREE.MeshBasicMaterial({ color: 0xff4d8d });
      owned.add(pinkMat);
    }
    return pinkMat;
  };
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
  const chairMat = lambert(0x2a1848);
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
  const billboards = [];
  const motes = [];
  const tetherEnds = [];
  const orbitRings = [];
  let launchItems = [];
  let workforceMotions = [];
  let postsSign = null;
  let postsCount = Math.max(0, Math.round(Number(hooks && hooks.posts) || 0));
  let focusId = "overview";
  let fittedKey = "";

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
    postsSign = null;
    billboards.length = 0;
    motes.length = 0;
    tetherEnds.length = 0;
    orbitRings.length = 0;
    launchItems = [];
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

  function addHead(group, y, robot) {
    if (robot) {
      group.add(put(box(0.4, 0.32, 0.32, lambert(0x24182f)), 0, y, 0));
      const visor = new THREE.MeshBasicMaterial({ color: 0xfff4ea });
      owned.add(visor);
      group.add(put(box(0.3, 0.07, 0.05, visor), 0, y, 0.16));
      return;
    }
    group.add(put(new THREE.Mesh(sphereGeo(0.2), headGlow()), 0, y, 0.02));
  }

  function makeSitter(color, robot) {
    const g = new THREE.Group();
    const shirt = purple();
    g.add(put(new THREE.Mesh(sphereGeo(0.16), shirt), -0.12, 0.36, 0.22));
    g.add(put(new THREE.Mesh(sphereGeo(0.16), shirt), 0.12, 0.36, 0.22));
    g.add(put(new THREE.Mesh(sphereGeo(0.34), shirt), 0, 0.78, 0.02));
    addHead(g, 1.24, robot);
    const armL = new THREE.Group();
    armL.position.set(-0.32, 0.92, 0.08);
    armL.add(put(new THREE.Mesh(sphereGeo(0.1), shirt), 0, -0.08, 0.16));
    const armR = new THREE.Group();
    armR.position.set(0.32, 0.92, 0.08);
    armR.add(put(new THREE.Mesh(sphereGeo(0.1), shirt), 0, -0.08, 0.16));
    g.add(armL, armR);
    g.userData.arms = [armL, armR];
    return g;
  }

  function limb(y, x, side) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const upper = put(new THREE.Mesh(sphereGeo(0.12), purple()), 0, -0.16, 0);
    const shin = new THREE.Group();
    shin.position.y = -0.28;
    shin.add(put(new THREE.Mesh(sphereGeo(0.11), purple()), 0, -0.16, 0));
    pivot.add(upper, shin);
    pivot.userData.shin = shin;
    pivot.userData.side = side;
    return pivot;
  }

  function makeWalker(color, robot) {
    const g = new THREE.Group();
    const shirt = purple();
    const legL = limb(0.86, -0.12, "l");
    const legR = limb(0.86, 0.12, "r");
    const torso = put(new THREE.Mesh(sphereGeo(0.32), shirt), 0, 1.08, 0);
    const armL = new THREE.Group();
    armL.position.set(-0.34, 1.16, 0);
    armL.add(put(new THREE.Mesh(sphereGeo(0.1), shirt), 0, -0.18, 0));
    const armR = new THREE.Group();
    armR.position.set(0.34, 1.16, 0);
    armR.add(put(new THREE.Mesh(sphereGeo(0.1), shirt), 0, -0.18, 0));
    g.add(legL, legR, torso, armL, armR);
    addHead(g, 1.52, robot);
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

  function floorLabel(text, x, z) {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 160;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 768, 160);
    ctx.fillStyle = "#ffd6ef";
    ctx.font = "800 92px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(text || "").toUpperCase(), 384, 80);
    const tex = new THREE.CanvasTexture(canvas);
    owned.add(tex);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    owned.add(mat);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.05), mat);
    owned.add(mesh.geometry);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.16, z);
    return mesh;
  }

  function sign(text, width, height, x, y, z, tone) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 160;
    const ctx = canvas.getContext("2d");
    const tex = new THREE.CanvasTexture(canvas);
    owned.add(tex);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    owned.add(mat);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    owned.add(mesh.geometry);
    mesh.position.set(x, y, z);
    const paint = (value) => {
      ctx.clearRect(0, 0, 512, 160);
      const neon = tone === "yellow" ? "#ffe56a" : "#ff4d8d";
      const fill = tone === "yellow" ? "rgba(42,28,4,0.82)" : "rgba(8,6,14,0.78)";
      const ink = tone === "yellow" ? "#ffe56a" : "#fff6fb";
      ctx.fillStyle = fill;
      ctx.fillRect(16, 28, 480, 104);
      ctx.strokeStyle = neon;
      ctx.lineWidth = 6;
      ctx.strokeRect(19, 31, 474, 98);
      ctx.fillStyle = ink;
      const long = String(value || "").length > 26;
      ctx.font = (tone === "yellow" ? "800 " : "700 ") + (long ? "32px" : "40px") + " sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(value || "").slice(0, 42), 256, 80);
      tex.needsUpdate = true;
    };
    paint(text);
    mesh.userData.paint = paint;
    billboards.push(mesh);
    return mesh;
  }

  function glassPanel(step, title, blurb, width, height, x, y, z) {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 320;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 768, 320);
    ctx.fillStyle = "rgba(8,6,14,0.72)";
    ctx.fillRect(18, 18, 732, 284);
    ctx.strokeStyle = "#ff4d8d";
    ctx.lineWidth = 8;
    ctx.strokeRect(22, 22, 724, 276);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff8a3d";
    ctx.font = "700 42px sans-serif";
    ctx.fillText(String(step || "").slice(0, 16), 384, 88);
    ctx.fillStyle = "#fff6fb";
    ctx.font = "700 54px sans-serif";
    ctx.fillText(String(title || "").slice(0, 28), 384, 164);
    ctx.fillStyle = "rgba(255,214,236,0.88)";
    ctx.font = "500 32px sans-serif";
    ctx.fillText(String(blurb || "").slice(0, 42), 384, 230);
    const tex = new THREE.CanvasTexture(canvas);
    owned.add(tex);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    owned.add(mat);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    owned.add(mesh.geometry);
    mesh.position.set(x, y, z);
    billboards.push(mesh);
    return mesh;
  }

  function faceBillboards() {
    billboards.forEach((mesh) => {
      if (mesh && mesh.parent) mesh.lookAt(camera.position.x, mesh.position.y, camera.position.z);
    });
  }

  function stationLight(color, x, y, z) {
    const light = new THREE.PointLight(color, 2.4, 16, 2);
    light.position.set(x, y, z);
    scene.add(light);
    built.push(light);
  }

  function placeProp(prop, spot) {
    const lift = (along, side, y) => ({
      x: spot.x + FAR_X * along + RIGHT_X * side,
      y,
      z: spot.z + FAR_Z * along + RIGHT_Z * side
    });
    if (prop === "research") {
      const watch = sign("Competitor Watch", 2.2, 0.42, spot.x - 1.2, 0.85, spot.z + 0.2);
      const reader = sign("Transcript Reader", 2.2, 0.42, spot.x + 1.15, 0.85, spot.z + 0.2);
      const settyAt = lift(2.35, -0.95, 1.55);
      const zeroAt = lift(2.35, 0.95, 1.55);
      const setty = sign("Setty AI", 1.7, 0.48, settyAt.x, settyAt.y, settyAt.z);
      const zero = sign("Zerochats", 1.7, 0.48, zeroAt.x, zeroAt.y, zeroAt.z);
      scene.add(watch, reader, setty, zero);
      built.push(watch, reader, setty, zero);
      return;
    }
    if (prop === "studio") {
      const back = lift(1.35, 0.15, 1.2);
      const backdropGeo = new THREE.CylinderGeometry(1.9, 1.9, 2.3, 28, 1, true, 0.4, Math.PI * 0.95);
      owned.add(backdropGeo);
      const backdropMat = new THREE.MeshBasicMaterial({ color: 0xff4d8d, side: THREE.DoubleSide });
      owned.add(backdropMat);
      const backdrop = new THREE.Mesh(backdropGeo, backdropMat);
      backdrop.position.set(back.x, back.y, back.z);
      scene.add(backdrop);
      built.push(backdrop);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xfff1c2 });
      owned.add(ringMat);
      const ringGeo = new THREE.TorusGeometry(0.72, 0.055, 12, 36);
      owned.add(ringGeo);
      const talent = lift(-0.15, 0.35, 0);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(talent.x, 1.7, talent.z);
      ring.rotation.x = Math.PI / 2.2;
      scene.add(ring);
      built.push(ring);
      stationLight(0xff4d8d, talent.x, 2.1, talent.z);
      const you = new THREE.Group();
      you.position.set(talent.x, 0, talent.z);
      const youMat = new THREE.MeshLambertMaterial({ color: 0xff6a1a, emissive: 0xff6a1a, emissiveIntensity: 0.85 });
      owned.add(youMat);
      you.add(put(new THREE.Mesh(sphereGeo(0.28), youMat), 0, 0.85, 0));
      you.add(put(new THREE.Mesh(sphereGeo(0.16), youMat), 0, 1.28, 0));
      you.add(sign("You", 1.15, 0.4, 0, 1.75, 0));
      addPick(you, "diego");
      scene.add(you);
      built.push(you);
      const shelfAt = lift(0.2, -1.35, 0);
      const shelf = new THREE.Group();
      shelf.position.set(shelfAt.x, 0, shelfAt.z);
      shelf.add(put(box(0.9, 1.15, 0.28, lambert(0x3a2430)), 0, 0.7, 0));
      shelf.add(put(box(0.72, 0.08, 0.22, lambert(0xff8a3d)), 0, 0.95, 0.08));
      shelf.add(put(box(0.72, 0.08, 0.22, lambert(0xff4d8d)), 0, 0.72, 0.08));
      shelf.add(put(box(0.72, 0.08, 0.22, lambert(0xc040ff)), 0, 0.5, 0.08));
      shelf.add(sign("Script Library", 1.9, 0.42, 0, 1.55, 0));
      scene.add(shelf);
      built.push(shelf);
      return;
    }
    if (prop === "edit") {
      const ratioAt = lift(1.5, 0, 1.15);
      const ratio = sign("1 in - 10 out", 2.1, 0.48, ratioAt.x, ratioAt.y, ratioAt.z, "yellow");
      scene.add(ratio);
      built.push(ratio);
      return;
    }
    if (prop === "shipping") {
      const towers = new THREE.Group();
      const base = lift(0.2, 0.85, 0);
      towers.position.set(base.x, 0, base.z);
      const slit = new THREE.MeshBasicMaterial({ color: 0x7af0ff });
      owned.add(slit);
      [-0.7, 0, 0.7].forEach((x, index) => {
        const h = 1.15 + index * 0.18;
        towers.add(put(box(0.42, h, 0.42, lambert(0x16141f)), x, h / 2, 0));
        towers.add(put(box(0.28, 0.05, 0.05, slit), x, h * 0.45, 0.22));
        towers.add(put(box(0.28, 0.05, 0.05, slit), x, h * 0.7, 0.22));
      });
      scene.add(towers);
      built.push(towers);
      const row = lift(2.15, 0.2, 1.7);
      postsSign = sign("YOUR POSTS  " + postsCount, 2.4, 0.5, row.x, row.y, row.z);
      scene.add(postsSign);
      built.push(postsSign);
      stationLight(0x9b4dff, base.x, 1.8, base.z);
      return;
    }
    if (prop === "mail") {
      const slots = new THREE.Group();
      const at = lift(0.15, 0.4, 0);
      slots.position.set(at.x, 0, at.z);
      slots.add(put(box(1.5, 0.9, 0.28, lambert(0x1a1424)), 0, 0.7, 0));
      [-0.45, 0, 0.45].forEach((x) => {
        slots.add(put(box(0.32, 0.22, 0.06, lambert(0x07060c)), x, 0.85, 0.16));
      });
      scene.add(slots);
      built.push(slots);
      return;
    }
    if (prop === "sales") {
      const desk = new THREE.Group();
      const at = lift(0.1, 0.7, 0);
      desk.position.set(at.x, 0, at.z);
      desk.add(put(box(1.3, 0.08, 0.7, deskMat), 0, 0.72, 0));
      desk.add(put(box(0.22, 0.1, 0.5, lambert(0x1b2430)), 0.28, 0.86, 0));
      scene.add(desk);
      built.push(desk);
      stationLight(0xff4d8d, at.x, 1.6, at.z);
      return;
    }
    if (prop === "ledger") {
      const books = new THREE.Group();
      const at = lift(0.15, 0.45, 0);
      books.position.set(at.x, 0, at.z);
      books.add(put(box(0.7, 0.12, 0.5, lambert(0xff8a3d)), 0, 0.4, 0));
      books.add(put(box(0.66, 0.1, 0.46, lambert(0xc040ff)), 0.04, 0.52, 0));
      books.add(put(box(0.62, 0.1, 0.44, lambert(0xffe56a)), -0.04, 0.64, 0));
      scene.add(books);
      built.push(books);
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
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorD), lambert(0x100c14));
    owned.add(floor.geometry);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((officeBounds.minX + officeBounds.maxX) / 2, 0, (officeBounds.minZ + officeBounds.maxZ) / 2);
    scene.add(floor);
    built.push(floor);

    function placePad(station, spot, width, depth) {
      const pad = new THREE.Group();
      pad.position.set(spot.x, 0, spot.z);
      const w = width || 4.35;
      const d = depth || 3.2;
      pad.add(put(box(w + 0.28, 0.05, d + 0.28, pinkBasic()), 0, 0.03, 0));
      pad.add(put(box(w, 0.08, d, lambert(station.color || 0x120e18)), 0, 0.08, 0));
      pad.add(put(box(Math.min(1.45, w * 0.4), 0.08, 0.62, deskMat), 0.15, 0.7, 0.3));
      pad.add(glassPanel(station.step || "", station.title || station.id, station.blurb || "", Math.min(3.35, w - 0.3), station.step ? 1.15 : 0.95, 0.05, 2.05, -1.05));
      scene.add(pad);
      built.push(pad);
      stationLight(0xff4d8d, spot.x, 1.5, spot.z);
      if (station.prop) placeProp(station.prop, spot);
    }

    function arrowBetween(from, to, label) {
      const arrow = new THREE.Group();
      arrow.position.set((from.x + to.x) / 2, 0.35, (from.z + to.z) / 2);
      arrow.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
      arrow.add(put(box(0.1, 0.05, 2.1, pinkBasic()), 0, 0, 0));
      arrow.add(sign(label, 3.15, 0.5, 0, 0.55, 0));
      scene.add(arrow);
      built.push(arrow);
    }

    function placeBooked(spot, title) {
      const pad = new THREE.Group();
      pad.position.set(spot.x, 0, spot.z);
      pad.add(put(box(3.3, 0.05, 2.7, pinkBasic()), 0, 0.03, 0));
      pad.add(put(box(3.0, 0.08, 2.4, lambert(0x24140c)), 0, 0.08, 0));
      const youMat = new THREE.MeshLambertMaterial({ color: 0xff6a1a, emissive: 0xff6a1a, emissiveIntensity: 0.9 });
      owned.add(youMat);
      const you = new THREE.Group();
      you.add(put(new THREE.Mesh(sphereGeo(0.28), youMat), 0, 0.85, 0));
      you.add(put(new THREE.Mesh(sphereGeo(0.16), youMat), 0, 1.28, 0));
      you.add(sign("You", 1.1, 0.38, 0, 1.72, 0));
      pad.add(you);
      pad.add(sign(title || "Booked call (You)", 2.9, 0.5, 0, 2.3, -0.15, "yellow"));
      addPick(pad, "diego");
      scene.add(pad);
      built.push(pad);
      stationLight(0xffe56a, spot.x, 1.8, spot.z);
    }

    const pipeline = plan.pipeline || [];
    pipeline.forEach((station) => {
      placePad(station, points[station.id]);
    });

    for (let i = 0; i < pipeline.length - 1; i += 1) {
      const next = pipeline[i + 1];
      arrowBetween(
        points[pipeline[i].id],
        points[next.id],
        next.afterGate ? "Next step: Your approval" : "Next step: " + (next.tab || next.title)
      );
    }

    (plan.floorLabels || []).forEach((label) => {
      const spot = label.id && points[label.id] ? points[label.id] : {
        x: 0.70710678 * (label.index || 0) * 7.6 + -0.70710678 * (label.far || 0),
        z: -0.70710678 * (label.index || 0) * 7.6 + -0.70710678 * (label.far || 0)
      };
      const plate = sign(label.title, 3.3, 0.52, spot.x, label.y || 2.7, spot.z);
      scene.add(plate);
      built.push(plate);
    });

    if (plan.revenue) {
      const stations = plan.revenue.stations || [];
      stations.forEach((station, index) => {
        const spot = points[station.id];
        if (!spot) return;
        if (station.you) placeBooked(spot, station.title);
        else placePad(station, spot, 3.9, 3.0);
        if (index > 0 && station.next) arrowBetween(points[stations[index - 1].id], spot, station.next);
      });
      const hub = points[plan.revenue.id];
      if (hub) {
        const plate = sign(plan.revenue.title || "Revenue Floor", 3.4, 0.55, hub.x + FAR_X * 2.55, 2.75, hub.z + FAR_Z * 2.55);
        scene.add(plate);
        built.push(plate);
      }
    }

    const approval = points.approval;
    const gate = new THREE.Group();
    gate.position.set(approval.x, 0, approval.z);
    approvalMat = new THREE.MeshBasicMaterial({ color: 0xffe56a });
    owned.add(approvalMat);
    gate.add(put(box(0.14, 1.7, 0.14, approvalMat), -1.15, 0.95, 0));
    gate.add(put(box(0.14, 1.7, 0.14, approvalMat), 1.15, 0.95, 0));
    gate.add(put(box(2.45, 0.14, 0.14, approvalMat), 0, 1.75, 0));
    gate.add(sign("YOUR APPROVAL", 3.5, 0.85, 0, 2.45, 0, "yellow"));
    stationLight(0xffe56a, approval.x, 2.2, approval.z);
    scene.add(gate);
    built.push(gate);

    if (plan.side && points[plan.side.id]) {
      const client = points[plan.side.id];
      const clientPad = new THREE.Group();
      clientPad.position.set(client.x, 0, client.z);
      const wide = plan.side.width || 4.45;
      const deep = plan.side.depth || 3.25;
      clientPad.add(put(box(wide + 0.3, 0.05, deep + 0.28, pinkBasic()), 0, 0.03, 0));
      clientPad.add(put(box(wide, 0.08, deep, lambert(plan.side.color || 0x12101c)), 0, 0.08, 0));
      clientPad.add(glassPanel("", plan.side.title || "Client Floor", plan.side.blurb || "", Math.min(3.4, wide - 0.4), 1.05, 0, 2.05, -1.2));
      scene.add(clientPad);
      built.push(clientPad);
      stationLight(0xc040ff, client.x, 1.5, client.z);
    }

    if (plan.backOffice && points[plan.backOffice.id]) {
      placePad(plan.backOffice, points[plan.backOffice.id], 3.3, 2.55);
    }

    let balcony = null;
    const balconyId = plan.balcony && plan.balcony.id;
    if (balconyId && points[balconyId]) {
      const chief = points[balconyId];
      balcony = new THREE.Group();
      balcony.position.set(chief.x, 0, chief.z);
      balcony.add(put(box(5.4, 0.18, 2.6, lambert(0x1a1028)), 0, 1.2, 0));
      balcony.add(put(box(5.55, 0.06, 2.75, pinkBasic()), 0, 1.32, 0));
      [[-2.3, -1], [2.3, -1], [-2.3, 1], [2.3, 1]].forEach(([x, z]) => {
        balcony.add(put(box(0.16, 1.15, 0.16, lambert(0x3a2848)), x, 0.55, z));
      });
      [-1.6, -0.8, 0, 0.8, 1.6].forEach((x, index) => {
        balcony.add(put(box(0.62, 0.85, 0.32, lambert(0x2a1c18)), x, 0.48, 1.15));
        balcony.add(put(box(0.42, 0.5, 0.08, lambert(index % 2 ? 0xff4d8d : 0xff8a3d)), x, 0.7, 1.28));
      });
      balcony.add(sign(plan.balcony.eyebrow || "ON THE BALCONY", 3.3, 0.4, 0, 2.45, 0));
      balcony.add(sign(plan.balcony.title || plan.balcony.label || "Chief of Staff", 3.2, 0.48, 0, 1.9, 0));
      stationLight(0xc040ff, chief.x, 2.4, chief.z);
      scene.add(balcony);
      built.push(balcony);
    }

    const brainPoint = points.brand_brain;
    const brain = new THREE.Group();
    brain.position.set(brainPoint.x, brainPoint.y, brainPoint.z);
    const orbMat = new THREE.MeshLambertMaterial({
      color: 0xff6a1a,
      emissive: 0xff6a1a,
      emissiveIntensity: 1.45,
      transparent: true,
      opacity: 0.96
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff4d8d,
      transparent: true,
      opacity: 0.16,
      depthWrite: false
    });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff8a3d });
    owned.add(orbMat);
    owned.add(glowMat);
    owned.add(ringMat);
    const orbGeo = new THREE.SphereGeometry(2.05, 32, 22);
    const glowGeo = new THREE.SphereGeometry(2.7, 24, 16);
    const ringGeo = new THREE.TorusGeometry(3.15, 0.045, 8, 64);
    owned.add(orbGeo);
    owned.add(glowGeo);
    owned.add(ringGeo);
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.name = "orb";
    const glow = new THREE.Mesh(glowGeo, glowMat);
    brain.add(orb, glow);
    [0.35, 1.15, 1.9].forEach((tilt, index) => {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = tilt;
      ring.rotation.y = index * 0.8;
      ring.userData.spin = 0.35 + index * 0.22;
      brain.add(ring);
      orbitRings.push(ring);
    });
    brain.add(sign("Brand Brain", 2.6, 0.52, 0, 2.55, 0));
    if (plan.brainSub) brain.add(sign(plan.brainSub, 2.4, 0.42, 0, 3.15, 0));
    addPick(brain, "brand-brain");
    scene.add(brain);
    built.push(brain);
    stationLight(0xff6a1a, brainPoint.x, brainPoint.y, brainPoint.z);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.85 });
    const moteMat = new THREE.MeshBasicMaterial({ color: 0xfff6ea });
    owned.add(lineMat);
    owned.add(moteMat);
    const moteGeo = new THREE.SphereGeometry(0.09, 8, 8);
    owned.add(moteGeo);
    function addTether(end) {
      const ax = brainPoint.x;
      const ay = brainPoint.y;
      const az = brainPoint.z;
      const geo = new THREE.BufferGeometry();
      const positions = new THREE.Float32BufferAttribute([ax, ay, az, end.x, end.y, end.z], 3);
      geo.setAttribute("position", positions);
      owned.add(geo);
      const line = new THREE.Line(geo, lineMat);
      scene.add(line);
      built.push(line);
      end.positions = positions;
      if (end.follow) end.scratch = new THREE.Vector3();
      tetherEnds.push(end);
      for (let mote = 0; mote < 3; mote += 1) {
        const mesh = new THREE.Mesh(moteGeo, moteMat);
        scene.add(mesh);
        built.push(mesh);
        motes.push({ ax, ay, az, end, mesh, t: mote / 3 });
      }
    }
    if (!agents.length) {
      const lineIds = pipeline.map((station) => station.id);
      if (balconyId) lineIds.push(balconyId);
      if (plan.side) lineIds.push(plan.side.id);
      if (plan.backOffice) lineIds.push(plan.backOffice.id);
      if (plan.revenue) (plan.revenue.stations || []).forEach((station) => lineIds.push(station.id));
      lineIds.forEach((id) => {
        const spot = points[id];
        if (!spot) return;
        addTether({ x: spot.x, y: 0.9, z: spot.z });
      });
    }
    people.set("brand-brain", {
      id: "brand-brain",
      anchor: { x: brainPoint.x, y: brainPoint.y + 2.7, z: brainPoint.z }
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
        const robot = home === "chief_of_staff";
        const color = hexOf(agent.color);
        const chair = makeChair();
        chair.rotation.y = face;
        const sitter = makeSitter(color, robot);
        sitter.rotation.y = face;
        if (elevated) {
          if (!robot) {
            sitter.add(put(box(0.04, 0.28, 0.04, lambert(0xd7dbe8)), 0, 1.62, 0));
            sitter.add(put(box(0.12, 0.12, 0.12, lambert(0xff8a3d)), 0, 1.82, 0));
          }
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
        const walker = makeWalker(color, robot);
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
        addTether({
          x: elevated ? base.x + shift : seat.x,
          y: elevated ? 2.6 : 1.35,
          z: elevated ? base.z : seat.z,
          follow: agent.id
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
  const FAR_X = -0.70710678;
  const FAR_Z = -0.70710678;

  function syncLaunchModes(list) {
    const hot = [];
    (list || []).forEach((agent) => {
      if (agent && agent.pulse && agent.orgKey) hot.push(agent.orgKey);
    });
    const modes = new Map(launchPlan(hot, reduceMotion).map((edge) => [edge.from + ">" + edge.to, edge]));
    launchItems.forEach((item) => {
      const next = modes.get(item.id);
      if (!next) return;
      item.mode = next.mode;
      item.offset = next.offset;
      const moving = next.mode !== "rest";
      item.mesh.visible = moving;
      item.mesh.scale.setScalar(next.mode === "active" ? 1.45 : 1);
    });
  }

  function applyWorkforceMotion() {
    const hot = new Set((workforceMotions || []).map((edge) => edge.from + ">" + edge.to));
    launchItems.forEach((item) => {
      const on = hot.has(item.id) && !reduceMotion;
      item.mode = on ? "active" : "rest";
      item.mesh.visible = on;
    });
  }

  function flyRockets(elapsed) {
    launchItems.forEach((item) => {
      if (item.mode === "rest" || reduceMotion) {
        item.mesh.visible = false;
        return;
      }
      item.mesh.visible = true;
      const speed = item.mode === "active" ? 0.38 : 0.14;
      const t = (elapsed * speed + item.offset) % 1;
      const x = item.from.x + (item.to.x - item.from.x) * t;
      const y = 1.05 + Math.sin(t * Math.PI) * 0.28;
      const z = item.from.z + (item.to.z - item.from.z) * t;
      item.mesh.position.set(x, y, z);
    });
  }

  function buildOrg(agents) {
    const plan = (factoryPlan && factoryPlan.org) || { edges: [], zones: [], seats: [], points: null };
    const points = plan.points || pointsFor(factoryPlan || hqPlan());
    layoutPoints = points;
    const edge = 16;
    officeBounds = { minX: -edge, maxX: edge, minZ: -edge, maxZ: edge };
    const floorW = officeBounds.maxX - officeBounds.minX + 1.2;
    const floorD = officeBounds.maxZ - officeBounds.minZ + 1.2;
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x100814, emissive: 0x1a0830, emissiveIntensity: 0.35 });
    owned.add(floorMat);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorW, floorD), floorMat);
    owned.add(floor.geometry);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((officeBounds.minX + officeBounds.maxX) / 2, 0, (officeBounds.minZ + officeBounds.maxZ) / 2);
    scene.add(floor);
    built.push(floor);

    const neon = (w, h, d, x, y, z) => {
      const mesh = put(box(w, h, d, pinkBasic()), x, y, z);
      scene.add(mesh);
      built.push(mesh);
    };
    neon(edge * 2, 0.06, 0.08, 0, 0.05, -edge);
    neon(edge * 2, 0.06, 0.08, 0, 0.05, edge);
    neon(0.08, 0.06, edge * 2, -edge, 0.05, 0);
    neon(0.08, 0.06, edge * 2, edge, 0.05, 0);

    const wallMat = new THREE.MeshLambertMaterial({ color: 0x14081c, emissive: 0x220838, emissiveIntensity: 0.45 });
    owned.add(wallMat);
    const backWall = put(box(edge * 2, 6.4, 0.16, wallMat), 0, 3.2, -edge);
    const sideWall = put(box(0.16, 6.4, edge * 2, wallMat), -edge, 3.2, 0);
    scene.add(backWall, sideWall);
    built.push(backWall, sideWall);
    neon(edge * 2, 0.08, 0.1, 0, 6.35, -edge);
    neon(0.1, 0.08, edge * 2, -edge, 6.35, 0);
    neon(0.12, 6.4, 0.12, -edge, 3.2, -edge);

    function reelCard(x, y, z, rotY, caption) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 420;
      const ctx = canvas.getContext("2d");
      const hue = 280 + (caption.length * 17) % 40;
      const grad = ctx.createLinearGradient(0, 0, 0, 420);
      grad.addColorStop(0, "hsl(" + hue + ",72%,46%)");
      grad.addColorStop(1, "#120610");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 420);
      ctx.strokeStyle = "#ff4d8d";
      ctx.lineWidth = 10;
      ctx.strokeRect(12, 12, 232, 396);
      ctx.fillStyle = "rgba(255,246,251,0.94)";
      ctx.beginPath();
      ctx.moveTo(104, 168);
      ctx.lineTo(104, 236);
      ctx.lineTo(168, 202);
      ctx.closePath();
      ctx.fill();
      ctx.font = "700 32px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("REEL", 128, 300);
      ctx.font = "600 22px sans-serif";
      ctx.fillStyle = "#ffd0ea";
      ctx.fillText(caption, 128, 344);
      const tex = new THREE.CanvasTexture(canvas);
      owned.add(tex);
      const mat = new THREE.MeshBasicMaterial({ map: tex });
      owned.add(mat);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.95), mat);
      owned.add(mesh.geometry);
      mesh.position.set(x, y, z);
      mesh.rotation.y = rotY;
      scene.add(mesh);
      built.push(mesh);
    }
    [-8.2, -5.4, -2.6, 0.4, 3.4, 6.4].forEach((x, index) => {
      reelCard(x, index % 2 ? 4.3 : 2.5, -edge + 0.18, 0, index % 2 ? "Draft" : "Reel");
    });
    [-6.5, -3.2, 0.4, 4.2].forEach((z, index) => {
      reelCard(-edge + 0.18, index % 2 ? 4.2 : 2.4, z, Math.PI / 2, "Reel");
    });

    [[-10.6, -10.6], [-8.8, -10.6]].forEach(([x, z]) => {
      const rack = new THREE.Group();
      rack.position.set(x, 0, z);
      rack.add(put(box(0.7, 2.3, 0.45, lambert(0x1a1028)), 0, 1.15, 0));
      [0.5, 0.9, 1.3, 1.7].forEach((y, index) => {
        rack.add(put(box(0.42, 0.08, 0.06, lambert(index % 2 ? 0xff4d8d : 0xc040ff)), 0, y, 0.24));
      });
      scene.add(rack);
      built.push(rack);
    });

    function flowAnchor(key) {
      const spot = points[key] || { x: 0, y: 0, z: 0 };
      return { x: spot.x, y: 0.4, z: spot.z };
    }

    const lineMat = new THREE.LineDashedMaterial({ color: 0xff4d8d, dashSize: 0.45, gapSize: 0.22, transparent: true, opacity: 0.9 });
    owned.add(lineMat);
    (plan.edges || []).forEach((edge) => {
      const from = flowAnchor(edge.from);
      const to = flowAnchor(edge.to);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute([from.x, 0.4, from.z, to.x, 0.4, to.z], 3));
      owned.add(geo);
      const line = new THREE.Line(geo, lineMat);
      line.computeLineDistances();
      scene.add(line);
      built.push(line);
      const rocketMat = new THREE.MeshBasicMaterial({ color: edge.hop === "handoff" ? 0xffe56a : 0xfff6ea });
      owned.add(rocketMat);
      const rocket = new THREE.Mesh(sphereGeo(0.16), rocketMat);
      rocket.position.set(from.x, 1.05, from.z);
      scene.add(rocket);
      built.push(rocket);
      launchItems.push({
        id: edge.from + ">" + edge.to,
        from,
        to,
        mesh: rocket,
        mode: "idle",
        offset: launchItems.length * 0.17
      });
    });

    const brain = new THREE.Group();
    const brainPoint = points.brand_brain || { x: 0, y: 1.75, z: 0 };
    brain.position.set(brainPoint.x, 0, brainPoint.z);
    brain.add(put(box(1.7, 0.22, 1.7, lambert(0x24102c)), 0, 0.2, 0));
    brain.add(put(box(1.85, 0.06, 1.85, pinkBasic()), 0, 0.34, 0));
    brain.add(put(box(0.28, 0.7, 0.28, lambert(0x3a1848)), 0, 0.7, 0));
    const brainMat = new THREE.MeshLambertMaterial({ color: 0xff4d8d, emissive: 0xff4d8d, emissiveIntensity: 0.85 });
    const lobeMat = new THREE.MeshLambertMaterial({ color: 0xff8ad0, emissive: 0xff4d8d, emissiveIntensity: 0.55 });
    owned.add(brainMat);
    owned.add(lobeMat);
    const lobeGeo = new THREE.SphereGeometry(0.62, 28, 20);
    owned.add(lobeGeo);
    const left = new THREE.Mesh(lobeGeo, brainMat);
    left.scale.set(1, 0.82, 0.9);
    left.position.set(-0.28, 1.72, 0);
    left.name = "orb";
    const right = new THREE.Mesh(lobeGeo, lobeMat);
    right.scale.set(0.92, 0.78, 0.86);
    right.position.set(0.32, 1.66, 0.05);
    brain.add(left, right);
    const torusGeo = new THREE.TorusGeometry(1.35, 0.025, 8, 48);
    owned.add(torusGeo);
    const torusMat = new THREE.MeshBasicMaterial({ color: 0xff8ad0 });
    owned.add(torusMat);
    [0.4, 1.15].forEach((tilt, index) => {
      const ring = new THREE.Mesh(torusGeo, torusMat);
      ring.rotation.x = tilt;
      ring.rotation.y = index * 0.7;
      ring.position.y = 1.7;
      ring.userData.spin = 0.28 + index * 0.16;
      brain.add(ring);
      orbitRings.push(ring);
    });
    const floorRing = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.035, 8, 48), pinkBasic());
    owned.add(floorRing.geometry);
    floorRing.rotation.x = Math.PI / 2;
    floorRing.position.y = 0.07;
    brain.add(floorRing);
    brain.add(sign("Brand Brain", 2.5, 0.48, 0, 2.85, 0));
    addPick(brain, "brand-brain");
    scene.add(brain);
    built.push(brain);
    stationLight(0xff4d8d, 0, 2.2, 0);
    people.set("brand-brain", { id: "brand-brain", anchor: { x: 0, y: 3.35, z: 0 } });

    const platform = new THREE.Group();
    platform.add(put(box(6.4, 0.34, 6.4, lambert(0x1a1028)), 0, 0.18, 0));
    platform.add(put(box(6.7, 0.06, 6.7, pinkBasic()), 0, 0.38, 0));
    scene.add(platform);
    built.push(platform);
    stationLight(0xc040ff, 0, 2.4, 0.6);

    (plan.zones || []).forEach((zone) => {
      const members = zone.members || [];
      if (!members.length) return;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      members.forEach((seat) => {
        minX = Math.min(minX, seat.x);
        maxX = Math.max(maxX, seat.x);
        minZ = Math.min(minZ, seat.z);
        maxZ = Math.max(maxZ, seat.z);
      });
      const pad = new THREE.Group();
      const tint = new THREE.MeshLambertMaterial({ color: zone.color, emissive: zone.color, emissiveIntensity: 0.08 });
      owned.add(tint);
      const width = Math.max(members.length < 2 ? 6.2 : 3.4, maxX - minX + 2.4);
      const depth = Math.max(members.length < 2 ? 5.2 : 3.2, maxZ - minZ + 2.4);
      pad.add(put(box(width + 0.18, 0.05, depth + 0.18, pinkBasic()), (minX + maxX) / 2, 0.04, (minZ + maxZ) / 2));
      pad.add(put(box(width, 0.07, depth, tint), (minX + maxX) / 2, 0.08, (minZ + maxZ) / 2));
      scene.add(pad);
      built.push(pad);
      const chief = points[zone.chief];
      const rad = zone.angle * Math.PI / 180;
      const label = floorLabel(zone.title, Math.cos(rad) * 13.6, Math.sin(rad) * 13.6);
      scene.add(label);
      built.push(label);
      if (chief) stationLight(zone.color, chief.x, 1.6, chief.z);
    });

    const byKey = new Map((plan.seats || []).map((seat) => [seat.key, seat]));
    const roster = agents.filter((agent) => agent && agent.orgKey && byKey.has(agent.orgKey));
    const meetup = points.meetup || { x: 0, z: 0 };
    roster.forEach((agent, index) => {
      const seat = byKey.get(agent.orgKey);
      const len = Math.hypot(seat.x, seat.z) || 1;
      const face = yawOf(-seat.x, -seat.z);
      const y = seat.y || 0;
      const desk = new THREE.Group();
      desk.position.set(seat.x - (seat.x / len) * 0.42, y, seat.z - (seat.z / len) * 0.42);
      desk.rotation.y = face;
      const top = seat.role === "chief" ? 1.35 : 1.15;
      desk.add(put(box(top + 0.12, 0.05, 0.78, pinkBasic()), 0, 0.7, 0));
      desk.add(put(box(top, 0.07, 0.66, lambert(0x1a1024)), 0, 0.76, 0));
      desk.add(put(box(0.42, 0.28, 0.04, lambert(0xff4d8d)), 0, 1.05, -0.22));
      scene.add(desk);
      built.push(desk);
      const chair = makeChair();
      chair.position.set(seat.x, y, seat.z);
      chair.rotation.y = face;
      const sitter = makeSitter(hexOf(agent.color), true);
      sitter.position.set(seat.x, y, seat.z);
      sitter.rotation.y = face;
      scene.add(chair, sitter);
      built.push(chair, sitter);
      addPick(sitter, agent.id);
      const walker = makeWalker(hexOf(agent.color), true);
      walker.position.set(seat.x, 0, seat.z);
      walker.visible = false;
      addPick(walker, agent.id);
      scene.add(walker);
      built.push(walker);
      const angle = roster.length ? -Math.PI / 2 + (index / roster.length) * Math.PI * 2 : 0;
      const slot = { x: meetup.x + Math.cos(angle) * 1.8, z: meetup.z + Math.sin(angle) * 1.8 };
      people.set(agent.id, {
        id: agent.id,
        work: agent.work,
        errand: "",
        sitter,
        walker,
        seat: { x: seat.x, z: seat.z },
        pace: { x: seat.x, z: seat.z },
        face,
        path: [{ x: seat.x, z: seat.z }, { x: meetup.x, z: meetup.z }, slot],
        errands: {},
        slot,
        anchor: { x: seat.x, y: y + 1.65, z: seat.z }
      });
    });
    syncLaunchModes(agents);
  }

  function buildWorkforce() {
    const spec = (factoryPlan && factoryPlan.workforce) || { seats: [], edges: [], points: {}, overseer: null, brain: null };
    const points = spec.points || {};
    layoutPoints = points;
    const edge = (spec.radius || 8) + 4.2;
    officeBounds = { minX: -edge, maxX: edge, minZ: -edge, maxZ: edge };
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x100814, emissive: 0x1a0830, emissiveIntensity: 0.35 });
    owned.add(floorMat);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(edge * 2, edge * 2), floorMat);
    owned.add(floor.geometry);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    built.push(floor);
    const neon = (w, h, d, x, y, z) => {
      const mesh = put(box(w, h, d, pinkBasic()), x, y, z);
      scene.add(mesh);
      built.push(mesh);
    };
    neon(edge * 2, 0.06, 0.08, 0, 0.05, -edge);
    neon(edge * 2, 0.06, 0.08, 0, 0.05, edge);
    neon(0.08, 0.06, edge * 2, -edge, 0.05, 0);
    neon(0.08, 0.06, edge * 2, edge, 0.05, 0);
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x14081c, emissive: 0x220838, emissiveIntensity: 0.45 });
    owned.add(wallMat);
    const backWall = put(box(edge * 2, 6.2, 0.16, wallMat), 0, 3.1, -edge);
    const sideWall = put(box(0.16, 6.2, edge * 2, wallMat), -edge, 3.1, 0);
    scene.add(backWall, sideWall);
    built.push(backWall, sideWall);
    neon(edge * 2, 0.08, 0.1, 0, 6.2, -edge);
    neon(0.1, 0.08, edge * 2, -edge, 6.2, 0);

    function deskSign(role, detail, y) {
      const canvas = document.createElement("canvas");
      canvas.width = 768;
      canvas.height = 320;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, 768, 320);
      ctx.fillStyle = "rgba(8,6,14,0.84)";
      ctx.fillRect(10, 12, 748, 296);
      ctx.strokeStyle = "#ff4d8d";
      ctx.lineWidth = 8;
      ctx.strokeRect(16, 18, 736, 284);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff6fb";
      ctx.font = "800 62px sans-serif";
      ctx.fillText(String(role || "").slice(0, 24), 384, 108);
      ctx.fillStyle = "rgba(255,214,236,0.94)";
      ctx.font = "600 34px sans-serif";
      const words = String(detail || "").split(/\s+/).filter(Boolean);
      const lines = [];
      let line = "";
      words.forEach((word) => {
        const next = line ? line + " " + word : word;
        if (line && next.length > 36) {
          lines.push(line);
          line = word;
        } else line = next;
      });
      if (line) lines.push(line);
      lines.slice(0, 2).forEach((text, row) => ctx.fillText(text.slice(0, 40), 384, 188 + row * 46));
      const tex = new THREE.CanvasTexture(canvas);
      owned.add(tex);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      owned.add(mat);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.34), mat);
      owned.add(mesh.geometry);
      mesh.position.set(0, y || 3.15, 0);
      billboards.push(mesh);
      return mesh;
    }

    function placePad(seat, wide) {
      if (!seat || !seat.id) return;
      const color = hexOf(seat.color || "#ff4d8d");
      const pad = new THREE.Group();
      pad.position.set(seat.x || 0, 0, seat.z || 0);
      const w = wide || 3.5;
      const d = wide ? 3.1 : 2.7;
      pad.add(put(box(w + 0.16, 0.05, d + 0.16, pinkBasic()), 0, 0.04, 0));
      const tint = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.1 });
      owned.add(tint);
      pad.add(put(box(w, 0.08, d, tint), 0, 0.08, 0));
      pad.add(put(box(1.15, 0.08, 0.62, deskMat), 0.1, 0.62, 0.25));
      pad.add(deskSign(seat.role || "", seat.description || ""));
      addPick(pad, seat.id);
      scene.add(pad);
      built.push(pad);
      stationLight(color, seat.x || 0, 1.5, seat.z || 0);
      const len = Math.hypot(seat.x || 0, seat.z || 0) || 1;
      const face = seat.center ? yawOf(0.15, 1) : yawOf(-(seat.x || 0), -(seat.z || 0));
      const chair = makeChair();
      chair.position.set(seat.x || 0, 0, seat.z || 0);
      chair.rotation.y = face;
      const sitter = makeSitter(color, true);
      sitter.position.set(seat.x || 0, 0, seat.z || 0);
      sitter.rotation.y = face;
      scene.add(chair, sitter);
      built.push(chair, sitter);
      addPick(sitter, seat.id);
      const walker = makeWalker(color, true);
      walker.position.set(seat.x || 0, 0, seat.z || 0);
      walker.visible = false;
      addPick(walker, seat.id);
      scene.add(walker);
      built.push(walker);
      const desk = new THREE.Group();
      desk.position.set((seat.x || 0) - ((seat.x || 0) / len) * 0.35, seat.y || 0, (seat.z || 0) - ((seat.z || 0) / len) * 0.35);
      desk.rotation.y = face;
      desk.add(put(box(1.2, 0.05, 0.7, pinkBasic()), 0, 0.72, 0));
      desk.add(put(box(1.05, 0.06, 0.58, lambert(0x1a1024)), 0, 0.78, 0));
      scene.add(desk);
      built.push(desk);
      people.set(seat.id, {
        id: seat.id,
        work: "paused",
        errand: "",
        sitter,
        walker,
        seat: { x: seat.x || 0, z: seat.z || 0 },
        pace: { x: seat.x || 0, z: seat.z || 0 },
        face,
        path: [{ x: seat.x || 0, z: seat.z || 0 }],
        errands: {},
        slot: { x: seat.x || 0, z: seat.z || 0 },
        anchor: { x: seat.x || 0, y: 4.35, z: seat.z || 0 }
      });
    }

    (spec.seats || []).forEach((seat) => placePad(seat));
    if (spec.overseer) placePad(spec.overseer, 4.2);

    const brain = spec.brain || { id: "brand_brain", role: "", x: 0, y: 1.8, z: 0 };
    const brainGroup = new THREE.Group();
    brainGroup.position.set(brain.x || 0, 0, brain.z || 0);
    const brainMat = new THREE.MeshLambertMaterial({ color: 0xff4d8d, emissive: 0xff4d8d, emissiveIntensity: 0.85 });
    const lobeMat = new THREE.MeshLambertMaterial({ color: 0xff8ad0, emissive: 0xff4d8d, emissiveIntensity: 0.55 });
    owned.add(brainMat);
    owned.add(lobeMat);
    const lobeGeo = new THREE.SphereGeometry(0.58, 28, 20);
    owned.add(lobeGeo);
    const left = new THREE.Mesh(lobeGeo, brainMat);
    left.scale.set(1, 0.82, 0.9);
    left.position.set(-0.26, 1.7, 0);
    left.name = "orb";
    const right = new THREE.Mesh(lobeGeo, lobeMat);
    right.scale.set(0.92, 0.78, 0.86);
    right.position.set(0.3, 1.64, 0.04);
    brainGroup.add(left, right);
    brainGroup.add(deskSign(brain.role || "", brain.description || "", 3.55));
    addPick(brainGroup, brain.id);
    scene.add(brainGroup);
    built.push(brainGroup);
    people.set(brain.id, { id: brain.id, anchor: { x: brain.x || 0, y: 4.85, z: brain.z || 0 } });

    const lineMat = new THREE.LineDashedMaterial({ color: 0xff4d8d, dashSize: 0.42, gapSize: 0.2, transparent: true, opacity: 0.9 });
    owned.add(lineMat);
    (spec.edges || []).forEach((edge) => {
      const from = points[edge.from];
      const to = points[edge.to];
      if (!from || !to) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute([from.x, 0.28, from.z, to.x, 0.28, to.z], 3));
      owned.add(geo);
      const line = new THREE.Line(geo, lineMat);
      line.computeLineDistances();
      scene.add(line);
      built.push(line);
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const len = Math.hypot(dx, dz) || 1;
      const head = put(box(0.28, 0.08, 0.42, pinkBasic()), to.x - (dx / len) * 0.9, 0.32, to.z - (dz / len) * 0.9);
      head.rotation.y = Math.atan2(dx, dz);
      scene.add(head);
      built.push(head);
      // Route names stay on the legend line. A plate on the floor was too
      // small to read at the overview zoom, so the dashed edge keeps the path.
      line.userData.step = edge.label || "";
      const rocketMat = new THREE.MeshBasicMaterial({ color: edge.kind === "handoff" ? 0xffe56a : 0xfff6ea });
      owned.add(rocketMat);
      const rocket = new THREE.Mesh(sphereGeo(0.16), rocketMat);
      rocket.position.set(from.x, 1.05, from.z);
      rocket.visible = false;
      scene.add(rocket);
      built.push(rocket);
      launchItems.push({
        id: edge.from + ">" + edge.to,
        from: { x: from.x, y: 0.4, z: from.z },
        to: { x: to.x, y: 0.4, z: to.z },
        mesh: rocket,
        mode: "rest",
        offset: launchItems.length * 0.17
      });
    });
    applyWorkforceMotion();
  }

  function build(agents) {
    clearBuilt();
    layoutPoints = null;
    if (factoryMode && factoryPlan && factoryPlan.kind === "workforce") {
      buildWorkforce(agents);
      resize();
      return;
    }
    if (factoryMode && factoryPlan && factoryPlan.kind === "org") {
      buildOrg(agents);
      resize();
      return;
    }
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

  function stageSamples() {
    const samples = [
      [officeBounds.minX, 0, officeBounds.minZ],
      [officeBounds.maxX, 0, officeBounds.minZ],
      [officeBounds.minX, 0, officeBounds.maxZ],
      [officeBounds.maxX, 0, officeBounds.maxZ]
    ];
    if (layoutPoints) {
      Object.values(layoutPoints).forEach((spot) => samples.push([spot.x, spot.y || 0, spot.z]));
    }
    return samples;
  }

  function stageTarget() {
    return new THREE.Vector3(
      (officeBounds.minX + officeBounds.maxX) / 2,
      0.8,
      (officeBounds.minZ + officeBounds.maxZ) / 2
    );
  }

  function fitKey() {
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    const rosterKey = factoryPlan && factoryPlan.kind === "org" ? people.size : 0;
    return [width, height, officeBounds.minX, officeBounds.maxX, officeBounds.minZ, officeBounds.maxZ, focusId, rosterKey].join(":");
  }

  function fitStage() {
    const target = stageTarget();
    controls.target.copy(target);
    const dir = new THREE.Vector3(1, 0.78, 1).normalize();
    const floor = [
      [officeBounds.minX, 0.2, officeBounds.minZ],
      [officeBounds.maxX, 0.2, officeBounds.minZ],
      [officeBounds.minX, 0.2, officeBounds.maxZ],
      [officeBounds.maxX, 0.2, officeBounds.maxZ]
    ];
    const tall = floor.concat([
      [officeBounds.minX, 5.4, officeBounds.minZ],
      [officeBounds.maxX, 5.4, officeBounds.minZ]
    ]);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    const portrait = (host.clientHeight || 1) > (host.clientWidth || 1);
    const workforce = factoryPlan && factoryPlan.kind === "workforce";
    const seats = [];
    if (factoryPlan && ((portrait && factoryPlan.kind === "org") || workforce)) {
      people.forEach((person) => {
        if (!person || !person.anchor) return;
        seats.push([person.anchor.x, person.anchor.y, person.anchor.z]);
        if (person.seat) seats.push([person.seat.x, 0.2, person.seat.z]);
      });
    }
    let xLimit = 0.85;
    let yLimit = 0.9;
    let xSamples = floor;
    let heightSamples = tall;
    if (seats.length > 1) {
      const gutter = workforce ? 8 + 64 : 8 + 40;
      const rise = workforce ? 8 + (portrait ? 36 : 120) : 8 + 30;
      xLimit = Math.max(0.45, 1 - (gutter * 2) / Math.max(host.clientWidth || 1, 1));
      yLimit = Math.max(0.55, 1 - (rise * 2) / Math.max(host.clientHeight || 1, 1));
      xSamples = seats;
      heightSamples = seats;
    } else if (portrait) {
      xLimit = 3.2;
      yLimit = 0.72;
      heightSamples = floor;
    }
    let lo = 10;
    let hi = 150;
    let best = 150;
    for (let step = 0; step < 18; step += 1) {
      const dist = (lo + hi) / 2;
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      let maxX = 0;
      let maxY = 0;
      xSamples.forEach(([x, y, z]) => {
        projector.set(x, y, z);
        projector.project(camera);
        maxX = Math.max(maxX, Math.abs(projector.x));
      });
      heightSamples.forEach(([x, y, z]) => {
        projector.set(x, y, z);
        projector.project(camera);
        maxY = Math.max(maxY, Math.abs(projector.y));
      });
      if (maxX > xLimit || maxY > yLimit) lo = dist;
      else {
        best = dist;
        hi = dist;
      }
    }
    camera.position.copy(target).addScaledVector(dir, best);
    controls.minDistance = 8;
    controls.maxDistance = 160;
    controls.update();
    faceBillboards();
  }

  function resize() {
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    const narrow = narrowQuery.matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, narrow ? 1.25 : 1.5));
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    const key = fitKey();
    if (key === fittedKey) return;
    fittedKey = key;
    if (focusId === "overview") fitStage();
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
    if (!point) return { x: 0, y: 0.7, z: 0 };
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
    orbitRings.forEach((ring) => {
      if (reduceMotion) return;
      ring.rotation.z += (ring.userData.spin || 0.4) * 0.01;
    });
    tetherEnds.forEach((end) => {
      if (!end.follow) return;
      const person = people.get(end.follow);
      const body = person && (person.walker.visible ? person.walker : person.sitter);
      if (!body) return;
      body.getWorldPosition(end.scratch);
      end.x = end.scratch.x;
      end.y = end.scratch.y + 0.55;
      end.z = end.scratch.z;
      end.positions.setXYZ(1, end.x, end.y, end.z);
      end.positions.needsUpdate = true;
    });
    motes.forEach((mote) => {
      mote.t = (mote.t + 0.0045) % 1;
      const t = mote.t;
      const end = mote.end;
      mote.mesh.position.set(
        mote.ax + (end.x - mote.ax) * t,
        mote.ay + (end.y - mote.ay) * t,
        mote.az + (end.z - mote.az) * t
      );
    });
    faceBillboards();
    flyRockets(elapsed);
    const orb = scene.getObjectByName("orb");
    if (orb && !reduceMotion) {
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
    if (hooks.onFrame) hooks.onFrame({
      labels: projectLabels(),
      phase,
      focus: focusId,
      distance: camera.position.distanceTo(controls.target)
    });
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
      const key = agents.map((agent) => agent.id + (agent.outside ? ":o" : ":i") + ":" + agent.color + ":" + (agent.home || "") + ":" + (agent.orgKey || "") + ":" + (agent.packet || "")).join("|");
      if (key !== builtKey) {
        build(agents);
        builtKey = key;
      }
      if (factoryPlan && factoryPlan.kind === "org") syncLaunchModes(agents);
      if (factoryPlan && factoryPlan.kind === "workforce") {
        agents.forEach((agent) => {
          const person = people.get(agent.id);
          if (person) person.work = agent.work || "paused";
        });
        applyWorkforceMotion();
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
    setMotions(list) {
      workforceMotions = Array.isArray(list) ? list : [];
      if (factoryPlan && factoryPlan.kind === "workforce") applyWorkforceMotion();
    },
    focus(id) {
      const next = id && layoutPoints && layoutPoints[id] ? id : "overview";
      focusId = next;
      fittedKey = fitKey();
      if (next === "overview") {
        camera.zoom = 1;
        camera.updateProjectionMatrix();
        fitStage();
        return;
      }
      const spot = layoutPoints[next];
      const target = new THREE.Vector3(spot.x, (spot.y || 0) + 0.9, spot.z);
      controls.target.copy(target);
      const dir = new THREE.Vector3(1, 0.7, 1).normalize();
      const dist = narrowQuery.matches ? 22 : 18;
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      camera.position.copy(target).addScaledVector(dir, dist);
      controls.update();
      faceBillboards();
    },
    setPosts(count) {
      const next = Math.max(0, Math.round(Number(count) || 0));
      if (next === postsCount) return;
      postsCount = next;
      if (postsSign && postsSign.userData.paint) postsSign.userData.paint("YOUR POSTS  " + postsCount);
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
