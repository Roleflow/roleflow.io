import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addStation,
  changeRevision,
  configFromSnapshot,
  createOfficeConfig,
  createOfficeStore,
  deleteRevision,
  editorAvailable,
  editorDocument,
  hqOfficeConfig,
  missingOfficeTables,
  readOffice,
  removeStation,
  restoreOfficeRevision,
  saveOfficeConfig,
  taskWrite,
  validateEditorPayload
} from "./office-editor.mjs";
import { layoutOffice, loadOfficeConfig, validateOfficeConfig } from "./workforce-config.mjs";
import { VAM_BUSINESS_ID } from "./workforce-model.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const ACTOR = "00000000-0000-4000-8000-0000000000d1";

const fresh = await loadOfficeConfig(VAM_BUSINESS_ID);
const doc = editorDocument(fresh);
assert.equal(doc.ok, true, doc.errors && doc.errors.join("; "));
assert.equal(doc.value.stations.length, 5);
assert.equal(doc.value.overseer.id, "overseer");

const hq = editorDocument(hqOfficeConfig());
assert.equal(hq.ok, true, hq.errors && hq.errors.join("; "));
assert.equal(hq.value.overseer.id, "chief_of_staff");
assert.ok(hq.value.stations.every((station) => station.taskStations.includes(station.id)));

function reject(payload, pattern) {
  const result = validateEditorPayload(payload);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), pattern);
}

const duplicate = structuredClone(doc.value);
duplicate.stations[1].id = duplicate.stations[0].id;
reject(duplicate, /duplicates id/);

const self = structuredClone(doc.value);
self.edges.push({ from: "stats", to: "stats", kind: "read", label: "Next step: Stats Tracking" });
reject(self, /itself/);

const missing = structuredClone(doc.value);
missing.edges.push({ from: "overseer", to: "not_a_station", kind: "assign", label: "Next step: Missing" });
reject(missing, /not a station/);

const kind = structuredClone(doc.value);
kind.edges[0].kind = "teleport";
reject(kind, /kind/);

const longLabel = structuredClone(doc.value);
longLabel.stations[0].role = "x".repeat(61);
reject(longLabel, /1-60/);

const noOverseer = structuredClone(doc.value);
noOverseer.overseer = {};
reject(noOverseer, /overseer/);

const round = configFromSnapshot(doc.value);
assert.equal(round.ok, true, round.errors && round.errors.join("; "));
const rendered = validateOfficeConfig(round.value);
assert.equal(rendered.ok, true);
const layout = layoutOffice(rendered.value);
assert.equal(layout.seats.length, 5);
assert.equal(layout.overseer.role, "Chief of Staff");
assert.equal(layout.overseer.id, "overseer");
assert.equal(layout.brain.id, "brand_brain");
assert.ok(layout.edges.length >= 8);

const store = createOfficeStore();
const created = createOfficeConfig(store, {
  scope: "business",
  businessId: VAM_BUSINESS_ID,
  payload: doc.value,
  summary: "Code default",
  actor: ACTOR,
  actorName: "Diego Castanedo"
});
assert.equal(created.ok, true, created.error);
assert.equal(created.version, 1);
assert.equal(store.revisions.length, 1);
assert.equal(store.stations.filter((row) => !row.archived_at).length, 6);
assert.equal(store.edges.length, doc.value.edges.length);
assert.ok(store.edges.every((edge) => ["sends", "hands_off", "reads"].includes(edge.kind)));

const renamed = structuredClone(created.revision.snapshot);
renamed.stations = renamed.stations.map((station) => station.id === "outreach"
  ? Object.assign({}, station, { role: "Cold Outreach" })
  : station);
const dropped = removeStation(renamed, "target_comments");
const saved = saveOfficeConfig(store, {
  configId: created.configId,
  expectedVersion: 1,
  payload: dropped,
  summary: "Renamed Outreach to Cold Outreach",
  actor: ACTOR,
  actorName: "Diego Castanedo"
});
assert.equal(saved.ok, true, saved.error);
assert.equal(saved.version, 2);
assert.equal(store.revisions.length, 2);
const archived = store.stations.find((row) => row.key === "target_comments");
assert.ok(archived.archived_at);
assert.equal(store.edges.some((edge) => edge.from_key === "target_comments" || edge.to_key === "target_comments"), false);
const outreach = store.stations.find((row) => row.key === "outreach");
assert.equal(outreach.label, "Cold Outreach");
assert.equal(outreach.archived_at, null);

const before = structuredClone(store);
const stale = saveOfficeConfig(store, {
  configId: created.configId,
  expectedVersion: 1,
  payload: doc.value,
  summary: "Too late",
  actor: ACTOR
});
assert.equal(stale.ok, false);
assert.equal(stale.conflict, true);
assert.match(stale.error, /someone else saved first/);
assert.equal(store.revisions.length, before.revisions.length);
assert.equal(store.configs[0].version, 2);

