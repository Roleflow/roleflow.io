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

The Instagram password is never stored. The panel has no password field.

## Hosting

Do not provision a new server. Run one `workers/roleflow-dm/run.mjs` process per workspace on a computer you already use.

1. Create a directory that is not in git. Set `ROLEFLOW_DM_SESSION_DIR` to it.
2. For each workspace, log into that business's Instagram in a local Playwright browser and save the storage state. Do not put the password in the command, a file in git, or the database.
3. Encrypt that state to `$ROLEFLOW_DM_SESSION_DIR/<workspace-id>.bin` with `openssl enc -aes-256-cbc -pbkdf2 -salt`. Put the key only in `$ROLEFLOW_DM_SESSION_DIR/<workspace-id>.key`.
4. Roleflow's workspace id is `840b08a9-869c-4650-8dc7-f78fdfa0e112`. Value Add Marketing's is `1351d2ac-79bb-545d-8da0-c49ecff28a47`.
5. Start the worker with the workspace id: `node workers/roleflow-dm/run.mjs <workspace-id> <handle>`. Leave `ROLEFLOW_DM_ENABLED` unset until that workspace should send. Set `ROLEFLOW_DM_KILL=1` to stop that process.
6. On a block or a warning, set `ROLEFLOW_DM_PAUSED=1` and leave it there. The worker exits before opening Instagram when any gate fails.

Playwright starts only after `planDm` returns ready and that workspace's encrypted session is present. This repo does not install Playwright and does not open a paid host. `/workers/` is not served by the public site.
