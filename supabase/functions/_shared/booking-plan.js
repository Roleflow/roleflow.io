// Booking for one business. The saved workflow prompt and that business's
// tools decide the method, link, qualification, confirmation, and reminder.
// No shared calendar link and no shared qualification checklist.

const NAMED_SLOTS = ["booking_confirmation", "pre_call", "pre_call_value", "reminder"];

export function bookingBehaviour({ sections, tools, settings }) {
  const source = sections && typeof sections === "object" ? sections : {};
  const text = ["workflow", "booking_logic", "qualification_rules", "followup_logic"]
    .map((key) => String(source[key] || "").trim())
    .filter(Boolean)
    .join("\n\n");
  const required = requiredBeforeBooking(text);
  return {
    text,
    link: bookingLink(tools, settings),
    slots: namedSlots(text),
    required,
    qualifyBeforeBook: required.length > 0 || /only book after|before (you |we )?book|qualification before booking/i.test(text),
    confirmation: lineValue(text, "Confirmation"),
    reminder: lineValue(text, "Reminder")
  };
}

export function bookingAllows(booking, attributes) {
  if (!booking) return null;
  if (!booking.qualifyBeforeBook) return true;
  const required = Array.isArray(booking.required) ? booking.required : [];
  if (!required.length) return true;
  const attrs = attributes || {};
  return required.every((key) => String(attrs[key] || "").trim());
}

export function bookingContract(booking) {
  if (!booking) return "";
  const lines = ["Booking for this business. Follow only this business's saved workflow and tools."];
  lines.push(booking.link
    ? "Calendar or booking link: " + booking.link
    : "No calendar or booking link is saved for this business. Do not invent one.");
  if (booking.qualifyBeforeBook && booking.required && booking.required.length) {
    lines.push("Required before booking: " + booking.required.join(", ") + ".");
  }
  lines.push(booking.confirmation
    ? "Confirmation wording: " + booking.confirmation
    : "No confirmation wording is saved for this business. Do not invent a confirmation.");
  lines.push(booking.reminder
    ? "Reminder wording: " + booking.reminder
    : "No reminder wording is saved for this business. Do not invent a reminder.");
  return lines.join("\n");
}

function requiredBeforeBooking(text) {
  const source = String(text || "");
  const labeled = source.match(/required before booking\s*:\s*([^\n.]+)/i);
  const parenthetical = source.match(/only book after[^\n(]*\(([^)]+)\)/i);
  const raw = labeled ? labeled[1] : (parenthetical ? parenthetical[1] : "");
  if (!raw) return [];
  return raw.split(/,| and /i).map((item) => item.trim().toLowerCase().replace(/-/g, "_").replace(/\s+/g, "_")).filter((item) => /^[a-z][a-z0-9_]{0,40}$/.test(item));
}

function lineValue(text, label) {
  const match = String(text || "").match(new RegExp("(?:^|\\n)\\s*" + label + "\\s*:\\s*([^\\n]+)", "i"));
  if (!match) return "";
  const value = match[1].trim().replace(/\.+$/, "");
  if (!value || /^none$/i.test(value) || /^no reminder/i.test(value)) return "";
  return value.slice(0, 240);
}

function namedSlots(text) {
  const body = String(text || "").toLowerCase();
  return NAMED_SLOTS.filter((slot) => new RegExp("(?:voice note slot|slot)\\s+" + slot + "\\b").test(body));
}

function bookingLink(tools, settings) {
  const rows = Array.isArray(tools) ? tools : [];
  for (const tool of rows) {
    if (!tool || tool.kind !== "booking") continue;
    const config = tool.config && typeof tool.config === "object" ? tool.config : {};
    const link = String(config.calendar_link || config.booking_url || "").trim();
    if (link.startsWith("https://")) return link.slice(0, 500);
  }
  const saved = String((settings && settings.booking_fallback_url) || "").trim();
  if (saved.startsWith("https://")) return saved.slice(0, 500);
  return "";
}
