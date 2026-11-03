# Outreacher machines

One isolated computer per paying business. The client only sees Roleflow. This document is the contract between provisioning (this change), machine isolation, and the image that runs the browser.

The migration is `supabase/migrations/20261103190000_client_machines.sql`. The price term and the monthly fee ledger are `supabase/migrations/20261103200000_outreacher_pricing.sql`. Neither is applied. Do not deploy `outreach-billing`, `outreach-provisioner`, `outreach-checkout`, `outreach-live`, or `outreach-usage` until Diego reviews them.

On 3 Nov 2026 the hosted project already had `client_dashboard_agents`, `business_model_keys`, and `prompt_versions_and_comment_voice`. This file is ordered after `20261030090000_followups_ladder.sql`.

## Tables

`public.client_machines` is the only machine table. There is no `outreach_machines`.

One row per business while `status <> 'deleted'`. A second provider server id, or a second assigned proxy, cannot be attached to another live row.

Clients with `acq_can_read` may select status, session, sending mode, heartbeat, Instagram username, subscription, the grace dates, and the minimum-term dates. They cannot select provider ids, addresses, token hashes, or proxy hosts. Writes are service role only. There is no policy that lets `anon` write.

`public.client_machine_events` records state changes. Session changes are also written by a trigger:

| `session_state` | event `kind` |
| --- | --- |
| `logged_out` | `session_expired` |
| `challenge` | `challenge` |
| `action_block` | `action_block` |

`needs_login` is not an error. The panel says the client still needs to sign in.

Other columns the image updates on the machine row, with the service role, after its own heartbeat action: `last_heartbeat_at`, `session_state`, `sends_today`, `last_send_at`, `uptime_s`. `sending_mode` stays `off` until someone sets `dry_run` or `live` from an edge function. Cloud-init does not set it.

`worker_id` references `acq_workers` when the image's bootstrap exchange mints a worker key with `acq_mint_worker_key`. That key is optional for the pilot. Machine calls use the JWT below, not the worker key.

### Status

| Status | Meaning |
| --- | --- |
| `pending` | Paid, waiting on a token, a proxy, capacity, or the next attempt |
| `provisioning` | Volume, firewall, or server is being created |
| `health_check` | Server is running and the first heartbeat has not arrived |
| `ready` | A heartbeat with the machine up has arrived. Sign-in state is `session_state` |
| `paused` | Reserved for a security pause of the machine itself. The per-client pause is `acq_outreacher_config.paused` and `acq_dm_controls.enabled` |
| `suspended` | The server is deleted. The volume and profile backups are kept |
| `deleting` | Retention has ended. Volume and backups are being removed |
| `deleted` | Server, volume, and backups are gone |
| `failed` | The provider or the first boot failed past the retry cap |
| `revoked` | Bootstrap replay, refresh reuse, or an operator revoke. The next machine call is refused |
| `stopping`, `stopped` | Accepted by the check so older notes still fit. The worker does not leave a server in `stopped`, because a stopped server is still billed |

`grace_delete_at` is when the server is deleted. `volume_retain_until` and `backup_retain_until` are when the disk and the profile backups are deleted.

## Bootstrap

Cloud-init is written before the provider returns a server id or address. It writes `/etc/roleflow/bootstrap` as root `0600`:

```text
machine_id=<uuid>
bootstrap_token=<single-use token>
relay_url=<Roleflow relay origin>
supabase_url=<project url>
```

It does not contain a server id, an address, a proxy URL, an SSH key, or any sending opt-in.

The provisioner stores only `sha256` of the token in `private.outreach_bootstrap`, with a 15-minute expiry. When the create-server call returns, it writes `provider_machine_id` and `public_ip` onto `client_machines` and the same pair onto the bootstrap row (`server_id`, `ipv4`).

The image reads the server id from the provider metadata service and calls the bootstrap exchange (owned by the image, on `acquisition-bot`, action `bootstrap`). That exchange calls `outreacher_claim_bootstrap(machine_id, token, server_id, source_ip)`:

- If the server id or address is not recorded yet, the result is `{ok:false, reason:"binding_pending", status:425}`. The image retries. The token is not consumed.
- A matching unused token is consumed once.
- A second use sets `client_machines.status` to `revoked`, revokes the refresh family, writes `bootstrap_replay`, and raises a Needs Diego item.

If the token expires before the first exchange, the provisioner deletes the server, mints a new token, and creates the server again on the same volume. SSH is not used. SSH keys are passed as an empty list, and the cloud firewall has no inbound rule.

