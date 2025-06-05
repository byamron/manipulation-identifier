let tactics = [];
let isProcessing = false;
let debounceTimeout = null;
let currentHighlights = null; // Track current highlights state
let openTooltip = null;

// Load tactics from JSON file with retry mechanism
async function loadTactics(retries = 3) {
  try {
    if (!chrome.runtime?.getURL) {
      throw new Error('chrome.runtime.getURL is not available');
    }

    const response = await fetch(chrome.runtime.getURL('tactics.json'));
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    tactics = await response.json();
    console.log('Tactics loaded successfully');
  } catch (error) {
    console.error('Error loading tactics:', error);
    if (retries > 0) {
      console.log(`Retrying... ${retries} attempts remaining`);
      setTimeout(() => loadTactics(retries - 1), 1000);
    }
  }
}

// Debounced analysis function
function debounceAnalysis(func, delay = 300) {
  let timeoutId;
  return async function (...args) {
    clearTimeout(timeoutId);
    return new Promise((resolve, reject) => {
      timeoutId = setTimeout(async () => {
        try {
          await func.apply(this, args);
          resolve();
        } catch (error) {
          reject(error);
        }
      }, delay);
    });
  };
}

// Optimized text collection using DocumentFragment
function collectTextForAnalysis(node, collected = new Set()) {
  const walker = document.createTreeWalker(
    node,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentNode;
        if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'A'].includes(parent.tagName)) {
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

  return Array.from(collected);
}

// Add function to check for existing highlights
function getExistingHighlights() {
  const highlights = document.querySelectorAll('.manipulation-highlight');
  if (!highlights.length) return null;
  
  const existingTactics = new Set();
  highlights.forEach(highlight => {
    const tooltip = document.querySelector(`.manipulation-tooltip[data-for="${highlight.dataset.highlightId}"]`);
    if (tooltip) {
      const tacticMatch = tooltip.textContent.match(/Manipulation Tactic: (.*)/);
      if (tacticMatch) {
        existingTactics.add(tacticMatch[1]);
      }
    }
  });
  
  return existingTactics.size > 0 ? Array.from(existingTactics) : null;
}

