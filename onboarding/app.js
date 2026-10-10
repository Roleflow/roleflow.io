/* Multi-step onboarding UI. Questions and prompt rules live in config.js. */
(function () {
  "use strict";

  if (typeof document === "undefined") return;

  var config = globalThis.ROLEFLOW_ONBOARDING_CONFIG;
  var Form = globalThis.RoleflowForm;
  var Prompt = globalThis.RoleflowPrompt;
  var app = document.getElementById("app");
  var statusEl = document.getElementById("status");

  if (!app || !config || !Form || !Prompt) {
    if (app) app.textContent = "The form could not load. Refresh the page.";
    return;
  }

  var STORAGE_KEY = "roleflow.onboarding.v1";
  var BANNER_KEY = "roleflow.onboarding.bannerDismissed";
  var reviewIndex = config.QUESTIONS.length;
  var promptIndex = reviewIndex + 1;
  var progressMax = reviewIndex + 1;

  var state = {
    stepIndex: 0,
    answers: {},
    errors: {},
    cameFromReview: false,
    banner: false,
    storageError: "",
    promptText: "",
    submissionText: ""
  };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value == null || value === false) return;
      node.setAttribute(key, value === true ? "" : String(value));
    });
    (children || []).forEach(function (child) {
      if (child == null || child === false) return;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function setStatus(message) {
    if (statusEl) statusEl.textContent = message || "";
  }

  function hasAnyAnswer(answers) {
    return Object.keys(answers || {}).some(function (key) {
      return !Form.isBlank(answers[key]);
    });
  }

  function hashFor(index) {
    if (index === reviewIndex) return "#review";
    if (index === promptIndex) return "#prompt";
    var step = config.QUESTIONS[index];
    return step ? "#" + step.id : "#about";
  }

  function indexFromHash(hash) {
    var id = String(hash || "").replace(/^#/, "");
    if (!id) return null;
    if (id === "review") return reviewIndex;
    if (id === "prompt") return promptIndex;
    var index = config.QUESTIONS.findIndex(function (step) { return step.id === id; });
    return index === -1 ? null : index;
  }

  function saveLocal() {
    var payload = {
      version: 1,
      stepIndex: state.stepIndex,
      answers: state.answers,
      savedAt: new Date().toISOString()
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      state.storageError = "";
    } catch (error) {
      state.storageError = "Couldn't save in this browser. Download your submission before you leave.";
    }
    var label = document.getElementById("save-state");
    if (label) {
      label.textContent = state.storageError || "Saved on this device";
      label.classList.toggle("warn", Boolean(state.storageError));
    }
  }

  function persist(historyMode) {
    saveLocal();
    if (historyMode === "none" || !window.history) return;
    var hash = hashFor(state.stepIndex);
    var url = window.location.pathname + window.location.search + hash;
    if (historyMode === "push" && window.location.hash !== hash) {
      history.pushState({ step: state.stepIndex }, "", url);
    } else {
      history.replaceState({ step: state.stepIndex }, "", url);
    }
  }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (!data || typeof data.answers !== "object" || data.answers == null) return;
      state.answers = data.answers;
      var index = Number(data.stepIndex);
      if (Number.isInteger(index) && index >= 0 && index <= promptIndex) state.stepIndex = index;
      var dismissed = false;
      try { dismissed = sessionStorage.getItem(BANNER_KEY) === "1"; } catch (error) { dismissed = false; }
      state.banner = hasAnyAnswer(state.answers) && !dismissed;
    } catch (error) {
      state.answers = {};
      state.stepIndex = 0;
      state.banner = false;
      setStatus("Saved progress could not be read, so the form is starting fresh.");
    }
  }

  function slug(value) {
    var raw = String(value || "client").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    var cleaned = raw.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return (cleaned || "client").slice(0, 60);
  }

  function promptFilename() {
    return slug(state.answers.businessName || state.answers.clientName) + "-dm-setter-prompt";
  }

  function submissionFilename() {
    return slug(state.answers.businessName || state.answers.clientName) + "-roleflow-onboarding.md";
  }

  function download(filename, contents, type) {
    var blob = new Blob([contents], { type: type });
    var url = URL.createObjectURL(blob);
    var link = el("a", { href: url, download: filename });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function mailtoHref() {
    var business = String(state.answers.businessName || "New client").trim();
    var file = submissionFilename();
    var body = [
      "Hi Diego,",
      "",
      String(state.answers.clientName || "A client").trim() + " finished the Roleflow DM setter onboarding.",
      "",
      "Business: " + String(state.answers.businessName || "").trim(),
      "Instagram: " + String(state.answers.instagramHandle || "").trim(),
      "Email: " + String(state.answers.clientEmail || "").trim(),
      "Offer: " + String(state.answers.offerName || "").trim(),
      "",
      "The full answers and system prompt are in the downloaded file. Please attach \"" + file + "\" before sending this email.",
      "",
      "Sent from the Roleflow onboarding page."
    ].join("\r\n");
    return "mailto:" + encodeURIComponent(config.DIEGO_EMAIL) +
      "?subject=" + encodeURIComponent("DM setter onboarding: " + business) +
      "&body=" + encodeURIComponent(body);
  }

  function ensurePrompt() {
    var options = { now: new Date() };
    state.promptText = Prompt.buildPrompt(config, state.answers, options);
    state.submissionText = Prompt.buildSubmission(config, state.answers, options);
  }

  function progressLabel() {
    if (state.stepIndex === promptIndex) return "Prompt ready";
    if (state.stepIndex === reviewIndex) return "Step " + progressMax + " of " + progressMax + " · Review";
    var step = config.QUESTIONS[state.stepIndex];
    return "Step " + (state.stepIndex + 1) + " of " + progressMax + " · " + (step ? step.title : "");
  }

  function progressBar() {
    var current = Math.min(state.stepIndex, progressMax - 1);
    var bars = [];
    for (var i = 0; i < progressMax; i += 1) {
      bars.push(el("i", { class: i <= current ? "on" : "" }));
    }
    return el("div", {
      class: "progress",
      role: "progressbar",
      "aria-valuemin": "1",
      "aria-valuemax": String(progressMax),
      "aria-valuenow": String(current + 1),
      "aria-valuetext": progressLabel()
    }, [
      el("div", { class: "prog", "aria-hidden": "true" }, bars),
      el("p", { class: "prog-label" }, [
        el("span", {}, [progressLabel()]),
        el("span", { class: state.storageError ? "save-state warn" : "save-state", id: "save-state" }, [
          state.storageError || "Saved on this device"
        ])
      ])
    ]);
  }

  function banner() {
    if (!state.banner) return null;
    return el("div", { class: "banner" }, [
      el("p", {}, ["Welcome back. Your answers were restored on this device."]),
      el("div", { class: "banner-actions" }, [
        el("button", { type: "button", class: "btn sm", "data-action": "dismiss-banner" }, ["Continue"]),
        el("button", { type: "button", class: "btn ghost sm", "data-action": "start-over" }, ["Start over"])
      ])
    ]);
  }

  function requiredMark() {
    return el("span", {}, [
      el("span", { class: "req", "aria-hidden": "true" }, ["*"]),
      el("span", { class: "sr" }, [" required"])
    ]);
  }

  function applyControl(node, field, value) {
    node.value = value || "";
    if (field.placeholder) node.setAttribute("placeholder", field.placeholder);
    if (field.autoComplete) node.setAttribute("autocomplete", field.autoComplete);
    if (field.inputMode) node.setAttribute("inputmode", field.inputMode);
    if (field.autoCapitalize) node.setAttribute("autocapitalize", field.autoCapitalize);
    if (field.spellcheck != null) node.setAttribute("spellcheck", field.spellcheck);
    else if (field.type === "textarea") node.setAttribute("spellcheck", "true");
  }

  function fieldError(field) {
    return state.errors && state.errors[field.id] ? state.errors[field.id] : "";
  }

  function describedBy(field) {
    var ids = [];
    if (field.help) ids.push("help-" + field.id);
    ids.push("err-" + field.id);
    return ids.join(" ");
  }

  function renderField(field) {
    var error = fieldError(field);
    var required = Form.isRequired(field, state.answers);
    var wrap = el("div", { class: error ? "field invalid" : "field", "data-field": field.id });
    var labelText = field.type === "checkboxes" || field.type === "transcripts"
      ? el("p", { class: "lbl", id: "label-" + field.id })
      : el("label", { class: "lbl", for: "field-" + field.id });
    labelText.append(field.label);
    if (required) labelText.append(requiredMark());
    wrap.append(labelText);
    if (field.help) wrap.append(el("p", { class: "help", id: "help-" + field.id }, [field.help]));

    if (field.type === "checkboxes") {
      var options = el("div", {
        class: "opts",
        role: "group",
        "aria-labelledby": "label-" + field.id,
        "aria-describedby": describedBy(field)
      });
      if (required) options.setAttribute("aria-required", "true");
      if (error) options.setAttribute("aria-invalid", "true");
      var selected = Array.isArray(state.answers[field.id]) ? state.answers[field.id] : [];
      (field.options || []).forEach(function (option, index) {
        var input = el("input", {
          type: "checkbox",
          id: index === 0 ? "field-" + field.id : "field-" + field.id + "-" + option.value,
          value: option.value,
          "data-id": field.id
        });
        if (index !== 0) input.id = "field-" + field.id + "-" + option.value;
        if (selected.indexOf(option.value) !== -1) input.checked = true;
        var caption = el("span", {}, [option.label]);
        if (option.hint) caption.append(el("small", {}, [option.hint]));
        options.append(el("label", { class: "opt" }, [input, caption]));
      });
      wrap.append(options);
    } else if (field.type === "transcripts") {
      var count = field.count || 1;
      var stored = Array.isArray(state.answers[field.id]) ? state.answers[field.id] : [];
      var group = el("div", {
        class: "transcripts",
        role: "group",
        "aria-labelledby": "label-" + field.id,
        "aria-describedby": describedBy(field)
      });
      if (required) group.setAttribute("aria-required", "true");
      if (error) group.setAttribute("aria-invalid", "true");
      for (var i = 0; i < count; i += 1) {
        var area = el("textarea", {
          id: "field-" + field.id + "-" + i,
          rows: String(field.rows || 8),
          "data-id": field.id,
          "data-index": String(i)
        });
        applyControl(area, field, stored[i] || "");
        if (i === 0) area.id = "field-" + field.id;
        else area.id = "field-" + field.id + "-" + i;
        group.append(el("label", { class: "sub-lbl", for: area.id }, ["Conversation " + (i + 1)]));
        group.append(area);
      }
      wrap.append(group);
    } else if (field.type === "textarea") {
      var textarea = el("textarea", {
        id: "field-" + field.id,
        rows: String(field.rows || 5),
        "data-id": field.id,
        "aria-describedby": describedBy(field)
      });
      if (required) textarea.setAttribute("aria-required", "true");
      if (error) textarea.setAttribute("aria-invalid", "true");
      applyControl(textarea, field, state.answers[field.id] || "");
      wrap.append(textarea);
    } else {
      var inputType = field.type === "email" || field.type === "url" ? field.type : "text";
      var input = el("input", {
        id: "field-" + field.id,
        type: inputType,
        "data-id": field.id,
        "aria-describedby": describedBy(field)
      });
      if (required) input.setAttribute("aria-required", "true");
      if (error) input.setAttribute("aria-invalid", "true");
      applyControl(input, field, state.answers[field.id] || "");
      wrap.append(input);
    }

    wrap.append(el("p", { class: "err", id: "err-" + field.id }, error ? [error] : []));
    return wrap;
  }

  function renderFields(step) {
    var fragment = document.createDocumentFragment();
    var fields = step.fields;
    var index = 0;
    while (index < fields.length) {
      var field = fields[index];
      if (field.group) {
        var groupName = field.group;
        var members = [];
        while (index < fields.length && fields[index].group === groupName) {
          if (Form.isVisible(fields[index], state.answers)) members.push(fields[index]);
          index += 1;
        }
        if (!members.length) continue;
        var box = el("fieldset", {}, [el("legend", {}, [groupName])]);
        members.forEach(function (member) { box.append(renderField(member)); });
        fragment.append(box);
      } else if (Form.isVisible(field, state.answers)) {
        fragment.append(renderField(field));
        index += 1;
      } else {
        index += 1;
      }
    }
    return fragment;
  }

  function renderStep() {
    var step = config.QUESTIONS[state.stepIndex];
    var isLast = state.stepIndex === reviewIndex - 1;
    var primary = state.cameFromReview ? "Save and return to review" : (isLast ? "Review answers" : "Continue");
    var backLabel = state.cameFromReview ? "Back to review" : "Back";
    var backAction = state.cameFromReview ? "back-to-review" : "back";
    var form = el("form", { id: "step-form", novalidate: "novalidate" }, [
      el("h2", { id: "step-title", tabindex: "-1" }, [step.title]),
      el("p", { class: "step-desc" }, [step.description || ""]),
      el("p", { class: "req-note" }, [
        el("span", { class: "req", "aria-hidden": "true" }, ["*"]),
        " Required"
      ])
    ]);
    form.append(renderFields(step));
    var backButton = state.stepIndex === 0 && !state.cameFromReview
      ? null
      : el("button", { type: "button", class: "btn ghost", "data-action": backAction }, [backLabel]);
    form.append(el("div", { class: "actions" }, [
      backButton,
      el("div", { class: "right" }, [
        el("button", { type: "submit", class: "btn" }, [primary])
      ])
    ]));
    if (hasAnyAnswer(state.answers)) {
      form.append(el("button", { type: "button", class: "text-btn", "data-action": "start-over" }, ["Start over"]));
    }
    return form;
  }

  function renderReview() {
    var root = el("div", {}, [
      el("h2", { id: "step-title", tabindex: "-1" }, ["Review your answers"]),
      el("p", { class: "step-desc" }, ["Check everything. The prompt uses your words. Edit any step, then generate the setter prompt."])
    ]);
    config.QUESTIONS.forEach(function (step, index) {
      var block = el("section", { class: "review-block" }, [
        el("div", { class: "review-head" }, [
          el("h3", {}, [step.title]),
          el("button", {
            type: "button",
            class: "btn ghost sm",
            "data-action": "edit",
            "data-step": String(index),
            "aria-label": "Edit " + step.title
          }, ["Edit"])
        ])
      ]);
      var list = el("dl", {});
      step.fields.forEach(function (field) {
        if (!Form.isVisible(field, state.answers)) return;
        var formatted = Prompt.formatAnswer(field, state.answers[field.id]);
        var missing = Form.isRequired(field, state.answers) && !formatted;
        list.append(el("dt", {}, [field.label]));
        list.append(el("dd", { class: formatted ? "filled" : (missing ? "missing" : "") }, [
          formatted || (missing ? "Missing" : "Blank")
        ]));
      });
      block.append(list);
      root.append(block);
    });
    var actions = el("div", { class: "actions" }, [
      el("button", { type: "button", class: "btn ghost", "data-action": "back" }, ["Back"]),
      el("div", { class: "right" }, [
        el("button", { type: "button", class: "btn", "data-action": "generate" }, ["Generate my prompt"])
      ])
    ]);
    root.append(actions);
    if (hasAnyAnswer(state.answers)) {
      root.append(el("button", { type: "button", class: "text-btn", "data-action": "start-over" }, ["Start over"]));
    }
    return root;
  }

  function renderPrompt() {
    ensurePrompt();
    var root = el("div", {}, [
      el("h2", { id: "step-title", tabindex: "-1" }, ["Your setter prompt"]),
      el("p", { class: "step-desc" }, ["This is the full system prompt for your Instagram DM setter. Nothing was sent to Roleflow automatically."]),
      el("p", { class: "note" }, ["Section 1 uses Roleflow's shared High Priority Rules. Roleflow reviews the prompt before it goes live."])
    ]);
    root.append(el("div", { class: "toolbar" }, [
      el("button", { type: "button", class: "btn", "data-action": "copy", id: "copy-btn" }, ["Copy prompt"]),
      el("button", { type: "button", class: "btn ghost", "data-action": "download-md" }, ["Download .md"]),
      el("button", { type: "button", class: "btn ghost", "data-action": "download-txt" }, ["Download .txt"])
    ]));
    root.append(el("p", { id: "copy-note", class: "copy-note", role: "status" }));
    root.append(el("pre", {
      class: "prompt",
      id: "prompt-text",
      tabindex: "0",
      role: "region",
      "aria-label": "Generated system prompt"
    }, [state.promptText]));
    var handoff = el("div", { class: "handoff" }, [
      el("h3", {}, ["Send this to Diego"]),
      el("p", { class: "step-desc" }, [
        "Download the submission file (your answers plus the prompt), then email it to Diego and attach the file before you send. This page does not send anything on its own."
      ])
    ]);
    var mail = el("a", { class: "btn ghost", href: mailtoHref(), "data-action": "email", id: "email-diego" }, ["Email Diego"]);
    handoff.append(el("div", { class: "toolbar" }, [
      el("button", { type: "button", class: "btn", "data-action": "download-submission" }, ["Download submission for Diego"]),
      mail
    ]));
    root.append(handoff);
    root.append(el("div", { class: "actions" }, [
      el("button", { type: "button", class: "btn ghost", "data-action": "back-to-review" }, ["Edit answers"]),
      el("div", { class: "right" }, [
        hasAnyAnswer(state.answers)
          ? el("button", { type: "button", class: "text-btn", "data-action": "start-over" }, ["Start over"])
          : null
      ])
    ]));
    return root;
  }

  function buildView() {
    var view = document.createDocumentFragment();
    var note = banner();
    if (note) view.append(note);
    if (state.stepIndex !== promptIndex) view.append(progressBar());
    if (state.stepIndex < reviewIndex) view.append(renderStep());
    else if (state.stepIndex === reviewIndex) view.append(renderReview());
    else view.append(renderPrompt());
    return view;
  }

  function focusHeading() {
    var heading = document.getElementById("step-title");
    if (!heading) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: "start" });
  }

  function focusFirstError() {
    var ids = Object.keys(state.errors || {});
    if (!ids.length) return;
    var wrap = document.querySelector('[data-field="' + ids[0] + '"]');
    var node = wrap ? wrap.querySelector("input, textarea") : null;
    if (node) {
      node.focus({ preventScroll: true });
      node.scrollIntoView({ block: "center" });
    }
  }

  function render(options) {
    options = options || {};
    app.replaceChildren(buildView());
    if (options.focusHeading) {
      focusHeading();
      setStatus(progressLabel());
    } else if (options.focusError) {
      focusFirstError();
      setStatus("Some required answers are missing.");
    } else if (options.focusId) {
      var node = document.getElementById(options.focusId);
      if (node) node.focus({ preventScroll: true });
    }
  }

  function visibilityKey(step) {
    return step.fields.map(function (field) {
      return Form.isVisible(field, state.answers) ? "1" : "0";
    }).join("");
  }

  function clearError(fieldId) {
    if (state.errors && state.errors[fieldId]) delete state.errors[fieldId];
    var err = document.getElementById("err-" + fieldId);
    if (err) err.textContent = "";
    var wrap = document.querySelector('[data-field="' + fieldId + '"]');
    if (!wrap) return;
    wrap.classList.remove("invalid");
    wrap.querySelectorAll("[aria-invalid]").forEach(function (node) {
      node.removeAttribute("aria-invalid");
    });
  }

  function updateText(target) {
    var fieldId = target.getAttribute("data-id");
    if (!fieldId) return;
    var index = target.getAttribute("data-index");
    if (index != null && index !== "") {
      var field = Form.getField(config, fieldId);
      var count = field && field.count ? field.count : 0;
      var current = Array.isArray(state.answers[fieldId]) ? state.answers[fieldId].slice() : [];
      while (current.length < count) current.push("");
      current[Number(index)] = target.value;
      state.answers[fieldId] = current;
    } else {
      state.answers[fieldId] = target.value;
    }
    clearError(fieldId);
    saveLocal();
  }

  function updateCheckbox(target) {
    var fieldId = target.getAttribute("data-id");
    var field = Form.getField(config, fieldId);
    var step = config.QUESTIONS[state.stepIndex];
    var before = step ? visibilityKey(step) : "";
    var selected = Array.prototype.map.call(
      document.querySelectorAll('input[type="checkbox"][data-id="' + fieldId + '"]:checked'),
      function (node) { return node.value; }
    );
    state.answers[fieldId] = Form.orderSelection(field || { options: [] }, selected);
    clearError(fieldId);
    saveLocal();
    var after = step ? visibilityKey(step) : "";
    if (before !== after) render({ focusId: target.id });
  }

  function goForward() {
    if (state.stepIndex < reviewIndex) {
      var step = config.QUESTIONS[state.stepIndex];
      var errors = Form.validateStep(step, state.answers);
      if (Object.keys(errors).length) {
        state.errors = errors;
        render({ focusError: true });
        return;
      }
      state.errors = {};
      if (state.cameFromReview) {
        state.cameFromReview = false;
        state.stepIndex = reviewIndex;
      } else {
        state.stepIndex += 1;
      }
      persist("push");
      render({ focusHeading: true });
      return;
    }
    generate();
  }

  function generate() {
    var result = Form.validateAll(config, state.answers);
    if (!result.ok) {
      state.stepIndex = result.firstStepIndex;
      state.errors = result.errors;
      state.cameFromReview = true;
      persist("push");
      render({ focusError: true });
      setStatus("Some required answers are still missing. They are marked on this step.");
      return;
    }
    state.errors = {};
    state.cameFromReview = false;
    state.stepIndex = promptIndex;
    persist("push");
    render({ focusHeading: true });
  }

  function goBack() {
    if (state.cameFromReview) {
      backToReview();
      return;
    }
    if (state.stepIndex <= 0) return;
    state.errors = {};
    state.stepIndex -= 1;
    persist("push");
    render({ focusHeading: true });
  }

  function backToReview() {
    state.cameFromReview = false;
    state.errors = {};
    state.stepIndex = reviewIndex;
    persist("push");
    render({ focusHeading: true });
  }

  function startOver() {
    if (!window.confirm("Clear your saved answers on this device and start over?")) return;
    state.answers = {};
    state.stepIndex = 0;
    state.errors = {};
    state.cameFromReview = false;
    state.banner = false;
    state.promptText = "";
    state.submissionText = "";
    try { localStorage.removeItem(STORAGE_KEY); } catch (error) { /* ignore */ }
    try { sessionStorage.removeItem(BANNER_KEY); } catch (error) { /* ignore */ }
    persist("push");
    render({ focusHeading: true });
    setStatus("Answers cleared on this device.");
  }

  function copyPrompt() {
    var button = document.getElementById("copy-btn");
    var note = document.getElementById("copy-note");
    function show(ok) {
      if (button) button.textContent = ok ? "Copied" : "Copy prompt";
      if (note) {
        note.textContent = ok
          ? "Copied to your clipboard."
          : "Couldn't copy automatically. The prompt text is selected. Press Ctrl+C.";
        note.classList.toggle("ok", ok);
        note.classList.toggle("bad", !ok);
      }
      setStatus(ok ? "Prompt copied." : "Couldn't copy automatically. The prompt text is selected.");
      if (ok) {
        setTimeout(function () {
          if (button && button.textContent === "Copied") button.textContent = "Copy prompt";
        }, 2500);
      }
    }
    var text = state.promptText;
    if (navigator.clipboard && window.isSecureContext && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { show(true); }, function () { show(fallbackCopy(text)); });
    } else {
      show(fallbackCopy(text));
    }
  }

  function fallbackCopy(text) {
    var area = el("textarea", { readonly: "readonly" });
    area.value = text;
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (error) { ok = false; }
    area.remove();
    if (!ok) {
      var pre = document.getElementById("prompt-text");
      if (pre) {
        var range = document.createRange();
        range.selectNodeContents(pre);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    return ok;
  }

  app.addEventListener("input", function (event) {
    var target = event.target;
    if (!target || !target.getAttribute) return;
    if (target.type === "checkbox") return;
    updateText(target);
  });

  app.addEventListener("change", function (event) {
    var target = event.target;
    if (target && target.type === "checkbox") updateCheckbox(target);
  });

  app.addEventListener("submit", function (event) {
    if (event.target && event.target.id === "step-form") {
      event.preventDefault();
      goForward();
    }
  });

  app.addEventListener("click", function (event) {
    var button = event.target.closest("[data-action]");
    if (!button || !app.contains(button)) return;
    var action = button.getAttribute("data-action");
    if (action === "back") goBack();
    else if (action === "back-to-review") backToReview();
    else if (action === "edit") {
      state.cameFromReview = true;
      state.errors = {};
      state.stepIndex = Number(button.getAttribute("data-step"));
      persist("push");
      render({ focusHeading: true });
    } else if (action === "generate") generate();
    else if (action === "start-over") startOver();
    else if (action === "dismiss-banner") {
      state.banner = false;
      try { sessionStorage.setItem(BANNER_KEY, "1"); } catch (error) { /* ignore */ }
      render();
    } else if (action === "copy") copyPrompt();
    else if (action === "download-md") {
      ensurePrompt();
      download(promptFilename() + ".md", state.promptText, "text/markdown;charset=utf-8");
      setStatus("Markdown download started.");
    } else if (action === "download-txt") {
      ensurePrompt();
      download(promptFilename() + ".txt", state.promptText, "text/plain;charset=utf-8");
      setStatus("Text download started.");
    } else if (action === "download-submission") {
      ensurePrompt();
      download(submissionFilename(), state.submissionText, "text/markdown;charset=utf-8");
      setStatus("Submission download started.");
    } else if (action === "email") {
      ensurePrompt();
      download(submissionFilename(), state.submissionText, "text/markdown;charset=utf-8");
      setStatus("Submission downloaded. Attach that file to the email before you send it.");
    }
  });

  window.addEventListener("popstate", function () {
    var index = indexFromHash(window.location.hash);
    if (index == null) return;
    state.stepIndex = index;
    state.cameFromReview = false;
    state.errors = {};
    saveLocal();
    render({ focusHeading: true });
  });

  loadLocal();
  persist("replace");
  render({ focusHeading: true });
})();
