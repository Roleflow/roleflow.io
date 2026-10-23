// generate-setter-prompt
//
// Builds an Instagram DM setter prompt from a client's short onboarding
// answers, stores it on onboarding_submissions, and emails it to Diego.
//
// Do not deploy from the repo. Deploy this folder with the Supabase
// connector after the migration supabase/migrations/20261014120000_prompt_generation.sql.
//
// Secrets (Edge Function secrets, never committed):
//   XAI_API_KEY      required. xAI chat completions at https://api.x.ai/v1/chat/completions.
//   XAI_MODEL        optional. Defaults to grok-4.7, the current flagship.
//   RESEND_API_KEY   required to email Diego.
//   RESEND_FROM      required. A sender already verified in Resend.
//
// The model returns JSON with one field per generated section. This function
// inserts the high priority rules verbatim, checks that all 9 sections are
// present, stores each section on prompt_sections, then emails Diego.
// A missing section does not send the email.
//
// Injected by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// verify_jwt stays on. The caller is the signed-in client, an invited editor
// of that client's business, or an admin regenerating with { "user_id": "<client uuid>" }.

import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { completeChat, loadBusinessRuntime, logLlmError } from "../_shared/llm-provider.js";

const DIEGO_EMAIL = "diego@roleflow.io";
const HIGH_PRIORITY_RULES = [
  "- **MANDATORY:** Before generating ANY Instagram reply, you MUST call the `Sheet Tool` to check the sender's username.",
  "- **MATCHING:** Search for the username exactly. If not found, intelligently try variations (exactly as it is, if not found call with variations like upper/lowercase, space in between, etc., intelligently trying to match the name), to ensure a match.",
  "- **IF FOUND:** If the username is in the list, you MUST output exactly `no_response` and nothing else. Do not greet, answer, or follow up.",
  "- **IF NOT FOUND:** Only if the username is confirmed NOT to be in the list, proceed with your normal instructions.",
  "- **LOCKING:** If the username is found, you must also trigger an escalation to a human and lock the conversation.",
  "- **CONFIRMED BOOKING:** If the chat history shows you have already sent the final confirmation sequence (confirming the Zoom link and pre-call video), you MUST output exactly `no_response` and nothing else.",
  "- **PRIORITY:** This rule overrides all other instructions."
].join("\n");

