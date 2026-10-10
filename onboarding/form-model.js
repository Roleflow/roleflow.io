/* Validation for the onboarding form. No DOM. The question list lives in config.js. */
(function (root) {
  "use strict";

  function allFields(config) {
    return config.QUESTIONS.flatMap(function (step) { return step.fields; });
  }

  function getField(config, id) {
    return allFields(config).find(function (field) { return field.id === id; }) || null;
  }

  function isBlank(value) {
    if (value == null) return true;
    if (Array.isArray(value)) return value.map(function (item) { return String(item || "").trim(); }).filter(Boolean).length === 0;
    return String(value).trim() === "";
  }

  function conditionMet(condition, answers) {
    if (!condition) return false;
    var value = answers[condition.field];
    if (Object.prototype.hasOwnProperty.call(condition, "includes")) {
      return Array.isArray(value) && value.indexOf(condition.includes) !== -1;
    }
    if (condition.notEmpty) return !isBlank(value);
    if (Object.prototype.hasOwnProperty.call(condition, "equals")) return value === condition.equals;
    return false;
  }

  function isVisible(field, answers) {
    if (!field.showIf) return true;
    return conditionMet(field.showIf, answers);
  }

  function isRequired(field, answers) {
    if (!isVisible(field, answers)) return false;
    if (field.type === "transcripts") return (field.minRequired || 0) > 0;
    if (field.required) return true;
    if (field.requiredIf) return conditionMet(field.requiredIf, answers);
    return false;
  }

  function isHttpUrl(value) {
    try {
      var url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (error) {
      return false;
    }
  }

  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function validateField(field, answers) {
    var value = answers[field.id];
    if (!isVisible(field, answers)) return "";

    if (field.type === "transcripts") {
      var items = Array.isArray(value) ? value : [];
      var filled = items.map(function (item) { return String(item || "").trim(); }).filter(Boolean);
      var min = field.minRequired || 0;
      if (filled.length < min) {
        return min === 1
          ? "Paste at least one converted conversation."
          : "Paste at least " + min + " converted conversations.";
      }
      return "";
    }

    if (isRequired(field, answers) && isBlank(value)) {
      return field.requiredMessage || "This field is required.";
    }
    if (isBlank(value)) return "";

    var trimmed = String(value).trim();
    if (field.type === "email" && !isEmail(trimmed)) return "Enter a valid email address.";
    if (field.type === "url" && !isHttpUrl(trimmed)) return "Enter a full link starting with https://";
    if (field.minLength && trimmed.length < field.minLength) {
      return "Add a bit more detail (at least " + field.minLength + " characters).";
    }
    return "";
  }

  function validateStep(step, answers) {
    var errors = {};
    step.fields.forEach(function (field) {
      var message = validateField(field, answers);
      if (message) errors[field.id] = message;
    });
    return errors;
  }

  function validateAll(config, answers) {
    var firstStepIndex = -1;
    var errors = {};
    config.QUESTIONS.forEach(function (step, index) {
      var stepErrors = validateStep(step, answers);
      if (Object.keys(stepErrors).length && firstStepIndex === -1) {
        firstStepIndex = index;
        errors = stepErrors;
      }
    });
    return { ok: firstStepIndex === -1, firstStepIndex: firstStepIndex, errors: errors };
  }

  function orderSelection(field, selected) {
    var order = (field.options || []).map(function (option) { return option.value; });
    var selectedSet = new Set(selected);
    var known = order.filter(function (value) { return selectedSet.has(value); });
    var extra = selected.filter(function (value) { return order.indexOf(value) === -1; });
    return known.concat(extra);
  }

  root.RoleflowForm = {
    allFields: allFields,
    getField: getField,
    isBlank: isBlank,
    conditionMet: conditionMet,
    isVisible: isVisible,
    isRequired: isRequired,
    validateField: validateField,
    validateStep: validateStep,
    validateAll: validateAll,
    orderSelection: orderSelection,
    isHttpUrl: isHttpUrl
  };
})(globalThis);
