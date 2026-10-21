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

```bash
curl -sS -X POST "https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/acquisition-bot" \
  -H "Authorization: Bearer rfw_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"ingest","targets":[{"handle":"northstar","source":"competitor_followers","followers":12000,"bio":"DM me to apply","cta_detected":true}]}'
```

## queue

```json
{ "action": "queue", "limit": 30 }
```

Returns today's work for this business. `limit` is 1–50, default 30. An empty queue is a normal response when the system is off, Instagram is safety-paused, or quiet hours are in effect (`blocked_reason` is `system_off`, `instagram_<reason>`, or `quiet_hours`).

The queue can contain three kinds of work:

- `find_targets` — how many new accounts to find today. Present when ICP Target Acquisition is on, the queue is not blocked, and `cap_remaining` is above zero. `count` is the remaining cap. Rules: a CTA in the bio, and 5,000–200,000 followers. Ingest at most that many; the server holds the rest with reason `daily_cap`.
- `warmup` — a warm-up step due on or before today (`day`, `action`, `step_id`).
- `outreach` — a first DM to send, with `opener` and a signed `voice_note` when a recording is on file.

`daily_cap` on the business is 20–30 (default 30). `cap_remaining` is that cap minus distinct targets already reported today (`warmup.reported` or `outreach.reported`).

```bash
curl -sS -X POST "https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/acquisition-bot" \
  -H "Authorization: Bearer rfw_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"queue","limit":30}'
```

## report

```json
{ "action": "report", "results": [{ "event": "voice_send", "voice_note_id": "uuid", "target_id": "uuid", "slot": "outreach_opener", "result": "sent" }] }
```

At most 100 results. `voice_send` records that a file was sent. `voice_outcome` records reply or booking later. Warm-up rows use `step_id` and `result`. Outreach rows use `outreach_id` and `result`. `voice_pick` is not a report.

```bash
curl -sS -X POST "https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/acquisition-bot" \
  -H "Authorization: Bearer rfw_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"report","results":[{"event":"warmup","step_id":"STEP_UUID","target_id":"TARGET_UUID","result":"done"}]}'
```

## pause

```json
{ "action": "pause", "reason": "challenge", "notes": "Checkpoint on the logged-in profile." }
```

`reason` is `warning`, `challenge`, or `action_block`. Any of those sets `acq_settings.ig_paused`, which empties the queue until the owner resumes the worker in the panel. The conversation engine is not paused.

```bash
curl -sS -X POST "https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/acquisition-bot" \
  -H "Authorization: Bearer rfw_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"pause","reason":"challenge","notes":"Checkpoint on the logged-in profile."}'
```

## Mint a worker key once

The panel button calls `acq_worker_issue` and shows the key once. For a one-off mint from the Supabase SQL editor or MCP, use `acq_mint_worker_key`. It returns the raw `rfw_` key in that result only. The row stores `key_prefix` (the first 12 characters) and the SHA-256 hash. It is granted to `service_role` and can also be run as `postgres` or `supabase_admin`. Signed-in users cannot call it.

Find the business, then mint. Do not commit the returned key.

```sql
select id, name from public.acq_workspaces order by created_at;

select public.acq_mint_worker_key('<workspace-uuid>');
```

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