// Optimized highlighting function using DocumentFragment
function highlightManipulativeLanguage(detectedTactics) {
  if (!detectedTactics?.length) return;

  // Clear existing highlights if any
  const existingHighlights = document.querySelectorAll('.manipulation-highlight');
  existingHighlights.forEach(highlight => {
    const parent = highlight.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
    }
  });

  const existingTooltips = document.querySelectorAll('.manipulation-tooltip');
  existingTooltips.forEach(tooltip => tooltip.remove());

  // Add style only once
  if (!document.querySelector('#manipulation-highlight-style')) {
  const style = document.createElement('style');
    style.id = 'manipulation-highlight-style';
  style.textContent = `
    .manipulation-highlight {
        background-color: #fff3cd !important;
        border: 1px solid #ffeaa7 !important;
        border-radius: 3px !important;
        padding: 2px !important;
        position: relative !important;
        transition: background 0.15s, border 0.15s;
      }
      .manipulation-highlight:hover {
        background-color: #ffe082 !important;
        border: 1px solid #ffd54f !important;
        cursor: pointer !important;
      }
      .manipulation-highlight.pressed, .manipulation-highlight.active {
        background-color: #ffd54f !important;
        border: 1px solid #ffca28 !important;
      }
      .manipulation-tooltip {
        display: none;
        position: fixed;
        background-color: #333;
        color: white;
        padding: 15px;
        border-radius: 5px;
        font-size: 12px;
        max-width: 300px;
        z-index: 10000;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        pointer-events: none;
      }
      .manipulation-tooltip.visible {
        display: block;
      }
      .manipulation-tooltip h4 {
        margin: 0 0 8px 0;
        color: #fff;
        font-size: 14px;
      }
      .manipulation-tooltip .definition {
        margin-bottom: 8px;
        color: #ddd;
      }
      .manipulation-tooltip .explanation {
        color: #bbb;
        font-style: italic;
      }
      .manipulation-tooltip::before {
        content: '';
        position: absolute;
        width: 0;
        height: 0;
        border-left: 5px solid transparent;
        border-right: 5px solid transparent;
      }
      .manipulation-tooltip.tooltip-top::before {
        bottom: -5px;
        left: var(--dogear-left, 50%);
        transform: translateX(-50%);
        border-top: 5px solid #333;
      }
      .manipulation-tooltip.tooltip-bottom::before {
        top: -5px;
        left: var(--dogear-left, 50%);
        transform: translateX(-50%);
        border-bottom: 5px solid #333;
    }
  `;
  document.head.appendChild(style);
  }

  // Add event listeners for tooltip positioning
  function positionTooltip(highlight, tooltip) {
    const highlightRect = highlight.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const scrollY = window.scrollY;
    const margin = 10;

    // Remove existing position classes
    tooltip.classList.remove('tooltip-top', 'tooltip-bottom');

    // Calculate ideal left (centered on highlight)
    let left = highlightRect.left + (highlightRect.width / 2) - (tooltipRect.width / 2);
    // Clamp left to viewport
    const minLeft = margin;
    const maxLeft = window.innerWidth - tooltipRect.width - margin;
    left = Math.max(minLeft, Math.min(left, maxLeft));

    // Decide whether to show above or below based on available space
    let top, dogearType;
    if (highlightRect.top > tooltipRect.height + margin && highlightRect.top >= viewportHeight - highlightRect.bottom) {
      // Position above
      top = highlightRect.top + scrollY - tooltipRect.height - margin;
      dogearType = 'tooltip-top';
    } else {
      // Position below
      top = highlightRect.bottom + scrollY + margin;
      dogearType = 'tooltip-bottom';
    }
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    tooltip.classList.remove('tooltip-top', 'tooltip-bottom');
    tooltip.classList.add(dogearType);

    // Adjust dogear position so it always points to the highlight
    const dogear = tooltip.querySelector('::before'); // pseudo-element, so we can't select directly
    // Instead, set a CSS variable for the dogear's left offset
    const highlightCenter = highlightRect.left + highlightRect.width / 2;
    const tooltipLeft = left;
    const dogearOffset = Math.max(12, Math.min(tooltipRect.width - 12, highlightCenter - tooltipLeft));
    tooltip.style.setProperty('--dogear-left', `${dogearOffset}px`);
  }

  const textNodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentNode;
    if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'MANIPULATION-HIGHLIGHT'].includes(parent.tagName)) continue;
    textNodes.push(node);
  }

  textNodes.forEach(node => {
    let text = node.textContent;
    let lastIndex = 0;
    let hasMatch = false;
    const matches = [];

    detectedTactics.forEach(tactic => {
      tactic.examples.forEach(example => {
        const index = text.toLowerCase().indexOf(example.text.toLowerCase());
        if (index !== -1) {
          hasMatch = true;
          matches.push({
            index,
            length: example.text.length,
            text: example.text,
            tactic: tactic.tactic,
            definition: tactic.definition,
            explanation: example.explanation
          });
        }
      });
    });

    if (hasMatch) {
      const parent = node.parentNode;
      const wrapper = document.createElement('span');
      matches.sort((a, b) => a.index - b.index);
      
      matches.forEach(match => {
        if (match.index > lastIndex) {
          wrapper.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }
        const highlight = document.createElement('span');
        highlight.className = 'manipulation-highlight';
        highlight.textContent = match.text;
        
        // Create tooltip with close button
        const tooltip = document.createElement('div');
        tooltip.className = 'manipulation-tooltip';
        tooltip.innerHTML = `
          <button class="manipulation-tooltip-close" style="position:absolute;top:8px;right:8px;background:none;border:none;color:#bbb;font-size:18px;cursor:pointer;z-index:2;">&times;</button>
          <h4>Tactic: ${match.tactic}</h4>
          <div class="definition">Definition: ${match.definition}</div>
          <div class="explanation">Why this is an example: ${match.explanation}</div>
        `;
        document.body.appendChild(tooltip);
        
        // Tooltip close button
        tooltip.querySelector('.manipulation-tooltip-close').addEventListener('click', (e) => {
          e.stopPropagation();
          closeOpenTooltip();
        });

        // Click/tap to open tooltip
        highlight.addEventListener('click', (e) => handleHighlightClick(e, highlight, tooltip));
        highlight.addEventListener('touchstart', (e) => handleHighlightClick(e, highlight, tooltip));

        // Hover/pressed state for mouse/touch
        highlight.addEventListener('mousedown', () => highlight.classList.add('pressed'));
        highlight.addEventListener('mouseup', () => highlight.classList.remove('pressed'));
        highlight.addEventListener('mouseleave', () => highlight.classList.remove('pressed'));
        highlight.addEventListener('mouseenter', () => highlight.classList.add('hover'));
        highlight.addEventListener('mouseleave', () => highlight.classList.remove('hover'));
        
        // Update tooltip position on scroll and resize
        window.addEventListener('scroll', () => {
          if (tooltip.classList.contains('visible')) {
            positionTooltip(highlight, tooltip);
          }
        }, { passive: true });
        
        window.addEventListener('resize', () => {
          if (tooltip.classList.contains('visible')) {
            positionTooltip(highlight, tooltip);
          }
        }, { passive: true });
        
        wrapper.appendChild(highlight);
        lastIndex = match.index + match.length;
      });

      if (lastIndex < text.length) {
        wrapper.appendChild(document.createTextNode(text.substring(lastIndex)));
      }

      parent.replaceChild(wrapper, node);
    }
  });

  // Store current highlights state
  currentHighlights = detectedTactics;
}

