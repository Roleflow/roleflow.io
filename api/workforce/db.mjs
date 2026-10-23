// Service-role reader for the workforce runner.
// The key comes from the function environment and is never returned.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createDb(env = process.env) {
  const url = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  let cached = null;
  return {
    async secrets() {
      const found = [];
      if (env.WORKFORCE_RUNNER_SECRET) found.push(String(env.WORKFORCE_RUNNER_SECRET));
      if (env.CRON_SECRET) found.push(String(env.CRON_SECRET));
      if (!url || !key) return found;
      if (cached == null) {
        const payload = await rpc(url, key, "acq_read_workforce_secret", {});
        cached = typeof payload === "string" ? payload : "";
      }
      if (cached) found.push(cached);
      return found;
    },
    async library() {
      const routines = await rest(url, key, "agent_routines?enabled=eq.true&select=id,business_id,agent_role,name,cron,timezone,enabled,instructions,last_run_at&limit=200");
      const ids = [...new Set((routines || []).map((row) => row.business_id))].filter((id) => UUID.test(id));
      if (!ids.length) return { routines: routines || [], prompts: [], briefs: [], links: [], crm: [] };
      const list = ids.join(",");
      const [prompts, briefs, links, contacts, targets] = await Promise.all([
        rest(url, key, "agent_prompts?business_id=in.(" + list + ")&select=id,business_id,agent_role,body,created_at&order=created_at.desc&limit=400"),
        rest(url, key, "acq_business_briefs?business_id=in.(" + list + ")&select=business_id,fields"),
        rest(url, key, "acq_offer_links?business_id=in.(" + list + ")&select=id,business_id,name,url,body&limit=200"),
        rest(url, key, "acq_contacts?business_id=in.(" + list + ")&select=id,business_id,name,ig_handle,crm_state,lead_status,tags&order=last_message_at.desc.nullslast&limit=80"),
        rest(url, key, "acq_targets?agent_id=in.(" + list + ")&select=id,agent_id,handle,crm_state,lead_status,tags,score_summary&order=updated_at.desc&limit=80")
      ]);
      const crm = (contacts || []).map((row) => ({ ...row, kind: "contact", handle: row.ig_handle || "" }))
        .concat((targets || []).map((row) => ({ ...row, business_id: row.agent_id, kind: "target" })));
      return { routines: routines || [], prompts: prompts || [], briefs: briefs || [], links: links || [], crm };
    },
    async autoApprove(businessId, role) {
      const rows = await rest(url, key, "agent_settings?business_id=eq." + businessId + "&agent_role=eq." + role + "&select=auto_approve&limit=1");
      return Boolean(rows && rows[0] && rows[0].auto_approve === true);
    },
    async insertRun(row) {
      const saved = await rest(url, key, "agent_runs", { method: "POST", body: row });
      return Array.isArray(saved) ? saved[0] : saved;
    },
    async insertAction(row) {
      const saved = await rest(url, key, "agent_actions", { method: "POST", body: row });
      return Array.isArray(saved) ? saved[0] : saved;
    },
    async touchRoutine(id, at) {
      await rest(url, key, "agent_routines?id=eq." + id, { method: "PATCH", body: { last_run_at: at, updated_at: at } });
    },
    async claimRoutine(id, previous, at) {
      const filter = previous ? "last_run_at=eq." + encodeURIComponent(previous) : "last_run_at=is.null";
      const saved = await rest(url, key, "agent_routines?id=eq." + id + "&" + filter, { method: "PATCH", body: { last_run_at: at, updated_at: at } });
      return Array.isArray(saved) ? saved[0] : saved;
    },
    async listActions(status) {
      return await rest(url, key, "agent_actions?status=eq." + status + "&select=id,business_id,agent_role,run_id,type,target,payload,status,approved_by,error,claimed_at&order=created_at.asc&limit=50") || [];
    },
    async getAction(id) {
      const rows = await rest(url, key, "agent_actions?id=eq." + id + "&select=id,business_id,agent_role,run_id,type,target,payload,status,approved_by,error,claimed_at&limit=1");
      return rows && rows[0] ? rows[0] : null;
    },
    async claimAction(id) {
      const at = new Date().toISOString();
      const saved = await rest(url, key, "agent_actions?id=eq." + id + "&status=eq.approved&claimed_at=is.null", {
        method: "PATCH",
        body: { claimed_at: at, updated_at: at }
      });
      return Array.isArray(saved) ? saved[0] : saved;
    },
    async finishAction(id, patch) {
      const saved = await rest(url, key, "agent_actions?id=eq." + id, {
        method: "PATCH",
        body: { ...patch, updated_at: new Date().toISOString() }
      });
      return Array.isArray(saved) ? saved[0] : saved;
    },
    async applyCrm(businessId, write) {
      if (!write) return;
      if (write.table && write.id && write.patch && Object.keys(write.patch).length) {
        const column = write.table === "acq_contacts" ? "business_id" : "agent_id";
        await rest(url, key, write.table + "?id=eq." + write.id + "&" + column + "=eq." + businessId, { method: "PATCH", body: write.patch });
      }
      if (write.note) {
        await rest(url, key, "acq_lead_notes", {
          method: "POST",
          body: {
            business_id: businessId,
            contact_id: write.contact_id || null,
            target_id: write.target_id || null,
            body: write.note
          }
        });
      }
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
      Prefer: "return=representation"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) throw new Error("The workforce store returned " + response.status + ".");
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function rpc(url, key, name, body) {
  const response = await fetch(url + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body || {})
  });
  if (!response.ok) return "";
  const text = await response.text();
  if (!text) return "";
  try {
    return JSON.parse(text);
  } catch (_error) {
    return text.replace(/^"|"$/g, "");
  }
}
