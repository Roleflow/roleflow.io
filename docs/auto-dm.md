# Outreacher brain

One container image runs one client's Instagram session. The brain is the long-lived process inside that image. It polls the logged-in Instagram web UI for new followers and post likes, checks the profile against that business's ICP, waits, and sends one personalised DM. Scoring and the message are produced by the `acquisition-bot` edge function. The machine does not hold a model key, does not call the data API, and does not store an Instagram password.

Sending is off unless every switch below is on. A dry run does the same work and then stops before the send click.

The older shared-computer worker is still `node workers/roleflow-dm/run.mjs <workspace-id>`. That process is not the per-client image. The image entrypoint is `node workers/roleflow-dm/brain.mjs`.

## What the process does

1. Read `/etc/roleflow/bootstrap` (`machine_id`, `bootstrap_token`, optional `server_id`, `supabase_url`, `relay_url`). If `server_id` is missing, read it from the cloud metadata instance-id URL. `POST` `action: "bootstrap"` to `acquisition-bot`. The function checks the token hash, a 15-minute expiry, the recorded server id, and the source IP. If the server id or IP is not recorded yet it returns `425` and the brain retries. On success it writes the access JWT and the refresh token to `/data/secrets` at mode `0600`, writes the URLs without the token to `/data/state/endpoints.json`, and shreds the bootstrap file (`shred -u`, or overwrite and unlink). A second presentation of the same token revokes the machine. If the secret files already exist, bootstrap is skipped and a leftover bootstrap file is still shredded.
2. Send `heartbeat` immediately, then about every 60 seconds (50–70 with jitter). The first boot must heartbeat within 10 minutes. A later boot must heartbeat within 5 minutes. Once the machine is ready, three missed beats (about 3 minutes) is the failure signal the provisioner should enforce.
3. Pull `config` on boot, every 5 minutes, and again immediately before a send.
4. Poll followers and likers every 5–15 minutes. The first successful poll is a baseline and is not messaged. Someone new is opened (a `view` claim), read, and ICP-checked. A pass waits a random delay, then a `dm` claim, then the draft.
5. The default wait is 5–30 minutes. `acq_outreacher_config.delay_min_s` and `delay_max_s` override that when the row exists.
6. Dry run types the full draft and does not click send. Live mode clicks only after a second claim check, and only if the composer still equals the full draft. The sent bubble must equal that same text. Anything shorter is not clicked. If a click already happened and the bubble does not match, the send is logged as failed and not retried.
7. A login URL, a challenge URL, or a block dialog stops sending, heartbeats the session state, and the edge function pauses the business.

Chromium is a different user from the brain. It is started by supervisord with `--user-data-dir=/data/profile` and a proxy URL from `/run/roleflow/proxy.url`. The brain attaches over `127.0.0.1:9222`. noVNC listens on `127.0.0.1:6080` and x11vnc on `127.0.0.1:5900`. The outbound relay is a separate piece.

## Switches required to send

All of these have to be true at the moment of the click:

| Switch | Required value |
| --- | --- |
| `ROLEFLOW_DM_LIVE` | `1` in the machine environment. The image, the entrypoint, and cloud-init do not set this. |
| `acq_dm_controls.enabled` | `true` |
| `acq_dm_controls.killed` | `false` |
| `acq_dm_controls.paused_reason` | empty |
| `acq_outreacher_config.dry_run` | `false`. A missing row stays dry-run. |
| `acq_settings.system_enabled` | `true` |
| `acq_settings.ig_paused` | `false` |
| `business_workforce` role `personalised_outreach` | `status = active` and not disabled |
| `client_machines.status` | `running` (or `awaiting_login` for the local gate; the claim function is the authority) |
| `outreacher_can_send` | returns a `claim_id` |
| `outreacher_claim_check` | still ok, and the claim is under 2 minutes old |
| Quiet hours | outside `acq_settings.quiet_start` / `quiet_end` in `acq_settings.timezone` |
| Caps | under the smaller of the two daily caps, and under `hourly_cap` when that column is set |

`ROLEFLOW_DM_KILL=1` stops the process's sends even if the panel is on.

