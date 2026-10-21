/* =============================================================================
   ROLEFLOW ONBOARDING — EDIT THIS FILE
   -----------------------------------------------------------------------------
   HIGH_PRIORITY_RULES is section 1 of every client's prompt. The text below
   is Diego's gold-standard block, inserted verbatim. The edge function
   supabase/functions/generate-setter-prompt copies the same text. A test
   fails if the two copies drift.

   QUESTIONS is the short intake. About ten fields, designed to take under
   ten minutes. Progress still saves to the account after each step.

   The setter prompt itself is written by the generate-setter-prompt
   edge function (xAI Grok, model grok-4.7, plus the Thomas Miller example).
   This file does not call the model. SETTER_SECTIONS is the nine blocks
   the panel copies, in order. The first block is these rules.
   ============================================================================= */
(function (root) {
  "use strict";

  var HIGH_PRIORITY_RULES = [
    "- **MANDATORY:** Before generating ANY Instagram reply, you MUST call the `Sheet Tool` to check the sender's username.",
    "- **MATCHING:** Search for the username exactly. If not found, intelligently try variations (exactly as it is, if not found call with variations like upper/lowercase, space in between, etc., intelligently trying to match the name), to ensure a match.",
    "- **IF FOUND:** If the username is in the list, you MUST output exactly `no_response` and nothing else. Do not greet, answer, or follow up.",
    "- **IF NOT FOUND:** Only if the username is confirmed NOT to be in the list, proceed with your normal instructions.",
    "- **LOCKING:** If the username is found, you must also trigger an escalation to a human and lock the conversation.",
    "- **CONFIRMED BOOKING:** If the chat history shows you have already sent the final confirmation sequence (confirming the Zoom link and pre-call video), you MUST output exactly `no_response` and nothing else.",
    "- **PRIORITY:** This rule overrides all other instructions."
  ].join("\n");

  var PROMPT_SECTIONS = [
    { id: "identity", number: 2, title: "IDENTITY & MISSION" },
    { id: "nonnegotiables", number: 3, title: "NON-NEGOTIABLES" },
    { id: "style", number: 4, title: "STYLE, FORMATTING & TONE" },
    { id: "context", number: 5, title: "CONTEXT & OUTREACH" },
    { id: "qualification", number: 6, title: "QUALIFICATION LOGIC" },
    { id: "links", number: 7, title: "LINK ASSETS" },
    { id: "workflow", number: 8, title: "WORKFLOW LOGIC" },
    { id: "objections", number: 9, title: "OBJECTION HANDLING" }
  ];

  var SETTER_SECTIONS = [
    { id: "high_priority_rule", title: "HIGH PRIORITY RULE" }
  ].concat(PROMPT_SECTIONS.map(function (item) {
    return { id: item.id, title: item.title };
  }));

  var QUESTIONS = [
    {
      id: "you",
      title: "You",
      description: "Three short answers. A few sentences each is enough.",
      fields: [
        {
          id: "clientName",
          label: "Your name",
          type: "text",
          required: true,
          section: "meta",
          placeholder: "Maya Chen",
          autoComplete: "name",
          help: "The name on the prompt and in the email to Diego."
        },
        {
          id: "instagramHandle",
          label: "Instagram handle",
          type: "text",
          required: true,
          section: "identity",
          promptLabel: "Instagram handle",
          placeholder: "@mayachen",
          autoCapitalize: "off",
          spellcheck: "false",
          help: "The account the setter speaks from."
        },
        {
          id: "brandStory",
          label: "Brand and short bio",
          type: "textarea",
          required: true,
          section: "identity",
          promptLabel: "Brand and bio",
          rows: 5,
          minLength: 40,
          placeholder: "Northstar Coaching. I coach B2B founders on outbound. Ex-AE, built the offer after booking my own pipeline to $40k months.",
          help: "Brand name, who you are, and the credentials story. A short paragraph is enough."
        }
      ]
    },
    {
      id: "offer",
      title: "Offer and who it's for",
      description: "What the call is, and who should get one.",
      fields: [
        {
          id: "offerCall",
          label: "Offer and the call",
          type: "textarea",
          required: true,
          section: "identity",
          promptLabel: "Offer and call",
          rows: 4,
          minLength: 20,
          placeholder: "12-week pipeline intensive. The call is a 25-minute fit call. Do not quote price in DMs. Price is discussed on the call.",
          help: "Offer name, what the booked call is, and anything the setter must not say."
        },
        {
          id: "marketFit",
          label: "Market, ideal client, and qualifying questions",
          type: "textarea",
          required: true,
          section: "qualification",
          promptLabel: "Market and qualification",
          rows: 5,
          minLength: 20,
          placeholder: "USA, Canada, UK. Founders selling a service over $2k. Ask: where are you based? what do you sell? what did you collect last month?",
          help: "Countries, who is a fit, and the questions you already ask. One per line is perfect."
        }
      ]
    },
    {
      id: "voice",
      title: "How you open and how you sound",
      description: "Paste what you already send. Do not write a new script.",
      fields: [
        {
          id: "openers",
          label: "Outreach openers you use",
          type: "textarea",
          required: true,
          section: "context",
          promptLabel: "Outreach openers",
          rows: 4,
          minLength: 10,
          placeholder: "Hey, appreciate the follow. Where are you based?\nHey, saw your last post. What are you working on this quarter?",
          help: "One opener per line. The first two become the audit openers."
        },
        {
          id: "voiceRules",
          label: "Tone, emoji, and words",
          type: "textarea",
          required: true,
          section: "style",
          promptLabel: "Tone and vocabulary",
          rows: 4,
          minLength: 10,
          placeholder: "Lowercase, short, warm. Emojis, one each per chat: 👊 🔥 💪 🫡 ✨. Say fit call. Never say guaranteed, bro, or limited spots.",
          help: "Do's and don'ts. If you use emoji, list up to five. If you use none, say no emojis."
        }
      ]
    },
    {
      id: "assets",
      title: "Links, objections, and proof",
      description: "Last step. The paste box is optional and the most useful thing you can add.",
      fields: [
        {
          id: "links",
          label: "Links and when to send each",
          type: "textarea",
          required: true,
          section: "links",
          promptLabel: "Links",
          rows: 5,
          minLength: 12,
          placeholder: "Booking: https://cal.example/maya — send only after they agree to the fit call.\nThank-you: https://northstar.example/thanks — send after they confirm the time.\nLead magnet: https://northstar.example/checklist — optional, after they book.",
          help: "Booking link, VSL or thank-you page, and lead magnet. Say when each one goes out."
        },
        {
          id: "objections",
          label: "Top objections and how you answer",
          type: "textarea",
          required: true,
          section: "objections",
          promptLabel: "Objections",
          rows: 5,
          minLength: 20,
          placeholder: "How much is it? — Totally fair. The call maps the number to your pipeline. Want a slot?\nI need to think. — Of course. What part do you want to think through?",
          help: "One objection per line, then your real reply. Five to seven is ideal."
        },
        {
          id: "sourceMaterial",
          label: "SOP and converted DMs",
          type: "textarea",
          required: false,
          section: "context",
          promptLabel: "SOP and converted conversations",
          rows: 8,
          file: true,
          placeholder: "Paste your setter SOP and one or two threads that turned into a booked call. Mark who said what.",
          help: "Optional, and worth it. Paste text or upload a .txt or .md file. This is the voice the prompt is built from."
        }
      ]
    }
  ];

  root.ROLEFLOW_ONBOARDING_CONFIG = {
    configVersion: 2,
    DIEGO_EMAIL: "diego@roleflow.io",
    HIGH_PRIORITY_RULES: HIGH_PRIORITY_RULES,
    PROMPT_SECTIONS: PROMPT_SECTIONS,
    SETTER_SECTIONS: SETTER_SECTIONS,
    QUESTIONS: QUESTIONS
  };
})(globalThis);
