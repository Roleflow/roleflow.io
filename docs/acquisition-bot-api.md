# Outreach worker API

Agents that find accounts, warm them up, and send the first cold outreach call this function. Comment-to-DM, qualification, recovery, and booking do not. Those use `roleflow-acquisition` and the official Instagram API.

```
POST https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/acquisition-bot
Authorization: Bearer rfw_...
Content-Type: application/json
```

`verify_jwt` is false. The publishable key is not enough. A worker key works only for its own business. Sending another business id returns 403, `That worker key is for a different business.` The service role key is for Roleflow ops. Instagram passwords are rejected by omission: the body has no password field and none is stored.

The panel issues a key with `acq_worker_issue`. Rotating disables the previous key. Turning the worker off keeps the hash but sets status `paused` and `pause_reason` `owner`. A safety pause from the worker (`warning`, `challenge`, `action_block`) sets `acq_settings.ig_paused`. That pause stops this queue. It does not disconnect Instagram and it does not stop the conversation engine.

`voice_pick` returns a one-hour signed URL and does not count as a send. Report `voice_send` after the file is actually sent.

## ingest

```json
{ "action": "ingest", "targets": [{ "handle": "northstar", "source": "competitor_followers", "followers": 12000, "bio": "DM me to apply", "cta_detected": true }] }
```

At most 50 targets. Scoring is server-side. A pass needs a CTA and 5,000–200,000 followers. Extra targets over the daily cap are held with reason `daily_cap` and are not stored. The same handle in a workspace is unique. Re-ingest does not reset a target that is already moving.

## queue

```json
{ "action": "queue", "limit": 30 }
```

Returns the next warm-up or outreach work for this business, including a signed voice URL when the opener should be a recording. `limit` is 1–50, default 30. An empty queue is a normal response.

## report

```json
{ "action": "report", "results": [{ "event": "voice_send", "voice_note_id": "uuid", "target_id": "uuid", "slot": "outreach_opener", "result": "sent" }] }
```

At most 100 results. `voice_send` records that a file was sent. `voice_outcome` records reply or booking later. Warm-up rows use `step_id` and `result`. Outreach rows use `outreach_id` and `result`. `voice_pick` is not a report.

## pause

```json
{ "action": "pause", "reason": "challenge", "notes": "Checkpoint on the logged-in profile." }
```

`reason` is `warning`, `challenge`, or `action_block`.

## voice_pick

```json
{ "action": "voice_pick", "slot": "outreach_opener", "niche": "coaching", "variant": null }
```

Slots: `outreach_opener`, `gap_building`, `recovery_followup_1`, `recovery_followup_2`, `recovery_value`, `booking_confirmation`, `pre_call_value`, `pre_call`, `reminder`.

## summarize

```json
{ "action": "summarize" }
```

Runs the Chief of Staff daily summary for this business.
