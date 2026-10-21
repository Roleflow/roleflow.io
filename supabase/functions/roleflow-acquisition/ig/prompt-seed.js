import { gunzipSync } from "node:zlib";
import { SEED_B64 } from "./prompt-seed-data.js";

export const PROMPT_ROLES = ["comment_to_dm", "qualification", "conversation_recovery", "appointment_booking"];
export const SECTION_KEYS = ["objective", "personality", "workflow", "qualification_rules", "followup_logic", "booking_logic", "guardrails", "notes"];

const packed = Uint8Array.from(atob(SEED_B64), (char) => char.charCodeAt(0));
export const SEED = JSON.parse(new TextDecoder().decode(gunzipSync(packed)));

export function seedSections(role) {
  return SEED[role] || null;
}