// Optimized analysis function
async function analyzeTextWithLLM(text) {
  if (isProcessing) return;
  isProcessing = true;

  try {
    // Get server URL from storage (default to localhost)
    const serverUrl = await new Promise(resolve => {
      chrome.storage.local.get(['serverUrl'], (result) => {
        resolve(result.serverUrl || 'http://localhost:3000');
      });
    });
    const endpoint = serverUrl.replace(/\/$/, '') + '/analyze-content';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text })
    });
    if (!response.ok) throw new Error('Server error: ' + response.status);
    const data = await response.json();

    if (!data?.manipulativeLanguage) {
      throw new Error('Invalid response from analysis');
    }

    const resultText = data.manipulativeLanguage;
    console.log('Analysis result:', resultText);

    // Check if no manipulation was detected
    if (resultText.trim() === "No manipulation tactics detected.") {
      window.dispatchEvent(new CustomEvent('analysisComplete', { detail: { results: [], llmResponse: resultText } }));
        return;
      }

    // Use the pre-parsed results from the server if available
    let detectedTactics = data.results;

    // If no pre-parsed results, parse the response text
    if (!detectedTactics || !detectedTactics.length) {
      detectedTactics = [];
      const sections = resultText.split(/\d+\.\s*\[/);
      sections.forEach(section => {
        if (!section.trim()) return;
        section = '[' + section; // Add back the '[' we split on
        const tacticMatch = section.match(/\[(.*?)\]:/);
        if (!tacticMatch) return;
        const tacticName = tacticMatch[1].trim();
        const remainingText = section.slice(section.indexOf(']:') + 2).trim();
        // Extract examples (text in quotes)
        const examples = [];
        const exampleMatches = remainingText.match(/"([^"]+)"/g);
        if (exampleMatches) {
          exampleMatches.forEach(match => {
            examples.push(match.slice(1, -1).trim());
          });
        }
        detectedTactics.push({
          tactic: tacticName,
          description: remainingText.replace(/"[^"]+"/g, '').trim(),
          examples: examples
    });
  });
}

    // Trigger analysisComplete event for the widget
    window.dispatchEvent(new CustomEvent('analysisComplete', { detail: { results: detectedTactics, llmResponse: resultText } }));

    // Highlight the detected tactics if any were found
    if (detectedTactics.length > 0) {
      highlightManipulativeLanguage(detectedTactics);
}
  } catch (error) {
    console.error('Analysis error:', error);
    window.dispatchEvent(new CustomEvent('analysisError', { detail: { error: error.message || 'Failed to analyze text' } }));
  } finally {
    isProcessing = false;
    }
  }

// Optimized main analysis function
const runAnalysis = debounceAnalysis(async () => {
  console.log('Running content analysis');
  
  if (!tactics.length) {
    console.warn('Tactics not loaded yet');
    throw new Error('Tactics not loaded yet');
  }

  const visibleTextArray = collectTextForAnalysis(document.body);
  const combinedText = visibleTextArray.join(' ').slice(0, 3000);

  if (combinedText.length < 50) {
    const error = new Error('Not enough text content found on this page to analyze.');
    window.dispatchEvent(new CustomEvent('analysisError', { detail: { error: error.message } }));
    throw error;
  }

  await analyzeTextWithLLM(combinedText);
});

