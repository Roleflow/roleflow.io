# Follow-to-DM

Each business has its own control row. It starts off. The kill switch and the daily cap belong to that workspace. Roleflow and Value Add Marketing both get a row, and a new business gets one when its workspace is created.

A DM is allowed only when all of these are true:

- That workspace's opt-in is on and its kill switch is off.
- There is no block or warning pause.
- The handle is not on that workspace's exclusion list, has not been messaged by that workspace, and has not said stop.
- Fewer than that workspace's daily cap have been sent today. The default cap is 20. The maximum is 50.
- The clock in Madrid is from 09:00 to 21:00.
- At least 5 minutes, and at most 30, have passed since the follow or like. The wait is random.
- The person's public profile could be read (name, bio, category, or a recent post).
- Claude Sonnet (`claude-sonnet-5-5`) wrote a new opener from that profile, the setter prompt, and the SOP playbook. The request does not send a temperature. The platform key is `ANTHROPIC_API_KEY`. A business key, when one is saved, is used first by the same order as setter replies.
- The draft is not too similar to recent sends from that workspace.
- The opener has no price and no commission.

The sent text is stored with the workspace and the handle. A fixed template is never sent.

The Instagram password is never stored. The panel has no password field. The person types only on Instagram's own page inside a remote browser. Roleflow keeps the encrypted session for that workspace and nothing else.

The Instagram connection used for setter replies is a different path. This login does not change it.

## What runs on the box

Do not provision a new server or a paid host. One shared Linux computer runs two kinds of process. Both use the same session directory.

1. **One login service for every workspace.** `node workers/roleflow-dm/login-service.mjs` listens on `127.0.0.1:8790` only. It is not started by the bots.
2. **One long-running worker per workspace, under that workspace's Grok Bot.** `node workers/roleflow-dm/run.mjs <workspace-id>`. No recipient argument. The process wakes about every 3 minutes. A second start while the first is alive exits, so it is safe to launch it every few minutes as well.

Roleflow's workspace id is `840b08a9-869c-4650-8dc7-f78fdfa0e112`. Value Add Marketing's is `1351d2ac-79bb-545d-8da0-c49ecff28a47`.

```
node workers/roleflow-dm/run.mjs 840b08a9-869c-4650-8dc7-f78fdfa0e112
node workers/roleflow-dm/run.mjs 1351d2ac-79bb-545d-8da0-c49ecff28a47
```

Each tick, when that workspace's panel switch is on and its kill switch is off, the worker uses that workspace's session to read the latest followers and the likers of the latest posts. The first successful read is a baseline: those people are remembered and are not messaged. Someone who shows up on a later tick is new. The worker reads their public profile, asks Claude Sonnet (`claude-sonnet-5-5`, no temperature) for an opener, and sends only when `planDm` allows it. The business Claude key is used when one is saved; otherwise `ANTHROPIC_API_KEY` is used. The send is written to `acq_dm_sends`. A restart keeps the same wait and does not message that person again.

Sending needs the panel switch (`acq_dm_controls.enabled`) and a session file. It does not need a second environment flag. `ROLEFLOW_DM_KILL=1` stops that process. A block sets `paused_reason` and the worker stops opening Instagram until that is cleared.

`supabase/migrations/20261028160000_roleflow_auto_dm.sql` is already applied in production (Supabase version `20261028150149`). Do not run that file again. Apply `20261028170000_dm_every_business.sql` if `acq_dm_sends` is not in the database yet, and apply `20261028190000_dm_instagram_login.sql` before the connect button can store a handle. This repo does not apply them.

The login service checks a one-time link, opens Instagram in Playwright, and streams that page to the member's browser. Codes and challenges stay on that same page. When Instagram has finished login, the service encrypts the Playwright storage state and creates `<workspace-id>.key` if that file is missing. It sets `ig_handle` and `session_ready`. It does not set `enabled`. Disconnect deletes that workspace's `.bin` file and clears `ig_handle` and `session_ready`. `/workers/` is not served by the public site.

## Session directory

The only directory is `/opt/roleflow-dm/sessions`. Set `ROLEFLOW_DM_SESSION_DIR` to that path for the login service and for every worker.

Each workspace has two files, mode 600:

- `<workspace-id>.bin` — encrypted Playwright storage state (`openssl enc -aes-256-cbc -pbkdf2 -salt`)
- `<workspace-id>.key` — the key for that file. The login service creates it on the first connect when it is missing.

The worker also writes `<workspace-id>.feed.json` and `<workspace-id>.lock` in that directory so a restart keeps the baseline, the wait, and a single sender. Those files are mode 600. They do not contain a session or a key.

Move the sessions the bots already have. Stop the old workers first.

Value Add Marketing, from `/workspace/roleflow-dm/vam/session/`:

```
mkdir -p /opt/roleflow-dm/sessions
chmod 700 /opt/roleflow-dm/sessions
# encrypted state -> the .bin, key text -> the .key
cp /workspace/roleflow-dm/vam/session/<session-file> /opt/roleflow-dm/sessions/1351d2ac-79bb-545d-8da0-c49ecff28a47.bin
cp /workspace/roleflow-dm/vam/session/<key-file> /opt/roleflow-dm/sessions/1351d2ac-79bb-545d-8da0-c49ecff28a47.key
chmod 600 /opt/roleflow-dm/sessions/1351d2ac-79bb-545d-8da0-c49ecff28a47.bin /opt/roleflow-dm/sessions/1351d2ac-79bb-545d-8da0-c49ecff28a47.key
```

