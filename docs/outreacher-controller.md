# Outreacher controller

This change is not applied and not deployed. It does not send messages, spend money, or turn on `ROLEFLOW_DM_LIVE`. The account panel says Roleflow. This note is the private contract.

## What is saved

A signed-in editor can save a versioned workflow for one business: timezone (default `America/Asuncion`), a 16-hour active window, a 30-minute check, new followers and post likes, a daily range of 20–100, and draft lines. `draft_only` is forced on. Personalization is limited to facts supplied from a bio. Saving writes the desired version and a command. The command is not confirmation. `observed_version` changes only after an authenticated result says the browser matches that version.

Pause and stop write `outreacher_controller_state` only. They do not write the direct-message switch, the older outreacher pause row, or a machine sending mode. Stop stays on until a service-role clear, and that clear leaves the workflow paused. Resume is refused while stop is on. Pickup of a workflow command is refused while paused.

## Shared computer

`client_machines` stays one live row per business. This change does not drop that rule and does not move an existing machine.

A shared worker is a separate row. It may hold two or three profiles. Each profile binds one business, one process slot, one profile key, and one proxy. Two profiles cannot share a proxy. A proxy without its own profile is rejected. A business that already has a live `client_machines` row cannot also be bound to a shared worker. Binding does not delete that row.

A profile is inserted as `needs_login`, not ready. No proxy rows are seeded. Diego has no proxies yet.

## What the current desktop can do

The browser available to this controller is managed Google Chrome. The profile menu can add a Chrome profile. That profile has not been created or tested. System settings expose one OS-level proxy, not a per-profile proxy. Separate per-profile proxies are therefore not configured and not supported on this desktop. Do not change managed policies or the shared network. Do not drive that Chrome with shell commands. Any later desktop step has to go through the supported computer-use path, and only after a test.

Until that test exists, the panel keeps browser control unavailable and the connect button disabled. A database flag cannot make this desktop look confirmed.

## Controller transport

The only documented inbound route for a hosted Grok Bot custom channel is:

`POST $AGENT_ALIAS_URL/v1/channels/<channel>/<route>`

Send `X-Agent-Alias-Token`. Hosting answers with an empty `202` before the handler runs. The caller does not receive a session id, a result, or an error from the handler. A retry is not deduplicated and starts another turn, so this code does not POST again after `202`. `202` is stored as `accepted`. It is not `observed`. Any other success status is a failure, including a body that claims the change was applied. Results have to come back through `outreacher_ack` and `outreacher_record_result`.

The channel's own auth defaults to loopback-only. A hosted caller still needs a channel policy Diego authors (`bearerAuth` or `sharedSecretAuth`). No alias URL, channel name, or token is in this repo. Nothing is called.

`outreach-controller` returns 503 until `OUTREACH_CONTROLLER_ENABLED=1`. Do not set that flag and do not deploy the function. Worker sessions use a separate ES256 token (`kid` `outreacher-worker-1`, role `outreacher_worker`, no business id). A machine token stays on `acquisition-bot` and is rejected here. The worker id comes from the token, not the body.

Secrets, if they are ever created, belong in `private.outreacher_controller_secrets`. They are not granted to signed-in users and they are not in git.

## Extension

Public page: https://igdm.io/

The Chrome Web Store listing whose site link is `https://igdm.io/` is "APP For IG DM", id `gdfopkngmfgciikjjioghmdhgkikclbo`, version 1.0.2, updated 14 Oct 2026, developer email `jackiehgk1@gmail.com`, non-trader. The public page describes a browser extension that uses the existing Instagram session and a GUI: DM Sender Setup, DM Bot Setup, Start, and Abort. It claims randomized template lines for new followers and post likes, and that it is free.

A different listing, id `hccnecipbimihniebnopnmigjanmnjgh`, points at `https://soleads.ai/` and is not the igdm.io listing.

Not found on the public page or listing: an external control API, a license, white-label rights, quotas, dedup, or bio personalization. The extension was not downloaded, installed, or inspected. There is no bridge from Roleflow to it.

## Commands

Allowed operations are `set_workflow`, `pause`, `resume`, `kill`, and `reconcile`. A result outcome of `sent` or `live` is refused. A draft or a qualification without bio facts is refused. The same business and dedup key is stored once; a repeat is `duplicate_skipped`. Commands expire after 30 minutes. A repeat of the same workflow returns the original command and does not mark it observed. The wrong worker, the wrong profile, or the wrong proxy is `misrouted` or `wrong_account` and does not change the command to observed.

Fixture rows are `test_only`. Clients cannot read them. The panel does not treat them as confirmation.

## Still manual

1. Review this migration. It is not applied to project `xrsipofgofvjiskmsgij`.
2. Do not deploy `outreach-controller`. Leave `OUTREACH_CONTROLLER_ENABLED` unset.
3. Leave direct-message enablement and `ROLEFLOW_DM_LIVE` as they are.
4. Provision proxies and a worker whose browser processes can take one proxy each. This managed Chrome cannot.
5. After a desktop test, install any extension only with a documented control method and a license that allows it.
6. Author the Grok Bot channel, store the alias URL and token outside git, and enable the route only after an acknowledgement is proven.
7. A person logs in to Instagram in each profile. Roleflow does not take the password.
