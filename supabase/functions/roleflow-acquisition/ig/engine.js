import { messagingDecision } from "./policy.js";
import { resolveNextState } from "./state.js";
import { qualifiersPass } from "./qualify.js";
import { parseEngineOutput } from "./output.js";
import { clampBubbles } from "./send.js";
import { bookingAllows } from "../../_shared/booking-plan.js";

function mergeAttrs(current, next) {
  return { ...(current || {}), ...(next || {}) };
}

export async function planTurn(input) {
  const thread = input.thread || {};
  const now = input.now ?? Date.now();
  const eventKind = input.eventKind || "message";
  const state = thread.state || (eventKind === "comment" ? "comment_to_dm" : "qualification");
  if (input.dnc) {
    return {
      noResponse: true,
      escalate: true,
      escalateReason: "do_not_contact",
      state,
      bubbles: [],
      score: null,
      attributes: thread.attributes || {},
      voiceNoteSlot: null,
      tag: null
    };
  }
  if (thread.human_locked && input.kind !== "human") {
    return {
      noResponse: true,
      escalate: false,
      escalateReason: "",
      state: "human",
      bubbles: [],
      reason: "human_locked",
      voiceNoteSlot: null,
      attributes: thread.attributes || {},
      score: thread.score || null,
      tag: null
    };
  }
  const window = messagingDecision({
    lastUserMessageAt: thread.lastUserMessageAt,
    now,
    kind: input.kind || "ai",
    humanLocked: Boolean(thread.human_locked)
  });
  if (!window.allow) {
    return {
      noResponse: true,
      reason: window.reason,
      tag: null,
      state,
      bubbles: [],
      voiceNoteSlot: null,
      attributes: thread.attributes || {},
      score: thread.score || null,
      escalate: false,
      escalateReason: ""
    };
  }
  const raw = await input.llm(input);
  const parsed = parseEngineOutput(raw, input.booking ? { slots: input.booking.slots || [] } : undefined);
  const attributes = mergeAttrs(thread.attributes, parsed.attributes);
  if (parsed.noResponse) {
    return {
      noResponse: true,
      escalate: parsed.escalate,
      escalateReason: parsed.escalateReason,
      state,
      bubbles: [],
      voiceNoteSlot: null,
      attributes,
      score: parsed.score,
      tag: null
    };
  }
  let next = resolveNextState(state, parsed.nextState, eventKind);
  const allowed = input.booking ? bookingAllows(input.booking, attributes) : qualifiersPass(attributes);
  if ((next.state === "booking" || next.state === "booked") && !allowed) {
    next = { state, rejected: true, reason: "qualification_incomplete" };
  }
  const escalate = parsed.escalate || next.state === "booked" || next.state === "human" || next.state === "dead";
  return {
    noResponse: false,
    bubbles: clampBubbles(parsed.bubbles),
    voiceNoteSlot: parsed.voiceNoteSlot,
    attributes,
    score: parsed.score,
    state: next.state,
    rejectedTransition: Boolean(next.rejected),
    escalate,
    escalateReason: parsed.escalateReason || (next.rejected ? next.reason : ""),
    tag: window.tag,
    window,
    bookingAction: parsed.bookingAction,
    slotStart: parsed.slotStart,
    email: parsed.email,
    confirmation: input.booking ? String(input.booking.confirmation || "") : "",
    reminder: input.booking ? String(input.booking.reminder || "") : "",
    link: input.booking ? String(input.booking.link || "") : ""
  };
}
