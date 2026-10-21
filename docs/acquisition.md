# Client acquisition

Roleflow’s acquisition product lives in each signed-in user’s account at `/account/acquisition/`. Admin and Agentic HQ stay Diego’s cross-business tools. Admins open the same account panel and can switch businesses because workspace read access includes admins.

`/acquire/` redirects to `/account/acquisition/`. Styles and scripts stay under `/acquire/` so the redirect does not hide them.

## The eight agents

| Agent | Where it runs |
| --- | --- |
| Chief of Staff | Workspace settings, daily summary, exceptions. |
| ICP Target Acquisition | Outreach worker (`acquisition-bot`). Not the Meta app. |
| Engagement Warm-Up | Outreach worker. |
| Personalised Outreach | Outreach worker. Sends the owner’s recorded opener. |
| Comment-to-DM | Roleflow conversation engine on the official Instagram API. |
| Qualification & Gap-Building | Conversation engine. |
| Conversation Recovery | Conversation engine. Up to 3 follow-ups, about 6 hours apart, inside 24 hours. |
| Appointment Booking & Show-Up | Conversation engine plus Google Calendar. The owner marks show-up. |

TailorTalk tables and `tailortalk-sync` stay as a legacy client cache. New workspaces do not need them. The engine does not call TailorTalk.

## What the account panel includes

Workforce (all eight, with on/off), inbox, pipeline, voice notes, reports, integrations (Instagram, Google Calendar, outreach worker), billing, prompts with a test box that does not send, and setup.

## Booking and disclosure

Primary booking is Google Calendar free/busy and an event with Meet. If Calendar is not connected, the assistant sends the live site link once: `https://calendar.app.google/8i1gomkozavqYU5b8`.

If a lead asks whether they are talking to a bot or an AI, the answer is: Diego’s team uses an AI assistant to keep up with conversations. Diego personally reviews them and takes the calls.

## Pricing

10% of the growth the owner records on deals this system sourced. No setup fee. No retainer. The share is `share_bps = 1000`.

## Hosting

The site is static on Vercel. Privileged work runs as Supabase edge functions, same as the existing sync and HQ functions. A one-minute `pg_cron` job calls `roleflow-acquisition/tick`. The cron secret is generated in `private.acquisition_settings` and is not an environment variable.

## Meta app

One Meta app, owned by Roleflow. Each business authorizes it with Instagram Login.

Permissions: `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`.

Redirect URI: `https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/roleflow-acquisition/meta/callback`

Webhook URL: `https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/roleflow-acquisition/webhook`

Subscribe to: `messages`, `messaging_postbacks`, `message_reactions`, `comments`, `mentions`.

Data deletion callback: `https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/roleflow-acquisition/deletion`

Public privacy policy: `https://www.roleflow.io/privacy/`

Public data-deletion instructions: `https://www.roleflow.io/data-deletion/`

While the app is in development, only Instagram accounts with a role on the app (administrator, developer, tester) can connect. Sending and receiving for other client accounts needs App Review and Advanced Access for `instagram_business_manage_messages` and `instagram_business_manage_comments`, plus Meta Business Verification. The privacy policy and data-deletion URLs above are the ones to submit.

`HUMAN_AGENT` is used only for a genuine human reply from the inbox, on a thread the owner locked, inside 7 days of the last user message. Automated recovery never uses that tag and does not send after 24 hours.

## Google Calendar

OAuth client in Google Cloud. Scopes: `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/calendar.readonly`.

Redirect URI: `https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/roleflow-acquisition/google/callback`

## Environment variables

Set these on the Supabase project. None are committed. The product still loads without them: connect returns a clear error, inbound events are stored, and no automated reply is sent when a model key is missing.

| Name | Purpose |
| --- | --- |
| `META_APP_ID` | Meta app id |
| `META_APP_SECRET` | Webhook signature and token exchange |
| `META_WEBHOOK_VERIFY_TOKEN` | Webhook GET handshake |
| `META_REDIRECT_URI` | Optional override of the callback URL |
| `META_TOKEN_KEY` | At least 16 characters. Encrypts Instagram tokens. |
| `GRAPH_API_VERSION` | Optional. Default `v21.0`. |
| `GOOGLE_CLIENT_ID` | Calendar OAuth client |
| `GOOGLE_CLIENT_SECRET` | Calendar OAuth secret |
| `GOOGLE_REDIRECT_URI` | Optional override |
| `GOOGLE_TOKEN_KEY` | Encrypts Google tokens. Falls back to `META_TOKEN_KEY`. |
| `LLM_PROVIDER` | Optional `openai` or `gemini` |
| `OPENAI_API_KEY` | Used when present |
| `OPENAI_MODEL` | Optional. Default `gpt-4.1-mini` |
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | Used when OpenAI is unset |
| `GEMINI_MODEL` | Optional. Default `gemini-2.0-flash` |

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` are injected into edge functions.

Worker keys are issued in the panel (`rfw_` plus 32 random bytes). Only the SHA-256 hash is stored. The raw key is shown once. There is no global bot secret.

See `docs/acquisition-bot-api.md` for the worker HTTP API.
