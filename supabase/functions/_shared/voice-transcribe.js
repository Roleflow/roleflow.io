// Lead voice notes: download the audio, transcribe it, and hand the transcript to the
// setter as the lead's message. A note that cannot be understood is never guessed at:
// the caller hands the thread to a person instead.
//
// Providers (first key found wins, the next one is a fallback):
//   xai     XAI_API_KEY      POST https://api.x.ai/v1/stt (grok-voice-transcribe-2.0)
//   openai  OPENAI_API_KEY   POST https://api.openai.com/v1/audio/transcriptions (whisper-1)

export const VOICE_MAX_SECONDS = 180;
export const VOICE_MAX_BYTES = 10 * 1024 * 1024;
export const VOICE_MAX_CHARS = 3500;
export const VOICE_TIMEOUT_MS = 30000;
export const VOICE_FAILED_BODY = "Voice note (could not be transcribed)";
export const VOICE_PENDING_BODY = "Voice note";

const LANGUAGE_NAMES = {
  en: "English", es: "Spanish", pt: "Portuguese", fr: "French", de: "German", it: "Italian",
  nl: "Dutch", ca: "Catalan", ar: "Arabic", ru: "Russian", ja: "Japanese", zh: "Chinese",
  ko: "Korean", hi: "Hindi", tr: "Turkish", pl: "Polish", sv: "Swedish", vi: "Vietnamese"
};

const FAIL_COPY = {
  download: "A lead sent a voice note that could not be downloaded. Listen to it and reply yourself.",
  too_long: "A lead sent a voice note longer than " + Math.round(VOICE_MAX_SECONDS / 60) + " minutes. Listen to it and reply yourself.",
  empty: "A lead sent a voice note with no clear speech. Listen to it and reply yourself.",
  no_provider: "A lead sent a voice note, and no transcription key is set up. Listen to it and reply yourself.",
  transcribe: "A lead sent a voice note that could not be transcribed. Listen to it and reply yourself."
};

export function voiceFailureMessage(reason) {
  return FAIL_COPY[reason] || FAIL_COPY.transcribe;
}

// The first audio attachment of an incoming message, or null. Shared reels and posts
// arrive as video or share; only a real audio message counts as a voice note. Instagram
// voice notes can be labelled "audio", "voice" or "audio_clip", or only carry an audio/*
// mime type, and the link can sit in url, payload.url, attachmentUrl or src.
const AUDIO_TYPES = ["audio", "voice", "voice_note", "audio_clip", "audioclip"];
const NOT_VOICE = ["unsupported_type", "ig_reel", "reel", "share", "story_mention", "story_reply", "image", "video", "file", "sticker"];

function attachmentUrl(item) {
  const candidates = [item.url, item.payload && item.payload.url, item.attachmentUrl, item.src, item.fileUrl, item.file_url, item.link];
  for (const value of candidates) {
    const url = String(value || "");
    if (url.startsWith("https://")) return url;
  }
  return "";
}

export function voiceAttachment(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index] && typeof list[index] === "object" ? list[index] : {};
    const type = String(item.type || "").toLowerCase();
    const original = String(item.originalType || "").toLowerCase();
    const mimeType = String(item.mimeType || item.mime_type || item.contentType || "").toLowerCase();
    const audioType = AUDIO_TYPES.includes(type);
    const audioMime = mimeType.startsWith("audio/");
    if (!audioType && !(audioMime && (type === "" || type === "file"))) continue;
    if (original && !AUDIO_TYPES.includes(original) && NOT_VOICE.includes(original)) continue;
    const url = attachmentUrl(item);
    if (!url) continue;
    return { url, index, mimeType: String(item.mimeType || item.mime_type || item.contentType || "") };
  }
  return null;
}

// Same rule for Meta's own webhook shape: message.attachments[].{type, payload.url}.
export function metaVoiceAttachment(message) {
  const list = message && Array.isArray(message.attachments) ? message.attachments : [];
  return voiceAttachment(list.map((item) => ({ type: item && item.type, url: item && item.payload && item.payload.url })));
}

