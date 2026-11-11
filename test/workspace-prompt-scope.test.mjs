// Switching business must never show or save another business's prompt; the
// businesses page and the panel load their reads in parallel; one open invite
// per email.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { markPromptLoaded, promptReady, promptSaveTarget, resetPromptState, stillOn } from "../acquire/prompt-scope.js";
import { mergeTesterBusinesses } from "../acquire/team-access.js";
import { dedupeInvites, reusableInvite } from "../supabase/functions/_shared/team-access.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const ROLEFLOW = "840b08a9-869c-4650-8dc7-f78fdfa0e112";
const VAM = "1351d2ac-79bb-545d-8da0-c49ecff28a47";
const between = (text, from, to) => {
  const start = text.indexOf(from);
  assert.ok(start >= 0, "found " + from);
  const end = text.indexOf(to, start + from.length);
  return text.slice(start, end < 0 ? undefined : end);
};

// --- 1. prompt state is per business ----------------------------------------------
{
  const state = { supabase: {}, businessId: ROLEFLOW };
  resetPromptState(state);
  assert.equal(promptReady(state), false, "nothing loaded yet");
  assert.equal(promptSaveTarget(state), "", "no save before load");
  state.setterPrompt = "R".repeat(25469);
  state.promptVersions = [{ id: "rv1", version: 1, body: state.setterPrompt }];
  markPromptLoaded(state, ROLEFLOW);
  assert.equal(promptReady(state), true);
  assert.equal(promptSaveTarget(state), ROLEFLOW);
  // Sending a practice message stores the editor text as the draft.
  state.setterDraft = state.setterPrompt;
  state.promptDraft = { body: "draft", base: state.setterPrompt };

  // Switch to VAM: what bootBusiness does on a business change.
  state.businessId = VAM;
  assert.equal(promptReady(state), false, "a prompt loaded for Roleflow is not ready for VAM");
  assert.equal(promptSaveTarget(state), "", "Save is off for VAM until VAM's prompt loads");
  resetPromptState(state);
  assert.equal(state.setterPrompt, "");
  assert.equal(state.setterDraft, null, "the Roleflow draft is gone");
  assert.equal(state.promptDraft, null);
  assert.deepEqual(state.promptVersions, [], "the Roleflow version list is gone");
  assert.deepEqual(state.setterPrompts, []);
  assert.equal(state.setterCurrentId, "");
  assert.equal(state.setterTestedAt, null);
  assert.equal(state.setterPromptSaved, false);
  // What the editor would show: draft ?? prompt -> nothing from Roleflow.
  const shown = state.setterDraft != null ? state.setterDraft : (state.setterPrompt || "");
  assert.equal(shown, "");

  state.setterPrompt = "V".repeat(30721);
  markPromptLoaded(state, VAM);
  assert.equal(promptSaveTarget(state), VAM);
  // A response from a request started on VAM is dropped once Roleflow is open.
  state.businessId = ROLEFLOW;
  assert.equal(stillOn(state, VAM), false);
  assert.equal(stillOn(state, ROLEFLOW), true);
}
// Local preview has no database and stays usable.
assert.equal(promptReady({ supabase: null, businessId: "preview" }), true);
assert.equal(promptSaveTarget({ supabase: null, businessId: "preview" }), "preview");
assert.equal(promptReady(null), false);

// --- panel wiring ------------------------------------------------------------------
const app = read("acquire/app.js");
const boot = between(app, "async function bootBusiness(", "\nasync function ");
const switchBlock = between(boot, "if (state.businessId && state.businessId !== id) {", "const activated");
assert.match(switchBlock, /resetPromptState\(state\);/, "switching business clears the prompt state");

const loadAll = between(app, "async function loadAll(", "\nasync function loadThread(");
assert.doesNotMatch(loadAll, /!setterPrompt\.data \? \(state\.setterPrompt \|\| ""\)/, "no fallback to the previous business's prompt");
assert.match(loadAll, /promptWasLoaded \? \(state\.setterPrompt \|\| ""\) : ""/);
assert.match(loadAll, /if \(!setterPrompt\.error\) markPromptLoaded\(state, id\);/, "Save turns on only after this business's prompt loads");
assert.ok(loadAll.indexOf("markPromptLoaded(state, id)") > loadAll.indexOf("state.promptVersions = promptVersions.data"), "marked after the version list loads");

