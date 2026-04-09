/**
 * Fuzzy text matching for highlighting manipulation quotes in page text.
 * Pure functions, no DOM dependency.
 *
 * Test-only module: this is the testable copy of the matching logic.
 * The canonical runtime version lives in content.js (inlined because content
 * scripts cannot use ES module imports). Keep both in sync when editing.
 */

/**
 * Normalize text for comparison: collapse whitespace, normalize Unicode
 * quotes/dashes, lowercase.
 */
function normalize(text) {
  return text
    // Normalize Unicode quotes to ASCII
    .replace(/[\u2018\u2019\u201A\u2039\u203A]/g, "'")
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')
    // Normalize dashes
    .replace(/[\u2013\u2014\u2015]/g, '-')
    // Normalize ellipsis
    .replace(/\u2026/g, '...')
    // Collapse whitespace (newlines, tabs, multiple spaces → single space)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Generate trigrams (3-character substrings) from text.
 */
function trigrams(text) {
  const result = new Set();
  for (let i = 0; i <= text.length - 3; i++) {
    result.add(text.slice(i, i + 3));
  }
  return result;
}

/**
 * Calculate Jaccard similarity between two trigram sets.
 */
function trigramSimilarity(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const gram of a) {
    if (b.has(gram)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Find a quote match in the page text using three-tier matching:
 * 1. Exact — case-insensitive indexOf
 * 2. Normalized — strip whitespace, normalize Unicode quotes/dashes
 * 3. Fuzzy — sliding-window trigram similarity > threshold
 *
 * @param {string} quote - The exact_quote from the LLM response
 * @param {string} text - The full page text to search in
 * @param {number} [threshold=0.85] - Minimum trigram similarity for fuzzy match
 * @returns {{ start: number, end: number } | null}
 */
export function findMatchInText(quote, text, threshold = 0.85) {
  if (!quote || !text) return null;

  // Tier 1: Exact match (case-insensitive)
  const lowerText = text.toLowerCase();
  const lowerQuote = quote.toLowerCase();
  const exactIndex = lowerText.indexOf(lowerQuote);
  if (exactIndex !== -1) {
    return { start: exactIndex, end: exactIndex + quote.length };
  }

  // Tier 2: Normalized match
  const normText = normalize(text);
  const normQuote = normalize(quote);
  if (normQuote.length === 0) return null;

  const normIndex = normText.indexOf(normQuote);
  if (normIndex !== -1) {
    // Map normalized position back to original text position.
    // Walk through original text, tracking normalized position.
    return mapNormalizedToOriginal(text, normText, normIndex, normQuote.length);
  }

  // Tier 3: Fuzzy match — sliding window with trigram similarity
  if (normQuote.length < 3) return null; // Trigrams need at least 3 chars

  const quoteTrigrams = trigrams(normQuote);
  const windowSize = normQuote.length;
  // Allow ±30% window variance
  const minWindow = Math.max(3, Math.floor(windowSize * 0.7));
  const maxWindow = Math.ceil(windowSize * 1.3);

  let bestScore = 0;
  let bestStart = -1;
  let bestEnd = -1;

  for (let winLen = minWindow; winLen <= maxWindow; winLen++) {
    for (let i = 0; i <= normText.length - winLen; i++) {
      const window = normText.slice(i, i + winLen);
      const windowTri = trigrams(window);
      const score = trigramSimilarity(quoteTrigrams, windowTri);

      if (score > bestScore) {
        bestScore = score;
        bestStart = i;
        bestEnd = i + winLen;
      }
    }
  }

  if (bestScore >= threshold) {
    return mapNormalizedToOriginal(text, normText, bestStart, bestEnd - bestStart);
  }

  return null;
}

/**
 * Map a position in normalized text back to the original text.
 * Walks through both strings in parallel, tracking correspondence.
 */
function mapNormalizedToOriginal(original, normalized, normStart, normLen) {
  let normPos = 0;
  let origStart = -1;
  let origEnd = -1;
  let i = 0;

  // Skip leading whitespace in original that was trimmed
  while (i < original.length && /\s/.test(original[i])) {
    i++;
  }

  while (i < original.length && normPos < normStart + normLen) {
    if (normPos === normStart) {
      origStart = i;
    }

    const origChar = original[i];
    const normChar = normalized[normPos];

    if (origChar.toLowerCase() === normChar || normalize(origChar) === normChar) {
      normPos++;
      i++;
    } else if (/\s/.test(origChar)) {
      // Original has extra whitespace that was collapsed
      i++;
    } else {
      // Character was normalized (quote/dash substitution) — advance both
      normPos++;
      i++;
    }
  }

  if (origStart === -1) return null;
  origEnd = i;

  return { start: origStart, end: origEnd };
}

/**
 * Find all matches of multiple quotes in text.
 *
 * @param {Array<{exact_quote: string, explanation: string, tactic: string}>} instances
 * @param {string} text
 * @returns {Array<{start: number, end: number, text: string, explanation: string, tactic: string}>}
 */
export function findAllMatches(instances, text) {
  const matches = [];

  for (const instance of instances) {
    const match = findMatchInText(instance.exact_quote || instance.text, text);
    if (match) {
      matches.push({
        ...match,
        text: text.slice(match.start, match.end),
        explanation: instance.explanation,
        tactic: instance.tactic || instance.tactic_name
      });
    }
  }

  // Sort by position to handle overlaps
  matches.sort((a, b) => a.start - b.start);

  // Remove overlapping matches (keep earlier/longer ones)
  const filtered = [];
  for (const match of matches) {
    const last = filtered[filtered.length - 1];
    if (!last || match.start >= last.end) {
      filtered.push(match);
    }
  }

  return filtered;
}
