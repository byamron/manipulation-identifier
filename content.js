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
    style.textContent = `
      .mi-highlight {
        background-color: #fff3cd !important;
        border: 1px solid #ffeaa7 !important;
        border-radius: 3px !important;
        padding: 1px 2px !important;
        transition: background 0.15s, border 0.15s;
        cursor: pointer !important;
      }
      .mi-highlight:hover {
        background-color: #ffe082 !important;
        border-color: #ffd54f !important;
      }
      .mi-highlight.mi-active {
        background-color: #ffd54f !important;
        border-color: #ffca28 !important;
      }
      @keyframes mi-pulse {
        0%, 100% { background-color: #fff3cd; }
        50% { background-color: #ffeb3b; }
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

  // ── Find quote in a text node (exact + normalized) ──

  function findQuoteInText(quote, nodeText) {
    // Tier 1: Exact case-insensitive
    const lowerText = nodeText.toLowerCase();
    const lowerQuote = quote.toLowerCase();
    const idx = lowerText.indexOf(lowerQuote);
    if (idx !== -1) {
      return { start: idx, end: idx + quote.length };
    }

    // Tier 2: Normalized
    const normText = normalizeText(nodeText);
    const normQuote = normalizeText(quote);
    if (!normQuote) return null;

    const normIdx = normText.indexOf(normQuote);
    if (normIdx !== -1) {
      // Approximate mapping back to original positions
      const ratio = nodeText.length / (normText.length || 1);
      const approxStart = Math.round(normIdx * ratio);
      const approxLen = Math.round(normQuote.length * ratio);
      const approxEnd = Math.min(nodeText.length, approxStart + approxLen);
      return { start: approxStart, end: approxEnd };
    }

    return null;
  }

  // ── Highlighting ──

  function highlightResults(detectedTactics) {
    if (!detectedTactics?.length) return;

    clearHighlights();
    ensureHighlightStyles();

    // Collect all text nodes
    const textNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentNode;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.closest?.('.mi-highlight')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    let highlightIndex = 0;

    for (const node of textNodes) {
      const text = node.textContent;
      const matches = [];

      for (const tactic of detectedTactics) {
        for (const example of tactic.examples) {
          const quoteText = example.text || example.exact_quote;
          if (!quoteText) continue;
          const match = findQuoteInText(quoteText, text);
          if (match) {
            matches.push({
              ...match,
              tactic: tactic.tactic,
              definition: tactic.definition,
              explanation: example.explanation,
              quoteText: quoteText
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

      // Replace text node with highlighted spans
      const parent = node.parentNode;
      const wrapper = document.createDocumentFragment();
      let lastIdx = 0;

      for (const m of filtered) {
        if (m.start > lastIdx) {
          wrapper.appendChild(document.createTextNode(text.slice(lastIdx, m.start)));
        }

        const span = document.createElement('span');
        span.className = 'mi-highlight';
        span.textContent = text.slice(m.start, m.end);
        span.tabIndex = 0;
        span.setAttribute('role', 'button');
        span.setAttribute('aria-label', `${escapeHtml(m.tactic)}: ${escapeHtml(m.quoteText)}`);
        span.dataset.highlightId = `mi-hl-${highlightIndex++}`;
        span.dataset.tactic = m.tactic;
        span.dataset.explanation = m.explanation;
        span.dataset.definition = m.definition;

        // Click → notify side panel
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          // Remove active from all, add to this one
          document.querySelectorAll('.mi-highlight.mi-active').forEach(el => el.classList.remove('mi-active'));
          span.classList.add('mi-active');

          chrome.runtime.sendMessage({
            action: MSG.HIGHLIGHT_CLICKED,
            tactic: m.tactic,
            highlightId: span.dataset.highlightId,
            text: span.textContent,
            explanation: m.explanation
          });
        });

        wrapper.appendChild(span);
        lastIdx = m.end;
      }

      if (lastIdx < text.length) {
        wrapper.appendChild(document.createTextNode(text.slice(lastIdx)));
      }

      parent.replaceChild(wrapper, node);
    }

    // Build ordered highlights array
    allHighlights = Array.from(document.querySelectorAll('.mi-highlight'));
  }

  // ── Clear highlights ──

  function clearHighlights() {
    const highlights = document.querySelectorAll('.mi-highlight');
    highlights.forEach(hl => {
      const parent = hl.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(hl.textContent), parent.normalize ? hl : hl);
      }
    });
    // Normalize text nodes (merge adjacent text nodes)
    document.body.normalize();
    allHighlights = [];
  }

  // ── Scroll to specific highlight ──

  function scrollToHighlight(highlightId) {
    const el = document.querySelector(`[data-highlight-id="${CSS.escape(highlightId)}"]`);
    if (!el) return;

    // Remove active from all
    document.querySelectorAll('.mi-highlight.mi-active').forEach(h => h.classList.remove('mi-active'));

    // Activate and scroll
    el.classList.add('mi-active');
    el.classList.add('mi-pulse');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Remove pulse after animation
    el.addEventListener('animationend', () => el.classList.remove('mi-pulse'), { once: true });
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
        scrollToHighlight(message.highlightId);
        sendResponse({ success: true });
        return false;
      }
    }
  });
})();
