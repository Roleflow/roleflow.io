export const SHARE_BPS = 1000;

export const JOURNEY = ["target", "warmup", "outreach", "reply", "qualified", "booked", "showed", "closed"];

export const STAGE_LABELS = {
  target: "Target",
  warmup: "Warm-up",
  outreach: "Outreach",
  reply: "Reply",
  qualified: "Qualified",
  booked: "Booked",
  showed: "Showed",
  closed: "Closed",
  skipped: "Skipped",
  dead: "Dead"
};

export const LEAD_STATUSES = ["cold", "warm", "hot", "converted", "dead"];

export const ROLES = [
  { id: "chief_of_staff", name: "Chief of Staff", detail: "Cap, bottlenecks, daily summary, weekly report." },
  { id: "icp_acquisition", name: "ICP Target Acquisition", detail: "20–30 Instagram accounts a day. Bio CTA, 5k–200k followers." },
  { id: "engagement_warmup", name: "Engagement Warm-Up", detail: "Day 1 follow, likes, Reel comment. Days 2–3 stories. Day 4 unfollow." },
  { id: "personalised_outreach", name: "Personalised Outreach", detail: "Send or skip after warm-up. Personal voice note on the opener." },
  { id: "comment_to_dm", name: "Comment-to-DM Conversion", detail: "Turns comments into DMs. Runs on TailorTalk or Roleflow's Meta engine, whichever this business selected." },
  { id: "qualification", name: "Qualification & Gap-Building", detail: "One question at a time: budget, timeline, decision-maker, fit." },
  { id: "conversation_recovery", name: "Conversation Recovery", detail: "Up to 3 follow-ups, about 6 hours apart, inside the 24-hour window." },
  { id: "appointment_booking", name: "Appointment Booking & Show-Up", detail: "Books the call. On TailorTalk, a booking in TailorTalk becomes an appointment here." }
];

export const BOOKING_FALLBACK_URL = "https://calendar.app.google/8i1gomkozavqYU5b8";

export const DISCLOSURE = "Diego's team uses an AI assistant to keep up with conversations. Diego personally reviews them and takes the calls.";

export const SLOTS = [
  { id: "outreach_opener", label: "Outreach opener", agent: "Personalised Outreach" },
  { id: "gap_building", label: "Gap building", agent: "Qualification" },
  { id: "recovery_followup_1", label: "Recovery follow-up 1", agent: "Conversation Recovery" },
  { id: "recovery_followup_2", label: "Recovery follow-up 2", agent: "Conversation Recovery" },
  { id: "recovery_value", label: "Recovery value", agent: "Conversation Recovery" },
  { id: "booking_confirmation", label: "Booking confirmation", agent: "Appointment Booking" },
  { id: "pre_call_value", label: "Pre-call value", agent: "Appointment Booking" },
  { id: "pre_call", label: "Pre-call", agent: "Appointment Booking" },
  { id: "reminder", label: "Reminder", agent: "Appointment Booking" }
];

const RANK = Object.fromEntries(JOURNEY.map((stage, index) => [stage, index + 1]));

export function stageRank(stage) {
  return RANK[stage] || 0;
}

export function funnel(targets) {
  const rows = (targets || []).filter((row) => row.stage !== "skipped" && row.peak_stage !== "skipped");
  return JOURNEY.map((stage) => {
    const need = stageRank(stage);
    const count = rows.filter((row) => Math.max(stageRank(row.stage), stageRank(row.peak_stage)) >= need).length;
    return { stage, count };
  });
}

export function dropOffs(steps) {
  return (steps || []).map((step, index) => {
    const next = steps[index + 1];
    const dropped = next ? Math.max(step.count - next.count, 0) : 0;
    return {
      ...step,
      dropped,
      dropRate: step.count ? dropped / step.count : 0
    };
  });
}

export function shareCents(amountCents, shareBps = SHARE_BPS) {
  const amount = Number(amountCents) || 0;
  const bps = Number(shareBps) || 0;
  return Math.round(amount * bps / 10000);
}

export function showUpRate(bookings) {
  const rows = bookings || [];
  const showed = rows.filter((row) => row.show_status === "showed").length;
  const missed = rows.filter((row) => row.show_status === "no_show").length;
  const denom = showed + missed;
  return {
    showed,
    missed,
    scheduled: rows.filter((row) => row.show_status === "scheduled").length,
    rate: denom ? showed / denom : null
  };
}

export function attributedCents(deals) {
  return (deals || []).reduce((sum, deal) => {
    if (deal.attributed === false) return sum;
    return sum + (Number(deal.amount_cents) || 0);
  }, 0);
}

export function inQuietHours(localTime, start, end) {
  const now = String(localTime || "");
  const from = String(start || "");
  const to = String(end || "");
  if (!now || !from || !to || from === to) return false;
  if (from < to) return now >= from && now < to;
  return now >= from || now < to;
}

export function pickVoiceNote(notes, slot, niche, variant) {
  const nicheKey = String(niche || "").trim();
  const variantKey = String(variant || "").trim();
  const matches = (notes || []).filter((note) => {
    if (!note || note.active === false || note.slot !== slot) return false;
    if (note.niche && note.niche !== nicheKey) return false;
    if (variantKey && note.variant && note.variant !== variantKey) return false;
    return true;
  });
  const nicheScore = (note) => (nicheKey && note.niche === nicheKey ? 0 : note.niche ? 2 : 1);
  const variantScore = (note) => (variantKey && note.variant === variantKey ? 0 : note.variant ? 2 : 1);
  matches.sort((a, b) => {
    const nicheDelta = nicheScore(a) - nicheScore(b);
    if (nicheDelta) return nicheDelta;
    const variantDelta = variantScore(a) - variantScore(b);
    if (variantDelta) return variantDelta;
    return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
  });
  return matches[0] || null;
}

export function voiceRates(row) {
  const sends = Number(row && row.sends) || 0;
  const replies = Number(row && row.replies) || 0;
  const bookings = Number(row && row.bookings) || 0;
  return {
    sends,
    replies,
    bookings,
    replyRate: sends ? replies / sends : null,
    bookingRate: sends ? bookings / sends : null
  };
}

export function money(cents, currency = "USD") {
  const value = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return "$" + value.toFixed(2);
  }
}

export function percent(rate) {
  if (rate == null || Number.isNaN(rate)) return "—";
  return Math.round(rate * 100) + "%";
}
