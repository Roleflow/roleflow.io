import assert from "node:assert/strict";
import fs from "node:fs";
import { pickRoutedNote, stepForState, usedCounts, workflowSteps } from "../acquire/voice-route.js";
import { encodeWav, VOICE_MIME } from "../acquire/wav-encode.js";
import { sendRequest } from "../supabase/functions/_shared/ig-gateway.js";
import { sniffAudio } from "../supabase/functions/_shared/clip-audio.js";

const root = new URL("../", import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), "utf8");

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

assert.doesNotMatch(read("workers/roleflow-dm/send.mjs"), /attachVoiceFile|setInputFiles/);
assert.equal(read("acquire/voice-route.js"), read("supabase/functions/_shared/voice-route.js"));
const page = read("acquire/voice-desk.js") + read("acquire/app.js");
assert.match(page, /Unassigned/);
assert.match(page, /used /);
assert.match(page, /Step not in SOP/);
assert.match(page, /rec-dot/);
assert.match(read("acquire/cta-page.js"), /No library note \/ custom file/);
assert.match(read("acquire/studio-flow.js"), /Voice Gen/);
assert.doesNotMatch(read("acquire/studio-flow.js"), /chosen in Content/);
assert.match(read("acquire/acquire.css"), /button\.cta-secondary/);
assert.match(read("acquire/acquire.css"), /\.bubble audio/);
assert.match(page, /Re-record/);
assert.match(page, /deleted_at/);
assert.doesNotMatch(page, /zernio/i);
assert.match(read("supabase/functions/roleflow-acquisition/index.ts"), /pickRoutedNote/);
assert.match(read("supabase/functions/roleflow-acquisition/index.ts"), /dm_disabled/);
assert.match(read("supabase/functions/roleflow-acquisition/index.ts"), /uploadDirect/);
assert.match(read("supabase/functions/roleflow-acquisition/index.ts"), /attachmentType: "audio"/);
assert.match(read("supabase/functions/roleflow-acquisition/index.ts"), /sniffAudio/);
assert.doesNotMatch(read("supabase/functions/roleflow-acquisition/index.ts"), /audioBody/);
assert.equal(sniffAudio(new Uint8Array(await wav.arrayBuffer())), "audio/wav");
const audio = sendRequest({ kind: "reply", payload: { accountId: "acct", conversationId: "thread", text: "", attachmentUrl: "https://cdn.example/note.wav", attachmentType: "audio" } });
assert.equal(audio.body.attachmentType, "audio");
assert.equal(audio.body.attachmentUrl, "https://cdn.example/note.wav");
assert.equal(Object.hasOwn(audio.body, "voiceNote"), false);
assert.equal(audio.body.message, undefined);
assert.match(read("acquire/cta-page.js"), /Library note/);
const sql = read("supabase/migrations/20261029200000_voice_library_names.sql");
assert.match(sql, /assignment_kind/);
assert.match(sql, /deleted_at/);
assert.match(sql, /voice_note_id/);
assert.doesNotMatch(sql, /drop table/i);
assert.match(read("docs/voice-notes.md"), /UNVERIFIED/);
assert.match(read("docs/voice-notes.md"), /aac, m4a, wav, and mp4/);

console.log("voice library tests passed");
