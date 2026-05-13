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

// True if the tab is on a page where content scripts can run. Undefined tab.url
// (extension reload, permissions timing) falls back to tab.pendingUrl, and an
// unknown URL is treated as analyzable rather than blocked — the original bug
// was failing closed on undefined, which surfaced as "Cannot analyze" on valid sites.
function isAnalyzableUrl(tab) {
  const url = tab.url || tab.pendingUrl;
  if (!url) return true;
  return /^https?:/.test(url);
}

function escapeHtml(unsafe) {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Feature Flags ──
// Add new flags here — they auto-appear in Settings > Experiments.
// Registry is the single source of truth: label, description, default value.
const FEATURE_FLAGS = {
  legendFilter: {
    label: 'Category filter',
    description: 'Click legend dots to show/hide tactic categories',
    default: true
  },
  devSnapshots: {
    label: 'Snapshot capture',
    description: 'Show snapshot button in results for dev review',
    default: true
  },
  enhancedMotion: {
    label: 'Enhanced motion',
    description: 'Refined hover lifts, card flash glow, snappier button press, category bar response',
    default: true
  },
  compactLayout: {
    label: 'Compact layout',
    description: 'Flattened indentation, tighter spacing, better width utilization',
    default: true
  }
};

// Resolve stored flags merged with defaults (new flags get their default automatically)
function getFeatureFlags(callback) {
  chrome.storage.local.get('featureFlags', (result) => {
    const stored = result.featureFlags || {};
    const merged = {};
    for (const [key, def] of Object.entries(FEATURE_FLAGS)) {
      merged[key] = key in stored ? stored[key] : def.default;
    }
    callback(merged);
  });
}