A dry run on a pilot machine is the default. Leave `ROLEFLOW_DM_LIVE` unset. Turn the panel row on if you want the brain to draft and log, and leave `dry_run` true. The log line `reason: "dry_run"` is the text that would have been sent.

## Environment

| Variable | Purpose |
| --- | --- |
| `ROLEFLOW_SUPABASE_URL` | Edge function origin, for example `https://<project>.supabase.co`. Taken from the bootstrap file when unset. |
| `ROLEFLOW_IMAGE_VERSION` | Baked into the image at build time and reported on heartbeat. |
| `ROLEFLOW_DM_LIVE` | Must be `1` to click send. Unset means dry-run. |
| `ROLEFLOW_DM_KILL` | `1` forces sending off. |
| `ROLEFLOW_DM_BROWSER` | `0` skips attaching to Chromium. The image sets it to `1`. |
| `ROLEFLOW_CDP` | Defaults to `http://127.0.0.1:9222`. |
| `ROLEFLOW_APPLY_NFT` | `1` loads the shipped nftables rules. Cloud-init may set this. It must not set `ROLEFLOW_DM_LIVE`. |
| `OUTREACHER_JWT_PRIVATE_KEY` | Function secret only. PKCS8 PEM for ES256. Not on the machine. |
| `OUTREACHER_JWT_PUBLIC_KEY` | Function secret only. SPKI PEM. |

Paths that persist are under `/data` (`profile`, `secrets`, `state`, `logs`). Proxy URL, backup key, and volume key are written only under `/run/roleflow` (tmpfs) and are not logged. The backup key is the `backup_key` field from `config`, which the function reads from `private.outreach_machine_secrets` when that table exists. The brain does not invent a key. Nightly backups are skipped until the key is present. The ciphertext is AES-256-GCM with a `RFBK1` header, uploaded through a signed URL, and the function keeps the newest 7 objects for that machine. Retention after non-payment is the provisioner's job.

## Edge function contract

The machine calls only:

```
POST {SUPABASE_URL}/functions/v1/acquisition-bot
Authorization: Bearer <access JWT>
```

`bootstrap` and `refresh` do not send the access JWT. No call uses `/rest/v1`. The JWT is ES256, one hour, claims `iss=roleflow-outreacher`, `aud=authenticated`, `role=outreacher`, `sub` and `machine_id`, `business_id`, `jti`, `exp`. Every other action verifies the signature and re-reads `client_machines`. A revoked, deleted, or mismatched row is rejected even if the JWT has not expired. A body `business_id` that does not match the claim returns 403, `That worker key is for a different business.`

| Action | Body | Result |
| --- | --- | --- |
| `bootstrap` | `machine_id`, `bootstrap_token`, `server_id` | Access JWT, refresh token, `business_id`. `425` with `identity_pending` if the server id or IP is not stored yet. |
| `refresh` | `refresh_token` | A new pair. The previous token is remembered once so a replay revokes the machine, writes `refresh_reuse`, and opens an HQ task when `hq_agents` has a row. |
| `heartbeat` | `session_state`, `sending_mode`, `sends_today`, `sends_per_hour`, `error_rate`, `last_send_at`, `last_error`, `uptime_s`, `image_version`, `health`, `last_egress_ip` | Updates `client_machines`. On a change to `expired`, `checkpoint`, or `action_block`, writes `client_machine_events` (`session_expired`, `checkpoint`, `action_block`) and pauses via `acq_bot_pause`. |
| `config` | none | ICP, prompt, switches, DNC, sent handles, booking links (name and URL only), proxy URL, backup key. See below. |
| `qualify` | `profile`, `trigger` | `{ score }` from the business model key. This is not the panel prompt. |
| `draft` | `profile`, `trigger` | `{ text }` using `acq_agent_prompt_versions.body` as the system prompt with no edits. A cut-off model reply returns `truncated` and is not a message. |
| `claim` | `action_kind` (`dm`, `like`, `follow`, `view`), `target` | Calls `outreacher_can_send(business_id, action_kind, target)` with `business_id` from the JWT. Returns `claim_id` and `expires_at` (2 minutes). |
| `claim_check` | `claim_id` | Calls `outreacher_claim_check`. |
| `report_send` | `claim_id`, `result` (`sent`, `dry_run`, `failed`, `skipped`), `handle`, `body`, `kind` | Calls `outreacher_report_send`. `sent` longer than 1000 characters is refused and is not written to `acq_dm_sends`. |
| `log_event` | `kind`, `handle`, `reason`, optional `body` | Skip/failure visibility in `acq_activity.payload` and `client_machine_events`. The message text is not sliced. |
| `backup_slot` / `backup_commit` | path from the slot | Signed upload URL under `outreacher-profiles/<business_id>/<machine_id>/`, then prune to 7. |

