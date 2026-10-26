// Client-side view of a business model key. The full key is never kept.

export const CLIENT_PROVIDERS = [
  { id: "xai", label: "xAI", model: "grok-4.3" },
  { id: "openai", label: "OpenAI", model: "gpt-4.1-mini" },
  { id: "gemini", label: "Gemini 3 Flash", model: "gemini-3-flash-preview" }
];

const PROVIDER_ID = /^[a-z0-9_-]{2,40}$/;

export function defaultModel(provider) {
  const found = CLIENT_PROVIDERS.find((item) => item.id === provider);
  return found ? found.model : "grok-4.3";
}

export function keyHint(hints, provider) {
  const row = publicKeyView(hints).find((item) => item.provider === provider);
  return row ? row.last4 : "";
}

export function publicKeyView(hints) {
  const rows = [];
  for (const item of hints || []) {
    const provider = String(item && item.provider || "");
    const last4 = String(item && item.last4 || "");
    if (!PROVIDER_ID.test(provider) || !/^[A-Za-z0-9]{4}$/.test(last4)) continue;
    const next = { provider, last4 };
    const existing = rows.findIndex((row) => row.provider === provider);
    if (existing >= 0) rows[existing] = next;
    else rows.push(next);
  }
  return rows;
}

export function previewKeySave(hints, secret) {
  const current = publicKeyView(hints);
  if (!secret || typeof secret !== "object") return { ok: false, error: "Choose a provider.", hints: current };
  const provider = String(secret.provider || "");
  if (!PROVIDER_ID.test(provider)) return { ok: false, error: "Choose a provider.", hints: current };
  const rest = current.filter((item) => item.provider !== provider);
  if (secret.clear === true) return { ok: true, hints: rest };
  const apiKey = String(secret.apiKey || "").trim();
  if (apiKey.length < 8 || apiKey.length > 400) return { ok: false, error: "That key is not a usable length.", hints: current };
  return { ok: true, hints: rest.concat([{ provider, last4: apiKey.slice(-4) }]) };
}

export function previewKeys(hints, secrets) {
  let current = publicKeyView(hints);
  for (const secret of secrets || []) {
    if (!secret) continue;
    const step = previewKeySave(current, secret);
    if (!step.ok) return { ok: false, error: step.error, hints: current };
    current = step.hints;
  }
  return { ok: true, hints: current };
}

export function modelPatch(provider, clear) {
  if (!CLIENT_PROVIDERS.some((item) => item.id === provider)) return null;
  if (clear) return { llm_setter_provider: provider, llm_setter_own_key: false };
  return {
    llm_setter_provider: provider,
    llm_setter_own_key: true,
    setter_model: defaultModel(provider)
  };
}
