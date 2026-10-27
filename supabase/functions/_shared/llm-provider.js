// One chat completion path for every Roleflow caller.
// Platform keys stay in the function environment. A business key is passed in
// already decrypted and is never written to the returned error text.

export const CLAUDE_SONNET_MODEL = "claude-sonnet-5-5";

export const PROVIDERS = {
  xai: {
    id: "xai",
    label: "xAI",
    defaultModel: "grok-4.3",
    models: ["grok-4.3", "grok-4.7"],
    kind: "openai",
    url: "https://api.x.ai/v1/chat/completions"
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-4.1-mini",
    models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o"],
    kind: "openai",
    url: "https://api.openai.com/v1/chat/completions"
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    defaultModel: CLAUDE_SONNET_MODEL,
    models: [CLAUDE_SONNET_MODEL, "claude-sonnet-4-5", "claude-3-5-haiku-latest"],
    kind: "anthropic",
    url: "https://api.anthropic.com/v1/messages"
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    defaultModel: "gemini-3-flash-preview",
    models: ["gemini-3-flash-preview", "gemini-2.5-pro", "gemini-2.0-flash"],
    kind: "gemini",
    url: ""
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    defaultModel: "openai/gpt-4.1-mini",
    models: ["openai/gpt-4.1-mini", "anthropic/claude-sonnet-4.5", "google/gemini-3-flash-preview", "google/gemini-2.5-flash", "x-ai/grok-4"],
    kind: "openai",
    url: "https://openrouter.ai/api/v1/chat/completions"
  },
  custom: {
    id: "custom",
    label: "Custom OpenAI-compatible",
    defaultModel: "",
    models: [],
    kind: "openai",
    url: ""
  }
};

export const PROVIDER_LIST = Object.values(PROVIDERS).map((item) => ({
  id: item.id,
  label: item.label,
  models: item.models.slice(),
  needsBaseUrl: item.id === "custom"
}));

const SETTING_FIELDS = "setter_model, llm_setter_provider, llm_setter_own_key, llm_setter_base_url, llm_prompt_provider, llm_prompt_model, llm_prompt_own_key, llm_prompt_base_url";

export function bookingTool() {
  return {
    name: "book_call",
    description: "Book, offer, reschedule, or cancel a call. Use only a slot that was provided. Do not invent a time.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["offer", "book", "reschedule", "cancel"] },
        slot_start: { type: "string" },
        email: { type: "string" }
      },
      required: ["action"]
    }
  };
}

export function normalizeProvider(value) {
  const id = String(value || "").trim().toLowerCase();
  if (id === "grok") return "xai";
  if (id === "google") return "gemini";
  return PROVIDERS[id] ? id : "";
}

export function safeBaseUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return (url.origin + url.pathname).replace(/\/+$/, "");
  } catch (_error) {
    return "";
  }
}

export function platformEnv(source) {
  const env = source || {};
  return {
    xai: String(env.XAI_API_KEY || ""),
    openai: String(env.OPENAI_API_KEY || ""),
    anthropic: String(env.ANTHROPIC_API_KEY || ""),
    gemini: String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || ""),
    openrouter: String(env.OPENROUTER_API_KEY || ""),
    custom: ""
  };
}

export function platformDefault(source) {
  const env = source || {};
  const keys = platformEnv(env);
  const order = [
    ["xai", env.XAI_MODEL || PROVIDERS.xai.defaultModel],
    ["openai", env.OPENAI_MODEL || PROVIDERS.openai.defaultModel],
    ["gemini", env.GEMINI_MODEL || PROVIDERS.gemini.defaultModel],
    ["anthropic", env.ANTHROPIC_MODEL || PROVIDERS.anthropic.defaultModel],
    ["openrouter", env.OPENROUTER_MODEL || PROVIDERS.openrouter.defaultModel]
  ];
  for (const [provider, model] of order) {
    if (keys[provider]) return { provider, model, apiKey: keys[provider], baseUrl: "", source: "platform" };
  }
  return null;
}

