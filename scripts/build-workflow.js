#!/usr/bin/env node
// Builds the importable n8n workflow JSON from the plain JS files in src/.
// Keeping node code in real .js files means it gets linted, diffed and tested like normal code.
//
// Usage:
//   node scripts/build-workflow.js                 -> workflow/brief-to-creative.json
//   GEMINI_MODEL=gemini-2.5-flash node scripts/build-workflow.js
//   GEMINI_BASE_URL=http://127.0.0.1:8787 OUT=/tmp/test.json node scripts/build-workflow.js   (mock testing)

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
const OUT = process.env.OUT || path.join(root, 'workflow', 'brief-to-creative.json');

const helpers = read('src/lib/helpers.js');
const code = file =>
  helpers + '\n' + read(`src/nodes/${file}`)
    .replace('__GEMINI_MODEL__', MODEL)
    .replace('__GEMINI_BASE_URL__', BASE_URL);

const sampleBrief = JSON.parse(read('examples/sample-brief.json'));

const codeNode = (name, file, position, extra = {}) => ({
  parameters: { jsCode: code(file) },
  name,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position,
  ...extra,
});

const gemini = (name, position, options = {}, extra = {}) => ({
  parameters: {
    method: 'POST',
    url: '={{ $json.url }}',
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googlePalmApi',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.gemini_request) }}',
    options: { timeout: 180000, ...options },
  },
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position,
  // n8n's built-in Gemini credential (Google Gemini(PaLM) Api); it adds the API key to every call
  credentials: { googlePalmApi: { id: 'geminiApiCred', name: 'Google Gemini(PaLM) Api account' } },
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 3000,
  ...extra,
});

const nodes = [
  {
    parameters: { httpMethod: 'POST', path: 'creative-brief', responseMode: 'responseNode', options: {} },
    name: 'Webhook: New Brief',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [0, 0],
    webhookId: '6f1c2a9e-4b7d-4c1e-9a52-3b2c1d0e9f8a',
  },
  {
    parameters: {},
    name: 'Manual Test Run',
    type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1,
    position: [0, 220],
  },
  {
    parameters: { jsCode: `// Sample brief for testing without the webhook. Edit freely.\nreturn [{ json: ${JSON.stringify(sampleBrief, null, 2)} }];` },
    name: 'Sample Brief',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [220, 220],
  },
  codeNode('Normalize Brief', 'normalize-brief.js', [440, 100]),
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{
          id: 'brief-complete',
          leftValue: '={{ $json.is_complete }}',
          rightValue: true,
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        }],
        combinator: 'and',
      },
      options: {},
    },
    name: 'Brief Complete?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [660, 100],
  },
  {
    parameters: {
      respondWith: 'json',
      responseBody: '={{ JSON.stringify({ status: "needs_info", run_id: $json.run_id, questions: $json.missing }) }}',
      options: { responseCode: 422 },
    },
    name: 'Respond: Needs Info',
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position: [880, 260],
  },
  gemini('Gemini: Analyze Brief', [880, 0]),
  codeNode('Read Brief Analysis', 'read-brief-analysis.js', [1100, 0]),
  gemini('Gemini: Generate Concepts', [1320, 0]),
  codeNode('Split Concepts', 'split-concepts.js', [1540, 0]),
  // One call per concept, spaced out so rate limits don't bite.
  // Failed items go out the error branch for a second attempt instead of killing the run.
  // (n8n's built-in retry doesn't re-fire per item once continue-on-error is on, so the retry is explicit.)
  gemini('Gemini: Score Concept', [1760, 0],
    { batching: { batch: { batchSize: 1, batchInterval: 1500 } } },
    { onError: 'continueErrorOutput', retryOnFail: false }),
  {
    parameters: { amount: 10, unit: 'seconds' },
    name: 'Wait Before Retry',
    type: 'n8n-nodes-base.wait',
    typeVersion: 1.1,
    position: [1980, 200],
    webhookId: '0b7e4c2a-9d1f-4e3b-8a6c-5f2d1e0c9b8a',
  },
  {
    ...gemini('Gemini: Retry Score', [2200, 200],
      { batching: { batch: { batchSize: 1, batchInterval: 3000 } } },
      { onError: 'continueRegularOutput', retryOnFail: false }),
    parameters: {
      ...gemini('x', [0, 0]).parameters,
      // rebuild the request from the original concept item, since error items don't carry it
      url: "={{ $('Split Concepts').item.json.url }}",
      jsonBody: "={{ JSON.stringify($('Split Concepts').item.json.gemini_request) }}",
      options: { timeout: 180000, batching: { batch: { batchSize: 1, batchInterval: 3000 } } },
    },
  },
  {
    parameters: {},
    name: 'Collect Scores',
    type: 'n8n-nodes-base.merge',
    typeVersion: 3,
    position: [2420, 0],
  },
  codeNode('Rank & Build Report', 'rank-and-report.js', [2640, 0]),
  {
    parameters: {
      respondWith: 'json',
      responseBody: '={{ JSON.stringify($json) }}',
      options: { responseCode: 200 },
    },
    name: 'Respond: Creative Pack',
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position: [2860, 0],
  },
];

const link = to => ({ node: to, type: 'main', index: 0 });
const connections = {
  'Webhook: New Brief': { main: [[link('Normalize Brief')]] },
  'Manual Test Run': { main: [[link('Sample Brief')]] },
  'Sample Brief': { main: [[link('Normalize Brief')]] },
  'Normalize Brief': { main: [[link('Brief Complete?')]] },
  'Brief Complete?': { main: [[link('Gemini: Analyze Brief')], [link('Respond: Needs Info')]] },
  'Gemini: Analyze Brief': { main: [[link('Read Brief Analysis')]] },
  'Read Brief Analysis': { main: [[link('Gemini: Generate Concepts')]] },
  'Gemini: Generate Concepts': { main: [[link('Split Concepts')]] },
  'Split Concepts': { main: [[link('Gemini: Score Concept')]] },
  'Gemini: Score Concept': { main: [[link('Collect Scores')], [link('Wait Before Retry')]] },
  'Wait Before Retry': { main: [[link('Gemini: Retry Score')]] },
  'Gemini: Retry Score': { main: [[{ node: 'Collect Scores', type: 'main', index: 1 }]] },
  'Collect Scores': { main: [[link('Rank & Build Report')]] },
  'Rank & Build Report': { main: [[link('Respond: Creative Pack')]] },
};

const workflow = {
  id: 'brief2creative01',
  name: 'Brief to Creative Pack (AI ad concepts)',
  nodes,
  connections,
  active: false,
  settings: { executionOrder: 'v1', saveManualExecutions: true },
  pinData: {},
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(workflow, null, 2));
console.log(`Built ${OUT} (model: ${MODEL}, base: ${BASE_URL}, ${nodes.length} nodes)`);
