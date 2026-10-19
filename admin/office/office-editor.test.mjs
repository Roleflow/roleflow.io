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
  plainSaveNotice,
  revisionAuthorOk,
  validateEditorPayload,
  OFFICE_EDGE_CAP,
  OFFICE_PAYLOAD_MAX_BYTES,
  OFFICE_STATION_CAP
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
assert.equal(created.revision.actor_uid, ACTOR);
assert.equal(store.configs[0].actor_uid, ACTOR);
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

const other = createOfficeConfig(store, {
  scope: "hq",
  payload: hq.value,
  summary: "HQ",
  actor: ACTOR,
  actorName: "Diego Castanedo"
});
assert.equal(other.ok, true, other.error);
const crossed = saveOfficeConfig(store, {
  configId: created.configId,
  expectedVersion: 3,
  payload: doc.value,
  summary: "Wrong history",
  actor: ACTOR,
  restoredFrom: other.revision.id
});
assert.equal(crossed.ok, false);
assert.match(crossed.error, /this office/);
assert.equal(store.configs.find((row) => row.id === created.configId).version, 3);

const dirty = structuredClone(doc.value);
dirty.injected = "no";
dirty.overseer = Object.assign({}, dirty.overseer, { injected: "no" });
dirty.edges[0] = Object.assign({}, dirty.edges[0], { injected: "no" });
const clean = validateEditorPayload(dirty);
assert.equal(clean.ok, true, clean.errors.join("; "));
assert.equal("injected" in clean.value, false);
assert.equal("injected" in clean.value.overseer, false);
assert.equal("injected" in clean.value.edges[0], false);
assert.deepEqual(Object.keys(clean.value.stations[0]).sort(), ["agentRole", "color", "description", "hqAgentId", "id", "metric", "role", "taskStations", "workforceRole"]);

const badMetric = structuredClone(doc.value);
badMetric.stations[0] = Object.assign({}, badMetric.stations[0], { metric: "Not Allowed" });
assert.match(validateEditorPayload(badMetric).errors.join(" "), /data_source/);
const keptMetric = structuredClone(doc.value);
keptMetric.stations[0] = Object.assign({}, keptMetric.stations[0], { metric: "instagram_dm" });
const kept = validateEditorPayload(keptMetric);
assert.equal(kept.ok, true, kept.errors.join("; "));
assert.equal(kept.value.stations[0].metric, "instagram_dm");

const tooBig = structuredClone(doc.value);
tooBig.blob = "x".repeat(OFFICE_PAYLOAD_MAX_BYTES);
assert.match(validateEditorPayload(tooBig).errors.join(" "), /too large/);
const tooManyStations = structuredClone(doc.value);
tooManyStations.stations = Array.from({ length: OFFICE_STATION_CAP + 1 }, () => ({}));
assert.match(validateEditorPayload(tooManyStations).errors.join(" "), /too many stations/);
const tooManyEdges = structuredClone(doc.value);
tooManyEdges.edges = Array.from({ length: OFFICE_EDGE_CAP + 1 }, () => ({}));
assert.match(validateEditorPayload(tooManyEdges).errors.join(" "), /too many edges/);

assert.equal(revisionAuthorOk(null, ACTOR), true);
assert.equal(revisionAuthorOk("", ACTOR), true);
assert.equal(revisionAuthorOk(ACTOR, ACTOR), true);
assert.equal(revisionAuthorOk("00000000-0000-4000-8000-0000000000aa", ACTOR), false);
assert.equal(plainSaveNotice("brandBrain must be an object."), "Couldn't save: Brand Brain settings are missing.");
assert.equal(plainSaveNotice("brandBrain must be an object"), "Couldn't save: Brand Brain settings are missing.");
assert.equal(plainSaveNotice("version conflict: someone else saved first"), "Someone else saved first. This is the latest office.");
assert.equal(plainSaveNotice("Saved."), "Saved.");

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
assert.match(sql, /public\.hq_actor\(\)/);
assert.match(sql, /'task\.moved'/);
assert.match(sql, /moved from /);
assert.doesNotMatch(sql, /'diego'/);
assert.doesNotMatch(sql, /'station_move'/);
assert.match(sql, /create index if not exists hq_tasks_station_idx on public\.hq_tasks \(station_id\)/);
assert.match(sql, /create index if not exists office_configs_business_idx on public\.office_configs \(business_id\)/);
assert.match(sql, /create index if not exists office_stations_agent_idx on public\.office_stations \(hq_agent_id\)/);
assert.match(sql, /create index if not exists office_edges_from_idx on public\.office_edges \(from_station_id\)/);
assert.match(sql, /create index if not exists office_edges_to_idx on public\.office_edges \(to_station_id\)/);
assert.match(sql, /create index if not exists office_revisions_restored_idx on public\.office_config_revisions \(restored_from\)/);
assert.match(sql, /begin\s+insert into public\.office_configs/);
assert.doesNotMatch(sql, /private\./);
assert.doesNotMatch(sql, /allow_revision_delete/);
assert.doesNotMatch(sql, /set_config\(/);
assert.match(sql, /pg_trigger_depth\(\) > 1/);
assert.match(sql, /not exists \(select 1 from public\.office_configs where id = old\.config_id\)/);
assert.match(sql, /forged revision author/);
assert.match(sql, /restored_from must belong to this office/);
assert.match(sql, /actor_uid uuid null/);
assert.match(sql, /octet_length\(p_payload::text\) > 262144/);
assert.match(sql, /too many stations/);
assert.match(sql, /too many edges/);
assert.match(sql, /data_source must be a lowercase key/);
assert.match(sql, /office_stations_data_source_check/);
assert.match(sql, /revoke all on function public\.save_office_config\(uuid, integer, jsonb, text, uuid\) from public, anon, service_role/);
assert.match(sql, /revoke all on function public\.create_office_config\(text, uuid, jsonb\) from public, anon, service_role/);
assert.match(sql, /revoke all on function public\.restore_office_revision\(uuid, integer\) from public, anon, service_role/);
assert.match(sql, /revoke all on function public\.office_revisions_append_only\(\) from public, anon, authenticated, service_role/);
assert.match(sql, /revoke all on function public\.office_revisions_guard\(\) from public, anon, authenticated, service_role/);
assert.match(sql, /revoke all on function public\.hq_log_station_move\(\) from public, anon, authenticated, service_role/);

const css = read("admin/hq/hq.css");
assert.match(css, /bottom:calc\(80px \+ env\(safe-area-inset-bottom\)\)/);
assert.match(css, /#office-editor:not\(\[hidden\]\)\) \.hq-zoom\{display:none\}/);
assert.match(css, /body\.hq \.btn\[hidden\]\{display:none !important\}/);
assert.doesNotMatch(read("auth/site.css"), /\.btn\[hidden\]/);

console.log("office editor ok");
