#!/bin/bash
# Progressive v1-vs-v2 prompt comparison.
# Each run processes the next 10 untested files from the corpus,
# accumulating results until all 119 files are covered.
#
# Fits within Gemini free tier daily quota (20 req/day per model).
#
# Usage:
#   ./eval/compare-quick.sh                    # default: gemini-2.5-flash-lite
#   ./eval/compare-quick.sh gemini-2.5-flash   # use Flash 2.5
#   ./eval/compare-quick.sh reset              # reset progress, start over
#
# Progress is tracked in eval/progress.json.
# Cumulative results are stored in eval/results/v1-cumulative.json and v2-cumulative.json.

set -e
cd "$(dirname "$0")/.."

MODEL="${1:-gemini-2.5-flash-lite}"
PROGRESS_FILE="eval/progress.json"
BATCH_SIZE=10

# Handle reset
if [ "$1" = "reset" ]; then
  rm -f "$PROGRESS_FILE" eval/results/v1-cumulative.json eval/results/v2-cumulative.json
  echo "Progress reset. Run again to start fresh."
  exit 0
fi

# Initialize progress file if it doesn't exist
if [ ! -f "$PROGRESS_FILE" ]; then
  echo '{"completed": [], "model": "'$MODEL'"}' > "$PROGRESS_FILE"
fi