`supabase/functions/_shared/outreacher-token.js` is the shared hash and JWT helper. The image owner should import it rather than hashing a second way. SQL uses `encode(extensions.digest(token, 'sha256'), 'hex')`, which is the same SHA-256 hex.

## Machine JWT

Pilot machines call edge functions only. This change does not create a Postgres role named `outreacher` and does not import a JWT signing key. That import would change how every Roleflow session is signed and needs Diego's approval before general availability.

`signMachineJwt` / `readMachineJwt` use `OUTREACHER_JWT_PRIVATE_KEY` and `OUTREACHER_JWT_PUBLIC_KEY` (ES256, `kid` `outreacher-1`). Claims are `business_id`, `machine_id`, `role=outreacher`, `sub` equal to the machine id, `iss=roleflow-outreacher`, and a one-hour `exp`. The refresh token is opaque. Its hash and the previous hash live on `client_machines`. Presenting the previous hash revokes the machine (`refresh_reuse`).

Every machine-facing edge function, after verifying the JWT, calls `authorizeMachineCall(claims, row)` in the shared helper (and may also call `outreacher_machine_gate`). The row must be the live `client_machines` row, `revoked_at` must be null, and `status` must be `provisioning`, `awaiting_login`, `running`, `paused`, `error`, or `suspended`. A revoked or deleted machine fails the next call even if the JWT has not expired. The function must take `business_id` and `machine_id` from the claims, not from the body.

No model key and no service-role key are placed on the machine.

## Heartbeat and health

The image heartbeats every 50–70 seconds. The first heartbeat while the row is `provisioning` moves it to `awaiting_login`, or to `running` when `session_state` is `ok`. noVNC listens on `127.0.0.1:6080` and is reached only through the relay.

| Situation | Wait | Result |
| --- | --- | --- |
| First boot, no heartbeat | 10 minutes after the server is running | Retry, then `failed` after `OUTREACH_MAX_ATTEMPTS` (default 5) and a Needs Diego item |
| Later boot | 5 minutes | Same retry path |
| Already `running` or `awaiting_login`, heartbeat older than `OUTREACH_HEARTBEAT_MISS_S` | Default 180 seconds, about 3 missed 50–70 second beats | Event `heartbeat_missed` and a Needs Diego item. Status stays so the client can still open the browser |

Needs Diego items are `hq_tasks` rows with `status = needs_diego` and `decision = pending`, assigned to the Chief of Staff agent named `Roleflow Agent`. The title is stable per machine and code, so a repeat tick does not open a second item.

## Disk

Only `/data` persists, on a 10 GB volume. The image mounts it at `/data` and keeps:

- `/data/profile` for the browser profile
- `/data/state` for worker state
- `/data/secrets` for the refresh token file, owned by the agent user

The volume is formatted ext4. Provider snapshots of the server do not include this volume. The image writes a nightly encrypted profile archive to the private Storage bucket `outreacher-profiles` and records it with the service role in `outreacher_backups`. The provisioner keeps 7 archives and deletes the rest. It does not create the archive.

## Network

Two layers. The provisioner owns the cloud firewall. The image owns host nftables.

Cloud firewall, one per server, label `rf_role=outreacher`, zero inbound rules, SSH disabled:

- DNS UDP/TCP 53 to the pinned resolvers (default `185.12.64.1` and `185.12.64.2`)
- NTP UDP 123 to the pinned NTP addresses
- TCP 443 to the relay, the project, and the image registry
- TCP to that client's proxy address and port

`0.0.0.0/0` is rejected. If a pin is missing, the job stays `pending` and raises Needs Diego.

Host nftables, image requirement: default-drop output. The agent user may reach the relay, the project, the registry, DNS, NTP, and the metadata address. The browser user may reach only the proxy. The browser does not receive a DNS resolver of its own. The streamed browser listens on localhost. The machine opens an outbound socket to the relay.

## Proxy

Each business gets one sticky proxy row in `outreach_proxies`, matched on `proxy_country` (ISO country, from checkout metadata). The proxy URL, backup key, and volume key for one machine live in `private.outreach_machine_secrets` (`proxy_url`, `backup_key`, `volume_key`). The `private` schema stays off the Data API. The image reads that one row with `rpc('outreacher_machine_secrets', { p_machine_id })`. The function is `SECURITY DEFINER`, `search_path` is empty, and only `service_role` can execute it. `anon` and `authenticated` cannot. The three values are plaintext for the pilot. Encrypting them at rest, with Supabase Vault or pgsodium, is a follow-up before anyone sells this past the pilot. Proxy pool credentials in `private.outreach_proxy_secrets` stay encrypted and are not in cloud-init or in `client_machines`. If no free proxy matches the country, provisioning waits and raises Needs Diego.

