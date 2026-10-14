/* Turns the short intake into the Tailortalk section contract.
   The live prompt is written by the edge function. This builder is the
   structure check and the local sample: same section order, same depth. */
(function (root) {
  "use strict";

  function text(value) {
    if (value == null) return "";
    if (Array.isArray(value)) {
      return value.map(function (item) { return text(item); }).filter(Boolean).join("\n");
    }
    return String(value).replace(/\r\n/g, "\n").trim();
  }

  function allFields(config) {
    return config.QUESTIONS.flatMap(function (step) { return step.fields; });
  }

  function isShown(field, answers) {
    if (root.RoleflowForm && root.RoleflowForm.isVisible) return root.RoleflowForm.isVisible(field, answers);
    return true;
  }

  function optionLabel(field, value) {
    var match = (field.options || []).find(function (option) { return option.value === value; });
    return match ? match.label : String(value);
  }

  function linesOf(value) {
    return text(value).split("\n").map(function (line) { return line.trim(); }).filter(Boolean);
  }

  function handleOf(value) {
    var raw = text(value).replace(/\s+/g, "");
    if (!raw) return "[CONFIRM]";
    return raw.charAt(0) === "@" ? raw : "@" + raw;
  }

  function brandName(story, name) {
    var first = linesOf(story)[0] || "";
    var cut = first.split(/[.]/)[0].trim();
    if (cut && cut.length <= 60) return cut;
    return text(name) || "[CONFIRM]";
  }

  function questionsIn(value) {
    var found = [];
    linesOf(value).forEach(function (line) {
      var parts = line.split("?");
      if (line.indexOf("?") === -1) return;
      parts.forEach(function (part, index) {
        if (index === parts.length - 1 && !line.endsWith("?")) return;
        var question = part.replace(/^[^A-Za-z0-9]+/, "").trim();
        if (question) found.push(question.replace(/\?$/, "") + "?");
      });
    });
    return found;
  }

  function emojisIn(value) {
    var found = String(value || "").match(/\p{Extended_Pictographic}/gu) || [];
    var unique = [];
    found.forEach(function (item) {
      if (unique.indexOf(item) === -1) unique.push(item);
    });
    return unique.slice(0, 5);
  }

  function urlsIn(value) {
    var matches = text(value).match(/https?:\/\/[^\s)]+/g) || [];
    return matches.map(function (url) { return url.replace(/[.,;]+$/, ""); });
  }

  function sentenceAround(source, url) {
    var body = text(source);
    var at = body.indexOf(url);
    if (at < 0) return "";
    var start = body.lastIndexOf("\n", at);
    var end = body.indexOf("\n", at);
    return body.slice(start < 0 ? 0 : start + 1, end < 0 ? body.length : end).trim();
  }

  function classifyLink(sentence) {
    var lower = sentence.toLowerCase();
    if (/book|calendar|cal\.|strategy call|fit call/.test(lower)) return "Booking link";
    if (/thank|vsl|video|pre-call|precall/.test(lower)) return "Thank-you page";
    if (/quiz|magnet|checklist|lead magnet|opt-in|opt in/.test(lower)) return "Lead magnet";
    return "Link";
  }

  function bubble(line) {
    var words = text(line).split(/\s+/).filter(Boolean);
    if (words.length <= 20) return text(line);
    return words.slice(0, 20).join(" ") + "\n- Next bubble: " + words.slice(20).join(" ");
  }

  function nonNegotiables(name) {
    return [
      "1. The Single-Question Monogamy Principle: Never ask more than one question at a time unless stated on the script. Keep pressure low and engagement high by ending every response with a single, genuinely curious question, until objective met.",
      "2. Chronological State Machine: Do not advance to a new pipeline stage until the prospect explicitly satisfies the current stage's verification parameters.",
      "3. Governance & Anti-Glitch Logic: Never repeat the exact same sentence, greeting, or question phrasing. If you are returning to an unanswered stage, you MUST rephrase the question completely. Never use identical sentence structures or word-for-word formulas twice within the same conversation.",
      "4. Skip-Ahead Protocol: If the user has already provided information or answered a later question, acknowledge it and skip ahead. Never ask a question they have already answered.",
      "5. Validation First & Deep-Dive Priority: Always react to or validate their last message before asking the next question. If they share pain, goals, vulnerability, or stress, prioritise exploring that emotionally before continuing with the framework. Trust must come first, so build that rapport.",
      "6. Conversational Agility: If they ask a direct question, pause the pipeline. Provide an extremely brief, single-sentence answer, then seamlessly pivot back to the active goal. Never lecture or over-explain.",
      "7. Conversion & Sales Boundary: Never sell, enroll, or quote pricing in DMs. All high-ticket conversions happen exclusively on the call.",
      "8. The \"No-Free-Work\" Rule: Never provide a custom plan or multi-step framework in chat. Giving away the \"how\" kills the incentive to show up.",
      "9. Neutral Rapport Protocol: Treat every prospect with the same high standard. Use gender-neutral language. Never assume gender based on a name.",
      "10. Boundary Enforcement: If the user is trolling, heavily flirting, or discussing topics outside the offer, stop replying and break off the interaction immediately. If a prospect raises an objection, use the exact phrasing provided in the Objection Handling section without softening or paraphrasing.",
      "11. Booking Link Integrity: Only send the approved booking link once, after they see the call as valuable. If they haven't booked, do not resend the link; instead, ask if they encountered a technical issue or need help with the calendar.",
      "12. Framework Integrity: When a stage contains multiple required steps, send every required part before advancing. Never shorten, merge, or omit required components."
    ].join("\n").replace("the offer", text(name) ? "what " + text(name) + " sells" : "the offer");
  }

  function styleSection(voice) {
    var pool = emojisIn(voice);
    var emojiRules = pool.length
      ? [
          "- Hard Limit: Max 1 emoji per bubble.",
          "- Placement: Only at the absolute end of the sentence.",
          "- The \"One-and-Done\" Rule: You have a total pool of " + pool.length + " emoji" + (pool.length === 1 ? "" : "s") + " for the entire conversation: " + pool.join(", ") + ".",
          "- Exhaustion Protocol: Once an emoji is used, it is deleted from your available pool for that specific lead. If you run out of emojis, send messages with zero emojis.",
          pool.length >= 5 ? "" : "- [CONFIRM] the client listed fewer than five emojis. Do not add any emoji that is not in this pool."
        ].filter(Boolean).join("\n")
      : [
          "- Hard Limit: The client did not list an emoji pool.",
          "- [CONFIRM] before go-live if any emoji is allowed. Until then, send messages with zero emojis.",
          "- Do not invent an emoji."
        ].join("\n");
    return [
      "1. Formatting & Constraints",
      "- Bubble Cap: No message bubble exceeds 20 words.",
      "- Split-Bubble Protocol: If a thought needs more than 20 words, split it into two sequential bubbles. The first ends on a statement; the second delivers the question.",
      "- Typography: Default to lowercase. Minimal punctuation. No periods ending short messages.",
      "- No Unsolicited Info: Answer exactly what is asked, briefly. Never lecture or over-explain.",
      "- Memory Constraint: Strictly forbidden to repeat any question or statement already made in the chat history. Before sending a message, scan the chat history to ensure the question has not been asked.",
      "2. Emoji Rules",
      emojiRules,
      "3. Language & Gender",
      "- Gender Neutrality: You are strictly forbidden from using gendered nouns (man, dude, bro, guy, brother).",
      "- Correction Protocol: If you accidentally use a gendered term, apologize once, then wait for the user to respond.",
      "4. Client vocabulary",
      text(voice) || "[CONFIRM] tone and vocabulary."
    ].join("\n");
  }

  function contextSection(openers, source) {
    var openerLines = linesOf(openers);
    var listed = openerLines.length
      ? openerLines.map(function (line, index) { return "  " + (index + 1) + ". \"" + line + "\""; }).join("\n")
      : "  1. [CONFIRM] the client did not paste an opener. Do not invent one.";
    var audit = openerLines.length > 1
      ? "Before your first reply, check which outreach message was sent. If it already asked one of the qualifying questions, that stage is complete."
      : "Before your first reply, check whether the opener already asked a qualifying question. If it did, that stage is complete.";
    var sourceBlock = text(source)
      ? "\n\nSource material from the client (SOP and converted threads). Mirror the voice. Do not copy a thread word for word, and do not treat details from an old thread as facts about the person you are talking to now.\n\n" + text(source)
      : "\n\nSource material: [CONFIRM] the client did not paste an SOP or a converted thread.";
    return [
      "- Outreach Origin: This conversation typically starts from one of these outreach messages:",
      listed,
      "- Audit the Opener: " + audit,
      "- Acknowledge & Progress: Always acknowledge the user's previous answer before moving to the next step.",
      "- No Repetition: Never repeat a question already asked in the outreach or history.",
      "- Tone: Keep it casual and human. Use emojis only from the pool in Style.",
      "- Flow: If the user answers a question, validate briefly, then move to the next unanswered stage."
    ].join("\n") + sourceBlock;
  }

  function qualificationSection(market) {
    var questions = questionsIn(market);
    function q(index, fallback) {
      return questions[index] || fallback;
    }
    return [
      "Goal: confirm the market and qualify intent, using only what the client wrote.",
      "Client notes:",
      text(market) || "[CONFIRM]",
      "",
      "Stage | Objective | Execution Protocol",
      "1. Geography | Filter for the countries in the client notes. | \"" + q(0, "where are you based?") + "\"",
      "2. Tone, Goal & WHY | Quantify the goal and the driver. | 2a: \"" + q(1, "[CONFIRM] the goal question") + "\" -> 2b: metrics they named -> 2c: why now.",
      "3. Profession | Gauge how they spend the day. | \"" + q(2, "what do you do for work?") + "\"",
      "4. Constraint | Isolate the bottleneck. | \"" + q(3, "what's the main thing in the way?") + "\"",
      "5. Wrap & Ask | Pitch the call, book, and confirm. | Use the booking link only after they agree."
    ].join("\n");
  }

  function linkSection(raw) {
    var urls = urlsIn(raw);
    if (!urls.length) {
      return [
        "- Booking link: [CONFIRM] no URL in the client's notes. Do not invent one.",
        "- Thank-you page: [CONFIRM] no URL in the client's notes. Do not invent one.",
        "- Lead magnet: [CONFIRM] no URL in the client's notes. Do not invent one.",
        "",
        "Client notes:",
        text(raw) || "[CONFIRM]"
      ].join("\n");
    }
    var used = { "Booking link": false, "Thank-you page": false, "Lead magnet": false };
    var blocks = urls.map(function (url) {
      var around = sentenceAround(raw, url);
      var label = classifyLink(around);
      used[label] = true;
      var when = around.replace(url, "").replace(/^[\s:—\-]+|[\s:—\-]+$/g, "").trim();
      return "- " + label + ": " + url + (when ? " (" + when + ")" : " ([CONFIRM] when to send this)");
    });
    ["Booking link", "Thank-you page", "Lead magnet"].forEach(function (label) {
      if (!used[label]) blocks.push("- " + label + ": [CONFIRM] the client did not give this URL. Do not invent one.");
    });
    return blocks.join("\n");
  }

  function firstUrl(raw, kind) {
    var urls = urlsIn(raw);
    for (var i = 0; i < urls.length; i += 1) {
      if (classifyLink(sentenceAround(raw, urls[i])) === kind) return urls[i];
    }
    return "";
  }

  function workflowSection(answers) {
    var openers = linesOf(answers.openers);
    var questions = questionsIn(answers.marketFit);
    var booking = firstUrl(answers.links, "Booking link") || "[CONFIRM booking link]";
    var thanks = firstUrl(answers.links, "Thank-you page") || "[CONFIRM thank-you page]";
    var magnet = firstUrl(answers.links, "Lead magnet");
    var warm = openers[0] || "[CONFIRM] warm opener";
    var cold = openers[1] || openers[0] || "[CONFIRM] cold opener";
    var goal = questions[1] || questions[0] || "[CONFIRM] the goal question";
    var work = questions[2] || "what do you do for work?";
    var block = questions[3] || "what's the main thing in the way?";
    var magnetLine = magnet
      ? "- After they reply, bonus bubble: \"" + bubble("if you want a head start, this is optional: " + magnet) + "\""
      : "- After they reply: do not invent a lead magnet. [CONFIRM] if one exists.";
    return [
      "### STAGE 1 — Opener / Geography",
      "- Fast-Track Bypass: If the user already asks to book or says they are in, skip to Stage 5.",
      "- Warm inbound: \"" + warm + "\"",
      "- Cold outreach: \"" + cold + "\"",
      "- Freebie opt-in: Skip the permission line. Combine a short greeting with the goal question.",
      "### STAGE 2 — Tone, Goal & WHY",
      "- 2a (Goal): \"" + bubble(goal) + "\"",
      "- 2b (Metrics): Use the metric the client named in the market notes. If they named none, [CONFIRM] and do not invent a number.",
      "- 2c (The WHY): \"what's the main driver behind wanting that right now?\"",
      "### STAGE 3 — Work",
      "- Protocol: If the WHY was heavy, reflect it in one short line before the question.",
      "- Script: \"" + bubble(work) + "\"",
      "### STAGE 4 — Constraint",
      "- Script: \"" + bubble(block) + "\"",
      "### STAGE 5 — Wrap & Ask for the Call",
      "- 5a (Pitch): Acknowledge the bottleneck, then \"best next step is a short call to map it. down for that?\"",
      "- 5b (Booking): \"lets do it. here you go: " + booking + ". message me the exact day and time you locked in so i can confirm it.\"",
      "- 5c (Double-confirmation):",
      "  - Bubble 1: \"confirmed for that time. check the email for the meeting link and be somewhere quiet.\"",
      "  - Bubble 2: \"watch this before we jump on: " + thanks + "\"",
      "  " + magnetLine
    ].join("\n");
  }

  function objectionSection(raw) {
    var chunks = text(raw).split(/\n\s*\n/).map(function (chunk) { return chunk.trim(); }).filter(Boolean);
    if (chunks.length === 1) chunks = linesOf(raw);
    var scripts = chunks.slice(0, 7).map(function (chunk, index) {
      var parts = chunk.split(/\s+[—–-]\s+|\s*:\s+/);
      var title = (parts[0] || chunk).trim();
      var reply = parts.slice(1).join(" ").trim() || "[CONFIRM] the client did not write the reply. Do not invent one.";
      return (index + 1) + ". " + title + ": \"" + reply + "\"";
    });
    while (scripts.length < 7) {
      scripts.push((scripts.length + 1) + ". [CONFIRM]: the client did not provide another objection. Do not invent a rebuttal.");
    }
    return [
      "Core Rule: Acknowledge -> Reframe -> Redirect. Every response ends by pushing toward the call. Stay smooth, no filler.",
      "Exception — Hard Refusal Protocol: If the prospect flatly rejects coaching or the call itself (\"not interested,\" \"no thanks,\" \"stop messaging me\"), this framework does not apply. Stop replying.",
      scripts.join("\n")
    ].join("\n");
  }

  function buildPrompt(config, answers, options) {
    var data = answers || {};
    var name = text(data.clientName) || "[CONFIRM]";
    var handle = handleOf(data.instagramHandle);
    var story = text(data.brandStory);
    var brand = brandName(story, name);
    var offer = text(data.offerCall);
    var rules = text(config.HIGH_PRIORITY_RULES);
    var banner = options && options.testBanner
      ? "> TEST DATA. Fictional client. This sample shows the required Tailortalk structure. It was not emailed and it is not a live model response.\n\n"
      : "";
    var sections = [
      "# HIGH PRIORITY RULE",
      rules,
      "# IDENTITY & MISSION",
      "### Persona Blueprint\nYou are " + name + ". " + (story || "[CONFIRM] bio.") + " You operate under the brand \"" + brand + "\".",
      "### Channel & Context\nYou operate exclusively inside your own personal Instagram DMs (" + handle + "). Every token is first person (\"I\", \"my\", \"we\"). You are not an assistant, secretary, or team member writing on " + name + "'s behalf. You ARE " + name + ".",
      "### Prime Directive\nGuide an Instagram prospect from the first message through qualification and into a manually confirmed booking. The call, in the client's words: " + (offer || "[CONFIRM] the offer and the call.") + " Never invent a price, guarantee, result, or link.",
      "# NON-NEGOTIABLES",
      nonNegotiables(name),
      "# STYLE, FORMATTING & TONE",
      styleSection(data.voiceRules),
      "# CONTEXT & OUTREACH",
      contextSection(data.openers, data.sourceMaterial),
      "# QUALIFICATION LOGIC",
      qualificationSection(data.marketFit),
      "# LINK ASSETS",
      linkSection(data.links),
      "# WORKFLOW LOGIC",
      workflowSection(data),
      "# OBJECTION HANDLING",
      objectionSection(data.objections)
    ];
    return banner + sections.join("\n\n") + "\n";
  }

  function formatAnswer(field, value) {
    if (field.type === "checkboxes") {
      var selected = Array.isArray(value) ? value : [];
      if (!selected.length) return "";
      return selected.map(function (item) { return "- " + optionLabel(field, item); }).join("\n");
    }
    if (field.type === "transcripts") {
      var items = Array.isArray(value) ? value : [];
      var blocks = [];
      items.forEach(function (item, index) {
        var body = text(item);
        if (body) blocks.push("Conversation " + (index + 1) + "\n" + body);
      });
      return blocks.join("\n\n");
    }
    return text(value);
  }

  function buildSubmission(config, answers, options) {
    var data = answers || {};
    var prompt = (options && options.promptText) || buildPrompt(config, data, options);
    var lines = [
      "# Roleflow onboarding submission",
      "",
      "Name: " + (text(data.clientName) || "Blank"),
      "Email: " + (text(data.clientEmail) || "Blank"),
      "Instagram: " + (text(data.instagramHandle) || "Blank"),
      "",
      "## Answers",
      ""
    ];
    config.QUESTIONS.forEach(function (step) {
      lines.push("### " + step.title, "");
      step.fields.forEach(function (field) {
        if (!isShown(field, data)) return;
        lines.push("**" + field.label + "**", "", formatAnswer(field, data[field.id]) || "Blank", "");
      });
    });
    lines.push("## Generated system prompt", "", prompt);
    return lines.join("\n");
  }

  function linkPairs() {
    return [];
  }

  root.RoleflowPrompt = {
    buildPrompt: buildPrompt,
    buildSubmission: buildSubmission,
    formatAnswer: formatAnswer,
    linkPairs: linkPairs
  };
})(globalThis);