export function transcribers(env) {
  const source = env || {};
  const list = [];
  if (source.XAI_API_KEY) list.push({ name: "xai", key: String(source.XAI_API_KEY) });
  if (source.OPENAI_API_KEY) list.push({ name: "openai", key: String(source.OPENAI_API_KEY) });
  return list;
}

export function languageName(code) {
  const base = String(code || "").toLowerCase().split(/[-_]/)[0];
  if (LANGUAGE_NAMES[base]) return LANGUAGE_NAMES[base];
  const named = Object.values(LANGUAGE_NAMES).find((name) => name.toLowerCase() === base);
  return named || "";
}

function withTimeout(fetchImpl, url, init, ms) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), ms) : null;
  return fetchImpl(url, controller ? { ...(init || {}), signal: controller.signal } : init)
    .finally(() => { if (timer) clearTimeout(timer); });
}

async function readCapped(response, maxBytes) {
  const declared = Number(response.headers && response.headers.get ? response.headers.get("content-length") : 0) || 0;
  if (declared > maxBytes) return { tooLarge: true };
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) return { tooLarge: true };
  return { bytes: buffer };
}

function headerValue(response, name) {
  return response.headers && response.headers.get ? String(response.headers.get(name) || "") : "";
}

// Download the note. When the signed CDN link has expired, ask the inbox to re-mint it.
export async function downloadVoice(voice, options) {
  const opts = options || {};
  const fetchImpl = opts.fetchImpl || fetch;
  const maxBytes = opts.maxBytes || VOICE_MAX_BYTES;
  const tryUrl = async (url, init) => {
    try {
      const base = init || {};
      const headers = { "User-Agent": DOWNLOAD_AGENT, Accept: "audio/*, video/mp4, application/octet-stream, */*", ...(base.headers || {}) };
      const response = await withTimeout(fetchImpl, url, { ...base, headers }, opts.timeoutMs || VOICE_TIMEOUT_MS);
      if (!response.ok) {
        note(opts, { stage: "download", status: Number(response.status) || 0 });
        return { ok: false };
      }
      const type = headerValue(response, "content-type");
      if (type.includes("application/json")) {
        const body = await response.json().catch(() => ({}));
        const next = String((body && (body.url || (body.data && body.data.url) || (body.attachment && body.attachment.url))) || "");
        if (!next.startsWith("https://")) return { ok: false };
        return tryUrl(next, {});
      }
      const read = await readCapped(response, maxBytes);
      if (read.tooLarge) return { ok: false, reason: "too_long" };
      if (!read.bytes.byteLength) return { ok: false };
      return { ok: true, bytes: read.bytes, mime: audioMime(read.bytes, type.split(";")[0].trim() || (voice && voice.mimeType) || "") };
    } catch (error) {
      note(opts, { stage: "download", status: 0, message: errorText(error) });
      return { ok: false };
    }
  };
  const first = voice && voice.url ? await tryUrl(voice.url) : { ok: false };
  if (first.ok || first.reason === "too_long") return first;
  const refresh = opts.refresh || null;
  if (refresh && refresh.url) {
    const again = await tryUrl(refresh.url, { headers: refresh.headers || {} });
    if (again.ok || again.reason === "too_long") return again;
  }
  return { ok: false, reason: "download" };
}

const DOWNLOAD_AGENT = "Mozilla/5.0 (compatible; RoleflowVoice/1.0)";

function note(opts, detail) {
  if (opts && typeof opts.onError === "function") {
    try { opts.onError(detail); } catch (_error) { /* diagnostics never break a reply */ }
  }
}

function errorText(error) {
  const text = error && typeof error === "object" && "name" in error && error.name === "AbortError"
    ? "timed out"
    : String((error && error.message) || error || "error");
  return text.replace(/Bearer\s+\S+/gi, "Bearer ***").slice(0, 200);
}

