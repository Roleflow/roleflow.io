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
| Comment-to-DM | Setter provider: Roleflow Setter Engine, or Roleflow's Meta engine when the business selects `roleflow_meta`. |
| Qualification & Gap-Building | Same setter provider. |
| Conversation Recovery | Same setter provider. Up to 3 follow-ups, about 6 hours apart, inside 24 hours on the Meta engine. |
| Appointment Booking & Show-Up | Same setter provider. On the Meta engine, Google Calendar. The owner marks show-up. |

Each business picks `acq_settings.setter_provider`: `roleflow_meta` (default) or `engine`. The Meta conversation engine stays in the product. The Roleflow Setter Engine (the Instagram DM engine) runs comment-to-DM, qualification, recovery, and booking while a Meta app cannot be created. A server pull reads lead summaries into the business CRM. Customers are counted when `is_converted` is true.

## Roleflow Setter Engine

On Integrations and Setup, an editor enters the Instagram handle and requests activation. The status stays **Pending activation** until an admin links the engine agent id and access token. The token is encrypted and is not returned to the browser. The panel stores a status row in `acq_setter_links` (`provider = engine`, plus `requested_handle` and `external_agent_id`).

The pull is summary fields only: id, name, contact (often null on Instagram), status, category, `is_converted` / `converted_at`, last message time, follow-up count, and username. It has no chat history and no extracted attributes. A later summary keeps attributes, messages, and `detail_source` already stored from the full event stream. Marking a deal won reports the order when the amount is above zero, and marks the lead converted. A booked or showed appointment marks the lead converted. Both calls use the Instagram user id, not a handle.

Scripts, qualification rules, follow-up cadence, comment-to-DM keywords, pause, and Instagram reply drafts do not have a public write. Those edits are written to `engine_outbox` (`update_workflow`, `update_settings`, `pause_agent`, `message_lead_draft`) and the panel shows **Syncing…** while the row is pending. An assistant applies pending rows and marks them applied or failed through `setter-engine`, authenticated with `ENGINE_OUTBOX_SECRET`. That secret is stored in `private.acquisition_settings` under the key `engine_outbox_secret`. The function also accepts the same value from the `ENGINE_OUTBOX_SECRET` environment variable when it is set. Do not print the secret.

The full event stream, when connected, sends `webhook_trigger`, `event_type: lead`, `occurred_at`, and the lead (`chat_history`, `chat_summary`, `lead_attributes`, escalation and lock state, and bookings). The per-business secret stays in the server URL and is not shown in the panel. A missing or wrong secret, or a timestamp more than 5 minutes off, returns 401. Bad JSON returns 400. Any other `event_type` returns 200 and is ignored. Events are deduped on lead id plus `occurred_at`. The handler returns 2xx after the row is stored. A database failure returns 500 so the sender retries. 4xx is not retried.

Extracted attribute keys: budget, timeline, decision_maker, fit, ig_handle, offer, monthly_revenue, niche, offer_price, dm_volume, current_dm_handling, gap, objections, time_zone, booking_email, booking_date, voice_note_slot. `voice_note_slot` fills the voice-notes queue in the panel. Before the full event stream is connected, the CRM shows the pull's status and summary and says so. After it is connected, that lead shows the conversation, the summary, and the attributes.

Pausing all four setter agents makes the sync record `paused` and skip writes. Pausing one agent still syncs the CRM, writes an outbox pause for that agent, and only writes the audit count for agents that are on.

An optional cron bearer can stand in for the scheduled deal-retry job. The scheduled job sends the existing acquisition cron secret from `private.acquisition_settings`. Do not print that secret.

New accounts do not use the old “Build your DM setter” form. Account navigation sends them to `/account/acquisition/`. That form stays only for a setter submission that already has answers, or one that was submitted. If `XAI_API_KEY` is missing, `generate-setter-prompt` keeps the saved answers and returns that the prompt was not written. It does not answer with HTTP 500, and the form does not call that a failed save.

## What the account panel includes

Workforce (all eight, with on/off), inbox, pipeline, voice notes, reports, integrations (Instagram, Google Calendar, outreach worker), billing, prompts with a test box that does not send, and setup.

## Booking and disclosure

Primary booking is Google Calendar free/busy and an event with Meet. If Calendar is not connected, the assistant sends the live site link once: `https://calendar.app.google/8i1gomkozavqYU5b8`.

If a lead asks whether they are talking to a bot or an AI, the answer is: Diego’s team uses an AI assistant to keep up with conversations. Diego personally reviews them and takes the calls.

## Pricing

10% of the growth the owner records on deals this system sourced. No setup fee. No retainer. The share is `share_bps = 1000`.

## Hosting

The site is static on Vercel. Privileged work runs as Supabase edge functions, same as the existing sync and HQ functions. A one-minute `pg_cron` job calls `roleflow-acquisition/tick`. A deal-retry job runs every 5 minutes. The registry pull also runs every 5 minutes. Both send a cron secret stored in private settings. That secret is not an environment variable and is not printed.

Chief of Staff runs once a day as `acq-chief-daily` (`15 6 * * *` UTC). It builds the warm-up queue for qualified targets still at stage `target`, up to the daily cap, drafts any missing openers with `grok-4.3`, and writes the daily summary. The panel button "Run daily summary" calls the same job for the signed-in business. Discovered profiles are scored on ingest and stored at stage `target` before that queue runs.

`acquisition-bot`, `setter-engine`, and the setter webhook are deployed with their source in the function. `setter-engine` and the webhook have `verify_jwt` off and check their own callers. `roleflow-acquisition` is deployed with `verify_jwt` off. Its entrypoint imports commit `c8e84c91f400dfd0a5f23bb3b0ee8a41d3e033a6` from jsDelivr. That pin is a full commit, not a branch, and it is the commit that defaults the conversation model to `grok-4.3` at `https://api.x.ai/v1`. A cold start still fetches that commit, including the prompt seed. Re-deploy the one-line import when this code changes. After that deploy: a webhook handshake without the verify token returns 403, a wrong cron bearer returns 401, and an unknown deletion code returns `{ok:false}`.

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
| `LLM_PROVIDER` | Optional. `xai` (default when `XAI_API_KEY` is set), `openai`, or `gemini` |
| `XAI_API_KEY` | Default provider. Chat completions at `https://api.x.ai/v1` |
| `XAI_MODEL` | Optional. Default `grok-4.3` |
| `OPENAI_API_KEY` | Used when `LLM_PROVIDER=openai`, or when no xAI key is set |
| `OPENAI_MODEL` | Optional. Default `gpt-4.1-mini` |
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | Used when `LLM_PROVIDER=gemini`, or when xAI and OpenAI are unset |
| `GEMINI_MODEL` | Optional. Default `gemini-2.0-flash` |
| `ENGINE_OUTBOX_SECRET` | Optional. When set, it is the bearer for `setter-engine` actions `outbox_list` and `outbox_mark`. Otherwise the function reads `private.acquisition_settings` key `engine_outbox_secret`. |

When `XAI_API_KEY` is set and `LLM_PROVIDER` is empty, the engine calls `https://api.x.ai/v1/chat/completions` with JSON output. The default model is `grok-4.3`: on the October 2026 xAI price table it is the cheapest general model that documents structured output. `grok-build-0.1` is cheaper and is the coding model. Set `LLM_PROVIDER=openai` or `gemini` to use those keys instead.

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` are injected into edge functions.

Worker keys are issued in the panel (`rfw_` plus 32 random bytes). Only the SHA-256 hash is stored. The raw key is shown once. There is no global bot secret.

See `docs/acquisition-bot-api.md` for the worker HTTP API.
