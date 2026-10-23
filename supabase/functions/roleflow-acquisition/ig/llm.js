import { bookingContract } from "../../_shared/booking-plan.js";

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

const PROMPT_KEYS = [
  "exclusion", "non_negotiables", "role", "guardrails", "knowledge", "workflow", "objections",
  "objective", "personality", "qualification_rules", "followup_logic", "booking_logic", "notes"
];

export function systemPrompt(sections, booking) {
  const blocks = sections || {};
  const seen = new Set();
  const body = PROMPT_KEYS.filter((key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((key) => blocks[key] ? `## ${key}\n${blocks[key]}` : "").filter(Boolean).join("\n\n");
  const slots = booking && Array.isArray(booking.slots) ? booking.slots : null;
  const slotLine = slots
    ? (slots.length ? "voice_note_slot is one of " + slots.join(", ") + ", or null." : "voice_note_slot must be null.")
    : "voice_note_slot is null unless the saved prompt for this business names one.";
  const savedBooking = booking ? "\n" + bookingContract(booking) : "";
  return `${body}

Non-negotiable output contract:
- If the lead sincerely asks whether they are talking to a bot or to AI, answer honestly with this sentence and then return to the current question: "${DISCLOSURE}" Never claim to be Diego himself.
- Reply as JSON only. Keys: bubbles (array of 1-2 short strings), voice_note_slot (or null), attributes (object of the fields this business asked you to collect), score (Hot, Warm, or Cold), next_state, escalate (boolean), escalate_reason, no_response (boolean), booking_action (offer, book, reschedule, cancel, or null), slot_start (ISO or null), email.
- One question in the whole reply. Max 30 words per bubble. No emojis. No exclamation marks.
- Do not invent numbers or results.
- ${slotLine} Never say a voice note was sent.${savedBooking}`;
}

export async function completeJson({ env, system, messages, fetchImpl }) {
  const provider = resolveProvider(env || {});
  if (!provider) {
    const error = new Error(providerHelp());
    error.code = "llm_unconfigured";
    throw error;
  }
  const fetchFn = fetchImpl || fetch;
  if (provider === "xai" || provider === "openai") {
    const xai = provider === "xai";
    const response = await fetchFn(xai ? XAI_CHAT_URL : "https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + (xai ? env.XAI_API_KEY : env.OPENAI_API_KEY),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: xai ? (env.XAI_MODEL || DEFAULT_XAI_MODEL) : (env.OPENAI_MODEL || "gpt-4.1-mini"),
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, ...(messages || [])]
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || (xai ? "xAI request failed." : "OpenAI request failed."));
    return payload?.choices?.[0]?.message?.content || "";
  }
  const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";
  const contents = (messages || []).map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }]
  }));
  const response = await fetchFn(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { temperature: 0.4, responseMimeType: "application/json" }
      })
    }
  );
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Gemini request failed.");
  return payload?.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") || "";
}
