// Voice notes are AAC in an M4A container (audio/mp4), mono, about 64 kbps.
// MediaRecorder audio/mp4 is preferred. Otherwise WebCodecs AAC-LC is muxed here.
// The last fallback is 16 kHz mono WAV, which stays under the 4.5 MB send limit at 60 seconds.

import { encodeWav } from "./wav-encode.js";

export const VOICE_MAX_MS = 60_000;
export const VOICE_MAX_BYTES = 4_500_000;
export const AAC_BITRATE = 64_000;
export const WAV_FALLBACK_RATE = 16_000;

const RECORDER_TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

export function preferredRecorderMime(isTypeSupported) {
  const supports = isTypeSupported || (() => false);
  return RECORDER_TYPES.find((type) => supports(type)) || "";
}

export function recorderStartOptions(isTypeSupported) {
  const mimeType = preferredRecorderMime(isTypeSupported);
  const options = { audioBitsPerSecond: AAC_BITRATE };
  if (mimeType) options.mimeType = mimeType;
  return options;
}

export function voiceError(code, es) {
  if (code === "too_big") return es ? "Este archivo es demasiado grande. Máximo 4,5 MB." : "This file is too large to send. Keep it under 4.5 MB.";
  if (code === "too_long") return es ? "La nota puede durar 60 segundos como máximo." : "Keep the note under 60 seconds.";
  return es ? "No se pudo preparar el audio." : "The recording could not be prepared.";
}

export function storageContentType(file) {
  const mime = canonicalMime(file);
  if (mime === "audio/mp4" || mime === "audio/aac" || mime === "audio/wav") return mime;
  return "application/octet-stream";
}

export function audioSpecificConfig(sampleRate, channels) {
  const index = RATES.indexOf(sampleRate);
  const channel = Math.max(1, Math.min(2, channels || 1));
  if (index < 0) return new Uint8Array([0x12, 0x08]);
  const bits = (2 << 11) | (index << 7) | (channel << 3);
  return new Uint8Array([(bits >> 8) & 0xff, bits & 0xff]);
}

export function downsampleMono(samples, fromRate, toRate) {
  const input = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  const source = Math.max(1, Math.round(fromRate) || 1);
  const target = Math.max(1, Math.round(toRate) || 1);
  if (source === target) return input;
  const length = Math.max(1, Math.round(input.length * target / source));
  const out = new Float32Array(length);
  const ratio = source / target;
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.max(start + 1, Math.min(input.length, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let cursor = start; cursor < end; cursor += 1) sum += input[cursor] || 0;
    out[index] = sum / (end - start);
  }
  return out;
}

export function muxAacMp4({ frames, sampleRate, channels }) {
  const packets = (frames || []).filter((frame) => frame && frame.length);
  if (!packets.length) throw coded("unreadable");
  const rate = RATES.includes(sampleRate) ? sampleRate : 44100;
  const count = packets.length;
  const payload = concat(packets);
  const ftyp = box("ftyp", concat([ascii("M4A "), u32(0), ascii("M4A "), ascii("mp42"), ascii("isom")]));
  const mdat = box("mdat", payload);
  const offset = ftyp.length + 8;
  const duration = count * 1024;
  const moov = movieBox({ count, rate, channels: channels || 1, duration, offset, packets });
  return concat([ftyp, mdat, moov]);
}

export async function samplesToVoiceFile(samples, sampleRate, durationMs, encode) {
  if (durationMs > VOICE_MAX_MS) throw coded("too_long");
  const attempt = encode || encodeAacM4a;
  try {
    const bytes = await attempt(samples, sampleRate);
    if (!bytes || !bytes.length) throw new Error("empty");
    if (bytes.length > VOICE_MAX_BYTES) throw coded("too_big");
    return { file: new File([bytes], "voice-note.m4a", { type: "audio/mp4" }), durationMs, mime: "audio/mp4" };
  } catch (error) {
    if (error && (error.code === "too_big" || error.code === "too_long")) throw error;
    const mono = downsampleMono(samples, sampleRate, WAV_FALLBACK_RATE);
    const wav = encodeWav(mono, WAV_FALLBACK_RATE);
    if (wav.size > VOICE_MAX_BYTES) throw coded("too_big");
    return { file: new File([wav], "voice-note.wav", { type: "audio/wav" }), durationMs, mime: "audio/wav" };
  }
}

