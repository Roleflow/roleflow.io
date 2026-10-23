# Meta app review: Roleflow Instagram Login

Roleflow connects a customer's professional Instagram account with **Instagram API with Instagram Login**. The consent screen shows **Roleflow**. The product stays off until `META_IG_ENABLED` is true and both `META_IG_APP_ID` and `META_IG_APP_SECRET` are set. Without those, the connect button does not redirect, the callback does not exchange a code, and the webhook does not accept events.

This is a draft for the reviewer. Do not turn the flag on in production until the Meta app is approved.

## App settings to register

| Dashboard field | Value |
| --- | --- |
| App type | Business. Product: Instagram API with Instagram Login |
| Display name | Roleflow |
| App domains | `roleflow.io`, `www.roleflow.io` |
| Privacy Policy URL | https://www.roleflow.io/privacy/ |
| Terms of Service URL | https://www.roleflow.io/terms/ |
| Data deletion instructions | https://www.roleflow.io/data-deletion/ |
| Data deletion callback | https://www.roleflow.io/api/meta/ig/deletion |
| Valid OAuth redirect URI | https://www.roleflow.io/api/meta/ig/callback |
| Webhook callback URL | https://www.roleflow.io/api/meta/ig/webhook |
| Webhook verify token | the value of `META_VERIFY_TOKEN` |
| Webhook fields | `messages`, `comments`, `messaging_postbacks` |

Deauthorize uses the same deletion callback. A GET on that URL with `?code=` returns only `status` and `received_at`. It does not return the Instagram user id.

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `META_IG_ENABLED` | Yes, to turn the path on | Off unless set to `true`, `1`, `yes`, or `on` |
| `META_IG_APP_ID` | Yes, with the flag | Instagram app id on the consent screen |
| `META_IG_APP_SECRET` | Yes, with the flag | Code exchange, state signature, webhook signature, deletion signature |
| `META_VERIFY_TOKEN` | Yes, for the webhook handshake | Matches the verify token in the Meta dashboard |
| `META_IG_TOKEN_KEY` | Yes, to store a token | At least 16 characters. Encrypts the long-lived token. Falls back to `META_TOKEN_KEY` |
| `META_IG_GRAPH_VERSION` | No | Defaults to `v23.0` |
| `META_IG_REDIRECT_URI` | No | Defaults to `https://www.roleflow.io/api/meta/ig/callback` |
| `CRON_SECRET` | Yes, for refresh | Bearer for `GET /api/meta/ig/refresh` |
| `SUPABASE_URL` | Yes | Workspace store |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server store. Never sent to the browser |

The daily refresh is `0 12 * * *` on `/api/meta/ig/refresh`. It refreshes a long-lived token in the last 14 days of its 60-day life and sends pending engine-outbox drafts only when that workspace's `channel_provider` is `meta`. The default is `tailortalk`. The panel has no switch for it. A successful connect sets `meta`. Disconnect sets `tailortalk` and deletes the token.

## Reviewer login

1. Open https://www.roleflow.io/signup/ and create the reviewer account, or use the credentials Roleflow sends in the submission notes.
2. Open https://www.roleflow.io/account/acquisition/#onboarding and walk to the Instagram step, or open Settings and choose Integrations: https://www.roleflow.io/account/acquisition/#configuration/connect
3. The business used for review must have `META_IG_ENABLED` on in the deployment the reviewer hits. A deployment without the flag shows the button and then the notice "Instagram Login is off."

## Permission: instagram_business_basic

What it is for: read the professional account id and username after the person connects, and show `@username` on Integrations.

Screencast:

1. Start on the Roleflow Integrations page, signed in, Instagram status disconnected.
2. Click **Connect Instagram**.
3. Show the Instagram consent screen. The app name is Roleflow. The redirect host is `www.roleflow.io`.
4. Approve.
5. Land back on Integrations. The status line shows connected and the Instagram username.
6. Say that Roleflow stored the token on the server and the browser does not show it.

## Permission: instagram_business_manage_messages

What it is for: receive a DM the reviewer sends to the connected professional account, store it as a lead message, and send one reply from the engine outbox through `POST https://graph.instagram.com/v23.0/me/messages`.

Screencast:

1. From a second Instagram account, send a DM to the connected professional account: "Can I book a call?"
2. On Roleflow, open Chats for that business. The new line is labeled **Lead**.
3. Show a pending engine-outbox draft for that recipient. Say the workspace channel is meta, which is not a control on the page.
4. After the outbox run, show the reply in the Instagram thread.
5. Click **Disconnect**. Show the status return to disconnected and say the token was deleted.

## Permission: instagram_business_manage_comments

What it is for: receive a comment webhook and store the comment text on the lead. This phase does not auto-reply to the comment.

Screencast:

1. From the second Instagram account, comment on a post of the connected professional account: "What is the price?"
2. On Roleflow, open Chats. The comment text is on that lead's thread, labeled **Lead**.
3. Say that Roleflow did not post a public reply by itself.

Webhook subscription for this permission: `comments` and `messaging_postbacks`.

## Permission: instagram_business_content_publish

This scope is requested and is optional. Roleflow does not publish a feed post, reel, or story in this phase. The connection still completes if the token comes back. Do not demonstrate a publish call. If review requires the permission to be removed until a publish flow exists, remove it from the authorize scope before submission and leave the other three.

Screencast, if the permission stays on the consent screen:

1. On the Instagram consent screen, point at content publishing in the requested access.
2. Return to Roleflow and show that no post was created.
3. Say that publishing is not part of this build.

## What the reviewer should not see

- An Instagram password field.
- The long-lived token, app secret, or verify token.
- A control named channel provider. TailorTalk remains the default until a connect succeeds.
- A message sent to a lead while the flag is off.