export function runtimeFromEnv(source) {
  const env = source || {};
  const forced = normalizeProvider(env.LLM_PROVIDER);
  if (forced) {
    const key = platformEnv(env)[forced];
    if (!key) return null;
    const model = forced === "xai"
      ? (env.XAI_MODEL || PROVIDERS.xai.defaultModel)
      : forced === "openai"
        ? (env.OPENAI_MODEL || PROVIDERS.openai.defaultModel)
        : forced === "gemini"
          ? (env.GEMINI_MODEL || PROVIDERS.gemini.defaultModel)
          : (PROVIDERS[forced].defaultModel || "");
    return { provider: forced, model, apiKey: key, baseUrl: "", source: "platform" };
  }
  const picked = platformDefault(env);
  if (picked && picked.provider === "xai" && env.XAI_MODEL) picked.model = env.XAI_MODEL;
  if (picked && picked.provider === "openai" && env.OPENAI_MODEL) picked.model = env.OPENAI_MODEL;
  if (picked && picked.provider === "gemini" && env.GEMINI_MODEL) picked.model = env.GEMINI_MODEL;
  return picked;
}

export function resolveRuntime({ purpose, settings, secret, env }) {
  const prefs = settings || {};
  const prompt = purpose === "prompt";
  const provider = normalizeProvider(prompt ? prefs.llm_prompt_provider : prefs.llm_setter_provider) || "gemini";
  const named = prompt ? prefs.llm_prompt_model : prefs.setter_model;
  const model = modelForProvider(provider, named);
  const baseUrl = safeBaseUrl(prompt ? prefs.llm_prompt_base_url : prefs.llm_setter_base_url);
  const owned = secret && String(secret.apiKey || "").trim();
  // A saved business key wins whenever one exists. The platform env key is the fallback.
  if (owned && (provider !== "custom" || baseUrl)) {
    return { provider, model, apiKey: String(secret.apiKey).trim(), baseUrl: provider === "custom" ? baseUrl : "", source: "own" };
  }
  const platformKey = platformEnv(env)[provider] || "";
  if (provider !== "custom" && platformKey) {
    return { provider, model, apiKey: platformKey, baseUrl: "", source: "platform" };
  }
  return platformDefault(env);
}

export function redactSecret(text, secret) {
  let out = String(text || "");
  const hidden = String(secret || "");
  if (hidden.length >= 6) out = out.split(hidden).join("[redacted]");
  return out
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\bxai-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .slice(0, 240);
}

export function chatRequest({ runtime, system, messages, json, tools, responseFormat, maxTokens, temperature }) {
  const spec = PROVIDERS[runtime.provider];
  if (!spec) throw new Error("Choose a provider.");
  const model = String(runtime.model || spec.defaultModel || "").trim();
  if (!model) throw new Error("Enter a model id.");
  const heat = Number.isFinite(Number(temperature)) ? Number(temperature) : 0.4;
  const toolList = Array.isArray(tools) ? tools.filter((tool) => tool && tool.name) : [];
  if (spec.kind === "anthropic") return anthropicRequest({ runtime, spec, model, system, messages, json, toolList, heat, maxTokens });
  if (spec.kind === "gemini") return geminiRequest({ runtime, model, system, messages, json, toolList, heat });
  return openaiRequest({ runtime, spec, model, system, messages, json, toolList, responseFormat, heat, maxTokens });
}

export function parseChat(provider, payload) {
  const spec = PROVIDERS[provider];
  const body = payload && typeof payload === "object" ? payload : {};
  if (!spec || spec.kind === "openai") return parseOpenai(body);
  if (spec.kind === "anthropic") return parseAnthropic(body);
  return parseGemini(body);
}

