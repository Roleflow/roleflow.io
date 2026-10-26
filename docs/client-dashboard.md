# Client dashboard setup

Two migrations in this area are **NOT APPLIED**. Apply them yourself when you are ready.

- `supabase/migrations/20261026120000_client_dashboard_agents.sql` adds row-level security and does not delete TailorTalk rows. Until it is applied, every agent switch reads as off and no agent send leaves Roleflow.
- `supabase/migrations/20261026140000_business_model_keys.sql` limits who can save or remove a model key. It does not recreate `private.business_llm_secrets` and does not delete a key. Until it is applied, the older save function still allows an editor to set a key.

## What you set

Function secrets, in the Supabase function secrets UI. Do not put them in the repo.

Instagram through Zernio:

- `ZERNIO_API_KEY` — bearer token for `https://zernio.com/api/v1`
- `ZERNIO_WEBHOOK_SECRET` — verifies the inbound Instagram webhook

If both are unset, the gateway falls back to the values already stored for `acq_read_gateway_settings`. A missing key means nothing is sent.

Platform model keys. The reply engine and the try panel use the business's own saved key first. If that business has no key, these env keys are the fallback. The try panel stays inside Roleflow and does not send a message. With no business key and no env key, the try panel uses the local preview sentence.

- `LLM_PROVIDER` — optional: `xai`, `openai`, or `gemini`
- `XAI_API_KEY` and optional `XAI_MODEL`
- `OPENAI_API_KEY` and optional `OPENAI_MODEL`
- `GEMINI_API_KEY` or `GOOGLE_API_KEY`, and optional `GEMINI_MODEL`

Each business can save its own xAI, OpenAI, or Gemini key from Settings (linked from Agentic Setter). The key is encrypted with `extensions.pgp_sym_encrypt` and the server-held `llm_token_key`. After save, the browser receives only the last 4 characters. `acq_llm_read_key` is service-role only. Only the workspace owner, an owner member, or a platform admin can save or remove it. Test key calls `llm-check`, which asks the provider for the single word `pong` and returns OK or a redacted error. A typed key is used once for that check and is not stored.

The follow-up job and the outbox tick use the cron secret already stored in `private.acquisition_settings` (`cron_secret`), read with `acq_read_cron_secret`. There is no new cron env name.

Leave `TAILORTALK_SYNC_ENABLED` unset. The retired TailorTalk sync, push, pull, and deliver paths return 410 unless that variable is exactly `1`. Do not set it to turn the old sync back on.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase.

## What you deploy

After the migration is applied:

1. Deploy `client-dashboard` with `verify_jwt = true`.
2. Deploy `followup-boss` with `verify_jwt = false`. The migration schedules it every five minutes against `https://xrsipofgofvjiskmsgij.supabase.co/functions/v1/followup-boss`. Change that URL in the migration if this project ref is different, then apply again.
3. Redeploy `zernio-webhook`, `ig-outbox-tick`, `roleflow-acquisition`, `acquisition-bot`, `inbox-reply`, `tailortalk-sync`, `acq-tailortalk`, `roleflow-setter-sync`, and `setter-engine`.

Point the Zernio webhook at `functions/v1/zernio-webhook`. Inbound Instagram DMs are stored there. A reply is planned only when Agentic Setter is Live and a system prompt is saved.

## Connect Instagram

Connect Instagram in Settings and on Agentic Setter calls `GET https://zernio.com/api/v1/connect/instagram` for that business's profile and opens the returned Instagram login URL. That is the path to use when `ZERNIO_API_KEY` is set.

If the key is missing, the button cannot start that login. Open https://zernio.com/dashboard and do this by hand:

1. Sign in.
2. Create a profile for the business, or open the profile whose external id is the business id.
3. Connect an Instagram Business or Creator account. A personal account cannot connect.
4. Create an API key at https://zernio.com/dashboard/api-keys, set `ZERNIO_API_KEY`, and use Connect Instagram again so Roleflow receives the account and the webhook.

Connecting only in the dashboard does not attach the account to Roleflow until the connect call succeeds.

## What you turn on

Every agent defaults to off, including when the switch row is missing. Off is enforced in the send path, not only in the page.

- Lead Warmer and Outreacher open the client's own Grok Bot. The buttons stay disabled until `acquire/client-config.js` or `window.ROLEFLOW_GROK_URLS` has a real `https` URL. An empty string is a placeholder, not a connection.
- Agentic Setter cannot be turned on until the system prompt is saved and tried in the test panel. Turning any agent on asks for confirmation.
- Follow Up Boss queues a message only when its switch is on, the lead matches the saved stage and booking rule, quiet hours are clear, the 24-hour window is open, and the follow-up count is under the max. The same recovery key is used by the five-minute job and the acquisition tick, so one lead is not queued twice.
- A reply typed in Chats is a human message and still sends while the agents are off.

Language is stored per user in `acq_user_prefs` (`en` or `es`) and also in the browser under `roleflow.lang`.
