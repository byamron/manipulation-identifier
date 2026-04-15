// Side Panel — Manipulation Identifier
// Renders results, handles tab switching, communicates with background/content.

(function () {
  'use strict';

  // ── DOM refs ──
  const modelSelect = document.getElementById('modelSelect');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const statusArea = document.getElementById('statusArea');
  const resultsArea = document.getElementById('resultsArea');
  const settingsBtn = document.getElementById('settingsBtn');

  // ── State ──
  let activeTabId = null;
  let currentState = 'ready'; // ready | analyzing | results | empty | error | setup | unsupported
  let analyzeTimer = null;
  let tacticsData = null; // Loaded from tactics.json for "Learn more"
  let streamingRenderedCount = 0;
  let streamingDebounceTimer = null;

  // Feature flag cache — defaults used until storage loads
  // Guard: if shared.js hasn't loaded (cache/timing), degrade gracefully instead of crashing
  let activeFlags = typeof FEATURE_FLAGS !== 'undefined'
    ? Object.fromEntries(Object.entries(FEATURE_FLAGS).map(([k, v]) => [k, v.default]))
    : {};

  // ── Init ──
  async function init() {
    // Load saved preferences
    chrome.storage.local.get(['selectedModel', 'geminiApiKey', 'serverUrl', 'textSize', 'featureFlags'], (result) => {
      if (result.selectedModel && modelSelect.querySelector(`option[value="${result.selectedModel}"]`)) {
        modelSelect.value = result.selectedModel;
      }
      // Apply text size preference
      if (result.textSize && result.textSize !== 'medium') {
        document.body.dataset.textSize = result.textSize;
      }
      // Load feature flags from storage
      if (typeof FEATURE_FLAGS !== 'undefined') {
        const storedFlags = result.featureFlags || {};
        for (const key of Object.keys(FEATURE_FLAGS)) {
          if (key in storedFlags) activeFlags[key] = storedFlags[key];
        }
      }

      // Apply CSS-driven feature flags
      document.body.classList.toggle('enhanced-motion', activeFlags.enhancedMotion);
      document.body.classList.toggle('compact-layout', activeFlags.compactLayout);

      // Check if setup is needed (no API key and no server URL)
      const hasKey = !!result.geminiApiKey;
      const hasServer = !!result.serverUrl;
      if (!hasKey && !hasServer) {
        showSetup();
      }
    });

    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      activeTabId = tab.id;
      checkTabState(tab);
    }

    // Load tactics data for "Learn more"
    try {
      const resp = await fetch(chrome.runtime.getURL('tactics.json'));
      tacticsData = await resp.json();
    } catch { /* non-critical */ }

    setupEventListeners();
  }

  function checkTabState(tab) {
    // Check if tab is analyzable
    if (!tab.url || !/^https?:/.test(tab.url)) {
      showUnsupported();
      return;
    }

    // Check for existing results in session storage
    chrome.storage.session.get([`results_${activeTabId}`, `status_${activeTabId}`], (data) => {
      const results = data[`results_${activeTabId}`];
      const status = data[`status_${activeTabId}`];

      if (status?.status === 'analyzing') {
        // Check for timeout — use startedAt (stable) not timestamp (per-stage)
        const analysisStart = status.startedAt || status.timestamp;
        if (Date.now() - analysisStart > 45000) {
          showError('Analysis may have timed out. Try again.');
        } else {
          showAnalyzing(analysisStart);
        }
      } else if (results?.results?.length > 0) {
        showResults(results.results, results.model, results.totalChars, results.analyzedChars);
      } else if (status?.status === 'complete') {
        showEmpty();
      } else if (status?.status === 'error') {
        showError(status.error);
      } else {
        showReady();
      }
    });
  }

  // ── Event listeners ──

  function setupEventListeners() {
    analyzeBtn.addEventListener('click', handleAnalyze);

    settingsBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    });

    modelSelect.addEventListener('change', () => {
      chrome.storage.local.set({ selectedModel: modelSelect.value });
    });

    // Tab switching
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      activeTabId = activeInfo.tabId;
      const tab = await chrome.tabs.get(activeTabId);
      checkTabState(tab);
    });

    // Storage changes (fire-persist-notify pattern)
    chrome.storage.onChanged.addListener((changes, area) => {
      // Feature flag updates (local storage)
      if (area === 'local' && changes.featureFlags && typeof FEATURE_FLAGS !== 'undefined') {
        const newFlags = changes.featureFlags.newValue || {};
        for (const [key, def] of Object.entries(FEATURE_FLAGS)) {
          activeFlags[key] = key in newFlags ? newFlags[key] : def.default;
        }
        // Live-update CSS-driven flags
        document.body.classList.toggle('enhanced-motion', activeFlags.enhancedMotion);
        document.body.classList.toggle('compact-layout', activeFlags.compactLayout);
      }

      if (area !== 'session') return;

      const resultsKey = `results_${activeTabId}`;
      const statusKey = `status_${activeTabId}`;

      if (changes[statusKey]) {
        const newStatus = changes[statusKey].newValue;
        if (!newStatus) return;

        if (newStatus.status === 'analyzing') {
          if (currentState !== 'analyzing') {
            showAnalyzing(newStatus.startedAt || newStatus.timestamp);
          }
        } else if (newStatus.status === 'error') {
          showError(newStatus.error);
        } else if (newStatus.status === 'complete' && changes[resultsKey]) {
          const results = changes[resultsKey].newValue;
          if (results?.results?.length > 0) {
            showResults(results.results, results.model, results.totalChars, results.analyzedChars);
          } else {
            showEmpty();
          }
        }
      } else if (changes[resultsKey] && !changes[statusKey]) {
        const results = changes[resultsKey].newValue;
        if (results?.results?.length > 0) {
          if (results.streaming) {
            // Streaming partial results — show incrementally while still analyzing
            showStreamingResults(results.results, results.model);
          } else {
            showResults(results.results, results.model);
          }
        }
      }
    });

    // Listen for highlight clicks from content script (via background)
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === MSG.HIGHLIGHT_CLICKED) {
        scrollToCard(message.tactic, message.highlightId);
      }
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (currentState !== 'results') return;
      const cards = resultsArea.querySelectorAll('.tactic-card');
      if (cards.length === 0) return;

      const focused = document.activeElement?.closest('.tactic-card');
      let currentIdx = focused ? Array.from(cards).indexOf(focused) : -1;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.min(currentIdx + 1, cards.length - 1);
        cards[next].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = Math.max(currentIdx - 1, 0);
        cards[prev].focus();
      } else if (e.key === 'Enter' && focused) {
        e.preventDefault();
        // Scroll to first instance highlight on page
        const tactic = focused.dataset.tactic;
        if (tactic) {
          chrome.tabs.sendMessage(activeTabId, {
            action: MSG.SCROLL_TO,
            tactic: tactic,
            instanceIndex: 0
          }).catch(() => {});
        }
      } else if (e.key === 'Escape') {
        // Collapse any expanded sections
        resultsArea.querySelectorAll('.card-learn-more.expanded')
          .forEach(el => el.classList.remove('expanded'));
      }
    });
  }

  // ── Analysis ──

  async function handleAnalyze() {
    if (currentState === 'results' || currentState === 'empty') {
      // Clear mode
      chrome.runtime.sendMessage({ action: MSG.CLEAR_HIGHLIGHTS, tabId: activeTabId });
      showReady();
      return;
    }

    if (!activeTabId || currentState === 'analyzing') return;

    startAnalysis();
  }

  function handleRerun() {
    if (!activeTabId || currentState === 'analyzing') return;
    chrome.runtime.sendMessage({ action: MSG.CLEAR_HIGHLIGHTS, tabId: activeTabId }, () => {
      if (chrome.runtime.lastError) { /* content script may not be present — proceed anyway */ }
      startAnalysis();
    });
  }

  async function handleSnapshot() {
    const snapshotBtn = resultsArea.querySelector('.btn-snapshot');
    if (!snapshotBtn || snapshotBtn.disabled) return;

    // Check if comment input already showing
    const existing = resultsArea.querySelector('.snapshot-comment-row');
    if (existing) {
      existing.remove();
      return;
    }

    // Insert comment input below header
    const header = resultsArea.querySelector('.results-header');
    const commentRow = document.createElement('div');
    commentRow.className = 'snapshot-comment-row';
    commentRow.innerHTML = `
      <input type="text" class="snapshot-comment-input" placeholder="Optional note (e.g. false positive on paragraph 2)">
      <button class="snapshot-save-btn">Save</button>
    `;
    header.insertAdjacentElement('afterend', commentRow);

    const input = commentRow.querySelector('.snapshot-comment-input');
    const saveBtn = commentRow.querySelector('.snapshot-save-btn');
    input.focus();

    const doSave = async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const data = await chrome.storage.session.get(`results_${activeTabId}`);
        const stored = data[`results_${activeTabId}`];
        if (!stored) {
          commentRow.innerHTML = '<span class="snapshot-error">No results to save.</span>';
          return;
        }

        const snapshot = {
          id: crypto.randomUUID(),
          url: tab?.url || '',
          title: tab?.title || '',
          analyzedText: stored.analyzedText || null,
          results: stored.results,
          rawResponse: stored.rawResponse,
          model: stored.model,
          tokensUsed: stored.tokensUsed,
          analysisTimestamp: stored.timestamp,
          savedAt: Date.now(),
          comment: input.value.trim() || null
        };

        const localData = await chrome.storage.local.get('devSnapshots');
        const snapshots = localData.devSnapshots || [];
        snapshots.push(snapshot);
        await chrome.storage.local.set({ devSnapshots: snapshots });

        // Auto-copy JSON to clipboard for quick paste into editor
        try {
          await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
          commentRow.innerHTML = `<span class="snapshot-success">Saved &amp; copied to clipboard (${snapshots.length} total)</span>`;
        } catch {
          commentRow.innerHTML = `<span class="snapshot-success">Snapshot saved (${snapshots.length} total)</span>`;
        }
        setTimeout(() => commentRow.remove(), 2000);
      } catch (err) {
        commentRow.innerHTML = `<span class="snapshot-error">Save failed: ${escapeHtml(err.message)}</span>`;
      }
    };

    saveBtn.addEventListener('click', doSave);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSave();
      if (e.key === 'Escape') commentRow.remove();
    });
  }

  function startAnalysis() {
    const model = modelSelect.value;
    showAnalyzing();

    chrome.runtime.sendMessage(
      { action: MSG.ANALYZE, tabId: activeTabId, model },
      (response) => {
        if (chrome.runtime.lastError) {
          showError('Could not connect to background service.');
          return;
        }
        if (!response) return; // Storage listener will handle state updates
        if (!response.success) {
          showError(response.error || 'Analysis failed.');
        }
        // Success is handled via storage onChanged listener
      }
    );
  }

  // ── UI States ──

  function showSetup() {
    currentState = 'setup';
    updateButton('Analyze', false);
    statusArea.innerHTML = `
      <div class="status-message">
        Detects manipulation tactics in web page text using AI.<br>
        <a href="#" id="setupLink">Add your Gemini API key</a> to get started.
      </div>
    `;
    resultsArea.innerHTML = '';
    document.getElementById('setupLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    });
  }

  function showReady() {
    currentState = 'ready';
    updateButton('Analyze', true);
    streamingRenderedCount = 0;
    clearTimeout(streamingDebounceTimer);
    const platform = navigator.userAgentData?.platform || navigator.platform || '';
    const modifier = /mac|iphone|ipad/i.test(platform) ? 'Cmd' : 'Ctrl';
    statusArea.innerHTML = `
      <div class="status-message">
        Click <strong>Analyze</strong> to scan this page for manipulation tactics.<br>
        <span class="shortcut-hint">Tip: use <kbd>${modifier}+Shift+M</kbd> to open this panel anytime.</span>
      </div>
    `;
    resultsArea.innerHTML = '';
  }

  function showUnsupported() {
    currentState = 'unsupported';
    updateButton('Analyze', false);
    statusArea.innerHTML = `
      <div class="status-message">
        Cannot analyze this page.<br>
        Navigate to a regular web page to use Manipulation Identifier.
      </div>
    `;
    resultsArea.innerHTML = '';
  }

  function showAnalyzing(startTimestamp) {
    currentState = 'analyzing';

    // Animated button — single indicator for analyzing state
    analyzeBtn.innerHTML = 'Analyzing<span class="analyzing-dots"><span>.</span><span>.</span><span>.</span></span>';
    analyzeBtn.disabled = true;
    analyzeBtn.classList.remove('btn-clear');
    analyzeBtn.classList.add('btn-analyzing');

    statusArea.innerHTML = '';
    resultsArea.innerHTML = '';

    // Timeout check (no visible timer — button animation communicates progress)
    const start = startTimestamp || Date.now();
    clearInterval(analyzeTimer);
    analyzeTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      if (elapsed > 45) {
        clearInterval(analyzeTimer);
        showError('Analysis may have timed out. Try again.');
      }
    }, 1000);
  }

  // ── Shared card renderer ──

  function renderTacticCard(tactic, { interactive = true } = {}) {
    const category = TACTIC_CATEGORIES[tactic.tactic] || 'logical';
    const categoryLabel = CATEGORY_LABELS[category] || category;
    const tacticInfo = interactive ? tacticsData?.find(t => t.name === tactic.tactic) : null;
    const instanceCount = tactic.examples.length;
    const VISIBLE_LIMIT = 2;
    const hasOverflow = instanceCount > VISIBLE_LIMIT;

    return `
      <div class="tactic-card" tabindex="0" role="article"
           aria-label="${escapeHtml(tactic.tactic)}"
           data-tactic="${escapeHtml(tactic.tactic)}"
           data-category="${category}">
        <div class="card-header">
          <div class="card-category-bar ${category}" title="${escapeHtml(categoryLabel)}"></div>
          <div class="card-content">
            <div class="card-tactic-name">${escapeHtml(tactic.tactic)}${instanceCount > 1 ? ` <span class="instance-count">${instanceCount}</span>` : ''}</div>
            <div class="card-definition">${escapeHtml(tactic.definition)}</div>
          </div>
        </div>
        <div class="card-instances">
          ${tactic.examples.map((ex, i) => `
            <div class="instance${ex.attribution === 'source' ? ' instance-source' : ''}${ex.confidence === 'medium' ? ' instance-medium' : ''}${hasOverflow && i >= VISIBLE_LIMIT ? ' instance-overflow' : ''}">
              ${ex.attribution === 'source' && ex.attributedTo ? `<div class="instance-attribution">In a quote by ${escapeHtml(ex.attributedTo)}</div>` : ''}
              ${ex.attribution === 'source' && !ex.attributedTo ? `<div class="instance-attribution">In quoted speech</div>` : ''}
              ${ex.confidence === 'medium' ? '<div class="instance-confidence">Medium confidence</div>' : ''}
              <div class="instance-quote${interactive ? '' : ' non-interactive'}"
                   ${interactive ? `data-highlight-tactic="${escapeHtml(tactic.tactic)}" data-instance-index="${i}" title="Click to scroll to this text on the page"` : ''}>
                "${escapeHtml(ex.text)}"
              </div>
              ${interactive ? `<button class="explanation-toggle card-action-link">Why?</button>` : ''}
              <div class="instance-explanation">${escapeHtml(ex.explanation)}</div>
            </div>
          `).join('')}
          ${hasOverflow ? `<button class="card-action-link show-more-toggle">and ${instanceCount - VISIBLE_LIMIT} more</button>` : ''}
        </div>
        ${interactive && tacticInfo ? `
        <div class="card-actions">
          <button class="card-action-link learn-more-toggle">Learn more</button>
        </div>
        <div class="card-learn-more">
          ${tacticInfo.why?.length ? `
            <div class="learn-more-section">
              <div class="learn-more-label">Why this matters</div>
              <div class="learn-more-text">
                <ul>${tacticInfo.why.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
              </div>
            </div>
          ` : ''}
          ${tacticInfo.whatToDo?.length ? `
            <div class="learn-more-section">
              <div class="learn-more-label">What to look for</div>
              <div class="learn-more-text">
                <ul>${tacticInfo.whatToDo.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
              </div>
            </div>
          ` : ''}
        </div>
        ` : ''}
      </div>
    `;
  }

  function showResults(results, model, totalChars, analyzedChars) {
    currentState = 'results';
    clearInterval(analyzeTimer);
    clearTimeout(streamingDebounceTimer);
    updateButton('Clear', true, true);
    statusArea.innerHTML = '';
    streamingRenderedCount = 0;

    // Summary
    const MODEL_LABELS = {
      'gemini-2.5-flash': 'Flash 2.5',
      'gemini-2.5-flash-lite': 'Flash Lite 2.5'
    };
    const totalInstances = results.reduce((sum, t) => sum + t.examples.length, 0);
    const modelLabel = MODEL_LABELS[model] || model;
    let html = `<div class="results-header"><div class="results-summary">${results.length} tactic${results.length !== 1 ? 's' : ''} detected &middot; ${totalInstances} instance${totalInstances !== 1 ? 's' : ''}${model ? ` &middot; ${escapeHtml(modelLabel)}` : ''}</div><div class="results-header-actions"><button class="btn-snapshot" title="Save snapshot for dev review" aria-label="Save snapshot"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg></button><button class="btn-rerun" title="Re-run analysis" aria-label="Re-run analysis"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button></div></div>`;
    if (totalChars && analyzedChars && totalChars > analyzedChars) {
      html += `<div class="analysis-coverage">Analyzed first ${analyzedChars.toLocaleString()} of ${totalChars.toLocaleString()} characters</div>`;
    }
    html += `<div class="category-legend"><span class="legend-item" data-category="logical"><span class="legend-dot logical"></span>Logical</span><span class="legend-item" data-category="rhetorical"><span class="legend-dot rhetorical"></span>Rhetorical</span><span class="legend-item" data-category="credibility"><span class="legend-dot credibility"></span>Credibility</span></div>`;
    html += results.map(t => renderTacticCard(t, { interactive: true })).join('');

    resultsArea.innerHTML = html;
    attachCardListeners();
    resultsArea.querySelector('.btn-rerun')?.addEventListener('click', handleRerun);
    if (activeFlags.devSnapshots) {
      resultsArea.querySelector('.btn-snapshot')?.addEventListener('click', handleSnapshot);
    } else {
      resultsArea.querySelector('.btn-snapshot')?.remove();
    }
  }

  function showStreamingResults(results, model) {
    // Debounce: batch rapid updates into a single DOM write
    clearTimeout(streamingDebounceTimer);
    streamingDebounceTimer = setTimeout(() => {
      applyStreamingResults(results, model);
    }, 150);
  }

  function applyStreamingResults(results, model) {
    // Guard: only apply if still analyzing (debounced call may fire after completion)
    if (currentState !== 'analyzing') return;

    // Ensure summary row exists
    let summary = resultsArea.querySelector('.results-summary');
    if (!summary) {
      summary = document.createElement('div');
      summary.className = 'results-summary';
      resultsArea.prepend(summary);
    }
    const totalInstances = results.reduce((sum, t) => sum + t.examples.length, 0);
    summary.textContent = `${results.length} tactic${results.length !== 1 ? 's' : ''} so far \u00b7 ${totalInstances} instance${totalInstances !== 1 ? 's' : ''}`;

    // Append only new cards (don't re-render existing ones)
    for (let i = streamingRenderedCount; i < results.length; i++) {
      resultsArea.insertAdjacentHTML('beforeend', renderTacticCard(results[i], { interactive: false }));
    }
    streamingRenderedCount = results.length;
  }

  function showEmpty() {
    currentState = 'empty';
    clearInterval(analyzeTimer);
    updateButton('Clear', true, true);
    statusArea.innerHTML = `
      <div class="status-message">
        No manipulation tactics detected on this page.<br>
        <button class="btn-rerun btn-rerun-inline" title="Re-run analysis" aria-label="Re-run analysis"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Re-run</button>
      </div>
    `;
    resultsArea.innerHTML = '';
    statusArea.querySelector('.btn-rerun')?.addEventListener('click', handleRerun);
  }

  function showError(message) {
    currentState = 'error';
    clearInterval(analyzeTimer);
    updateButton('Try Again', true);
    statusArea.innerHTML = `
      <div class="error-message">
        ${escapeHtml(message)}
        <div class="error-action">
          <button id="retryBtn">Try Again</button>
        </div>
      </div>
    `;
    resultsArea.innerHTML = '';
    document.getElementById('retryBtn')?.addEventListener('click', () => {
      showReady();
      handleAnalyze();
    });
  }

  // ── Button state ──

  function updateButton(text, enabled, isClear = false) {
    analyzeBtn.textContent = text;
    analyzeBtn.disabled = !enabled;
    analyzeBtn.classList.toggle('btn-clear', isClear);
    analyzeBtn.classList.remove('btn-analyzing');
  }

  // ── Card interactions ──

  function attachCardListeners() {
    // Instance quote clicks → scroll to highlight on page
    resultsArea.querySelectorAll('.instance-quote').forEach(quote => {
      quote.addEventListener('click', () => {
        const tactic = quote.dataset.highlightTactic;
        const instanceIdx = parseInt(quote.dataset.instanceIndex, 10);

        chrome.tabs.sendMessage(activeTabId, {
          action: MSG.SCROLL_TO,
          tactic: tactic,
          instanceIndex: instanceIdx
        }).catch(() => {});
      });
    });

    // Learn more toggle
    resultsArea.querySelectorAll('.learn-more-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.tactic-card');
        const learnMore = card.querySelector('.card-learn-more');
        if (learnMore) {
          learnMore.classList.toggle('expanded');
          btn.textContent = learnMore.classList.contains('expanded') ? 'Show less' : 'Learn more';
        }
      });
    });

    // Show more instances toggle
    resultsArea.querySelectorAll('.show-more-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.tactic-card');
        const overflows = card.querySelectorAll('.instance-overflow');
        const isExpanded = btn.classList.contains('expanded');
        overflows.forEach(el => el.classList.toggle('instance-visible', !isExpanded));
        btn.classList.toggle('expanded', !isExpanded);
        btn.textContent = !isExpanded ? 'Show fewer' : `and ${overflows.length} more`;
      });
    });

    // Instance explanation toggle
    resultsArea.querySelectorAll('.explanation-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const explanation = btn.nextElementSibling;
        if (explanation?.classList.contains('instance-explanation')) {
          const visible = explanation.classList.toggle('explanation-visible');
          btn.textContent = visible ? 'Hide' : 'Why?';
        }
      });
    });

    // Category legend filter (gated by feature flag)
    if (activeFlags.legendFilter) {
      const legend = resultsArea.querySelector('.category-legend');
      if (legend) legend.classList.add('filterable');

      resultsArea.querySelectorAll('.legend-item[data-category]').forEach(item => {
        item.addEventListener('click', () => {
          item.classList.toggle('dimmed');
          const cat = item.dataset.category;
          const isDimmed = item.classList.contains('dimmed');
          resultsArea.querySelectorAll(`.tactic-card[data-category="${cat}"]`).forEach(card => {
            card.classList.toggle('category-filtered', isDimmed);
          });
        });
      });
    }

  }

  // ── Scroll to card when highlight clicked on page ──

  function scrollToCard(tactic, highlightId) {
    const card = resultsArea.querySelector(`[data-tactic="${CSS.escape(tactic)}"]`);
    if (!card) return;

    // Flash the card
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    card.classList.add('card-flash');
    setTimeout(() => card.classList.remove('card-flash'), activeFlags.enhancedMotion ? 500 : 300);
    card.focus();
  }

  // ── Start ──
  init();
})();
