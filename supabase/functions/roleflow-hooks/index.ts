// Signed webhook tests use the caller's JWT.
// Conversions use a workspace API key. The signing secret is never returned.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { clientReplyView, completeChat, loadSetterReply, logLlmError } from "../_shared/llm-provider.js";
import { flushSyncNotice, loadResendConfig, sendSyncNotice, SYNC_INBOX } from "../_shared/sync-notice.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  let body: { action?: string; webhook_id?: string; lead?: string; state?: string; email?: string; token?: string; business_id?: string; request_id?: string; message?: string; sections?: Record<string, string> } = {};
  try { body = await req.json(); } catch (_error) { body = {}; }
  if (body.action === "convert") return convert(req, body);
  if (body.action === "test") return testHook(req, body);
  if (body.action === "invite") return invite(req, body);
  if (body.action === "notify_connect") return notifyConnect(req, body);
  if (body.action === "notify_sync") return notifySync(req, body);
  if (body.action === "sync_test") return syncTest(req);
  if (body.action === "prompt_test") return promptTest(req, body);
  return json(400, { error: "Unknown action." });
});

async function testHook(req: Request, body: { webhook_id?: string }) {
  const userClient = userClientFrom(req);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(401, { error: "Sign in required." });
  const prepared = await userClient.rpc("acq_prepare_webhook_test", { p_webhook: body.webhook_id });
  if (prepared.error) return json(400, { error: prepared.error.message });
  const url = String(prepared.data.url || "");
  if (!safeUrl(url)) return json(400, { error: "That webhook URL is not allowed." });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-roleflow-signature": String(prepared.data.signature || "")
    },
    body: String(prepared.data.body || "")
  }).catch((error) => error);
  if (response instanceof Error) return json(502, { error: "The webhook did not answer." });
  return json(200, { status: response.status });
}

async function convert(req: Request, body: { lead?: string; state?: string }) {
  const header = req.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token.startsWith("rfw_") || token.length < 20) return json(401, { error: "A workspace key is required." });
  const state = body.state === "Paid" ? "paid" : body.state === "Booked" ? "booked" : "";
  if (!state) return json(400, { error: "Choose Booked or Paid." });
  if (!/^[0-9a-f-]{36}$/i.test(String(body.lead || ""))) return json(400, { error: "The lead id is missing." });
  const admin = adminClient();
  const hash = await sha256(token);
  const key = await admin.from("acq_api_keys").select("id, business_id, revoked_at").eq("token_hash", hash).maybeSingle();
  if (key.error || !key.data || key.data.revoked_at) return json(401, { error: "That key is not active." });
  const lead = String(body.lead);
  const businessId = key.data.business_id;
  const contact = await admin.from("acq_contacts").update({ crm_state: state }).eq("id", lead).eq("business_id", businessId).select("id");
  if (contact.data && contact.data.length) return json(200, { ok: true, state });
  const target = await admin.from("acq_targets").update({ crm_state: state }).eq("id", lead).eq("agent_id", businessId).select("id");
  if (target.data && target.data.length) return json(200, { ok: true, state });
  return json(404, { error: "That lead was not found for this key." });
}

async function invite(req: Request, body: { email?: string; token?: string; business_id?: string }) {
  const userClient = userClientFrom(req);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(401, { error: "Sign in required." });
  const resend = Deno.env.get("RESEND_API_KEY") || "";
  if (!resend) return json(200, { error: "Email sending is not configured yet. Share the link." });
  const link = "https://www.roleflow.io/signup/?invite=" + encodeURIComponent(String(body.token || ""));
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + resend, "content-type": "application/json" },
    body: JSON.stringify({
      from: "Roleflow <notifications@roleflow.io>",
      to: [String(body.email || "")],
      subject: "You are invited to a Roleflow business",
      text: "Open this link to join: " + link
    })
  });
  if (!response.ok) return json(200, { error: "The invite is saved. The email was not sent." });
  return json(200, { emailed: true });
}

async function notifyConnect(req: Request, body: { request_id?: string }) {
  const userClient = userClientFrom(req);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(401, { error: "Sign in required." });
  const id = String(body.request_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "That connection request was not found." });
  const row = await userClient.from("acq_channel_connect_requests").select("id, workspace_id, username, status").eq("id", id).maybeSingle();
  if (row.error || !row.data) return json(404, { error: "That connection request was not found." });
  const admin = adminClient();
  const workspace = await admin.from("acq_workspaces").select("name").eq("id", row.data.workspace_id).maybeSingle();
  const name = workspace.data && workspace.data.name ? String(workspace.data.name) : "A business";
  const handle = String(row.data.username || "").replace(/[^a-z0-9._]/gi, "");
  const resend = Deno.env.get("RESEND_API_KEY") || "";
  if (!resend) return json(200, { emailed: false, error: "Email sending is not configured yet." });
  const from = Deno.env.get("RESEND_FROM") || "Roleflow <notifications@roleflow.io>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + resend, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to: ["diego@roleflow.io"],
      subject: "Instagram connection waiting",
      text: name + " asked to connect @" + handle + ".\n\nFinish it in the Roleflow admin businesses list.\n"
    })
  });
  if (!response.ok) return json(200, { emailed: false, error: "The connection is saved. The email was not sent." });
  return json(200, { emailed: true });
}

