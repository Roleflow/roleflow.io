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
| Comment-to-DM | Setter provider: TailorTalk, or Roleflow's Meta engine when the business selects `roleflow_meta`. |
| Qualification & Gap-Building | Same setter provider. |
| Conversation Recovery | Same setter provider. Up to 3 follow-ups, about 6 hours apart, inside 24 hours on the Meta engine. |
| Appointment Booking & Show-Up | Same setter provider. On the Meta engine, Google Calendar. The owner marks show-up. |

Each business picks `acq_settings.setter_provider`: `roleflow_meta` (default) or `tailortalk`. The Meta conversation engine stays in the product. TailorTalk is the provider while a Meta app cannot be created. HQ `tailortalk-sync` still owns Get Leads and Get Contacts. After each agent sync it projects summary rows into every connected business whose TailorTalk agent id matches. Sync now asks that function to pull one agent.

## TailorTalk provider

On Integrations and Setup, an editor enters the TailorTalk API key (Developer → API Keys) and the agent id, then uses Test connection. The key, agent id, and webhook secret are encrypted with `extensions.pgp_sym_encrypt` under `private.tt_business_secrets`. The panel stores only a status row in `acq_setter_links`.

Get Leads is `POST https://api.tailortalk.ai/api/v1/get_leads` with `Authorization: Agent <token>`. The body can send `start_after`, `lead_status`, `lead_source`, and `limit` (max 200). The sync pages backwards by `last_message_time` and does not send empty filters. The response is summary fields only: id, name, contact (often null on Instagram), status, category, `is_converted` / `converted_at`, last message time, follow-up count, integration, source, and username. It has no chat history and no extracted attributes. Customers are counted when `is_converted` is true.

On connect, the business agent is registered in `tailortalk_agents` so that pull covers it. `tailortalk-sync` then writes summary rows (`detail: summary`) through `acq_tt_apply_batch`. A later summary keeps webhook attributes, messages, and `detail_source`. Mark Converted is `POST https://api.tailortalk.ai/api/v1/mark_converted` with `{contact_ids:[...]}` of Instagram user ids. A handle or a TailorTalk lead id is not sent. Mark Order stays on `https://api.tailortalk.ai/api/v1/mark_order`. A won deal calls both when the amount is above zero, and Mark Converted when the amount is zero. `acq-tailortalk-sync` still runs every 5 minutes and only retries deals marked pending or error, plus re-registers the agent. It does not page Get Leads.

Webhook URL (shown after connect and after Test connection). Webhooks need a paid TailorTalk plan. Starter, which Diego is on, does not send them:

`https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/acq-tailortalk/webhook?business=<workspace uuid>&k=<per-business secret>`

Subscribe that URL to First Message, On Warm, On Hot, On Converted, Every Message, and custom. The JSON body has `webhook_trigger`, `event_type: lead`, `occurred_at`, and `data` (the full lead: `chat_history` with role, content, message_id, and time, `chat_summary`, `lead_attributes`, escalation and lock state, and bookings). Headers include `User-Agent: TailorTalk-Webhook/1.0`, `X-Webhook-Version: v1`, and `X-Webhook-Timestamp`. There is no signature. The `k` query value is the per-business secret. A missing or wrong secret, or a timestamp more than 5 minutes off, returns 401. Bad JSON returns 400. Any other `event_type` returns 200 and is ignored. Events are deduped on lead id plus `occurred_at`. The handler returns 2xx after the row is stored and does not call TailorTalk. A database failure returns 500 so TailorTalk retries. 4xx is not retried.

Extracted attribute keys on Diego's agent: budget, timeline, decision_maker, fit, ig_handle, offer, monthly_revenue, niche, offer_price, dm_volume, current_dm_handling, gap, objections, time_zone, booking_email, booking_date, voice_note_slot. `voice_note_slot` fills the voice-notes queue in the panel. With no webhook, the CRM shows the pull's status and summary and says so. With a webhook, that lead shows the conversation, the summary, and the attributes.

