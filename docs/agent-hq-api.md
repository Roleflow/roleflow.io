# Agentic HQ API

Diego manages agents in the admin UI at `/admin/hq/`. The isometric office is the main view there, filling the area beside the sidebar, and it reads the same tables (agents, tasks, comments, and the Needs Diego queue). `/admin/office` redirects to `/admin/hq`. Three.js loads only when that office view opens. Each agent can also call this HTTP API with its own key to read its queue and post drafts back.

Nothing in this API sends email, DMs, or social posts. Task results are drafts for Diego. Approving or rejecting a `needs_diego` item is admin-only and stays inside Agentic HQ.

## Tables

The `hq_` prefix keeps these tables away from TailorTalk setters (`tailortalk_agents`) and client setters.

| UI name | Table |
| --- | --- |
| Agents | `public.hq_agents` |
| Tasks | `public.hq_tasks` |
| Task comments | `public.hq_task_comments` |
| Schedules | `public.hq_schedules` |
| Activity | `public.hq_activity` |
| Key prefix (no secret) | `public.hq_agent_keys` |
| Key hash | `private.hq_agent_key_secrets` |

Row level security allows only `public.is_admin()` (the `public.admins` table, not a user-metadata flag). Agents do not use the anon key to write rows. They call the edge function, which uses the service role and `hq_agent_dispatch`.

## Deploy

Apply migrations in filename order. Agent HQ depends on `public.is_admin()` from `20261010120000_roleflow_accounts.sql` and should run after `20261015120000_businesses.sql`.

1. Apply `supabase/migrations/20261016180000_agent_hq.sql` to the Roleflow Client Portal project (`xrsipofgofvjiskmsgij`). The file is idempotent: a second run does not duplicate the seeded roster, tasks, or schedules, and it does not reset rows that were edited later.
2. Deploy the edge function `supabase/functions/agent-hq` with `verify_jwt = false` (already set in `supabase/config.toml`). The agent key is not a user JWT. The function hashes `X-Agent-Key` and calls `hq_agent_dispatch`.
3. No new secrets are committed. The function reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, which Supabase injects. Do not put the service role key, or any `rfhq_` agent key, in the repo or the client.
4. The browser keeps using the publishable key in `supabase/config.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`). Callers of this API send that same publishable key in the `apikey` header so the gateway accepts the request. It does not authorize the agent. `X-Agent-Key` does.
5. The migration adds the HQ tables to the `supabase_realtime` publication when that publication exists. The admin UI subscribes with the logged-in admin session.
6. Diego issues a key from **Agents → Edit → Issue API key**. The plaintext is shown once. Only a SHA-256 hash is stored. Issuing a new key revokes the previous active key. Revoke from the same screen.

The live roster is Roleflow Agent, Lead Gen Manager, Outbound Rep, Content Generator, Onboarding & Client Success, and Ads Manager (paused). Older bots stay in the tables as retired so their tasks and history remain, and Agentic HQ hides them. Website Buildeer and Loom Outreacher were notes, not separate rows.

## Call the API

```bash
export SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
export SUPABASE_ANON_KEY="YOUR_PUBLISHABLE_KEY"
export AGENT_API_KEY="rfhq_..."   # issued in Agentic HQ, never commit this
```

`AGENT_API_KEY` looks like `rfhq_` plus 64 hex characters. Send it only in `X-Agent-Key`.

```bash
curl -sS "$SUPABASE_URL/functions/v1/agent-hq" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Agent-Key: $AGENT_API_KEY" \
  -d '{"action":"list"}'
```

Success responses include `"ok": true`. Failures use an HTTP status and `{"error":"..."}`. Keys are stripped from error text.

### list

Open tasks for this agent (`queued`, `in_progress`, `blocked`, `needs_diego`). Pass `status` to include one status, including `done`. Each task includes `estimate_minutes` and `started_at` when they are set. The office uses those fields for the progress bar. The bar is elapsed time divided by the estimate, and it stops at 95% until the task status is `done`.

```bash
curl -sS "$SUPABASE_URL/functions/v1/agent-hq" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Agent-Key: $AGENT_API_KEY" \
  -d '{"action":"list","status":"queued"}'
```

### schedules

Enabled schedules only.

```bash
curl -sS "$SUPABASE_URL/functions/v1/agent-hq" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Agent-Key: $AGENT_API_KEY" \
  -d '{"action":"schedules"}'
```

### timing

Set how long the current task should take, and when the agent started it. This does not change `status`. Send `estimate_minutes` (an integer from 1 to 480, or `null` to clear it), `started_at` (an ISO timestamp, or `null` to clear it), or both. At least one of the two fields is required.

```bash
curl -sS "$SUPABASE_URL/functions/v1/agent-hq" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Agent-Key: $AGENT_API_KEY" \
  -d '{"action":"timing","task_id":"TASK_UUID","estimate_minutes":25,"started_at":"2026-10-17T05:00:00Z"}'
```

A successful response includes the stored `estimate_minutes` and `started_at`.

### status

Move a task this agent owns. Allowed: `queued`, `in_progress`, `blocked`, `done`. Use `needs_diego` to ask Diego. Agents cannot set `approved` or `rejected`.

```bash
curl -sS "$SUPABASE_URL/functions/v1/agent-hq" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Agent-Key: $AGENT_API_KEY" \
  -d '{"action":"status","task_id":"TASK_UUID","status":"in_progress"}'
```

### output

Save a draft result. Optional `status` uses the same allowed values as `status` (not `needs_diego`).

```bash
curl -sS "$SUPABASE_URL/functions/v1/agent-hq" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Agent-Key: $AGENT_API_KEY" \
  -d '{"action":"output","task_id":"TASK_UUID","result":"Draft for Diego. Not sent.","status":"in_progress"}'
```

### comment

Add a thread message as the agent.

```bash
curl -sS "$SUPABASE_URL/functions/v1/agent-hq" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Agent-Key: $AGENT_API_KEY" \
  -d '{"action":"comment","task_id":"TASK_UUID","body":"Waiting on the Meta ad account."}'
```

### needs_diego

Ask Diego a question. Sets the task to `needs_diego` and `decision` to `pending`. `question` is required. Optional `result` stores a draft alongside it.

```bash
curl -sS "$SUPABASE_URL/functions/v1/agent-hq" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Agent-Key: $AGENT_API_KEY" \
  -d '{"action":"needs_diego","task_id":"TASK_UUID","question":"Ship the homepage draft?"}'
```

Diego answers in the Needs Diego inbox (one item, or a numbered batch such as `1 yes`). That writes the decision and a comment. It does not email or message anyone.

## Errors

| HTTP | Meaning |
| --- | --- |
| 401 | Missing, malformed, revoked, or unknown `X-Agent-Key`, or the agent is retired |
| 400 | Unknown action or status, invalid task id, empty comment or question, or an estimate outside 1 to 480 minutes |
| 404 | Task is not this agent's |
| 405 | Not a POST |

An agent only sees its own tasks and enabled schedules. It cannot list other agents, issue keys, or approve its own questions.
