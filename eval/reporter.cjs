'use strict';

const fs = require('fs');
const path = require('path');

// Accuracy targets (from plan.md item 1.0). Adjust these as targets evolve.
const TARGETS = {
  OVERALL_PRECISION: 0.85,    // >= 85%
  OVERALL_RECALL: 0.65,       // >= 65%
  MIN_TACTIC_PRECISION: 0.70, // No tactic below 70% precision
  QUOTE_FIDELITY: 0.95        // >= 95%
};

/**
 * Format a number as a percentage string.
 */
function pct(n) {
  return (n * 100).toFixed(1) + '%';
}

/**
 * Truncate a string to maxLen, adding ellipsis if needed.
 */
function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

/**
 * Print per-tactic breakdown table for a set of metrics.
 */
function printTacticTable(metrics, label) {
  const { perTactic } = metrics;
  const tacticEntries = Object.entries(perTactic)
    .map(([name, t]) => ({ name, ...t }))
    .sort((a, b) => a.f1 - b.f1);

  if (tacticEntries.length === 0) return tacticEntries;

  console.log(`\n  ${label} (sorted by F1, worst first)`);
  console.log('  ' + '-'.repeat(74));
  console.log('  ' + 'Tactic'.padEnd(28) + 'Prec'.padStart(8) + 'Rec'.padStart(8) + 'F1'.padStart(8) + 'TP'.padStart(6) + 'FP'.padStart(6) + 'FN'.padStart(6));
  console.log('  ' + '-'.repeat(74));

  for (const t of tacticEntries) {
    console.log(
      '  ' +
      t.name.padEnd(28) +
      pct(t.precision).padStart(8) +
      pct(t.recall).padStart(8) +
      pct(t.f1).padStart(8) +
      String(t.tp).padStart(6) +
      String(t.fp).padStart(6) +
      String(t.fn).padStart(6)
    );
  }

  return tacticEntries;
}

/**
 * Print false positives/negatives from a details array.
 */
function printErrors(details, label) {
  const prefix = label ? `${label} ` : '';
  const allFP = [];
  for (const d of details) {
    for (const fp of d.falsePositives) {
      allFP.push({ tactic: fp.tactic, text: fp.text, file: d.file });
    }
  }
  if (allFP.length > 0) {
    console.log(`\n  ${prefix}FALSE POSITIVES (${allFP.length})`);
    console.log('  ' + '-'.repeat(74));
    for (const fp of allFP) {
      console.log(`  [${fp.tactic}] "${truncate(fp.text, 60)}" (${fp.file})`);
    }
  }

  const allFN = [];
  for (const d of details) {
    for (const fn of d.falseNegatives) {
      allFN.push({ tactic: fn.tactic, text: fn.text, file: d.file });
    }
  }
  if (allFN.length > 0) {
    console.log(`\n  ${prefix}FALSE NEGATIVES (${allFN.length})`);
    console.log('  ' + '-'.repeat(74));
    for (const fn of allFN) {
      console.log(`  [${fn.tactic}] "${truncate(fn.text, 60)}" (${fn.file})`);
    }
  }
}

/**
 * Print a formatted console report of evaluation metrics.
 *
 * @param {Object} results - { standard: { metrics, details }, ambiguous: { metrics, details } }
 * @param {Object} runMeta - Run metadata for reproducibility
 */