// The real container, read from the first bytes. Instagram's CDN often labels a voice
// note video/mp4 or application/octet-stream; the transcriber needs an audio type and a
// matching file name.
export function audioMime(bytes, declared) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 8 && ascii(4, 8) === "ftyp") return "audio/mp4";
  if (b.length >= 4 && ascii(0, 4) === "OggS") return "audio/ogg";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm";
  if (b.length >= 3 && ascii(0, 3) === "ID3") return "audio/mpeg";
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return "audio/aac";
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (b.length >= 4 && ascii(0, 4) === "fLaC") return "audio/flac";
  const type = String(declared || "").toLowerCase();
  if (type.startsWith("audio/")) return type;
  return "audio/mp4";
}

function extensionFor(mime) {
  const type = String(mime || "").toLowerCase();
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (type.includes("wav")) return "wav";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("webm")) return "webm";
  if (type.includes("aac")) return "aac";
  if (type.includes("flac")) return "flac";
  return "m4a";
}

export function voiceKeyterms(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const term = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 50);
    if (term.length < 2 || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    out.push(term);
    if (out.length >= 20) break;
  }
  return out;
}

function formFor(provider, audio, opts) {
  const form = new FormData();
  if (provider.name === "xai") {
    // Option fields go before the file. The spoken language is detected per note.
    form.append("model", "grok-voice-transcribe-2.0");
    for (const term of voiceKeyterms(opts && opts.keyterms)) form.append("keyterm", term);
  } else {
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
  }
  const blob = new Blob([audio.bytes], { type: audio.mime || "audio/mp4" });
  if (provider.name === "openai" && opts && Array.isArray(opts.keyterms) && opts.keyterms.length) form.append("prompt", voiceKeyterms(opts.keyterms).join(", "));
  form.append("file", blob, "voice-note." + extensionFor(audio.mime));
  return form;
}

export function readTranscript(provider, payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  return {
    text: String(body.text || "").replace(/\s+/g, " ").trim(),
    language: String(body.language || ""),
    duration: Number(body.duration) || 0,
    provider
  };
}

export async function transcribeAudio(audio, env, options) {
  const opts = options || {};
  const fetchImpl = opts.fetchImpl || fetch;
  const providers = transcribers(env);
  if (!providers.length) return { ok: false, reason: "no_provider" };
  for (const provider of providers) {
    const url = provider.name === "xai" ? "https://api.x.ai/v1/stt" : "https://api.openai.com/v1/audio/transcriptions";
    // One retry for a busy or flaky provider (429, 5xx, timeout); a rejected key or bad file is final.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let retry = false;
      try {
        const response = await withTimeout(fetchImpl, url, {
          method: "POST",
          headers: { Authorization: "Bearer " + provider.key },
          body: formFor(provider, audio, opts)
        }, opts.timeoutMs || VOICE_TIMEOUT_MS);
        if (response.ok) {
          const result = readTranscript(provider.name, await response.json().catch(() => ({})));
          return { ok: true, ...result };
        }
        const status = Number(response.status) || 0;
        const detail = response.text ? String(await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200) : "";
        note(opts, { stage: "transcribe", provider: provider.name, status, message: detail, mime: audio.mime, bytes: audio.bytes ? audio.bytes.byteLength : 0 });
        retry = status === 429 || status >= 500;
      } catch (error) {
        note(opts, { stage: "transcribe", provider: provider.name, status: 0, message: errorText(error), mime: audio.mime, bytes: audio.bytes ? audio.bytes.byteLength : 0 });
        retry = true;
      }
      if (!retry) break;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, opts.retryMs == null ? 1200 : opts.retryMs));
    }
  }
  return { ok: false, reason: "transcribe" };
}

