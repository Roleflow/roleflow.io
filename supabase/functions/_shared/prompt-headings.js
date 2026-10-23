export const SECTION_HEADINGS = [
  ["exclusion", "# Highest Priority Rule (Exclusion)"],
  ["non_negotiables", "# Non-Negotiables"],
  ["role", "# The Role"],
  ["guardrails", "# The Guardrails"],
  ["knowledge", "# Context and Knowledge"],
  ["workflow", "# Workflow Logic"],
  ["objections", "# Objection Handling"]
];

export function withHeading(key, text) {
  const found = SECTION_HEADINGS.find((row) => row[0] === key);
  const head = found ? found[1] : "# " + key;
  const body = String(text || "").replace(/\r\n/g, "\n").trim();
  if (body === head || body.startsWith(head + "\n")) return body;
  return head + "\n\n" + body;
}

export function headedSections(sections) {
  const out = {};
  SECTION_HEADINGS.forEach(([key]) => {
    out[key] = withHeading(key, sections && sections[key]);
  });
  return out;
}

export function workflowText(sections) {
  return SECTION_HEADINGS.map(([key]) => withHeading(key, sections && sections[key])).join("\n\n");
}
