'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Format a number as a percentage string.
 */
function pct(n) {
  return (n * 100).toFixed(1) + '%';
}

/**
 * Format a delta with direction arrow.
 */
function delta(newVal, oldVal) {
  const diff = newVal - oldVal;
  if (Math.abs(diff) < 0.001) return '  --  ';
  const arrow = diff > 0 ? ' ^' : ' v';
  const sign = diff > 0 ? '+' : '';
  return sign + (diff * 100).toFixed(1) + '%' + arrow;
}

/**
 * Compare two result files side by side.
 */
function compare(file1Path, file2Path) {
  const data1 = JSON.parse(fs.readFileSync(file1Path, 'utf-8'));
  const data2 = JSON.parse(fs.readFileSync(file2Path, 'utf-8'));

  const m1 = data1.metrics;
  const m2 = data2.metrics;

  const label1 = path.basename(file1Path);
  const label2 = path.basename(file2Path);

  // Support both old (top-level timestamp) and new (run.timestamp) formats
  const ts1 = (data1.run && data1.run.timestamp) || data1.timestamp;
  const ts2 = (data2.run && data2.run.timestamp) || data2.timestamp;

  console.log('\n' + '='.repeat(90));
  console.log('  COMPARISON');
  console.log(`  A: ${label1}  (${ts1})`);
  console.log(`  B: ${label2}  (${ts2})`);
  console.log('='.repeat(90));

  // Overall comparison
  console.log('\n  OVERALL');
  console.log('  ' + '-'.repeat(78));
  console.log(
    '  ' +
    'Metric'.padEnd(20) +
    'A'.padStart(10) +
    'B'.padStart(10) +
    'Delta'.padStart(12)
  );
  console.log('  ' + '-'.repeat(78));

  const overallRows = [
    ['Precision', m1.overall.precision, m2.overall.precision],
    ['Recall', m1.overall.recall, m2.overall.recall],
    ['F1', m1.overall.f1, m2.overall.f1],
    ['Quote Fidelity', m1.quoteFidelity, m2.quoteFidelity]
  ];

  for (const [name, v1, v2] of overallRows) {
    console.log(
      '  ' +
      name.padEnd(20) +
      pct(v1).padStart(10) +
      pct(v2).padStart(10) +
      delta(v2, v1).padStart(12)
    );
  }

  // Per-tactic comparison
  const allTactics = new Set([
    ...Object.keys(m1.perTactic || {}),
    ...Object.keys(m2.perTactic || {})
  ]);

  if (allTactics.size > 0) {
    const tacticRows = [];
    for (const tactic of allTactics) {
      const t1 = (m1.perTactic || {})[tactic] || { precision: 0, recall: 0, f1: 0, tp: 0, fp: 0, fn: 0 };
      const t2 = (m2.perTactic || {})[tactic] || { precision: 0, recall: 0, f1: 0, tp: 0, fp: 0, fn: 0 };
      tacticRows.push({ tactic, t1, t2 });
    }

    // Sort by F1 delta (biggest regressions first)
    tacticRows.sort((a, b) => (a.t2.f1 - a.t1.f1) - (b.t2.f1 - b.t1.f1));

    console.log('\n  PER-TACTIC (sorted by F1 delta, regressions first)');
    console.log('  ' + '-'.repeat(84));
    console.log(
      '  ' +
      'Tactic'.padEnd(26) +
      'A-F1'.padStart(8) +
      'B-F1'.padStart(8) +
      'Delta'.padStart(10) +
      'A-Prec'.padStart(8) +
      'B-Prec'.padStart(8) +
      'A-Rec'.padStart(8) +
      'B-Rec'.padStart(8)
    );
    console.log('  ' + '-'.repeat(84));

    for (const { tactic, t1, t2 } of tacticRows) {
      console.log(
        '  ' +
        tactic.padEnd(26) +
        pct(t1.f1).padStart(8) +
        pct(t2.f1).padStart(8) +
        delta(t2.f1, t1.f1).padStart(10) +
        pct(t1.precision).padStart(8) +
        pct(t2.precision).padStart(8) +
        pct(t1.recall).padStart(8) +
        pct(t2.recall).padStart(8)
      );
    }
  }

  // Count summary
  console.log('\n  COUNTS');
  console.log('  ' + '-'.repeat(40));
  console.log(`  A: ${m1.overall.tp} TP, ${m1.overall.fp} FP, ${m1.overall.fn} FN`);
  console.log(`  B: ${m2.overall.tp} TP, ${m2.overall.fp} FP, ${m2.overall.fn} FN`);

  console.log('\n' + '='.repeat(90) + '\n');
}

// Main
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node eval/compare.cjs <file1.json> <file2.json>');
    process.exit(1);
  }
  compare(args[0], args[1]);
}

module.exports = { compare };