Released proxies stay reserved for that business for 90 days (`quarantine_until`). Another business cannot take one during that window. The same business can take it back on reactivation.

## Payments and deletion

The price is $249 setup + 10% of growth, 3-month minimum.

Checkout is Stripe Checkout in `subscription` mode. The first line item is the one-time setup price `STRIPE_OUTREACH_SETUP_PRICE_ID` with quantity 1. The second line item is the monthly metered price `STRIPE_OUTREACH_GROWTH_PRICE_ID` and is sent with no quantity. If either price id or `STRIPE_SECRET_KEY` is missing, checkout returns the support message and does not call Stripe.

`minimum_term_ends_at` is the subscription start plus three calendar months, stored in UTC. A later checkout for a machine that already has a future term does not move that date. A cancellation requested before then is sent to Stripe as `cancel_at` at that instant, with `cancel_at_period_end` false. The machine keeps running. The panel shows the date and, once scheduled, `subscription_cancel_at`. After the term, a cancellation uses `cancel_at_period_end`. The webhook calls Stripe before it records the event, so a failed schedule is retried. A follow-up event whose `cancel_at` is already that instant is stored and not sent again.

`outreach-billing` checks `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET`. The same event id is stored in `private.stripe_events` and a replay returns without a second machine.

| Event | Effect |
| --- | --- |
| `checkout.session.completed` when paid | One `pending` machine, `sending_mode=off`, subscription `active`, `minimum_term_ends_at` set. A `suspended` machine is set back to `pending` and keeps its volume. A future term already on the row is kept |
| `customer.subscription.updated` with a cancellation | Schedules `cancel_at` for `minimum_term_ends_at` when the request would end sooner. Does not pause sending and does not start the grace delete |
| `invoice.payment_failed` or `customer.subscription.deleted` | `acq_dm_controls.enabled` is set false and `acq_outreacher_config.paused` is set true, so sends stop immediately. The server keeps running. `grace_delete_at` is now plus `OUTREACH_GRACE_DAYS` (default 5). This path is unchanged by the minimum term |
| `invoice.paid` | Grace is cleared. A scheduled cancellation is left in place. A suspended machine returns to `pending` so it can be created again on the same volume. Sending stays off until the client turns it on |
| `customer.subscription.updated` to `active` or `trialing` without a cancellation | Grace is cleared and `subscription_cancel_at` is cleared |

After `grace_delete_at` the provisioner deletes the server and the firewall, keeps the volume, and sets `suspended`. `volume_retain_until` is now plus `OUTREACH_RETAIN_DAYS` (default 30). The proxy enters the 90-day quarantine. When retention ends, the volume and the profile backups are deleted and the status becomes `deleted`.

A payment during the 30 days reattaches that volume. It does not create a second machine row.

### Monthly growth fee

The fee is the share Roleflow already records. `acq_settings.share_bps` is constrained to 1000, which is 10%. For the previous UTC calendar month, `outreach-usage` sums `acq_deals.amount_cents` where `attributed` is true, `closed_on` falls in that month, and `closed_on` is on or after the machine `created_at` date. The fee is `round(sum * share_bps / 10000)`, once on the sum. A missing settings row uses 1000. Deals in a currency other than `STRIPE_OUTREACH_FEE_CURRENCY` (default `USD`), or a month with more than one currency, are not reported and are not marked done.

The cron is `outreach-usage` at 06:15 UTC. It checks the acquisition cron secret. Until `STRIPE_SECRET_KEY` and `STRIPE_OUTREACH_METER_EVENT_NAME` are both set, it returns `inert` and does not write `outreach_usage_reports` and does not call Stripe. A zero fee inserts a row with `stripe_identifier` null and does not call Stripe. A positive fee is inserted only after the meter accepts it. The meter event identifier is `outreach-fee:{business_id}:{period_start}`. The payload keys are `stripe_customer_id` and `value`. `value` is the fee in cents. The timestamp is the last second of that month. The same month is not sent twice.

`outreach_usage_reports` has no client policy. `anon` and `authenticated` cannot read or write it.

## Provider order

`OUTREACH_PROVIDER_ORDER` is optional JSON. The default is:

1. Server type `cx23`, `amd64`, locations `nbg1`, `fsn1`, `hel1`
2. Server type `cax11`, `arm64`, the same locations
3. Server type `cx33`, `amd64`, the same locations
4. DigitalOcean `s-2vcpu-4gb`, `amd64`, `fra1`

`cax11` is Arm. The image tag must be multi-arch. The row records `provider`, `server_type`, and `arch`. A type that the provider reports as unavailable is skipped. The volume is not moved once the profile has been kept. A missing token does not fail the job: it stays `pending` and raises Needs Diego.

