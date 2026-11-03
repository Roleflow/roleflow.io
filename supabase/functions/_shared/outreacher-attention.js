// Needs Diego items use the existing hq_tasks queue. business_id on hq_tasks
// points at tailortalk_agents, so the workspace id is written in the description
// unless that same id exists there.

export function attentionTask({ code, machineId, businessId, detail }) {
  const title = ("Outreacher " + code + " " + String(machineId || "").slice(0, 8)).slice(0, 240);
  const description = [
    "Machine " + (machineId || "unknown") + " for business " + (businessId || "unknown") + " needs a look.",
    detail ? String(detail).slice(0, 1500) : ""
  ].filter(Boolean).join(" ");
  return {
    title,
    description,
    status: "needs_diego",
    decision: "pending",
    priority: "high",
    result: ""
  };
}
