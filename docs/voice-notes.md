# Voice notes

A new recording is AAC in an M4A container, stored as `audio/mp4`, mono, about 64 kbps. The recorder prefers `audio/mp4` from MediaRecorder. Otherwise it encodes AAC-LC (`mp4a.40.2`) and muxes an M4A. The last fallback is 16 kHz mono WAV. The recorder stops at 60 seconds. A file over 4.5 MB or longer than 60 seconds is refused with an error. Instagram's send-message docs list audio formats as aac, m4a, wav, and mp4, up to 25 MB: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api

## Who gets which note

A note is either a workflow step (the name matches a line in the SOP workflow, such as Intro, Qualify, or Booking link) or one Instagram handle. Person-specific wins. Then the step that matches the lead's stage. Each note is sent at most once to the same person. Notes with neither a step nor a person stay unassigned and are not sent.

## Sending stays off

`acq_dm_controls.enabled` must be true and `killed` must not be true. Otherwise the official reply path does not attach the audio. Text replies are unchanged. The wait for a new outbound DM is still the 5 to 30 minute random delay in the follow-to-DM worker.

## Send path

A matched library note, a prompt voice token, and a slot note all use the same send. The stored file is uploaded, then sent as an inbox audio attachment (`attachmentType: audio`) on that conversation. The request does not set the WhatsApp-only voice-note flag. Text stays on the existing reply path. The web composer on the box is not used for voice, and the reply function does not post a Graph audio attachment.

The inbox audio list is AAC, M4A, WAV, and MP4, up to 25 MB. MP3 and OGG are rejected. A browser recording is stored as M4A and uploaded with Content-Type `audio/mp4`. An uploaded m4a file uses that same type. The bytes are uploaded first so the inbox fetches a public URL. A signed storage URL is not the URL we send, because the inbox requires a public URL with no login and no redirect. The direct upload used here rejects a file over 4.5 MB. At about 64 kbps, 60 seconds of M4A is well under that cap. A 16 kHz mono WAV fallback for the same length is about 1.9 MB.

Outside 24 hours the reply, including the voice note, is not sent. The human-agent tag is for a person typing a reply, not for this automatic note, so it is not set.

The inbox connection is already configured. No new secret.

## Box worker

`workers/roleflow-dm/send.mjs` still sends text only, after `planDm` allows it. It does not attach a voice file. No webhook is registered.

UNVERIFIED: whether an Instagram audio attachment is drawn as the in-app voice-message waveform, or as a generic audio file. M4A (`audio/mp4`) is the container we send because it is the format most likely to render as a voice message. The inbox marks a WhatsApp voice note separately, and that flag is ignored for Instagram.
