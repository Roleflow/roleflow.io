export const DISCLOSURE = "Diego's team uses an AI assistant to keep up with conversations. Diego personally reviews them and takes the calls.";

// grok-4.3 is the cheapest general model on the xAI text API (Oct 2026) that
// documents structured outputs and instruction following. grok-build-0.1 is
// cheaper and is the coding model, so it is not the conversation default.
export const DEFAULT_XAI_MODEL = "grok-4.3";
const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";

export function resolveProvider(env) {
  const source = env || {};
  const forced = String(source.LLM_PROVIDER || "").trim().toLowerCase();
  const xai = Boolean(source.XAI_API_KEY);
  const openai = Boolean(source.OPENAI_API_KEY);
  const gemini = Boolean(source.GEMINI_API_KEY || source.GOOGLE_API_KEY);
  if (forced === "xai" || forced === "grok") return xai ? "xai" : null;
  if (forced === "openai") return openai ? "openai" : null;
  if (forced === "gemini") return gemini ? "gemini" : null;
  if (xai) return "xai";
  if (openai) return "openai";
  if (gemini) return "gemini";
  return null;
}

export function providerHelp() {
  return "Set XAI_API_KEY (optional XAI_MODEL, default grok-4.3). Alternatives: OPENAI_API_KEY (optional OPENAI_MODEL, default gpt-4.1-mini) or GEMINI_API_KEY / GOOGLE_API_KEY (optional GEMINI_MODEL, default gemini-2.0-flash). LLM_PROVIDER defaults to xai when XAI_API_KEY is set. Set openai or gemini to use those instead.";
}

export function systemPrompt(sections) {
  const blocks = sections || {};
  const body = [
    "objective", "personality", "workflow", "qualification_rules",
    "followup_logic", "booking_logic", "guardrails", "notes"
  ].map((key) => blocks[key] ? `## ${key}\n${blocks[key]}` : "").filter(Boolean).join("\n\n");
  return `${body}

Non-negotiable output contract:
- If the lead sincerely asks whether they are talking to a bot or to AI, answer honestly with this sentence and then return to the current question: "${DISCLOSURE}" Never claim to be Diego himself.
- Reply as JSON only. Keys: bubbles (array of 1-2 short strings), voice_note_slot (or null), clip_id (an owner clip id you were given, or null), attributes (budget, timeline, decision_maker, fit, monthly_revenue, dm_volume, offer_price), score (Hot, Warm, or Cold), next_state, escalate (boolean), escalate_reason, no_response (boolean), booking_action (offer, book, reschedule, cancel, or null), slot_start (ISO or null), email.
- One question in the whole reply. Max 30 words per bubble. No emojis. No exclamation marks.
- Do not invent numbers, results, or calendar slots. Only offer slot_start values you were given.
- Pricing you may state: $0 setup, no retainer, 10% of the growth the system generates, nothing owed if nothing is generated.
- voice_note_slot is one of gap_building, recovery_value, booking_confirmation, pre_call, or null. Never say a voice note was sent.`;
}

export async function completeJson({ env, system, messages, fetchImpl, tools, runtime, fallback, onError, responseFormat, maxTokens, temperature }) {
  const { completeChat, runtimeFromEnv } = await import("../../_shared/llm-provider.js");
  const chosen = runtime || runtimeFromEnv(env || {});
  if (chosen && chosen.provider === "xai" && !chosen.endpoint) chosen.endpoint = XAI_CHAT_URL;
  if (!chosen) {
    const error = new Error(providerHelp());
    error.code = "llm_unconfigured";
    throw error;
  }
  const result = await completeChat({
    runtime: chosen,
    fallback: fallback || null,
    system,
    messages,
    fetchImpl,
    tools,
    json: !responseFormat && !(tools && tools.length),
    responseFormat,
    maxTokens,
    temperature,
    onError
  });
  if (result.toolCalls && result.toolCalls.length && !String(result.text || "").trim()) {
    return JSON.stringify({ tool_calls: result.toolCalls });
  }
  return result.text || "";
}
