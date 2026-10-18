// Invite, resend, and revoke business members.
//
// The caller must be an admin or the business owner. Tokens are hashed into
// private.business_invite_secrets. The email is the only place the raw token
// appears. verify_jwt stays on. Do not deploy from the repo.
//
// Secrets: RESEND_API_KEY and RESEND_FROM. No new TailorTalk secret.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const SITE = "https://www.roleflow.io";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { error: "Supabase URL or keys are missing in the function environment." });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const userRes = await userClient.auth.getUser();
  const caller = userRes.data.user;
  if (!caller) return json(401, { error: "Sign in required." });

  let body: { action?: string; agent_id?: string; member_id?: string; email?: string; role?: string } = {};
  try {
    body = await req.json();
  } catch (_error) {
    body = {};
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const action = String(body.action || "");
  if (action === "invite") return invite(userClient, admin, caller.id, body);
  if (action === "resend") return resend(userClient, admin, body);
  if (action === "revoke") return revoke(userClient, admin, body);
  return json(400, { error: "Unknown action." });
});

async function invite(userClient, admin, callerId: string, body) {
  const agentId = String(body.agent_id || "");
  const email = String(body.email || "").trim().toLowerCase();
  const role = body.role === "editor" ? "editor" : body.role === "viewer" ? "viewer" : "";
  if (!/^[0-9a-f-]{36}$/i.test(agentId)) return json(400, { error: "Business not found." });
  if (!/^\S+@\S+\.\S+$/.test(email)) return json(400, { error: "Enter a valid email address." });
  if (!role) return json(400, { error: "Choose Viewer or Editor." });
  const allowed = await userClient.rpc("can_manage_members", { p_agent: agentId });
  if (allowed.error || !allowed.data) return json(403, { error: "Only the owner or an admin can invite." });

  const agent = await admin.from("tailortalk_agents").select("id, agent_name, label").eq("id", agentId).maybeSingle();
  if (agent.error || !agent.data) return json(404, { error: "Business not found." });
  const name = agent.data.agent_name || agent.data.label || "a business";

  const existing = await admin.from("business_members").select("id, status").eq("agent_id", agentId).eq("email", email).maybeSingle();
  if (existing.error) return json(500, { error: existing.error.message });
  if (existing.data?.status === "active") return json(400, { error: "That person is already a member." });

  let memberId = existing.data?.id || "";
  if (memberId) {
    const updated = await admin.from("business_members").update({
      role,
      status: "pending",
      invited_by: callerId,
      user_id: null,
      accepted_at: null
    }).eq("id", memberId);
    if (updated.error) return json(500, { error: updated.error.message });
  } else {
    const created = await admin.from("business_members").insert({
      agent_id: agentId,
      email,
      role,
      status: "pending",
      invited_by: callerId
    }).select("id").single();
    if (created.error) return json(500, { error: created.error.message });
    memberId = created.data.id;
  }

  const sent = await storeAndSend(admin, memberId, email, role, name);
  if (!sent.ok) return json(502, { error: sent.error, member_id: memberId });
  return json(200, { ok: true, member_id: memberId });
}

async function resend(userClient, admin, body) {
  const memberId = String(body.member_id || "");
  const member = await admin.from("business_members").select("id, agent_id, email, role, status").eq("id", memberId).maybeSingle();
  if (member.error || !member.data) return json(404, { error: "Invite not found." });
  if (member.data.status !== "pending") return json(400, { error: "Only a pending invite can be resent." });
  const allowed = await userClient.rpc("can_manage_members", { p_agent: member.data.agent_id });
  if (allowed.error || !allowed.data) return json(403, { error: "Only the owner or an admin can resend." });
  const agent = await admin.from("tailortalk_agents").select("agent_name, label").eq("id", member.data.agent_id).maybeSingle();
  const name = agent.data?.agent_name || agent.data?.label || "a business";
  const sent = await storeAndSend(admin, member.data.id, member.data.email, member.data.role, name);
  if (!sent.ok) return json(502, { error: sent.error });
  return json(200, { ok: true });
}

async function revoke(userClient, admin, body) {
  const memberId = String(body.member_id || "");
  const member = await admin.from("business_members").select("id, agent_id, status").eq("id", memberId).maybeSingle();
  if (member.error || !member.data) return json(404, { error: "Member not found." });
  const allowed = await userClient.rpc("can_manage_members", { p_agent: member.data.agent_id });
  if (allowed.error || !allowed.data) return json(403, { error: "Only the owner or an admin can revoke." });
  const updated = await admin.from("business_members").update({ status: "revoked" }).eq("id", memberId);
  if (updated.error) return json(500, { error: updated.error.message });
  await admin.rpc("business_invite_clear", { p_member: memberId });
  return json(200, { ok: true });
}

async function storeAndSend(admin, memberId: string, email: string, role: string, businessName: string) {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const saved = await admin.rpc("business_invite_put", {
    p_member: memberId,
    p_hash: tokenHash,
    p_expires: expires
  });
  if (saved.error) return { ok: false, error: saved.error.message };
  const link = SITE + "/signup/?invite=" + token;
  return sendEmail(email, businessName, role, link);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sendEmail(email: string, businessName: string, role: string, link: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY") || "";
  const from = Deno.env.get("RESEND_FROM") || "";
  if (!apiKey || !from) {
    return { ok: false, error: !apiKey ? "RESEND_API_KEY is not set." : "RESEND_FROM is not set." };
  }
  const label = role === "editor" ? "Editor" : "Viewer";
  const text = [
    "You are invited to " + businessName + " on Roleflow as " + label + ".",
    "",
    "Open this link to sign up, or to log in if you already have an account. An invite does not need the access code, and it only adds this business.",
    link,
    "",
    "The link expires in 14 days."
  ].join("\n");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "You're invited to " + businessName + " on Roleflow",
      text
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: String(payload?.message || payload?.error || "The invite email could not be sent.").slice(0, 300) };
  }
  return { ok: true, error: "" };
}

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}
