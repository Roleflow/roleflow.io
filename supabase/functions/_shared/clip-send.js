// Turns a stored clip into the inbox attachment call.
// The upload endpoint returns a public https URL the inbox can fetch.
// Its files expire; the inbox playback URL stays on our storage path.

import { assertInstagramContainer } from "./clip-audio.js";

export const UPLOAD_URL = "https://zernio.com/api/v1/media/upload-direct";
const DIRECT_LIMIT = 4_500_000;

export function attachmentTypeFor(clip) {
  const kind = clip && clip.kind;
  if (kind === "image" || kind === "video" || kind === "audio") return kind;
  return "audio";
}

export function attachmentFields(payload) {
  const url = String((payload && payload.attachmentUrl) || "");
  if (!url.startsWith("https://")) return {};
  return { attachmentUrl: url, attachmentType: attachmentTypeFor({ kind: payload.attachmentType }) };
}

export function sentMessage(row) {
  const payload = row && row.payload ? row.payload : {};
  const clip = payload.clip || null;
  const text = String(payload.text || "").trim().slice(0, 4000);
  const metadata = clip && clip.path ? {
    clip_id: clip.id || "",
    media_path: clip.path,
    media_mime: clip.mime || "",
    media_kind: clip.kind || "audio"
  } : {};
  return {
    body: text || (clip ? String(clip.label || "Voice note").slice(0, 200) : ""),
    metadata,
    kind: clip ? (clip.kind || "audio") : "text"
  };
}

export async function uploadDirect({ apiKey, fetchImpl, file }) {
  const bytes = file && file.bytes;
  if (!apiKey || !bytes || !bytes.length) return { url: "", error: "The voice note was not sent." };
  if (bytes.length > DIRECT_LIMIT) return { url: "", error: "This recording is too large to send." };
  if ((file.kind || "audio") === "audio") {
    const ready = assertInstagramContainer(bytes, file.mime);
    if (!ready.ok) return { url: "", error: ready.error };
  }
  const fetchFn = fetchImpl || fetch;
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: file.mime || "application/octet-stream" }), file.filename || "clip.wav");
  if (file.mime) form.append("contentType", file.mime);
  let response;
  try {
    response = await fetchFn(UPLOAD_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey },
      body: form
    });
  } catch (_error) {
    return { url: "", error: "The voice note was not sent." };
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { url: "", error: "The voice note was not sent." };
  const url = String(payload.url || (payload.data && payload.data.url) || "");
  if (!url.startsWith("https://")) return { url: "", error: "The voice note was not sent." };
  return { url, error: "" };
}

export async function withAttachment(row, apiKey, fetchImpl, download) {
  const payload = row && row.payload ? row.payload : {};
  if (!payload.clip || payload.attachmentUrl) return row;
  if (!download) {
    const error = new Error("The voice note was not sent.");
    error.code = "clip";
    throw error;
  }
  const file = await download(payload.clip);
  const uploaded = await uploadDirect({
    apiKey,
    fetchImpl,
    file: {
      bytes: file.bytes,
      mime: file.mime || payload.clip.mime,
      filename: file.filename || payload.clip.filename || "clip.wav",
      kind: payload.clip.kind || "audio"
    }
  });
  if (!uploaded.url) {
    const error = new Error(uploaded.error || "The voice note was not sent.");
    error.code = "clip";
    throw error;
  }
  return {
    ...row,
    payload: {
      ...payload,
      attachmentUrl: uploaded.url,
      attachmentType: attachmentTypeFor(payload.clip)
    }
  };
}
