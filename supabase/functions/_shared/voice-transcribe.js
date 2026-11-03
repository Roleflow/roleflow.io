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
// arrive as video or share; only a real audio message counts as a voice note.
export function voiceAttachment(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index] && typeof list[index] === "object" ? list[index] : {};
    const type = String(item.type || "").toLowerCase();
    const original = String(item.originalType || "").toLowerCase();
    if (type !== "audio") continue;
    if (original && original !== "audio") continue;
    const url = String(item.url || (item.payload && item.payload.url) || "");
    if (!url.startsWith("https://")) continue;
    return { url, index, mimeType: String(item.mimeType || "") };
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
      const response = await withTimeout(fetchImpl, url, init || {}, opts.timeoutMs || VOICE_TIMEOUT_MS);
      if (!response.ok) return { ok: false };
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
      return { ok: true, bytes: read.bytes, mime: type.split(";")[0].trim() || voice.mimeType || "audio/mp4" };
    } catch (_error) {
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

function extensionFor(mime) {
  const type = String(mime || "").toLowerCase();
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (type.includes("wav")) return "wav";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("webm")) return "webm";
  if (type.includes("aac")) return "aac";
  if (type.includes("m4a")) return "m4a";
  return "mp4";
}

function formFor(provider, audio) {
  const form = new FormData();
  if (provider.name === "xai") {
    form.append("model", "grok-voice-transcribe-2.0");
  } else {
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
  }
  const blob = new Blob([audio.bytes], { type: audio.mime || "audio/mp4" });
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
    try {
      const response = await withTimeout(fetchImpl, url, {
        method: "POST",
        headers: { Authorization: "Bearer " + provider.key },
        body: formFor(provider, audio)
      }, opts.timeoutMs || VOICE_TIMEOUT_MS);
      if (!response.ok) continue;
      const result = readTranscript(provider.name, await response.json().catch(() => ({})));
      return { ok: true, ...result };
    } catch (_error) {
      continue;
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
