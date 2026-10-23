export const SYNC_INBOX = "roleflow+sync@mail.grokbot.com";
const QUIET_MS = 60000;

export function shouldClaim(rows, now) {
  const list = rows || [];
  if (!list.length) return false;
  return list.every((row) => {
    const created = new Date(row.created_at).getTime();
    return Number.isFinite(created) && now - created >= QUIET_MS;
  });
}

export function quietWaitMs(rows, now) {
  const list = rows || [];
  if (!list.length) return 0;
  const newest = Math.max(...list.map((row) => new Date(row.created_at).getTime()));
  if (!Number.isFinite(newest)) return QUIET_MS;
  return Math.min(QUIET_MS, Math.max(0, QUIET_MS - (now - newest)));
}

export function buildSyncNotice(rows) {
  const list = (rows || []).map((row) => ({
    id: String(row.id || "").trim(),
    op: String(row.op || row.kind || "").trim(),
    workspace_id: String(row.workspace_id || row.business_id || "").trim()
  })).filter((row) => row.id && row.op && row.workspace_id);
  const first = list[0] || { op: "sync" };
  const name = String((rows && rows[0] && (rows[0].business_name || rows[0].name)) || "business")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 80) || "business";
  return {
    to: SYNC_INBOX,
    subject: "Roleflow sync: " + first.op + " " + name,
    text: list.map((row) => row.id + " " + row.op + " " + row.workspace_id).join("\n")
  };
}

export async function postSyncNotice(mail, env) {
  const apiKey = env && env.apiKey || "";
  if (!apiKey || !mail || !mail.to || !mail.subject || !mail.text) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      from: (env && env.from) || "Roleflow <notifications@roleflow.io>",
      to: [mail.to],
      subject: mail.subject,
      text: mail.text
    })
  });
  return response.ok;
}

export async function flushSyncNotice(client, businessId, env, sleep) {
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const pending = await client.from("engine_outbox")
      .select("id, created_at")
      .eq("business_id", businessId)
      .eq("status", "pending")
      .is("notified_at", null)
      .order("created_at", { ascending: true })
      .limit(50);
    const rows = pending.data || [];
    if (!rows.length) return false;
    if (!shouldClaim(rows, Date.now())) {
      await wait(quietWaitMs(rows, Date.now()) + 250);
      continue;
    }
    const claimed = await client.rpc("acq_claim_sync_notice", { p_business: businessId });
    const items = Array.isArray(claimed.data) ? claimed.data : [];
    if (!items.length) continue;
    const mail = buildSyncNotice(items);
    const sent = await postSyncNotice(mail, env);
    if (!sent) {
      await client.rpc("acq_release_sync_notice", { p_ids: items.map((row) => row.id) });
      return false;
    }
    return true;
  }
  return false;
}
