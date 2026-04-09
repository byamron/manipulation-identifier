'use strict';

/**
 * Normalize a string for comparison: lowercase, collapse whitespace to single spaces, trim.
 */
function normalize(str) {
  return str.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Find the longest common substring between two strings.
 * Returns the substring itself (empty string if none).
 */
function longestCommonSubstring(a, b) {
  if (!a || !b) return '';
  const m = a.length;
  const n = b.length;

  // dp[j] = length of LCS ending at a[i-1] and b[j-1]
  // Optimized to use two rows instead of full matrix
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  let maxLen = 0;
  let endIdx = 0; // end index in `a`

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > maxLen) {
          maxLen = curr[j];
          endIdx = i;
        }
      } else {
        curr[j] = 0;
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  return a.substring(endIdx - maxLen, endIdx);
}

/**
 * Compute character overlap ratio between predicted and annotated text.
 * Normalize both strings, find longest common substring, return ratio
 * relative to the annotated string length.
 */
function charOverlap(predicted, annotated) {
  const normPred = normalize(predicted);
  const normAnnot = normalize(annotated);
  if (!normAnnot) return 0;
  const lcs = longestCommonSubstring(normPred, normAnnot);
  return lcs.length / normAnnot.length;
}

/**
 * Match predicted detections against annotations.
 *
 * A prediction matches an annotation if:
 *   (1) tactic name matches (case-insensitive)
 *   (2) charOverlap >= 0.50
 *
 * Each annotation can match at most one prediction (greedy, best overlap first).
 *
 * predictions: array of { tactic, examples: [{ text, explanation }] }
 * annotations: array of { tactic, text|quote }  (supports both field names)
 *
 * Returns { truePositives, falsePositives, falseNegatives }
 */
function matchPredictions(predictions, annotations, text) {
  // Flatten predictions into individual instances
  const flatPredictions = [];
  for (const pred of predictions) {
    for (const ex of (pred.examples || [])) {
      flatPredictions.push({
        tactic: pred.tactic,
        text: ex.text,
        explanation: ex.explanation
      });
    }
  }

  // Normalize annotation text field: corpus uses "quote", scorer uses "text"
  const normalizedAnnotations = annotations.map(a => ({
    tactic: a.tactic,
    text: a.text || a.quote || ''
  }));

  // Build all possible (prediction, annotation) pairs with overlap
  const candidates = [];
  for (let pi = 0; pi < flatPredictions.length; pi++) {
    for (let ai = 0; ai < normalizedAnnotations.length; ai++) {
      const pred = flatPredictions[pi];
      const annot = normalizedAnnotations[ai];

      // Tactic name must match (case-insensitive)
      if (pred.tactic.toLowerCase() !== annot.tactic.toLowerCase()) continue;

      const overlap = charOverlap(pred.text || '', annot.text || '');
      if (overlap >= 0.50) {
        candidates.push({ pi, ai, overlap, prediction: pred, annotation: annot });
      }
    }
  }

  // Greedy matching: best overlap first
  candidates.sort((a, b) => b.overlap - a.overlap);

  const matchedPredictions = new Set();
  const matchedAnnotations = new Set();
  const truePositives = [];

  for (const c of candidates) {
    if (matchedPredictions.has(c.pi) || matchedAnnotations.has(c.ai)) continue;
    matchedPredictions.add(c.pi);
    matchedAnnotations.add(c.ai);
    truePositives.push({
      prediction: c.prediction,
      annotation: c.annotation,
      overlap: c.overlap
    });
  }

  const falsePositives = flatPredictions.filter((_, i) => !matchedPredictions.has(i));
  const falseNegatives = normalizedAnnotations.filter((_, i) => !matchedAnnotations.has(i));

  return { truePositives, falsePositives, falseNegatives };
}

/**
 * For each prediction, check if the predicted quote is a substring of the text
 * (after normalizing whitespace). Return ratio of matches.
 */
function quoteFidelity(predictions, text) {
  const normText = normalize(text);
  let total = 0;
  let found = 0;

  for (const pred of predictions) {
    for (const ex of (pred.examples || [])) {
      total++;
      const normQuote = normalize(ex.text || '');
      if (normQuote && normText.includes(normQuote)) {
        found++;
      }
    }
  }

  return total === 0 ? 1.0 : found / total;
}

/**
 * Given array of per-example results, compute aggregate metrics.
 *
 * Each result: { truePositives, falsePositives, falseNegatives, quoteFidelity }
 *
 * Returns:
 *   perTactic: { [tactic]: { tp, fp, fn, precision, recall, f1 } }
 *   overall: { tp, fp, fn, precision, recall, f1 }
 *   quoteFidelity: number
 */
function calculateMetrics(allResults) {
  const perTactic = {};
  let totalTP = 0;
  let totalFP = 0;
  let totalFN = 0;
  let totalQF = 0;
  let qfCount = 0;

  for (const result of allResults) {
    // True positives
    for (const tp of result.truePositives) {
      const tactic = tp.annotation.tactic;
      if (!perTactic[tactic]) perTactic[tactic] = { tp: 0, fp: 0, fn: 0 };
      perTactic[tactic].tp++;
      totalTP++;
    }

    // False positives
    for (const fp of result.falsePositives) {
      const tactic = fp.tactic;
      if (!perTactic[tactic]) perTactic[tactic] = { tp: 0, fp: 0, fn: 0 };
      perTactic[tactic].fp++;
      totalFP++;
    }

    // False negatives
    for (const fn of result.falseNegatives) {
      const tactic = fn.tactic;
      if (!perTactic[tactic]) perTactic[tactic] = { tp: 0, fp: 0, fn: 0 };
      perTactic[tactic].fn++;
      totalFN++;
    }

    // Quote fidelity
    if (result.quoteFidelity !== undefined) {
      totalQF += result.quoteFidelity;
      qfCount++;
    }
  }

  // Compute precision/recall/F1 per tactic
  for (const tactic of Object.keys(perTactic)) {
    const t = perTactic[tactic];
    t.precision = t.tp + t.fp > 0 ? t.tp / (t.tp + t.fp) : 0;
    t.recall = t.tp + t.fn > 0 ? t.tp / (t.tp + t.fn) : 0;
    t.f1 = t.precision + t.recall > 0
      ? 2 * (t.precision * t.recall) / (t.precision + t.recall)
      : 0;
  }

  // Overall (micro-averaged)
  const overallPrecision = totalTP + totalFP > 0 ? totalTP / (totalTP + totalFP) : 0;
  const overallRecall = totalTP + totalFN > 0 ? totalTP / (totalTP + totalFN) : 0;
  const overallF1 = overallPrecision + overallRecall > 0
    ? 2 * (overallPrecision * overallRecall) / (overallPrecision + overallRecall)
    : 0;

  return {
    perTactic,
    overall: {
      tp: totalTP,
      fp: totalFP,
      fn: totalFN,
      precision: overallPrecision,
      recall: overallRecall,
      f1: overallF1
    },
    quoteFidelity: qfCount > 0 ? totalQF / qfCount : 1.0
  };
}

module.exports = { charOverlap, matchPredictions, quoteFidelity, calculateMetrics, normalize, longestCommonSubstring };