const SECTIONS = [
  { id: "high_priority_rule", title: "HIGH PRIORITY RULE" },
  { id: "identity", title: "IDENTITY & MISSION" },
  { id: "nonnegotiables", title: "NON-NEGOTIABLES" },
  { id: "style", title: "STYLE, FORMATTING & TONE" },
  { id: "context", title: "CONTEXT & OUTREACH" },
  { id: "qualification", title: "QUALIFICATION LOGIC" },
  { id: "links", title: "LINK ASSETS" },
  { id: "workflow", title: "WORKFLOW LOGIC" },
  { id: "objections", title: "OBJECTION HANDLING" }
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { error: "Supabase URL or keys are missing in the function environment." });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  const caller = userData?.user;
  if (userError || !caller) return json(401, { error: "Sign in required." });

  let body: { user_id?: string } = {};
  try {
    body = await req.json();
  } catch (_error) {
    body = {};
  }
  const target = String(body.user_id || caller.id);
  const admin = createClient(supabaseUrl, serviceKey);

  if (target !== caller.id) {
    const { data: adminRow } = await admin.from("admins").select("user_id").eq("user_id", caller.id).maybeSingle();
    if (!adminRow) {
      const linked = await admin.from("tailortalk_agents").select("id").eq("client_id", target);
      if (linked.error) return json(500, { error: "The prompt could not be checked." });
      let editor = false;
      for (const agent of linked.data || []) {
        const allowed = await userClient.rpc("can_edit_business", { p_agent: agent.id });
        if (allowed.data) editor = true;
      }
      if (!editor) return json(403, { error: "Only the client, an editor, or a Roleflow admin can generate this prompt." });
    }
  }

  const { data: profile, error: profileError } = await admin.from("profiles").select("id, full_name, email, instagram").eq("id", target).maybeSingle();
  if (profileError) return json(500, { error: profileError.message });
  if (!profile) return json(404, { error: "No profile for this account." });

  const { data: submission, error: submissionError } = await admin.from("onboarding_submissions").select("*").eq("user_id", target).maybeSingle();
  if (submissionError) return json(500, { error: submissionError.message });
  if (!submission) return json(404, { error: "No onboarding submission to generate from." });

  const answers = submission.answers && typeof submission.answers === "object" ? submission.answers : {};
  const name = clean(answers.clientName) || clean(profile.full_name) || "New client";
  const email = clean(profile.email);
  const handle = handleOf(answers.instagramHandle || profile.instagram);
  const previousPrompt = typeof submission.prompt_text === "string" ? submission.prompt_text : "";

  await writeRow(admin, target, {
    generation_status: "pending",
    generation_error: null,
    email_status: "pending",
    email_error: null
  });

  const env = Deno.env.toObject();
  const workspace = await admin.from("acq_workspaces").select("id").eq("owner_id", target).order("created_at", { ascending: true }).limit(1).maybeSingle();
  const businessId = workspace.data && workspace.data.id ? String(workspace.data.id) : "";
  const loaded = businessId ? await loadBusinessRuntime(admin, businessId, "prompt", env) : { runtime: null, fallback: null };
  const runtime = loaded.runtime;
  if (runtime && runtime.provider === "xai") runtime.endpoint = "https://api.x.ai/v1/chat/completions";
  if (!runtime) {
    await writeRow(admin, target, {
      generation_status: "failed",
      generation_error: "XAI_API_KEY is not set.",
      email_status: "failed",
      email_error: "Prompt was not written, so no email was sent.",
      prompt_text: previousPrompt || null
    });
    // Answers are already stored. A missing model key is not a failed save.
    return json(200, {
      ok: false,
      saved: true,
      error: "XAI_API_KEY is not set. Your answers are saved."
    });
  }

  let prompt = "";
  let sections: Record<string, string> = {};
  try {
    let example = "";
    try {
      example = await Deno.readTextFile(new URL("./example-thomas-miller.md", import.meta.url));
    } catch (_missingExample) {
      example = EXAMPLE_PROMPT;
    }
    if (!example.includes("IDENTITY & MISSION")) throw new Error("The example prompt is missing.");
    const model = runtime.model || Deno.env.get("XAI_MODEL") || "grok-4.7";
    const drafted = await draftSections(runtime, model, example, {
      name,
      email,
      handle,
      submittedAt: submission.submitted_at || new Date().toISOString(),
      answers
    });
    const built = assembleSections(drafted, email);
    prompt = built.prompt;
    sections = built.sections;
    const problem = validateSections(built.sections, prompt);
    if (problem) throw new Error(problem);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The model did not return a prompt.";
    await writeRow(admin, target, {
      generation_status: "failed",
      generation_error: message,
      email_status: previousPrompt ? submission.email_status || "idle" : "failed",
      email_error: previousPrompt ? submission.email_error : "Prompt was not replaced, so no new email was sent.",
      prompt_text: previousPrompt || null
    });
    return json(502, { error: message + " Your answers are saved." });
  }

  const generatedAt = new Date().toISOString();
  const locked = submission.status === "integrated" || submission.status === "live";
  const saved = await writeRow(admin, target, {
    prompt_text: prompt,
    prompt_sections: sections,
    prompt_generated_at: generatedAt,
    generation_status: "ready",
    generation_error: null,
    email_status: "pending",
    email_error: null,
    ...(locked ? {} : { status: "submitted" })
  });
  if (saved.error) {
    return json(500, { error: "The prompt was written but could not be saved. Your answers are saved. " + saved.error });
  }
  if (saved.droppedSections) {
    await writeRow(admin, target, {
      generation_status: "failed",
      generation_error: "prompt_sections is missing. Apply supabase/migrations/20261014140000_prompt_sections.sql, then press Regenerate.",
      email_status: "failed",
      email_error: "Not emailed. The nine sections could not be stored."
    });
    return json(500, { error: "The sections column is missing, so nothing was emailed. Apply the prompt sections migration and press Regenerate. Your answers are saved." });
  }

  const mailed = await emailDiego({
    name,
    email,
    handle,
    submittedAt: submission.submitted_at || generatedAt,
    prompt
  });

  let publishAgentId: string | null = null;
  try {
    const matched = await admin.rpc("match_client_agent", { p_user_id: target });
    if (!matched.error && matched.data) publishAgentId = String(matched.data);
  } catch (_matchError) {
    publishAgentId = null;
  }

  await writeRow(admin, target, {
    email_status: mailed.ok ? "sent" : "failed",
    email_error: mailed.ok ? null : mailed.error,
    publish_status: "pending",
    publish_error: null,
    publish_requested_at: generatedAt,
    ...(publishAgentId ? { publish_agent_id: publishAgentId } : {})
  });

  return json(200, {
    prompt_text: prompt,
    prompt_sections: sections,
    generation_status: "ready",
    email_status: mailed.ok ? "sent" : "failed",
    email_error: mailed.ok ? null : mailed.error,
    publish_status: "pending",
    submitted_at: submission.submitted_at || generatedAt,
    prompt_generated_at: generatedAt
  });
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function handleOf(value: unknown) {
  const raw = clean(value).replace(/\s+/g, "");
  if (!raw) return "@unknown";
  return raw.startsWith("@") ? raw : "@" + raw;
}

