// The DM send gate. Every path that posts a text or a voice note to Instagram
// reads acq_dm_controls first and stops unless enabled is true and killed is
// not true. A missing row or a failed read counts as closed.

export function dmGateDecision(row, error) {
  if (error) return { open: false, reason: "dm_controls_unreadable" };
  if (!row) return { open: false, reason: "dm_controls_missing" };
  if (row.killed === true) return { open: false, reason: "dm_killed" };
  if (row.enabled !== true) return { open: false, reason: "dm_disabled" };
  return { open: true, reason: "open" };
}

export async function readDmGate(db, businessId) {
  if (!db || !businessId) return { open: false, reason: "dm_controls_missing" };
  try {
    const res = await db.from("acq_dm_controls").select("enabled, killed").eq("business_id", businessId).maybeSingle();
    return dmGateDecision(res && res.data, res ? res.error : new Error("no response"));
  } catch (_error) {
    return { open: false, reason: "dm_controls_unreadable" };
  }
}

export const DM_GATE_COPY = {
  dm_controls_unreadable: "Sending is off. Nothing was sent.",
  dm_controls_missing: "Sending is off. Nothing was sent.",
  dm_killed: "Sending is stopped. Nothing was sent.",
  dm_disabled: "Sending is off. Nothing was sent."
};

export function dmGateCopy(reason) {
  return DM_GATE_COPY[reason] || "Sending is off. Nothing was sent.";
}
