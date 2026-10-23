// Instagram, through the inbox API, accepts AAC, M4A, WAV, and MP4 audio.
// It rejects MP3 and OGG. WAV is the conversion target because it needs no codec.

const READY = new Set(["audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/wav", "audio/wave", "audio/x-wav"]);
const CONVERT = new Set(["audio/mpeg", "audio/mp3", "audio/ogg", "audio/webm", "audio/opus"]);

export function instagramAudioReady(mime, name) {
  const type = String(mime || "").toLowerCase();
  const ext = extension(name);
  if (READY.has(type)) return true;
  if ((!type || type === "application/octet-stream") && ["m4a", "aac", "wav"].includes(ext)) return true;
  return false;
}

export function needsAudioConvert(mime, name) {
  if (instagramAudioReady(mime, name)) return false;
  const type = String(mime || "").toLowerCase();
  return CONVERT.has(type) || ["mp3", "ogg", "webm", "opus"].includes(extension(name));
}

export function deliveryMime(mime, name) {
  if (needsAudioConvert(mime, name)) return "audio/wav";
  const type = String(mime || "").toLowerCase();
  if (type === "audio/m4a" || type === "audio/x-m4a" || extension(name) === "m4a") return "audio/mp4";
  if (type === "audio/wave" || type === "audio/x-wav" || extension(name) === "wav") return "audio/wav";
  if (type === "audio/aac" || extension(name) === "aac") return "audio/aac";
  return type || "application/octet-stream";
}

export function encodeWav(samples, sampleRate) {
  const input = samples || [];
  const count = input.length;
  const rate = Math.max(8000, Math.round(Number(sampleRate) || 16000));
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, count * 2, true);
  let offset = 44;
  for (let index = 0; index < count; index += 1) {
    const sample = Math.max(-1, Math.min(1, Number(input[index]) || 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

export function sniffAudio(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (data.length >= 12 && text(data, 0, 4) === "RIFF" && text(data, 8, 4) === "WAVE") return "audio/wav";
  if (data.length >= 8 && text(data, 4, 4) === "ftyp") return "audio/mp4";
  if (data.length >= 4 && text(data, 0, 4) === "OggS") return "audio/ogg";
  if (data.length >= 3 && data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) return "audio/mpeg";
  if (data.length >= 2 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0) return "audio/mpeg";
  return "";
}

export function assertInstagramContainer(bytes, mime) {
  const sniffed = sniffAudio(bytes);
  const type = sniffed || String(mime || "").toLowerCase();
  if (type === "audio/mpeg" || type === "audio/ogg" || type === "audio/webm") {
    return { ok: false, error: "Instagram does not accept this audio format." };
  }
  if (type === "audio/wav" || type === "audio/mp4" || type === "audio/aac") return { ok: true, mime: type };
  if (instagramAudioReady(mime, "")) return { ok: true, mime: deliveryMime(mime, "") };
  return { ok: false, error: "Instagram does not accept this audio format." };
}

export function ffmpegWavCommand(inputPath, outputPath) {
  return ["ffmpeg", "-y", "-i", inputPath, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outputPath];
}

function extension(name) {
  const parts = String(name || "").toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

function writeString(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function text(data, offset, length) {
  let out = "";
  for (let index = 0; index < length; index += 1) out += String.fromCharCode(data[offset + index]);
  return out;
}