function consoleReport(results, runMeta) {
  const { standard, ambiguous } = results;
  const { metrics, details } = standard;
  const { perTactic, overall, quoteFidelity } = metrics;

  console.log('\n' + '='.repeat(80));
  console.log('  EVALUATION RESULTS');
  console.log('='.repeat(80));

  if (runMeta) {
    console.log('\n  RUN');
    console.log('  ' + '-'.repeat(60));
    console.log(`  Prompt:      ${runMeta.prompt}`);
    console.log(`  Model:       ${runMeta.model}`);
    console.log(`  Filter:      ${runMeta.filter || '(none)'}`);
    console.log(`  Corpus size: ${runMeta.corpusSize} (${runMeta.standardCount} standard, ${runMeta.ambiguousCount} ambiguous)`);
    console.log(`  Git SHA:     ${runMeta.gitSha}`);
  }

  // Headline metrics -- standard examples only
  console.log('\n  OVERALL (standard examples only)');
  console.log('  ' + '-'.repeat(60));
  console.log(`  Precision:      ${pct(overall.precision)}  (${overall.tp} TP, ${overall.fp} FP)`);
  console.log(`  Recall:         ${pct(overall.recall)}  (${overall.tp} TP, ${overall.fn} FN)`);
  console.log(`  F1:             ${pct(overall.f1)}`);
  console.log(`  Quote Fidelity: ${pct(quoteFidelity)}`);
  console.log(`  Examples:       ${details.length}`);

  // Per-tactic table for standard examples
  const tacticEntries = printTacticTable(metrics, 'PER-TACTIC BREAKDOWN');

  // False positives/negatives for standard examples
  printErrors(details);

  // Target checks -- evaluated against standard metrics only
  const checks = [];

  const precPass = overall.precision >= TARGETS.OVERALL_PRECISION;
  checks.push(precPass);
  console.log('\n  TARGETS');
  console.log('  ' + '-'.repeat(60));
  console.log(`  Overall precision >= ${pct(TARGETS.OVERALL_PRECISION)}:`.padEnd(38) +
    `${pct(overall.precision)}  ${precPass ? 'PASS' : 'FAIL'}`);

  const recPass = overall.recall >= TARGETS.OVERALL_RECALL;
  checks.push(recPass);
  console.log(`  Overall recall >= ${pct(TARGETS.OVERALL_RECALL)}:`.padEnd(38) +
    `${pct(overall.recall)}  ${recPass ? 'PASS' : 'FAIL'}`);

  // Find the worst tactic below threshold, if any
  const failingTactics = tacticEntries.filter(t => t.precision < TARGETS.MIN_TACTIC_PRECISION);
  const allTacticsPass = failingTactics.length === 0;
  checks.push(allTacticsPass);
  if (allTacticsPass) {
    console.log(`  All tactics >= ${pct(TARGETS.MIN_TACTIC_PRECISION)} precision:`.padEnd(38) + 'PASS');
  } else {
    const worst = failingTactics.sort((a, b) => a.precision - b.precision)[0];
    console.log(`  All tactics >= ${pct(TARGETS.MIN_TACTIC_PRECISION)} precision:`.padEnd(38) +
      `FAIL  (${worst.name}: ${pct(worst.precision)})`);
  }

  const quotePass = quoteFidelity >= TARGETS.QUOTE_FIDELITY;
  checks.push(quotePass);
  console.log(`  Quote fidelity >= ${pct(TARGETS.QUOTE_FIDELITY)}:`.padEnd(38) +
    `${pct(quoteFidelity)}  ${quotePass ? 'PASS' : 'FAIL'}`);

  const passed = checks.filter(Boolean).length;
  console.log(`\n  Verdict: ${passed} of ${checks.length} targets met`);

  // Ambiguous examples -- separate informational section
  if (ambiguous && ambiguous.metrics && ambiguous.details.length > 0) {
    const ambMetrics = ambiguous.metrics;
    const ambDetails = ambiguous.details;

    console.log('\n  ' + '-'.repeat(78));
    console.log('  AMBIGUOUS EXAMPLES (not included in headline metrics)');
    console.log('  ' + '-'.repeat(78));
    console.log(`  Precision:      ${pct(ambMetrics.overall.precision)}  (${ambMetrics.overall.tp} TP, ${ambMetrics.overall.fp} FP)`);
    console.log(`  Recall:         ${pct(ambMetrics.overall.recall)}  (${ambMetrics.overall.tp} TP, ${ambMetrics.overall.fn} FN)`);
    console.log(`  F1:             ${pct(ambMetrics.overall.f1)}`);
    console.log(`  Quote Fidelity: ${pct(ambMetrics.quoteFidelity)}`);
    console.log(`  Examples:       ${ambDetails.length}`);

    printTacticTable(ambMetrics, 'AMBIGUOUS PER-TACTIC');
    printErrors(ambDetails, 'AMBIGUOUS');
  }

  console.log('\n' + '='.repeat(80) + '\n');
}

/**
 * Save full results to eval/results/<ISO-timestamp>.json
 *
 * @param {Object} results - { standard: { metrics, details }, ambiguous: { metrics, details } }
 * @param {Object} runMeta - Run metadata for reproducibility
 * @param {string} [outputDir] - Override output directory
 */
function saveResults(results, runMeta, outputDir) {
  const dir = outputDir || path.join(__dirname, 'results');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}.json`;
  const filepath = path.join(dir, filename);

  const output = {
    run: {
      prompt: runMeta ? runMeta.prompt : 'unknown',
      model: runMeta ? runMeta.model : 'unknown',
      filter: runMeta ? runMeta.filter : null,
      corpusSize: runMeta ? runMeta.corpusSize : 0,
      standardCount: runMeta ? runMeta.standardCount : 0,
      ambiguousCount: runMeta ? runMeta.ambiguousCount : 0,
      gitSha: runMeta ? runMeta.gitSha : 'unknown',
      timestamp: new Date().toISOString()
    },
    // Headline metrics come from standard examples only
    metrics: results.standard.metrics,
    details: results.standard.details,
    // Ambiguous results stored separately
    ambiguous: results.ambiguous.metrics
      ? { metrics: results.ambiguous.metrics, details: results.ambiguous.details }
      : null
  };

  fs.writeFileSync(filepath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Results saved to ${filepath}`);

  return filepath;
}

module.exports = { consoleReport, saveResults };
