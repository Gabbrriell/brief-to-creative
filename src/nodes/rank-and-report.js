// Rank & Build Report: merges scores with concepts, ranks them, totals the cost and writes the creative pack.

const ctx = $('Normalize Brief').first().json;
const analysis = $('Read Brief Analysis').first().json.analysis;
const concepts = $('Split Concepts').all().map(i => i.json);

// Scores arrive from two branches (first try + retry), so order isn't guaranteed.
// Match each response back to its concept through n8n's item pairing instead of by position.
const responseById = {};
$input.all().forEach((item, i) => {
  let source = null;
  try { source = $('Split Concepts').itemMatching(i).json; } catch (e) { /* unpaired item */ }
  if (source && source.concept_id) responseById[source.concept_id] = item.json;
});

const { config, brief } = ctx;
const warnings = [...(concepts[0].warnings || [])];
let usage = concepts[0].usage_so_far;

const DIMS = Object.keys(config.weights);
const toScore = v => Math.min(10, Math.max(1, Math.round(Number(v)) || 1));

const results = concepts.map(c => {
  const res = responseById[c.concept_id] || { error: 'no scoring response came back' };
  let score = null;
  try {
    const s = parseJsonLoose(geminiText(res));
    usage = addUsage(usage, usageOf(res));
    const dims = {};
    DIMS.forEach(d => { dims[d] = toScore(s[d]); });
    const total = Math.round(DIMS.reduce((sum, d) => sum + dims[d] * config.weights[d], 0) * 10) / 10;
    const risk = ['low', 'medium', 'high'].includes(String(s.compliance_risk).toLowerCase())
      ? String(s.compliance_risk).toLowerCase() : 'medium';
    const unsupported = Array.isArray(s.unsupported_claims) ? s.unsupported_claims.filter(Boolean) : [];
    let rankScore = total;
    if (risk === 'high') rankScore -= config.highRiskPenalty;
    if (unsupported.length) rankScore -= config.unsupportedClaimPenalty;
    score = {
      ...dims,
      weighted_total: total,
      compliance_risk: risk,
      compliance_reason: s.compliance_reason || '',
      unsupported_claims: unsupported,
      biggest_weakness: s.biggest_weakness || '',
      one_fix: s.one_fix || '',
      rank_score: Math.round(rankScore * 10) / 10,
    };
  } catch (e) {
    // One failed scoring call shouldn't sink the whole run. Keep the concept, flag it for a human.
    warnings.push(`${c.concept_id} not scored: ${e.message}`);
  }
  return { concept_id: c.concept_id, ...c.concept, score, status: score ? 'scored' : 'needs_manual_review' };
});

results.sort((a, b) => {
  if (!a.score && !b.score) return 0;
  if (!a.score) return 1;
  if (!b.score) return -1;
  return b.score.rank_score - a.score.rank_score;
});
results.forEach((r, i) => { r.rank = i + 1; });

const cost = {
  model: config.model,
  llm_calls: usage.calls,
  input_tokens: usage.input,
  output_tokens: usage.output,
  usd: costUsd(usage, config.pricing),
  usd_per_concept: results.length ? Math.round((costUsd(usage, config.pricing) / results.length) * 1e6) / 1e6 : 0,
};

const finished = new Date();
const durationMs = finished - new Date(ctx.started_at);

// ---- Markdown creative pack (paste into Notion/Slack/Docs) ----
const md = [];
md.push(`# Creative Pack: ${brief.brand} / ${brief.product}`);
md.push(`Run \`${ctx.run_id}\` · ${finished.toISOString()} · ${(durationMs / 1000).toFixed(1)}s · ${cost.llm_calls} LLM calls · $${cost.usd.toFixed(4)}`);
md.push('');
md.push(`**Core message:** ${analysis.core_message}`);
if (analysis.audience_insight) md.push(`**Audience insight:** ${analysis.audience_insight}`);
md.push('');
md.push('| Rank | Concept | Angle | Score | Risk |');
md.push('|---|---|---|---|---|');
results.forEach(r => {
  md.push(`| ${r.rank} | ${r.title || r.concept_id} | ${r.angle || ''} | ${r.score ? r.score.weighted_total : 'n/a'} | ${r.score ? r.score.compliance_risk : 'review'} |`);
});
results.forEach(r => {
  md.push('');
  md.push(`## #${r.rank} ${r.title || r.concept_id}`);
  md.push(`**Hook:** ${r.hook}`);
  if (r.score) {
    md.push(`**Scores:** hook ${r.score.hook_strength} · brand ${r.score.brand_fit} · platform ${r.score.platform_fit} · clarity ${r.score.clarity} · feasibility ${r.score.production_feasibility}`);
    md.push(`**Fix before production:** ${r.score.one_fix}`);
    if (r.score.compliance_risk !== 'low') md.push(`**Compliance (${r.score.compliance_risk}):** ${r.score.compliance_reason}`);
    if (r.score.unsupported_claims.length) md.push(`**Claims not in the brief (cut or confirm with client):** ${r.score.unsupported_claims.map(c => `"${c}"`).join(', ')}`);
  } else {
    md.push('**Scoring failed, needs a manual review.**');
  }
  md.push('');
  md.push('| Time | Visual | VO | On screen |');
  md.push('|---|---|---|---|');
  (r.script || []).forEach(b => md.push(`| ${b.t || ''} | ${b.visual || ''} | ${b.voiceover || ''} | ${b.on_screen_text || ''} |`));
  md.push('');
  md.push('**Midjourney (keyframe):**');
  md.push('```');
  md.push(r.midjourney_prompt);
  md.push('```');
  md.push('**Kling (image-to-video):**');
  md.push('```');
  md.push(r.kling_prompt);
  md.push('```');
  md.push(`**ElevenLabs VO** (${r.elevenlabs.voice_direction || 'any'}):`);
  md.push(`> ${r.elevenlabs.voiceover_text}`);
  md.push(`**CTA:** ${r.cta || ''}`);
});
if (analysis.open_questions.length) {
  md.push('');
  md.push('## Questions for the client');
  analysis.open_questions.forEach(q => md.push(`- ${q}`));
}
if (warnings.length) {
  md.push('');
  md.push('## Run warnings');
  warnings.forEach(w => md.push(`- ${w}`));
}

return [{
  json: {
    status: warnings.length ? 'ok_with_warnings' : 'ok',
    run_id: ctx.run_id,
    brand: brief.brand,
    product: brief.product,
    generated_at: finished.toISOString(),
    duration_ms: durationMs,
    cost,
    top_pick: results[0] ? results[0].concept_id : null,
    analysis,
    concepts: results,
    warnings,
    report_markdown: md.join('\n'),
  },
}];
