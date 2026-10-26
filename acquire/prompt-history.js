// Prompt text helpers shared by the dashboard and the try panel.
// A saved body is stored as written. Nothing here turns an agent on.

export const PROMPT_MAX = 80000;

export function promptBody(value) {
  return String(value || "").trim().slice(0, PROMPT_MAX);
}

// A deployed setter can be stored as an ordered list of { node, instruction }.
// The instruction strings are the prompt. Join them in that order and do not
// rewrite a character inside an instruction.
export function joinPromptInstructions(sections) {
  const list = Array.isArray(sections) ? sections : [];
  const parts = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || item.instruction == null) continue;
    parts.push(String(item.instruction));
  }
  return parts.join("\n\n");
}

export function diffLines(before, after) {
  const left = String(before ?? "").split("\n");
  const right = String(after ?? "").split("\n");
  const rows = [];
  if (left.length * right.length > 400000) {
    const max = Math.max(left.length, right.length);
    for (let index = 0; index < max; index += 1) {
      if (left[index] === right[index]) rows.push({ type: "same", text: left[index] });
      else {
        if (index < left.length) rows.push({ type: "del", text: left[index] });
        if (index < right.length) rows.push({ type: "add", text: right[index] });
      }
    }
    return rows;
  }
  const scores = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      scores[i][j] = left[i] === right[j]
        ? scores[i + 1][j + 1] + 1
        : Math.max(scores[i + 1][j], scores[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      rows.push({ type: "same", text: left[i] });
      i += 1;
      j += 1;
    } else if (scores[i + 1][j] >= scores[i][j + 1]) {
      rows.push({ type: "del", text: left[i] });
      i += 1;
    } else {
      rows.push({ type: "add", text: right[j] });
      j += 1;
    }
  }
  while (i < left.length) rows.push({ type: "del", text: left[i++] });
  while (j < right.length) rows.push({ type: "add", text: right[j++] });
  return rows;
}
