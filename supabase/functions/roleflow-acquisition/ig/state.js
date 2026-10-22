export const LEGAL = {
  comment_to_dm: ["qualification", "dead", "human"],
  qualification: ["qualification", "recovery", "booking", "dead", "human"],
  recovery: ["qualification", "recovery", "booking", "dead", "human"],
  booking: ["booking", "booked", "qualification", "dead", "human"],
  booked: ["booked", "booking", "human"],
  human: ["human", "qualification", "booking", "booked"],
  dead: ["dead"],
  closed: ["closed"]
};

export function canTransition(from, to) {
  return (LEGAL[from] || []).includes(to);
}

export function resolveNextState(current, proposed, eventKind) {
  const from = LEGAL[current] ? current : "qualification";
  let next = proposed || from;
  if (from === "comment_to_dm" && eventKind === "message" && next === "comment_to_dm") {
    next = "qualification";
  }
  if (!canTransition(from, next)) {
    return { state: from, rejected: true, reason: "illegal_transition" };
  }
  return { state: next, rejected: false, reason: "" };
}
