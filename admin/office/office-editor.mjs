// Phase 2 office editor. The scene still paints a phase 1 config.
// This module validates the editor document, applies a save or restore
// against an in-memory store (the same rules as the SQL functions), and
// detects a database that does not have the office tables yet.

import { validateOfficeConfig } from "./workforce-config.mjs";

export const KEY_RE = /^[a-z0-9_]{1,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LEGACY_STATION_KEYS = [
  "research", "writers_room", "film_studio", "edit_bay",
  "shipping_dock", "client_floor", "chief_of_staff",
  "mail_room", "sales_desk", "back_office",
  "leads_in", "qualify", "book_call", "follow_up", "report", "overseer",
  "outreach", "target_comments"
];

const PHASE_KIND = {
  assign: "assign",
  handoff: "handoff",
  read: "read",
  sends: "assign",
  hands_off: "handoff",
  reads: "read"
};

export const DB_KIND = {
  assign: "sends",
  handoff: "hands_off",
  read: "reads",
  sends: "sends",
  hands_off: "hands_off",
  reads: "reads"
};

function text(value) {
  return String(value == null ? "" : value).trim();
}

function clone(value) {
  return structuredClone(value);
}

function uuid() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function nodeExtras(raw) {
  const agent = text(raw && raw.hqAgentId);
  return {
    hqAgentId: agent || null,
    agentRole: text(raw && raw.agentRole).slice(0, 80)
  };
}

function withExtras(base, raw) {
  return Object.assign({}, base, nodeExtras(raw));
}

export function hqOfficeConfig() {
  const stations = [
    ["research", "Research", "Finds the material the floor should work on."],
    ["writers_room", "Writers' Room", "Turns the brief into the draft."],
    ["film_studio", "Film Studio", "Records and builds the piece."],
    ["edit_bay", "Edit Bay", "Cuts the piece and prepares the handoff."],
    ["shipping_dock", "Shipping Dock", "Publishes and distributes the finished work."],
    ["client_floor", "Client Floor", "Onboarding, delivery, and client follow-through."],
    ["mail_room", "Mail Room", "Sorts inbound and sends it to the right desk."],
    ["sales_desk", "Sales Desk", "Works the pipeline and the next conversation."],
    ["back_office", "Back Office", "Finance, engineering, and the work behind the floor."]
  ];
  return {
    id: "hq",
    overseer: {
      id: "chief_of_staff",
      role: "Chief of Staff",
      description: "Runs the floor and sends each station its next task.",
      color: "#ff2d95",
      taskStations: ["chief_of_staff"],
      workforceRole: "",
      metric: "none",
      hqAgentId: null,
      agentRole: ""
    },
    brandBrain: {
      id: "brand_brain",
      role: "Brand Brain",
      description: "The company brain for the Agentic HQ office.",
      color: "#ff4d8d",
      taskStations: [],
      workforceRole: "",
      metric: "none",
      hqAgentId: null,
      agentRole: ""
    },
    stations: stations.map(([id, role, description]) => ({
      id,
      role,
      description,
      color: "#ff4d8d",
      taskStations: [id],
      workforceRole: "",
      metric: "none",
      hqAgentId: null,
      agentRole: ""
    })),
    edges: stations.map(([id, role]) => ({
      from: "chief_of_staff",
      to: id,
      kind: "assign",
      label: "Next step: " + role
    }))
  };
}

export function editorDocument(config) {
  const checked = validateOfficeConfig(config);
  if (!checked.ok) return { ok: false, errors: checked.errors, value: null };
  const rawStations = new Map(((config && config.stations) || []).map((station) => [station && station.id, station]));
  const value = checked.value;
  value.overseer = withExtras(value.overseer, config && config.overseer);
  value.brandBrain = withExtras(value.brandBrain, config && config.brandBrain);
  value.stations = value.stations.map((station) => withExtras(station, rawStations.get(station.id)));
  return validateEditorPayload(value);
}

export function validateEditorPayload(config) {
  const errors = [];
  const base = validateOfficeConfig(config);
  if (!base.ok) errors.push(...base.errors);
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ok: false, errors: errors.length ? errors : ["Config must be an object."], value: null };
  }
  const source = base.ok ? base.value : config;
  const overseer = source.overseer || {};
  const stations = Array.isArray(source.stations) ? source.stations : [];
  const brain = source.brandBrain || {};
  if (!overseer.id) errors.push("at least one overseer station");
  const checkKey = (id, path) => {
    if (id && !KEY_RE.test(id)) errors.push(path + " must be a lowercase key of at most 40 characters.");
  };
  const checkLabel = (role, path) => {
    const label = text(role);
    if (label && (label.length < 1 || label.length > 60)) errors.push(path + " must be 1-60 characters.");
  };
  const checkDescription = (description, path) => {
    if (String(description || "").length > 2000) errors.push(path + " must be at most 2000 characters.");
  };
  const checkAgent = (node, path) => {
    const agent = text(node && node.hqAgentId);
    if (agent && !UUID_RE.test(agent)) errors.push(path + ".hqAgentId must be a uuid.");
    if (text(node && node.agentRole).length > 80) errors.push(path + ".agentRole must be at most 80 characters.");
  };
  checkKey(overseer.id, "overseer.id");
  checkLabel(overseer.role, "overseer.role");
  checkDescription(overseer.description, "overseer.description");
  checkAgent(config.overseer, "overseer");
  checkKey(brain.id, "brandBrain.id");
  checkLabel(brain.role, "brandBrain.role");
  checkDescription(brain.description, "brandBrain.description");
  stations.forEach((station, index) => {
    checkKey(station.id, "stations[" + index + "].id");
    checkLabel(station.role, "stations[" + index + "].role");
    checkDescription(station.description, "stations[" + index + "].description");
    checkAgent((config.stations || [])[index], "stations[" + index + "]");
  });
  const edges = Array.isArray(source.edges) ? source.edges : [];
  edges.forEach((edge, index) => {
    const kind = text(edge.kind);
    if (kind && !PHASE_KIND[kind]) errors.push("edges[" + index + "].kind is not allowed.");
    const label = text(edge.label);
    if (label.length > 60) errors.push("edges[" + index + "].label must be at most 60 characters.");
  });
  if (errors.length || !base.ok) return { ok: false, errors, value: null };
  const rawStations = new Map((config.stations || []).map((station) => [station && station.id, station]));
  return {
    ok: true,
    errors: [],
    value: {
      id: text(config.id) || base.value.id || "default",
      overseer: withExtras(base.value.overseer, config.overseer),
      brandBrain: withExtras(base.value.brandBrain, config.brandBrain),
      stations: base.value.stations.map((station) => withExtras(station, rawStations.get(station.id))),
      edges: base.value.edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        kind: PHASE_KIND[edge.kind] || "assign",
        label: edge.label
      }))
    }
  };
}

