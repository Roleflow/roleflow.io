# Comment CTAs

The CTAs page stores keywords, public reply lines, and an optional voice file. Matching a comment writes a held plan. It does not post the public reply and it does not send a DM.

Sending stays off while `acq_dm_controls.enabled` is false or `killed` is true. The plan's `hold_reason` is `dm_disabled` in that case. `sent` is always false in `workers/roleflow-dm/comment-cta.mjs`.

## What would need registering

Do not register this until Diego approves it.

1. An Instagram comment webhook for the business account, subscribed to comments on posts and reels.
2. A receiver that inserts one row per comment: business id, comment id, comment text, commenter handle, and the post or reel id.
3. The holder in `workers/roleflow-dm/comment-cta.mjs`, which writes `acq_comment_prepares` and does not deliver.
4. A later sender, still gated by the DM controls, the 5 to 30 minute wait, and a personalised draft. That sender is not in this change.

The publications grid that would list the account's posts is not connected. A keyword that should apply to one post stores the post or reel id the operator pastes.

Voice notes are uploaded or recorded into the existing private `acq-voice` bucket, under `<business id>/cta-<id>.<ext>`, at most 20 MB. There is no AI-generated voice on this screen.
