// Read Brief Analysis: validates the model's brief breakdown and builds the concept generation request.

const ctx = $('Normalize Brief').first().json;
const res = $input.first().json;

const analysis = parseJsonLoose(geminiText(res));

const needed = ['core_message', 'pain_points', 'usps', 'angles'];
const gaps = needed.filter(k => analysis[k] == null || (Array.isArray(analysis[k]) && analysis[k].length === 0));
if (gaps.length) throw new Error('Brief analysis is missing: ' + gaps.join(', '));

for (const k of ['pain_points', 'desires', 'usps', 'objections', 'proof_points', 'angles', 'compliance_notes', 'open_questions']) {
  if (!Array.isArray(analysis[k])) analysis[k] = analysis[k] ? [String(analysis[k])] : [];
}

const usage = usageOf(res);
const { brief } = ctx;
const arMatch = brief.formats.join(' ').match(/\b(\d{1,2}:\d{1,2})\b/);
const aspect = arMatch ? arMatch[1] : '9:16';

const prompt = `TASK: CONCEPT_GENERATION
You write production-ready AI video ad concepts for ${brief.platforms.join(', ')}.
Create exactly ${brief.num_concepts} concepts. Each must use a DIFFERENT angle from the analysis.
Return ONLY JSON matching the schema.

Production rules:
- hook: what is seen/heard in the first 3 seconds, max 12 words.
- script: 3 to 6 beats, total 15 to 30 seconds.
- midjourney_prompt: one keyframe/thumbnail still. Describe subject, setting, lighting, lens, style. End with --ar ${aspect}. No brand logos or text in the image.
- kling_prompt: image-to-video motion for that keyframe. Camera move, subject action, pacing, 5 to 10 seconds.
- elevenlabs.voiceover_text: the full spoken VO, natural and speakable. voice_direction: gender, age, accent, energy.
- Respect every restriction. Include every mandatory.
- Only make claims the brief supports. No invented numbers, timings, taste or quality comparisons
  (e.g. don't say "ready in 15 seconds" or "tastes exactly like the cafe" unless the brief says so).
  If a claim would make the ad stronger but isn't in the brief, leave it out.
- Tone: ${brief.tone}.

Schema:
{
  "concepts": [
    {
      "title": "...",
      "angle": "...",
      "hook": "...",
      "script": [{ "t": "0-3s", "visual": "...", "voiceover": "...", "on_screen_text": "..." }],
      "cta": "...",
      "midjourney_prompt": "...",
      "kling_prompt": "...",
      "elevenlabs": { "voice_direction": "...", "voiceover_text": "..." },
      "est_duration_s": 20
    }
  ]
}

Brief:
${JSON.stringify(brief, null, 2)}

Strategist analysis:
${JSON.stringify(analysis, null, 2)}`;

return [{
  json: {
    analysis,
    aspect,
    usage_so_far: usage,
    url: ctx.url,
    gemini_request: geminiRequest(prompt, ctx.config),
  },
}];