// Message listener
chrome.runtime.onMessage?.addListener((message, sender, sendResponse) => {
    if (message.action === "analyze") {
    // Execute runAnalysis and ensure proper Promise handling
    (async () => {
      try {
        await runAnalysis();
        sendResponse({ status: "Analysis started" });
      } catch (error) {
        console.error('Analysis failed:', error);
        sendResponse({ status: "Analysis failed", error: error.message });
      }
    })();
    return true;
  } else if (message.action === "getHighlightState") {
    // Check for existing highlights and return their state
    const existingTactics = getExistingHighlights();
    sendResponse({ 
      hasHighlights: !!existingTactics,
      tactics: existingTactics
    });
    return true;
  } else if (message.action === "clearHighlights") {
    // Clear all highlights and tooltips
    const existingHighlights = document.querySelectorAll('.manipulation-highlight');
    existingHighlights.forEach(highlight => {
      const parent = highlight.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
    }
  });

    const existingTooltips = document.querySelectorAll('.manipulation-tooltip');
    existingTooltips.forEach(tooltip => tooltip.remove());

    // Clear current highlights state
    currentHighlights = null;
    sendResponse({ status: "Highlights cleared" });
    return true;
  }
});

// Initialize
(async () => {
  await loadTactics();
  console.log('Content script initialized');
})();

