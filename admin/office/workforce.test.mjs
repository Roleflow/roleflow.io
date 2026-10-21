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
  workforceSignNodes
} from "./workforce-config.mjs";
import {
  mapWorkforce,
  motionFor,
  pickDefaultBusiness,
  VAM_BUSINESS_ID,
  workforcePreviewFixture
} from "./workforce-model.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const NOW = new Date("2026-10-19T08:40:00.000Z");
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

const hq = read("admin/hq/app.js");
const place = hq.slice(hq.indexOf("function placeWorkforceBadges"), hq.indexOf("function needsWorkforceLoad"));
assert.match(place, /separateBadges/);
assert.doesNotMatch(place, /fitLabels/);
assert.match(hq, /loadOfficeConfig/);
assert.match(hq, /validateOfficeConfig/);
assert.match(hq, /workforcepreview/);
assert.match(hq, /Fixture preview/);
assert.match(read("admin/hq/index.html"), /href="#business">AI Workforce/);
const boot = hq.slice(hq.indexOf("async function boot"), hq.indexOf("async function loadPreviewFixture"));
assert.match(boot, /from\("admins"\)/);
assert.doesNotMatch(boot, /tailortalk_leads|business_workforce|loadOfficeConfig/);
assert.match(hq, /function loadWorkforceScreen\(\)[\s\S]*if \(!state\.ready\) return/);

const preview = workforcePreviewFixture();
assert.equal(pickDefaultBusiness(preview.businesses).id, VAM_BUSINESS_ID);
assert.equal(pickDefaultBusiness(preview.businesses.slice(1)).agent_name, "Caleb Wat");

function viewFor(business, extra) {
  const config = validateOfficeConfig(structuredClone(fresh)).value;
  return mapWorkforce(Object.assign({
    business,
    leads: preview.leads.filter((lead) => lead.agent_id === business.id),
    stats: preview.stats.find((row) => row.agent_id === business.id) || null,
    workforce: preview.workforce.filter((row) => row.agent_id === business.id),
    tasks: [],
    activity: [],
    config,
    now: NOW
  }, extra || {}));
}

const vam = viewFor(preview.businesses[0]);
assert.equal(vam.motions.length, 0);
assert.equal(vam.cards.length, 0);
const dm = vam.stations.find((station) => station.id === "dm_setter");
const follow = vam.stations.find((station) => station.id === "follow_ups");
const outreach = vam.stations.find((station) => station.id === "outreach");
const comments = vam.stations.find((station) => station.id === "target_comments");
const stats = vam.stations.find((station) => station.id === "stats");
assert.match(dm.detail, /159 Instagram DMs/);
assert.match(dm.detail, /2 converted/);
assert.match(dm.detail, /Not set up/);
assert.match(dm.detail, /Idle\. No tasks yet/);
assert.match(dm.detail, /Last activity/);
assert.match(dm.detail, /29 Sep/);
assert.match(dm.detail, /22:14/);
assert.doesNotMatch(dm.detail, /Live/);
assert.match(follow.detail, /87 leads with follow-ups/);
assert.match(follow.detail, /Not set up/);
assert.match(follow.detail, /Idle\. No tasks yet/);
assert.match(outreach.detail, /Not set up/);
assert.match(outreach.detail, /Idle\. No tasks yet/);
assert.match(comments.detail, /16 inbound comment leads, not target commenting/);
assert.match(comments.detail, /Idle\. No tasks yet/);
assert.match(stats.detail, /175 leads/);
assert.match(stats.detail, /1 converted/);
assert.match(stats.detail, /0\.0057/);
assert.match(stats.detail, /From the setter engine/);
assert.match(stats.detail, /Computed/);
assert.match(stats.detail, /10:00/);
assert.match(stats.detail, /lead_status converted is 2 in the lead cache/);
assert.match(vam.overseer.detail, /Idle\. No tasks yet/);
assert.match(vam.brain.detail, /Version fixture-v1/);
assert.match(vam.brain.detail, /Last activity/);
assert.equal(vam.cards.length, 0);

const empty = viewFor(preview.businesses[1], { leads: [], stats: null, workforce: [] });
assert.equal(empty.motions.length, 0);
assert.equal(empty.cards.length, 0);
assert.equal(empty.stations.length, 5);
assert.match(empty.overseer.detail, /Idle\. No tasks yet/);
assert.match(empty.brain.detail, /No prompt version yet/);
assert.match(empty.stations.find((station) => station.id === "stats").detail, /No stats yet/);
assert.match(empty.stations.find((station) => station.id === "outreach").detail, /Not set up/);
assert.match(empty.stations.find((station) => station.id === "target_comments").detail, /Idle\. No tasks yet/);
assert.doesNotMatch(empty.stations.find((station) => station.id === "target_comments").detail, /inbound comment leads/);

const config = validateOfficeConfig(structuredClone(fresh)).value;
const task = {
  id: "task-1",
  business_id: VAM_BUSINESS_ID,
  title: "Reply to the new DM",
  status: "in_progress",
  station: "qualify"
};
const moving = mapWorkforce({
  business: preview.businesses[0],
  leads: [],
  stats: null,
  workforce: [],
  tasks: [task],
  activity: [],
  config,
  now: NOW
});
assert.equal(moving.cards.length, 1);
assert.equal(moving.cards[0].spot, "dm_setter");
assert.equal(moving.motions.length, 1);
assert.equal(moving.motions[0].from, "outreach");
assert.equal(moving.motions[0].to, "dm_setter");
assert.doesNotMatch(moving.stations.find((station) => station.id === "dm_setter").detail, /Idle\. No tasks yet/);

const stranger = Object.assign({}, task, { business_id: "other-business" });
assert.equal(motionFor(config, [stranger], [], VAM_BUSINESS_ID).length, 0);
const noBusiness = Object.assign({}, task, { business_id: "" });
assert.equal(motionFor(config, [noBusiness], [], VAM_BUSINESS_ID).length, 0);
const done = Object.assign({}, task, { status: "done" });
assert.equal(motionFor(config, [done], [{ id: "act-1", task_id: task.id, detail: "Finished" }], VAM_BUSINESS_ID).length, 0);
assert.equal(motionFor(config, [], [{ id: "act-2", task_id: "missing", detail: "Nope" }], VAM_BUSINESS_ID).length, 0);
const withActivity = motionFor(config, [task], [{ id: "act-3", task_id: task.id, detail: "Moved" }], VAM_BUSINESS_ID);
assert.equal(withActivity.length, 1);

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