export async function completeChat(input) {
  if (input && Array.isArray(input.chain)) return completeChain(input);
  const primary = input && input.runtime;
  if (!primary || !primary.apiKey) {
    const error = new Error("No model key is configured.");
    error.code = "llm_unconfigured";
    throw error;
  }
  try {
    const result = await once(primary, input);
    logUsage(result);
    return result;
  } catch (error) {
    const safe = redactSecret(error && error.message, primary.apiKey);
    const fallback = usableFallback(primary, input && input.fallback);
    if (input && input.onError) {
      await input.onError({ provider: primary.provider, model: primary.model, source: primary.source || "", message: safe, fellBack: Boolean(fallback), auth: Boolean(error && error.auth) });
    }
    if (!fallback) {
      const wrapped = new Error(safe);
      wrapped.code = error && error.code;
      wrapped.auth = Boolean(error && error.auth);
      throw wrapped;
    }
    try {
      const result = await once(fallback, input);
      result.fellBack = true;
      result.authFallback = Boolean(error && error.auth);
      logUsage(result);
      return result;
    } catch (second) {
      const safeFallback = redactSecret(second && second.message, fallback.apiKey);
      if (input && input.onError) {
        await input.onError({ provider: fallback.provider, model: fallback.model, source: fallback.source || "", message: safeFallback, fellBack: false, auth: Boolean(second && second.auth) });
      }
      throw new Error(safeFallback);
    }
  }
}

async function completeChain(input) {
  const steps = (input.chain || []).filter((step) => step && step.apiKey);
  if (!steps.length) {
    const error = new Error("No model key is configured.");
    error.code = "llm_unconfigured";
    throw error;
  }
  let lastError = null;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    try {
      const result = await once(step, input);
      result.fellBack = index > 0;
      result.authFallback = Boolean(lastError && lastError.auth);
      logUsage(result);
      return result;
    } catch (error) {
      lastError = error;
      const safe = redactSecret(error && error.message, step.apiKey);
      const next = steps[index + 1];
      if (input.onError) {
        await input.onError({
          provider: step.provider,
          model: step.model,
          source: step.source || "",
          message: safe,
          fellBack: Boolean(next),
          auth: Boolean(error && error.auth)
        });
      }
      if (!next) {
        const wrapped = new Error(safe);
        wrapped.code = error && error.code;
        wrapped.auth = Boolean(error && error.auth);
        throw wrapped;
      }
    }
  }
  const error = new Error("No model key is configured.");
  error.code = "llm_unconfigured";
  throw error;
}

export async function loadBusinessRuntime(admin, businessId, purpose, env) {
  const platform = platformDefault(env);
  if (!admin || !businessId) return { runtime: runtimeFromEnv(env), fallback: null };
  const row = await admin.from("acq_settings").select(SETTING_FIELDS).eq("agent_id", businessId).maybeSingle();
  if (!row || row.error || !row.data) return { runtime: runtimeFromEnv(env) || platform, fallback: null };
  const settings = row.data;
  const prompt = purpose === "prompt";
  const provider = normalizeProvider(prompt ? settings.llm_prompt_provider : settings.llm_setter_provider) || "gemini";
  let secret = null;
  const loaded = await admin.rpc("acq_llm_read_key", { p_business: businessId, p_provider: provider });
  const data = loaded && !loaded.error ? loaded.data : null;
  if (data && data.ok === true && data.api_key) secret = { apiKey: data.api_key, baseUrl: data.base_url || "" };
  const runtime = resolveRuntime({ purpose, settings, secret, env });
  const fallback = runtime && platform && runtime.apiKey === platform.apiKey && runtime.provider === platform.provider && runtime.model === platform.model
    ? null
    : platform;
  return { runtime, fallback };
}

export function claudeRuntime(apiKey, source) {
  return {
    provider: "anthropic",
    model: CLAUDE_SONNET_MODEL,
    apiKey: String(apiKey || "").trim(),
    baseUrl: "",
    source: source === "own" ? "own" : "platform"
  };
}

export function setterReplyPlan({ mode, businessKey, env, current }) {
  const owned = mode === "own" ? String(businessKey || "").trim() : "";
  const platformKey = String(env && env.ANTHROPIC_API_KEY || "").trim();
  const chain = [];
  if (owned) chain.push(claudeRuntime(owned, "own"));
  if (platformKey && platformKey !== owned) chain.push(claudeRuntime(platformKey, "platform"));
  const currentKey = current && String(current.apiKey || "").trim();
  const currentRuntime = currentKey
    ? { ...current, apiKey: currentKey, source: current.source || "current" }
    : null;
  if (currentRuntime && !chain.some((step) => step.provider === currentRuntime.provider && step.model === currentRuntime.model && step.apiKey === currentRuntime.apiKey)) {
    chain.push(currentRuntime);
  }
  const claude = chain.some((step) => step.provider === "anthropic");
  return { chain, fellBack: !claude && Boolean(currentRuntime), reason: claude ? "" : "anthropic_missing" };
}

