#!/usr/bin/env node
// Fake Gemini generateContent endpoint so the whole workflow can be tested in n8n without an API key.
// It also simulates the annoying real-world stuff: fenced JSON, and one scoring call that always 500s.
// Usage: node test/mock-gemini.js   (listens on 127.0.0.1:8787)

const http = require('http');
const PORT = process.env.PORT || 8787;
const calls = [];

const wrap = text => ({
  candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 450, thoughtsTokenCount: 50 },
});

const analysis = {
  core_message: 'Cafe-quality iced coffee at home for a fraction of the cafe habit.',
  audience_insight: 'They love the ritual but hate watching the money disappear.',
  pain_points: ['Cafe runs add up fast', 'Waiting in line between calls'],
  desires: ['Treat-yourself feeling without guilt'],
  usps: ['1L makes 8 drinks', 'Ready in 30 seconds'],
  objections: ['Will it taste as good as the cafe?'],
  proof_points: [],
  angles: ['Cafe math', 'Between-meetings ritual', 'Kitchen barista', 'Guilt-free treat'],
  visual_direction: 'Warm real kitchens, deep brown and cream, handheld UGC feel',
  compliance_notes: ['Avoid energy or productivity claims'],
  open_questions: ['Is there a recommended dilution ratio to show on screen?'],
};

const concept = n => ({
  title: `Concept ${n}`,
  angle: analysis.angles[(n - 1) % analysis.angles.length],
  hook: `Hook line number ${n} that stops the scroll`,
  script: [
    { t: '0-3s', visual: 'Hand pours concentrate over ice', voiceover: 'Stop paying cafe prices.', on_screen_text: 'Cafe math?' },
    { t: '3-12s', visual: 'Bottle close-up on kitchen counter', voiceover: 'One bottle, eight iced coffees.', on_screen_text: '1L = 8 drinks' },
    { t: '12-20s', visual: 'Sip, smile, laptop in background', voiceover: 'Use code FIRSTBREW for 20% off.', on_screen_text: 'FIRSTBREW' },
  ],
  cta: 'Shop now, code FIRSTBREW',
  midjourney_prompt: 'Iced coffee in a glass on a sunlit home kitchen counter, cold brew bottle beside it, warm brown and cream tones, 35mm, natural light --ar 9:16',
  kling_prompt: 'Slow push-in as concentrate swirls into ice, gentle handheld sway, 6 seconds',
  // Concept 2 skips the VO field on purpose to test the rebuild-from-script fallback
  elevenlabs: n === 2 ? { voice_direction: 'female, mid-20s, Indian English, upbeat' }
    : { voice_direction: 'male, late-20s, Indian English, relaxed', voiceover_text: 'Stop paying cafe prices. One bottle, eight iced coffees.' },
  est_duration_s: 20,
});

const scores = {
  1: { hook_strength: 8, brand_fit: 8, clarity: 9, platform_fit: 8, production_feasibility: 7, compliance_risk: 'low', compliance_reason: '', biggest_weakness: 'Generic opener', one_fix: 'Open on the price comparison' },
  2: { hook_strength: 9, brand_fit: 7, clarity: 8, platform_fit: 9, production_feasibility: 8, compliance_risk: 'high', compliance_reason: 'Implies productivity boost', biggest_weakness: 'Energy implication', one_fix: 'Remove focus wording' },
  3: { hook_strength: 8, brand_fit: 8, clarity: 8, platform_fit: 8, production_feasibility: 8, compliance_risk: 'low', compliance_reason: '', unsupported_claims: ['ready in exactly fifteen seconds'], biggest_weakness: 'Invented timing claim', one_fix: 'Drop the 15 second claim' },
};
const attempts = {};

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url === '/__calls') return send(200, calls);
    // n8n's Gemini credential sends the key as ?key=..., the header form is accepted too
    const auth = req.headers['x-goog-api-key'] || new URL(req.url, 'http://x').searchParams.get('key');
    let prompt = '';
    let parsed;
    try { parsed = JSON.parse(body); prompt = parsed.contents[0].parts[0].text; } catch { return send(400, { error: { message: 'bad body' } }); }
    const thinking = parsed.generationConfig && parsed.generationConfig.thinkingConfig && parsed.generationConfig.thinkingConfig.thinkingLevel;
    calls.push({ task: (prompt.match(/TASK: (\w+)/) || [])[1], concept: (prompt.match(/"title": "Concept (\d+)"/) || [])[1], hasKey: !!auth, thinking });

    if (!auth) return send(401, { error: { code: 401, message: 'API key missing' } });
    if (!/\/v1beta\/models\/[\w.-]+:generateContent(\?|$)/.test(req.url)) return send(404, { error: { message: 'unknown route ' + req.url } });

    if (prompt.includes('TASK: BRIEF_ANALYSIS')) return send(200, wrap(JSON.stringify(analysis)));
    if (prompt.includes('TASK: CONCEPT_GENERATION')) {
      const n = Number((prompt.match(/Create exactly (\d+) concepts/) || [])[1] || 4);
      const list = Array.from({ length: n }, (_, i) => concept(i + 1));
      list.push({ title: 'Broken one', hook: '' }); // invalid concept, should be dropped with a warning
      return send(200, wrap(JSON.stringify({ concepts: list })));
    }
    if (prompt.includes('TASK: CONCEPT_SCORING')) {
      const n = Number((prompt.match(/"title": "Concept (\d+)"/) || [])[1]);
      attempts[n] = (attempts[n] || 0) + 1;
      const noFail = process.env.MOCK_NO_FAIL === '1';
      // Concept 3 fails once then works (tests the retry branch). Concept 4 always fails (tests manual review).
      if (!noFail && n === 3 && attempts[n] === 1) return send(503, { error: { code: 503, message: 'Overloaded (simulated)' } });
      if (!noFail && n === 4) return send(500, { error: { code: 500, message: 'Internal error (simulated)' } });
      const text = '```json\n' + JSON.stringify(scores[n] || scores[1]) + '\n```'; // fenced on purpose
      return send(200, wrap(text));
    }
    send(400, { error: { message: 'unknown task' } });
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock gemini on http://127.0.0.1:${PORT}`));
process.on('SIGTERM', () => { console.error('CALLS ' + JSON.stringify(calls)); process.exit(0); });