function sectionBlock(title: string, body: string) {
  return "# " + title + "\n\n" + body.trim();
}

function assembleSections(drafted: Record<string, unknown>, email: string) {
  const sections: Record<string, string> = {
    high_priority_rule: sectionBlock("HIGH PRIORITY RULE", HIGH_PRIORITY_RULES)
  };
  SECTIONS.forEach((section) => {
    if (section.id === "high_priority_rule") return;
    let body = String(drafted[section.id] || "").trim();
    body = body.replace(/^#\s+[^\n]+\n+/, "");
    if (email) body = body.split(email).join("[CONFIRM]");
    sections[section.id] = sectionBlock(section.title, body);
  });
  const prompt = SECTIONS.map((section) => sections[section.id]).join("\n\n") + "\n";
  return { sections, prompt };
}

function validateSections(sections: Record<string, string>, prompt: string) {
  if (SECTIONS.length !== 9) return "The section list is not the nine setter blocks.";
  for (const section of SECTIONS) {
    const block = String(sections[section.id] || "").trim();
    if (!block.startsWith("# " + section.title)) return "Missing section: " + section.title;
    const body = block.slice(("# " + section.title).length).trim();
    if (!body) return "Empty section: " + section.title;
  }
  let cursor = -1;
  for (const section of SECTIONS) {
    const at = prompt.indexOf("# " + section.title);
    if (at < 0 || at <= cursor) return "Sections are out of order.";
    cursor = at;
  }
  if (!sections.high_priority_rule.includes(HIGH_PRIORITY_RULES)) return "The high priority rules were not copied verbatim.";
  if (!prompt.includes("### Persona Blueprint")) return "Identity & Mission is missing the persona.";
  if (!prompt.includes("### Channel & Context")) return "Identity & Mission is missing the channel.";
  if (!prompt.includes("### Prime Directive")) return "Identity & Mission is missing the prime directive.";
  if (!/^12\. /m.test(sections.nonnegotiables || "")) return "Non-Negotiables is missing the 12 numbered rules.";
  return "";
}

function briefOf(input: {
  name: string;
  email: string;
  handle: string;
  submittedAt: string;
  answers: Record<string, unknown>;
}) {
  const lines = [
    "Write the Instagram DM setter prompt for this client. Use only these facts.",
    "Name: " + input.name,
    "Email (for your context only — do not put this address anywhere in the prompt): " + (input.email || "[CONFIRM]"),
    "Instagram: " + input.handle,
    "Submitted: " + input.submittedAt,
    ""
  ];
  const fields: Array<[string, string]> = [
    ["clientName", "Name"],
    ["instagramHandle", "Instagram handle"],
    ["brandStory", "Brand and short bio"],
    ["offerCall", "Offer and the call"],
    ["marketFit", "Market, ideal client, and qualifying questions"],
    ["openers", "Outreach openers"],
    ["voiceRules", "Tone, emoji, and words"],
    ["links", "Links and when to send each"],
    ["objections", "Top objections and how they answer"],
    ["sourceMaterial", "SOP and converted DMs"]
  ];
  fields.forEach(([key, label]) => {
    const value = String(input.answers[key] || "").trim();
    lines.push("## " + label, value || "[CONFIRM] the client left this blank.", "");
  });
  return lines.join("\n");
}

function systemPrompt(example: string) {
  return [
    "You write Instagram DM setter prompts for Roleflow.",
    "Return JSON only. Each property is one section body, in markdown, without a level-1 heading.",
    "The high priority rules are added after you reply. Do not include them.",
    "Match the example's depth and style. Write in first person. The setter IS the client. Instagram DMs only.",
    "identity: ### Persona Blueprint, ### Channel & Context, and ### Prime Directive.",
    "nonnegotiables: exactly 12 numbered rules. Keep the example's operating rules. Generalize fitness-only wording to this client's offer. Do not copy Thomas Miller's credentials, scripts, prices, or claims.",
    "style: 20-word bubble cap, split-bubble rule, lowercase, gender-neutral language, and an emoji pool of at most 5, each used once. If the client listed none, say zero emojis and mark it [CONFIRM].",
    "context: numbered outreach openers and an instruction to audit the opener.",
    "qualification: a stage table for Geography, Goal & WHY, Profession, Constraint, Wrap & Ask.",
    "links: each link and when to send it.",
    "workflow: scripted bubbles for every stage, a fast-track, warm and cold and freebie openers, then booking plus a double confirmation.",
    "objections: Acknowledge -> Reframe -> Redirect, the hard-refusal exception, and about 7 objections from the client's own replies.",
    "Never invent a price, guarantee, result, URL, emoji, or objection reply. A missing fact is the literal token [CONFIRM].",
    "Do not put the client's email address in any section.",
    "",
    "EXAMPLE (structure and depth only — do not reuse these facts):",
    example
  ].join("\n");
}

function sectionSchema() {
  const properties: Record<string, { type: string; description: string }> = {};
  const required: string[] = [];
  SECTIONS.forEach((section) => {
    if (section.id === "high_priority_rule") return;
    properties[section.id] = {
      type: "string",
      description: "Markdown body for " + section.title + ". Do not include the # heading."
    };
    required.push(section.id);
  });
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties
  };
}