const save = between(app, "async function saveSetterPrompt(", "\nasync function ");
assert.match(save, /const target = promptSaveTarget\(state\);\n  if \(!target\)/);
assert.match(save, /action: "save_prompt", business_id: target/, "save goes to the business open when Save was pressed");
assert.match(save, /if \(!stillOn\(state, target\)\) return false;\n    rememberPrompt/, "a late save response is dropped");

const restore = between(app, "async function restoreSetterPrompt(", "\nasync function ");
assert.match(restore, /promptSaveTarget\(state\)/);
assert.match(restore, /\(state\.promptVersions \|\| \[\]\)\.some\(\(row\) => row\.id === version\.id\)/, "only this business's versions can be restored");
assert.match(restore, /action: "restore_prompt", business_id: target/);
assert.match(restore, /if \(!stillOn\(state, target\)\) return;/);

const tester = between(app, "async function loadTester(", "\nasync function ");
assert.match(tester, /resetPromptState\(state\);/);
assert.match(tester, /if \(!stillOn\(state, id\)\) return false;/);
assert.match(tester, /markPromptLoaded\(state, id\);/);

const trial = between(app, "async function sendTrial(", "\nasync function ");
assert.ok(trial.indexOf("if (!promptReady(state))") >= 0 && trial.indexOf("if (!promptReady(state))") < trial.indexOf("state.setterDraft = body;"), "no practice run before the prompt loads");
assert.match(app, /promptReady: \(\) => promptReady\(state\),/);

const desk = read("acquire/setter-workspace.js");
const editor = between(desk, "function editorColumn(", "\nfunction ");
assert.match(editor, /const ready = !prompts \|\| promptIsReady\(ui\);/);
assert.match(editor, /prompts \? \(ready \? savedPrompt\(ui\.state\) : ""\)/, "editor is empty until loaded");
assert.match(editor, /if \(!ready\) save\.disabled = true;/);
assert.match(editor, /if \(!ready\) edit\.disabled = true;/);
assert.match(editor, /if \(!desk\.editing \|\| !ready\) area\.readOnly = true;/);
assert.match(desk, /if \(!promptIsReady\(ui\)\) apply\.disabled = true;/);
assert.match(read("acquire/client-pages.js"), /ui\.promptReady\(\) === false\) save\.disabled = true;/);

// --- 2. businesses page: owner rows survive the tester merge, reads run together ------
const owned = [
  { id: VAM, name: "Value Add Marketing", owner_id: "someone" },
  { id: ROLEFLOW, name: "Roleflow", owner_id: "diego" },
  { id: "aef53a66-c6d0-4e21-a132-0036e55fbbe1", name: "Caleb Wat", owner_id: "diego" }
];
assert.equal(mergeTesterBusinesses(owned, []).length, 3, "no tester rows: all three businesses stay");
assert.equal(mergeTesterBusinesses(owned, null).length, 3, "tester RPC error: all three stay");
assert.equal(mergeTesterBusinesses(owned, [{ business_id: ROLEFLOW, name: "Roleflow", role: "tester" }]).length, 3, "no duplicate when a tester row matches a listed business");

const biz = read("businesses/app.js");
const bizBoot = between(biz, "async function boot(supabase, user) {", "\n  function paint() {");
const batch = between(bizBoot, "await Promise.all([\n    loadPeople()", "]);");
assert.match(batch, /from\("acq_workspaces"\)/);
assert.match(batch, /rpc\("acq_my_tester_businesses"\)/);
assert.match(batch, /loadAgents\(\)/);
assert.ok((bizBoot.match(/await /g) || []).length <= 12, "boot has few sequential waits");
assert.match(bizBoot, /panelWorkspacesError = workspaceRes\.error/);
assert.match(biz, /id: "panel-board-error"/, "a failed business list says so instead of showing an empty page");

