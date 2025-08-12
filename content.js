let tactics = [];
let isProcessing = false;
let debounceTimeout = null;
let currentHighlights = null; // Track current highlights state
let openTooltip = null;
let loadingInterval = null;
let loadingBaseMessage = '';
let allInstances = []; // Track all highlighted instances in document order
let currentInstanceIndex = -1; // Current navigation position

// Add global flag for robust tooltip persistence
let ignoreNextDocumentClick = false;

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
  function isInsideWidget(element) {
    try {
      return !!(element && element.closest && element.closest('#manipulation-widget-root'));
    } catch (_) {
      return false;
    }
  }
  const walker = document.createTreeWalker(
    node,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentNode;
        if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'A'].includes(parent.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        // Ignore any text inside our injected widget/tooltip
        if (isInsideWidget(parent)) {
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

// Clear all highlights and tooltips from the page
function clearAllHighlights() {
  // Replace each highlight span with its raw text
  const existingHighlights = document.querySelectorAll('.manipulation-highlight');
  existingHighlights.forEach(highlight => {
    const parent = highlight.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
    }
  });

  // Remove any legacy inline tooltips
  const legacyTooltips = document.querySelectorAll('.manipulation-tooltip');
  legacyTooltips.forEach(tooltip => tooltip.remove());

  // Hide the widget tooltip if present
  const widgetTooltip = document.getElementById('manipulation-widget-tooltip');
  if (widgetTooltip) {
    widgetTooltip.classList.remove('visible');
    widgetTooltip.style.opacity = '0';
    widgetTooltip.innerHTML = '';
  }

  openTooltip = null;
  currentHighlights = null;
  allInstances = [];
  currentInstanceIndex = -1;
}

// Optimized highlighting function using DocumentFragment
function highlightManipulativeLanguage(detectedTactics) {
  if (!detectedTactics?.length) return;

  // Initialize allInstances array
  allInstances = [];
  currentInstanceIndex = -1;

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
        transform: translateX(-50%);
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
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        left: 50%;
        transform: translateX(-50%);
        z-index: 10001;
        pointer-events: none;
      }
      .manipulation-tooltip.tooltip-top::before {
        bottom: -6px;
        border-top: 6px solid #333;
      }
      .manipulation-tooltip.tooltip-bottom::before {
        top: -6px;
        border-bottom: 6px solid #333;
    }
  `;
  document.head.appendChild(style);
  }

  // Add event listeners for tooltip positioning
  function positionTooltip(highlight, tooltip) {
    const highlightRect = highlight.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const margin = 10;

    // Remove existing position classes
    tooltip.classList.remove('tooltip-top', 'tooltip-bottom');

    // Calculate center position
    const centerX = highlightRect.left + (highlightRect.width / 2);
    const centerY = highlightRect.top + (highlightRect.height / 2);

    // Decide whether to show above or below based on available space
    let top, dogearType;
    if (highlightRect.top > tooltipRect.height + margin && highlightRect.top >= viewportHeight - highlightRect.bottom) {
      // Position above
      top = highlightRect.top - tooltipRect.height - margin;
      dogearType = 'tooltip-top';
    } else {
      // Position below
      top = highlightRect.bottom + margin;
      dogearType = 'tooltip-bottom';
    }

    // Set tooltip position
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${centerX}px`;
    tooltip.classList.add(dogearType);
  }

  const textNodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentNode;
      if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'MANIPULATION-HIGHLIGHT'].includes(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      // Ignore text inside our widget
      if (parent.closest && parent.closest('#manipulation-widget-root')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

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
        highlight.tabIndex = 0;
        highlight.setAttribute('role', 'button');
        highlight.setAttribute('aria-label', `Show manipulation tactic details for: ${match.text}`);
        
        // Store instance data for navigation
        highlight.instanceData = {
          tactic: match.tactic,
          definition: match.definition,
          explanation: match.explanation,
          text: match.text
        };
        // SUPER SIMPLE CLICK TEST
        highlight.addEventListener('click', function(e) {
          console.log('CLICK WORKED! Text:', this.textContent);
          e.stopPropagation();
          
          // Just add a visual indicator that click worked
          this.style.backgroundColor = 'red';
          setTimeout(() => {
            this.style.backgroundColor = '';
          }, 1000);
          
          // Now try the complex handler
          handleHighlightClick(e, this, match);
        });
        highlight.addEventListener('touchstart', (e) => {
          console.log('=== BASIC TOUCH DETECTED ===');
          console.log('Touch event fired on highlight:', highlight.textContent);
          handleHighlightClick(e, highlight, match);
        });

        // Hover/pressed state for mouse/touch
        highlight.addEventListener('mousedown', () => highlight.classList.add('pressed'));
        highlight.addEventListener('mouseup', () => highlight.classList.remove('pressed'));
        highlight.addEventListener('mouseleave', () => highlight.classList.remove('pressed'));
        highlight.addEventListener('mouseenter', () => highlight.classList.add('hover'));
        highlight.addEventListener('mouseleave', () => highlight.classList.remove('hover'));
        
        // Update tooltip position on scroll and resize
        window.addEventListener('scroll', () => {
          if (openTooltip && openTooltip.highlight === highlight) {
            positionTooltip(highlight, openTooltip.tooltip);
          }
        }, { passive: true });
        
        window.addEventListener('resize', () => {
          if (openTooltip && openTooltip.highlight === highlight) {
            positionTooltip(highlight, openTooltip.tooltip);
          }
        }, { passive: true });
        
        wrapper.appendChild(highlight);
        
        // Immediately add to allInstances array as we create highlights
        if (!allInstances.includes(highlight)) {
          allInstances.push(highlight);
        }
        
        // DEBUG: Verify highlight is accessible immediately after creation
        console.log(`Created highlight: "${highlight.textContent}" - hasEventListeners: ${!!highlight.click}`);
        console.log(`  Parent: ${!!highlight.parentNode}, Wrapper: ${highlight.parentNode === wrapper}`);
        
        lastIndex = match.index + match.length;
      });

      if (lastIndex < text.length) {
        wrapper.appendChild(document.createTextNode(text.substring(lastIndex)));
      }

      parent.replaceChild(wrapper, node);
      
      // DEBUG: Verify the replacement worked and elements are in DOM
      console.log('DOM replacement completed. Wrapper children:', wrapper.children.length);
      
      // CRITICAL FIX: Re-attach event listeners after DOM insertion
      setTimeout(() => {
        Array.from(wrapper.querySelectorAll('.manipulation-highlight')).forEach((highlight, i) => {
          console.log(`Post-DOM highlight ${i}: "${highlight.textContent}" in DOM = ${document.contains(highlight)}`);
          
          // ENSURE event listeners are attached after DOM insertion
          if (!highlight._listenersAttached) {
            console.log(`Re-attaching listeners for "${highlight.textContent}"`);
            
            const match = highlight.instanceData; // Should have been set earlier
            if (match) {
              // Clean event attachment
              highlight.addEventListener('click', function(e) {
                console.log('POST-DOM CLICK WORKED! Text:', this.textContent);
                e.stopPropagation();
                e.preventDefault();
                
                // Visual feedback
                this.style.backgroundColor = 'red';
                setTimeout(() => { this.style.backgroundColor = ''; }, 1000);
                
                // Handle the click
                handleHighlightClick(e, this, match);
              });
              
              highlight._listenersAttached = true;
            }
          }
        });
      }, 10); // Small delay to ensure DOM is settled
    }
  });

  // CRITICAL FIX: Rebuild allInstances array from actual DOM
  setTimeout(() => {
    console.log('=== REBUILDING ALLINSTANCES FROM DOM ===');
    allInstances = Array.from(document.querySelectorAll('.manipulation-highlight'));
    console.log('Found highlights in DOM:', allInstances.length);
    
    // Sort all instances in document order for navigation
    allInstances.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    
    // DEBUG: Verify all instances are valid and in DOM
    console.log('POST-REBUILD DOM CHECK:');
    allInstances.forEach((instance, i) => {
      const inDOM = document.contains(instance);
      const hasParent = !!instance.parentNode;
      const hasListeners = !!instance._listenersAttached;
      console.log(`Instance ${i}: inDOM=${inDOM}, hasParent=${hasParent}, hasListeners=${hasListeners}, text="${instance.textContent}"`);
    });
    
    // Trigger UI update with correct count
    window.dispatchEvent(new CustomEvent('instancesReady', { detail: { count: allInstances.length } }));
    
    console.log('=== REBUILD COMPLETE ===');
  }, 50); // Slightly longer delay to ensure all DOM operations complete
  
  // Legacy collection code - now handled by DOM rebuild above
  currentInstanceIndex = -1;
  
  // Navigation UI update now handled by DOM rebuild above

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

  // Collect text excluding our widget and tooltips
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
    clearAllHighlights();
    sendResponse({ status: "Highlights cleared" });
    return true;
  }
});

