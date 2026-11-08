// Split Concepts: validates each generated concept, drops broken ones, and fans out one scoring request per concept.

const ctx = $('Normalize Brief').first().json;
const prev = $('Read Brief Analysis').first().json;
const res = $input.first().json;

const parsed = parseJsonLoose(geminiText(res));
const list = Array.isArray(parsed) ? parsed : parsed.concepts;
if (!Array.isArray(list) || list.length === 0) throw new Error('Model returned no concepts');

const warnings = [];
const valid = [];

list.forEach((c, i) => {
  const problems = [];
  if (!c || typeof c !== 'object') problems.push('not an object');
  else {
    if (!c.hook) problems.push('no hook');
    if (!Array.isArray(c.script) || c.script.length === 0) problems.push('no script beats');
    if (!c.midjourney_prompt) problems.push('no Midjourney prompt');
    if (!c.kling_prompt) problems.push('no Kling prompt');
    // VO can be rebuilt from the script beats if the model skipped it
    c.elevenlabs = c.elevenlabs || {};
    if (!c.elevenlabs.voiceover_text && Array.isArray(c.script)) {
      c.elevenlabs.voiceover_text = c.script.map(b => b.voiceover).filter(Boolean).join(' ');
    }
    if (!c.elevenlabs.voiceover_text) problems.push('no voiceover');
  }
  if (problems.length) warnings.push(`Concept ${i + 1} dropped: ${problems.join(', ')}`);
  else valid.push(c);
});

if (valid.length === 0) throw new Error('Every concept failed validation: ' + warnings.join(' | '));
if (valid.length < ctx.brief.num_concepts) {
  warnings.push(`Asked for ${ctx.brief.num_concepts} concepts, got ${valid.length} usable`);
}

const usage = addUsage(prev.usage_so_far, usageOf(res));
const { brief } = ctx;

return valid.map((concept, i) => {
  const prompt = `TASK: CONCEPT_SCORING
You are a harsh performance creative reviewer. Score this ad concept against the brief.
Scale 1-10: 5 = average, 7 = solid, 9+ = rare. Return ONLY JSON:
{
  "hook_strength": 1-10,
  "brand_fit": 1-10,
  "clarity": 1-10,
  "platform_fit": 1-10,
  "production_feasibility": 1-10,
  "compliance_risk": "low" | "medium" | "high",
  "compliance_reason": "...",
  "biggest_weakness": "...",
  "one_fix": "one concrete change that would raise the score",
  "unsupported_claims": ["exact phrases in the concept that state facts NOT in the brief"]
}
production_feasibility = how reliably current AI video/image/voice tools can produce this without uncanny results.
compliance_risk: check ad platform policy issues (health/finance claims, before-after, personal attributes) and the client restrictions.
unsupported_claims: timings, numbers, taste/quality comparisons or results the brief never states. Empty array if none.

Brief: ${JSON.stringify({ brand: brief.brand, product: brief.product, audience: brief.audience, objective: brief.objective, offer: brief.offer, platforms: brief.platforms, restrictions: brief.restrictions, mandatories: brief.mandatories, notes: brief.notes })}

Concept:
${JSON.stringify(concept, null, 2)}`;

  return {
    json: {
      concept_id: 'C' + (i + 1),
      concept,
      usage_so_far: usage,
      warnings,
      url: ctx.url,
      gemini_request: geminiRequest(prompt, ctx.config),
    },
  };
});
