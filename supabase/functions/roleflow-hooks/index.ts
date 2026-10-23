// Signed webhook tests use the caller's JWT.
// Conversions use a workspace API key. The signing secret is never returned.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  let body: { action?: string; webhook_id?: string; lead?: string; state?: string; email?: string; token?: string; business_id?: string } = {};
  try { body = await req.json(); } catch (_error) { body = {}; }
  if (body.action === "convert") return convert(req, body);
  if (body.action === "test") return testHook(req, body);
  if (body.action === "invite") return invite(req, body);
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
