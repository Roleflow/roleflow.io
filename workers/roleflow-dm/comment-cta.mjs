// Turns a comment into a held plan. This file does not post a comment or send a DM.

import { prepareCommentPlan } from "../../acquire/comment-cta.js";

export async function holdComment(db, input) {
  const plan = prepareCommentPlan(input);
  if (!plan || plan.action === "ignore") return { sent: false, action: "ignore" };
  const source = input || {};
  const profile = source.profile || {};
  if (!db || !source.businessId) return { ...plan, sent: false, stored: false };
  const saved = await db.from("acq_comment_prepares").insert({
    business_id: source.businessId,
    cta_id: plan.cta_id,
    comment_id: String(source.commentId || "").slice(0, 200),
    commenter_handle: String(profile.handle || "").slice(0, 80),
    comment_text: String(source.comment || "").slice(0, 2000),
    publication_ref: String(source.publicationRef || "").slice(0, 200),
    public_reply: plan.public_reply || "",
    dm_plan: plan.dm || {},
    status: "held",
    hold_reason: plan.hold_reason || "",
    send_after: plan.send_after || null
  });
  return { ...plan, sent: false, stored: !saved.error };
}