# Get next batch of files using node
SUBSET=$(node -e "
const fs = require('fs');
const path = require('path');

const progress = JSON.parse(fs.readFileSync('$PROGRESS_FILE', 'utf-8'));
const completed = new Set(progress.completed);

const allFiles = fs.readdirSync('eval/corpus')
  .filter(f => f.endsWith('.json'))
  .sort();

const remaining = allFiles.filter(f => !completed.has(f));

if (remaining.length === 0) {
  console.error('ALL_DONE');
  process.exit(0);
}

const batch = remaining.slice(0, $BATCH_SIZE);
console.log(batch.join(','));
")

# Check if all files are done
if [ "$SUBSET" = "" ]; then
  echo "=== All 119 corpus files have been evaluated! ==="
  echo ""
  echo "Final cumulative comparison:"
  npm run eval:compare -- eval/results/v1-cumulative.json eval/results/v2-cumulative.json
  exit 0
fi

# Count progress
DONE=$(node -e "const p = JSON.parse(require('fs').readFileSync('$PROGRESS_FILE','utf-8')); console.log(p.completed.length)")
TOTAL=$(ls eval/corpus/*.json | wc -l | tr -d ' ')
BATCH_COUNT=$(echo "$SUBSET" | tr ',' '\n' | wc -l | tr -d ' ')

echo "=== Eval Progress: $DONE / $TOTAL complete — running next $BATCH_COUNT files ==="
echo "Files: $SUBSET"
echo ""

echo "--- Running v1 (baseline) with $MODEL ---"
npm run eval -- --prompt eval/prompts/v1.cjs --model "$MODEL" --subset "$SUBSET"

echo ""
echo "--- Running v2 (tuned) with $MODEL ---"
npm run eval -- --prompt eval/prompts/v2.cjs --model "$MODEL" --subset "$SUBSET"

# Merge today's results into cumulative files
echo ""
echo "--- Merging results ---"
node -e "
const fs = require('fs');
const path = require('path');

// Find the two most recent result files (v2 is newer, v1 is older)
const resultFiles = fs.readdirSync('eval/results')
  .filter(f => f.endsWith('.json') && !f.includes('cumulative'))
  .sort()
  .reverse();

const v2File = path.join('eval/results', resultFiles[0]);
const v1File = path.join('eval/results', resultFiles[1]);

const v1New = JSON.parse(fs.readFileSync(v1File, 'utf-8'));
const v2New = JSON.parse(fs.readFileSync(v2File, 'utf-8'));

// Load or initialize cumulative files
function loadOrInit(filePath, template) {
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  return { ...template, details: [], run: { ...template.run, corpusSize: 0 } };
}

const v1Cum = loadOrInit('eval/results/v1-cumulative.json', v1New);
const v2Cum = loadOrInit('eval/results/v2-cumulative.json', v2New);

// Merge details (append new, skip any already present)
function mergeDetails(cumulative, newData) {
  const existingFiles = new Set(cumulative.details.map(d => d.file));
  for (const d of newData.details) {
    if (!existingFiles.has(d.file)) {
      cumulative.details.push(d);
      existingFiles.add(d.file);
    }
  }
  cumulative.run = { ...cumulative.run, corpusSize: cumulative.details.length };
}

mergeDetails(v1Cum, v1New);
mergeDetails(v2Cum, v2New);

// Recalculate metrics from all accumulated details
function recalcMetrics(data) {
  let tp = 0, fp = 0, fn = 0, qfSum = 0, qfCount = 0;
  const perTactic = {};

  for (const d of data.details) {
    if (d.error) continue;
    tp += d.truePositives.length;
    fp += d.falsePositives.length;
    fn += d.falseNegatives.length;
    qfSum += d.quoteFidelity;
    qfCount++;

    // Per-tactic tracking
    for (const t of d.truePositives) {
      const name = t.tactic || t;
      if (!perTactic[name]) perTactic[name] = { tp: 0, fp: 0, fn: 0 };
      perTactic[name].tp++;
    }
    for (const t of d.falsePositives) {
      const name = t.tactic || t;
      if (!perTactic[name]) perTactic[name] = { tp: 0, fp: 0, fn: 0 };
      perTactic[name].fp++;
    }
    for (const t of d.falseNegatives) {
      const name = t.tactic || t;
      if (!perTactic[name]) perTactic[name] = { tp: 0, fp: 0, fn: 0 };
      perTactic[name].fn++;
    }
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  const quoteFidelity = qfCount > 0 ? qfSum / qfCount : 0;

  // Per-tactic metrics
  for (const [name, counts] of Object.entries(perTactic)) {
    const p = counts.tp + counts.fp > 0 ? counts.tp / (counts.tp + counts.fp) : 0;
    const r = counts.tp + counts.fn > 0 ? counts.tp / (counts.tp + counts.fn) : 0;
    perTactic[name].precision = p;
    perTactic[name].recall = r;
    perTactic[name].f1 = p + r > 0 ? 2 * p * r / (p + r) : 0;
  }

  data.metrics = {
    overall: { precision, recall, f1, tp, fp, fn },
    perTactic,
    quoteFidelity
  };
}

recalcMetrics(v1Cum);
recalcMetrics(v2Cum);

// Update timestamps
v1Cum.run.timestamp = new Date().toISOString();
v2Cum.run.timestamp = new Date().toISOString();

fs.writeFileSync('eval/results/v1-cumulative.json', JSON.stringify(v1Cum, null, 2));
fs.writeFileSync('eval/results/v2-cumulative.json', JSON.stringify(v2Cum, null, 2));

// Update progress
const progress = JSON.parse(fs.readFileSync('$PROGRESS_FILE', 'utf-8'));
const batchFiles = '$SUBSET'.split(',');
progress.completed = [...new Set([...progress.completed, ...batchFiles])];
progress.lastRun = new Date().toISOString();
progress.model = '$MODEL';
fs.writeFileSync('$PROGRESS_FILE', JSON.stringify(progress, null, 2));

const okV1 = v1Cum.details.filter(d => !d.error).length;
const okV2 = v2Cum.details.filter(d => !d.error).length;
console.log('Cumulative: ' + v1Cum.details.length + ' files (' + okV1 + ' v1 ok, ' + okV2 + ' v2 ok)');
"

echo ""
echo "=== Cumulative Comparison ==="
npm run eval:compare -- eval/results/v1-cumulative.json eval/results/v2-cumulative.json
