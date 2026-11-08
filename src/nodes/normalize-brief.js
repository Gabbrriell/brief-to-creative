// Normalize Brief: accepts a webhook POST body or the sample brief, cleans it up,
// checks the must-have fields and builds the first LLM request (brief analysis).

const CONFIG = {
  model: '__GEMINI_MODEL__',
  baseUrl: '__GEMINI_BASE_URL__',
  thinkingLevel: 'low', // 'low' keeps each call fast; null = model default (much slower)
  defaultConcepts: 4,
  maxConcepts: 8, // hard cap so a typo like num_concepts: 80 can't burn the budget
  // Example rates in USD per 1M tokens. Update to your model's current pricing.
  pricing: { input_per_1m: 0.30, output_per_1m: 2.50 },
  // How much each score counts toward the final rank (sums to 1)
  weights: { hook_strength: 0.30, brand_fit: 0.20, platform_fit: 0.20, clarity: 0.15, production_feasibility: 0.15 },
  highRiskPenalty: 2,
  unsupportedClaimPenalty: 1, // concepts claiming things the brief never said rank lower
};

const item = $input.first().json;
const raw = item.body && typeof item.body === 'object' ? item.body : item;

const str = v => (typeof v === 'string' ? v.trim() : '');
const list = v => {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  return [];
};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

const brief = {
  brand: str(raw.brand),
  product: str(raw.product),
  audience: str(raw.audience),
  objective: str(raw.objective),
  offer: str(raw.offer),
  tone: str(raw.tone) || 'brand-appropriate',
  platforms: list(raw.platforms).length ? list(raw.platforms) : ['Meta (Reels / Stories)'],
  formats: list(raw.formats).length ? list(raw.formats) : ['9:16 video'],
  mandatories: list(raw.mandatories),
  restrictions: list(raw.restrictions),
  notes: str(raw.notes),
  num_concepts: clamp(parseInt(raw.num_concepts, 10) || CONFIG.defaultConcepts, 1, CONFIG.maxConcepts),
};

// Mapping the process first: these are the questions a strategist asks on the 30-min brief call.
// If any are blank we stop and ask, instead of letting the model guess.
const REQUIRED = {
  brand: 'Which brand is this for?',
  product: 'What exact product or offer are we advertising?',
  audience: 'Who is the target customer (age, situation, main pain)?',
  objective: 'What should the ad achieve (sales, leads, installs, awareness)?',
};
const missing = Object.entries(REQUIRED)
  .filter(([field]) => !brief[field])
  .map(([field, question]) => ({ field, question }));

const run_id = 'run_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const prompt = `TASK: BRIEF_ANALYSIS
You are a senior performance creative strategist at an AI ad agency.
Analyze this client brief and return ONLY JSON matching the schema below.
Rules:
- Use only facts in the brief. Never invent stats, awards, prices or claims.
- proof_points must come from the brief. If there are none, return an empty array.
- angles = 4 to 6 distinct ad angles (short phrases), not taglines.
- open_questions = anything the creative team would need to ask the client.

Schema:
{
  "core_message": "one sentence",
  "audience_insight": "the real tension or desire behind the purchase",
  "pain_points": ["..."],
  "desires": ["..."],
  "usps": ["..."],
  "objections": ["..."],
  "proof_points": ["..."],
  "angles": ["..."],
  "visual_direction": "look, feel, setting, colors",
  "compliance_notes": ["claims or content to be careful with on ad platforms"],
  "open_questions": ["..."]
}

Brief:
${JSON.stringify(brief, null, 2)}`;

return [{
  json: {
    run_id,
    started_at: new Date().toISOString(),
    config: CONFIG,
    brief,
    missing,
    is_complete: missing.length === 0,
    url: geminiUrl(CONFIG),
    gemini_request: geminiRequest(prompt, CONFIG),
  },
}];
