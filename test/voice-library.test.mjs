import assert from "node:assert/strict";
import fs from "node:fs";
import { pickRoutedNote, stepForState, usedCounts, workflowSteps } from "../acquire/voice-route.js";
import { encodeWav, VOICE_MIME } from "../acquire/wav-encode.js";
import { audioSpecificConfig, downsampleMono, muxAacMp4, preferredRecorderMime, recorderStartOptions, samplesToVoiceFile, storageContentType, VOICE_MAX_BYTES, VOICE_MAX_MS, voiceError } from "../acquire/voice-audio.js";
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
assert.equal(new DataView(await wav.arrayBuffer()).getUint32(24, true), 8000);

const asc = audioSpecificConfig(44100, 1);
assert.equal(asc[0], 0x12);
assert.equal(asc[1], 0x08);
const frame = new Uint8Array([0x21, 0x10, 0x04, 0x60]);
const m4a = muxAacMp4({ frames: [frame, frame], sampleRate: 44100, channels: 1 });
assert.equal(sniffAudio(m4a), "audio/mp4");
assert.equal(asciiAt(m4a, 4), "ftyp");
assert.equal(asciiAt(m4a, 8), "M4A ");
assert.equal(m4a.includes(0x12) && includesBytes(m4a, asc), true);
assert.equal(includesBytes(m4a, new TextEncoder().encode("mp4a")), true);
const mdat = boxPayload(m4a, "mdat");
assert.equal(mdat.length, frame.length * 2);

const low = downsampleMono(Float32Array.from([0, 1, 0, -1]), 4, 2);
assert.equal(low.length, 2);
const fallback = await samplesToVoiceFile(Float32Array.from([0, 0.25, -0.25, 0.5]), 44100, 1000, async () => { throw new Error("no aac"); });
assert.equal(fallback.mime, "audio/wav");
assert.equal(fallback.file.type, "audio/wav");
assert.equal(new DataView(await fallback.file.arrayBuffer()).getUint32(24, true), 16000);
const encoded = await samplesToVoiceFile(Float32Array.from([0, 0.2]), 44100, 500, async () => m4a);
assert.equal(encoded.mime, "audio/mp4");
assert.equal(encoded.file.type, "audio/mp4");
assert.equal(storageContentType(encoded.file), "audio/mp4");
assert.equal(storageContentType(new File([m4a], "note.m4a", { type: "audio/x-m4a" })), "audio/mp4");
await assert.rejects(() => samplesToVoiceFile(Float32Array.of(0), 16000, VOICE_MAX_MS + 1, async () => m4a), (error) => error.code === "too_long");
await assert.rejects(() => samplesToVoiceFile(Float32Array.of(0), 16000, 1000, async () => new Uint8Array(VOICE_MAX_BYTES + 1)), (error) => error.code === "too_big");
assert.match(voiceError("too_big", false), /4\.5 MB/);
assert.match(voiceError("too_long", false), /60 seconds/);
assert.equal(preferredRecorderMime((type) => type === "audio/mp4"), "audio/mp4");
assert.equal(preferredRecorderMime((type) => type.startsWith("audio/webm")), "audio/webm;codecs=opus");
assert.equal(recorderStartOptions(() => false).audioBitsPerSecond, 64000);

assert.doesNotMatch(read("workers/roleflow-dm/send.mjs"), /attachVoiceFile|setInputFiles/);
assert.equal(read("acquire/voice-route.js"), read("supabase/functions/_shared/voice-route.js"));
const page = read("acquire/voice-desk.js") + read("acquire/app.js");
assert.match(page, /Unassigned/);
assert.match(page, /used /);
assert.match(page, /Step not in SOP/);
assert.match(page, /rec-dot/);
assert.match(page, /60 seconds max/);
assert.match(page, /Stopped at 60 seconds/);
assert.match(read("acquire/voice-audio.js"), /4\.5 MB/);
assert.match(page, /audio\/mp4/);
assert.match(page, /contentType: mime/);
assert.match(read("acquire/voice-audio.js"), /mp4a\.40\.2/);
assert.match(read("acquire/voice-audio.js"), /16000/);
assert.match(read("acquire/acquire.css"), /min-width:min\(280px,100%\)/);
assert.match(read("acquire/acquire.css"), /\.voice-tools \.cta-upload/);
assert.match(read("acquire/acquire.css"), /\.voice-card input/);
assert.match(read("acquire/acquire.css"), /\.voice-card-actions\{display:flex;flex-wrap:nowrap/);
assert.match(page, /cta-danger/);
assert.match(read("acquire/studio-flow.js"), /Voice notes are chosen in Voice Gen/);
assert.match(read("acquire/home.js"), /"ctas", "chats", "voice"/);
assert.match(read("acquire/send-badge.js"), /cta-send-state/);
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

function asciiAt(bytes, offset) {
  return new TextDecoder().decode(bytes.slice(offset, offset + 4));
}

function includesBytes(bytes, needle) {
  for (let index = 0; index <= bytes.length - needle.length; index += 1) {
    let same = true;
    for (let cursor = 0; cursor < needle.length; cursor += 1) {
      if (bytes[index + cursor] !== needle[cursor]) same = false;
    }
    if (same) return true;
  }
  return false;
}

function boxPayload(bytes, type) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const size = view.getUint32(offset);
    const name = asciiAt(bytes, offset + 4);
    if (size < 8 || offset + size > bytes.length) break;
    if (name === type) return bytes.slice(offset + 8, offset + size);
    offset += size;
  }
  return new Uint8Array();
}
