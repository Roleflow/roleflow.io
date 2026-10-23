// Browser-side preparation for a recording the setter can send.
// Instagram accepts m4a, aac, and wav. mp3, ogg, and webm are rewritten
// here to 16 kHz mono wav before the file is stored.

const READY = new Set(["audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/wav", "audio/wave", "audio/x-wav"]);
const CONVERT = new Set(["audio/mpeg", "audio/mp3", "audio/ogg", "audio/webm", "audio/opus"]);
const IMAGE = new Set(["image/jpeg", "image/png"]);
const VIDEO = new Set(["video/mp4", "video/quicktime", "video/webm"]);

export async function prepareOwnerFile(file) {
  if (!file) throw new Error("Choose a file.");
  const mime = String(file.type || "").toLowerCase();
  const name = file.name || "";
  if (IMAGE.has(mime)) return { blob: file, mime, kind: "image", converted: false };
  if (VIDEO.has(mime)) return { blob: file, mime, kind: "video", converted: false };
  if (readyAudio(mime, name)) return { blob: file, mime: deliveryMime(mime, name), kind: "audio", converted: false };
  if (!needsConvert(mime, name)) throw new Error("Use an mp3, m4a, ogg, or wav file.");
  if (typeof AudioContext === "undefined" || typeof OfflineAudioContext === "undefined") {
    throw new Error("This browser cannot convert that recording. Upload an m4a or wav file.");
  }
  const audio = new AudioContext();
  let decoded;
  try {
    decoded = await audio.decodeAudioData(await file.arrayBuffer());
  } catch (_error) {
    await audio.close().catch(() => {});
    throw new Error("This recording could not be read. Upload an m4a or wav file.");
  }
  const length = Math.max(1, Math.ceil(decoded.duration * 16000));
  const offline = new OfflineAudioContext(1, length, 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  await audio.close().catch(() => {});
  const wav = encodeWav(rendered.getChannelData(0), 16000);
  return { blob: new Blob([wav], { type: "audio/wav" }), mime: "audio/wav", kind: "audio", converted: true };
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

function readyAudio(mime, name) {
  if (READY.has(mime)) return true;
  return (!mime || mime === "application/octet-stream") && ["m4a", "aac", "wav"].includes(extension(name));
}

function needsConvert(mime, name) {
  return CONVERT.has(mime) || ["mp3", "ogg", "webm", "opus"].includes(extension(name));
}

function deliveryMime(mime, name) {
  if (mime === "audio/m4a" || mime === "audio/x-m4a" || extension(name) === "m4a") return "audio/mp4";
  if (mime === "audio/wave" || mime === "audio/x-wav" || extension(name) === "wav") return "audio/wav";
  if (mime === "audio/aac" || extension(name) === "aac") return "audio/aac";
  return mime || "application/octet-stream";
}

function extension(name) {
  const parts = String(name || "").toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

function writeString(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}
