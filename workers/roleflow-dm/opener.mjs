// Asks Claude Sonnet for one opener. No temperature field: Claude 5 rejects it.
// The key is ANTHROPIC_API_KEY or a business key already on the worker computer.

import { OPENER_MODEL, openerSystem, profileBrief, profileReadable } from "../../acquire/auto-dm.js";

export async function draftOpener({ apiKey, profile, prompt, playbook, voice, fetchImpl }) {
  if (!profileReadable(profile)) return { ok: false, reason: "no_profile" };
  const key = String(apiKey || "").trim();
  if (!key) return { ok: false, reason: "no_key" };
  const call = fetchImpl || fetch;
  const response = await call("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: OPENER_MODEL,
      max_tokens: 180,
      system: openerSystem({ prompt, playbook, voice }),
      messages: [{ role: "user", content: profileBrief(profile) }]
    })
  });
  const payload = await response.json().catch(() => ({}));
  const text = payload && payload.content && payload.content[0] && payload.content[0].text;
  if (!response.ok || !text) return { ok: false, reason: "no_draft" };
  return { ok: true, draft: String(text).trim() };
}