Roleflow, from `/workspace/roleflow-dm/roleflow/.dm/sessions/`:

```
cp /workspace/roleflow-dm/roleflow/.dm/sessions/<session-file> /opt/roleflow-dm/sessions/840b08a9-869c-4650-8dc7-f78fdfa0e112.bin
cp /workspace/roleflow-dm/roleflow/.dm/sessions/<key-file> /opt/roleflow-dm/sessions/840b08a9-869c-4650-8dc7-f78fdfa0e112.key
chmod 600 /opt/roleflow-dm/sessions/840b08a9-869c-4650-8dc7-f78fdfa0e112.bin /opt/roleflow-dm/sessions/840b08a9-869c-4650-8dc7-f78fdfa0e112.key
```

If an old file is plain Playwright JSON, encrypt it and do not leave the plain file in place. `ROLEFLOW_DM_SESSION_KEY` is the contents of the `.key` file:

```
openssl enc -aes-256-cbc -pbkdf2 -salt \
  -in state.json \
  -out /opt/roleflow-dm/sessions/<workspace-id>.bin \
  -pass env:ROLEFLOW_DM_SESSION_KEY
rm state.json
```

Confirm with `openssl enc -d -aes-256-cbc -pbkdf2 -in <workspace-id>.bin -pass env:ROLEFLOW_DM_SESSION_KEY`. Then point the login service and both bots at `ROLEFLOW_DM_SESSION_DIR=/opt/roleflow-dm/sessions`.

## One-time setup

Diego does this once on the box. New workspaces do not need it again.

1. Install Node, OpenSSL, and cloudflared (the free Cloudflare tunnel client).
2. Outside this git repo, install the browser the service launches:

   ```
   sudo mkdir -p /opt/roleflow-dm/sessions
   sudo chown "$USER" /opt/roleflow-dm /opt/roleflow-dm/sessions
   chmod 700 /opt/roleflow-dm/sessions
   cd /opt/roleflow-dm
   npm init -y
   npm install playwright
   npx playwright install --with-deps chromium
   ```

   Do not commit `package.json` or `node_modules`.

3. Put the service environment in a file on the box that is not in git. `SUPABASE_URL` is the project URL. `SUPABASE_SERVICE_ROLE_KEY` stays only on this computer. `ROLEFLOW_DM_SESSION_DIR=/opt/roleflow-dm/sessions`. `ROLEFLOW_DM_PLAYWRIGHT_ROOT=/opt/roleflow-dm`. `ROLEFLOW_DM_LOGIN_HOST=127.0.0.1`. `ROLEFLOW_DM_LOGIN_PORT=8790`. `ANTHROPIC_API_KEY` is the fallback Claude key for openers. Do not set `DEBUG`. The same file is what each worker bot loads.
4. Run the login service from a checkout of this repo so the worker files resolve. Example systemd unit:

   ```
   [Service]
   WorkingDirectory=/opt/roleflow
   EnvironmentFile=/etc/roleflow-dm.env
   ExecStart=/usr/bin/node /opt/roleflow/workers/roleflow-dm/login-service.mjs
   Restart=on-failure
   ```

   If Instagram refuses the headless browser, run it under `xvfb-run -a` and set `ROLEFLOW_DM_LOGIN_HEADED=1`.
5. Open a tunnel to that localhost port. A free named cloudflared tunnel is enough:

   ```
   cloudflared tunnel login
   cloudflared tunnel create roleflow-ig-login
   cloudflared tunnel route dns roleflow-ig-login ig-login.example.com
   cloudflared tunnel run --url http://127.0.0.1:8790 roleflow-ig-login
   ```

   The hostname must be HTTPS. Leave cloudflared's log level quiet so the one-time link is less likely to land in a tunnel log. An SSH reverse tunnel is the other free option. Do not open port 8790 on the public internet.
6. After the auto-DM login migration is applied, set the origin once in the SQL editor:

   ```
   update public.acq_dm_login_config
   set public_origin = 'https://ig-login.example.com'
   where id = 1;
   ```

   Use the real tunnel hostname. This is the only one-time database step. Members of a business can then click Connect Instagram for auto-DMs. The panel mints a link that expires in 10 minutes or when login succeeds, whichever comes first.

Each Grok Bot runs only its own `run.mjs <workspace-id>` with that same `ROLEFLOW_DM_SESSION_DIR`. The panel switch is what allows sending.

## Security trade-off

Keystrokes have to reach the Chrome process on the box or Instagram cannot receive them. They travel over the HTTPS tunnel into the login service and then into Chrome, in memory, for that short-lived link. They are not stored, not written to logs, not saved as screenshots, and not sent to Roleflow's database. The database stores the SHA-256 of the link, the public tunnel origin, the Instagram handle, and `session_ready`. The session file and its key stay on the box.

Someone who can read the login service's memory during those 10 minutes could see what was typed. The box is not reachable except through the tunnel, and the link only exists for members who can edit that business. The live picture shows Instagram's page; Instagram masks its own secret field. The frames are not written to disk.
