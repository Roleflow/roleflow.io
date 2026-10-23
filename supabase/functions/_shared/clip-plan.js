// Decides whether a saved owner clip may go out on this turn.
// The model picks from the descriptions. This only enforces the hard rules.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function usableClips(clips) {
  return (clips || []).filter((clip) => {
    if (!clip || clip.active === false || !clip.id || !clip.storage_path) return false;
    if (clip.speech_provider === "elevenlabs") return false;
    return true;
  });
}

export function clipInstructions(clips) {
  const rows = usableClips(clips);
  if (!rows.length) {
    return "\n\nOwner clips: none are saved. clip_id must be null. Do not claim a voice note was sent.";
  }
  const lines = rows.map((clip) => {
    const kind = clip.kind || "audio";
    const label = String(clip.label || "").replace(/\s+/g, " ").trim().slice(0, 120);
    const when = String(clip.when_to_use || "").replace(/\s+/g, " ").trim().slice(0, 400);
    return "- " + clip.id + " | " + kind + " | " + label + " | when: " + when;
  });
  return [
    "",
    "Owner clips. Set clip_id to one id only when that clip's when-to-use fits this conversation and the saved prompt allows a clip.",
    "Otherwise clip_id is null. Do not invent an id. Do not claim a voice note was sent. One clip per reply.",
    ...lines
  ].join("\n");
}

export function promptForbidsClips(text) {
  return /never send (?:a |an )?(?:voice note|voice notes|audio clip|audio clips|clip|clips)|do not send (?:a |an )?(?:voice note|voice notes|audio clip|audio clips|clips)|don't send (?:a |an )?(?:voice note|voice notes|audio clip|clips)|do not attach (?:a |an )?(?:voice note|audio|clip)/i.test(String(text || ""));
}

export function chooseClip({ requestedId, clips, alreadySent, promptText }) {
  if (promptForbidsClips(promptText)) return null;
  const id = String(requestedId || "").trim().toLowerCase();
  if (!UUID.test(id)) return null;
  const sent = new Set((alreadySent || []).map((item) => String(item || "").toLowerCase()));
  if (sent.has(id)) return null;
  return usableClips(clips).find((clip) => String(clip.id).toLowerCase() === id) || null;
}

export function clipFromSlot(slot, clips) {
  const name = String(slot || "").trim().toLowerCase();
  if (!name) return "";
  const spaced = name.replace(/_/g, " ");
  const found = usableClips(clips).find((clip) => {
    const label = String(clip.label || "").trim().toLowerCase();
    const when = String(clip.when_to_use || "").toLowerCase();
    return label === name || label === spaced || when.includes(spaced);
  });
  return found ? found.id : "";
}
