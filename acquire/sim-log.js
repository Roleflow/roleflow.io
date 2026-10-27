// Saved simulator conversations. No network and no send.

export const SIM_STATES = [
  ["open", "Open", "Abierto"],
  ["discovering", "Discovering", "Descubriendo"],
  ["qualifying", "Qualifying", "Calificando"],
  ["proposal", "Proposal", "Propuesta"],
  ["booked", "Booked", "Reservado"],
  ["paid", "Paid", "Pagado"],
  ["postponed", "Postponed", "Pospuesto"],
  ["unqualified", "Not qualified", "No calificado"],
  ["lost", "Lost", "Perdido"]
];

export function blankConversation(leadState) {
  return {
    id: "sim-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    title: "",
    leadState: leadState || "open",
    messages: [],
    updatedAt: new Date().toISOString(),
    versionLabel: ""
  };
}

export function filterSimulations(list, query, leadState) {
  const text = String(query || "").trim().toLowerCase();
  const state = String(leadState || "all");
  return (list || []).filter((row) => {
    if (!row) return false;
    if (state && state !== "all" && row.leadState !== state) return false;
    if (!text) return true;
    const blob = [row.title, row.leadState].concat((row.messages || []).map((item) => item && item.text || "")).join(" ").toLowerCase();
    return blob.includes(text);
  });
}

export function lengthDelta(current, previous) {
  if (previous == null) return null;
  return String(current || "").length - String(previous || "").length;
}

export function simKey(businessId) {
  return "roleflow.sim." + String(businessId || "none");
}

export function loadSimulations(storage, businessId) {
  try {
    const raw = storage && storage.getItem(simKey(businessId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (_error) {
    return [];
  }
}

export function saveSimulations(storage, businessId, list) {
  try {
    if (storage) storage.setItem(simKey(businessId), JSON.stringify((list || []).slice(0, 40)));
  } catch (_error) {
    /* private mode */
  }
}