`session_state` is `ok`, `expired`, `checkpoint`, `action_block`, or `unknown`. `sending_mode` is `off`, `dry_run`, or `live`.

### Config shape

`acq_settings` (keyed by `agent_id`) is the ICP source: `niche`, `follower_min`, `follower_max`, `cta_keywords`, `icp_notes`, `offer_summary`, `daily_cap`, `keyword_only`, `skip_followed`, plus `timezone`, `quiet_start`, `quiet_end`, `ig_paused`, `system_enabled`. Null follower bounds fall back to 5000 and 200000 only in the brain's check. Stored numbers are used as stored, including a ceiling of 50000. Empty `cta_keywords` passes the keyword gate. `keyword_only` does not add a second keyword list.

Also returned: `business_workforce.parameters.min_score` for role `personalised_outreach` (70 when null), `acq_business_briefs.fields` (`who`, `sell`, `offer`, `service`), `acq_dnc`, `acq_tag_rules`, `acq_offer_links` as `{ name, url }` only, `acq_dm_controls`, recent `acq_dm_sends` handles, and `acq_outreacher_config` when that table exists (`exclude_keywords`, `countries`, `languages`, `delay_min_s`, `delay_max_s`, `hourly_cap`, `dry_run`). A country or language is enforced only when the profile actually exposes one.

The panel prompt is the newest `acq_agent_prompt_versions.body`. It is passed to the model as the system text unchanged. The user message carries the profile, the brief, the tag rules, and the booking links. Prices are not added to that message. A draft that contains a price or is longer than 1000 characters is not sent.

## ICP check

Before a profile is opened, the handle is dropped if it is on `acq_dnc`, already in `acq_dm_sends`, or is the account's own handle. After the profile is read: follower range, CTA keywords when the list is non-empty, exclude keywords, `skip_followed`, country and language when known. `qualify` must return a score at or above `min_score`. The same gates run again immediately before the DM claim.

## Image

Build both architectures from the repo root:

```
sh workers/roleflow-dm/build-image.sh 2026.11.03
```

That runs `docker buildx build --platform linux/amd64,linux/arm64`. The tag is `roleflow-outreacher:<version>`. Chromium comes from Playwright's linux build for the target architecture, so arm64 (CAX11) and amd64 use the same Dockerfile.

The image users are `agent` (the brain) and `chromium` (the browser). nftables for the chromium uid drop `169.254.169.254`, all UDP, and TCP port 53, then allow only the proxy IP and port. The agent uid may reach metadata, DNS, NTP, and the control HTTPS set. Rules are rendered by `workers/roleflow-dm/brain-nft.mjs` and applied only when `ROLEFLOW_APPLY_NFT=1`. Chromium enterprise policy disables the password manager and autofill and sets `WebRtcIPHandlingPolicy` to `disable_non_proxied_udp`. The process is also started with `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`.

## What the other pieces must add

This repo does not create these. Names match the provisioning contract (`client_machines`, `client_machine_events`), not a second copy of the machine table.

`client_machines`: `id`, `business_id`, `provider_server_id`, `ipv4`, `status` (`provisioning` at bootstrap), `bootstrap_token_hash`, `bootstrap_expires_at` (at most 15 minutes ahead), `bootstrap_used_at`, `refresh_token_hash`, `refresh_prev_hash`, `refresh_family_id`, `revoked_at`, `session_state`, `last_heartbeat_at`, `last_error`, `image_version`, `health`, `sending_mode`, `sends_today`, `sends_per_hour`, `error_rate`, `last_send_at`, `uptime_s`, `last_egress_ip`, `agent_version`.