// --- 3. loadAll reads start together ----------------------------------------------------
assert.match(loadAll, /const later = \{/);
const kicked = loadAll.indexOf("const later = {");
const firstWait = loadAll.indexOf("await Promise.all([");
assert.ok(kicked > 0 && kicked < firstWait, "all reads start before the first wait");
const sequential = (loadAll.match(/await q\.(from|rpc)\(/g) || []).length;
assert.ok(sequential <= 6, "only fallback queries still wait one by one (found " + sequential + ")");
for (const table of ["acq_agent_prompts", "acq_agent_prompt_versions", "acq_winning_conversations", "acq_sync_log", "acq_voice_sends"]) {
  assert.ok(loadAll.slice(kicked, firstWait).includes('"' + table + '"'), table + " starts early");
}

// --- 4. one open invite per email ---------------------------------------------------------
const dupes = [
  { id: "a", email: "diego@valueaddmarketing.com", created_at: "2026-10-27T07:01:28Z", expires_at: null, accepted_at: null, token: "t1" },
  { id: "b", email: "Diego@ValueAddMarketing.com", created_at: "2026-10-27T07:01:29Z", expires_at: null, accepted_at: null, token: "t2" },
  { id: "c", email: "diego@valueaddmarketing.com", created_at: "2026-10-27T07:01:30Z", expires_at: null, accepted_at: null, token: "t3" },
  { id: "d", email: "other@example.com", created_at: "2026-10-28T00:00:00Z", expires_at: "2026-10-29T00:00:00Z", accepted_at: null, token: "t4" },
  { id: "e", email: "done@example.com", created_at: "2026-10-28T00:00:00Z", expires_at: null, accepted_at: "2026-10-28T01:00:00Z", token: "t5" }
];
const now = Date.parse("2026-11-11T15:00:00Z");
const listed = dedupeInvites(dupes, now);
assert.deepEqual(listed.map((row) => row.id), ["c"], "three duplicates show once (newest); expired and accepted are hidden");
assert.equal(reusableInvite(dupes, "DIEGO@valueaddmarketing.com", now).id, "c");
assert.equal(reusableInvite(dupes, "other@example.com", now), null, "expired invite is not reused");
assert.equal(reusableInvite(dupes, "new@example.com", now), null);
assert.equal(dupes.length, 5, "input rows untouched");

const dash = read("supabase/functions/client-dashboard/index.ts");
const invite = between(dash, "async function teamInvite(", "\nasync function teamRemove(");
const noAccount = invite.slice(invite.indexOf("return json(200, { ok: true, added: true"));
assert.doesNotMatch(noAccount, /\.delete\(\)/, "creating an invite no longer deletes rows");
assert.match(noAccount, /reusableInvite\(open\.data \|\| \[\], asked\.email\)/);
assert.ok(noAccount.indexOf("reusableInvite(") < noAccount.indexOf('.from("acq_invites").insert('), "reuse is checked before inserting");
assert.match(between(dash, "async function teamList(", "\nasync function "), /dedupeInvites\(/);
const teamInviteUi = between(app, "async function teamInvite(", "\nasync function ");
assert.match(teamInviteUi, /if \(state\.teamSaving\) return;/, "one invite request at a time");
assert.match(teamInviteUi, /finally \{\n    state\.teamSaving = false;/);

// Cancel removes only the one invite row it was given (Diego, 2026-11-11).
const remove = between(dash, "async function teamRemove(", "\nasync function ");
const inviteCancel = remove.slice(0, remove.indexOf("const memberId"));
assert.match(inviteCancel, /\.delete\(\)\.eq\("id", inviteId\)\.eq\("business_id", businessId\)\.is\("accepted_at", null\)/, "cancel deletes by invite id on this business");
assert.doesNotMatch(inviteCancel, /ilike\("email"/, "cancel does not sweep same-email invites");
assert.equal((inviteCancel.match(/\.delete\(\)/g) || []).length, 1, "one delete, one row");
