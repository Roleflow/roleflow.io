export const SETTER_SECTION_DEFS = [
  { id: "exclusion", title: "Highest Priority Rule (Exclusion)" },
  { id: "non_negotiables", title: "Non-Negotiables" },
  { id: "role", title: "The Role" },
  { id: "guardrails", title: "The Guardrails" },
  { id: "knowledge", title: "Context and Knowledge" },
  { id: "workflow", title: "Workflow Logic" },
  { id: "objections", title: "Objection Handling" }
];

export function nodeText(payload, name) {
  const row = (payload && payload.agent_instructions || []).find((item) => item && item.node === name);
  return row && row.instruction ? String(row.instruction) : "";
}

function sliceBetween(text, start, end) {
  const from = text.indexOf(start);
  if (from < 0) return "";
  if (!end) return text.slice(from);
  const to = text.indexOf(end, from + start.length);
  return (to < 0 ? text.slice(from) : text.slice(from, to)).trim();
}

function linesOf(record, label) {
  const rows = Object.entries(record || {});
  if (!rows.length) return "";
  return label + "\n" + rows.map(([key, value]) => key + ": " + value).join("\n");
}

export function mapLivePrompt(payload) {
  const objective = nodeText(payload, "Objective");
  const personality = nodeText(payload, "Personality");
  const workflow = nodeText(payload, "Workflow");
  const qualification = nodeText(payload, "Qualification Rules");
  const followup = nodeText(payload, "Follow-up Logic");
  const booking = nodeText(payload, "Booking Logic");
  const comment = nodeText(payload, "Comment-to-DM Logic");
  const guardrails = nodeText(payload, "Guardrails");
  const notes = nodeText(payload, "Notes");
  const step0 = sliceBetween(workflow, "**Step 0.", "**Step 1.");
  const rules = sliceBetween(guardrails, "**Highest priority:", "3.  **No invented");
  const faq = sliceBetween(notes, "**FAQ answers**", "**Assets**");
  const afterObjection = sliceBetween(followup, "**After an objection**", "**After booking");
  return {
    exclusion: [step0, rules].filter(Boolean).join("\n\n"),
    non_negotiables: personality,
    role: objective,
    guardrails,
    knowledge: [notes, linesOf(payload && payload.lead_statuses, "Lead statuses"), linesOf(payload && payload.leads_attributes_to_extract, "Attributes to extract")].filter(Boolean).join("\n\n"),
    workflow: [workflow, qualification, followup, booking, comment].filter(Boolean).join("\n\n"),
    objections: [faq, afterObjection].filter(Boolean).join("\n\n")
  };
}

export function missingSource(payload, sections) {
  const blob = SETTER_SECTION_DEFS.map((section) => sections[section.id] || "").join("\n");
  const missing = [];
  (payload.agent_instructions || []).forEach((node) => {
    if (!node || !node.instruction || !blob.includes(node.instruction)) missing.push(node.node);
  });
  Object.entries(payload.lead_statuses || {}).forEach(([key, value]) => {
    if (!blob.includes(key + ": " + value)) missing.push("status:" + key);
  });
  Object.entries(payload.leads_attributes_to_extract || {}).forEach(([key, value]) => {
    if (!blob.includes(key + ": " + value)) missing.push("attribute:" + key);
  });
  return missing;
}
