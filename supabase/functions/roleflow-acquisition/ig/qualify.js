export function qualifiersPass(attrs) {
  const row = attrs || {};
  const keys = ["budget", "timeline", "decision_maker", "fit"];
  if (!keys.every((key) => String(row[key] ?? "").trim())) return false;
  const budget = String(row.budget).toLowerCase();
  const fit = String(row.fit).toLowerCase();
  if (budget.startsWith("refus") || budget.includes("hard no")) return false;
  if (fit === "no" || fit.startsWith("no ") || fit.startsWith("no,")) return false;
  return true;
}

export function normalizeScore(value) {
  const score = String(value || "").trim().toLowerCase();
  if (score === "hot" || score === "warm" || score === "cold") return score;
  return null;
}
