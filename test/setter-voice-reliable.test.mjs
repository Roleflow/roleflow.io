import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  audioMime,
  downloadVoice,
  transcribeAudio,
  understandVoice,
  voiceAttachment,
  voiceErrorLine,
  voiceKeyterms,
  voiceOptions
} from "../supabase/functions/_shared/voice-transcribe.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const m4a = new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112, 77, 52, 65, 32, 0, 0, 0, 0]);
const stt = (body) => ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => body });
const cdn = (type, bytes) => ({ ok: true, status: 200, headers: new Headers({ "content-type": type }), arrayBuffer: async () => bytes.buffer });

// Detection: every way Instagram labels a voice note, never a reel or a shared post.
assert.deepEqual(voiceAttachment([{ type: "audio", url: "https://cdn/a" }]), { url: "https://cdn/a", index: 0, mimeType: "" });
assert.equal(voiceAttachment([{ type: "voice", payload: { url: "https://cdn/b" } }]).url, "https://cdn/b");
assert.equal(voiceAttachment([{ type: "audio_clip", attachmentUrl: "https://cdn/c" }]).url, "https://cdn/c");
assert.equal(voiceAttachment([{ type: "file", mimeType: "audio/mp4", url: "https://cdn/d" }]).url, "https://cdn/d");
assert.equal(voiceAttachment([{ mimeType: "audio/ogg", src: "https://cdn/e" }]).url, "https://cdn/e");
assert.equal(voiceAttachment([{ type: "audio", originalType: "audio_clip", url: "https://cdn/f" }]).url, "https://cdn/f");
assert.equal(voiceAttachment([{ type: "audio", originalType: "voice_message", url: "https://cdn/g" }]).url, "https://cdn/g");
assert.equal(voiceAttachment([{ type: "video", url: "https://cdn/r.mp4", originalType: "ig_reel" }]), null);
assert.equal(voiceAttachment([{ type: "audio", url: "https://cdn/x", originalType: "unsupported_type" }]), null);
assert.equal(voiceAttachment([{ type: "file", mimeType: "application/pdf", url: "https://cdn/p" }]), null);
assert.equal(voiceAttachment([{ type: "audio", url: "http://insecure" }]), null);
assert.equal(voiceAttachment([{ type: "image", url: "https://cdn/i" }, { type: "audio", url: "https://cdn/v" }]).index, 1);

// The real container decides the type the transcriber sees.
assert.equal(audioMime(m4a, "video/mp4"), "audio/mp4");
assert.equal(audioMime(m4a, "application/octet-stream"), "audio/mp4");
assert.equal(audioMime(new Uint8Array([79, 103, 103, 83, 0]), ""), "audio/ogg");
assert.equal(audioMime(new Uint8Array([73, 68, 51, 4]), ""), "audio/mpeg");
assert.equal(audioMime(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), ""), "audio/webm");
assert.equal(audioMime(new Uint8Array([1, 2, 3]), "audio/aac"), "audio/aac");
assert.equal(audioMime(new Uint8Array([1, 2, 3]), "application/octet-stream"), "audio/mp4");

// Download sends a browser-like agent and relabels a CDN video/mp4 note as audio.
let seenHeaders = null;
const got = await downloadVoice({ url: "https://lookaside.fbsbx.com/x" }, {
  fetchImpl: async (_url, init) => { seenHeaders = init.headers; return cdn("video/mp4", m4a); }
});
assert.equal(got.ok, true);
assert.equal(got.mime, "audio/mp4");
assert.match(seenHeaders["User-Agent"], /Mozilla/);

// The file reaches xAI as m4a with keyterms before the file, and a busy provider is retried once.
let calls = 0;
let form = null;
const heard = await transcribeAudio({ bytes: m4a, mime: "audio/mp4" }, { XAI_API_KEY: "k" }, {
  retryMs: 0,
  keyterms: ["Value Add Marketing", "valueaddmarketing", "Value Add Marketing", "x"],
  fetchImpl: async (_url, init) => {
    calls += 1;
    form = init.body;
    if (calls === 1) return { ok: false, status: 503, text: async () => "busy" };
    return stt({ text: "Quiero dominar Texas", language: "es-mx", duration: 2.4 });
  }
});
assert.equal(calls, 2);
assert.equal(heard.ok, true);
assert.equal(heard.text, "Quiero dominar Texas");
assert.equal(form.get("model"), "grok-voice-transcribe-2.0");
assert.deepEqual(form.getAll("keyterm"), ["Value Add Marketing", "valueaddmarketing"]);
assert.equal(form.get("file").name, "voice-note.m4a");
assert.equal(form.get("file").type, "audio/mp4");
const keys = [...form.keys()];
assert.equal(keys[keys.length - 1], "file");

// A rejected key is not retried, and every failure is reported without the key.
const logged = [];
calls = 0;
const refused = await understandVoice({ url: "https://cdn/a" }, { XAI_API_KEY: "xai-secretvalue123" }, {
  retryMs: 0,
  onError: (detail) => logged.push(detail),
  fetchImpl: async (url) => {
    if (url.startsWith("https://cdn")) return cdn("audio/mp4", m4a);
    calls += 1;
    return { ok: false, status: 401, text: async () => "Incorrect API key provided: xai-secretvalue123" };
  }
});
assert.equal(refused.ok, false);
assert.equal(refused.reason, "transcribe");
assert.equal(calls, 1);
assert.equal(logged[0].stage, "transcribe");
assert.equal(logged[0].status, 401);
const line = voiceErrorLine(logged[0]);
assert.ok(!line.includes("secretvalue123"));
assert.match(line, /Voice note transcribe failed, provider xai, status 401/);

const missing = [];
await downloadVoice({ url: "https://cdn/gone" }, { fetchImpl: async () => ({ ok: false, status: 403 }), onError: (d) => missing.push(d) });
assert.equal(missing[0].stage, "download");
assert.equal(missing[0].status, 403);

assert.deepEqual(voiceKeyterms(["  a ", "Roleflow", "roleflow", "x".repeat(80)]), ["Roleflow", "x".repeat(50)]);

// voiceOptions reads the business name and logs failures to acq_llm_errors.
const inserted = [];
const fakeDb = {
  from: (table) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: table === "acq_workspaces" ? { name: "Value Add Marketing" } : null }),
        limit: () => ({ maybeSingle: async () => ({ data: { username: "valueaddmarketing" } }) })
      })
    }),
    insert: (row) => { inserted.push({ table, row }); return Promise.resolve({}); }
  })
};
const opts = await voiceOptions(fakeDb, "biz", { refresh: null });
assert.deepEqual(opts.keyterms, ["Value Add Marketing", "valueaddmarketing"]);
opts.onError({ stage: "download", status: 403 });
assert.equal(inserted[0].table, "acq_llm_errors");
assert.equal(inserted[0].row.business_id, "biz");
assert.match(inserted[0].row.message, /Voice note download failed/);

// Both setter paths pass the business options into the transcriber.
assert.match(read("supabase/functions/zernio-webhook/index.ts"), /understandVoice\(job\.event\.voice, env, await voiceOptions\(admin, job\.account\.businessId/);
assert.match(read("supabase/functions/roleflow-acquisition/index.ts"), /understandVoice\(row\.payload\.voice, env, await voiceOptions\(db, businessId/);

console.log("setter voice notes reliable: ok");