async function notifySync(req: Request, body: { business_id?: string }) {
  const userClient = userClientFrom(req);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(401, { error: "Sign in required." });
  const businessId = String(body.business_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) return json(400, { error: "That business was not found." });
  const allowed = await userClient.rpc("acq_can_edit", { p_workspace: businessId });
  if (allowed.error || allowed.data !== true) return json(403, { error: "You can't edit this business." });
  const admin = adminClient();
  const notice = flushSyncNotice(admin, businessId, resendEnv());
  const edge = (globalThis as { EdgeRuntime?: { waitUntil?: (task: Promise<unknown>) => void } }).EdgeRuntime;
  if (edge && edge.waitUntil) edge.waitUntil(notice);
  else notice.catch(() => {});
  return json(200, { ok: true, queued: true });
}

async function promptTest(req: Request, body: { business_id?: string; message?: string; sections?: Record<string, string> }) {
  const userClient = userClientFrom(req);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(401, { error: "Sign in required." });
  const businessId = String(body.business_id || "");
  const allowed = await userClient.rpc("acq_can_edit", { p_workspace: businessId });
  if (allowed.error || allowed.data !== true) return json(403, { error: "You can't edit this business." });
  const message = String(body.message || "").trim().slice(0, 800);
  if (!message) return json(400, { error: "Write a test message." });
  const fallback = "Test only. Nothing was sent to a lead.";
  const admin = adminClient();
  const env = Deno.env.toObject();
  const loaded = await loadSetterReply(admin, businessId, env);
  if (!loaded.chain.length) return json(200, clientReplyView({ ok: true, reply: fallback, sent: false }));
  const sections = body.sections && typeof body.sections === "object" ? body.sections : {};
  const system = "This is a private test of a setter. Nothing you write is sent to a lead or to Instagram. Reply in one short message, in the setter's voice.\n\n" +
    Object.entries(sections).map(([name, text]) => name + "\n" + String(text || "").slice(0, 3000)).join("\n\n");
  let notice = "";
  try {
    loaded.chain.forEach((step) => {
      if (step.provider === "xai") step.endpoint = "https://api.x.ai/v1/chat/completions";
    });
    const result = await completeChat({
      chain: loaded.chain,
      system,
      messages: [{ role: "user", content: message }],
      temperature: 0.4,
      maxTokens: 300,
      onError: async (info) => {
        const authNotice = info.auth && info.source === "own";
        await logLlmError(admin, {
          businessId,
          purpose: "setter",
          ...info,
          message: authNotice ? "This business's Claude API key was rejected. Fell back to the next model." : info.message
        });
        if (authNotice) notice = "This business's Claude API key was rejected. The setter used the next model.";
      }
    });
    const reply = String(result.text || "").trim();
    if (!reply) return json(200, clientReplyView({ ok: true, reply: fallback, sent: false, notice }));
    return json(200, clientReplyView({
      ok: true,
      reply: reply.slice(0, 800),
      sent: false,
      notice,
      provider: result.provider,
      model: result.model,
      fell_back: result.fellBack === true,
      usage: result.usage || undefined
    }, loaded.chain.map((step) => step.apiKey)));
  } catch (_error) {
    return json(200, clientReplyView({ ok: true, reply: fallback, sent: false }));
  }
}

async function syncTest(req: Request) {
  const admin = adminClient();
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const stored = await admin.rpc("acq_read_cron_secret");
  const secret = !stored.error && typeof stored.data === "string" ? stored.data : "";
  if (!timingSafeEqual(bearer, secret)) return json(401, { error: "Unauthorized." });
  const config = await loadResendConfig(admin, resendEnv());
  const result = await sendSyncNotice({
    to: SYNC_INBOX,
    subject: "Roleflow sync: test",
    text: "Configuration check. No outbox id."
  }, config);
  return json(200, { ok: true, sent: result.ok, status: result.status });
}

function resendEnv() {
  return {
    apiKey: Deno.env.get("RESEND_API_KEY") || "",
    from: Deno.env.get("RESEND_FROM") || ""
  };
}

function timingSafeEqual(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (!left.length || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function userClientFrom(req: Request) {
  return createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_ANON_KEY") || "", {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } }
  });
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
}

function safeUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host === "metadata.google.internal") return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0)/.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
  return true;
}

async function sha256(value: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}