export async function prepareVoiceNote(file) {
  if (!file) throw coded("unreadable");
  if (file.size > 20 * 1024 * 1024) throw coded("too_big");
  const mime = canonicalMime(file);
  if (mime === "audio/mp4" || mime === "audio/aac") {
    if (file.size > VOICE_MAX_BYTES) throw coded("too_big");
    const durationMs = await measureDuration(file);
    if (durationMs > VOICE_MAX_MS) throw coded("too_long");
    const type = mime === "audio/aac" ? "audio/aac" : "audio/mp4";
    const name = type === "audio/mp4" ? "voice-note.m4a" : "voice-note.aac";
    return { file: new File([await file.arrayBuffer()], name, { type }), durationMs, mime: type };
  }
  const pcm = await decodeMono(file, 44100);
  return samplesToVoiceFile(pcm.samples, pcm.sampleRate, pcm.durationMs);
}

async function encodeAacM4a(samples, sampleRate) {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") throw new Error("no encoder");
  const config = { codec: "mp4a.40.2", sampleRate, numberOfChannels: 1, bitrate: AAC_BITRATE };
  const support = await AudioEncoder.isConfigSupported(config);
  if (!support || support.supported !== true) throw new Error("unsupported");
  const frames = [];
  let failed = null;
  const encoder = new AudioEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      frames.push(data);
    },
    error: (error) => { failed = error; }
  });
  encoder.configure(config);
  const width = 1024;
  for (let offset = 0; offset < samples.length; offset += width) {
    const slice = new Float32Array(width);
    slice.set(samples.subarray(offset, Math.min(samples.length, offset + width)));
    const data = new AudioData({
      format: "f32",
      sampleRate,
      numberOfFrames: width,
      numberOfChannels: 1,
      timestamp: Math.round(offset * 1e6 / sampleRate),
      data: slice
    });
    encoder.encode(data);
    data.close();
  }
  await encoder.flush();
  encoder.close();
  if (failed || !frames.length) throw failed || new Error("empty");
  return muxAacMp4({ frames, sampleRate, channels: 1 });
}

async function measureDuration(file) {
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx) throw coded("unreadable");
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    return Math.round(decoded.duration * 1000);
  } catch (_error) {
    throw coded("unreadable");
  } finally {
    if (ctx.close) await ctx.close().catch(() => {});
  }
}

async function decodeMono(file, sampleRate) {
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx || typeof OfflineAudioContext === "undefined") throw coded("unreadable");
  const ctx = new Ctx();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch (_error) {
    if (ctx.close) await ctx.close().catch(() => {});
    throw coded("unreadable");
  }
  const durationMs = Math.round(decoded.duration * 1000);
  const length = Math.max(1, Math.ceil(decoded.duration * sampleRate));
  const offline = new OfflineAudioContext(1, length, sampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  if (ctx.close) await ctx.close().catch(() => {});
  return { samples: new Float32Array(rendered.getChannelData(0)), sampleRate, durationMs };
}

