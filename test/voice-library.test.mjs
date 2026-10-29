import assert from "node:assert/strict";
import fs from "node:fs";
import { pickRoutedNote, stepForState, usedCounts, workflowSteps } from "../acquire/voice-route.js";
import { encodeWav, VOICE_MIME } from "../acquire/wav-encode.js";
import { attachVoiceFile } from "../workers/roleflow-dm/send.mjs";

const steps = workflowSteps("Intro\nQualify the budget\nThen send the Booking link");
assert.equal(steps.includes("Intro"), true);
assert.equal(steps.some((step) => step.toLowerCase() === "booking link"), true);
assert.equal(stepForState("qualifying"), "Qualify");
assert.equal(stepForState("booked"), "Booking link");

const notes = [
  { id: "person", assignment_kind: "person", lead_handle: "ada", step_name: "", active: true, deleted_at: null },
  { id: "step", assignment_kind: "step", lead_handle: "", step_name: "Qualify", active: true, deleted_at: null },
  { id: "open", assignment_kind: "none", lead_handle: "", step_name: "", active: true, deleted_at: null }
];
assert.equal(pickRoutedNote({ notes, handle: "@ada", state: "qualifying", sentIds: [] }).id, "person");
assert.equal(pickRoutedNote({ notes, handle: "sam", state: "qualifying", sentIds: [] }).id, "step");
assert.equal(pickRoutedNote({ notes, handle: "ada", state: "qualifying", sentIds: ["person"] }).id, "step");
assert.equal(pickRoutedNote({ notes, handle: "sam", state: "open", sentIds: [] }), null);
assert.deepEqual(usedCounts([{ voice_note_id: "step", result: "sent" }, { voice_note_id: "step", result: "skipped" }]), { step: 1 });

const wav = encodeWav(Float32Array.from([0, 0.5, -0.5]), 8000);
const header = new TextDecoder().decode(await wav.arrayBuffer().then((buffer) => buffer.slice(0, 12)));
assert.equal(header.startsWith("RIFF"), true);
assert.equal(header.includes("WAVE"), true);
assert.equal(VOICE_MIME, "audio/wav");

const missing = await attachVoiceFile({ locator: () => ({ count: async () => 0, first: () => ({ setInputFiles: async () => {} }) }) }, "note.wav");
assert.equal(missing.reason, "no_file_input");
let attached = "";
const found = await attachVoiceFile({
  locator: () => ({ count: async () => 1, first: () => ({ setInputFiles: async (path) => { attached = path; } }) })
}, "note.wav");
assert.equal(found.reason, "attached");
assert.equal(attached, "note.wav");

const root = new URL("../", import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), "utf8");
assert.equal(read("acquire/voice-route.js"), read("supabase/functions/_shared/voice-route.js"));
const page = read("acquire/voice-desk.js") + read("acquire/app.js");
assert.match(page, /Unassigned/);
assert.match(page, /Re-record/);
assert.match(page, /deleted_at/);
assert.doesNotMatch(page, /zernio/i);
assert.match(read("supabase/functions/roleflow-acquisition/index.ts"), /pickRoutedNote/);
assert.match(read("supabase/functions/roleflow-acquisition/index.ts"), /dm_disabled/);
assert.match(read("acquire/cta-page.js"), /Library note/);
const sql = read("supabase/migrations/20261029200000_voice_library_names.sql");
assert.match(sql, /assignment_kind/);
assert.match(sql, /deleted_at/);
assert.match(sql, /voice_note_id/);
assert.doesNotMatch(sql, /drop table/i);
assert.match(read("docs/voice-notes.md"), /UNVERIFIED/);
assert.match(read("docs/voice-notes.md"), /aac, m4a, wav, and mp4/);

console.log("voice library tests passed");