// Download, transcribe and check the result. Never returns a partial transcript.
export async function understandVoice(voice, env, options) {
  const audio = await downloadVoice(voice, options);
  if (!audio.ok) return { ok: false, reason: audio.reason || "download" };
  const heard = await transcribeAudio(audio, env, options);
  if (!heard.ok) return heard;
  if (heard.duration > VOICE_MAX_SECONDS) return { ok: false, reason: "too_long" };
  if (!heard.text) return { ok: false, reason: "empty" };
  if (heard.text.length > VOICE_MAX_CHARS) return { ok: false, reason: "too_long" };
  return heard;
}

// What the setter model receives when the lead spoke instead of typing.
export function inboundText(typed, transcript) {
  const text = String(typed || "").trim();
  const spoken = String(transcript || "").trim();
  if (!spoken) return text;
  return text ? text + "\n\n" + spoken : spoken;
}

export function voiceBody(typed, transcript) {
  const text = String(typed || "").trim();
  const line = "Voice note: " + String(transcript || "").trim();
  return text ? text + "\n\n" + line : line;
}

export function voiceMetadata(heard) {
  return {
    voice_note: {
      status: "transcribed",
      transcript: heard.text,
      language: heard.language || "",
      duration: heard.duration || 0,
      provider: heard.provider || ""
    }
  };
}

export function modelInbound(base, voice) {
  const next = { ...(base || {}) };
  if (voice && voice.transcribed) {
    next.inbound_type = "voice_note";
    if (voice.language) next.inbound_language = languageName(voice.language) || voice.language;
  }
  return next;
}

export function voiceRule(voice) {
  if (!voice || !voice.transcribed) return "";
  const language = languageName(voice.language) || String(voice.language || "");
  return "\n\nVoice notes\nThe lead sent a voice note. \"inbound\" is its transcript: treat it as what they said and answer it directly. Do not mention transcripts or that you could not hear them." +
    (language ? " They spoke " + language + ". Reply in " + language + "." : " Reply in the language they spoke.");
}

// Words the transcriber should lean toward (the business and account names), and a
// log line in acq_llm_errors for every failed download or transcription so a missed
// note can be traced. Never logs a key.
export function voiceErrorLine(detail) {
  const d = detail || {};
  const parts = ["Voice note " + String(d.stage || "transcribe") + " failed"];
  if (d.provider) parts.push("provider " + d.provider);
  parts.push("status " + (Number(d.status) || 0));
  if (d.mime) parts.push(String(d.mime));
  if (d.bytes) parts.push(d.bytes + " bytes");
  const message = String(d.message || "").replace(/Bearer\s+\S+/gi, "Bearer ***").replace(/\b(xai|sk)-[A-Za-z0-9_-]{6,}/g, "$1-***");
  return (parts.join(", ") + (message ? ": " + message : "")).slice(0, 240);
}

export async function voiceOptions(db, businessId, base) {
  const terms = [];
  if (db && businessId) {
    try {
      const workspace = await db.from("acq_workspaces").select("name").eq("id", businessId).maybeSingle();
      if (workspace && workspace.data && workspace.data.name) terms.push(workspace.data.name);
      const account = await db.from("ig_gateway_accounts").select("username").eq("business_id", businessId).limit(1).maybeSingle();
      if (account && account.data && account.data.username) terms.push(account.data.username);
    } catch (_error) { /* keyterms are only a hint */ }
  }
  return {
    ...(base || {}),
    keyterms: voiceKeyterms(terms),
    onError: (detail) => {
      if (!db || !businessId) return;
      const write = db.from("acq_llm_errors").insert({
        business_id: businessId,
        purpose: "setter",
        provider: String((detail && detail.provider) || "voice").slice(0, 40),
        model: detail && detail.provider === "openai" ? "whisper-1" : "grok-voice-transcribe-2.0",
        message: voiceErrorLine(detail),
        fell_back: false
      });
      if (write && typeof write.then === "function") write.then(() => {}, () => {});
    }
  };
}
