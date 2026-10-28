# Client dashboard setup

Three migrations in this area are **NOT APPLIED**. Apply them yourself when you are ready.

- `supabase/migrations/20261026120000_client_dashboard_agents.sql` adds row-level security and does not delete TailorTalk rows. Until it is applied, every agent switch reads as off and no agent send leaves Roleflow.
- `supabase/migrations/20261026140000_business_model_keys.sql` limits who can save or remove a model key. It does not recreate `private.business_llm_secrets` and does not delete a key. Until it is applied, the older save function still allows an editor to set a key.
- `supabase/migrations/20261026160000_prompt_versions_and_comment_voice.sql` adds prompt version history, the comment-voice switch (default off), rule and decision tables, and copies a linked agent's deployed section instructions into `acq_agent_prompts` only when that body is empty. The instruction text is not rewritten. It does not drop tables. Until it is applied, version history and comment voice cannot be saved.
- `supabase/migrations/20261027190000_setter_claude.sql` adds `acq_settings.setter_claude_mode` (`default` or `own`). It does not recreate the key table and does not delete a key. **NOT APPLIED**. Until it is applied, Settings cannot store the Claude choice and setter replies stay on the current model.
- `supabase/migrations/20261028070000_winning_conversations.sql` stores pasted DM transcripts per business. **NOT APPLIED**.
- `supabase/migrations/20261028080000_onboarding_intake.sql` stores the intake, the share-link hash, and a private `onboarding-materials` bucket. **NOT APPLIED**. It does not turn a setter on.

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
- `ANTHROPIC_API_KEY` — platform Claude Sonnet key for setter replies. If it is missing, the setter keeps its current model and the function logs that it fell back. Do not put a business key in this secret. Claude Sonnet 5.5 rejects a `temperature` field, so those requests omit it. `claude_health` reports the provider, model, ok or fail, and whether the key kind is `usr`, `api`, `other`, or `missing`. It does not return the key.

Each business can save its own xAI, OpenAI, or Gemini key from Settings (linked from Agentic Setter). The key is encrypted with `extensions.pgp_sym_encrypt` and the server-held `llm_token_key`. After save, the browser receives only the last 4 characters. `acq_llm_read_key` is service-role only. Only the workspace owner, an owner member, or a platform admin can save or remove it. Test key calls `llm-check`, which asks the provider for the single word `pong` and returns OK or a redacted error. A typed key is used once for that check and is not stored.

Setter replies use Claude Sonnet (`claude-sonnet-5-5`) when a key is available. Settings → AI model chooses Roleflow default or a business Claude key. Resolution order: the business key when the mode is `own` and a key is saved, then `ANTHROPIC_API_KEY`, then the setter's current model. An auth error on the business key is logged without the key, shown in the panel, and the next model answers. The practice thread keeps the same prompt and output. Token counts are logged without the reply text.

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

The signed-in dashboard never names the transport. Connect Instagram calls `GET https://zernio.com/api/v1/connect/instagram` with `welcome=false` and opens the returned Instagram login URL. That call is what to use when `ZERNIO_API_KEY` is set.

If the key is missing, the button cannot start the login. The page says "Instagram connection is not available right now. Contact Roleflow support." It does not link to a third-party dashboard. Set `ZERNIO_API_KEY` yourself (the key is created in the provider dashboard), then use Connect Instagram again.

The provider's hosted welcome screen is not white-label. `brandName`, `logoUrl`, and `welcomeTheme` only apply when `welcome=true`, and that page still shows the provider's mark. Headless mode is for platforms that need a selection step. The default Instagram login has no selection step. Instagram's own consent screen still names the provider's app. There is no API flag that hides that name, so the connect call keeps `welcome=false` and the browser is only given an `instagram.com` URL.

## What you turn on

Every agent defaults to off, including when the switch row is missing. Off is enforced in the send path, not only in the page.

- Lead Warmer and Outreacher open the client's own Grok Bot. The buttons stay disabled until `acquire/client-config.js` or `window.ROLEFLOW_GROK_URLS` has a real `https` URL. An empty string is a placeholder, not a connection.
- Agentic Setter cannot be turned on until the system prompt is saved and tried in the test panel. Turning any agent on asks for confirmation.
- Follow Up Boss queues a message only when its switch is on, the lead matches the saved stage and booking rule, quiet hours are clear, the 24-hour window is open, and the follow-up count is under the max. The same recovery key is used by the five-minute job and the acquisition tick, so one lead is not queued twice.
- A reply typed in Chats is a human message and still sends while the agents are off.

Language is stored per user in `acq_user_prefs` (`en` or `es`) and also in the browser under `roleflow.lang`.

## Setter prompt

The live setter prompt is `acq_agent_prompts.body`. Saving writes a row in `acq_agent_prompt_versions` (who, when, version) and clears `tested_at` when the text changes. Restoring an older version writes a new version with that same text. Neither save nor restore changes `acq_agent_switches`. The reply engine uses that saved body. Studio section text is not mixed in once a saved body exists. The output contract the engine needs is still appended.

`{{voice:name}}` inserts a Voice Gen note. The name is the note title, lowercased, with spaces turned into underscores. When a live setter reply contains that token, the engine attaches that recording on a normal DM. A comment private reply stays text-only, so the token is removed there and the note is not attached. `{{booking_link}}` expands to the business booking link. An empty link uses `https://calendar.app.google/R4wpQ4b8F5J7xnD39`. The practice thread on Agentic Setter is a simulated DM. It sends the whole conversation so far, with the draft in the editor as the system instruction. The draft starts as the saved prompt. A signed-in run uses the business model key when one is saved, otherwise the platform key. Each setter reply names the provider, the model, and which key answered. If the model call fails, the thread shows that error and does not invent a reply. Voice tokens render as audio. A connected business plays the stored Voice Gen file. The local preview has no stored file, so the player uses a short tone. Restart clears the thread. Scenarios are new follower, comment trigger, and cold reply. Each run shows the prompt version and the full prompt text. A practice run never calls Instagram. Gemini's default model is `gemini-3-flash-preview`.

## Comment voice

Comment voice is its own Agent Workforce switch. It defaults to off. A missing row is off. The webhook only queues it when that switch is on. A comment (`comment.received`) is classified against the business rules: keywords such as SYSTEM, SYSTEMS, and SISTEM, with Spanish and English folding and a small edit distance, plus a free-text intent. If a model key exists and the keywords do not match, the model may pick one of those intents. Every decision is stored in `acq_comment_voice_log`, matched or not, with the reason.

The daily cap defaults to 30 in Europe/Madrid. The same commenter is not queued twice. The same comment is not reviewed twice.

Zernio can send a private reply to a comment: `POST /v1/inbox/comments/{postId}/{commentId}/private-reply` with `accountId` and `message`. Instagram and Facebook only. One reply per comment. It must be within 7 days. The documented body has no audio field. A normal conversation message can carry `attachmentType: audio`, but that is not a comment private reply. Instagram can refuse attachments to someone who does not follow the account, and a refused private reply still consumes the comment's only reply. This agent therefore sends text only on the private-reply path, records the mapped voice note on the decision, and does not attach it. It does not message anyone who did not comment. ManyChat is not used.
