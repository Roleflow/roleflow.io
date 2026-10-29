// Sends one reply on a chat the caller can edit. The key stays on the server.

import { API_BASE } from "../_shared/ig-gateway.js";
import { manualSendError, manualSendRequest } from "../_shared/inbox-send.js";
import { adminClient, cors, json, loadGatewayConfig, userClientFrom } from "../_shared/gateway-http.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST." });
  const userClient = userClientFrom(req);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(401, { ok: false, error: "Sign in required." });
  let body: { business_id?: string; contact_id?: string; text?: string; message_id?: string } = {};
  try { body = await req.json(); } catch (_error) { body = {}; }
  const businessId = String(body.business_id || "");
  const contactId = String(body.contact_id || "");
  const text = String(body.text || "").trim();
  if (!UUID.test(businessId) || !UUID.test(contactId)) return json(400, { ok: false, error: "That chat was not found." });
  if (!text) return json(400, { ok: false, error: "Write a reply first." });
  const allowed = await userClient.rpc("acq_can_edit", { p_workspace: businessId });
  if (allowed.error || allowed.data !== true) return json(403, { ok: false, error: "You can't edit this business." });
  const admin = adminClient();
  const config = await loadGatewayConfig(admin);
  if (!config.apiKey) return json(200, { ok: false, error: "Instagram is not connected yet." });
  const account = await admin.from("ig_gateway_accounts").select("account_id, status").eq("business_id", businessId).eq("status", "connected").maybeSingle();
  if (account.error || !account.data || !account.data.account_id) return json(200, { ok: false, error: "Instagram is not connected yet." });
  const conversation = await admin.from("acq_conversations").select("id, external_id").eq("business_id", businessId).eq("contact_id", contactId).maybeSingle();
  if (conversation.error || !conversation.data || !conversation.data.external_id) return json(200, { ok: false, error: "This chat has no Instagram thread yet." });
  const request = manualSendRequest({
    accountId: account.data.account_id,
    conversationId: conversation.data.external_id,
    text
  });
  let response: Response;
  try {
    response = await fetch(API_BASE + request.path, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + config.apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request.body)
    });
  } catch (_error) {
    const stored = await storeHumanReply(admin, {
      businessId,
      conversationId: conversation.data.id,
      messageId: String(body.message_id || ""),
      text,
      status: "failed"
    });
    return json(200, { ok: false, error: "The reply was not sent.", message_id: stored.id || "" });
  }
  let payload: unknown = {};
  try { payload = await response.json(); } catch (_error) { payload = {}; }
  const failure = manualSendError(response.status, payload);
  const messageId = String(body.message_id || "");
  const stored = await storeHumanReply(admin, {
    businessId,
    conversationId: conversation.data.id,
    messageId,
    text,
    status: failure ? "failed" : "sent"
  });
  if (failure) return json(200, { ok: false, error: failure, message_id: stored.id || "" });
  if (!stored.ok) return json(200, { ok: false, error: "The reply was sent, but the chat copy was not stored.", message_id: stored.id || "" });
  return json(200, { ok: true, message_id: stored.id || "" });
});

async function storeHumanReply(admin: ReturnType<typeof adminClient>, input: { businessId: string; conversationId: string; messageId: string; text: string; status: "sent" | "failed" }) {
  const stamp = new Date().toISOString();
  const row = {
    business_id: input.businessId,
    conversation_id: input.conversationId,
    external_id: ("manual:" + crypto.randomUUID()).slice(0, 200),
    role: "assistant",
    sender: "human",
    body: input.text.slice(0, 4000),
    sent_at: stamp,
    delivery_status: input.status
  };
  if (UUID.test(input.messageId)) {
    const updated = await admin.from("acq_messages").update({
      body: row.body,
      sender: "human",
      sent_at: stamp,
      delivery_status: input.status
    }).eq("id", input.messageId).eq("business_id", input.businessId).select("id").maybeSingle();
    if (!updated.error && updated.data) return { ok: true, id: updated.data.id };
  }
  let saved = await admin.from("acq_messages").insert(row).select("id").maybeSingle();
  if (saved.error && /delivery_status/.test(saved.error.message || "")) {
    const { delivery_status: _status, ...without } = row;
    saved = await admin.from("acq_messages").insert(without).select("id").maybeSingle();
  }
  return { ok: !saved.error, id: saved.data && saved.data.id ? saved.data.id : "" };
}