export async function loadSetterReply(admin, businessId, env) {
  const currentLoaded = await loadBusinessRuntime(admin, businessId, "setter", env);
  const current = currentLoaded && currentLoaded.runtime;
  let mode = "default";
  let businessKey = "";
  if (admin && businessId) {
    const row = await admin.from("acq_settings").select("setter_claude_mode").eq("agent_id", businessId).maybeSingle();
    if (row && !row.error && row.data && row.data.setter_claude_mode === "own") mode = "own";
    if (mode === "own") {
      const loaded = await admin.rpc("acq_llm_read_key", { p_business: businessId, p_provider: "anthropic" });
      const data = loaded && !loaded.error ? loaded.data : null;
      if (data && data.ok === true && data.api_key) businessKey = String(data.api_key);
    }
  }
  const plan = setterReplyPlan({ mode, businessKey, env, current });
  if (plan.fellBack && admin && businessId) {
    await logLlmError(admin, {
      businessId,
      purpose: "setter",
      provider: "anthropic",
      model: CLAUDE_SONNET_MODEL,
      message: "ANTHROPIC_API_KEY is not set. Fell back to the current model.",
      fellBack: true
    });
  }
  return plan;
}

const CLIENT_REPLY_KEYS = ["ok", "reply", "error", "provider", "provider_label", "model", "key_source", "tested_at", "sent", "notice", "fell_back", "version", "prompt", "voices", "booking_link", "preview"];

export function clientReplyView(result, secrets) {
  const source = result && typeof result === "object" ? result : {};
  const view = {};
  CLIENT_REPLY_KEYS.forEach((key) => {
    if (source[key] !== undefined) view[key] = source[key];
  });
  ["reply", "error", "notice"].forEach((key) => {
    if (typeof view[key] === "string") view[key] = redactListed(view[key], secrets);
  });
  if (source.usage && typeof source.usage === "object") {
    view.usage = {
      input: Math.max(0, Number(source.usage.input) || 0),
      output: Math.max(0, Number(source.usage.output) || 0)
    };
  }
  return view;
}

export async function logLlmError(admin, entry) {
  if (!admin || !entry || !entry.businessId) return;
  await admin.from("acq_llm_errors").insert({
    business_id: entry.businessId,
    purpose: ["setter", "prompt", "assistant", "test"].includes(entry.purpose) ? entry.purpose : "setter",
    provider: String(entry.provider || "").slice(0, 40),
    model: String(entry.model || "").slice(0, 120),
    message: redactSecret(entry.message, "").slice(0, 240),
    fell_back: entry.fellBack === true
  });
}

function usableFallback(primary, fallback) {
  if (!fallback || !fallback.apiKey) return null;
  if (fallback.provider === primary.provider && fallback.model === primary.model && fallback.apiKey === primary.apiKey && (fallback.baseUrl || "") === (primary.baseUrl || "")) {
    return null;
  }
  return fallback;
}

async function once(runtime, input) {
  const request = chatRequest({
    runtime,
    system: input.system || "",
    messages: input.messages || [],
    json: input.json === true,
    tools: input.tools,
    responseFormat: input.responseFormat,
    maxTokens: input.maxTokens,
    temperature: input.temperature
  });
  const fetchFn = input.fetchImpl || fetch;
  const response = await fetchFn(request.url, request.init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = providerError(payload) || (runtime.provider + " request failed.");
    const error = new Error(message);
    error.status = response.status;
    const kind = payload && payload.error && typeof payload.error === "object" ? String(payload.error.type || "") : "";
    error.auth = response.status === 401 || response.status === 403 || kind === "authentication_error" || kind === "permission_error";
    throw error;
  }
  const parsed = parseChat(runtime.provider, payload);
  if (payload && payload.choices && payload.choices[0] && payload.choices[0].finish_reason === "length") {
    throw new Error("The model response was cut off.");
  }
  return {
    text: parsed.text,
    toolCalls: parsed.toolCalls,
    provider: runtime.provider,
    model: String(runtime.model || ""),
    keySource: runtime.source === "own" ? "business" : "platform",
    usage: readUsage(runtime.provider, payload)
  };
}

