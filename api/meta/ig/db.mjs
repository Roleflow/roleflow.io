// Service-role store for Instagram Login. Tokens are written only through the private RPCs.

import { DEFAULT_CHANNEL } from "./core.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createDb(env = process.env) {
  const url = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  return {
    async cronSecrets() {
      const found = [];
      if (env.CRON_SECRET) found.push(String(env.CRON_SECRET));
      if (!url || !key) return found;
      const stored = await rpc(url, key, "acq_read_cron_secret", {});
      if (typeof stored === "string" && stored) found.push(stored);
      return found;
    },
    async userFromBearer(token) {
      if (!url || !key || !token) return null;
      const response = await fetch(url + "/auth/v1/user", {
        headers: { apikey: key, Authorization: "Bearer " + token }
      });
      if (!response.ok) return null;
      const user = await response.json().catch(() => null);
      return user && user.id ? { id: user.id } : null;
    },
    async canEdit(businessId, userId) {
      const allowed = await rpc(url, key, "acq_user_can_edit", { p_business: businessId, p_user: userId });
      return allowed === true;
    },
    async saveState(row) {
      await rest(url, key, "acq_oauth_states", {
        method: "POST",
        body: {
          state: row.nonce,
          provider: "instagram",
          business_id: row.businessId,
          user_id: row.userId,
          expires_at: row.expiresAt
        }
      });
    },
    async takeState(nonce) {
      const rows = await rest(url, key, "acq_oauth_states?state=eq." + encodeURIComponent(nonce) + "&provider=eq.instagram&select=state,business_id,user_id,expires_at&limit=1");
      const row = rows && rows[0];
      if (!row) return null;
      await rest(url, key, "acq_oauth_states?state=eq." + encodeURIComponent(nonce), { method: "DELETE" });
      if (new Date(row.expires_at).getTime() < Date.now()) return null;
      return row;
    },
    async putToken(businessId, cipher) {
      await rpc(url, key, "acq_put_ig_token", { p_business: businessId, p_token: cipher });
    },
    async readToken(businessId) {
      const value = await rpc(url, key, "acq_read_ig_token", { p_business: businessId });
      return typeof value === "string" ? value : "";
    },
    async deleteToken(businessId) {
      await rpc(url, key, "acq_delete_ig_token", { p_business: businessId });
    },
    async upsertConnection(row) {
      await rest(url, key, "ig_connections?on_conflict=business_id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: row
      });
    },
    async disconnect(businessId) {
      await rest(url, key, "ig_connections?business_id=eq." + businessId, {
        method: "PATCH",
        body: { status: "disconnected", ig_user_id: null, last_error: null, updated_at: new Date().toISOString() }
      });
    },
    async touchConnection(businessId, patch) {
      await rest(url, key, "ig_connections?business_id=eq." + businessId, {
        method: "PATCH",
        body: { ...patch, updated_at: new Date().toISOString() }
      });
    },
    async setChannel(businessId, provider) {
      const next = provider === "meta" ? "meta" : DEFAULT_CHANNEL;
      await rest(url, key, "acq_settings?agent_id=eq." + businessId, {
        method: "PATCH",
        body: { channel_provider: next }
      });
    },
    async channel(businessId) {
      const rows = await rest(url, key, "acq_settings?agent_id=eq." + businessId + "&select=channel_provider&limit=1");
      return rows && rows[0] && rows[0].channel_provider === "meta" ? "meta" : DEFAULT_CHANNEL;
    },
    async connectionByIgUser(igUserId) {
      const rows = await rest(url, key, "ig_connections?ig_user_id=eq." + encodeURIComponent(igUserId) + "&select=business_id,ig_user_id,status&limit=1");
      return rows && rows[0] ? rows[0] : null;
    },
    async upsertLead(row) {
      const contact = await rest(url, key, "acq_contacts?on_conflict=business_id,external_id", {
        method: "POST",
        prefer: "resolution=merge-duplicates",
        body: {
          business_id: row.business_id,
          external_id: row.external_id,
          name: row.username || "",
          ig_handle: row.username || null,
          source_detail: "Instagram",
          lead_status: "cold"
        }
      });
      const saved = Array.isArray(contact) ? contact[0] : contact;
      const contactId = saved && saved.id;
      if (!contactId) return;
      let conversation = await rest(url, key, "acq_conversations?contact_id=eq." + contactId + "&select=id&limit=1");
      let conversationId = conversation && conversation[0] && conversation[0].id;
      if (!conversationId) {
        const created = await rest(url, key, "acq_conversations", {
          method: "POST",
          body: {
            business_id: row.business_id,
            contact_id: contactId,
            external_id: row.external_id,
            status: "cold"
          }
        });
        conversationId = (Array.isArray(created) ? created[0] : created).id;
      }
      await rest(url, key, "acq_messages?on_conflict=conversation_id,external_id", {
        method: "POST",
        prefer: "resolution=ignore-duplicates,return=minimal",
        body: {
          business_id: row.business_id,
          conversation_id: conversationId,
          external_id: row.message_id,
          role: "user",
          sender: "lead",
          body: row.body,
          sent_at: row.sent_at,
          metadata: { kind: row.kind, source: "meta" }
        }
      });
    },
    async listRefresh(beforeIso) {
      return await rest(url, key, "ig_connections?status=eq.connected&expires_at=lt." + encodeURIComponent(beforeIso) + "&select=business_id,expires_at&limit=50") || [];
    },
    async pendingDrafts() {
      return await rest(url, key, "engine_outbox?status=eq.pending&kind=eq.message_lead_draft&select=id,business_id,kind,payload&order=created_at.asc&limit=20") || [];
    },
    async threadRecipient(businessId, threadId) {
      if (!UUID.test(threadId)) return "";
      const rows = await rest(url, key, "ig_threads?id=eq." + threadId + "&business_id=eq." + businessId + "&select=igsid&limit=1");
      return rows && rows[0] ? String(rows[0].igsid || "") : "";
    },
    async markOutbox(id, status, error) {
      await rest(url, key, "engine_outbox?id=eq." + id + "&status=eq.pending", {
        method: "PATCH",
        body: { status, error, applied_at: new Date().toISOString() }
      });
    },
    async deletionStatus(code) {
      const rows = await rest(url, key, "meta_deletion_requests?confirmation_code=eq." + encodeURIComponent(code.slice(0, 80)) + "&select=status,created_at&limit=1");
      if (!rows || !rows[0]) return null;
      return { status: rows[0].status, received_at: rows[0].created_at };
    },
    async recordDeletion({ code, igUserId }) {
      const connection = await rest(url, key, "ig_connections?ig_user_id=eq." + encodeURIComponent(igUserId) + "&select=business_id&limit=1");
      const businessId = connection && connection[0] ? connection[0].business_id : null;
      await rest(url, key, "meta_deletion_requests", {
        method: "POST",
        body: {
          confirmation_code: code,
          ig_user_id: igUserId,
          business_id: businessId,
          status: "received"
        }
      });
      const externalId = "ig:" + igUserId;
      const contacts = await rest(url, key, "acq_contacts?external_id=eq." + encodeURIComponent(externalId) + "&select=id,business_id&limit=20") || [];
      for (const contact of contacts) {
        const conversations = await rest(url, key, "acq_conversations?contact_id=eq." + contact.id + "&select=id&limit=5") || [];
        for (const conversation of conversations) {
          await rest(url, key, "acq_messages?conversation_id=eq." + conversation.id, { method: "DELETE" });
          await rest(url, key, "acq_conversations?id=eq." + conversation.id, { method: "DELETE" });
        }
        await rest(url, key, "acq_contacts?id=eq." + contact.id, { method: "DELETE" });
      }
      if (businessId) {
        await rpc(url, key, "acq_delete_ig_token", { p_business: businessId });
        await rest(url, key, "ig_connections?business_id=eq." + businessId, {
          method: "PATCH",
          body: { status: "disconnected", ig_user_id: null, last_error: "Data deletion request", updated_at: new Date().toISOString() }
        });
        await rest(url, key, "acq_settings?agent_id=eq." + businessId, {
          method: "PATCH",
          body: { channel_provider: DEFAULT_CHANNEL }
        });
      }
      await rest(url, key, "meta_deletion_requests?confirmation_code=eq." + encodeURIComponent(code), {
        method: "PATCH",
        body: { status: "completed" }
      });
      return { status: "completed" };
    }
  };
}

async function rest(url, key, path, options = {}) {
  if (!url || !key) throw new Error("Supabase is not configured.");
  const response = await fetch(url + "/rest/v1/" + path, {
    method: options.method || "GET",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) throw new Error("The Instagram store returned " + response.status + ".");
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function rpc(url, key, name, body) {
  if (!url || !key) return null;
  const response = await fetch(url + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body || {})
  });
  if (!response.ok) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return text.replace(/^"|"$/g, "");
  }
}
