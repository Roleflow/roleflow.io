// Opportunity board math. Values and snippets come only from stored rows.

export function valueCentsFor(lead, deals) {
  const id = lead && (lead.kind === "target" ? lead.id : lead.targetId);
  if (!id) return null;
  const amounts = (deals || []).filter((deal) => deal && deal.target_id === id).map((deal) => Number(deal.amount_cents)).filter((amount) => Number.isFinite(amount));
  if (!amounts.length) return null;
  return amounts.reduce((sum, amount) => sum + amount, 0);
}

export function messageSnippet(lead, conversations, messages) {
  if (!lead || lead.kind !== "contact") return "";
  const ids = (conversations || []).filter((row) => row.contact_id === lead.id).map((row) => row.id);
  const found = (messages || []).filter((row) => ids.includes(row.conversation_id)).sort((left, right) => String(right.sent_at || right.created_at || "").localeCompare(String(left.sent_at || left.created_at || "")))[0];
  if (!found || !found.body) return "";
  return String(found.body).replace(/\s+/g, " ").trim().slice(0, 80);
}

export function stageEnteredAt(lead, events) {
  const rows = (events || []).filter((event) => event && (event.contact_id === lead.id || event.target_id === lead.id));
  const latest = rows.sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))[0];
  if (latest && latest.to_state === lead.state) return latest.created_at;
  return lead.updatedAt || lead.lastMessageAt || null;
}

export function daysInStage(at, now) {
  const start = new Date(at).getTime();
  const clock = now instanceof Date ? now.getTime() : new Date(now || Date.now()).getTime();
  if (!Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((clock - start) / 86400000));
}

export function presentLeads(leads, context) {
  const ctx = context || {};
  return (leads || []).map((lead) => {
    const entered = stageEnteredAt(lead, ctx.events);
    return {
      ...lead,
      valueCents: valueCentsFor(lead, ctx.deals),
      snippet: messageSnippet(lead, ctx.conversations, ctx.messages),
      stageEnteredAt: entered,
      days: daysInStage(entered, ctx.now || new Date())
    };
  });
}

export function columnSummary(leads, state) {
  const items = (leads || []).filter((lead) => lead.state === state);
  const valued = items.map((lead) => lead.valueCents).filter((amount) => Number.isFinite(amount));
  return {
    count: items.length,
    valueCents: valued.reduce((sum, amount) => sum + amount, 0),
    hasValue: valued.length > 0
  };
}

export function applyStage(rows, id, toState) {
  return (rows || []).map((row) => row && row.id === id ? { ...row, crm_state: toState } : row);
}
