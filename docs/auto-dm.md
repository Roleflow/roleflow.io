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

Do not provision a new server or a paid host. One shared Linux computer runs two kinds of process:

1. **One login service for every workspace.** `node workers/roleflow-dm/login-service.mjs` listens on `127.0.0.1:8790` only. It is not started by the bots.
2. **One worker per workspace, under that workspace's Grok Bot.** `node workers/roleflow-dm/run.mjs <workspace-id> <prospect-handle>`. The bot starts only its own workspace. A new business needs no extra login setup: its control row is created with the workspace, and the first successful connect writes `$ROLEFLOW_DM_SESSION_DIR/<workspace-id>.bin` and `<workspace-id>.key`.

The login service checks a one-time link, opens Instagram in Playwright, and streams that page to the member's browser. Codes and challenges stay on that same page. When Instagram has finished login, the service encrypts the Playwright storage state with `openssl enc -aes-256-cbc -pbkdf2 -salt` and the workspace key file. It then sets `ig_handle` and `session_ready` on that workspace. It does not set `enabled`. Auto-DM stays off until someone turns it on in the panel.

Disconnect deletes that workspace's `.bin` file and clears `ig_handle` and `session_ready`. It does not change `enabled`.

Roleflow's workspace id is `840b08a9-869c-4650-8dc7-f78fdfa0e112`. Value Add Marketing's is `1351d2ac-79bb-545d-8da0-c49ecff28a47`.

Playwright in the worker starts only after `planDm` returns ready and that workspace's encrypted session is present. Leave `ROLEFLOW_DM_ENABLED` unset until that workspace should send. Set `ROLEFLOW_DM_KILL=1` to stop that process. On a block or a warning, set `ROLEFLOW_DM_PAUSED=1`. `/workers/` is not served by the public site.

## One-time setup

Diego does this once on the box. New workspaces do not need it again.

1. Install Node, OpenSSL, and cloudflared (the free Cloudflare tunnel client).
2. Outside this git repo, install the browser the service launches:

   ```
   sudo mkdir -p /opt/roleflow-dm /var/lib/roleflow/dm-sessions
   sudo chown "$USER" /opt/roleflow-dm /var/lib/roleflow/dm-sessions
   chmod 700 /var/lib/roleflow/dm-sessions
   cd /opt/roleflow-dm
   npm init -y
   npm install playwright
   npx playwright install --with-deps chromium
   ```

   Do not commit `package.json` or `node_modules`.

3. Put the service environment in a file on the box that is not in git. `SUPABASE_URL` is the project URL. `SUPABASE_SERVICE_ROLE_KEY` stays only on this computer. `ROLEFLOW_DM_SESSION_DIR=/var/lib/roleflow/dm-sessions`. `ROLEFLOW_DM_PLAYWRIGHT_ROOT=/opt/roleflow-dm`. `ROLEFLOW_DM_LOGIN_HOST=127.0.0.1`. `ROLEFLOW_DM_LOGIN_PORT=8790`. Do not set `DEBUG`.
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

Each Grok Bot, when that business has turned auto-DM on, runs only its own worker with the same `ROLEFLOW_DM_SESSION_DIR`.

## Security trade-off

Keystrokes have to reach the Chrome process on the box or Instagram cannot receive them. They travel over the HTTPS tunnel into the login service and then into Chrome, in memory, for that short-lived link. They are not stored, not written to logs, not saved as screenshots, and not sent to Roleflow's database. The database stores the SHA-256 of the link, the public tunnel origin, the Instagram handle, and `session_ready`. The session file and its key stay on the box.

Someone who can read the login service's memory during those 10 minutes could see what was typed. The box is not reachable except through the tunnel, and the link only exists for members who can edit that business. The live picture shows Instagram's page; Instagram masks its own secret field. The frames are not written to disk.
