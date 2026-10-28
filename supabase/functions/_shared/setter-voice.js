// Human is 0. AI is 100. Claude 5 cannot take sampling parameters, so the
// guide is prompt text. Other models map the same slider onto temperature.

export function clampVoice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 50;
  return Math.max(0, Math.min(100, Math.round(number)));
}

export function voiceTemperature(value) {
  const voice = clampVoice(value);
  return Math.round((100 - voice * 0.8)) / 100;
}

export function claudeVoiceGuide(value) {
  const voice = clampVoice(value);
  if (voice <= 12) {
    return "Sound like a person texting. Vary the wording. Use casual, imperfect phrasing, shorter messages, and slang that matches the winning conversations. A small typo is fine. Do not use emoji unless the business asks for them.";
  }
  if (voice <= 37) {
    return "Sound mostly human. Keep messages short and a little uneven. Match the casing and slang of the winning conversations. Do not use emoji unless the business asks for them.";
  }
  if (voice <= 62) {
    return "Balance a natural tone with clear structure. Keep the business rules. Do not use emoji unless the business asks for them.";
  }
  if (voice <= 87) {
    return "Stay consistent and structured. Prefer predictable phrasing and complete sentences. Do not use emoji unless the business asks for them.";
  }
  return "Stay consistent, structured, and predictable. Use the same shape of reply each time. No slang, no typos, and no emoji unless the business asks for them.";
}

export function voiceFooter(value, language) {
  const voice = clampVoice(value);
  const human = language === "es" ? "Humano" : "Human";
  const ai = language === "es" ? "IA" : "AI";
  if (voice <= 12) return human + " 0";
  if (voice >= 88) return ai + " 100";
  return human + "↔" + ai + " " + voice;
}

export function prepareVoice({ provider, model, system, voice, temperature }) {
  const named = String(model || "");
  const claude5 = provider === "anthropic" && /^claude-(opus|sonnet|haiku)-5(?:[^0-9]|$)/i.test(named);
  if (claude5) {
    const guide = voice == null || voice === "" ? "" : "\n\n" + claudeVoiceGuide(voice);
    return { system: String(system || "") + guide, omitTemperature: true, temperature: undefined };
  }
  if (voice != null && voice !== "") {
    return { system: String(system || ""), omitTemperature: false, temperature: voiceTemperature(voice) };
  }
  return {
    system: String(system || ""),
    omitTemperature: false,
    temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : undefined
  };
}
