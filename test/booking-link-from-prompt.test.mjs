import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ROLEFLOW_BOOKING_LINK,
  businessBookingLink,
  expandPrompt,
  pinBookingLink,
  promptBookingLink,
  resolveOutgoing,
  staleBookingLinks,
  tokenGuide
} from "../supabase/functions/_shared/prompt-tokens.js";
import { bookingBehaviour, bookingContract, storedBookingLinks } from "../supabase/functions/_shared/booking-plan.js";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

// Shapes taken from the three live prompts.
const caleb = "Script:\n  \"Let's do it!\n\n  You can pick the time that works best for you here:\n  https://link.reformed-fit.com/widget/bookings/consultation-call-link-a7b760e3[cite: 1]\n\n  Ideally lock it in this week!\"\nThank you page: https://reformed-fit.com/thankyoureawesome-page";
const roleflow = "Product: https://share.descript.com/view/XJIQ\nSite https://www.roleflow.io\nKey links\nDemo booking link: https://calendar.app.google/PW7FuuDqTPc6iF8k9\nPricing overview (public): https://www.roleflow.io/pricing/\nSend https://calendar.app.google/PW7FuuDqTPc6iF8k9, then stop.";
const vam = "### 4. Official Asset Registry\n- Main Booking Calendar: `https://link.valueaddmarketing.com/widget/bookings/instagram-value-add-marketing`\n- System Overview for Realtors: `https://getcasaclients.com/howitworks`";

assert.equal(promptBookingLink(caleb), "https://link.reformed-fit.com/widget/bookings/consultation-call-link-a7b760e3");
assert.equal(promptBookingLink(roleflow), "https://calendar.app.google/PW7FuuDqTPc6iF8k9");
assert.equal(promptBookingLink(vam), "https://link.valueaddmarketing.com/widget/bookings/instagram-value-add-marketing");
assert.equal(promptBookingLink("Book a call here: https://example.com/talk."), "https://example.com/talk");
assert.equal(promptBookingLink("Thank you page after booking: https://example.com/thanks"), "");
assert.equal(promptBookingLink("Use {{booking_link}} when they are ready."), "");
assert.equal(promptBookingLink(""), "");

// The prompt wins over the saved setting; the setting is only a fallback; there is no shared default.
const vamSetting = "https://link.valueaddmarketing.com/widget/bookings/zoom-spanish-seller-system";
assert.equal(businessBookingLink({ prompt: vam, settingsLink: vamSetting }), promptBookingLink(vam));
assert.equal(businessBookingLink({ prompt: "Use {{booking_link}}.", settingsLink: vamSetting }), vamSetting);
assert.equal(businessBookingLink({ prompt: "No link here.", settingsLink: "" }), "");
assert.notEqual(businessBookingLink({ prompt: caleb, settingsLink: "" }), ROLEFLOW_BOOKING_LINK);

// What the model is told.
const own = promptBookingLink(vam);
const guide = tokenGuide([], own);
assert.match(guide, /instagram-value-add-marketing/);
assert.doesNotMatch(guide, /zoom-spanish|R4wpQ4b8F5J7xnD39/);
assert.match(tokenGuide([], ""), /No booking link is saved/);
assert.doesNotMatch(tokenGuide([], ""), /R4wpQ4b8F5J7xnD39/);
assert.equal(expandPrompt("Send {{booking_link}}", ""), "Send {{booking_link}}");
assert.equal(expandPrompt("Send {{booking_link}}", own), "Send " + own);

// Booking contract states the prompt link even with a different tool or setting saved.
const tools = [{ kind: "booking", name: "Cal", config: { calendar_link: "https://cal.example/old" } }];
const booking = bookingBehaviour({ sections: {}, tools, settings: { booking_fallback_url: vamSetting }, promptLink: own });
assert.equal(booking.link, own);
assert.match(bookingContract(booking), /instagram-value-add-marketing/);
assert.doesNotMatch(bookingContract(booking), /zoom-spanish|cal\.example/);
// Without a prompt link the earlier order holds: tool, then setting.
assert.equal(bookingBehaviour({ sections: {}, tools, settings: { booking_fallback_url: vamSetting }, promptLink: "" }).link, "https://cal.example/old");
assert.equal(bookingBehaviour({ sections: {}, tools: [], settings: { booking_fallback_url: vamSetting } }).link, vamSetting);
assert.deepEqual(storedBookingLinks(tools, { booking_fallback_url: vamSetting }), ["https://cal.example/old", vamSetting]);

// Outgoing text: token resolves to the prompt link; a stale stored link is swapped out.
const stale = staleBookingLinks(own, [vamSetting, own, ""]);
assert.deepEqual(stale, [ROLEFLOW_BOOKING_LINK, vamSetting]);
const sent = resolveOutgoing("Grab a time: " + vamSetting + ". Or {{booking_link}}", { voices: [], bookingLink: own, staleLinks: stale });
assert.equal(sent.text, "Grab a time: " + own + ". Or " + own);
const calebSent = resolveOutgoing("Pick a time: " + ROLEFLOW_BOOKING_LINK, { voices: [], bookingLink: promptBookingLink(caleb), staleLinks: staleBookingLinks(promptBookingLink(caleb), []) });
assert.equal(calebSent.text, "Pick a time: " + promptBookingLink(caleb));
assert.equal(pinBookingLink("x " + vamSetting, "", [vamSetting]), "x " + vamSetting);
// Roleflow's own prompt link is not touched when it is the business's link.
assert.deepEqual(staleBookingLinks(ROLEFLOW_BOOKING_LINK, []), []);

// Every reply path takes the link from the business's own prompt.
const webhook = read("supabase/functions/zernio-webhook/index.ts");
assert.match(webhook, /promptLink: promptBookingLink\(setterPrompt\)/);
assert.match(webhook, /const bookingLink = booking\.link;/);
assert.match(webhook, /staleLinks: plan\.staleLinks/);
assert.doesNotMatch(webhook, /bookingLinkFor\(prefs\.booking_fallback_url/);
const acquisition = read("supabase/functions/roleflow-acquisition/index.ts");
assert.match(acquisition, /const promptLink = promptBookingLink\(prompt\);/);
assert.match(acquisition, /loadBooking\(db, businessId, prompts, settings, savedPrompt\)/);
assert.match(acquisition, /resolveOutgoing\(text, \{ voices: catalog, bookingLink, staleLinks \}\)/);
assert.doesNotMatch(acquisition, /bookingLinkFor\(settings\.booking_fallback_url/);
const dashboard = read("supabase/functions/client-dashboard/index.ts");
assert.match(dashboard, /businessBookingLink\(\{ prompt, settingsLink \}\)/);
assert.match(dashboard, /resolveOutgoing\(text, \{ voices: catalog, bookingLink, staleLinks \}\)/);
const app = read("acquire/app.js");
assert.match(app, /businessBookingLink\(\{ prompt: body, settingsLink: state\.bookingLink \}\)/);
assert.equal(read("acquire/prompt-tokens.js"), read("supabase/functions/_shared/prompt-tokens.js"));
console.log("booking link from prompt: ok");
