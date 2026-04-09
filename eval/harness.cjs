'use strict';

// Load environment variables before anything else
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { matchPredictions, quoteFidelity, calculateMetrics } = require('./scorer.cjs');
const { consoleReport, saveResults } = require('./reporter.cjs');

// ---- CLI argument parsing ----

function parseArgs(argv) {
  const args = argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: npm run eval -- [options]

Options:
  --prompt <path>   Prompt module to use (default: eval/prompts/v1.cjs)
  --model <name>    Anthropic model ID (default: claude-sonnet-4-6-20250514)
  --filter <term>   Filter corpus files by filename or text content

Examples:
  npm run eval
  npm run eval -- --filter emotional
  npm run eval -- --prompt eval/prompts/v2.cjs
  npm run eval -- --model claude-haiku-4-5-20251001
  npm run eval:compare results/a.json results/b.json`);
    process.exit(0);
  }

  const opts = {
    prompt: path.join(__dirname, 'prompts', 'v1.cjs'),
    model: 'claude-sonnet-4-6-20250514',
    filter: null
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prompt' && args[i + 1]) {
      opts.prompt = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--model' && args[i + 1]) {
      opts.model = args[i + 1];
      i++;
    } else if (args[i] === '--filter' && args[i + 1]) {
      opts.filter = args[i + 1];
      i++;
    }
  }

  return opts;
}

// ---- Response parsing (mirrors background.js parseJsonResponse) ----

function parseJsonResponse(rawContent) {
  try {
    const cleaned = rawContent.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    const detected = parsed.tactics_detected;
    if (!Array.isArray(detected)) return null;

    return detected
      .filter(t => t.tactic_name && t.definition && Array.isArray(t.instances) && t.instances.length > 0)
      .map(t => ({
        tactic: t.tactic_name,
        definition: t.definition,
        examples: t.instances.map(inst => ({
          text: inst.exact_quote,
          explanation: inst.explanation
        }))
      }));
  } catch {
    return null;
  }
}

// ---- Rate limiter: 1 request per second ----

let lastRequestTime = 0;

async function rateLimit() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 1000) {
    await new Promise(resolve => setTimeout(resolve, 1000 - elapsed));
  }
  lastRequestTime = Date.now();
}

// ---- Corpus loading ----

function loadCorpus(corpusDir, filter) {
  if (!fs.existsSync(corpusDir)) {
    console.error(`Corpus directory not found: ${corpusDir}`);
    console.error('Create corpus examples in eval/corpus/ as JSON files.');
    process.exit(1);
  }

  const files = fs.readdirSync(corpusDir)
    .filter(f => f.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    console.error(`No JSON files found in ${corpusDir}`);
    console.error('Create corpus examples in eval/corpus/ as JSON files.');
    process.exit(1);
  }

  let examples = [];
  for (const f of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(corpusDir, f), 'utf-8'));
    } catch (err) {
      console.warn(`Warning: Skipping ${f} — malformed JSON: ${err.message}`);
      continue;
    }
    if (typeof data.text !== 'string') {
      console.warn(`Warning: Skipping ${f} — missing or non-string "text" field`);
      continue;
    }
    examples.push({ file: f, ...data });
  }

  if (filter) {
    examples = examples.filter(ex =>
      ex.file.toLowerCase().includes(filter.toLowerCase()) ||
      (ex.text && ex.text.toLowerCase().includes(filter.toLowerCase()))
    );
    console.log(`Filter "${filter}" matched ${examples.length} of ${files.length} corpus files.`);
  }

  return examples;
}

// ---- Main runner ----

async function run() {
  const opts = parseArgs(process.argv);

  // Validate API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is not set.');
    console.error('Set it in your .env file or export it in your shell:');
    console.error('  export ANTHROPIC_API_KEY=sk-ant-...');
    process.exit(1);
  }

  // Load prompt module
  let promptModule;
  try {
    promptModule = require(opts.prompt);
  } catch (err) {
    console.error(`Failed to load prompt file: ${opts.prompt}`);
    console.error(err.message);
    process.exit(1);
  }

  const { buildSystemPrompt, buildUserPrompt } = promptModule;
  if (typeof buildSystemPrompt !== 'function' || typeof buildUserPrompt !== 'function') {
    console.error('Prompt file must export buildSystemPrompt() and buildUserPrompt(content).');
    process.exit(1);
  }

  // Initialize Anthropic client
  // Use dynamic import for the ESM-compatible SDK
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic();

  // Load corpus and identify ambiguous examples.
  // Both sets run through the same API + scoring loop, but metrics are
  // computed and reported separately so ambiguous edge cases don't pollute
  // headline precision/recall numbers.
  const corpusDir = path.join(__dirname, 'corpus');
  const examples = loadCorpus(corpusDir, opts.filter);

  const ambiguousFiles = new Set();
  for (const ex of examples) {
    if (ex.metadata && ex.metadata.type === 'ambiguous') {
      ambiguousFiles.add(ex.file);
    }
  }

  // Collect run metadata for reproducibility
  let gitSha = 'unknown';
  try {
    gitSha = require('child_process').execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch { /* non-git environment or git not available */ }

  const runMeta = {
    prompt: opts.prompt,
    model: opts.model,
    filter: opts.filter,
    corpusSize: examples.length,
    standardCount: examples.length - ambiguousFiles.size,
    ambiguousCount: ambiguousFiles.size,
    gitSha
  };

  console.log(`\nEvaluating ${examples.length} examples (${runMeta.standardCount} standard, ${runMeta.ambiguousCount} ambiguous) with model ${opts.model}`);
  console.log(`Prompt: ${opts.prompt}\n`);

  const systemPrompt = buildSystemPrompt();
  const details = [];

  for (let i = 0; i < examples.length; i++) {
    const example = examples[i];
    const label = `[${i + 1}/${examples.length}] ${example.file}`;

    try {
      await rateLimit();

      process.stdout.write(`${label} ... `);

      const userPrompt = buildUserPrompt(example.text);

      const response = await client.messages.create({
        model: opts.model,
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      });

      const rawContent = response.content?.[0]?.text || '';
      if (!rawContent) {
        console.log('SKIP (empty API response)');
        details.push({
          file: example.file,
          predictions: [],
          annotations: example.annotations || [],
          truePositives: [],
          falsePositives: [],
          falseNegatives: example.annotations || [],
          quoteFidelity: 0,
          error: 'Empty API response'
        });
        continue;
      }
      const predictions = parseJsonResponse(rawContent);
      if (predictions === null) {
        console.warn(`Warning: Failed to parse model response for ${example.file}`);
      }
      const safePredictions = predictions || [];

      // Annotations from corpus file
      const annotations = example.annotations || [];

      // Score
      const matching = matchPredictions(safePredictions, annotations, example.text);
      const qf = quoteFidelity(safePredictions, example.text);

      const result = {
        file: example.file,
        predictions: safePredictions,
        annotations,
        truePositives: matching.truePositives,
        falsePositives: matching.falsePositives,
        falseNegatives: matching.falseNegatives,
        quoteFidelity: qf,
        tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
      };
      // Store raw response for debugging when parsing failed
      if (predictions === null) {
        result.rawResponse = rawContent.slice(0, 500);
      }

      details.push(result);

      const tp = matching.truePositives.length;
      const fp = matching.falsePositives.length;
      const fn = matching.falseNegatives.length;
      console.log(`TP=${tp} FP=${fp} FN=${fn} QF=${pct(qf)}`);

    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      // Log and continue -- don't let one failure stop the run
      details.push({
        file: example.file,
        predictions: [],
        annotations: example.annotations || [],
        truePositives: [],
        falsePositives: [],
        falseNegatives: example.annotations || [],
        quoteFidelity: 0,
        error: err.message
      });
    }
  }

  // Split details into standard and ambiguous for separate metric calculation.
  // Headline metrics come from standard examples only; ambiguous results are
  // informational and reported in their own section.
  const standardDetails = details.filter(d => !ambiguousFiles.has(d.file));
  const ambiguousDetails = details.filter(d => ambiguousFiles.has(d.file));

  const standardMetrics = calculateMetrics(standardDetails);
  const ambiguousMetrics = ambiguousDetails.length > 0
    ? calculateMetrics(ambiguousDetails)
    : null;

  consoleReport(
    { standard: { metrics: standardMetrics, details: standardDetails },
      ambiguous: { metrics: ambiguousMetrics, details: ambiguousDetails } },
    runMeta
  );
  saveResults(
    { standard: { metrics: standardMetrics, details: standardDetails },
      ambiguous: { metrics: ambiguousMetrics, details: ambiguousDetails } },
    runMeta
  );
}

function pct(n) {
  return (n * 100).toFixed(1) + '%';
}

// Entry point
run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