const restored = restoreOfficeRevision(store, {
  revisionId: store.revisions[0].id,
  expectedVersion: 2,
  actor: ACTOR,
  actorName: "Diego Castanedo"
});
assert.equal(restored.ok, true, restored.error);
assert.equal(restored.version, 3);
assert.equal(restored.revision.restored_from, store.revisions[0].id);
assert.equal(store.revisions.length, 3);
const back = configFromSnapshot(restored.revision.snapshot);
assert.equal(back.value.stations.find((station) => station.id === "outreach").role, "Outreach");
assert.ok(back.value.stations.some((station) => station.id === "target_comments"));
assert.equal(store.stations.find((row) => row.key === "target_comments").archived_at, null);
const again = layoutOffice(validateOfficeConfig(back.value).value);
assert.equal(again.seats.length, 5);

const revisionId = store.revisions[0].id;
const summary = store.revisions[0].summary;
assert.throws(() => changeRevision(store, revisionId, { summary: "changed" }), /append-only/);
assert.throws(() => deleteRevision(store, revisionId), /append-only/);
assert.equal(store.revisions[0].summary, summary);
assert.equal(store.revisions.length, 3);

const anon = saveOfficeConfig(store, {
  configId: created.configId,
  expectedVersion: 3,
  payload: doc.value,
  summary: "Nope",
  actor: ""
});
assert.equal(anon.ok, false);
assert.match(anon.error, /not allowed/);

assert.equal(missingOfficeTables({ code: "PGRST205", message: "Could not find the table 'public.office_configs' in the schema cache" }), true);
assert.equal(missingOfficeTables({ code: "42P01", message: 'relation "public.office_stations" does not exist' }), true);
assert.equal(missingOfficeTables({ code: "PGRST205", message: "Could not find the table public.hq_tasks in the schema cache" }), false);
assert.equal(missingOfficeTables({ message: "permission denied" }), false);
assert.equal(editorAvailable({ mode: "readonly" }), false);
assert.equal(editorAvailable({ mode: "editable" }), true);

function clientFrom(responder) {
  return {
    from() {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        then(resolve) { resolve(responder()); }
      };
      return builder;
    }
  };
}

const fallbackClient = clientFrom(() => ({
  data: null,
  error: { code: "PGRST205", message: "Could not find the table 'public.office_configs' in the schema cache" }
}));
const fallback = await readOffice(fallbackClient, { scope: "business", businessId: VAM_BUSINESS_ID, fallback: doc.value });
assert.equal(fallback.mode, "readonly");
assert.equal(fallback.config.stations[0].role, "DM Setter");
assert.equal(editorAvailable(fallback), false);

const emptyClient = clientFrom(() => ({ data: [], error: null }));
const unsaved = await readOffice(emptyClient, { scope: "hq", businessId: null, fallback: hq.value });
assert.equal(unsaved.mode, "editable");
assert.equal(unsaved.version, null);
assert.equal(unsaved.config.overseer.id, "chief_of_staff");

const added = addStation(doc.value, "Research Desk");
assert.equal(added.stations.at(-1).id, "research_desk");
assert.equal(taskWrite("outreach", "station-1").station, "outreach");
assert.equal(taskWrite("research_desk", "station-2").station, null);
assert.equal(taskWrite("research_desk", "station-2").station_id, "station-2");

const sql = read("supabase/migrations/20261019140000_office_editor.sql");
assert.match(sql, /Not applied/);
assert.match(sql, /create table if not exists public\.office_configs/);
assert.match(sql, /create table if not exists public\.office_stations/);
assert.match(sql, /create table if not exists public\.office_edges/);
assert.match(sql, /create table if not exists public\.office_config_revisions/);
assert.match(sql, /station_id uuid null references public\.office_stations/);
assert.match(sql, /office revisions are append-only/);
assert.match(sql, /before update or delete on public\.office_config_revisions/);
assert.match(sql, /security invoker/);
assert.match(sql, /set search_path = ''/);
assert.match(sql, /public\.is_admin\(\)/);
assert.match(sql, /version conflict: someone else saved first/);
assert.match(sql, /using \(public\.is_admin\(\)\)/);
assert.match(sql, /revoke all on public\.office_configs from public, anon, authenticated/);
assert.match(sql, /grant select, insert on public\.office_config_revisions to authenticated/);
assert.doesNotMatch(sql, /create policy \w+ on public\.office_config_revisions[\s\S]*for update/);
assert.doesNotMatch(sql, /create policy \w+ on public\.office_config_revisions[\s\S]*for delete/);
assert.doesNotMatch(sql, /drop constraint if exists hq_tasks_station_check/);
assert.doesNotMatch(sql, /alter table public\.hq_tasks drop constraint/);
assert.match(sql, /alter publication supabase_realtime add table public\.%I/);
assert.match(sql, /security definer/);
assert.match(sql, /hq_log_station_move/);
assert.match(sql, /moved from /);
assert.doesNotMatch(sql, /private\./);

const css = read("admin/hq/hq.css");
assert.match(css, /bottom:calc\(80px \+ env\(safe-area-inset-bottom\)\)/);

console.log("office editor ok");
