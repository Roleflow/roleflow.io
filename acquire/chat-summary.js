// Conversation desk helpers. Counts come from stored leads. Narrative fields stay empty until the server fills them.

const GROUPS = {
  new: ["open", "discovering"],
  qualified: ["qualifying", "proposal"],
  booked: ["booked", "paid"],
  lost: ["lost", "unqualified"]
};

export function deskMatches(lead, desk) {
  const key = String(desk || "all");
  if (!key || key === "all") return true;
  if (key === "ai") return Boolean(lead && lead.ai);
  if (key === "manual") return !(lead && lead.ai);
  const states = GROUPS[key];
  return states ? states.includes(lead && lead.state) : true;
}

export function bubbleKind(message) {
  const sender = String(message && message.sender || "").toLowerCase();
  if (sender === "human" || sender === "team") return "human";
  if (sender === "ai") return "ai";
  if (sender === "lead") return "lead";
  if (message && message.role === "assistant") return "ai";
  return "lead";
}

export function bubbleLabel(kind) {
  if (kind === "human") return "You";
  if (kind === "ai") return "AI";
  return "Lead";
}

export function aggregateFromLeads(leads) {
  const rows = leads || [];
  const byOutcome = { new: 0, qualified: 0, booked: 0, lost: 0 };
  rows.forEach((lead) => {
    if (deskMatches(lead, "new")) byOutcome.new += 1;
    else if (deskMatches(lead, "qualified")) byOutcome.qualified += 1;
    else if (deskMatches(lead, "booked")) byOutcome.booked += 1;
    else if (deskMatches(lead, "lost")) byOutcome.lost += 1;
  });
  return {
    conversations: rows.length,
    byOutcome,
    objections: [],
    questions: [],
    booked: byOutcome.booked,
    needsHuman: rows.filter((lead) => lead && !lead.ai).length
  };
}

export function emptySummary(leads) {
  return {
    empty: !(leads || []).length,
    conversation: null,
    aggregate: aggregateFromLeads(leads)
  };
}

export function summaryFields(conversation) {
  const source = conversation && typeof conversation === "object" ? conversation : {};
  return {
    situation: String(source.situation || ""),
    goal: String(source.goal || ""),
    objections: Array.isArray(source.objections) ? source.objections.map((item) => String(item || "")).filter(Boolean) : [],
    offer: String(source.offer || ""),
    outcome: String(source.outcome || ""),
    next: String(source.next || "")
  };
}

export function mergeSummary(base, server) {
  const local = base || emptySummary([]);
  if (!server || server.empty) return local;
  const conversation = server.conversation ? summaryFields(server.conversation) : local.conversation;
  const aggregate = server.aggregate && typeof server.aggregate === "object" ? server.aggregate : local.aggregate;
  return {
    empty: false,
    conversation,
    aggregate: {
      conversations: Number(aggregate.conversations) || local.aggregate.conversations,
      byOutcome: aggregate.byOutcome || local.aggregate.byOutcome,
      objections: Array.isArray(aggregate.objections) ? aggregate.objections : [],
      questions: Array.isArray(aggregate.questions) ? aggregate.questions : [],
      booked: Number(aggregate.booked) || 0,
      needsHuman: Number(aggregate.needsHuman) || 0
    }
  };
}
