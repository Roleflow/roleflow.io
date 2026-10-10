/* Assembles the Instagram DM setter prompt from config.js and the client's answers. */
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
    if (root.RoleflowForm && root.RoleflowForm.isVisible) {
      return root.RoleflowForm.isVisible(field, answers);
    }
    return true;
  }

  function optionLabel(field, value) {
    var match = (field.options || []).find(function (option) { return option.value === value; });
    return match ? match.label : String(value);
  }

  function fieldBlock(field, answers) {
    var label = field.promptLabel || field.label;
    var raw = answers[field.id];

    if (field.type === "checkboxes") {
      var selected = Array.isArray(raw) ? raw : [];
      if (!selected.length) return field.emptyPrompt ? "### " + label + "\n\n" + field.emptyPrompt : "";
      var lines = selected.map(function (value) { return "- " + optionLabel(field, value); });
      return "### " + label + "\n\n" + lines.join("\n");
    }

    if (field.type === "transcripts") {
      var items = Array.isArray(raw) ? raw : [];
      var blocks = [];
      items.forEach(function (item, index) {
        var body = text(item);
        if (!body) return;
        blocks.push("### " + (field.itemTitle || "Converted conversation") + " " + (index + 1) + "\n\n" + body);
      });
      if (!blocks.length) return field.emptyPrompt ? "### " + label + "\n\n" + field.emptyPrompt : "";
      return blocks.join("\n\n");
    }

    var body = text(raw);
    if (!body) return field.emptyPrompt ? "### " + label + "\n\n" + field.emptyPrompt : "";
    return "### " + label + "\n\n" + body;
  }

  function linkPairs(config) {
    var map = new Map();
    allFields(config).forEach(function (field) {
      if (!field.pair || field.section !== "links") return;
      if (!map.has(field.pair)) {
        map.set(field.pair, { id: field.pair, title: "", urlField: null, whenField: null, emptyText: "" });
      }
      var pair = map.get(field.pair);
      if (field.pairTitle) pair.title = field.pairTitle;
      if (field.pairRole === "when") pair.whenField = field;
      else {
        pair.urlField = field;
        if (!pair.title) pair.title = field.promptLabel || field.label;
        if (field.emptyPrompt) pair.emptyText = field.emptyPrompt;
      }
    });
    return Array.from(map.values());
  }

  function renderLinks(config, answers) {
    var consumed = new Set();
    var blocks = [];
    linkPairs(config).forEach(function (pair) {
      if (pair.urlField) consumed.add(pair.urlField.id);
      if (pair.whenField) consumed.add(pair.whenField.id);
      var urlVisible = !pair.urlField || isShown(pair.urlField, answers);
      var whenVisible = !pair.whenField || isShown(pair.whenField, answers);
      if (!urlVisible && !whenVisible) return;
      var url = urlVisible && pair.urlField ? text(answers[pair.urlField.id]) : "";
      var when = whenVisible && pair.whenField ? text(answers[pair.whenField.id]) : "";
      var lines = ["### " + (pair.title || "Link")];
      if (!url && !when) {
        lines.push("", pair.emptyText || "Not provided. Do not invent this link or claim this asset exists.");
      } else {
        lines.push("", url
          ? "URL: " + url
          : "URL: Not provided. Do not invent a URL. Ask a human for the link before you send it.");
        lines.push(when
          ? "When to send: " + when
          : "When to send: Not specified. Do not send this link until a human confirms the timing.");
      }
      blocks.push(lines.join("\n"));
    });

    allFields(config).forEach(function (field) {
      if (field.section !== "links" || consumed.has(field.id) || !isShown(field, answers)) return;
      var block = fieldBlock(field, answers);
      if (block) blocks.push(block);
    });
    return blocks.join("\n\n");
  }

  function renderSectionFields(config, sectionId, answers) {
    var blocks = [];
    allFields(config).forEach(function (field) {
      if (field.section !== sectionId || !isShown(field, answers)) return;
      var block = fieldBlock(field, answers);
      if (block) blocks.push(block);
    });
    return blocks.join("\n\n");
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

  function buildPrompt(config, answers, options) {
    var now = (options && options.now) || new Date();
    var date = now.toISOString().slice(0, 10);
    var data = answers || {};
    var business = text(data.businessName) || "Not provided";
    var handle = text(data.instagramHandle) || "Not provided";
    var founder = text(data.founderName) || "Not provided";
    var persona = text(data.personaName) || "the setter";

    var header = [
      "# Instagram DM Setter — System Prompt",
      "",
      "Business: " + business,
      "Instagram: " + handle,
      "Founder / face of the brand: " + founder,
      "Prepared: " + date,
      "",
      "You are " + persona + ", the Instagram DM setter for " + business + ". You speak for " + founder + ". Follow the nine sections below in order. When two sections conflict, section 1 (High Priority Rules) wins. Do not invent prices, results, guarantees, availability, or links.",
      "",
      "## 1. High Priority Rules",
      "",
      text(config.HIGH_PRIORITY_RULES)
    ].join("\n");

    var sections = (config.PROMPT_SECTIONS || []).map(function (section) {
      var body = section.id === "links"
        ? renderLinks(config, data)
        : renderSectionFields(config, section.id, data);

      if (section.id === "identity" && (text(data.personaName) || text(data.businessName) || text(data.founderName))) {
        var intro = "You are " + (text(data.personaName) || "the setter") + ", the Instagram DM setter for " + (text(data.businessName) || "the business named below") + ".";
        if (text(data.founderName)) {
          intro += " You represent " + text(data.founderName) + ". Do not claim to be " + text(data.founderName) + " unless the role description in this section says so.";
        }
        body = body ? intro + "\n\n" + body : intro;
      }

      var parts = ["## " + section.number + ". " + section.title];
      if (section.instructions) parts.push("", section.instructions);
      if (body) parts.push("", body);
      else parts.push("", "No client answers were provided for this section. Do not invent them. Hand off if a lead needs this information.");
      return parts.join("\n");
    });

    return [header].concat(sections).join("\n\n") + "\n";
  }

  function buildSubmission(config, answers, options) {
    var data = answers || {};
    var prompt = buildPrompt(config, data, options);
    var lines = [
      "# Roleflow onboarding submission",
      "",
      "Created in the browser on the Roleflow onboarding page. This file has the client's answers and the generated Instagram DM setter prompt. Roleflow does not receive it until someone sends this file.",
      "",
      "## Contact",
      "",
      "Name: " + (text(data.clientName) || "Blank"),
      "Email: " + (text(data.clientEmail) || "Blank"),
      "Business: " + (text(data.businessName) || "Blank"),
      "Instagram: " + (text(data.instagramHandle) || "Blank"),
      "",
      "## Answers",
      ""
    ];

    config.QUESTIONS.forEach(function (step) {
      lines.push("### " + step.title, "");
      step.fields.forEach(function (field) {
        if (!isShown(field, data)) return;
        var formatted = formatAnswer(field, data[field.id]);
        lines.push("**" + field.label + "**", "", formatted || "Blank", "");
      });
    });

    lines.push("## Generated system prompt", "", prompt);
    return lines.join("\n");
  }

  root.RoleflowPrompt = {
    buildPrompt: buildPrompt,
    buildSubmission: buildSubmission,
    formatAnswer: formatAnswer,
    linkPairs: linkPairs
  };
})(globalThis);