Pausing all four setter agents makes the sync record `paused` and skip writes. Pausing one agent still syncs the CRM and only writes the audit count for agents that are on. The agent inside TailorTalk has to be paused there as well, or it keeps messaging.

`TAILORTALK_CRON_SECRET` is optional. The cron job sends the existing acquisition cron secret from `private.acquisition_settings`. Do not print that secret.

New accounts do not use the old “Build your DM setter” form. Account navigation sends them to `/account/acquisition/`. That form stays only for a setter submission that already has answers, or one that was submitted. If `XAI_API_KEY` is missing, `generate-setter-prompt` keeps the saved answers and returns that the prompt was not written. It does not answer with HTTP 500, and the form does not call that a failed save.

## What the account panel includes

Workforce (all eight, with on/off), inbox, pipeline, voice notes, reports, integrations (Instagram, Google Calendar, outreach worker), billing, prompts with a test box that does not send, and setup.

## Booking and disclosure

Primary booking is Google Calendar free/busy and an event with Meet. If Calendar is not connected, the assistant sends the live site link once: `https://calendar.app.google/8i1gomkozavqYU5b8`.

If a lead asks whether they are talking to a bot or an AI, the answer is: Diego’s team uses an AI assistant to keep up with conversations. Diego personally reviews them and takes the calls.

## Pricing

10% of the growth the owner records on deals this system sourced. No setup fee. No retainer. The share is `share_bps = 1000`.

## Hosting

The site is static on Vercel. Privileged work runs as Supabase edge functions, same as the existing sync and HQ functions. A one-minute `pg_cron` job calls `roleflow-acquisition/tick`. A separate job, `acq-tailortalk-sync`, runs every 5 minutes and POSTs `{"action":"sync"}` to `acq-tailortalk`. That job sends the cron secret from `private.acquisition_settings`. That secret is not an environment variable. The registry job keeps the name `tailortalk-sync-hourly` and runs every 5 minutes (`*/5 * * * *`). It still sends `TAILORTALK_CRON_SECRET` from `private.tailortalk_settings`. The schedule change copies the existing command inside the database.

Chief of Staff runs once a day as `acq-chief-daily` (`15 6 * * *` UTC). It builds the warm-up queue for qualified targets still at stage `target`, up to the daily cap, drafts any missing openers with `grok-4.3`, and writes the daily summary. The panel button "Run daily summary" calls the same job for the signed-in business. Discovered profiles are scored on ingest and stored at stage `target` before that queue runs.

`acquisition-bot` and `acq-tailortalk` are deployed with their source in the function. `acq-tailortalk` has `verify_jwt` off. `roleflow-acquisition` is deployed with `verify_jwt` off. Its entrypoint imports commit `c8e84c91f400dfd0a5f23bb3b0ee8a41d3e033a6` from jsDelivr. That pin is a full commit, not a branch, and it is the commit that defaults the conversation model to `grok-4.3` at `https://api.x.ai/v1`. A cold start still fetches that commit, including the prompt seed. Re-deploy the one-line import when this code changes. After that deploy: a webhook handshake without the verify token returns 403, a wrong cron bearer returns 401, and an unknown deletion code returns `{ok:false}`.

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
| `TAILORTALK_CRON_SECRET` | Optional alternate bearer for `acq-tailortalk` action `sync`. The scheduled job does not need it. |

When `XAI_API_KEY` is set and `LLM_PROVIDER` is empty, the engine calls `https://api.x.ai/v1/chat/completions` with JSON output. The default model is `grok-4.3`: on the October 2026 xAI price table it is the cheapest general model that documents structured output. `grok-build-0.1` is cheaper and is the coding model. Set `LLM_PROVIDER=openai` or `gemini` to use those keys instead.

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` are injected into edge functions.

Worker keys are issued in the panel (`rfw_` plus 32 random bytes). Only the SHA-256 hash is stored. The raw key is shown once. There is no global bot secret.

See `docs/acquisition-bot-api.md` for the worker HTTP API.
