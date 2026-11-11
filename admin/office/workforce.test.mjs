import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canvasForWindow,
  fitLabels,
  labelsFit,
  layoutOffice,
  loadOfficeConfig,
  officeConfigWithStations,
  projectWorkforce,
  routeSummary,
  SIGN_HALF_WIDTH,
  validateOfficeConfig,
  VAM_BUSINESS_ID,
  workforceSignNodes
} from "./workforce-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const PHONE = { width: 390, height: 420 };

const template = await loadOfficeConfig(VAM_BUSINESS_ID);
const again = await loadOfficeConfig("00000000-0000-4000-8000-000000000002");
assert.deepEqual(again, template);
template.stations[0].role = "Changed";
const fresh = await loadOfficeConfig(VAM_BUSINESS_ID);
assert.equal(fresh.stations[0].role, "DM Setter");
assert.equal(fresh.overseer.role, "Chief of Staff");
assert.equal(fresh.brandBrain.role, "Brand Brain");
assert.equal(fresh.stations.length, 5);
assert.ok(fresh.edges.length >= 8);
assert.match(routeSummary(fresh), /Outreach → DM Setter → Follow-ups/);
assert.match(routeSummary(fresh), /all → Stats Tracking/);

const valid = validateOfficeConfig(fresh);
assert.equal(valid.ok, true, valid.errors && valid.errors.join("; "));
assert.equal(valid.value.stations[3].role, "Target Comments");
assert.ok(valid.value.edges.every((edge) => edge.label.startsWith("Next step:")));

function reject(config, pattern) {
  const result = validateOfficeConfig(config);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), pattern);
}

reject(null, /object/);
reject({ overseer: { id: "overseer", role: "Chief", description: "Sends work." } }, /stations/);
const broken = structuredClone(fresh);
broken.stations[1].description = "  ";
reject(broken, /description/);
broken.stations[1].description = "Quiet threads.";
broken.edges.push({ from: "outreach", to: "missing", kind: "handoff", label: "Next step: Missing" });
reject(broken, /not a station/);
const loop = structuredClone(fresh);
loop.edges.push({ from: "stats", to: "stats", kind: "read", label: "Next step: Stats Tracking" });
reject(loop, /itself/);
const dup = structuredClone(fresh);
dup.stations.push(Object.assign({}, dup.stations[0]));
reject(dup, /duplicates id/);

function assertPhone(config, count) {
  const checked = validateOfficeConfig(config);
  assert.equal(checked.ok, true, checked.errors && checked.errors.join("; "));
  const layout = layoutOffice(checked.value);
  const boxes = fitLabels(layout, PHONE);
  assert.equal(boxes.length, count + 2, count + "-station label count");
  assert.equal(labelsFit(boxes, PHONE), true, count + " stations overflow or overlap at 390px");
  const ids = new Set(boxes.map((box) => box.id));
  assert.ok(ids.has(checked.value.overseer.id));
  assert.ok(ids.has(checked.value.brandBrain.id));
  checked.value.stations.forEach((station) => assert.ok(ids.has(station.id), station.id));
  boxes.forEach((box) => {
    assert.ok(box.w > 0 && box.h > 0);
    assert.ok(box.x >= 0 && box.y >= 0);
    assert.ok(box.x + box.w <= PHONE.width);
    assert.ok(box.y + box.h <= PHONE.height);
  });
}

assertPhone(fresh, 5);
assertPhone(officeConfigWithStations(3), 3);
assertPhone(officeConfigWithStations(7), 7);

function rectsOverlap(a, b) {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return overlapX > 0.5 && overlapY > 0.5;
}

function assertDesktop(config, label) {
  const checked = validateOfficeConfig(config);
  assert.equal(checked.ok, true, checked.errors && checked.errors.join("; "));
  const canvas = canvasForWindow(1440, 900);
  assert.equal(canvas.width, 1192, "1440 window stage width");
  assert.equal(canvas.height, 900);
  const layout = layoutOffice(checked.value);
  const frame = projectWorkforce(layout, canvas);
  const boxes = frame.signs.map((box) => Object.assign({ kind: "sign" }, box))
    .concat(frame.tags.map((box) => Object.assign({ kind: "tag" }, box)));
  assert.equal(boxes.length, (checked.value.stations.length + 2) * 2, label + " sign and tag count");
  boxes.forEach((box) => {
    assert.ok(box.w > 0 && box.h > 0, label + " " + box.id);
    assert.ok(box.x >= -0.01 && box.y >= -0.01, label + " " + box.kind + " " + box.id + " clipped at the origin");
    assert.ok(box.x + box.w <= canvas.width + 0.01, label + " " + box.kind + " " + box.id + " clipped on the right");
    assert.ok(box.y + box.h <= canvas.height + 0.01, label + " " + box.kind + " " + box.id + " clipped on the bottom");
    assert.equal(rectsOverlap(box, frame.readout), false, label + " " + box.kind + " " + box.id + " intersects the readout");
  });
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.id === b.id && a.kind !== b.kind) continue;
      assert.equal(rectsOverlap(a, b), false, label + " " + a.kind + " " + a.id + " overlaps " + b.kind + " " + b.id);
    }
  }
  const gutter = frame.readout.x + frame.readout.w;
  frame.seats.forEach((seat) => {
    assert.ok(seat.x >= gutter - 0.01, label + " " + seat.id + " sits under the readout");
  });
  workforceSignNodes(layout).forEach((node) => {
    if (node.id === checked.value.brandBrain.id) {
      assert.ok(node.signY > 3.15, label + " brain sign needs its own height");
      return;
    }
    assert.equal(node.signW / 2, SIGN_HALF_WIDTH, label + " " + node.id + " half-width");
  });
}

assert.equal(SIGN_HALF_WIDTH, 2.8);
assertDesktop(fresh, "default");
assertDesktop(officeConfigWithStations(7), "7 stations");
const wide = officeConfigWithStations(7);
wide.stations[2].role = "Stats Tracking Desk";
assertPhone(wide, 7);

const scene = read("admin/office/scene.js");
assert.match(scene, /kind === "workforce"/);
assert.match(scene, /projectWorkforce/);
assert.match(scene, /workforce && !portrait/);
assert.match(scene, /portrait \? 36 : 120/);
assert.match(scene, /seat\.role/);
assert.match(scene, /edge\.label/);
assert.match(scene, /userData\.step = edge\.label/);
assert.match(scene, /spec\.brain/);
assert.match(scene, /spec\.overseer/);
assert.doesNotMatch(scene, /DM Setter|Follow-ups|Target Comments|Stats Tracking|Next step: DM/);
assert.doesNotMatch(read("admin/hq/index.html"), /#office|AI Workforce|Needs Diego|#schedule|#agents|#activity/);
assert.match(read("admin/hq/index.html"), /url=\/admin\//);

const ignore = read(".vercelignore");
assert.match(ignore, /^test$/m);
assert.match(ignore, /^supabase\/migrations$/m);
assert.match(ignore, /^admin\/\*\*\/\*\.test\.mjs$/m);
const ci = read(".github/workflows/node-tests.yml");
assert.match(ci, /node --test[^\n]*"test\/\*\.test\.mjs" "admin\/\*\*\/\*\.test\.mjs"/);

const migration = read("supabase/migrations/20261019103000_workforce_office_stations.sql");
assert.match(migration, /outreach/);
assert.match(migration, /target_comments/);
assert.match(migration, /Not applied/);
