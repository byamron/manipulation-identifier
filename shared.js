// Shared utilities across extension contexts.
// Loaded via importScripts() in background.js and <script> in sidepanel.html.
// Content.js inlines the subset it needs (escapeHtml, MSG constants).

const MSG = {
  ANALYZE: 'analyze',
  COLLECT_TEXT: 'collectText',
  HIGHLIGHT_RESULTS: 'highlightResults',
  SCROLL_TO: 'scrollToHighlight',
  CLEAR_HIGHLIGHTS: 'clearHighlights',
  HIGHLIGHT_CLICKED: 'highlightClicked'
};

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

const CATEGORY_LABELS = {
  logical: 'Logical Fallacy',
  rhetorical: 'Rhetorical Manipulation',
  credibility: 'Credibility Attack'
};

function escapeHtml(unsafe) {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
