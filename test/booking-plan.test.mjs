import assert from "node:assert/strict";
import fs from "node:fs";
import { bookingBehaviour, bookingContract } from "../supabase/functions/_shared/booking-plan.js";
import { planTurn } from "../supabase/functions/roleflow-acquisition/ig/engine.js";
import { systemPrompt } from "../supabase/functions/roleflow-acquisition/ig/llm.js";
import { planGatewayReply } from "../supabase/functions/_shared/ig-gateway.js";

const north = bookingBehaviour({
  sections: {
    exclusion: "Skip people who asked to stop.",
    non_negotiables: "Short messages.",
    role: "Book a strategy call for North Studio.",
    guardrails: "Do not invent a calendar.",
    knowledge: "North Studio coaches founders.",
    workflow: [
      "Required before booking: city.",
      "Send the calendar link from the booking tool only after the city is known.",
      "Confirmation: North locked.",
      "Reminder: North tomorrow.",
      "Use voice note slot booking_confirmation after they book."
    ].join("\n"),
    objections: "If they hesitate, ask what is in the way."
  },
  tools: [{ kind: "booking", name: "North calendar", config: { calendar_link: "https://cal.north.example/book" } }]
});

const south = bookingBehaviour({
  sections: {
    exclusion: "Skip people who asked to stop.",
    non_negotiables: "Short messages.",
    role: "Book an intro for South Studio.",
    guardrails: "Do not invent a calendar.",
    knowledge: "South Studio sells a course.",
    workflow: [
      "Book on the first reply. Do not ask qualification questions.",
      "Confirmation: South list.",
      "Reminder: none."
    ].join("\n"),
    objections: "Offer the link again once."
  },
  tools: [{ kind: "booking", name: "South calendar", config: { calendar_link: "https://cal.south.example/intro" } }],
  settings: { booking_fallback_url: "https://calendar.app.google/8i1gomkozavqYU5b8" }
});

assert.equal(north.link, "https://cal.north.example/book");
assert.equal(south.link, "https://cal.south.example/intro");
const namedInPrompt = bookingBehaviour({
  sections: { workflow: "Only book after all four Qualification Rules pass (budget, timeline, decision-maker, fit)." }
});
assert.deepEqual(namedInPrompt.required, ["budget", "timeline", "decision_maker", "fit"]);
assert.equal(namedInPrompt.link, "");
assert.equal(north.qualifyBeforeBook, true);
assert.deepEqual(north.required, ["city"]);
assert.equal(south.qualifyBeforeBook, false);
assert.deepEqual(south.required, []);
assert.equal(north.confirmation, "North locked");
assert.equal(south.confirmation, "South list");
assert.equal(north.reminder, "North tomorrow");
assert.equal(south.reminder, "");
assert.deepEqual(north.slots, ["booking_confirmation"]);
assert.deepEqual(south.slots, []);

const northPrompt = systemPrompt(northSections(north), north);
const southPrompt = systemPrompt(southSections(south), south);
assert.match(northPrompt, /https:\/\/cal\.north\.example\/book/);
assert.match(northPrompt, /Confirmation wording: North locked/);
assert.match(northPrompt, /Reminder wording: North tomorrow/);
assert.match(northPrompt, /voice_note_slot is one of booking_confirmation/);
assert.doesNotMatch(northPrompt, /cal\.south\.example/);
assert.match(southPrompt, /https:\/\/cal\.south\.example\/intro/);
assert.match(southPrompt, /Confirmation wording: South list/);
assert.match(southPrompt, /No reminder wording is saved/);
assert.match(southPrompt, /voice_note_slot must be null/);
assert.doesNotMatch(southPrompt, /cal\.north\.example/);
assert.doesNotMatch(southPrompt, /8i1gomkozavqYU5b8/);
assert.equal(bookingContract(south).includes("8i1gomkozavqYU5b8"), false);

const now = Date.parse("2026-10-23T12:00:00Z");
const thread = { state: "qualification", lastUserMessageAt: new Date(now).toISOString(), attributes: {} };

const northBlocked = await planTurn({
  thread,
  now,
  booking: north,
  llm: async () => ({
    bubbles: ["Grab Thursday."],
    next_state: "booking",
    booking_action: "book",
    attributes: {},
    voice_note_slot: "booking_confirmation"
  })
});
assert.equal(northBlocked.state, "qualification");
assert.equal(northBlocked.rejectedTransition, true);
assert.equal(northBlocked.reason || northBlocked.escalateReason, "qualification_incomplete");
assert.equal(northBlocked.link, north.link);

const northBooked = await planTurn({
  thread: { ...thread, state: "booking", attributes: { city: "Madrid" } },
  now,
  booking: north,
  llm: async () => ({
    bubbles: ["North locked."],
    next_state: "booked",
    booking_action: "book",
    attributes: { city: "Madrid" },
    voice_note_slot: "pre_call"
  })
});
assert.equal(northBooked.state, "booked");
assert.deepEqual(northBooked.bubbles, ["North locked."]);
assert.equal(northBooked.confirmation, "North locked");
assert.equal(northBooked.reminder, "North tomorrow");
assert.equal(northBooked.voiceNoteSlot, null);

const southBooked = await planGatewayReply({
  thread,
  text: "Hey",
  now,
  booking: south,
  llm: async () => ({
    bubbles: ["You're on the South list. https://cal.south.example/intro"],
    next_state: "booking",
    booking_action: "offer",
    attributes: {},
    voice_note_slot: "booking_confirmation"
  })
});
assert.equal(southBooked.state, "booking");
assert.equal(southBooked.rejectedTransition, false);
assert.deepEqual(southBooked.bubbles, ["You're on the South list. https://cal.south.example/intro"]);
assert.equal(southBooked.confirmation, "South list");
assert.equal(southBooked.reminder, "");
assert.equal(southBooked.link, south.link);
assert.equal(southBooked.voiceNoteSlot, null);
assert.notEqual(northBooked.confirmation, southBooked.confirmation);
assert.notEqual(northBooked.link, southBooked.link);

const root = new URL("../", import.meta.url);
for (const file of [
  "supabase/functions/_shared/booking-plan.js",
  "supabase/functions/_shared/ig-gateway.js",
  "supabase/functions/zernio-webhook/index.ts",
  "supabase/functions/roleflow-acquisition/ig/engine.js",
  "supabase/functions/roleflow-acquisition/ig/llm.js",
  "acquire/app.js",
  "acquire/engine-ui.js"
]) {
  const source = fs.readFileSync(new URL(file, root), "utf8");
  assert.equal(source.includes("8i1gomkozavqYU5b8"), false, file);
}

function northSections() {
  return {
    workflow: north.text
  };
}

function southSections() {
  return {
    workflow: south.text
  };
}