The pilot cap is `OUTREACH_PILOT_CAP` (default 3), counted on machines that are provisioning, in health check, ready, paused, or stopping.

## Send claim

`outreacher_can_send(business_id, action_kind, target)` is the claim-before-send. `action_kind` is `dm`, `warmup`, `like`, `follow`, `view`, or `comment`. A successful call inserts `outreach_send_ledger` for 2 minutes and returns `claim_id`. `outreacher_report_send` closes that claim for the same business and machine.

Execute is revoked from `anon` and `authenticated`. The function checks `auth.role()` and returns `forbidden` for anyone else. Any database error returns `{ok:false, reason:"error"}`.

Refusal order:

| Reason | Condition |
| --- | --- |
| `forbidden` | Caller is not the service role |
| `error` | Missing business, settings, global row, bad action, or any exception |
| `global_kill` | `outreacher_global.killed` |
| `killed` | `acq_dm_controls.killed` |
| `disabled` | `acq_dm_controls` missing or `enabled` is not true |
| `paused` | `acq_outreacher_config` missing or `paused` |
| `workforce` | `business_workforce` role `personalised_outreach` is missing or not `active` |
| `ig_paused` | `acq_settings.ig_paused` |
| `system_off` | `acq_settings.system_enabled` is not true |
| `subscription` | `subscription_status` is not `active` or `trialing` |
| `machine` | Status is not `ready`, or `revoked_at` is set |
| `session` | `session_state` is not `connected` |
| `sending_off` | `sending_mode` is `off` |
| `quiet_hours` | `acq_in_quiet_hours` for the business timezone |
| `daily_cap` | Live claims plus reported sends today have reached `acq_dm_controls.daily_cap` |
| `hourly_cap` | The same count for the last hour has reached `acq_outreacher_config.hourly_cap` |
| `target` | Handle does not normalize |
| `dnc` | `acq_dnc` |
| `already_contacted` | `acq_targets.dm_sent_at`, `acq_dm_sends`, or `ig_threads.username` |

`dry_run` is allowed through the claim and is returned as `mode`. The image must not deliver a message in that mode.

`acq_worker_pipeline` is still in the database. This migration does not drop it. Execute is revoked from `anon` and `authenticated`, and granted only to `service_role`. `set_stage` to `dm_sent`, and `log` of a like, follow, view, comment, or message, return `claim_required` unless `claim_id` is a live ledger row for that business. List, stats, and add-prospect stay available to the service role because they are not sends. Retire `acq_worker_pipeline` before the outreacher is sold. It is a legacy log, and it is not the send path. External callers that posted to it with the publishable key have to move to an edge function.

## Panel

The Outreacher item in the shared account panel is `#outreacher`. It is the same page for every business, including the narrow layout. The price line is `$249 setup + 10% of growth, 3-month minimum`. Once a subscription exists, the page shows the minimum-term date and that a cancellation before then ends on that date. Checkout is a redirect from `outreach-checkout`. Cancel at end of minimum term posts `action: cancel` to that function. Until the machine is ready to sign in, the page says it is setting up. A username field and Connect are shown when a sign-in is still needed. A live session shows Access. A challenge or logout shows Reconnect. The pause switch writes `acq_outreacher_config.paused` and sets `acq_dm_controls.enabled` to the opposite. The browser frame is Roleflow's. The password is typed there and is not stored.

`/outreacher/` is the public page an ad can open. Sign-up with `next=/account/acquisition/#outreacher` returns to that tab.

## Live view

`outreach-live` (panel change) returns a 10-minute ticket for one machine. The relay pairs that ticket with the machine's outbound socket. The ticket's machine id has to match. Passwords are typed by the client into the browser on their machine. Roleflow does not store them.

## Image requirements (not built here)

- Multi-arch image tag, pinned by `OUTREACH_IMAGE_VERSION`, with separate provider image ids for `amd64` and `arm64`
- Node 22 and a headful browser under a virtual display, streamed only on localhost
- Mount the attached volume at `/data` (`profile`, `state`, `secrets`)
- Read `/etc/roleflow/bootstrap`, exchange it, then delete that file
- Heartbeat about every 60 seconds
- Do not set a live-sending environment flag
- Host nftables as described above
- Browser user cannot reach metadata, DNS, or anything except the proxy
- WebRTC non-proxied UDP disabled, and the browser password manager disabled
- Nightly encrypted profile archive into `outreacher-profiles`, then `outreacher_backups`
- `bootstrap`, `heartbeat`, and `config` on `acquisition-bot` (do not duplicate them in the provisioner)
- Call `outreacher_can_send` before any like, follow, view, or message, and `outreacher_report_send` after