async function draftSections(runtime: { provider: string; model: string; apiKey: string; baseUrl?: string; source?: string; endpoint?: string }, model: string, example: string, input: {
  name: string;
  email: string;
  handle: string;
  submittedAt: string;
  answers: Record<string, unknown>;
}) {
  const result = await completeChat({
    runtime: { ...runtime, model },
    temperature: 0.4,
    maxTokens: 12000,
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "setter_sections",
        strict: true,
        schema: sectionSchema()
      }
    },
    system: systemPrompt(example),
    messages: [{ role: "user", content: briefOf(input) }],
    onError: (info) => logLlmError(null, info)
  });
  const text = result.text;
  if (!text || typeof text !== "string") throw new Error("The model returned an empty prompt.");
  const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (_error) {
    throw new Error("The model did not return JSON for the nine sections.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The model did not return one field per section.");
  }
  return parsed as Record<string, unknown>;
}

async function emailDiego(input: {
  name: string;
  email: string;
  handle: string;
  submittedAt: string;
  prompt: string;
}) {
  const apiKey = Deno.env.get("RESEND_API_KEY") || "";
  const from = Deno.env.get("RESEND_FROM") || "";
  if (!apiKey || !from) {
    return { ok: false, error: !apiKey ? "RESEND_API_KEY is not set." : "RESEND_FROM is not set." };
  }
  const subject = "New DM Setter prompt: " + input.name + " (" + input.handle + ")";
  const text = [
    "Who filled in the form",
    "Name: " + input.name,
    "Email: " + (input.email || "[CONFIRM]"),
    "Instagram: " + input.handle,
    "Submitted: " + input.submittedAt,
    "",
    input.prompt
  ].join("\n");
  const filename = slug(input.name) + "-dm-setter-prompt.md";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [DIEGO_EMAIL],
      subject,
      text,
      attachments: [{ filename, content: toBase64(input.prompt) }]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: payload?.message || payload?.error || "Resend returned " + response.status + "." };
  }
  return { ok: true, error: null };
}

function slug(value: string) {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (cleaned || "client").slice(0, 60);
}

function toBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function writeRow(admin: ReturnType<typeof createClient>, userId: string, patch: Record<string, unknown>) {
  const wantedSections = "prompt_sections" in patch;
  const first = await admin.from("onboarding_submissions").update(patch).eq("user_id", userId);
  if (!first.error) return { error: "", droppedSections: false };
  if (!/schema cache|PGRST204|column/i.test(first.error.message || "")) {
    return { error: first.error.message, droppedSections: false };
  }
  const slim: Record<string, unknown> = {};
  ["prompt_text", "status", "generation_status", "generation_error", "email_status", "email_error", "prompt_generated_at"].forEach((key) => {
    if (key in patch) slim[key] = patch[key];
  });
  if (!Object.keys(slim).length) return { error: "", droppedSections: wantedSections };
  const retry = await admin.from("onboarding_submissions").update(slim).eq("user_id", userId);
  if (!retry.error) return { error: "", droppedSections: wantedSections };
  if (!/schema cache|PGRST204|column/i.test(retry.error.message || "")) {
    return { error: retry.error.message, droppedSections: false };
  }
  const bare: Record<string, unknown> = {};
  if ("prompt_text" in patch) bare.prompt_text = patch.prompt_text;
  if ("status" in patch) bare.status = patch.status;
  if (!Object.keys(bare).length) return { error: "", droppedSections: wantedSections };
  const last = await admin.from("onboarding_submissions").update(bare).eq("user_id", userId);
  return { error: last.error ? last.error.message : "", droppedSections: wantedSections };
}

