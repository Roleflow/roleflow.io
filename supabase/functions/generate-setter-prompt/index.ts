// generate-setter-prompt
//
// Builds a Tailortalk DM setter prompt from a client's short onboarding
// answers, stores it on onboarding_submissions, and emails it to Diego.
//
// Do not deploy from the repo. Deploy this folder with the Supabase
// connector after the migration supabase/migrations/20261014120000_prompt_generation.sql.
//
// Secrets (Edge Function secrets, never committed):
//   OPENAI_API_KEY   required. Chat completions. This function does not call Anthropic.
//   OPENAI_MODEL     optional. Defaults to gpt-4.1.
//   RESEND_API_KEY   required to email Diego.
//   RESEND_FROM      required. A sender already verified in Resend.
//
// Injected by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// verify_jwt stays on. The caller is the signed-in client, or an admin
// regenerating with { "user_id": "<client uuid>" }.

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

const REQUIRED_HEADINGS = [
  "# HIGH PRIORITY RULE",
  "# IDENTITY & MISSION",
  "# NON-NEGOTIABLES",
  "# STYLE, FORMATTING & TONE",
  "# CONTEXT & OUTREACH",
  "# QUALIFICATION LOGIC",
  "# LINK ASSETS",
  "# WORKFLOW LOGIC",
  "# OBJECTION HANDLING"
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
    if (!adminRow) return json(403, { error: "Only the client or a Roleflow admin can generate this prompt." });
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

  const openaiKey = Deno.env.get("OPENAI_API_KEY") || "";
  if (!openaiKey) {
    await writeRow(admin, target, {
      generation_status: "failed",
      generation_error: "OPENAI_API_KEY is not set.",
      email_status: "failed",
      email_error: "Prompt was not written, so no email was sent.",
      prompt_text: previousPrompt || null
    });
    return json(500, { error: "OPENAI_API_KEY is not set. Your answers are saved." });
  }

  let prompt = "";
  try {
    const example = await Deno.readTextFile(new URL("./example-thomas-miller.md", import.meta.url));
    const model = Deno.env.get("OPENAI_MODEL") || "gpt-4.1";
    const drafted = await draftPrompt(openaiKey, model, example, {
      name,
      email,
      handle,
      submittedAt: submission.submitted_at || new Date().toISOString(),
      answers
    });
    prompt = applyRules(stripFences(drafted), HIGH_PRIORITY_RULES);
    if (email) prompt = prompt.split(email).join("[CONFIRM]");
    const problem = validatePrompt(prompt);
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
    prompt_generated_at: generatedAt,
    generation_status: "ready",
    generation_error: null,
    email_status: "pending",
    email_error: null,
    ...(locked ? {} : { status: "submitted" })
  });
  if (saved) {
    return json(500, { error: "The prompt was written but could not be saved. Your answers are saved. " + saved });
  }

  const mailed = await emailDiego({
    name,
    email,
    handle,
    submittedAt: submission.submitted_at || generatedAt,
    prompt
  });

  await writeRow(admin, target, {
    email_status: mailed.ok ? "sent" : "failed",
    email_error: mailed.ok ? null : mailed.error
  });

  return json(200, {
    prompt_text: prompt,
    generation_status: "ready",
    email_status: mailed.ok ? "sent" : "failed",
    email_error: mailed.ok ? null : mailed.error,
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

function stripFences(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/);
  return (fenced ? fenced[1] : trimmed).trim() + "\n";
}

function applyRules(prompt: string, rules: string) {
  const heading = "# HIGH PRIORITY RULE";
  const start = prompt.indexOf(heading);
  if (start < 0) return heading + "\n" + rules + "\n\n" + prompt;
  const next = prompt.indexOf("\n# ", start + heading.length);
  if (next < 0) return prompt.slice(0, start) + heading + "\n" + rules + "\n";
  return prompt.slice(0, start) + heading + "\n" + rules + "\n" + prompt.slice(next);
}

function validatePrompt(prompt: string) {
  let cursor = -1;
  for (const heading of REQUIRED_HEADINGS) {
    const at = prompt.indexOf(heading);
    if (at < 0 || at <= cursor) return "The model response did not match the Tailortalk section contract.";
    cursor = at;
  }
  if (!prompt.includes("### Persona Blueprint")) return "The model response is missing the persona.";
  if (!prompt.includes("### Channel & Context")) return "The model response is missing the channel.";
  if (!prompt.includes("### Prime Directive")) return "The model response is missing the prime directive.";
  if (!/^12\. /m.test(prompt)) return "The model response is missing the 12 non-negotiables.";
  if (!prompt.includes(HIGH_PRIORITY_RULES)) return "The high priority rules were not copied verbatim.";
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
    "Write the Tailortalk prompt for this client. Use only these facts.",
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
    "You write Tailortalk-ready Instagram DM setter prompts for Roleflow.",
    "Output only the markdown prompt. No preface, no code fence.",
    "Match the example's structure, section order, depth, and style exactly.",
    "Required level-1 headings, in this order:",
    REQUIRED_HEADINGS.join("\n"),
    "Under IDENTITY & MISSION include ### Persona Blueprint, ### Channel & Context, and ### Prime Directive.",
    "Write in first person. The setter IS the client. Instagram DMs only.",
    "NON-NEGOTIABLES is exactly 12 numbered rules. Keep the example's operating rules. Generalize any fitness-only wording to this client's offer. Do not copy Thomas Miller's credentials, scripts, prices, or claims.",
    "STYLE includes the 20-word bubble cap, the split-bubble rule, lowercase, gender-neutral language, and an emoji pool of at most 5, each used once. If the client listed none, say zero emojis and mark it [CONFIRM].",
    "CONTEXT lists the outreach openers as a numbered list and tells the setter to audit the opener.",
    "QUALIFICATION is a stage table: Geography, Goal & WHY, Profession, Constraint, Wrap & Ask.",
    "LINK ASSETS names each link and when to send it. WORKFLOW has scripted bubbles for every stage, a fast-track, warm and cold and freebie openers, then booking plus a double confirmation.",
    "OBJECTION HANDLING uses Acknowledge -> Reframe -> Redirect, includes the hard-refusal exception, and scripts about 7 objections from the client's own replies.",
    "Never invent a price, guarantee, result, URL, emoji, or objection reply. A missing fact is the literal token [CONFIRM].",
    "Do not put the client's email address in the prompt.",
    "The HIGH PRIORITY RULE section must be copied verbatim, character for character:",
    HIGH_PRIORITY_RULES,
    "",
    "EXAMPLE (structure and depth only — do not reuse these facts):",
    example
  ].join("\n");
}

async function draftPrompt(apiKey: string, model: string, example: string, input: {
  name: string;
  email: string;
  handle: string;
  submittedAt: string;
  answers: Record<string, unknown>;
}) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_completion_tokens: 8000,
      messages: [
        { role: "system", content: systemPrompt(example) },
        { role: "user", content: briefOf(input) }
      ]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || "OpenAI returned " + response.status + ".";
    throw new Error(message);
  }
  const choice = payload?.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error("The model response was cut off.");
  const text = choice?.message?.content;
  if (!text || typeof text !== "string") throw new Error("The model returned an empty prompt.");
  return text;
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
  const first = await admin.from("onboarding_submissions").update(patch).eq("user_id", userId);
  if (!first.error) return "";
  if (!/schema cache|PGRST204|column/i.test(first.error.message || "")) return first.error.message;
  const slim: Record<string, unknown> = {};
  if ("prompt_text" in patch) slim.prompt_text = patch.prompt_text;
  if ("status" in patch) slim.status = patch.status;
  if (!Object.keys(slim).length) return "";
  const retry = await admin.from("onboarding_submissions").update(slim).eq("user_id", userId);
  return retry.error ? retry.error.message : "";
}
