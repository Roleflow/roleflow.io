# Voice notes

Recordings are stored as WAV (`audio/wav`, 16-bit PCM) in the private `acq-voice` bucket. Instagram's send-message docs list audio formats as aac, m4a, wav, and mp4, up to 25 MB: https://developers.facebook.com/docs/messenger-platform/instagram/features/send-message/

A browser recording is often WebM. The panel decodes it and writes WAV before upload. An uploaded file that is already wav, m4a, or mp3 is stored as itself when the bucket allows that type. WebM is converted.

## Who gets which note

A note is either a workflow step (the name matches a line in the SOP workflow, such as Intro, Qualify, or Booking link) or one Instagram handle. Person-specific wins. Then the step that matches the lead's stage. Each note is sent at most once to the same person. Notes with neither a step nor a person stay unassigned and are not sent.

## Sending stays off

`acq_dm_controls.enabled` must be true and `killed` must not be true. Otherwise the official reply path does not attach the audio. Text replies are unchanged. The wait for a new outbound DM is still the 5 to 30 minute random delay in the follow-to-DM worker.

## Official path

`roleflow-acquisition` already builds an audio attachment (`type: audio`, URL of the file) in `audioBody`. When a note matches and DMs are enabled, that attachment is the voice message. Deploy `roleflow-acquisition` for this to run.

## Box worker

`workers/roleflow-dm/send.mjs` exports `attachVoiceFile`. After a text send that `planDm` has allowed, it looks for `input[type=file]` in the Instagram web composer and sets the WAV path. UNVERIFIED: the current Instagram web composer does not document that control, and a voice note recorded in the app may not be the same as a file attachment. If the control is missing, the text send still stands and the voice is reported as `no_file_input`. No webhook is registered.