`client_machine_events`: `business_id`, `machine_id`, `kind`, `severity`, `detail jsonb`, `created_at`.

`acq_outreacher_config`: `business_id` primary key, `exclude_keywords`, `countries`, `languages`, `delay_min_s`, `delay_max_s`, `hourly_cap`, `dry_run` default true, optional `triggers`.

`private.outreach_machine_secrets`: `machine_id`, `proxy_url`, `backup_key`, `volume_key`. Service role only.

Storage bucket `outreacher-profiles`, private, written only by this function.

SQL, called with the service role and the business id taken from the JWT:

- `outreacher_can_send(business_id, action_kind, target)` returns `{ ok, claim_id, expires_at }` or `{ ok: false, reason }`. It must lock the control row and refuse when the global kill, the panel kill, `enabled` is false, the workforce role is off, the system is off, Instagram is paused, the machine is not running, the subscription is inactive, quiet hours apply, a cap is spent, the handle is on `acq_dnc`, or the handle was already contacted. The claim expires in 2 minutes. `dry_run` reports must not increment the cap.
- `outreacher_claim_check(claim_id)` re-checks that claim for the same machine.
- `outreacher_report_send(claim_id, result, detail)` stores the result without shortening `detail.body`.

Function secrets: `OUTREACHER_JWT_PRIVATE_KEY` and `OUTREACHER_JWT_PUBLIC_KEY`. The pilot verifies those tokens inside the edge function. Importing the signing key into the project auth settings is a later change and is not done here.

`docs/outreacher-machines.md` from the provisioning change is the table contract. If a column name differs, heartbeat and bootstrap will return 503 until they match the list above.

## Tests

Unit tests cover profile HTML, ICP bounds, delays, caps, the kill and dry-run gates, the truncation guard, the health probe, bootstrap, refresh replay, the cross-business 403, claim failure, and the image rules. They do not open Instagram.

```
node --test test/outreacher-brain.test.mjs test/outreacher-machine.test.mjs
```

## Shared computer already running

The per-client image does not use this directory. The login service and `run.mjs` that are already on the shared computer do.

Sessions live in `/opt/roleflow-dm/sessions`. Each workspace has `<workspace-id>.bin` and `<workspace-id>.key`, mode `chmod 600`. The worker also writes `<workspace-id>.feed.json` and `<workspace-id>.lock` there. `ROLEFLOW_DM_SESSION_DIR` points at that directory.

Value Add Marketing's previous files were under `/workspace/roleflow-dm/vam/session/`. Roleflow's were under `/workspace/roleflow-dm/roleflow/.dm/sessions/`. Copy those into `/opt/roleflow-dm/sessions` under the workspace id, then `chmod 600` the `.bin` and the `.key`.

`supabase/migrations/20261028160000_roleflow_auto_dm.sql` is already applied in production (Supabase version `20261028150149`). Do not run that file again.

The login service runs under Node 24 in `/opt/roleflow-dm`, in the tmux session `roleflow-dm`, and binds only `127.0.0.1:8796`. `8790` is already taken. It is not started by the bots. Restart it from the checkout with `node workers/roleflow-dm/login-service.mjs`. If the browser must be headed, run it under `xvfb-run -a` and set `ROLEFLOW_DM_LOGIN_HEADED=1`. Do not open port 8796 on the public internet.

## Open points

- The claim, report, and machine tables are not in this repo. Until they exist, claim and report fail closed and the brain does not click send.
- Listing the follower and like dialogs uses the logged-in web UI. The selectors live in `brain-browser.mjs` and are covered with fixtures. A pilot machine is the first check against the live UI.
- The relay socket that should push `halt` within seconds is owned by another piece. This process also stops when heartbeat or config returns `halt`, and when a claim is refused.
- Heartbeat counts are what the brain reports. The claim ledger is the source of truth for caps.
- `acq_dm_controls.enabled` may already be true for existing businesses. That does not send. `ROLEFLOW_DM_LIVE` and `dry_run = false` are still required, and this change does not write those rows.
