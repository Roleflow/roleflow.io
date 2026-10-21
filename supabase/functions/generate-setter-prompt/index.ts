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

  const xaiKey = Deno.env.get("XAI_API_KEY") || "";
  if (!xaiKey) {
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
    const example = await Deno.readTextFile(new URL("./example-thomas-miller.md", import.meta.url));
    const model = Deno.env.get("XAI_MODEL") || "grok-4.7";
    const drafted = await draftSections(xaiKey, model, example, {
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

async function draftSections(apiKey: string, model: string, example: string, input: {
  name: string;
  email: string;
  handle: string;
  submittedAt: string;
  answers: Record<string, unknown>;
}) {
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_completion_tokens: 12000,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "setter_sections",
          strict: true,
          schema: sectionSchema()
        }
      },
      messages: [
        { role: "system", content: systemPrompt(example) },
        { role: "user", content: briefOf(input) }
      ]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || "xAI returned " + response.status + ".";
    throw new Error(message);
  }
  const choice = payload?.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error("The model response was cut off.");
  const text = choice?.message?.content;
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