function movieBox({ count, rate, channels, duration, offset, packets }) {
  const matrix = concat([
    u32(0x00010000), u32(0), u32(0),
    u32(0), u32(0x00010000), u32(0),
    u32(0), u32(0), u32(0x40000000)
  ]);
  const mvhd = fullbox("mvhd", 0, 0, concat([
    u32(0), u32(0), u32(rate), u32(duration),
    u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0),
    matrix, zeros(24), u32(2)
  ]));
  const tkhd = fullbox("tkhd", 0, 3, concat([
    u32(0), u32(0), u32(1), u32(0), u32(duration),
    u32(0), u32(0), u16(0), u16(0), u16(0x0100), u16(0),
    matrix, u32(0), u32(0)
  ]));
  const mdhd = fullbox("mdhd", 0, 0, concat([u32(0), u32(0), u32(rate), u32(duration), u16(0x55c4), u16(0)]));
  const hdlr = fullbox("hdlr", 0, 0, concat([u32(0), ascii("soun"), zeros(12), ascii("SoundHandler\0")]));
  const smhd = fullbox("smhd", 0, 0, concat([u16(0), u16(0)]));
  const url = fullbox("url ", 0, 1, new Uint8Array(0));
  const dref = fullbox("dref", 0, 0, concat([u32(1), url]));
  const dinf = box("dinf", dref);
  const mp4a = audioEntry(rate, channels);
  const stsd = fullbox("stsd", 0, 0, concat([u32(1), mp4a]));
  const stts = fullbox("stts", 0, 0, concat([u32(1), u32(count), u32(1024)]));
  const stsc = fullbox("stsc", 0, 0, concat([u32(1), u32(1), u32(count), u32(1)]));
  const sizes = packets.map((packet) => u32(packet.length));
  const stsz = fullbox("stsz", 0, 0, concat([u32(0), u32(count), ...sizes]));
  const stco = fullbox("stco", 0, 0, concat([u32(1), u32(offset)]));
  const stbl = box("stbl", concat([stsd, stts, stsc, stsz, stco]));
  const minf = box("minf", concat([smhd, dinf, stbl]));
  const mdia = box("mdia", concat([mdhd, hdlr, minf]));
  const trak = box("trak", concat([tkhd, mdia]));
  return box("moov", concat([mvhd, trak]));
}

function audioEntry(sampleRate, channels) {
  const asc = audioSpecificConfig(sampleRate, channels);
  const dsi = descriptor(0x05, asc);
  const decoder = descriptor(0x04, concat([
    u8(0x40), u8(0x15), u8(0), u8(0), u8(0),
    u32(AAC_BITRATE), u32(AAC_BITRATE), dsi
  ]));
  const es = descriptor(0x03, concat([u16(1), u8(0), decoder, descriptor(0x06, u8(2))]));
  const esds = fullbox("esds", 0, 0, es);
  return box("mp4a", concat([
    zeros(6), u16(1), zeros(8),
    u16(channels), u16(16), u16(0), u16(0),
    u32(sampleRate << 16), esds
  ]));
}

function descriptor(tag, payload) {
  const body = payload instanceof Uint8Array ? payload : concat(Array.isArray(payload) ? payload : [payload]);
  return concat([u8(tag), u8(body.length), body]);
}

function canonicalMime(file) {
  const raw = String((file && file.type) || "").split(";")[0].trim().toLowerCase();
  const name = String((file && file.name) || "").toLowerCase();
  if (raw === "audio/mp4" || raw === "audio/m4a" || raw === "audio/x-m4a" || name.endsWith(".m4a")) return "audio/mp4";
  if (raw === "audio/aac" || name.endsWith(".aac")) return "audio/aac";
  if (raw === "audio/wav" || raw === "audio/wave" || raw === "audio/x-wav" || name.endsWith(".wav")) return "audio/wav";
  return raw;
}

function coded(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function box(type, payload) {
  return concat([u32(8 + payload.length), ascii(type), payload]);
}

function fullbox(type, version, flags, payload) {
  return box(type, concat([u32((version << 24) | flags), payload]));
}

function concat(parts) {
  const list = parts.filter(Boolean);
  const size = list.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of list) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function ascii(text) {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

function u8(value) {
  return Uint8Array.of(value & 255);
}

function u16(value) {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value);
  return out;
}

function u32(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function zeros(length) {
  return new Uint8Array(length);
}
