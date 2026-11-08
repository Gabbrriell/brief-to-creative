// ---- shared helpers (prepended to every Code node by scripts/build-workflow.js) ----

// Pull the text out of a Gemini generateContent response, failing loudly on blocks/truncation.
function geminiText(res) {
  if (res && res.error) {
    const msg = typeof res.error === 'string' ? res.error : (res.error.message || JSON.stringify(res.error));
    throw new Error('Gemini request failed: ' + String(msg).slice(0, 300));
  }
  const cand = res && res.candidates && res.candidates[0];
  if (!cand) {
    const why = res && res.promptFeedback ? JSON.stringify(res.promptFeedback) : 'no candidates';
    throw new Error('Gemini returned nothing usable: ' + why.slice(0, 300));
  }
  if (cand.finishReason && cand.finishReason !== 'STOP') {
    throw new Error('Gemini stopped early (' + cand.finishReason + '), output is incomplete');
  }
  return ((cand.content && cand.content.parts) || []).map(p => p.text || '').join('');
}

// LLMs sometimes wrap JSON in ``` fences or add chatter. Strip that before parsing.
// Also repairs the classic small-model mistake: trailing commas like {"a": 1,}
function parseJsonLoose(text) {
  const cleaned = String(text).trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  const start = cleaned.search(/[\[{]/);
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  const body = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const attempts = [
    cleaned,
    body,
    body.replace(/,\s*([}\]])/g, '$1'), // trailing commas
  ];
  let lastError;
  for (const candidate of attempts) {
    try { return JSON.parse(candidate); } catch (e) { lastError = e; }
  }
  throw new Error('Could not parse model output as JSON (' + lastError.message + '): ' + cleaned.slice(0, 200));
}

function usageOf(res) {
  const u = (res && res.usageMetadata) || {};
  return {
    input: u.promptTokenCount || 0,
    // thinking tokens are billed as output on Gemini thinking models
    output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
    calls: 1,
  };
}

function addUsage(a, b) {
  return {
    input: (a.input || 0) + (b.input || 0),
    output: (a.output || 0) + (b.output || 0),
    calls: (a.calls || 0) + (b.calls || 0),
  };
}

function costUsd(usage, pricing) {
  const usd = (usage.input / 1e6) * pricing.input_per_1m + (usage.output / 1e6) * pricing.output_per_1m;
  return Math.round(usd * 1e6) / 1e6;
}

function geminiRequest(prompt, config) {
  const generationConfig = { responseMimeType: 'application/json' };
  // Gemini 3.x models "think" before answering. Default thinking made calls take minutes,
  // so it's turned down. Set thinkingLevel to null in CONFIG if your model rejects it.
  if (config && config.thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel: config.thinkingLevel };
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig,
  };
}

function geminiUrl(config) {
  return config.baseUrl.replace(/\/$/, '') + '/v1beta/models/' + config.model + ':generateContent';
}

// ---- end shared helpers ----