// --- Widget Injection ---
function injectWidget() {
  if (document.getElementById('manipulation-widget-root')) return; // Prevent double-injection

  // Create root
  const root = document.createElement('div');
  root.id = 'manipulation-widget-root';
  root.innerHTML = `
    <style>
      #manipulation-widget-root {
        position: fixed;
        z-index: 2147483647;
        bottom: 24px;
        right: 24px;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      }
      .manipulation-widget-btn {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: #1a73e8;
        color: #fff;
        border: none;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        font-size: 32px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
        will-change: transform;
      }
      .manipulation-widget-btn.spin {
        animation: spin-btn 0.5s ease-in-out;
      }
      @keyframes spin-btn {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      .manipulation-widget-btn:hover {
        background: #185abc;
      }
      .manipulation-widget-panel {
        display: flex;
        position: absolute;
        bottom: 70px;
        right: 0;
        width: 350px;
        max-height: 500px;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.18);
        border: 1px solid #e0e0e0;
        overflow: hidden;
        flex-direction: column;
        opacity: 0;
        transform: scale(0.7);
        pointer-events: none;
        transition: opacity 0.5s cubic-bezier(0.4,0,0.2,1), transform 0.5s cubic-bezier(0.4,0,0.2,1);
        transform-origin: 100% 100%;
      }
      .manipulation-widget-panel.open {
        opacity: 1;
        transform: scale(1);
        pointer-events: auto;
      }
      .manipulation-widget-header {
        background: #1a73e8;
        color: #fff;
        padding: 12px 16px;
        font-size: 16px;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .manipulation-widget-content {
        padding: 16px;
        flex: 1;
        overflow-y: auto;
      }
      .analyze-button {
        background-color: #1a73e8;
        color: white;
        border: none;
        border-radius: 6px;
        padding: 12px 16px;
        font-size: 16px;
        cursor: pointer;
        width: 100%;
        min-height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s;
        margin-bottom: 0;
        white-space: normal;
        text-align: center;
        box-sizing: border-box;
      }
      .analyze-button:hover {
        background-color: #185abc;
      }
      .analyze-button:disabled {
        background-color: #ccc;
        cursor: not-allowed;
      }
      .analyze-button.clear {
        background-color: #dc3545;
      }
      .analyze-button.clear:hover {
        background-color: #c82333;
      }
      .analyze-button.active {
        background-color: #dc3545;
      }
      .analyze-button.active:hover {
        background-color: #c82333;
      }
      .status-message {
        color: #666;
        font-size: 13px;
        line-height: 1.4;
        padding: 8px;
        border-radius: 4px;
        background-color: #f8f9fa;
        border: 1px solid #e9ecef;
        margin-bottom: 8px;
      }
      .status-message.loading {
        color: #6c757d;
      }
      .error {
        color: #dc3545;
        font-size: 12px;
        margin-top: 10px;
        padding: 8px;
        border-radius: 4px;
        background-color: #f8d7da;
        border: 1px solid #f5c6cb;
      }
      .analyze-actions {
        width: 100%;
        display: flex;
        gap: 8px;
        margin-bottom: 10px;
      }
      .manipulation-widget-btn-icon {
        transition: opacity 0.25s ease-in-out;
        position: absolute;
        left: 0; right: 0; top: 0; bottom: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 1;
        pointer-events: auto;
      }
      .manipulation-widget-btn-icon.hide {
        opacity: 0;
        pointer-events: none;
      }
      .manipulation-widget-btn-icon.show {
        opacity: 1;
        pointer-events: auto;
      }
      #manipulation-widget-root, .manipulation-widget-panel, .manipulation-widget-header, .manipulation-widget-content, .analyze-button, .status-message, .error, .manipulation-widget-btn, .manipulation-widget-btn-icon {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
      }
      .manipulation-tooltip, .manipulation-tooltip * {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
      }
    </style>
    <button class="manipulation-widget-btn" title="Open Manipulation Identifier" id="manipulationWidgetBtn">
      <span class="manipulation-widget-btn-icon show" id="manipulationWidgetBtnMagnifier">🔍</span>
      <span class="manipulation-widget-btn-icon hide" id="manipulationWidgetBtnClose">✕</span>
    </button>
    <div class="manipulation-widget-panel" id="manipulationWidgetPanel">
      <div class="manipulation-widget-header">
        Manipulation Identifier
      </div>
      <div class="manipulation-widget-content">
        <div class="analyze-actions" style="display: flex; gap: 8px; width: 100%;">
          <button id="analyzeButton" class="analyze-button" style="flex: 1;">Analyze Current Page</button>
          <button id="redoButton" class="analyze-button" style="flex: 1; display: none;">Re-analyze</button>
        </div>
        <div id="status" class="status"></div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const btn = root.querySelector('#manipulationWidgetBtn');
  const btnIcon = root.querySelector('#manipulationWidgetBtnMagnifier');
  const panel = root.querySelector('#manipulationWidgetPanel');
  const analyzeButton = root.querySelector('#analyzeButton');
  const statusDiv = root.querySelector('#status');
  const redoButton = root.querySelector('#redoButton');

  let panelOpen = false;
  let lastAnalysisResults = null;

  function setStatus(message, type = '') {
    statusDiv.innerHTML = `<div class="status-message${type ? ' ' + type : ''}">${message}</div>`;
  }
  function showError(errorMessage) {
    statusDiv.innerHTML = `<div class="error">${escapeHtml(errorMessage)}</div>`;
    analyzeButton.disabled = false;
    analyzeButton.textContent = 'Analyze Current Page';
  }
  function escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function checkPageState() {
    const highlights = document.querySelectorAll('.manipulation-highlight');
    if (highlights.length > 0 && lastAnalysisResults && lastAnalysisResults.length > 0) {
      analyzeButton.textContent = 'Clear';
      analyzeButton.classList.add('clear');
      analyzeButton.classList.remove('active');
      redoButton.textContent = 'Re-analyze';
      redoButton.style.display = '';
      setStatus(`Analysis complete. ${lastAnalysisResults.length} manipulation tactic${lastAnalysisResults.length > 1 ? 's' : ''} identified.`);
    } else {
      analyzeButton.textContent = 'Analyze Current Page';
      analyzeButton.classList.remove('clear');
      analyzeButton.classList.remove('active');
      redoButton.style.display = 'none';
      setStatus('Click "Analyze" to search for manipulative language.');
      lastAnalysisResults = null;
    }
  }

  analyzeButton.addEventListener('click', async function() {
    if (analyzeButton.classList.contains('clear')) {
      // Clear highlights
      const existingHighlights = document.querySelectorAll('.manipulation-highlight');
      existingHighlights.forEach(highlight => {
        const parent = highlight.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
        }
      });
      const existingTooltips = document.querySelectorAll('.manipulation-tooltip');
      existingTooltips.forEach(tooltip => tooltip.remove());
      currentHighlights = null;
      lastAnalysisResults = null;
      analyzeButton.textContent = 'Analyze Current Page';
      analyzeButton.classList.remove('clear');
      analyzeButton.classList.remove('active');
      redoButton.style.display = 'none';
      setStatus('Click "Analyze" to search for manipulative language.');
    } else {
      // Start analysis
      analyzeButton.disabled = true;
      analyzeButton.textContent = 'Analyzing...';
      setStatus('Analyzing page content...', 'loading');
      try {
        await runAnalysis();
      } catch (error) {
        showError(error.message || 'Unknown error occurred during analysis.');
      }
    }
  });

  redoButton.addEventListener('click', async function() {
    redoButton.disabled = true;
    redoButton.textContent = 'Analyzing...';
    setStatus('Re-running analysis...', 'loading');
    try {
      await runAnalysis();
    } catch (error) {
      showError(error.message || 'Unknown error occurred during analysis.');
    } finally {
      redoButton.disabled = false;
      redoButton.textContent = 'Re-analyze';
    }
  });

  // Listen for analysis results
  window.addEventListener('analysisComplete', function(e) {
    analyzeButton.disabled = false;
    redoButton.disabled = false;
    lastAnalysisResults = e.detail && e.detail.results ? e.detail.results : [];
    if (lastAnalysisResults.length > 0) {
      analyzeButton.textContent = 'Clear';
      analyzeButton.classList.add('clear');
      analyzeButton.classList.remove('active');
      redoButton.textContent = 'Re-analyze';
      redoButton.style.display = '';
      setStatus(`Analysis complete. ${lastAnalysisResults.length} manipulation tactic${lastAnalysisResults.length > 1 ? 's' : ''} identified.`);
    } else {
      analyzeButton.textContent = 'Analyze Current Page';
      analyzeButton.classList.remove('clear');
      analyzeButton.classList.remove('active');
      redoButton.style.display = 'none';
      setStatus('No manipulative language identified.');
    }
  });
  window.addEventListener('analysisError', function(e) {
    showError(e.detail?.error || 'Unknown error occurred during analysis.');
  });

  // Update status on open
  btn.addEventListener('click', () => {
    if (btn.classList.contains('spin')) return; // Prevent stacking spins
    panelOpen = !panelOpen;
    btn.classList.add('spin');
    if (panelOpen) {
      setTimeout(() => {
        panel.classList.add('open');
        setTimeout(() => {
          showBtnIcon(true);
          btn.title = 'Close Manipulation Identifier';
        }, 250);
        checkPageState();
        setTimeout(() => btn.classList.remove('spin'), 500);
      }, 0);
    } else {
      panel.classList.remove('open');
      setTimeout(() => {
        showBtnIcon(false);
        btn.title = 'Open Manipulation Identifier';
      }, 250);
      setTimeout(() => {
        btn.classList.remove('spin');
      }, 500);
    }
  });

  function showBtnIcon(isClose) {
    if (isClose) {
      btnIcon.classList.remove('show');
      btnIcon.classList.add('hide');
      requestAnimationFrame(() => {
        btn.querySelector('#manipulationWidgetBtnClose').classList.remove('hide');
        btn.querySelector('#manipulationWidgetBtnClose').classList.add('show');
      });
    } else {
      btn.querySelector('#manipulationWidgetBtnClose').classList.remove('show');
      btn.querySelector('#manipulationWidgetBtnClose').classList.add('hide');
      requestAnimationFrame(() => {
        btn.querySelector('#manipulationWidgetBtnMagnifier').classList.remove('hide');
        btn.querySelector('#manipulationWidgetBtnMagnifier').classList.add('show');
      });
    }
  }
}

// Inject the widget on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectWidget);
} else {
  injectWidget();
}

function closeOpenTooltip() {
  if (openTooltip) {
    openTooltip.tooltip.classList.remove('visible');
    openTooltip.highlight.classList.remove('pressed', 'active');
    openTooltip = null;
  }
}

function handleHighlightClick(e, highlight, tooltip) {
  e.stopPropagation();
  if (openTooltip && openTooltip.highlight === highlight) {
    closeOpenTooltip();
    return;
  }
  closeOpenTooltip();
  highlight.classList.add('pressed', 'active');
  tooltip.classList.add('visible');
  openTooltip = { highlight, tooltip };
}

function handleDocumentClick(e) {
  if (openTooltip && !openTooltip.tooltip.contains(e.target) && !openTooltip.highlight.contains(e.target)) {
    closeOpenTooltip();
  }
}

function handleEscapeKey(e) {
  if (e.key === 'Escape') {
    closeOpenTooltip();
  }
}

document.addEventListener('click', handleDocumentClick, true);
document.addEventListener('touchstart', handleDocumentClick, true);
document.addEventListener('keydown', handleEscapeKey, true);
