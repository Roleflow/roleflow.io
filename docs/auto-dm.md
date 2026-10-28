# Follow-to-DM for @roleflow.io

This module is off until someone turns it on. The kill switch stops it immediately. It only runs for Instagram `@roleflow.io`. Other businesses see a locked page.

A DM is allowed only when all of these are true:

- The account is `@roleflow.io`.
- The opt-in is on and the kill switch is off.
- There is no block or warning pause.
- The handle is not on the exclusion list, has not been messaged before, and has not said stop.
- Fewer than the daily cap have been sent today. The default cap is 20. The maximum is 50.
- The clock in Madrid is from 09:00 to 21:00.
- At least 30 minutes, and at most 240, have passed since the follow or like. The wait is random.
- The opener has no price and no commission. `{hi|hey}` picks one alternative.

The Instagram password is never stored. The panel does not ask for it.

## Hosting

Do not provision a new server. Run `workers/roleflow-dm/run.mjs` on a computer you already use.

1. Log into Instagram as `@roleflow.io` in a local Playwright browser and save the storage state. Do not put the password in the command, a file, or the database.
2. Encrypt that file with `openssl enc -aes-256-cbc -pbkdf2 -salt` and the key in `ROLEFLOW_DM_SESSION_KEY`. Keep the key off git.
3. Point `ROLEFLOW_DM_SESSION_FILE` at the encrypted file.
4. Set `ROLEFLOW_DM_ACCOUNT=roleflow.io`. Leave `ROLEFLOW_DM_ENABLED` unset until you want a send. Set `ROLEFLOW_DM_KILL=1` to stop.
5. On a block or a warning, set `ROLEFLOW_DM_PAUSED=1` and leave it there. The worker exits before opening Instagram when any gate fails.

Playwright is started only after `planDm` returns ready and the encrypted session file is present. This repo does not install Playwright and does not open a paid host.