## Open questions

Isolation:

- Confirm the pinned relay, project, and registry addresses before the first real server. They are required and are not guessed at runtime.
- The metadata address has to stay reachable by the agent user and unreachable by the browser user.
- A Postgres role plus an imported signing key is deliberately not in this migration.

Image:

- Confirm the heartbeat body writes `last_heartbeat_at` and `session_state` on `client_machines`.
- Confirm the archive object path recorded in `outreacher_backups.path`.
- `cax11` needs the arm build of the same image tag.
- The exchange should treat `binding_pending` as a retry, not a failure.

## Environment

Set these as function secrets. None are committed. Until the provider token, the image ids, the firewall pins, and a proxy row exist, jobs stay `pending`.

| Name | Purpose |
| --- | --- |
| `STRIPE_WEBHOOK_SECRET` | Billing signature |
| `STRIPE_SECRET_KEY` | Checkout, minimum-term cancellation, and meter events |
| `STRIPE_OUTREACH_SETUP_PRICE_ID` | One-time $249 setup price |
| `STRIPE_OUTREACH_GROWTH_PRICE_ID` | Monthly billing-meter price for the growth fee. No quantity is sent |
| `STRIPE_OUTREACH_METER_EVENT_NAME` | Meter event name. Usage reporting stays inert until this and the secret key are set |
| `STRIPE_OUTREACH_FEE_CURRENCY` | Optional. Default `USD`. A deal in another currency is left unreported |
| `HCLOUD_TOKEN` | First provider |
| `DIGITALOCEAN_TOKEN` | Fallback provider |
| `OUTREACH_PROVIDER_ORDER` | Optional JSON override of the type list |
| `OUTREACH_IMAGE_VERSION` | Image tag stored on the row |
| `OUTREACH_IMAGE_ID_AMD64` | Provider image id for `cx23` and `cx33` |
| `OUTREACH_IMAGE_ID_ARM64` | Provider image id for `cax11` |
| `OUTREACH_DO_IMAGE_ID` | Fallback provider image id |
| `OUTREACH_RELAY_URL` | Written into bootstrap. Default `https://live.roleflow.io` |
| `OUTREACH_RELAY_IPS` | Firewall pin |
| `OUTREACH_SUPABASE_IPS` | Firewall pin |
| `OUTREACH_REGISTRY_IPS` | Firewall pin |
| `OUTREACH_DNS_IPS` | Optional. Defaults to the resolver pair above |
| `OUTREACH_NTP_IPS` | Optional |
| `OUTREACHER_JWT_PRIVATE_KEY` | PKCS8 PEM. ES256 signing key. Same name as the image function. Not on the machine |
| `OUTREACHER_JWT_PUBLIC_KEY` | SPKI PEM. ES256 verify key. Same pair as the private key |
| `OUTREACH_LIVE_SECRET` | HMAC secret for the 10-minute panel ticket |
| `OUTREACH_PILOT_CAP` | Default 3 |
| `OUTREACH_GRACE_DAYS` | Default 5 |
| `OUTREACH_RETAIN_DAYS` | Default 30 |
| `OUTREACH_MAX_ATTEMPTS` | Default 5 |
| `OUTREACH_HEARTBEAT_MISS_S` | Seconds without a heartbeat before a Needs Diego item. Default 180 |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected.

External setup, all still to do:

- A Stripe product with two prices, a billing meter, and a webhook to `functions/v1/outreach-billing` for checkout completion, invoice payment failure, invoice paid, subscription updated, and subscription deleted. The setup price is one-time, $249. The growth price is recurring monthly, attached to the meter, $0.01 per unit, so the reported `value` is the fee in cents. The meter sums events. Its customer payload key is `stripe_customer_id` and its value payload key is `value`. The event name is `STRIPE_OUTREACH_METER_EVENT_NAME`. The webhook signing secret is `STRIPE_WEBHOOK_SECRET`
- Deploy `outreach-usage` before relying on the 06:15 UTC cron. Until that deploy, the cron has nothing to reach. Until the secret key and meter event name are set, a deployed call stays inert
- A provider project and token, with room for the pilot servers
- Proxy rows (country, host, port) plus encrypted credentials in `private.outreach_proxy_secrets`
- The relay, and DNS for `live.roleflow.io`
- The image published at `OUTREACH_IMAGE_VERSION`

The acquisition cron secret already stored in `private.acquisition_settings` is what `outreach-provisioner` checks. No new cron secret name.
