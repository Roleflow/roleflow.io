# Voice notes

Recordings are stored as WAV (`audio/wav`, 16-bit PCM) in the private `acq-voice` bucket. Instagram's send-message docs list audio formats as aac, m4a, wav, and mp4, up to 25 MB: https://developers.facebook.com/docs/messenger-platform/instagram/features/send-message/

A browser recording is often WebM. The panel decodes it and writes WAV before upload. An uploaded file that is already wav, m4a, or mp3 is stored as itself when the bucket allows that type. WebM is converted.

## Who gets which note

A note is either a workflow step (the name matches a line in the SOP workflow, such as Intro, Qualify, or Booking link) or one Instagram handle. Person-specific wins. Then the step that matches the lead's stage. Each note is sent at most once to the same person. Notes with neither a step nor a person stay unassigned and are not sent.

## Sending stays off

`acq_dm_controls.enabled` must be true and `killed` must not be true. Otherwise the official reply path does not attach the audio. Text replies are unchanged. The wait for a new outbound DM is still the 5 to 30 minute random delay in the follow-to-DM worker.

## Send path

A matched library note, a prompt voice token, and a slot note all use the same send. The stored file is uploaded, then sent as an inbox audio attachment (`attachmentType: audio`) on that conversation. The request does not set the WhatsApp-only voice-note flag. Text stays on the existing reply path. The web composer on the box is not used for voice, and the reply function does not post a Graph audio attachment.

The inbox audio list is AAC, M4A, WAV, and MP4, up to 25 MB. MP3 and OGG are rejected. A browser recording is stored as WAV. An uploaded m4a or aac file is sent as that container (`audio/mp4` for m4a). The bytes are uploaded first so the inbox fetches a public URL. A signed storage URL is not the URL we send, because the inbox requires a public URL with no login and no redirect. The direct upload used here rejects a file over 4.5 MB.

Outside 24 hours the reply, including the voice note, is not sent. The human-agent tag is for a person typing a reply, not for this automatic note, so it is not set.

Secret name already in the stack: `ZERNIO_API_KEY`. No new secret.

## Box worker

`workers/roleflow-dm/send.mjs` still sends text only, after `planDm` allows it. It does not attach a voice file. No webhook is registered.

UNVERIFIED: whether an Instagram audio attachment in WAV is drawn as the in-app voice-message waveform, or as a generic audio file. The inbox marks a WhatsApp voice note separately, and that flag is ignored for Instagram.
