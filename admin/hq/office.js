const DEPT_ORDER = ["Growth", "Marketing", "Sales", "Delivery & Finance"];
const DEPT_COLORS = {
  Growth: 0xff7a18,
  Marketing: 0xff5470,
  Sales: 0xc0409a,
  "Delivery & Finance": 0xc04ad0,
  Executive: 0xff2d95,
  Outside: 0x555a66
};

let threePromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-hq-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") resolve();
      else existing.addEventListener("load", () => resolve(), { once: true });
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

function colorOf(agent) {
  const text = agent.avatarColor || agent.color || "";
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return parseInt(text.slice(1), 16);
  return DEPT_COLORS[agent.department] || 0xff7a18;
}

function shortTitle(agent) {
  const title = String(agent.title || "");
  if (!title || title.startsWith("UNKNOWN")) return agent.outside ? "Outside the org" : "";
  return title;
}

export async function createOffice(host, initialAgents, hooks) {
  let roster = initialAgents.slice();
  const THREE = await loadThree();
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch { /* labels fall back to a system font */ }
  }
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  if (!renderer.getContext()) {
    renderer.dispose();
    throw new Error("WebGL is not available.");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1220);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);
  camera.position.set(-3, 30, 27);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(1.5, 0, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = 1.25;
  controls.minDistance = 10;
  controls.maxDistance = 70;

  const sharedGeo = new Set();
  const sharedMat = new Set();
  const geos = {};
  const mats = {};
  const boxGeo = (w, h, d) => {
    const key = w + "x" + h + "x" + d;
    if (!geos[key]) {
      geos[key] = new THREE.BoxGeometry(w, h, d);
      sharedGeo.add(geos[key]);
    }
    return geos[key];
  };
  const lambert = (color) => {
    const key = String(color);
    if (!mats[key]) {
      mats[key] = new THREE.MeshLambertMaterial({ color });
      sharedMat.add(mats[key]);
    }
    return mats[key];
  };
  const glass = new THREE.MeshLambertMaterial({ color: 0x7fa0d0, transparent: true, opacity: 0.13, depthWrite: false });
  sharedMat.add(glass);
  const G = {
    torso: new THREE.CylinderGeometry(0.24, 0.3, 0.6, 8),
    head: new THREE.BoxGeometry(0.48, 0.38, 0.42),
    visor: new THREE.BoxGeometry(0.4, 0.14, 0.02),
    ant: new THREE.CylinderGeometry(0.015, 0.015, 0.22, 4),
    tip: new THREE.SphereGeometry(0.05, 8, 6),
    halo: new THREE.TorusGeometry(0.26, 0.025, 6, 24),
    arm: new THREE.BoxGeometry(0.09, 0.09, 0.42),
    leg: new THREE.BoxGeometry(0.12, 0.4, 0.12),
    holo: new THREE.PlaneGeometry(0.75, 0.45),
    core: new THREE.SphereGeometry(0.07, 8, 6),
    plant: new THREE.SphereGeometry(0.45, 7, 5)
  };
  Object.values(G).forEach((geo) => sharedGeo.add(geo));
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2133, roughness: 0.5, metalness: 0.6 });
  sharedMat.add(dark);

  function holoTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 80;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 128, 0);
    gradient.addColorStop(0, "rgba(255,122,24,.55)");
    gradient.addColorStop(1, "rgba(255,45,149,.55)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 80);
    ctx.fillStyle = "rgba(255,255,255,.8)";
    for (let i = 0; i < 6; i += 1) ctx.fillRect(10, 10 + i * 11, 30 + ((i * 37) % 70), 4);
    ctx.strokeStyle = "#fff";
    ctx.strokeRect(1, 1, 126, 78);
    return new THREE.CanvasTexture(canvas);
  }
  const holoMap = holoTexture();

  const pick = [];
  const avatars = [];
  const placed = new Map();
  let disposed = false;
  let raf = 0;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function box(w, h, d, color, x, y, z, parent) {
    const mesh = new THREE.Mesh(boxGeo(w, h, d), lambert(color));
    mesh.position.set(x || 0, y || 0, z || 0);
    (parent || scene).add(mesh);
    return mesh;
  }

  function wall(width, x, z, rot) {
    const mesh = new THREE.Mesh(boxGeo(width, 1.6, 0.06), glass);
    mesh.position.set(x, 0.8, z);
    mesh.rotation.y = rot || 0;
    scene.add(mesh);
    const trim = box(width, 0.05, 0.08, 0x8fb0e0, x, 1.6, z);
    trim.rotation.y = rot || 0;
  }

  function sprite(lines, opts) {
    const options = opts || {};
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = options.h || 128;
    const ctx = canvas.getContext("2d");
    ctx.textAlign = "center";
    if (options.header) {
      ctx.fillStyle = "#0d1220";
      ctx.fillRect(0, 0, 512, canvas.height);
      ctx.strokeStyle = "#ff2d95";
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, 506, canvas.height - 6);
      const gradient = ctx.createLinearGradient(0, 0, 512, 0);
      gradient.addColorStop(0, "#ff7a18");
      gradient.addColorStop(1, "#ff2d95");
      ctx.fillStyle = gradient;
      let size = 56;
      do {
        ctx.font = "800 " + size + "px Bricolage Grotesque, sans-serif";
        size -= 2;
      } while (ctx.measureText(lines[0]).width > 470 && size > 18);
      ctx.textBaseline = "middle";
      ctx.fillText(lines[0], 256, canvas.height / 2 + 2);
    } else {
      ctx.fillStyle = "rgba(8,10,20,.72)";
      ctx.fillRect(40, 8, 432, lines[1] ? 108 : 68);
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      let size = 36;
      do {
        ctx.font = "700 " + size + "px Bricolage Grotesque, sans-serif";
        size -= 2;
      } while (ctx.measureText(lines[0]).width > 450 && size > 16);
      ctx.fillText(lines[0], 256, lines[1] ? 42 : 42);
      if (lines[1]) {
        ctx.fillStyle = "#ff9a55";
        ctx.font = "24px Instrument Sans, sans-serif";
        ctx.fillText(lines[1], 256, 86);
      }
    }
    const map = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map, depthTest: false, transparent: true });
    const node = new THREE.Sprite(material);
    node.scale.set(options.header ? 4 : 3.2, options.header ? 0.86 : 0.9, 1);
    node.renderOrder = 10;
    scene.add(node);
    return node;
  }

  function bubble(text, bg) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 72px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 64, 70);
    const material = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true });
    const node = new THREE.Sprite(material);
    node.scale.set(0.7, 0.7, 1);
    node.renderOrder = 11;
    scene.add(node);
    return node;
  }

  function desk(x, z, lead, accent) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    scene.add(group);
    const width = lead ? 2.4 : 1.5;
    box(width, 0.08, 0.8, lead ? 0xd8dde8 : 0x3a55c8, 0, 0.75, 0, group);
    box(0.08, 0.75, 0.7, 0x2a3350, -width / 2 + 0.06, 0.37, 0, group);
    box(0.08, 0.75, 0.7, 0x2a3350, width / 2 - 0.06, 0.37, 0, group);
    const screens = lead ? 3 : 1;
    for (let i = 0; i < screens; i += 1) {
      const sx = (i - (screens - 1) / 2) * 0.68;
      box(0.6, 0.38, 0.04, 0x0b0f1a, sx, 1.05, -0.28, group);
      const screen = box(0.54, 0.32, 0.01, accent, sx, 1.05, -0.25, group);
      screen.material = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.55 });
    }
    box(0.55, 0.08, 0.55, 0x22305a, 0, 0.45, 0.7, group);
    box(0.55, 0.5, 0.08, 0x22305a, 0, 0.75, 0.97, group);
  }

  function avatar(agent, x, z, color) {
    const work = agent.work || "idle";
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    scene.add(group);
    const body = new THREE.MeshStandardMaterial({ color: 0xdfe3ee, roughness: 0.35, metalness: 0.5 });
    const torso = new THREE.Mesh(G.torso, body);
    torso.position.y = 0.85;
    group.add(torso);
    const emissive = (value, intensity) => new THREE.MeshStandardMaterial({
      color: 0x111522,
      emissive: value,
      emissiveIntensity: intensity,
      roughness: 0.4,
      metalness: 0.3
    });
    const core = new THREE.Mesh(G.core, emissive(color, 1.6));
    core.position.set(0, 0.92, -0.27);
    group.add(core);
    const legs = [-1, 1].map((side) => {
      const leg = new THREE.Mesh(G.leg, dark);
      leg.position.set(side * 0.1, 0.35, 0);
      group.add(leg);
      return leg;
    });
    const headGroup = new THREE.Group();
    headGroup.position.y = 1.38;
    group.add(headGroup);
    headGroup.add(new THREE.Mesh(G.head, body));
    const visorMat = emissive(color, work === "idle" || work === "paused" ? 0.35 : 1.8);
    const visor = new THREE.Mesh(G.visor, visorMat);
    visor.position.set(0, 0.02, -0.215);
    headGroup.add(visor);
    const antenna = new THREE.Mesh(G.ant, dark);
    antenna.position.set(0.14, 0.3, 0);
    headGroup.add(antenna);
    const tip = new THREE.Mesh(G.tip, emissive(0xff2d95, 2));
    tip.position.set(0.14, 0.42, 0);
    headGroup.add(tip);
    const halo = new THREE.Mesh(G.halo, emissive(0xff7a18, 1.5));
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.36;
    headGroup.add(halo);
    const arms = [-1, 1].map((side) => {
      const arm = new THREE.Mesh(G.arm, dark);
      arm.position.set(side * 0.32, 0.98, -0.15);
      group.add(arm);
      return arm;
    });
    const holo = new THREE.Mesh(G.holo, new THREE.MeshBasicMaterial({
      map: holoMap,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false
    }));
    holo.position.set(0, 1.15, -0.6);
    holo.visible = work === "typing" || work === "needs";
    group.add(holo);
    const label = sprite([agent.name, shortTitle(agent)]);
    let mark = null;
    if (work === "needs") mark = bubble("!", "#e02424");
    else if (work === "blocked") mark = bubble("!", "#e8b04a");
    else if (work === "idle" || work === "paused") mark = bubble("Z", "#475069");
    const hit = new THREE.Mesh(boxGeo(1, 2, 1), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 1;
    hit.userData = { id: agent.id, name: agent.name, body, base: body.color.clone(), group };
    group.add(hit);
    pick.push(hit);
    const record = {
      id: agent.id,
      work,
      group,
      head: headGroup,
      arms,
      legs,
      holo,
      halo,
      visor: visorMat,
      label,
      mark,
      phase: Math.random() * 6,
      target: null,
      bounds: null
    };
    avatars.push(record);
    placed.set(agent.id, record);
    return record;
  }

  function furnish() {
    scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x0a0d18, 1));
    const sun = new THREE.DirectionalLight(0xffffff, 0.55);
    sun.position.set(-8, 20, 10);
    scene.add(sun);
    const FW = 36;
    const FD = 26;
    box(FW, 0.3, FD, 0x141b2e, 0, -0.15, 0);
    const grid = new THREE.GridHelper(36, 36, 0x1e2740, 0x1a2238);
    grid.scale.z = FD / FW;
    grid.position.y = 0.01;
    scene.add(grid);
    wall(FW, 0, -FD / 2);
    wall(FW, 0, FD / 2);
    wall(FD, -FW / 2, 0, Math.PI / 2);
    wall(FD, FW / 2, 0, Math.PI / 2);

    const people = roster.filter((agent) => agent && agent.id !== "diego");
    const rooms = DEPT_ORDER.map((name) => ({
      name,
      color: DEPT_COLORS[name],
      members: people.filter((agent) => !agent.outside && agent.department === name)
        .sort((a, b) => Number(b.lead) - Number(a.lead) || (a.sort || 0) - (b.sort || 0))
    }));
    const RW = 8;
    const RD = 9;
    const rz = -FD / 2 + RD / 2 + 0.5;
    rooms.forEach((room, index) => {
      const cx = -FW / 2 + 1 + RW / 2 + index * (RW + 0.6);
      wall(RW, cx, rz + RD / 2);
      wall(RD, cx - RW / 2, rz, Math.PI / 2);
      wall(RD, cx + RW / 2, rz, Math.PI / 2);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(RW, RD), new THREE.MeshBasicMaterial({ color: 0x111829 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(cx, 0.02, rz);
      scene.add(floor);
      const header = sprite([room.name.toUpperCase()], { header: true, h: 110 });
      header.position.set(cx, 2.6, rz - RD / 2 + 0.3);
      desk(cx, rz - RD / 2 + 1.5, true, room.color);
      for (let row = 0; row < 3; row += 1) {
        [-1, 1].forEach((side) => desk(cx + side * 2.6, rz - 1 + row * 2.2, false, room.color));
      }
      const slots = [
        [cx, rz - RD / 2 + 2.2],
        [cx + 2.6, rz - 0.3],
        [cx - 2.6, rz - 0.3],
        [cx + 2.6, rz + 1.9],
        [cx - 2.6, rz + 1.9]
      ];
      room.members.forEach((agent, member) => {
        const slot = slots[Math.min(member, slots.length - 1)];
        const record = avatar(agent, slot[0], slot[1], colorOf(agent) || room.color);
        if (record.work === "idle") record.bounds = [cx - RW / 2 + 0.8, cx + RW / 2 - 0.8, rz - 1.5, rz + RD / 2 - 0.8];
      });
    });

    const ex = 0;
    const ez = 4.2;
    wall(10, ex, ez - 3);
    wall(6, ex - 5, ez, Math.PI / 2);
    wall(6, ex + 5, ez, Math.PI / 2);
    const execHeader = sprite(["EXECUTIVE"], { header: true, h: 110 });
    execHeader.position.set(ex, 2.6, ez - 2.7);
    desk(ex, ez - 1.2, true, 0xff2d95);
    desk(ex, ez + 1.8, true, 0xff7a18);
    const execs = people.filter((agent) => !agent.outside && agent.department === "Executive")
      .sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const chief = execs[0];
    if (chief) avatar(chief, ex, ez - 0.5, colorOf(chief));
    avatar({ id: "diego", name: "Diego Castanedo", title: "CEO", work: "typing" }, ex, ez + 2.5, 0xe8b04a);
    execs.slice(1).forEach((agent, index) => avatar(agent, ex + (index % 2 === 0 ? -2.2 : 2.2), ez + 0.4, colorOf(agent)));

    const pool = new THREE.Group();
    pool.position.set(-11, 0, 5);
    scene.add(pool);
    box(2.4, 0.7, 4, 0x3a2418, 0, 0.35, 0, pool);
    box(2.1, 0.06, 3.7, 0x2d4fd0, 0, 0.72, 0, pool);
    const pong = new THREE.Group();
    pong.position.set(11, 0, 5);
    scene.add(pong);
    box(3.6, 0.06, 2, 0x2d4fd0, 0, 0.75, 0, pong);
    box(0.04, 0.2, 2, 0xffffff, 0, 0.88, 0, pong);
    [-1.5, 1.5].forEach((side) => box(0.1, 0.75, 1.6, 0x222222, side, 0.37, 0, pong));
    const sofa = new THREE.Group();
    sofa.position.set(-6, 0, 10.5);
    scene.add(sofa);
    box(4, 0.45, 1.2, 0x5a7a8c, 0, 0.25, 0, sofa);
    box(4, 0.7, 0.3, 0x5a7a8c, 0, 0.6, 0.5, sofa);
    box(1.2, 0.45, 2.4, 0x5a7a8c, 1.4, 0.25, -1.2, sofa);
    const table = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.1, 20), lambert(0x8a96b0));
    table.position.set(8, 0.75, 10.5);
    scene.add(table);
    box(0.2, 0.75, 0.2, 0x333333, 8, 0.37, 10.5);
    for (let k = 0; k < 6; k += 1) {
      const angle = k / 6 * Math.PI * 2;
      box(0.5, 0.5, 0.5, 0x22305a, 8 + Math.cos(angle) * 2.2, 0.3, 10.5 + Math.sin(angle) * 2.2);
    }
    [[-17, -12.3], [17, -12.3], [-17, 12.3], [17, 12.3], [-3, 12], [3, 12], [-14, 0.5], [14, 0.5]].forEach(([x, z]) => {
      box(0.4, 0.4, 0.4, 0x3a3346, x, 0.2, z);
      const plant = new THREE.Mesh(G.plant, lambert(0x2f7a55));
      plant.position.set(x, 0.8, z);
      scene.add(plant);
    });

    people.filter((agent) => agent.outside).forEach((agent, index) => {
      const x = FW / 2 + 3.5;
      const z = 8 - index * 3.2;
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: 0x1a1a1f }));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(x, 0.01, z);
      scene.add(pad);
      if (index === 0) {
        const header = sprite(["NON-ROLEFLOW"], { header: true, h: 110 });
        header.position.set(x, 2.4, z - 1.7);
        header.scale.set(2.6, 0.56, 1);
      }
      desk(x, z, false, 0x666666);
      avatar(agent, x, z + 0.7, colorOf(agent));
    });
  }

  function wipe() {
    scene.traverse((node) => {
      if (node.geometry && !sharedGeo.has(node.geometry)) node.geometry.dispose();
      const list = node.material ? [].concat(node.material) : [];
      list.forEach((material) => {
        if (!material || sharedMat.has(material)) return;
        if (material.map && material.map !== holoMap) material.map.dispose();
        material.dispose();
      });
    });
    while (scene.children.length) scene.remove(scene.children[0]);
    pick.length = 0;
    avatars.length = 0;
    placed.clear();
  }

  function rebuild(next) {
    const position = camera.position.clone();
    const target = controls.target.clone();
    const hadScene = scene.children.length > 0;
    roster = next.slice();
    wipe();
    furnish();
    if (hadScene) {
      camera.position.copy(position);
      controls.target.copy(target);
    }
  }

  furnish();

  const tip = document.createElement("div");
  tip.className = "hq-tip";
  tip.hidden = true;
  document.body.append(tip);
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = null;
  let down = null;

  function hitAt(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(pick)[0];
    return hit ? hit.object : null;
  }

  function onMove(event) {
    const next = hitAt(event);
    if (hovered && hovered !== next) {
      hovered.userData.body.color.copy(hovered.userData.base);
      hovered.userData.group.scale.setScalar(1);
    }
    hovered = next;
    if (next) {
      next.userData.body.color.set(0xffd6ec);
      next.userData.group.scale.setScalar(1.12);
      tip.hidden = false;
      tip.style.left = event.clientX + 12 + "px";
      tip.style.top = event.clientY + 12 + "px";
      tip.textContent = next.userData.name + " — click to assign work";
      renderer.domElement.style.cursor = "pointer";
    } else {
      tip.hidden = true;
      renderer.domElement.style.cursor = "";
    }
  }
  function onDown(event) { down = [event.clientX, event.clientY]; }
  function onUp(event) {
    if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return;
    const next = hitAt(event);
    if (next) hooks.onSelect(next.userData.id);
  }
  renderer.domElement.addEventListener("pointermove", onMove);
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);

  const zoom = document.createElement("div");
  zoom.className = "hq-zoom";
  zoom.innerHTML = '<button type="button" aria-label="Zoom in">+</button><button type="button" aria-label="Zoom out">−</button>';
  const [zoomIn, zoomOut] = zoom.querySelectorAll("button");
  const dolly = (factor) => camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target);
  zoomIn.addEventListener("click", () => dolly(0.85));
  zoomOut.addEventListener("click", () => dolly(1.18));
  (host.parentElement || host).append(zoom);

  function resize() {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  function animate(now) {
    if (disposed) return;
    raf = requestAnimationFrame(animate);
    if (document.hidden) return;
    const t = now / 1000;
    avatars.forEach((record) => {
      const position = record.group.position;
      record.halo.rotation.z = t * 1.5 + record.phase;
      if (!reduce && record.bounds && record.work === "idle") {
        if (!record.target || position.distanceTo(record.target) < 0.15) {
          const [x0, x1, z0, z1] = record.bounds;
          record.target = new THREE.Vector3(x0 + Math.random() * (x1 - x0), 0, z0 + Math.random() * (z1 - z0));
        }
        const delta = record.target.clone().sub(position);
        delta.y = 0;
        const step = Math.min(delta.length(), 0.016 * 1.1);
        if (delta.length() > 0.001) {
          delta.normalize();
          position.addScaledVector(delta, step);
          record.group.rotation.y = Math.atan2(-delta.x, -delta.z);
        }
        const swing = Math.sin(t * 8 + record.phase);
        record.legs[0].rotation.x = swing * 0.5;
        record.legs[1].rotation.x = -swing * 0.5;
        record.arms[0].rotation.x = -swing * 0.4;
        record.arms[1].rotation.x = swing * 0.4;
        position.y = Math.abs(swing) * 0.04;
      } else if (record.work === "typing") {
        record.arms[0].position.y = 0.98 + Math.sin(t * 16 + record.phase) * 0.03;
        record.arms[1].position.y = 0.98 + Math.cos(t * 16 + record.phase) * 0.03;
        record.head.rotation.x = 0.12;
        record.holo.material.opacity = 0.7 + 0.2 * Math.sin(t * 4 + record.phase);
        record.visor.emissiveIntensity = 1.5 + 0.4 * Math.sin(t * 6);
      } else if (!reduce) {
        record.head.rotation.y = Math.sin(t * 1.5 + record.phase) * 0.4;
        position.y = Math.sin(t * 2 + record.phase) * 0.02;
      }
      record.label.position.set(position.x, 2.55, position.z);
      if (record.mark) {
        const scale = record.work === "needs" ? 0.7 + Math.sin(t * 5) * 0.07 : 0.6;
        record.mark.scale.set(scale, scale, 1);
        record.mark.position.set(position.x + 0.5, 2.05, position.z);
      }
    });
    controls.update();
    renderer.render(scene, camera);
  }
  controls.update();
  renderer.render(scene, camera);
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    window.__hqProject = (id) => {
      const record = placed.get(id);
      if (!record) return null;
      const vector = record.group.position.clone();
      vector.y = 1.1;
      vector.project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return {
        x: (vector.x * 0.5 + 0.5) * rect.width + rect.left,
        y: (-vector.y * 0.5 + 0.5) * rect.height + rect.top
      };
    };
  }
  window.__hqOfficeReady = true;
  raf = requestAnimationFrame(animate);

  return {
    update(next) {
      if (disposed) return;
      rebuild(next || []);
    },
    focus(id) {
      const record = placed.get(id);
      if (!record) return;
      const position = record.group.position;
      controls.target.set(position.x, 1, position.z);
      camera.position.set(position.x - 6, 10, position.z + 8);
    },
    resize,
    destroy() {
      disposed = true;
      if (window.__hqProject) window.__hqProject = null;
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      tip.remove();
      zoom.remove();
      wipe();
      holoMap.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
  };
}
