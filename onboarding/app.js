/* Multi-step onboarding UI. Questions and prompt rules live in config.js. */
(function () {
  "use strict";

  if (typeof document === "undefined") return;

  var config = globalThis.ROLEFLOW_ONBOARDING_CONFIG;
  var Form = globalThis.RoleflowForm;
  var Prompt = globalThis.RoleflowPrompt;
  var app = document.getElementById("onboarding-app");
  var statusEl = document.getElementById("onboarding-status");

  if (!app || !config || !Form || !Prompt) {
    if (app) app.textContent = "The form could not load. Refresh the page.";
    return;
  }

  var STORAGE_KEY = "roleflow.onboarding.v2";
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
    submissionText: "",
    opened: false,
    remoteState: "",
    accountStatus: "not_started",
    locked: false,
    generating: false,
    generationError: "",
    emailStatus: "",
    emailError: "",
    clientEmail: ""
  };

  var account = globalThis.ROLEFLOW_ACCOUNT || null;
  var remoteTimer = null;
  var remoteChain = Promise.resolve();

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

  function notify(message, tone) {
    if (globalThis.RoleflowUI && globalThis.RoleflowUI.toast) globalThis.RoleflowUI.toast(message, tone);
  }

  function hasAnyAnswer(answers) {
    return Object.keys(answers || {}).some(function (key) {
      return !Form.isBlank(answers[key]);
    });
  }

  function hashFor(index) {
    if (index === reviewIndex) return "#onboarding-review";
    if (index === promptIndex) return "#onboarding-prompt";
    var step = config.QUESTIONS[index];
    return "#onboarding-" + (step ? step.id : "about");
  }

  function indexFromHash(hash) {
    var id = String(hash || "").replace(/^#/, "");
    if (id.indexOf("onboarding-") !== 0) return null;
    var stepId = id.slice("onboarding-".length);
    if (stepId === "review") return reviewIndex;
    if (stepId === "prompt") return promptIndex;
    var index = config.QUESTIONS.findIndex(function (step) { return step.id === stepId; });
    return index === -1 ? null : index;
  }

  function hashIsOnboarding(hash) {
    var id = String(hash || "").replace(/^#/, "");
    return id === "onboarding" || id.indexOf("onboarding-") === 0;
  }

  function showSection() {
    var section = document.getElementById("onboarding");
    if (section) section.hidden = false;
    state.opened = true;
  }

  function hideSection() {
    var section = document.getElementById("onboarding");
    if (section) section.hidden = true;
    state.opened = false;
  }

  function normalizeHandle(value) {
    var handle = String(value || "").trim();
    if (!handle || handle.charAt(0) === "@" || /[/\s]/.test(handle)) return handle;
    return "@" + handle;
  }

  function prefill(values) {
    if (!values) return;
    Object.keys(values).forEach(function (key) {
      if (!Form.isBlank(state.answers[key]) || Form.isBlank(values[key])) return;
      state.answers[key] = key === "instagramHandle" ? normalizeHandle(values[key]) : String(values[key]).trim();
    });
    saveLocal();
  }

  function open(values) {
    prefill(values);
    showSection();
    var fromHash = indexFromHash(window.location.hash);
    if (fromHash != null) state.stepIndex = fromHash;
    persist("push");
    render({ focusHeading: true });
    var section = document.getElementById("onboarding");
    if (section) section.scrollIntoView({ block: "start" });
  }

  function storageKey() {
    return account && account.userId ? STORAGE_KEY + "." + account.userId : STORAGE_KEY;
  }

  function saveMessage() {
    if (state.storageError) return state.storageError;
    if (!account) return "Saved on this device";
    if (state.remoteState === "saving") return "Saving…";
    if (state.remoteState === "error") return "Couldn't save to your account. A copy is still on this device.";
    if (state.remoteState === "saved") return "Saved to your account";
    return "Answers save to your account";
  }

  function paintSave() {
    var label = document.getElementById("save-state");
    if (!label) return;
    label.textContent = saveMessage();
    label.classList.toggle("warn", Boolean(state.storageError) || state.remoteState === "error");
  }

  function statusPhrase() {
    var n = Math.min(progressMax, state.stepIndex + 1);
    var status = state.accountStatus || "not_started";
    if (status === "in_progress") return "In progress · step " + n + " of " + progressMax;
    if (status === "not_started") return "Not started";
    if (status === "submitted") return "Submitted";
    if (status === "integrated") return "Integrated";
    if (status === "live") return "Live";
    return status;
  }

  function paintAccountStatus() {
    var node = document.getElementById("account-status");
    if (node) node.textContent = statusPhrase();
  }

  function currentSnapshot(status) {
    return {
      answers: state.answers,
      stepIndex: state.stepIndex,
      status: status,
      promptText: state.promptText || ""
    };
  }

  function snapshotStatus() {
    if (state.locked) return state.accountStatus;
    if (state.accountStatus === "submitted" || state.generating) return "submitted";
    if (state.stepIndex === promptIndex && state.promptText) return "submitted";
    if (hasAnyAnswer(state.answers) || state.stepIndex > 0) return "in_progress";
    return "not_started";
  }

  function enqueueRemote(task) {
    remoteChain = remoteChain.then(task, task);
    return remoteChain;
  }

  function flushRemote() {
    if (!account || state.locked || !account.save) return;
    var snapshot = currentSnapshot(snapshotStatus());
    state.remoteState = "saving";
    paintSave();
    enqueueRemote(function () {
      return account.save(snapshot).then(function () {
        state.remoteState = "saved";
        state.storageError = "";
        state.accountStatus = snapshot.status;
        paintSave();
        paintAccountStatus();
      }, function () {
        state.remoteState = "error";
        state.storageError = "Couldn't save to your account. A copy is still on this device.";
        paintSave();
      });
    });
  }

  function scheduleRemote(immediate) {
    if (!account || state.locked || state.generating) return;
    clearTimeout(remoteTimer);
    if (immediate) flushRemote();
    else remoteTimer = setTimeout(flushRemote, 700);
  }

  function saveLocal() {
    var payload = {
      version: 2,
      stepIndex: state.stepIndex,
      answers: state.answers,
      savedAt: new Date().toISOString()
    };
    try {
      localStorage.setItem(storageKey(), JSON.stringify(payload));
    } catch (error) {
      state.storageError = account
        ? "Couldn't save in this browser. Your account save will still be tried."
        : "Couldn't save in this browser. Download your submission before you leave.";
    }
    paintSave();
  }

  function persist(historyMode, opts) {
    saveLocal();
    if (!(opts && opts.skipRemote)) scheduleRemote(true);
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

  function submissionBody() {
    var answers = Object.assign({}, state.answers, {
      clientEmail: state.clientEmail || state.answers.clientEmail || ""
    });
    return Prompt.buildSubmission(config, answers, { promptText: state.promptText, now: new Date() });
  }

  function progressLabel() {
    if (state.stepIndex === promptIndex) return "Prompt ready";
    if (state.stepIndex === reviewIndex) return "Step " + progressMax + " of " + progressMax + " · Review";
    var step = config.QUESTIONS[state.stepIndex];
    return "Step " + (state.stepIndex + 1) + " of " + progressMax + " · " + (step ? step.title : "");
  }

  function progressSteps() {
    var steps = config.QUESTIONS.map(function (step, index) {
      return { title: step.title, index: index };
    });
    steps.push({ title: "Review", index: reviewIndex });
    steps.push({ title: "Prompt", index: promptIndex });
    return steps;
  }

  function progressBar() {
    var current = Math.min(state.stepIndex, progressMax - 1);
    var bars = [];
    for (var i = 0; i < progressMax; i += 1) {
      bars.push(el("i", { class: i <= current ? "on" : "" }));
    }
    var steps = progressSteps().map(function (step) {
      var className = step.index < state.stepIndex ? "done" : step.index === state.stepIndex ? "current" : "";
      var button = el("button", {
        type: "button",
        "data-action": "goto-step",
        "data-step": String(step.index),
        "aria-current": step.index === state.stepIndex ? "step" : null
      }, [
        el("span", { class: "step-index", "aria-hidden": "true" }, [String(step.index + 1)]),
        el("span", {}, [step.title])
      ]);
      return el("li", { class: className }, [button]);
    });
    return el("div", {
      class: "progress",
      role: "progressbar",
      "aria-valuemin": "1",
      "aria-valuemax": String(progressMax),
      "aria-valuenow": String(Math.min(progressMax, state.stepIndex + 1)),
      "aria-valuetext": progressLabel()
    }, [
      el("ol", { class: "stepper" }, steps),
      el("div", { class: "prog", "aria-hidden": "true" }, bars),
      el("p", { class: "prog-label" }, [
        el("span", {}, [progressLabel()]),
        el("span", { class: state.storageError || state.remoteState === "error" ? "save-state warn" : "save-state", id: "save-state" }, [
          saveMessage()
        ])
      ])
    ]);
  }

  function banner() {
    if (!state.banner) return null;
    return el("div", { class: "banner" }, [
      el("p", {}, [account
        ? "Welcome back. Your answers were restored from your account."
        : "Welcome back. Your answers were restored on this device."]),
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
      if (field.file) {
        wrap.append(el("label", { class: "file-label", for: "file-" + field.id }, [
          "Or upload a .txt or .md file"
        ]));
        wrap.append(el("input", {
          type: "file",
          class: "file-input",
          id: "file-" + field.id,
          accept: ".txt,.md,text/plain,text/markdown",
          "data-file-for": field.id
        }));
      }
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
      el("p", { class: "step-desc" }, ["Check everything. Submit writes the setter prompt and emails it to Diego. This usually takes a minute."])
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
    if (state.generating) {
      root.append(el("p", { class: "note" }, ["Your answers are saved. Roleflow is writing the prompt."]));
    }
    if (state.generationError) {
      root.append(el("p", { class: "note" }, [state.generationError]));
    }
    var actions = el("div", { class: "actions" }, [
      el("button", { type: "button", class: "btn ghost", "data-action": "back" }, ["Back"]),
      el("div", { class: "right" }, [
        el("button", {
          type: "button",
          class: "btn",
          "data-action": "generate",
          disabled: state.generating ? "disabled" : false
        }, [state.generating ? "Writing the prompt…" : "Submit"])
      ])
    ]);
    root.append(actions);
    if (hasAnyAnswer(state.answers)) {
      root.append(el("button", { type: "button", class: "text-btn", "data-action": "start-over" }, ["Start over"]));
    }
    return root;
  }

  function promptHandoff() {
    if (state.emailStatus === "sent") return "Diego has this prompt by email, and it is saved on your account.";
    if (state.emailStatus === "failed") {
      return "The prompt is saved on your account. The email to Diego did not send"
        + (state.emailError ? " (" + state.emailError + ")." : ".")
        + " He can open it from the tracking page.";
    }
    return "The prompt is saved on your account. Diego opens it from the tracking page.";
  }

  function renderPrompt() {
    var root = el("div", {}, [
      el("h2", { id: "step-title", tabindex: "-1" }, ["Your setter prompt"]),
      el("p", { class: "step-desc" }, [promptHandoff()]),
      el("p", { class: "note" }, ["The high priority rules are Roleflow's shared block. Roleflow reviews the prompt before it goes live."])
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
      el("h3", {}, ["Your copy"]),
      el("p", { class: "step-desc" }, ["Download the prompt, or a file that also includes your answers. Diego already receives the prompt by email when sending works."])
    ]);
    handoff.append(el("div", { class: "toolbar" }, [
      el("button", { type: "button", class: "btn ghost", "data-action": "download-submission" }, ["Download submission"])
    ]));
    root.append(handoff);
    if (!state.locked) {
      root.append(el("div", { class: "actions" }, [
        el("button", { type: "button", class: "btn ghost", "data-action": "back-to-review" }, ["Edit answers"]),
        el("div", { class: "right" }, [
          hasAnyAnswer(state.answers)
            ? el("button", { type: "button", class: "text-btn", "data-action": "start-over" }, ["Start over"])
            : null
        ])
      ]));
    }
    return root;
  }

  function buildView() {
    var view = document.createDocumentFragment();
    if (state.locked) {
      view.append(el("p", { class: "note" }, [
        "Roleflow marked this onboarding " + (state.accountStatus === "live" ? "live" : "integrated") + ". You can read and copy the prompt. Answers stay locked."
      ]));
      if (state.promptText) view.append(renderPrompt());
      else view.append(el("p", { class: "step-desc" }, ["The prompt is not stored on this account yet."]));
      return view;
    }
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
    } else     if (options.focusError) {
      focusFirstError();
      setStatus("Some required answers are missing.");
    } else if (options.focusId) {
      var node = document.getElementById(options.focusId);
      if (node) node.focus({ preventScroll: true });
    }
    paintAccountStatus();
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

  function readUpload(input) {
    var fieldId = input.getAttribute("data-file-for");
    var file = input.files && input.files[0];
    if (!fieldId || !file) return;
    var allowed = /\.(txt|md)$/i.test(file.name) || file.type === "text/plain" || file.type === "text/markdown";
    if (!allowed) {
      state.errors[fieldId] = "Upload a .txt or .md file.";
      render({ focusError: true });
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      state.answers[fieldId] = String(reader.result || "");
      clearError(fieldId);
      var area = document.getElementById("field-" + fieldId);
      if (area) area.value = state.answers[fieldId];
      saveLocal();
      scheduleRemote(true);
      setStatus("Added " + file.name + " to the paste box.");
    };
    reader.onerror = function () {
      state.errors[fieldId] = "That file could not be read. Paste the text instead.";
      render({ focusError: true });
    };
    reader.readAsText(file);
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
    scheduleRemote(false);
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
    scheduleRemote(false);
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

  function showPromptStep() {
    state.stepIndex = promptIndex;
    saveLocal();
    if (window.history) {
      var hash = hashFor(state.stepIndex);
      var url = window.location.pathname + window.location.search + hash;
      if (window.location.hash !== hash) history.pushState({ step: state.stepIndex }, "", url);
    }
    render({ focusHeading: true });
  }

  function generate() {
    if (state.generating || state.locked) return;
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
    state.generationError = "";
    if (!account || !account.generate) {
      state.generationError = "Sign in to submit. Your answers stay on this device until then.";
      state.stepIndex = reviewIndex;
      render({ focusHeading: true });
      return;
    }
    state.generating = true;
    state.accountStatus = "submitted";
    clearTimeout(remoteTimer);
    state.stepIndex = reviewIndex;
    saveLocal();
    render();
    setStatus("Writing the setter prompt.");
    enqueueRemote(function () {
      return account.generate(currentSnapshot("submitted")).then(function (payload) {
        state.generating = false;
        state.accountStatus = "submitted";
        state.remoteState = "saved";
        state.storageError = "";
        state.promptText = payload && payload.prompt_text ? payload.prompt_text : "";
        state.emailStatus = payload && payload.email_status ? payload.email_status : "";
        state.emailError = payload && payload.email_error ? payload.email_error : "";
        state.generationError = state.promptText ? "" : "The prompt came back empty. Your answers are saved.";
        if (!state.promptText) {
          state.stepIndex = reviewIndex;
          notify(state.generationError, "bad");
          render({ focusHeading: true });
          return;
        }
        notify("Your setter prompt is ready.");
        showPromptStep();
      }, function (error) {
        state.generating = false;
        state.accountStatus = "submitted";
        state.remoteState = "error";
        state.generationError = (error && error.message) || "The prompt could not be written. Your answers are saved.";
        state.stepIndex = reviewIndex;
        notify(state.generationError, "bad");
        render({ focusHeading: true });
      });
    });
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
    if (state.locked) return;
    var message = account
      ? "Clear your saved answers in your account and start over?"
      : "Clear your saved answers on this device and start over?";
    if (!window.confirm(message)) return;
    state.answers = {};
    state.stepIndex = 0;
    state.errors = {};
    state.cameFromReview = false;
    state.banner = false;
    state.promptText = "";
    state.submissionText = "";
    state.generating = false;
    state.generationError = "";
    state.emailStatus = "";
    state.emailError = "";
    state.accountStatus = "not_started";
    try { localStorage.removeItem(storageKey()); } catch (error) { /* ignore */ }
    try { sessionStorage.removeItem(BANNER_KEY); } catch (error) { /* ignore */ }
    clearTimeout(remoteTimer);
    if (account && account.save) {
      enqueueRemote(function () {
        return account.save(currentSnapshot("not_started")).then(function () {
          state.remoteState = "saved";
          state.storageError = "";
          paintAccountStatus();
          paintSave();
        }, function () {
          state.remoteState = "error";
          state.storageError = "Couldn't clear the account copy. It is cleared in this browser.";
          paintSave();
        });
      });
    }
    persist("push", { skipRemote: true });
    render({ focusHeading: true });
    setStatus(account ? "Answers cleared in your account." : "Answers cleared on this device.");
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
    if (target.type === "checkbox" || target.type === "file") return;
    updateText(target);
  });

  app.addEventListener("change", function (event) {
    var target = event.target;
    if (target && target.type === "checkbox") updateCheckbox(target);
    else if (target && target.type === "file") readUpload(target);
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
    if (action === "goto-step") {
      if (state.locked || state.generating) return;
      var index = Number(button.getAttribute("data-step"));
      if (!Number.isInteger(index) || index < 0 || index > promptIndex) return;
      if (index === promptIndex && state.stepIndex !== promptIndex) return;
      if (index > state.stepIndex) {
        if (index !== state.stepIndex + 1 || state.stepIndex >= reviewIndex) return;
        var stepErrors = Form.validateStep(config.QUESTIONS[state.stepIndex], state.answers);
        if (Object.keys(stepErrors).length) {
          state.errors = stepErrors;
          render({ focusError: true });
          return;
        }
      }
      state.errors = {};
      state.cameFromReview = false;
      state.stepIndex = index;
      persist("push");
      render({ focusHeading: true });
    } else if (action === "back") goBack();
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
      if (!state.promptText) { setStatus("The prompt is not ready yet."); return; }
      download(promptFilename() + ".md", state.promptText, "text/markdown;charset=utf-8");
      setStatus("Markdown download started.");
    } else if (action === "download-txt") {
      if (!state.promptText) { setStatus("The prompt is not ready yet."); return; }
      download(promptFilename() + ".txt", state.promptText, "text/plain;charset=utf-8");
      setStatus("Text download started.");
    } else if (action === "download-submission") {
      if (!state.promptText) { setStatus("The prompt is not ready yet."); return; }
      download(submissionFilename(), submissionBody(), "text/markdown;charset=utf-8");
      setStatus("Submission download started.");
    }
  });

  function bootAccount() {
    var boot = account.boot || {};
    state.answers = boot.answers && typeof boot.answers === "object" ? boot.answers : {};
    var index = Number(boot.stepIndex);
    if (Number.isInteger(index) && index >= 0 && index <= promptIndex) state.stepIndex = index;
    state.promptText = boot.promptText || "";
    state.accountStatus = account.status || "not_started";
    state.emailStatus = boot.emailStatus || "";
    state.emailError = boot.emailError || "";
    state.generationError = boot.generationError || "";
    state.clientEmail = account.profilePrefill && account.profilePrefill.clientEmail || "";
    state.locked = state.accountStatus === "integrated" || state.accountStatus === "live";
    prefill(account.profilePrefill);
    var dismissed = false;
    try { dismissed = sessionStorage.getItem(BANNER_KEY) === "1"; } catch (error) { dismissed = false; }
    state.banner = Boolean(account.restored) && !state.locked && !dismissed && hasAnyAnswer(state.answers);
    if (state.locked || (state.accountStatus === "submitted" && state.promptText)) state.stepIndex = promptIndex;
    else if (state.accountStatus === "submitted") state.stepIndex = reviewIndex;
    var fromHash = indexFromHash(window.location.hash);
    if (fromHash != null && !state.locked && state.accountStatus !== "submitted") state.stepIndex = fromHash;
    showSection();
    persist(window.location.hash === "#setter" ? "none" : "replace", { skipRemote: true });
    render({ focusHeading: true });
  }

  window.addEventListener("popstate", function () {
    if (account) {
      if (state.locked) return;
      var next = indexFromHash(window.location.hash);
      if (next == null) return;
      state.stepIndex = next;
      state.cameFromReview = false;
      state.errors = {};
      saveLocal();
      scheduleRemote(true);
      render({ focusHeading: true });
      return;
    }
    if (!hashIsOnboarding(window.location.hash)) {
      if (state.opened) hideSection();
      return;
    }
    showSection();
    var index = indexFromHash(window.location.hash);
    if (index == null) return;
    state.stepIndex = index;
    state.cameFromReview = false;
    state.errors = {};
    saveLocal();
    render({ focusHeading: true });
  });

  if (account) {
    bootAccount();
  } else {
    loadLocal();
    var stepFromHash = indexFromHash(window.location.hash);
    if (stepFromHash != null) state.stepIndex = stepFromHash;
    if (hashIsOnboarding(window.location.hash)) {
      showSection();
      persist("replace", { skipRemote: true });
      render({ focusHeading: true });
    } else {
      render();
    }
  }

  globalThis.RoleflowOnboarding = { open: open };
})();
