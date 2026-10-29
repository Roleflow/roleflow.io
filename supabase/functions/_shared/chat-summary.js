// Claude summary request. No temperature: Claude 5 rejects it. Facts only.

export const SUMMARY_MODEL = "claude-sonnet-5-5";

export function summaryRequest(transcript) {
  return {
    model: SUMMARY_MODEL,
    max_tokens: 700,
    system: [
      "Summarise one Instagram conversation.",
      "Use only facts written in the transcript.",
      "If a fact is missing, use an empty string or an empty array.",
      "Return JSON with keys situation, goal, objections, offer, outcome, next, questions."
    ].join(" "),
    messages: [{ role: "user", content: String(transcript || "").slice(0, 12000) }]
  };
}

export function parseSummaryText(text) {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]);
    const list = (value) => Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8) : [];
    return {
      situation: String(data.situation || "").trim(),
      goal: String(data.goal || "").trim(),
      objections: list(data.objections),
      offer: String(data.offer || "").trim(),
      outcome: String(data.outcome || "").trim(),
      next: String(data.next || "").trim(),
      questions: list(data.questions)
    };
  } catch (_error) {
    return null;
  }
}
