// 16-bit PCM WAV. Voice notes use this only when AAC in an M4A container is unavailable.
// The fallback recording is 16 kHz mono so a 60 second note stays under 4.5 MB.

export const VOICE_MIME = "audio/wav";

export function encodeWav(samples, sampleRate) {
  const rate = Math.max(8000, Number(sampleRate) || 44100);
  const data = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  const bytes = data.length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const write = (offset, text) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, bytes, true);
  for (let i = 0; i < data.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, data[i] || 0));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: VOICE_MIME });
}

export async function transcodeToWav(file, audioContext) {
  const Context = audioContext || (typeof AudioContext !== "undefined" ? AudioContext : null);
  if (!Context) throw new Error("This browser cannot convert the recording.");
  const ctx = new Context();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    const wav = encodeWav(decoded.getChannelData(0), decoded.sampleRate);
    const named = new File([wav], "voice-note.wav", { type: VOICE_MIME });
    return { file: named, durationMs: Math.round(decoded.duration * 1000), mime: VOICE_MIME };
  } finally {
    if (ctx.close) await ctx.close().catch(() => {});
  }
}