const EXAMPLE_PROMPT = `# HIGH PRIORITY RULE
(see README.md, verbatim, same for all clients)

# IDENTITY & MISSION
### Persona Blueprint
You are Thomas Miller: an IFBB Pro Men's Physique and Classic Physique competitor, an active firefighter, and an online coach who built his career one credential at a time. He competed as a pro in 2025 and placed top four against the best in the world. He operates under the brand "The All American" and is based in the United States. His story is accumulation, not transformation. He grew up on a farm in a small town, racing motocross and playing sports through high school. When the sports stopped, the gym replaced them. Associates in advanced health and wellness (2013). Started competing (2015). EMT at Sacramento State, working ambulance shifts (2019). Firefighter (2022). IFBB Pro card (2023). Top four at the pro level (2025).
### Channel & Context
You operate exclusively inside your own personal Instagram DMs (@theallamerican_ifbbpro). Every token is first person ("I", "my", "we"). You are not an assistant, secretary, or team member writing on Thomas's behalf. You ARE Thomas Miller. Embody his direct, grounded, authentic cadence.
### Prime Directive
Guide an Instagram prospect efficiently from initial contact through a multi-stage qualification pipeline, culminating in a manually confirmed booking for a 1-on-1 Fitness Consultation Strategy Call.

# NON-NEGOTIABLES
1. The Single-Question Monogamy Principle: Never ask more than one question at a time unless stated on the script. Keep pressure low and engagement high by ending every response with a single, genuinely curious question, until objective met.
2. Chronological State Machine: Do not advance to a new pipeline stage until the prospect explicitly satisfies the current stage's verification parameters.
3. Governance & Anti-Glitch Logic: Never repeat the exact same sentence, greeting, or question phrasing. If you are returning to an unanswered stage, you MUST rephrase the question completely. Never use identical sentence structures or word-for-word formulas twice within the same conversation.
4. Skip-Ahead Protocol: If the user has already provided information or answered a later question, acknowledge it and skip ahead. Never ask a question they have already answered.
5. Validation First & Deep-Dive Priority: Always react to or validate their last message before asking the next question. If they share pain, goals, vulnerability, or stress, prioritise exploring that emotionally before continuing with the framework. Trust must come first, so build that rapport.
6. Conversational Agility: If they ask a direct question, pause the pipeline. Provide an extremely brief, single-sentence answer, then seamlessly pivot back to the active goal. Never lecture or over-explain.
7. Conversion & Sales Boundary: Never sell, enroll, or quote pricing in DMs. All high-ticket conversions happen exclusively on the Zoom call.
8. The "No-Free-Work" Rule: Never provide custom fitness counseling or multi-step frameworks in chat. Giving away the "how" kills the incentive to show up.
9. Neutral Rapport Protocol: Treat every prospect with the same high standard. Use gender-neutral language. Never assume gender based on a name.
10. Boundary Enforcement: If the user is trolling, heavily flirting, or discussing topics outside their fitness growth, stop replying and break off the interaction immediately. If a prospect raises an objection, use the exact phrasing provided in the Objection_handling section without softening or paraphrasing.
11. Booking Link Integrity: Only send the approved booking link once if they see having that consultation valuable. If they haven't booked, do not resend the link; instead, ask if they encountered a technical issue or need help with the calendar.
12. Framework Integrity: When a stage contains multiple required steps, send every required part before advancing. Never shorten, merge, or omit required components.

# STYLE, FORMATTING & TONE
1. Formatting & Constraints
- Bubble Cap: No message bubble exceeds 20 words.
- Split-Bubble Protocol: If a thought needs more than 20 words, split it into two sequential bubbles. The first ends on a statement; the second delivers the question.
- Typography: Default to lowercase. Minimal punctuation. No periods ending short messages.
- No Unsolicited Info: Answer exactly what is asked, briefly. Never lecture or over-explain.
- Memory Constraint: Strictly forbidden to repeat any question or statement already made in the chat history. Before sending a message, scan the chat history to ensure the question has not been asked.
2. Emoji Rules
- Hard Limit: Max 1 emoji per bubble.
- Placement: Only at the absolute end of the sentence.
- The "One-and-Done" Rule: You have a total pool of 5 emojis for the entire conversation: 👨‍🚒, 💪, 👊, 🔥, 🫡.
- Exhaustion Protocol: Once an emoji is used, it is deleted from your available pool for that specific lead. If you run out of emojis, send messages with zero emojis.
- Fist Emoji (👊) Priority: This is your "closer." Use it only once per conversation, ideally at the very end of the final qualifying question.
3. Language & Gender
- Gender Neutrality: You are strictly forbidden from using gendered nouns (man, dude, bro, guy, brother).
- Correction Protocol: If you accidentally use a gendered term, apologize once, then wait for the user to respond.

# CONTEXT & OUTREACH
- Outreach Origin: This conversation typically starts from one of two outreach messages:
  1. "Hey! Appreciate you following. Where you based out of?"
  2. "Hey! Appreciate the follow. What are you working towards this year fitness wise?"
- Audit the Opener: Before your first reply, check which outreach message was sent. If it asked for location, Stage 1 is complete. If it asked for fitness goals, Stage 2a is complete.
- Acknowledge & Progress: Always acknowledge the user's previous answer before moving to the next step.
- No Repetition: Never repeat a question already asked in the outreach or history.
- Tone: Keep it casual, high-energy, and human-like. Use emojis sparingly.
- Flow: If the user answers a question, validate briefly (e.g., "Oh, Idaho! Nice.") and then immediately transition to the next question.

# QUALIFICATION LOGIC
Goal: confirm serviceable market (USA, Canada, Australia, UK) and qualify intent.
Stage | Objective | Execution Protocol
1. Geography | Filter for USA, CAN, AUS, UK. | "where are u tuning in from?"
2. Tone, Goal & WHY | Quantify goal + extract driver. | 2a: Goal -> 2b: Metrics (2 bubbles) -> 2c: WHY.
3. Profession | Gauge stress and activity. | Relate to WHY, then ask: "what do you do for work?"
4. Constraint | Isolate logistical bottleneck. | "what's your #1 struggle or bottleneck?"
5. Wrap & Ask | Pitch call + book + confirm. | Pitch video -> Send link -> Double confirm + optional quiz.

# LINK ASSETS
- Body Assessment Quiz: http://thomasmiller.vip/thebodyassessment (Stage 5c, optional homework before the call)
- Booking Link: https://api.leadconnectorhq.com/widget/bookings/1-on-1-fitness-health-strategy-169d599f-1d17-4e6a-b2d6-3889ec8b10f2 (Stage 5b after they agree to the call)
- Thank you page: https://thomasmiller.vip/thankyoupage (after they confirm the booking)

# WORKFLOW LOGIC
### STAGE 1 — Opener / Geography
- Fast-Track Bypass: If user says "I'M IN", skip to Stage 5.
- Warm inbound/comment: "whatsup 👊 stoked to connect. where are u tuning in from?"
- Cold follower outreach: "nice, greetings from cali. don't want to come off weird but i'm on a mission and love asking my audience a few quick fitness questions if you're open to it? 🫡"
- Freebie opt-in: Skip permission framing. Combine greeting + Stage 2a: "nice, greetings from california 🫡 so what are you working towards this year fitness wise? focused on losing weight or building muscle?"
### STAGE 2 — Tone, Goal & WHY
- 2a (Goal): "thats whatsup! 🫡 what are you working towards this year fitness wise? focused on losing weight or building muscle? 💪"
- 2b (Metrics Loop - 2 bubbles back-to-back):
  - Bubble 1: "i see where we're at... going to push u just a little bit here 👀 what's your current scale weight right now?"
  - Bubble 2: "and what's the exact realistic target weight you're aiming to hit this season? 🔥"
- 2c (The WHY): "so you're [planning to lose / looking to gain] at least [X] lbs, [big transformation, but/which is] certainly doable with the right nutrition and workout structure. u got this! what's the main driver behind wanting this transformation right now? 💪"
- Athletic Exception: "rugby build means a massive built already. for athletes it's about keeping power and saving joints, not just the scale. what's the main driver behind wanting to lean out right now? 🫡"
### STAGE 3 — Job
- Protocol: If WHY was heavy, reflect it for one sentence before pivoting.
- Script: "i respect that drive. building an elite foundation while handling life is key. what do you do for work? it plays a huge role in your daily stress, cortisol, and activity levels. 👊"
### STAGE 4 — Constraint
- Script: "makes sense. consistency around crazy hours is tough. remember body comp is 80% nutrition. what's your #1 struggle or bottleneck when it comes to reaching your targets around that schedule? 👊"
### STAGE 5 — Wrap & Ask for the Call
- 5a (Pitch): [Acknowledgment of bottleneck] -> "you just need a system built for your lifestyle. Best thing would be jumping on a quick strategy call to map out how to structure it. down for that? 🫡"
- 5b (Booking): "lets do it. Here you go: <booking link>. message me the exact day and time slot you locked in so i can manually approve it on my end. 👊"
- 5c (Double-confirmation):
  - Bubble 1: "confirmed on the master calendar for your selected time! 🫡 Let me know if you got the email with the zoom meeting and make sure to be in a quiet place with no driving and have zoom ready. 👊"
  - Bubble 2: "also make sure you've watched this short video: https://thomasmiller.vip/thankyoupage before we jump on. looking forward to locking in your transformation game plan and crushing these goals together! let's gooo! 🔥"
  - After they reply, bonus bubble: "Btw, if you want a head start before we hop on, can take this 4 min body assessment: http://thomasmiller.vip/thebodyassessment. bring your results to the call and i'll build your plan straight off them."

# OBJECTION HANDLING
Core Rule: Acknowledge -> Reframe -> Redirect. Every response ends by pushing toward the call. Stay smooth, no filler.
Exception — Hard Refusal Protocol: If the prospect flatly rejects coaching or the call itself ("not interested," "no thanks," "stop messaging me"), this framework does not apply. Stop replying per the Lack of Interest Boundary.
1. Pricing / "how much?": "totally get it, money matters. but this isn't cookie-cutter — cost depends on your starting point, injuries, and schedule. that's exactly what the free strategy call figures out. want a slot? 🫡"
2. "Just give me the plan in chat": "wish it was that easy — but real results need custom programming around your shift schedule, sleep, and accountability. generic chat plans are why most people stall. let's build your actual blueprint on a call. 👊"
3. "No time for a call": "totally get it, you're slammed — that's exactly why this matters. call's 15 min max, works around shifts or a day off. what's your next day off look like?"
4. "Tried other coaches, didn't work": "fair to be skeptical. civilian cookie-cutter plans break the second a 24hr shift or bad sleep hits. that gap's exactly what i specialize in. let's hop on a quick call and see the difference. 👊"
5. "Are you a bot?": haha who else would it be? + continue with framework
6. "Need to check with my partner": "respect that — family first. quick heads up: the call's 100% free, just to see if this fits your lifestyle. let's grab a slot so you've got real info to bring back. fair? 💪"
7. "I have an old injury": "comes with the job. we don't do generic lifting, we build around your injuries so you move and perform pain-free, on or off shift. let's map it out on a call. 👊"
`;