// Initialize
(async () => {
  await loadTactics();
  console.log('Content script initialized');
})();

// Inject full widget, button, and tooltip CSS into document head (only once)
function injectCSS() {
  if (!document.getElementById('manipulation-widget-style')) {
    console.log('CSS injection: Starting at', performance.now());
    const style = document.createElement('style');
    style.id = 'manipulation-widget-style';
    style.textContent = `
      #manipulation-widget-root {
        position: fixed;
        z-index: 2147483647;
        bottom: 24px;
        right: 24px;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
      }
      .manipulation-widget-btn {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        /* Adaptive solid with 50% opacity */
        background: var(--fab-bg, rgba(255,255,255,0.5));
        color: var(--fab-icon-color, rgba(0,0,0,0.8));
        border: 1px solid rgba(0,0,0,0.12);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        overflow: hidden; /* mask blur to circle */
        box-shadow: 0 4px 4px rgba(0,0,0,0.15);
        font-size: 32px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 200ms ease, color 200ms ease, box-shadow 200ms ease, transform 200ms ease, backdrop-filter 200ms ease;
        will-change: transform;
        position: relative;
      }
      .manipulation-widget-btn:hover {
        box-shadow: 0 6px 8px rgba(0,0,0,0.18);
      }
      .manipulation-widget-btn:focus-visible {
        outline: 2px solid rgba(44,47,54,0.5);
        outline-offset: 2px;
      }
      .manipulation-widget-btn.spin {
        animation: spin-btn 0.5s ease-in-out;
      }
      @keyframes spin-btn {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      /* Ensure icons meet contrast */
      .manipulation-widget-btn-icon { text-shadow: var(--fab-icon-shadow, 0 0 0 transparent); }
      .manipulation-widget-btn-icon svg { filter: none; }
      .manipulation-widget-panel {
        display: flex;
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
        position: relative;
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
        margin-bottom: 8px;
        background: none;
        border: none;
        padding: 0;
        border-radius: 0;
        box-shadow: none;
      }
      .status-message.loading {
        color: #6c757d;
        background: none;
        border: none;
        padding: 0;
        border-radius: 0;
        box-shadow: none;
      }
      .error {
        color: #dc3545;
        font-size: 12px;
        margin-top: 10px;
        padding: 8px;
        border-radius: 4px;
        background-color: #f8d7da;
        border: 1px solid #f5c6cb;
        box-shadow: none;
      }
      .analyze-actions {
        width: 100%;
        display: flex;
        gap: 8px;
        margin-bottom: 10px;
      }
      .navigation-controls {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 10px 0;
        padding: 8px;
        background-color: #f8f9fa;
        border-radius: 6px;
        border: 1px solid #e9ecef;
      }
      .nav-button {
        padding: 6px 10px;
        border: 1px solid #ced4da;
        background: white;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        min-width: 30px;
        transition: all 0.2s;
      }
      .nav-button:hover {
        background-color: #e9ecef;
        border-color: #adb5bd;
      }
      .nav-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background-color: #f8f9fa;
      }
      .instance-position {
        flex: 1;
        text-align: center;
        font-size: 12px;
        color: #6c757d;
        font-weight: 500;
      }
      .manipulation-widget-btn-icon {
        transition: opacity 0.25s ease-in-out;
        position: absolute;
        left: 0; right: 0; top: 0; bottom: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .manipulation-widget-btn-icon svg { width: 24px; height: 24px; fill: currentColor; }
      .manipulation-widget-btn-icon.hide {
        opacity: 0 !important;
        pointer-events: none !important;
      }
      .manipulation-widget-btn-icon.show {
        opacity: 1 !important;
        pointer-events: auto !important;
      }
      #manipulationWidgetBtnEye { color: var(--fab-icon-color, rgba(64,64,64,1)); }
      #manipulationWidgetBtnClose { color: var(--fab-icon-color, rgba(64,64,64,1)); font-size: 24px; line-height: 24px; }
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
      #manipulation-widget-tooltip {
        max-width: 350px;
        min-width: 220px;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.18);
        border: 1px solid #e0e0e0;
        padding: 20px;
        font-size: 14px;
        color: #222;
        transition: opacity 0.2s;
        opacity: 0;
        pointer-events: auto;
        font-family: inherit;
        display: none;
        position: relative;
      }
      #manipulation-widget-tooltip.visible {
        display: block !important;
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
    console.log('CSS injection: Complete at', performance.now());
  }
}

// --- Widget Injection ---
function injectWidget() {
  console.log('injectWidget: called at', performance.now());
  if (document.getElementById('manipulation-widget-root')) return; // Prevent double-injection
  
  // Ensure CSS is injected first
  injectCSS();

  // Create root
  const root = document.createElement('div');
  root.id = 'manipulation-widget-root';
  root.style.position = 'fixed';
  root.style.zIndex = '2147483647';
  root.style.bottom = '24px';
  root.style.right = '24px';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.alignItems = 'flex-end';
  root.style.gap = '8px';
  root.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

  // Tooltip (top)
  const tooltip = document.createElement('div');
  tooltip.id = 'manipulation-widget-tooltip';
  tooltip.style.display = 'none';
  tooltip.style.maxWidth = '350px';
  tooltip.style.minWidth = '220px';
  tooltip.style.background = '#fff';
  tooltip.style.borderRadius = '12px';
  tooltip.style.boxShadow = '0 4px 24px rgba(0,0,0,0.18)';
  tooltip.style.border = '1px solid #e0e0e0';
  tooltip.style.padding = '20px';
  tooltip.style.fontSize = '14px';
  tooltip.style.color = '#222';
  tooltip.style.transition = 'opacity 0.2s';
  tooltip.style.opacity = '0';
  tooltip.style.pointerEvents = 'auto';
  tooltip.style.fontFamily = 'inherit';
  tooltip.tabIndex = -1;

  // Widget panel (middle)
  const panel = document.createElement('div');
  panel.className = 'manipulation-widget-panel';
  panel.id = 'manipulationWidgetPanel';
  panel.innerHTML = `
    <div class="manipulation-widget-header">
      Manipulation Identifier
    </div>
    <div class="manipulation-widget-content">
      <div class="analyze-actions" style="display: flex; gap: 8px; width: 100%;">
        <button id="analyzeButton" class="analyze-button" style="flex: 1;">Analyze Current Page</button>
        <button id="redoButton" class="analyze-button" style="flex: 1; display: none;">Re-analyze</button>
      </div>
      <div id="navigationControls" class="navigation-controls" style="display: none; align-items: center; gap: 8px; margin: 10px 0; padding: 8px; background-color: #f8f9fa; border-radius: 6px;">
        <button id="prevInstanceBtn" class="nav-button" style="padding: 4px 8px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer;">←</button>
        <span id="instancePosition" class="instance-position" style="flex: 1; text-align: center; font-size: 12px; color: #666;">Instance 1 of 1</span>
        <button id="nextInstanceBtn" class="nav-button" style="padding: 4px 8px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer;">→</button>
      </div>
      <div id="status" class="status"></div>
    </div>
  `;


  // Floating button (bottom) - Simple, working implementation
  const btn = document.createElement('button');
  btn.className = 'manipulation-widget-btn';
  btn.title = 'Open Manipulation Identifier';
  btn.id = 'manipulationWidgetBtn';
  btn.innerHTML = `
    <span class="manipulation-widget-btn-icon show" id="manipulationWidgetBtnEye">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/>
        <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>
      </svg>
    </span>
    <span class="manipulation-widget-btn-icon hide" id="manipulationWidgetBtnClose">✕</span>
  `;

  // Append in stacking order: tooltip, panel, button
  root.appendChild(tooltip);
  root.appendChild(panel);
  root.appendChild(btn);
  console.log('injectWidget: DOM elements created at', performance.now());
  document.body.appendChild(root);
  console.log('injectWidget: elements added to DOM at', performance.now());

  const btnIcon = root.querySelector('#manipulationWidgetBtnEye');
  const panelOpen = root.querySelector('#manipulationWidgetPanel');
  const analyzeButton = root.querySelector('#analyzeButton');
  const statusDiv = root.querySelector('#status');
  const redoButton = root.querySelector('#redoButton');
  const navigationControls = root.querySelector('#navigationControls');
  const prevInstanceBtn = root.querySelector('#prevInstanceBtn');
  const nextInstanceBtn = root.querySelector('#nextInstanceBtn');
  const instancePosition = root.querySelector('#instancePosition');
  const fab = btn; // alias

  let lastAnalysisResults = null;

  function setStatus(message, type = '') {
    // If switching away from loading, clear interval
    if (type !== 'loading' && loadingInterval) {
      clearInterval(loadingInterval);
      loadingInterval = null;
    }
    if (type === 'loading') {
      loadingBaseMessage = message.replace(/\.*$/, ''); // Remove any trailing dots
      let dotCount = 0;
      statusDiv.innerHTML = `<div class="status-message loading">${loadingBaseMessage}</div>`;
      if (loadingInterval) clearInterval(loadingInterval);
      loadingInterval = setInterval(() => {
        dotCount = (dotCount + 1) % 4;
        const dots = '.'.repeat(dotCount);
        statusDiv.innerHTML = `<div class="status-message loading">${loadingBaseMessage}${dots}</div>`;
      }, 500);
    } else {
      statusDiv.innerHTML = `<div class="status-message${type ? ' ' + type : ''}">${message}</div>`;
    }
  }

  // Navigation functions
  function updateNavigationUI() {
    console.log('updateNavigationUI called: instances =', allInstances.length, 'currentIndex =', currentInstanceIndex);
    
    if (allInstances.length === 0) {
      navigationControls.style.display = 'none';
      return;
    }
    
    navigationControls.style.display = 'flex';
    
    // If no instance is selected yet, default to first one
    if (currentInstanceIndex === -1 && allInstances.length > 0) {
      // Set the index first to avoid recursion
      currentInstanceIndex = 0;
      
      // Activate the first instance manually
      const firstInstance = allInstances[0];
      if (firstInstance) {
        firstInstance.classList.add('active');
        
        // Scroll to it
        firstInstance.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center',
          inline: 'nearest'
        });
        
        // Show tooltip for first instance
        showTooltipForInstance(firstInstance);
      }
    }
    
    instancePosition.textContent = `Instance ${currentInstanceIndex + 1} of ${allInstances.length}`;
    
    // Enable both buttons since we have wrapping navigation
    prevInstanceBtn.disabled = false;
    nextInstanceBtn.disabled = false;
  }

  function navigateToInstance(index) {
    console.log('navigateToInstance called with index:', index);
    
    if (index < 0 || index >= allInstances.length) {
      console.warn('navigateToInstance: Invalid index', index, 'of', allInstances.length);
      return;
    }
    
    const targetInstance = allInstances[index];
    if (!targetInstance) {
      console.error('navigateToInstance: No instance found at index', index);
      return;
    }
    
    // Use unified activation function
    activateInstance(targetInstance, index);
  }

  function navigatePrevious() {
    if (allInstances.length === 0) return;
    
    let newIndex;
    if (currentInstanceIndex > 0) {
      newIndex = currentInstanceIndex - 1;
    } else {
      // Wrap to last instance
      newIndex = allInstances.length - 1;
    }
    navigateToInstance(newIndex);
  }

  function navigateNext() {
    if (allInstances.length === 0) return;
    
    let newIndex;
    if (currentInstanceIndex < allInstances.length - 1) {
      newIndex = currentInstanceIndex + 1;
    } else {
      // Wrap to first instance
      newIndex = 0;
    }
    navigateToInstance(newIndex);
  }

  // activateInstance is now a global function

  function showTooltipForInstance(instance) {
    // This function is now replaced by activateInstance
    // Find the index and use the unified function
    const index = allInstances.indexOf(instance);
    if (index !== -1) {
      activateInstance(instance, index);
    }
  }

  // Compute average luminance behind the button and adapt styles
  function computeAverageLuminance() {
    try {
      const rect = fab.getBoundingClientRect();
      const centerX = Math.max(0, Math.min(window.innerWidth - 1, Math.floor(rect.left + rect.width / 2)));
      const centerY = Math.max(0, Math.min(window.innerHeight - 1, Math.floor(rect.top + rect.height / 2)));
      const sampleSize = 8; // small grid
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = sampleSize;
      canvas.height = sampleSize;

      // Use CSS Paint approximation by drawing the viewport via html2canvas-like APIs is not available,
      // so fall back to computed style of body/documentElement background.
      const bodyBg = window.getComputedStyle(document.body).backgroundColor || '#ffffff';
      const docBg = window.getComputedStyle(document.documentElement).backgroundColor || '#ffffff';
      const bg = bodyBg === 'rgba(0, 0, 0, 0)' ? docBg : bodyBg;

      function parseRgb(color) {
        const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!m) return { r: 255, g: 255, b: 255 };
        return { r: parseInt(m[1], 10), g: parseInt(m[2], 10), b: parseInt(m[3], 10) };
      }
      const { r, g, b } = parseRgb(bg);
      // Relative luminance (sRGB)
      function srgbToLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
      const L = 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
      return L; // 0..1
    } catch (_) {
      return 1; // default bright
    }
  }

  function adjustLightness(color, percent) {
    // Convert rgb(...) to HSL, adjust lightness by +/- percent, return rgba with 0.95 alpha
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    let r = 255, g = 255, b = 255;
    if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    l = Math.max(0, Math.min(1, l + percent));
    function hue2rgb(p, q, t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    }
    let r2, g2, b2;
    if (s === 0) { r2 = g2 = b2 = l; }
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r2 = hue2rgb(p, q, h + 1/3);
      g2 = hue2rgb(p, q, h);
      b2 = hue2rgb(p, q, h - 1/3);
    }
    return `rgba(${Math.round(r2 * 255)}, ${Math.round(g2 * 255)}, ${Math.round(b2 * 255)}, 0.95)`;
  }

  function applyAdaptiveFabStyle() {
    function getBackgroundLuminance() {
      // Get computed background color of body as fallback for simplicity
      const bgColor = getComputedStyle(document.body).backgroundColor;
      const rgb = bgColor.match(/\d+/g);
      if (!rgb || rgb.length < 3) return 1; // assume light if unknown
      const r = parseInt(rgb[0], 10) / 255;
      const g = parseInt(rgb[1], 10) / 255;
      const b = parseInt(rgb[2], 10) / 255;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    const lum = getBackgroundLuminance();
    console.log('applyAdaptiveFabStyle: Background luminance:', lum, 'at', performance.now());
    
    if (lum > 0.5) {
      // light background
      fab.style.backgroundColor = 'rgba(0, 0, 0, 0.15)';
      fab.style.color = '#000';
      fab.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.12)';
      console.log('applyAdaptiveFabStyle: Applied light page style at', performance.now());
    } else {
      // dark background
      fab.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
      fab.style.color = '#fff';
      fab.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.3)';
      console.log('applyAdaptiveFabStyle: Applied dark page style at', performance.now());
    }
    
    // Apply backdrop filter
    fab.style.backdropFilter = 'blur(6px)';
    fab.style.webkitBackdropFilter = 'blur(6px)';
  }

  // Initial apply and on changes - delay initial apply to avoid flash
  setTimeout(() => {
    applyAdaptiveFabStyle();
    const ro = new ResizeObserver(() => applyAdaptiveFabStyle());
    ro.observe(document.documentElement);
    window.addEventListener('scroll', applyAdaptiveFabStyle, { passive: true });
    window.addEventListener('resize', applyAdaptiveFabStyle, { passive: true });
  }, 0);


  function showError(errorMessage) {
    if (loadingInterval) {
      clearInterval(loadingInterval);
      loadingInterval = null;
    }
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

  function hideAllTooltips() {
    // Hide widget tooltip
    const widgetTooltip = document.getElementById('manipulation-widget-tooltip');
    if (widgetTooltip) {
      widgetTooltip.classList.remove('visible');
      widgetTooltip.style.opacity = '0';
      widgetTooltip.innerHTML = '';
    }
    // Remove any inline tooltips
    const inlineTooltips = document.querySelectorAll('.manipulation-tooltip');
    inlineTooltips.forEach(t => t.remove());
    // Reset pressed/active state
    if (openTooltip && openTooltip.highlight) {
      openTooltip.highlight.classList.remove('pressed', 'active');
    }
    openTooltip = null;
  }

  function closeWidget() {
    if (panelOpen.classList.contains('open')) {
      panelOpen.classList.remove('open');
    }
    hideAllTooltips();
    showBtnIcon(false);
  }

  function checkPageState() {
    const highlights = document.querySelectorAll('.manipulation-highlight');
    if (highlights.length > 0 && lastAnalysisResults && lastAnalysisResults.length > 0) {
      analyzeButton.textContent = 'Clear';
      analyzeButton.classList.add('clear');
      analyzeButton.classList.remove('active');
      redoButton.textContent = 'Re-analyze';
      redoButton.style.display = '';
      const instanceCount = allInstances.length;
      setStatus(`Analysis complete. ${lastAnalysisResults.length} manipulation tactic${lastAnalysisResults.length > 1 ? 's' : ''} identified (${instanceCount} instance${instanceCount > 1 ? 's' : ''}).`);
      updateNavigationUI();
    } else {
      analyzeButton.textContent = 'Analyze Current Page';
      analyzeButton.classList.remove('clear');
      analyzeButton.classList.remove('active');
      redoButton.style.display = 'none';
      setStatus('Click "Analyze" to search for manipulative language.');
      lastAnalysisResults = null;
      updateNavigationUI();
    }
  }

  analyzeButton.addEventListener('click', async function() {
    if (analyzeButton.classList.contains('clear')) {
      clearAllHighlights();
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

  // Navigation button event listeners
  prevInstanceBtn.addEventListener('click', navigatePrevious);
  nextInstanceBtn.addEventListener('click', navigateNext);

  // Listen for analysis results
  window.addEventListener('analysisComplete', function(e) {
    if (loadingInterval) {
      clearInterval(loadingInterval);
      loadingInterval = null;
    }
    analyzeButton.disabled = false;
    redoButton.disabled = false;
    lastAnalysisResults = e.detail && e.detail.results ? e.detail.results : [];
    if (lastAnalysisResults.length > 0) {
      analyzeButton.textContent = 'Clear';
      analyzeButton.classList.add('clear');
      analyzeButton.classList.remove('active');
      redoButton.textContent = 'Re-analyze';
      redoButton.style.display = '';
      const instanceCount = allInstances.length;
      setStatus(`Analysis complete. ${lastAnalysisResults.length} manipulation tactic${lastAnalysisResults.length > 1 ? 's' : ''} identified (${instanceCount} instance${instanceCount > 1 ? 's' : ''}).`);
      updateNavigationUI();
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

  // Listen for instances ready event
  window.addEventListener('instancesReady', function(e) {
    console.log('instancesReady event: instances =', e.detail.count);
    // Update status with correct instance count
    if (lastAnalysisResults && lastAnalysisResults.length > 0) {
      const instanceCount = allInstances.length;
      setStatus(`Analysis complete. ${lastAnalysisResults.length} manipulation tactic${lastAnalysisResults.length > 1 ? 's' : ''} identified (${instanceCount} instance${instanceCount > 1 ? 's' : ''}).`);
      updateNavigationUI();
    }
  });

  // Update status on open/close and toggle icon
  btn.addEventListener('click', () => {
    const willOpen = !panelOpen.classList.contains('open');
    if (willOpen) {
      panelOpen.classList.add('open');
      btn.classList.add('spin');
      btn.addEventListener('animationend', () => btn.classList.remove('spin'), { once: true });
      showBtnIcon(true);
      checkPageState();
    } else {
      btn.classList.add('spin');
      btn.addEventListener('animationend', () => btn.classList.remove('spin'), { once: true });
      closeWidget();
    }
  });

  function showBtnIcon(isClose) {
    const eyeIcon = btn.querySelector('#manipulationWidgetBtnEye');
    const closeIcon = btn.querySelector('#manipulationWidgetBtnClose');
    
    if (isClose) {
      eyeIcon.classList.remove('show');
      eyeIcon.classList.add('hide');
      requestAnimationFrame(() => {
        closeIcon.classList.remove('hide');
        closeIcon.classList.add('show');
      });
    } else {
      closeIcon.classList.remove('show');
      closeIcon.classList.add('hide');
      requestAnimationFrame(() => {
        eyeIcon.classList.remove('hide');
        eyeIcon.classList.add('show');
      });
    }
  }

  // After creating the tooltip in injectWidget, add a MutationObserver for debugging
  if (tooltip && !tooltip._observerAttached) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        if (mutation.attributeName === 'class' || mutation.attributeName === 'style') {
          console.log('Tooltip mutation:', tooltip.className, tooltip.style.display, tooltip.style.opacity);
        }
      });
    });
    observer.observe(tooltip, { attributes: true });
    tooltip._observerAttached = true;
  }
}

// Inject the widget on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectWidget);
} else {
  injectWidget();
}

// UNIFIED NAVIGATION FUNCTION - handles all instance activation
function activateInstance(highlight, index) {
  console.log('activateInstance called:', { highlight, index, allInstancesLength: allInstances.length });
  
  // Validate inputs
  if (!highlight || typeof index !== 'number') {
    console.error('activateInstance: Invalid parameters', { highlight, index });
    return false;
  }
  
  // Clear any existing active states
  allInstances.forEach(inst => {
    if (inst !== highlight) {
      inst.classList.remove('active', 'pressed');
    }
  });
  
  // Close any existing tooltip
  closeOpenTooltip();
  
  // Update current index
  currentInstanceIndex = index;
  
  // Activate the target instance
  highlight.classList.add('active');
  openTooltip = { highlight };
  
  // Get instance data
  const instanceData = highlight.instanceData;
  if (!instanceData) {
    console.warn('activateInstance: No instanceData found on highlight');
    return false;
  }
  
  // Show tooltip
  const tooltip = document.getElementById('manipulation-widget-tooltip');
  if (tooltip) {
    tooltip.innerHTML = `
      <div style="font-weight:bold;font-size:16px;margin-bottom:8px;">Tactic: ${instanceData.tactic}</div>
      <div style="margin-bottom:8px;color:#555;">Definition: ${instanceData.definition}</div>
      <div style="color:#888;font-style:italic;">Why this is an example: ${instanceData.explanation}</div>
      <button id="manipulation-tooltip-close" style="position:absolute;top:8px;right:12px;background:none;border:none;color:#bbb;font-size:18px;cursor:pointer;z-index:2;">&times;</button>
    `;
    tooltip.classList.add('visible');
    setTimeout(() => { tooltip.style.opacity = '1'; }, 10);
    
    // Add close button listener
    const closeBtn = tooltip.querySelector('#manipulation-tooltip-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeOpenTooltip();
      });
    }
  }
  
  // Scroll to instance
  highlight.scrollIntoView({ 
    behavior: 'smooth', 
    block: 'center',
    inline: 'nearest'
  });
  
  // Update navigation UI if widget exists
  const instancePosition = document.querySelector('#instancePosition');
  if (instancePosition && allInstances.length > 0) {
    instancePosition.textContent = `Instance ${index + 1} of ${allInstances.length}`;
  }
  
  // Update navigation button states if they exist
  const prevBtn = document.querySelector('#prevInstanceBtn');
  const nextBtn = document.querySelector('#nextInstanceBtn');
  if (prevBtn && nextBtn) {
    prevBtn.disabled = false;
    nextBtn.disabled = false;
  }
  
  console.log('activateInstance: Successfully activated instance', index);
  return true;
}

// Tooltip persistence fix: add a short delay before document click handler can close it
function handleHighlightClick(e, highlight, match) {
  console.log('=== MANUAL CLICK START ===');
  console.log('Clicked highlight:', highlight);
  console.log('allInstances.length:', allInstances.length);
  
  // Prevent default and stop propagation
  if (e.stopPropagation) e.stopPropagation();
  if (e.preventDefault) e.preventDefault();
  
  // Strategy 1: Direct indexOf lookup
  let clickedIndex = allInstances.indexOf(highlight);
  console.log('Strategy 1 (indexOf):', clickedIndex);
  
  // Strategy 2: If indexOf fails, search by text content match
  if (clickedIndex === -1) {
    for (let i = 0; i < allInstances.length; i++) {
      if (allInstances[i].textContent === highlight.textContent && 
          allInstances[i].className === highlight.className) {
        clickedIndex = i;
        console.log('Strategy 2 (textContent + className match):', i);
        break;
      }
    }
  }
  
  // Strategy 3: If still not found, search by instanceData match
  if (clickedIndex === -1 && highlight.instanceData) {
    for (let i = 0; i < allInstances.length; i++) {
      const inst = allInstances[i];
      if (inst.instanceData && 
          inst.instanceData.text === highlight.instanceData.text &&
          inst.instanceData.tactic === highlight.instanceData.tactic) {
        clickedIndex = i;
        console.log('Strategy 3 (instanceData match):', i);
        break;
      }
    }
  }
  
  // Strategy 4: If found, use unified navigation
  if (clickedIndex !== -1) {
    console.log('SUCCESS: Using unified navigation for index', clickedIndex);
    const success = activateInstance(highlight, clickedIndex);
    if (success) {
      console.log('=== MANUAL CLICK SUCCESS ===');
      return;
    }
  }
  
  // Strategy 5: Fallback - direct activation without navigation sync
  console.warn('FALLBACK: Direct activation without navigation sync');
  
  // Prevent reopening same tooltip
  if (openTooltip && openTooltip.highlight === highlight) {
    console.log('Already open, ignoring click');
    return;
  }
  
  // Use fallback activation
  closeOpenTooltip();
  highlight.classList.add('active');
  openTooltip = { highlight };
  
  // Get instance data from highlight or match parameter
  const instanceData = highlight.instanceData || match;
  if (!instanceData) {
    console.error('No instance data available for fallback');
    return;
  }
  
  // Show tooltip
  const tooltip = document.getElementById('manipulation-widget-tooltip');
  if (tooltip) {
    tooltip.innerHTML = `
      <div style="font-weight:bold;font-size:16px;margin-bottom:8px;">Tactic: ${instanceData.tactic}</div>
      <div style="margin-bottom:8px;color:#555;">Definition: ${instanceData.definition}</div>
      <div style="color:#888;font-style:italic;">Why this is an example: ${instanceData.explanation}</div>
      <button id="manipulation-tooltip-close" style="position:absolute;top:8px;right:12px;background:none;border:none;color:#bbb;font-size:18px;cursor:pointer;z-index:2;">&times;</button>
    `;
    tooltip.classList.add('visible');
    setTimeout(() => { tooltip.style.opacity = '1'; }, 10);
    
    const closeBtn = tooltip.querySelector('#manipulation-tooltip-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeOpenTooltip();
      });
    }
  }
  
  // Scroll to highlight
  highlight.scrollIntoView({ 
    behavior: 'smooth', 
    block: 'center',
    inline: 'nearest'
  });
  
  console.log('=== MANUAL CLICK FALLBACK COMPLETE ===');
}

function closeOpenTooltip() {
  console.log('closeOpenTooltip: start', { openTooltip });
  if (openTooltip && openTooltip.highlight) {
    openTooltip.highlight.classList.remove('pressed', 'active');
  }
  openTooltip = null;
  const tooltip = document.getElementById('manipulation-widget-tooltip');
  if (tooltip) {
    tooltip.classList.remove('visible');
    tooltip.style.opacity = '0';
  }
  console.log('closeOpenTooltip: end');
}

function handleEscapeKey(e) {
  if (e.key === 'Escape') {
    closeOpenTooltip();
  }
}

document.addEventListener('keydown', handleEscapeKey, true);

