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

  // ── Init ──
  async function init() {
    // Load saved model preference
    chrome.storage.local.get(['selectedModel', 'anthropicApiKey', 'serverUrl'], (result) => {
      if (result.selectedModel && modelSelect.querySelector(`option[value="${result.selectedModel}"]`)) {
        modelSelect.value = result.selectedModel;
      }
      // Check if setup is needed (no API key and no server URL)
      const hasKey = !!result.anthropicApiKey;
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
          showAnalyzing(analysisStart, status.stage);
        }
      } else if (results?.results?.length > 0) {
        showResults(results.results, results.model);
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
      chrome.runtime.openOptionsPage();
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
      if (area !== 'session') return;

      const resultsKey = `results_${activeTabId}`;
      const statusKey = `status_${activeTabId}`;

      if (changes[statusKey]) {
        const newStatus = changes[statusKey].newValue;
        if (!newStatus) return;

        if (newStatus.status === 'analyzing') {
          if (currentState !== 'analyzing') {
            showAnalyzing(newStatus.startedAt || newStatus.timestamp, newStatus.stage);
          } else {
            // Update stage label without resetting the timer
            const timerEl = document.getElementById('analyzeTimerDisplay');
            if (timerEl && newStatus.stage) {
              timerEl.dataset.stage = newStatus.stage;
            }
          }
        } else if (newStatus.status === 'error') {
          showError(newStatus.error);
        } else if (newStatus.status === 'complete' && changes[resultsKey]) {
          const results = changes[resultsKey].newValue;
          if (results?.results?.length > 0) {
            showResults(results.results, results.model);
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
        resultsArea.querySelectorAll('.card-learn-more.expanded, .card-feedback.expanded')
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
        <a href="#" id="setupLink">Add your Anthropic API key</a> to get started.
      </div>
    `;
    resultsArea.innerHTML = '';
    document.getElementById('setupLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  function showReady() {
    currentState = 'ready';
    updateButton('Analyze', true);
    streamingRenderedCount = 0;
    clearTimeout(streamingDebounceTimer);
    const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl';
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

  const STAGE_LABELS = {
    collecting: 'Collecting text...',
    calling_api: 'Analyzing with Claude...',
    processing: 'Processing results...'
  };

  function showAnalyzing(startTimestamp, stage) {
    currentState = 'analyzing';
    updateButton('Analyzing...', false);
    const start = startTimestamp || Date.now();
    const stageText = STAGE_LABELS[stage] || 'Analyzing...';

    statusArea.innerHTML = `
      <div class="skeleton">
        <div class="skeleton-card">
          <div class="skeleton-line short"></div>
          <div class="skeleton-line medium"></div>
          <div class="skeleton-line"></div>
        </div>
        <div class="skeleton-card">
          <div class="skeleton-line short"></div>
          <div class="skeleton-line"></div>
        </div>
        <div class="skeleton-timer" id="analyzeTimerDisplay">${stageText}</div>
      </div>
    `;
    resultsArea.innerHTML = '';

    // Elapsed time counter
    clearInterval(analyzeTimer);
    analyzeTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const timerEl = document.getElementById('analyzeTimerDisplay');
      if (timerEl) {
        const currentLabel = timerEl.dataset.stage ? (STAGE_LABELS[timerEl.dataset.stage] || 'Analyzing...') : stageText;
        timerEl.textContent = `${currentLabel} ${elapsed}s`;
      }
      // Timeout check
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

    return `
      <div class="tactic-card" tabindex="0" role="article"
           aria-label="${escapeHtml(tactic.tactic)}"
           data-tactic="${escapeHtml(tactic.tactic)}">
        <div class="card-header">
          <div class="card-category-bar ${category}" title="${escapeHtml(categoryLabel)}"></div>
          <div class="card-content">
            <div class="card-tactic-name">${escapeHtml(tactic.tactic)}</div>
            <div class="card-definition">${escapeHtml(tactic.definition)}</div>
          </div>
        </div>
        <div class="card-instances">
          ${tactic.examples.map((ex, i) => `
            <div class="instance">
              <div class="instance-quote${interactive ? '' : ' non-interactive'}"
                   ${interactive ? `data-highlight-tactic="${escapeHtml(tactic.tactic)}" data-instance-index="${i}" title="Click to scroll to this text on the page"` : ''}>
                "${escapeHtml(ex.text)}"
              </div>
              <div class="instance-explanation">${escapeHtml(ex.explanation)}</div>
            </div>
          `).join('')}
        </div>
        ${interactive ? `
        <div class="card-actions">
          ${tacticInfo ? `<button class="card-action-link learn-more-toggle">Learn more</button>` : ''}
          <button class="card-action-link feedback-toggle">Was this accurate?</button>
        </div>
        ${tacticInfo ? `
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
              <div class="learn-more-label">What you can do</div>
              <div class="learn-more-text">
                <ul>${tacticInfo.whatToDo.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
              </div>
            </div>
          ` : ''}
        </div>
        ` : ''}
        <div class="card-feedback">
          <div class="feedback-options">
            <button class="feedback-btn" data-value="accurate">Accurate</button>
            <button class="feedback-btn" data-value="inaccurate">Inaccurate</button>
            <button class="feedback-btn" data-value="uncertain">Uncertain</button>
          </div>
          <textarea class="feedback-comment" placeholder="Optional comment..." rows="2"></textarea>
          <button class="feedback-submit">Submit</button>
        </div>
        ` : ''}
      </div>
    `;
  }

  function showResults(results, model) {
    currentState = 'results';
    clearInterval(analyzeTimer);
    clearTimeout(streamingDebounceTimer);
    updateButton('Clear', true, true);
    statusArea.innerHTML = '';
    streamingRenderedCount = 0;

    const totalInstances = results.reduce((sum, t) => sum + t.examples.length, 0);
    let html = `<div class="results-summary">${results.length} tactic${results.length !== 1 ? 's' : ''} detected &middot; ${totalInstances} instance${totalInstances !== 1 ? 's' : ''}${model ? ` &middot; ${escapeHtml(model)}` : ''}</div>`;
    html += `<div class="category-legend"><span class="legend-item"><span class="legend-dot logical"></span>Logical</span><span class="legend-item"><span class="legend-dot rhetorical"></span>Rhetorical</span><span class="legend-item"><span class="legend-dot credibility"></span>Credibility</span></div>`;
    html += results.map(t => renderTacticCard(t, { interactive: true })).join('');

    resultsArea.innerHTML = html;
    attachCardListeners();
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

    // Collapse skeleton on first streaming result
    if (streamingRenderedCount === 0 && results.length > 0) {
      statusArea.innerHTML = `
        <div class="skeleton-timer standalone" id="analyzeTimerDisplay">
          Analyzing with Claude...
        </div>
      `;
      // Transfer stage data to new timer element
      const timerEl = document.getElementById('analyzeTimerDisplay');
      if (timerEl) timerEl.dataset.stage = 'calling_api';
    }

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
        No manipulation tactics detected — this content looks clean.<br><br>
        Try analyzing a news article or opinion piece with strong claims.
      </div>
    `;
    resultsArea.innerHTML = '';
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

    // Feedback toggle
    resultsArea.querySelectorAll('.feedback-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.tactic-card');
        const feedback = card.querySelector('.card-feedback');
        if (feedback) {
          feedback.classList.toggle('expanded');
        }
      });
    });

    // Feedback buttons
    resultsArea.querySelectorAll('.feedback-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const group = btn.closest('.feedback-options');
        group.querySelectorAll('.feedback-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    // Feedback submit
    resultsArea.querySelectorAll('.feedback-submit').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.tactic-card');
        const feedback = card.querySelector('.card-feedback');
        const selected = feedback.querySelector('.feedback-btn.selected');
        if (!selected) return;

        const rating = selected.dataset.value;
        const comment = feedback.querySelector('.feedback-comment').value.trim();
        const tactic = card.dataset.tactic;

        // Submit feedback to server (if configured)
        try {
          const settings = await new Promise(resolve => {
            chrome.storage.local.get(['serverUrl'], r => resolve(r));
          });
          const serverUrl = settings.serverUrl;
          if (serverUrl) {
            await fetch(`${serverUrl.replace(/\/$/, '')}/submit-instance-feedback`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                detectedTactic: tactic,
                modelUsed: modelSelect.value,
                userRating: rating,
                userComments: comment,
                pageUrl: (await chrome.tabs.get(activeTabId)).url,
                highlightedText: '',
                originalFullText: ''
              })
            });
          }
        } catch { /* non-critical */ }

        // Show thanks
        feedback.innerHTML = '<div class="feedback-thanks">Thank you for your feedback!</div>';
        setTimeout(() => {
          feedback.classList.remove('expanded');
          feedback.innerHTML = '';
        }, 2000);
      });
    });
  }

  // ── Scroll to card when highlight clicked on page ──

  function scrollToCard(tactic, highlightId) {
    const card = resultsArea.querySelector(`[data-tactic="${CSS.escape(tactic)}"]`);
    if (!card) return;

    // Flash the card
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    card.classList.add('card-flash');
    setTimeout(() => card.classList.remove('card-flash'), 300);
    card.focus();
  }

  // ── Start ──
  init();
})();
