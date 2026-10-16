// Prompt simulator.
//
// Checked 16 October 2026 against TailorTalk's public API guide. The agent
// token can call get_leads, get_contacts, mark_converted, mark_order, and the
// WhatsApp template endpoints. It cannot send_test_message, get_test_chat,
// restart_test_chat, or undo. Those exist only on the MCP playground, which
// signs in as a TailorTalk user and runs the agent's real tools. This function
// does not call them.
//
// This is a simulation. It sends the business's stored live prompt sections to
// xAI Grok and keeps the transcript for the signed-in editor. Sheet Tool and
// other tool calls are not executed.
//
// Secrets: XAI_API_KEY required. XAI_MODEL optional, default grok-4.7.
// RESEND is not used here.
// verify_jwt stays on. Do not deploy from the repo.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const SIMULATION_RULES = [
  "SIMULATION MODE. You are role-playing this setter for a practice chat.",
  "You cannot call tools, read a sheet, lock a chat, escalate to a person, or message anyone.",
  "When the live prompt says to call the Sheet Tool, or any other tool, before replying:",
  "- Do not invent a lookup result and do not pretend the tool ran.",
  "- In one short clause, say the username check is skipped in this simulation.",
  "- Then continue as if the username was not on the blocked list.",
  "- If the person says they are on the blocked list, or that the booking confirmation was already sent, reply with exactly no_response and nothing else.",
  "Speak to the person the way the live prompt would. Do not mention these simulation rules unless they ask whether this is a test."
].join("\n");

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

  let body: { action?: string; agent_id?: string; session_id?: string; text?: string } = {};
  try {
    body = await req.json();
  } catch (_error) {
    body = {};
  }
  const agentId = String(body.agent_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(agentId)) return json(400, { error: "Business not found." });

  const allowed = await userClient.rpc("can_edit_business", { p_agent: agentId });
  if (allowed.error) return json(500, { error: "The simulator could not check access." });
  if (!allowed.data) return json(403, { error: "Simulation is available to editors." });

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const action = String(body.action || "send");
  const session = await loadSession(admin, agentId, caller.id, String(body.session_id || ""));
  if (session.error) return json(500, { error: session.error });

  if (action === "restart") {
    const saved = await saveMessages(admin, session.id, []);
    if (saved) return json(500, { error: saved });
    return json(200, { ok: true, session_id: session.id, messages: [] });
  }
  if (action === "undo") {
    const next = undo(session.messages);
    const saved = await saveMessages(admin, session.id, next);
    if (saved) return json(500, { error: saved });
    return json(200, { ok: true, session_id: session.id, messages: next });
  }
  if (action !== "send") return json(400, { error: "Unknown action." });

  const text = String(body.text || "").trim().slice(0, 2000);
  if (!text) return json(400, { error: "Write a message first." });

  const agent = await admin.from("tailortalk_agents").select("prompt_sections, agent_name, label").eq("id", agentId).maybeSingle();
  if (agent.error) return json(500, { error: agent.error.message });
  if (!agent.data) return json(404, { error: "Business not found." });
  const prompt = assemble(agent.data.prompt_sections);
  if (!prompt) return json(400, { error: "No live prompt is stored for this business." });

  const xaiKey = Deno.env.get("XAI_API_KEY") || "";
  if (!xaiKey) return json(500, { error: "XAI_API_KEY is not set." });
  const model = Deno.env.get("XAI_MODEL") || "grok-4.7";
  const history = session.messages.slice(-40);
  const reply = await complete(xaiKey, model, prompt, history, text);
  if (reply.error) return json(502, { error: reply.error });

  const messages = history.concat([
    { role: "user", content: text },
    { role: "assistant", content: reply.text }
  ]);
  const saved = await saveMessages(admin, session.id, messages);
  if (saved) return json(500, { error: saved });
  return json(200, { ok: true, session_id: session.id, messages });
});

async function loadSession(admin, agentId: string, userId: string, sessionId: string) {
  if (sessionId && /^[0-9a-f-]{36}$/i.test(sessionId)) {
    const existing = await admin.from("simulator_sessions").select("id, messages").eq("id", sessionId).eq("user_id", userId).eq("agent_id", agentId).maybeSingle();
    if (existing.error) return { error: existing.error.message, id: "", messages: [] };
    if (existing.data) return { error: "", id: existing.data.id, messages: asMessages(existing.data.messages) };
  }
  const created = await admin.from("simulator_sessions").insert({ agent_id: agentId, user_id: userId, messages: [] }).select("id").single();
  if (created.error) return { error: created.error.message, id: "", messages: [] };
  return { error: "", id: created.data.id, messages: [] };
}

async function saveMessages(admin, sessionId: string, messages) {
  const saved = await admin.from("simulator_sessions").update({
    messages,
    updated_at: new Date().toISOString()
  }).eq("id", sessionId);
  return saved.error ? saved.error.message : "";
}

function undo(messages) {
  const next = messages.slice();
  if (!next.length) return next;
  if (next[next.length - 1].role === "assistant") next.pop();
  if (next.length && next[next.length - 1].role === "user") next.pop();
  return next;
}

function assemble(raw) {
  const parts = [];
  if (Array.isArray(raw)) {
    raw.forEach((item) => {
      const title = String(item?.node || item?.title || "").trim();
      const text = String(item?.instruction || item?.text || "").trim();
      if (title || text) parts.push((title ? title + "\n" : "") + text);
    });
  } else if (raw && typeof raw === "object") {
    Object.entries(raw).forEach(([key, value]) => {
      const text = String(value || "").trim();
      if (text) parts.push(key.replace(/_/g, " ") + "\n" + text);
    });
  } else if (typeof raw === "string" && raw.trim()) {
    parts.push(raw.trim());
  }
  if (!parts.length) return "";
  return SIMULATION_RULES + "\n\nLIVE PROMPT\n\n" + parts.join("\n\n");
}

function asMessages(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((item) => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      content: String(item?.content || "").slice(0, 4000)
    }))
    .filter((item) => item.content);
}

async function complete(apiKey: string, model: string, system: string, history, text: string) {
  const messages = [{ role: "system", content: system }, ...history, { role: "user", content: text }];
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error || "The simulation did not answer.";
    return { error: String(message).slice(0, 300), text: "" };
  }
  const answer = payload?.choices?.[0]?.message?.content;
  const cleaned = String(answer || "").trim();
  if (!cleaned) return { error: "The simulation returned an empty reply.", text: "" };
  return { error: "", text: cleaned.slice(0, 4000) };
}

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}