export function stationKey(label, used) {
  const taken = used || new Set();
  let base = text(label).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  if (!KEY_RE.test(base)) base = "station";
  let key = base;
  let n = 2;
  while (taken.has(key)) {
    const suffix = "_" + n;
    key = base.slice(0, Math.max(1, 40 - suffix.length)) + suffix;
    n += 1;
  }
  return key;
}

function usedKeys(doc) {
  const ids = new Set();
  if (doc.overseer) ids.add(doc.overseer.id);
  if (doc.brandBrain) ids.add(doc.brandBrain.id);
  (doc.stations || []).forEach((station) => ids.add(station.id));
  return ids;
}

export function addStation(doc, label) {
  const next = clone(doc);
  const name = text(label).slice(0, 60) || "New station";
  const key = stationKey(name, usedKeys(next));
  next.stations.push({
    id: key,
    role: name,
    description: "Describe this station.",
    color: "#ff4d8d",
    taskStations: [],
    workforceRole: "",
    metric: "none",
    hqAgentId: null,
    agentRole: ""
  });
  return next;
}

export function removeStation(doc, key) {
  const next = clone(doc);
  if (!key || key === next.overseer.id || key === next.brandBrain.id) return next;
  next.stations = next.stations.filter((station) => station.id !== key);
  next.edges = next.edges.filter((edge) => edge.from !== key && edge.to !== key);
  return next;
}

export function moveStation(doc, key, delta) {
  const next = clone(doc);
  const index = next.stations.findIndex((station) => station.id === key);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= next.stations.length) return next;
  const [row] = next.stations.splice(index, 1);
  next.stations.splice(target, 0, row);
  return next;
}

export function addEdge(doc, edge) {
  const next = clone(doc);
  next.edges.push({
    from: text(edge && edge.from),
    to: text(edge && edge.to),
    kind: PHASE_KIND[text(edge && edge.kind)] || "assign",
    label: text(edge && edge.label).slice(0, 60) || "Next step"
  });
  return next;
}

export function removeEdge(doc, index) {
  const next = clone(doc);
  next.edges = next.edges.filter((_, edgeIndex) => edgeIndex !== index);
  return next;
}

export function taskWrite(stationKeyValue, stationId) {
  const key = text(stationKeyValue);
  const legacy = LEGACY_STATION_KEYS.includes(key);
  return {
    station_id: stationId || null,
    station: legacy ? key : null
  };
}

