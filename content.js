// Manipulation Identifier — Content Script
// Handles text collection, highlighting, and message passing.
// All UI (cards, feedback, controls) lives in the side panel.
(function () {
  'use strict';

  // Protocol guard — only run on http/https pages
  if (!/^https?:/.test(location.protocol)) return;

  // ── Inlined utilities (from shared.js — content scripts can't importScripts) ──

  const MSG = {
    COLLECT_TEXT: 'collectText',
    HIGHLIGHT_RESULTS: 'highlightResults',
    SCROLL_TO: 'scrollToHighlight',
    CLEAR_HIGHLIGHTS: 'clearHighlights',
    HIGHLIGHT_CLICKED: 'highlightClicked'
  };

  function escapeHtml(unsafe) {
    return String(unsafe)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  const TACTIC_CATEGORIES = {
    'False Dichotomy': 'logical',
    'Cherry Picking': 'logical',
    'Slippery Slope': 'logical',
    'Hasty Generalization': 'logical',
    'Red Herring': 'logical',
    'Emotional Language': 'rhetorical',
    'Polarization': 'rhetorical',
    'Appeal to Majority': 'rhetorical',
    'Appeal to Nature': 'rhetorical',
    'Appeal to Tradition': 'rhetorical',
    'Scapegoating': 'rhetorical',
    'Ad Hominem': 'credibility',
    'Fake Experts': 'credibility',
    'Appeal to Authority': 'credibility',
    'Decontextualization': 'credibility'
  };

  // ── Text normalization for matching ──

  function normalizeText(text) {
    return text
      .replace(/[\u2018\u2019\u201A\u2039\u203A]/g, "'")
      .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')
      .replace(/[\u2013\u2014\u2015]/g, '-')
      .replace(/\u2026/g, '...')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // ── State ──

  let allHighlights = [];

  // ── Highlight CSS (injected once) ──

  function ensureHighlightStyles() {
    if (document.getElementById('mi-highlight-style')) return;
    const style = document.createElement('style');
    style.id = 'mi-highlight-style';
    // Category colors: tuned for visibility on both light and dark page backgrounds.
    // Source of truth for RGB values: sidepanel.css --cat-logical/rhetorical/credibility.
    style.textContent = `
      .mi-highlight {
        border-radius: 3px !important;
        padding: 1px 2px !important;
        transition: background 0.15s, border 0.15s;
        cursor: pointer !important;
      }
      .mi-highlight.mi-logical {
        background-color: rgba(91, 156, 245, 0.25) !important;
        border: 1px solid rgba(91, 156, 245, 0.35) !important;
      }
      .mi-highlight.mi-logical:hover {
        background-color: rgba(91, 156, 245, 0.38) !important;
        border-color: rgba(91, 156, 245, 0.50) !important;
      }
      .mi-highlight.mi-logical.mi-active {
        background-color: rgba(91, 156, 245, 0.45) !important;
        border-color: rgba(91, 156, 245, 0.60) !important;
      }
      .mi-highlight.mi-rhetorical {
        background-color: rgba(232, 148, 58, 0.25) !important;
        border: 1px solid rgba(232, 148, 58, 0.35) !important;
      }
      .mi-highlight.mi-rhetorical:hover {
        background-color: rgba(232, 148, 58, 0.38) !important;
        border-color: rgba(232, 148, 58, 0.50) !important;
      }
      .mi-highlight.mi-rhetorical.mi-active {
        background-color: rgba(232, 148, 58, 0.45) !important;
        border-color: rgba(232, 148, 58, 0.60) !important;
      }
      .mi-highlight.mi-credibility {
        background-color: rgba(239, 83, 80, 0.22) !important;
        border: 1px solid rgba(239, 83, 80, 0.32) !important;
      }
      .mi-highlight.mi-credibility:hover {
        background-color: rgba(239, 83, 80, 0.35) !important;
        border-color: rgba(239, 83, 80, 0.48) !important;
      }
      .mi-highlight.mi-credibility.mi-active {
        background-color: rgba(239, 83, 80, 0.42) !important;
        border-color: rgba(239, 83, 80, 0.58) !important;
      }
      @keyframes mi-pulse {
        0%, 100% { opacity: 0.7; }
        50% { opacity: 1; }
      }
      .mi-highlight.mi-pulse {
        animation: mi-pulse 0.6s ease-in-out;
      }
    `;
    document.head.appendChild(style);
  }

  // ── Text collection ──

  function collectText() {
    const collected = new Set();
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentNode;
          if (!parent) return NodeFilter.FILTER_REJECT;

          // Skip script, style, noscript
          const tag = parent.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
            return NodeFilter.FILTER_REJECT;
          }

          // Skip nav/footer by role
          const role = parent.closest?.('[role]')?.getAttribute('role');
          if (role === 'navigation' || role === 'contentinfo') {
            return NodeFilter.FILTER_REJECT;
          }

          // Skip our own highlights
          if (parent.closest?.('.mi-highlight')) {
            return NodeFilter.FILTER_REJECT;
          }

          const text = node.textContent.trim();
          return text.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );

    while (walker.nextNode()) {
      collected.add(walker.currentNode.textContent.trim());
    }

    // Collapse whitespace, join, truncate
    const combined = Array.from(collected).join(' ').replace(/\s+/g, ' ').slice(0, 5000);
    return combined;
  }

  // ── Fuzzy text matching (3-tier: exact, normalized, trigram) ──

  function trigrams(text) {
    const result = new Set();
    for (let i = 0; i <= text.length - 3; i++) {
      result.add(text.slice(i, i + 3));
    }
    return result;
  }

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

  function mapNormalizedToOriginal(original, normalized, normStart, normLen) {
    let normPos = 0;
    let origStart = -1;
    let origEnd = -1;
    let i = 0;

    // Skip leading whitespace that was trimmed by normalize
    while (i < original.length && /\s/.test(original[i])) i++;

    while (i < original.length && normPos < normStart + normLen) {
      if (normPos === normStart) origStart = i;

      const origChar = original[i];
      const normChar = normalized[normPos];

      if (origChar.toLowerCase() === normChar || normalizeText(origChar) === normChar) {
        normPos++;
        i++;
      } else if (/\s/.test(origChar)) {
        i++; // Extra whitespace collapsed during normalization
      } else {
        normPos++;
        i++; // Character was normalized (quote/dash substitution)
      }
    }

    if (origStart === -1) return null;
    origEnd = i;
    return { start: origStart, end: origEnd };
  }

  function findMatchInText(quote, text, threshold = 0.85) {
    if (!quote || !text) return null;

    // Tier 1: Exact match (case-insensitive)
    const lowerText = text.toLowerCase();
    const lowerQuote = quote.toLowerCase();
    const exactIndex = lowerText.indexOf(lowerQuote);
    if (exactIndex !== -1) {
      return { start: exactIndex, end: exactIndex + quote.length };
    }

    // Tier 2: Normalized match
    const normText = normalizeText(text);
    const normQuote = normalizeText(quote);
    if (normQuote.length === 0) return null;

    const normIndex = normText.indexOf(normQuote);
    if (normIndex !== -1) {
      return mapNormalizedToOriginal(text, normText, normIndex, normQuote.length);
    }

    // Tier 3: Fuzzy match — sliding window with trigram similarity
    if (normQuote.length < 3) return null;

    const quoteTrigrams = trigrams(normQuote);
    const windowSize = normQuote.length;
    const minWindow = Math.max(3, Math.floor(windowSize * 0.7));
    const maxWindow = Math.ceil(windowSize * 1.3);

    let bestScore = 0;
    let bestStart = -1;
    let bestEnd = -1;

    for (let winLen = minWindow; winLen <= maxWindow; winLen++) {
      for (let j = 0; j <= normText.length - winLen; j++) {
        const window = normText.slice(j, j + winLen);
        const windowTri = trigrams(window);
        const score = trigramSimilarity(quoteTrigrams, windowTri);
        if (score > bestScore) {
          bestScore = score;
          bestStart = j;
          bestEnd = j + winLen;
        }
      }
    }

    if (bestScore >= threshold) {
      return mapNormalizedToOriginal(text, normText, bestStart, bestEnd - bestStart);
    }

    return null;
  }

  // ── Text runs (groups of text nodes under same block ancestor) ──

  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS',
    'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER',
    'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR',
    'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'UL',
    'BR', 'TD', 'TH', 'TR'
  ]);

  function nearestBlockAncestor(node) {
    let el = node.parentElement;
    while (el && el !== document.body && !BLOCK_TAGS.has(el.tagName)) {
      el = el.parentElement;
    }
    return el || document.body;
  }

  function getTextRuns() {
    const textNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentNode;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
          return NodeFilter.FILTER_REJECT;
        }
        const role = parent.closest?.('[role]')?.getAttribute('role');
        if (role === 'navigation' || role === 'contentinfo') {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.closest?.('.mi-highlight')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    // Group consecutive text nodes by nearest block ancestor
    const runs = [];
    let currentNodes = [];
    let currentBlock = null;

    for (const node of textNodes) {
      const block = nearestBlockAncestor(node);
      if (block !== currentBlock && currentNodes.length > 0) {
        runs.push(currentNodes);
        currentNodes = [];
      }
      currentBlock = block;
      currentNodes.push(node);
    }
    if (currentNodes.length > 0) runs.push(currentNodes);

    return runs;
  }

  function buildRunText(nodes) {
    let text = '';
    const map = [];
    for (const node of nodes) {
      const nodeText = node.textContent;
      map.push({ node, startInRun: text.length, endInRun: text.length + nodeText.length });
      text += nodeText;
    }
    return { text, map };
  }

  // ── Highlighting ──

  function highlightResults(detectedTactics) {
    if (!detectedTactics?.length) return;

    clearHighlights();
    ensureHighlightStyles();

    const runs = getTextRuns();
    let globalHighlightIndex = 0;

    for (const runNodes of runs) {
      const { text, map } = buildRunText(runNodes);
      if (!text.trim()) continue;

      // Find all matches in this run's concatenated text
      const matches = [];
      for (const tactic of detectedTactics) {
        for (const example of tactic.examples) {
          const quoteText = example.text || example.exact_quote;
          if (!quoteText) continue;
          const match = findMatchInText(quoteText, text);
          if (match) {
            matches.push({
              ...match,
              tactic: tactic.tactic,
              definition: tactic.definition,
              explanation: example.explanation,
              quoteText
            });
          }
        }
      }

      if (matches.length === 0) continue;

      // Sort by position, remove overlaps
      matches.sort((a, b) => a.start - b.start);
      const filtered = [];
      for (const m of matches) {
        const last = filtered[filtered.length - 1];
        if (!last || m.start >= last.end) filtered.push(m);
      }

      // Assign a highlight ID per match (shared across spans for cross-node matches)
      for (const m of filtered) {
        m.hlId = globalHighlightIndex++;
      }

      // For each text node in the run, find overlapping matches and wrap
      for (const entry of map) {
        const nodeMatches = [];
        for (const m of filtered) {
          const overlapStart = Math.max(m.start, entry.startInRun);
          const overlapEnd = Math.min(m.end, entry.endInRun);
          if (overlapStart < overlapEnd) {
            nodeMatches.push({
              start: overlapStart - entry.startInRun,
              end: overlapEnd - entry.startInRun,
              hlId: m.hlId,
              tactic: m.tactic,
              definition: m.definition,
              explanation: m.explanation,
              quoteText: m.quoteText
            });
          }
        }

        if (nodeMatches.length === 0) continue;
        nodeMatches.sort((a, b) => a.start - b.start);

        const node = entry.node;
        const nodeText = node.textContent;
        const parent = node.parentNode;
        const frag = document.createDocumentFragment();
        let lastIdx = 0;

        for (const nm of nodeMatches) {
          if (nm.start > lastIdx) {
            frag.appendChild(document.createTextNode(nodeText.slice(lastIdx, nm.start)));
          }

          const span = document.createElement('span');
          const category = TACTIC_CATEGORIES[nm.tactic] || 'logical';
          span.className = `mi-highlight mi-${category}`;
          span.textContent = nodeText.slice(nm.start, nm.end);
          span.tabIndex = 0;
          span.setAttribute('role', 'button');
          span.setAttribute('aria-label', `${escapeHtml(nm.tactic)}: ${escapeHtml(nm.quoteText)}`);
          span.dataset.highlightId = `mi-hl-${nm.hlId}`;
          span.dataset.tactic = nm.tactic;
          span.dataset.explanation = nm.explanation;
          span.dataset.definition = nm.definition;

          // Click → activate all spans for this match, notify side panel
          span.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.mi-highlight.mi-active').forEach(el => el.classList.remove('mi-active'));
            document.querySelectorAll(`[data-highlight-id="${span.dataset.highlightId}"]`)
              .forEach(el => el.classList.add('mi-active'));

            chrome.runtime.sendMessage({
              action: MSG.HIGHLIGHT_CLICKED,
              tactic: nm.tactic,
              highlightId: span.dataset.highlightId,
              text: nm.quoteText,
              explanation: nm.explanation
            });
          });

          frag.appendChild(span);
          lastIdx = nm.end;
        }

        if (lastIdx < nodeText.length) {
          frag.appendChild(document.createTextNode(nodeText.slice(lastIdx)));
        }

        parent.replaceChild(frag, node);
      }
    }

    allHighlights = Array.from(document.querySelectorAll('.mi-highlight'));
  }

  // ── Clear highlights ──

  function clearHighlights() {
    const highlights = document.querySelectorAll('.mi-highlight');
    highlights.forEach(hl => {
      const parent = hl.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(hl.textContent), hl);
      }
    });
    // Normalize text nodes (merge adjacent text nodes)
    document.body.normalize();
    allHighlights = [];
  }

  // ── Scroll to specific highlight (supports multi-span highlights) ──

  function scrollToHighlight(highlightId) {
    const els = document.querySelectorAll(`[data-highlight-id="${CSS.escape(highlightId)}"]`);
    if (els.length === 0) return;

    // Remove active from all
    document.querySelectorAll('.mi-highlight.mi-active').forEach(h => h.classList.remove('mi-active'));

    // Activate all spans for this highlight (may span multiple nodes)
    els.forEach(el => {
      el.classList.add('mi-active');
      el.classList.add('mi-pulse');
      el.addEventListener('animationend', () => el.classList.remove('mi-pulse'), { once: true });
    });

    els[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ── Scroll to Nth instance of a tactic ──

  function scrollToInstance(tactic, instanceIndex) {
    const highlights = document.querySelectorAll(`.mi-highlight[data-tactic="${CSS.escape(tactic)}"]`);
    // Collect unique highlight IDs (one match may have multiple spans)
    const uniqueIds = [];
    const seen = new Set();
    for (const h of highlights) {
      const id = h.dataset.highlightId;
      if (!seen.has(id)) {
        seen.add(id);
        uniqueIds.push(id);
      }
    }
    const targetId = uniqueIds[instanceIndex];
    if (targetId) scrollToHighlight(targetId);
  }

  // ── Message listener ──

  chrome.runtime.onMessage?.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case MSG.COLLECT_TEXT: {
        const text = collectText();
        sendResponse({ text });
        return false;
      }

      case MSG.HIGHLIGHT_RESULTS: {
        highlightResults(message.results);
        sendResponse({
          success: true,
          highlightCount: allHighlights.length
        });
        return false;
      }

      case MSG.CLEAR_HIGHLIGHTS: {
        clearHighlights();
        sendResponse({ success: true });
        return false;
      }

      case MSG.SCROLL_TO: {
        if (message.tactic != null && message.instanceIndex != null) {
          scrollToInstance(message.tactic, message.instanceIndex);
        } else if (message.highlightId) {
          scrollToHighlight(message.highlightId);
        }
        sendResponse({ success: true });
        return false;
      }
    }
  });
})();