function openaiRequest({ runtime, spec, model, system, messages, json, toolList, responseFormat, heat, maxTokens }) {
  const url = runtime.endpoint || (runtime.provider === "custom" ? customUrl(runtime.baseUrl) : spec.url);
  const body = {
    model,
    temperature: heat,
    messages: [{ role: "system", content: String(system || "") }, ...plainMessages(messages)]
  };
  if (maxTokens) body.max_completion_tokens = Math.min(16000, Math.max(1, Math.round(Number(maxTokens))));
  if (toolList.length) {
    body.tools = toolList.map((tool) => ({
      type: "function",
      function: {
        name: String(tool.name).slice(0, 64),
        description: String(tool.description || "").slice(0, 500),
        parameters: tool.parameters || { type: "object", properties: {} }
      }
    }));
    body.tool_choice = "auto";
  } else if (responseFormat && responseFormat.type) {
    body.response_format = responseFormat;
  } else if (json) {
    body.response_format = { type: "json_object" };
  }
  const headers = {
    Authorization: "Bearer " + runtime.apiKey,
    "Content-Type": "application/json"
  };
  if (runtime.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://roleflow.io";
    headers["X-Title"] = "Roleflow";
  }
  return { url, init: { method: "POST", headers, body: JSON.stringify(body) } };
}

function anthropicRequest({ runtime, spec, model, system, messages, json, toolList, heat, maxTokens }) {
  const prompt = json ? String(system || "") + "\n\nReply with JSON only." : String(system || "");
  const body = {
    model,
    max_tokens: Math.min(16000, Math.max(1, Math.round(Number(maxTokens) || 1024))),
    temperature: heat,
    system: prompt,
    messages: anthropicMessages(messages)
  };
  if (toolList.length) {
    body.tools = toolList.map((tool) => ({
      name: String(tool.name).slice(0, 64),
      description: String(tool.description || "").slice(0, 500),
      input_schema: tool.parameters || { type: "object", properties: {} }
    }));
  }
  return {
    url: runtime.endpoint || spec.url,
    init: {
      method: "POST",
      headers: {
        "x-api-key": runtime.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  };
}

function geminiRequest({ runtime, model, system, messages, json, toolList, heat }) {
  const gemini3 = /^gemini-3/i.test(model);
  const generationConfig = {};
  if (json) generationConfig.responseMimeType = "application/json";
  if (gemini3) {
    generationConfig.thinkingConfig = { thinkingLevel: "low" };
    if (Number.isFinite(heat) && heat >= 1) generationConfig.temperature = heat;
  } else {
    generationConfig.temperature = heat;
  }
  const body = {
    systemInstruction: { parts: [{ text: json ? String(system || "") + "\n\nReply with JSON only." : String(system || "") }] },
    contents: geminiContents(messages),
    generationConfig
  };
  if (toolList.length) {
    body.tools = [{
      functionDeclarations: toolList.map((tool) => ({
        name: String(tool.name).slice(0, 64),
        description: String(tool.description || "").slice(0, 500),
        parameters: tool.parameters || { type: "object", properties: {} }
      }))
    }];
  }
  return {
    url: "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": runtime.apiKey },
      body: JSON.stringify(body)
    }
  };
}

function customUrl(baseUrl) {
  const base = safeBaseUrl(baseUrl);
  if (!base) throw new Error("The custom address has to be https.");
  if (base.endsWith("/chat/completions")) return base;
  return base + "/chat/completions";
}