export function missingOfficeTables(error) {
  if (!error) return false;
  const message = String(error.message || error.details || "");
  const code = String(error.code || "");
  const names = /office_configs|office_stations|office_edges|office_config_revisions/;
  const missing = /schema cache|does not exist|PGRST205|42P01/i;
  if (!names.test(message) && !names.test(code)) return false;
  return missing.test(message) || missing.test(code) || code === "42P01" || code === "PGRST205";
}

export function editorAvailable(loaded) {
  return Boolean(loaded && loaded.mode === "editable");
}

export function madridStamp(iso) {
  const value = new Date(iso || Date.now());
  if (Number.isNaN(value.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(value) + " Madrid";
}

export function createOfficeStore() {
  return { configs: [], stations: [], edges: [], revisions: [] };
}

function fail(error) {
  return { ok: false, conflict: false, error };
}

function stationRows(doc) {
  const rows = [{
    key: doc.overseer.id,
    label: doc.overseer.role,
    role: doc.overseer.agentRole || "",
    hq_agent_id: doc.overseer.hqAgentId || null,
    description: doc.overseer.description,
    sort_order: 0,
    data_source: doc.overseer.metric && doc.overseer.metric !== "none" ? doc.overseer.metric : null,
    overseer: true
  }];
  doc.stations.forEach((station, index) => {
    rows.push({
      key: station.id,
      label: station.role,
      role: station.agentRole || "",
      hq_agent_id: station.hqAgentId || null,
      description: station.description,
      sort_order: index + 1,
      data_source: station.metric && station.metric !== "none" ? station.metric : null,
      overseer: false
    });
  });
  return rows;
}

function applyRows(store, configId, doc) {
  const wanted = stationRows(doc);
  const keys = new Set(wanted.map((row) => row.key));
  const byKey = new Map(store.stations.filter((row) => row.config_id === configId).map((row) => [row.key, row]));
  const stamp = nowIso();
  wanted.forEach((row) => {
    const existing = byKey.get(row.key);
    if (existing) {
      Object.assign(existing, row, { archived_at: null, updated_at: stamp });
      return;
    }
    store.stations.push(Object.assign({
      id: uuid(),
      config_id: configId,
      archived_at: null,
      created_at: stamp,
      updated_at: stamp
    }, row));
  });
  store.stations.forEach((row) => {
    if (row.config_id === configId && !keys.has(row.key) && !row.archived_at) row.archived_at = stamp;
  });
  store.edges = store.edges.filter((edge) => edge.config_id !== configId);
  const idByKey = new Map(store.stations.filter((row) => row.config_id === configId && !row.archived_at).map((row) => [row.key, row.id]));
  doc.edges.forEach((edge, index) => {
    store.edges.push({
      id: uuid(),
      config_id: configId,
      from_station_id: idByKey.get(edge.from),
      to_station_id: idByKey.get(edge.to),
      from_key: edge.from,
      to_key: edge.to,
      kind: DB_KIND[edge.kind] || "sends",
      label: edge.label,
      sort_order: index
    });
  });
}

export function saveOfficeConfig(store, input) {
  const actor = text(input && input.actor);
  if (!actor) return fail("not allowed");
  const config = store.configs.find((row) => row.id === input.configId);
  if (!config) return fail("office not found");
  if (config.version !== input.expectedVersion) {
    return { ok: false, conflict: true, error: "version conflict: someone else saved first" };
  }
  const checked = validateEditorPayload(input.payload);
  if (!checked.ok) return fail(checked.errors[0] || "config is not valid");
  const summary = text(input.summary).slice(0, 280);
  applyRows(store, config.id, checked.value);
  const revisionNo = store.revisions.filter((row) => row.config_id === config.id).reduce((max, row) => Math.max(max, row.revision_no), 0) + 1;
  const revision = {
    id: uuid(),
    config_id: config.id,
    revision_no: revisionNo,
    snapshot: checked.value,
    summary,
    restored_from: input.restoredFrom || null,
    created_by: actor,
    created_by_name: text(input.actorName) || "Admin",
    created_at: nowIso()
  };
  store.revisions.push(revision);
  config.version += 1;
  config.current_revision_id = revision.id;
  config.updated_by = actor;
  config.updated_at = revision.created_at;
  return { ok: true, conflict: false, error: "", version: config.version, configId: config.id, revision };
}

export function createOfficeConfig(store, input) {
  const actor = text(input && input.actor);
  if (!actor) return fail("not allowed");
  const scope = input.scope === "hq" ? "hq" : "business";
  const businessId = scope === "business" ? text(input.businessId) : "";
  if (scope === "business" && !businessId) return fail("business_id is required");
  if (scope === "hq" && input.businessId) return fail("the HQ office has no business");
  const exists = store.configs.some((row) => (scope === "hq" ? row.scope === "hq" : row.business_id === businessId));
  if (exists) return fail("office already exists");
  const checked = validateEditorPayload(input.payload);
  if (!checked.ok) return fail(checked.errors[0] || "config is not valid");
  const config = {
    id: uuid(),
    scope,
    business_id: scope === "business" ? businessId : null,
    version: 0,
    current_revision_id: null,
    updated_by: actor,
    updated_at: nowIso()
  };
  store.configs.push(config);
  const saved = saveOfficeConfig(store, {
    configId: config.id,
    expectedVersion: 0,
    payload: checked.value,
    summary: text(input.summary) || "Created the office",
    actor,
    actorName: input.actorName
  });
  if (!saved.ok) {
    store.configs = store.configs.filter((row) => row.id !== config.id);
  }
  return saved;
}

export function restoreOfficeRevision(store, input) {
  const revision = store.revisions.find((row) => row.id === input.revisionId);
  if (!revision) return fail("revision not found");
  return saveOfficeConfig(store, {
    configId: revision.config_id,
    expectedVersion: input.expectedVersion,
    payload: revision.snapshot,
    summary: "Restored revision " + revision.revision_no,
    actor: input.actor,
    actorName: input.actorName,
    restoredFrom: revision.id
  });
}

export function changeRevision(store, revisionId, patch) {
  void store;
  void revisionId;
  void patch;
  throw new Error("office revisions are append-only");
}

export function deleteRevision(store, revisionId) {
  void store;
  void revisionId;
  throw new Error("office revisions are append-only");
}

export function officeFromStore(store, scope, businessId, fallback) {
  const config = store.configs.find((row) => (scope === "hq" ? row.scope === "hq" : row.scope === "business" && row.business_id === businessId));
  if (!config) {
    const doc = editorDocument(fallback);
    return {
      mode: "editable",
      config: doc.ok ? doc.value : fallback,
      draft: doc.ok ? doc.value : fallback,
      configId: null,
      version: null,
      revisions: [],
      notice: ""
    };
  }
  const current = store.revisions.find((row) => row.id === config.current_revision_id);
  const parsed = current ? validateEditorPayload(current.snapshot) : { ok: false };
  const value = parsed.ok ? parsed.value : editorDocument(fallback).value;
  return {
    mode: "editable",
    config: value,
    draft: clone(value),
    configId: config.id,
    version: config.version,
    revisions: store.revisions.filter((row) => row.config_id === config.id).slice().sort((a, b) => b.revision_no - a.revision_no),
    notice: ""
  };
}

async function ask(builder) {
  return builder;
}

export async function readOffice(client, options) {
  const fallback = options.fallback;
  const scope = options.scope === "hq" ? "hq" : "business";
  const businessId = scope === "business" ? text(options.businessId) : "";
  const readonly = {
    mode: "readonly",
    config: fallback,
    draft: null,
    configId: null,
    version: null,
    revisions: [],
    notice: ""
  };
  let listed;
  try {
    let query = client.from("office_configs").select("*").eq("scope", scope);
    if (scope === "business") query = query.eq("business_id", businessId);
    listed = await ask(query);
  } catch (error) {
    if (missingOfficeTables(error)) return readonly;
    return Object.assign({}, readonly, { notice: text(error && error.message) });
  }
  if (listed && listed.error) {
    if (missingOfficeTables(listed.error)) return readonly;
    return Object.assign({}, readonly, { notice: text(listed.error.message) });
  }
  const row = ((listed && listed.data) || [])[0] || null;
  if (!row) {
    const doc = editorDocument(fallback);
    return {
      mode: "editable",
      config: doc.ok ? doc.value : fallback,
      draft: doc.ok ? clone(doc.value) : clone(fallback),
      configId: null,
      version: null,
      revisions: [],
      notice: ""
    };
  }
  let revisions = [];
  try {
    const history = await client.from("office_config_revisions").select("*").eq("config_id", row.id);
    if (history && history.error) {
      if (missingOfficeTables(history.error)) return readonly;
    } else {
      revisions = ((history && history.data) || []).slice().sort((a, b) => b.revision_no - a.revision_no);
    }
  } catch (error) {
    if (missingOfficeTables(error)) return readonly;
  }
  const current = revisions.find((item) => item.id === row.current_revision_id) || revisions[0];
  const parsed = current ? validateEditorPayload(current.snapshot) : { ok: false };
  const doc = parsed.ok ? parsed.value : editorDocument(fallback).value;
  return {
    mode: "editable",
    config: doc,
    draft: clone(doc),
    configId: row.id,
    version: row.version,
    revisions,
    notice: parsed.ok ? "" : "The saved office did not validate, so the code default is showing."
  };
}

export function configFromSnapshot(snapshot) {
  return validateEditorPayload(snapshot);
}