function modelForProvider(provider, value) {
  const spec = PROVIDERS[provider] || PROVIDERS.xai;
  const named = String(value || "").trim().slice(0, 120);
  if (provider === "custom" || provider === "openrouter") return named || spec.defaultModel;
  if (!named || (spec.models.length && !spec.models.includes(named))) return spec.defaultModel;
  return named;
}

function geminiContents(messages) {
  const rows = [];
  plainMessages(messages).forEach((message) => {
    if (!message.content) return;
    const role = message.role === "assistant" ? "model" : "user";
    const last = rows[rows.length - 1];
    if (last && last.role === role) last.parts[0].text += "\n" + message.content;
    else rows.push({ role, parts: [{ text: message.content }] });
  });
  if (!rows.length) return [{ role: "user", parts: [{ text: "Continue." }] }];
  if (rows[0].role !== "user") rows.unshift({ role: "user", parts: [{ text: "Continue." }] });
  return rows;
}

function plainMessages(messages) {
  return (messages || []).map((message) => ({
    role: message && message.role === "assistant" ? "assistant" : "user",
    content: String((message && message.content) || "")
  }));
}

function anthropicMessages(messages) {
  const rows = plainMessages(messages).filter((message) => message.content);
  if (!rows.length) return [{ role: "user", content: "Continue." }];
  if (rows[0].role !== "user") rows.unshift({ role: "user", content: "Continue." });
  return rows;
}

function parseOpenai(body) {
  const message = body.choices && body.choices[0] && body.choices[0].message ? body.choices[0].message : {};
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return {
    text: String(message.content || ""),
    toolCalls: calls.map((call) => ({
      id: String((call && call.id) || ""),
      name: String(call && call.function && call.function.name || ""),
      arguments: parseArgs(call && call.function && call.function.arguments)
    })).filter((call) => call.name)
  };
}

function parseAnthropic(body) {
  const blocks = Array.isArray(body.content) ? body.content : [];
  const text = blocks.filter((block) => block && block.type === "text").map((block) => block.text || "").join("");
  const toolCalls = blocks.filter((block) => block && block.type === "tool_use").map((block) => ({
    id: String(block.id || ""),
    name: String(block.name || ""),
    arguments: block.input && typeof block.input === "object" ? block.input : {}
  })).filter((call) => call.name);
  return { text, toolCalls };
}

function parseGemini(body) {
  const parts = body.candidates && body.candidates[0] && body.candidates[0].content && body.candidates[0].content.parts
    ? body.candidates[0].content.parts
    : [];
  let text = "";
  const toolCalls = [];
  parts.forEach((part) => {
    if (!part || part.thought === true) return;
    if (part.text) text += part.text;
    if (part.functionCall && part.functionCall.name) {
      toolCalls.push({
        id: "",
        name: String(part.functionCall.name),
        arguments: part.functionCall.args && typeof part.functionCall.args === "object" ? part.functionCall.args : {}
      });
    }
  });
  return { text, toolCalls };
}

function parseArgs(value) {
  if (value && typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function providerError(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  if (body.error && typeof body.error === "object") return String(body.error.message || "");
  if (typeof body.error === "string") return body.error;
  return "";
}

function readUsage(provider, payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const usage = body.usage && typeof body.usage === "object" ? body.usage : null;
  if (!usage) return null;
  const input = Number(usage.input_tokens != null ? usage.input_tokens : usage.prompt_tokens);
  const output = Number(usage.output_tokens != null ? usage.output_tokens : usage.completion_tokens);
  if (!Number.isFinite(input) && !Number.isFinite(output)) return null;
  return { input: Math.max(0, Number.isFinite(input) ? input : 0), output: Math.max(0, Number.isFinite(output) ? output : 0) };
}

function logUsage(result) {
  if (!result || !result.usage) return;
  console.log(JSON.stringify({
    event: "llm_usage",
    provider: result.provider || "",
    model: result.model || "",
    source: result.keySource || "",
    input_tokens: result.usage.input,
    output_tokens: result.usage.output
  }));
}

function redactListed(value, secrets) {
  let out = String(value || "");
  (Array.isArray(secrets) ? secrets : [secrets]).forEach((secret) => {
    out = redactSecret(out, secret);
  });
  return out;
}
