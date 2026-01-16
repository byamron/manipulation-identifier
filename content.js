let tactics = [];
let isProcessing = false;
let debounceTimeout = null;
let currentHighlights = null;
let openTooltip = null;
let loadingInterval = null;
let loadingBaseMessage = '';
let allInstances = [];
let currentInstanceIndex = -1;
let selectedModel = 'gpt-5-nano'; // Default model
let currentSessionId = null;
let currentAnalysisResult = null;

// Add global flag for robust tooltip persistence
let ignoreNextDocumentClick = false;

// Generate session ID
function generateSessionId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

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
  currentAnalysisResult = null;
}

// Enhanced highlighting function with feedback support
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
        cursor: pointer !important;
      }
      .manipulation-highlight:hover {
        background-color: #ffe082 !important;
        border: 1px solid #ffd54f !important;
      }
      .manipulation-highlight.pressed, .manipulation-highlight.active {
        background-color: #ffd54f !important;
        border: 1px solid #ffca28 !important;
      }
      .manipulation-highlight.feedback-mode {
        outline: 2px solid #1a73e8 !important;
        outline-offset: 1px !important;
      }
    `;
    document.head.appendChild(style);
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
      
      matches.forEach((match, matchIndex) => {
        if (match.index > lastIndex) {
          wrapper.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }
        
        const highlight = document.createElement('span');
        highlight.className = 'manipulation-highlight';
        highlight.textContent = match.text;
        highlight.tabIndex = 0;
        highlight.setAttribute('role', 'button');
        highlight.setAttribute('aria-label', `Show manipulation tactic details for: ${match.text}`);
        highlight.dataset.highlightId = `highlight-${Date.now()}-${matchIndex}`;
        
        // Store instance data for navigation AND feedback
        highlight.instanceData = {
          tactic: match.tactic,
          definition: match.definition,
          explanation: match.explanation,
          text: match.text,
          highlightId: highlight.dataset.highlightId
        };

        // Enhanced click handler with feedback support
        highlight.addEventListener('click', function(e) {
          e.stopPropagation();
          e.preventDefault();
          
          // Check if in feedback mode
          if (this.classList.contains('feedback-mode')) {
            showFeedbackModal(this);
            return;
          }
          
          // Normal click handling
          handleHighlightClick(e, this, match);
        });

        highlight.addEventListener('touchstart', (e) => {
          console.log('Touch detected on highlight:', highlight.textContent);
          handleHighlightClick(e, highlight, match);
        });

        // Hover/pressed state for mouse/touch
        highlight.addEventListener('mousedown', () => highlight.classList.add('pressed'));
        highlight.addEventListener('mouseup', () => highlight.classList.remove('pressed'));
        highlight.addEventListener('mouseleave', () => highlight.classList.remove('pressed'));
        
        wrapper.appendChild(highlight);
        
        // Add to allInstances array
        if (!allInstances.includes(highlight)) {
          allInstances.push(highlight);
        }
        
        lastIndex = match.index + match.length;
      });

      if (lastIndex < text.length) {
        wrapper.appendChild(document.createTextNode(text.substring(lastIndex)));
      }

      parent.replaceChild(wrapper, node);
    }
  });

  // Rebuild allInstances array from actual DOM
  setTimeout(() => {
    allInstances = Array.from(document.querySelectorAll('.manipulation-highlight'));
    
    // Sort all instances in document order for navigation
    allInstances.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    
    // Trigger UI update with correct count
    window.dispatchEvent(new CustomEvent('instancesReady', { detail: { count: allInstances.length } }));
  }, 50);
  
  currentInstanceIndex = -1;
  currentHighlights = detectedTactics;
}

// Enhanced analysis function with model selection
async function analyzeTextWithLLM(text, model = selectedModel) {
  if (isProcessing) return;
  isProcessing = true;

  try {
    // Generate new session ID for this analysis
    currentSessionId = generateSessionId();
    
    // Get server URL from storage (default to localhost)
    const serverUrl = await new Promise(resolve => {
      chrome.storage.local.get(['serverUrl'], (result) => {
        resolve(result.serverUrl || 'http://localhost:3000');
      });
    });
    const endpoint = serverUrl.replace(/\/$/, '') + '/analyze-content-with-model';

    const startTime = Date.now();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        content: text,
        model: model,
        sessionId: currentSessionId,
        pageUrl: window.location.href
      })
    });
    
    if (!response.ok) throw new Error('Server error: ' + response.status);
    const data = await response.json();

    if (!data?.manipulativeLanguage) {
      throw new Error('Invalid response from analysis');
    }

    const resultText = data.manipulativeLanguage;
    console.log(`Analysis result from ${model}:`, resultText);

    // Store current analysis result for feedback
    currentAnalysisResult = {
      model: data.model || model,
      sessionId: data.sessionId || currentSessionId,
      originalText: text,
      responseTime: Date.now() - startTime,
      results: data.results || [],
      llmResponse: resultText
    };

    // Check if no manipulation was detected
    if (resultText.trim() === "No manipulation tactics detected.") {
      window.dispatchEvent(new CustomEvent('analysisComplete', { 
        detail: { 
          results: [], 
          llmResponse: resultText,
          model: data.model || model,
          sessionId: data.sessionId || currentSessionId
        } 
      }));
      return;
    }

    // Use the pre-parsed results from the server
    let detectedTactics = data.results || [];

    // Trigger analysisComplete event for the widget
    window.dispatchEvent(new CustomEvent('analysisComplete', { 
      detail: { 
        results: detectedTactics, 
        llmResponse: resultText,
        model: data.model || model,
        sessionId: data.sessionId || currentSessionId
      } 
    }));

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
const runAnalysis = debounceAnalysis(async (model = selectedModel) => {
  console.log(`Running content analysis with ${model}`);
  
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

  await analyzeTextWithLLM(combinedText, model);
});

// Feedback functions
function showFeedbackModal(highlight) {
  const instanceData = highlight.instanceData;
  if (!instanceData) {
    console.error('No instance data for feedback');
    return;
  }

  // Create feedback modal
  const modal = createFeedbackModal(highlight, instanceData);
  document.body.appendChild(modal);
  
  // Position modal
  positionModal(modal, highlight);
  
  // Show modal
  setTimeout(() => {
    modal.classList.add('visible');
  }, 10);
}

function createFeedbackModal(highlight, instanceData) {
  const modal = document.createElement('div');
  modal.className = 'feedback-modal';
  modal.innerHTML = `
    <div class="feedback-modal-content">
      <div class="feedback-header">
        <h3>Feedback for Detection</h3>
        <button class="feedback-close">&times;</button>
      </div>
      <div class="feedback-body">
        <div class="feedback-analysis-info">
          <p><strong>Analysis by:</strong> ${currentAnalysisResult?.model || selectedModel}</p>
          <div class="highlighted-text">"${instanceData.text}"</div>
          <p><strong>Detected as:</strong> ${instanceData.tactic}</p>
        </div>
        
        <div class="feedback-rating">
          <p><strong>This detection is:</strong></p>
          <div class="rating-options">
            <label><input type="radio" name="rating" value="accurate"> Accurate</label>
            <label><input type="radio" name="rating" value="inaccurate"> Inaccurate</label>
            <label><input type="radio" name="rating" value="uncertain"> Uncertain</label>
          </div>
        </div>
        
        <div class="feedback-comments">
          <label for="comments"><strong>Comments (optional):</strong></label>
          <textarea id="comments" rows="3" placeholder="Your feedback about this detection..."></textarea>
        </div>
        
        <div class="feedback-actions">
          <button class="btn-submit">Submit Feedback</button>
          <button class="btn-cancel">Cancel</button>
          <button class="btn-report-missing">Report Missing Manipulation 🔍</button>
        </div>
      </div>
    </div>
  `;

  // Add event listeners
  const closeBtn = modal.querySelector('.feedback-close');
  const cancelBtn = modal.querySelector('.btn-cancel');
  const submitBtn = modal.querySelector('.btn-submit');
  const reportBtn = modal.querySelector('.btn-report-missing');

  const closeModal = () => {
    modal.classList.remove('visible');
    setTimeout(() => {
      if (modal.parentNode) {
        modal.parentNode.removeChild(modal);
      }
      highlight.classList.remove('feedback-mode');
    }, 200);
  };

  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  
  submitBtn.addEventListener('click', () => {
    submitInstanceFeedback(modal, highlight, instanceData, closeModal);
  });
  
  reportBtn.addEventListener('click', () => {
    closeModal();
    showMissingManipulationModal();
  });

  return modal;
}

function positionModal(modal, highlight) {
  // Always center the modal in the viewport for better accessibility
  // Remove any inline positioning to use the CSS flexbox centering
  modal.style.position = '';
  modal.style.left = '';
  modal.style.top = '';
  
  // Ensure modal is properly visible
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
}

async function submitInstanceFeedback(modal, highlight, instanceData, closeCallback) {
  const rating = modal.querySelector('input[name="rating"]:checked')?.value;
  const comments = modal.querySelector('#comments').value.trim();
  
  if (!rating) {
    alert('Please select a rating for this detection.');
    return;
  }

  try {
    const serverUrl = await new Promise(resolve => {
      chrome.storage.local.get(['serverUrl'], (result) => {
        resolve(result.serverUrl || 'http://localhost:3000');
      });
    });

    const response = await fetch(`${serverUrl.replace(/\/$/, '')}/submit-instance-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalFullText: currentAnalysisResult?.originalText || '',
        highlightedText: instanceData.text,
        detectedTactic: instanceData.tactic,
        modelUsed: currentAnalysisResult?.model || selectedModel,
        userRating: rating,
        userComments: comments,
        pageUrl: window.location.href,
        responseTime: currentAnalysisResult?.responseTime || 0,
        sessionId: currentAnalysisResult?.sessionId || currentSessionId
      })
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const result = await response.json();
    console.log('Feedback submitted successfully:', result);
    
    // Show success message
    showFeedbackSuccess();
    closeCallback();
    
  } catch (error) {
    console.error('Error submitting feedback:', error);
    alert('Failed to submit feedback. Please try again.');
  }
}

function showMissingManipulationModal() {
  const modal = document.createElement('div');
  modal.className = 'feedback-modal';
  modal.innerHTML = `
    <div class="feedback-modal-content">
      <div class="feedback-header">
        <h3>Report Missing Manipulation</h3>
        <button class="feedback-close">&times;</button>
      </div>
      <div class="feedback-body">
        <div class="feedback-missing">
          <label for="missed-text"><strong>Enter text that should have been detected:</strong></label>
          <textarea id="missed-text" rows="3" placeholder="Paste or type the text that contains manipulation..."></textarea>
        </div>
        
        <div class="feedback-tactic">
          <label for="suggested-tactic"><strong>Suggested tactic:</strong></label>
          <select id="suggested-tactic">
            <option value="">Select a manipulation tactic</option>
            <option value="Ad Hominem">Ad Hominem</option>
            <option value="Emotional Language">Emotional Language</option>
            <option value="False Dichotomy">False Dichotomy</option>
            <option value="Cherry Picking">Cherry Picking</option>
            <option value="Fake Experts">Fake Experts</option>
            <option value="Red Herring">Red Herring</option>
            <option value="Scapegoating">Scapegoating</option>
            <option value="Polarization">Polarization</option>
            <option value="Impersonation">Impersonation</option>
            <option value="Slippery Slope">Slippery Slope</option>
            <option value="Decontextualization">Decontextualization</option>
          </select>
        </div>
        
        <div class="feedback-comments">
          <label for="missing-comments"><strong>Comments:</strong></label>
          <textarea id="missing-comments" rows="3" placeholder="Why should this be detected as the selected tactic?"></textarea>
        </div>
        
        <div class="feedback-actions">
          <button class="btn-submit">Submit Report</button>
          <button class="btn-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  
  // Position modal properly (center in viewport)
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  
  setTimeout(() => modal.classList.add('visible'), 10);

  // Add event listeners
  const closeBtn = modal.querySelector('.feedback-close');
  const cancelBtn = modal.querySelector('.btn-cancel');
  const submitBtn = modal.querySelector('.btn-submit');

  const closeModal = () => {
    modal.classList.remove('visible');
    setTimeout(() => {
      if (modal.parentNode) {
        modal.parentNode.removeChild(modal);
      }
    }, 200);
  };

  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  
  submitBtn.addEventListener('click', () => {
    submitMissingManipulation(modal, closeModal);
  });
}

async function submitMissingManipulation(modal, closeCallback) {
  const missedText = modal.querySelector('#missed-text').value.trim();
  const suggestedTactic = modal.querySelector('#suggested-tactic').value;
  const comments = modal.querySelector('#missing-comments').value.trim();
  
  if (!missedText) {
    alert('Please enter the text that should have been detected.');
    return;
  }
  
  if (!suggestedTactic) {
    alert('Please select a suggested tactic.');
    return;
  }

  try {
    const serverUrl = await new Promise(resolve => {
      chrome.storage.local.get(['serverUrl'], (result) => {
        resolve(result.serverUrl || 'http://localhost:3000');
      });
    });

    const response = await fetch(`${serverUrl.replace(/\/$/, '')}/report-missing-manipulation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalFullText: currentAnalysisResult?.originalText || '',
        missedText: missedText,
        suggestedTactic: suggestedTactic,
        userComments: comments,
        modelUsed: currentAnalysisResult?.model || selectedModel,
        pageUrl: window.location.href,
        sessionId: currentAnalysisResult?.sessionId || currentSessionId
      })
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const result = await response.json();
    console.log('Missing manipulation report submitted:', result);
    
    showFeedbackSuccess('Report submitted successfully!');
    closeCallback();
    
  } catch (error) {
    console.error('Error submitting missing manipulation report:', error);
    alert('Failed to submit report. Please try again.');
  }
}

function showFeedbackSuccess(message = 'Feedback submitted successfully!') {
  const toast = document.createElement('div');
  toast.className = 'feedback-toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #4caf50;
    color: white;
    padding: 12px 20px;
    border-radius: 6px;
    z-index: 10000;
    font-family: system-ui, sans-serif;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    transform: translateX(100%);
    transition: transform 0.3s ease;
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.transform = 'translateX(0)';
  }, 10);
  
  setTimeout(() => {
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 3000);
}

// Enable feedback mode
function enableFeedbackMode() {
  allInstances.forEach(highlight => {
    highlight.classList.add('feedback-mode');
  });
}

// Disable feedback mode
function disableFeedbackMode() {
  allInstances.forEach(highlight => {
    highlight.classList.remove('feedback-mode');
  });
}

// Message listener
chrome.runtime.onMessage?.addListener((message, sender, sendResponse) => {
  if (message.action === "analyze") {
    // Execute runAnalysis with specified model
    (async () => {
      try {
        const model = message.model || selectedModel;
        await runAnalysis(model);
        sendResponse({ status: "Analysis started", model: model });
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
  currentSessionId = generateSessionId();
  console.log('Enhanced content script initialized');
})();

// [REST OF THE EXISTING CONTENT.JS CODE - injectCSS, injectWidget, etc.]
// I'll include the essential parts but keep the same widget functionality

// Inject enhanced widget CSS
function injectCSS() {
  if (!document.getElementById('manipulation-widget-style')) {
    const style = document.createElement('style');
    style.id = 'manipulation-widget-style';
    style.textContent = `
      /* CSS Variables for Theme Support */
      :root {
        --widget-bg: #ffffff;
        --widget-text: #333333;
        --widget-border: #e0e0e0;
        --widget-shadow: rgba(0,0,0,0.18);
        --dropdown-bg: #ffffff;
        --dropdown-border: #ddd;
        --dropdown-item-hover: #f0f0f0;
        --modal-bg: #ffffff;
        --modal-overlay: rgba(0,0,0,0.5);
        --button-primary: #1a73e8;
        --button-primary-hover: #185abc;
        --highlight-bg: #fff3cd;
        --input-bg: #ffffff;
        --input-border: #ddd;
        --text-secondary: #666666;
      }

      /* Dark mode overrides */
      @media (prefers-color-scheme: dark) {
        :root {
          --widget-bg: #2d2d2d;
          --widget-text: #ffffff;
          --widget-border: #404040;
          --widget-shadow: rgba(0,0,0,0.4);
          --dropdown-bg: #2d2d2d;
          --dropdown-border: #404040;
          --dropdown-item-hover: #3d3d3d;
          --modal-bg: #2d2d2d;
          --modal-overlay: rgba(0,0,0,0.8);
          --highlight-bg: #4a3728;
          --input-bg: #1a1a1a;
          --input-border: #404040;
          --text-secondary: #cccccc;
        }
      }

      /* Auto-detect page background and adjust accordingly */
      .dark-page {
        --widget-bg: #2d2d2d;
        --widget-text: #ffffff;
        --widget-border: #404040;
        --widget-shadow: rgba(0,0,0,0.4);
        --dropdown-bg: #2d2d2d;
        --dropdown-border: #404040;
        --dropdown-item-hover: #3d3d3d;
        --modal-bg: #2d2d2d;
        --modal-overlay: rgba(0,0,0,0.8);
        --highlight-bg: #4a3728;
        --input-bg: #1a1a1a;
        --input-border: #404040;
        --text-secondary: #cccccc;
      }

      /* Existing widget styles with theme support */
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
      
      /* Model dropdown styles */
      .model-dropdown {
        position: relative;
        width: 100%;
        margin-bottom: 8px;
      }
      
      .dropdown-button {
        width: 100%;
        padding: 8px 12px;
        background: var(--input-bg);
        border: 1px solid var(--dropdown-border);
        border-radius: 6px;
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 14px;
        color: var(--widget-text);
        transition: all 0.2s ease;
      }

      .dropdown-button:hover {
        border-color: var(--button-primary);
      }
      
      .dropdown-menu {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: var(--dropdown-bg);
        border: 1px solid var(--dropdown-border);
        border-radius: 6px;
        box-shadow: 0 4px 12px var(--widget-shadow);
        z-index: 1000;
        display: none;
      }
      
      .dropdown-menu.open {
        display: block;
      }
      
      .dropdown-item {
        padding: 8px 12px;
        cursor: pointer;
        border-bottom: 1px solid var(--dropdown-border);
        font-size: 14px;
        color: var(--widget-text);
        transition: background-color 0.2s ease;
      }
      
      .dropdown-item:last-child {
        border-bottom: none;
      }
      
      .dropdown-item:hover {
        background: var(--dropdown-item-hover);
      }
      
      .dropdown-item.selected {
        background: var(--button-primary);
        color: white;
        font-weight: bold;
      }
      
      /* Enhanced analyze button styles */
      .analyze-button-group {
        display: flex;
        width: 100%;
        gap: 8px;
      }
      
      .analyze-button {
        background-color: #1a73e8;
        color: white;
        border: none;
        border-radius: 6px;
        padding: 12px 16px;
        font-size: 16px;
        cursor: pointer;
        flex: 1;
        min-height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s;
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
      
      /* Feedback button styles */
      .feedback-button {
        position: fixed;
        bottom: 100px;
        right: 24px;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: #4caf50;
        color: white;
        border: none;
        font-size: 20px;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 2147483646;
        transition: all 0.2s;
      }
      
      .feedback-button:hover {
        background: #45a049;
        transform: scale(1.1);
      }
      
      .feedback-button.visible {
        display: flex;
      }
      
      /* Feedback modal styles */
      .feedback-modal {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        background: var(--modal-overlay);
        z-index: 10000;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        opacity: 0;
        transition: opacity 0.3s ease;
        padding: 20px;
        box-sizing: border-box;
      }
      
      .feedback-modal.visible {
        opacity: 1;
      }
      
      .feedback-modal-content {
        background: var(--modal-bg);
        color: var(--widget-text);
        border-radius: 12px;
        box-shadow: 0 8px 32px var(--widget-shadow);
        max-width: 400px;
        width: 100%;
        max-height: 80vh;
        overflow-y: auto;
        position: relative;
        border: 1px solid var(--widget-border);
        margin: 0 auto;
        transform: scale(0.9);
        transition: transform 0.3s ease;
      }

      .feedback-modal.visible .feedback-modal-content {
        transform: scale(1);
      }
      
      .feedback-header {
        padding: 16px 20px;
        border-bottom: 1px solid var(--widget-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .feedback-header h3 {
        margin: 0;
        font-size: 18px;
        color: var(--widget-text);
      }
      
      .feedback-close {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: var(--text-secondary);
        padding: 0;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.2s ease;
      }

      .feedback-close:hover {
        color: var(--widget-text);
      }
      
      .feedback-body {
        padding: 20px;
      }
      
      .feedback-analysis-info {
        margin-bottom: 16px;
        padding: 12px;
        background: var(--input-bg);
        border: 1px solid var(--widget-border);
        border-radius: 6px;
      }
      
      .highlighted-text {
        background: var(--highlight-bg);
        padding: 8px;
        border-radius: 4px;
        margin: 8px 0;
        font-style: italic;
        color: var(--widget-text);
      }
      
      .feedback-rating {
        margin-bottom: 16px;
      }
      
      .rating-options {
        display: flex;
        gap: 12px;
        margin-top: 8px;
      }
      
      .rating-options label {
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
      }
      
      .feedback-comments {
        margin-bottom: 16px;
      }
      
      .feedback-comments label {
        display: block;
        margin-bottom: 4px;
      }
      
      .feedback-comments textarea {
        width: 100%;
        padding: 8px;
        border: 1px solid var(--input-border);
        border-radius: 4px;
        resize: vertical;
        font-family: inherit;
        background: var(--input-bg);
        color: var(--widget-text);
        box-sizing: border-box;
      }

      .feedback-comments textarea:focus {
        outline: none;
        border-color: var(--button-primary);
      }
      
      .feedback-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      
      .feedback-actions button {
        padding: 10px 16px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        transition: background-color 0.2s;
      }
      
      .btn-submit {
        background: #1a73e8;
        color: white;
      }
      
      .btn-submit:hover {
        background: #185abc;
      }
      
      .btn-cancel {
        background: var(--input-bg);
        color: var(--widget-text);
        border: 1px solid var(--widget-border);
      }
      
      .btn-cancel:hover {
        background: var(--dropdown-item-hover);
      }
      
      .btn-report-missing {
        background: #ff9800;
        color: white;
        flex: 1;
        min-width: 100%;
        margin-top: 8px;
      }
      
      .btn-report-missing:hover {
        background: #f57c00;
      }
      
      /* Enhanced highlight styles for feedback mode */
      .manipulation-highlight.feedback-mode {
        outline: 2px solid #1a73e8 !important;
        outline-offset: 1px !important;
      }

      /* Active highlight styles for navigation */
      .manipulation-highlight.active {
        background: #ffeb3b !important;
        outline: 2px solid #ff5722 !important;
        outline-offset: 1px !important;
        transition: all 0.3s ease;
      }

      .manipulation-highlight {
        transition: all 0.2s ease;
        cursor: pointer;
      }

      .manipulation-highlight:hover {
        opacity: 0.8;
      }

      /* Navigation controls styles */
      .navigation-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin: 12px 0;
        padding: 8px;
        background: var(--input-bg);
        border-radius: 6px;
        border: 1px solid var(--widget-border);
      }

      .nav-button {
        background: var(--button-primary);
        color: white;
        border: none;
        border-radius: 4px;
        padding: 6px 12px;
        cursor: pointer;
        font-size: 14px;
        transition: background-color 0.2s ease;
        min-width: 40px;
      }

      .nav-button:hover:not(:disabled) {
        background: var(--button-primary-hover);
      }

      .nav-button:disabled {
        background: var(--text-secondary);
        cursor: not-allowed;
        opacity: 0.5;
      }

      .instance-position {
        color: var(--widget-text);
        font-size: 14px;
        font-weight: 500;
        flex: 1;
        text-align: center;
      }

      /* Tooltip positioning improvements */
      .tooltip {
        position: absolute;
        z-index: 1000000;
        max-width: 300px;
        padding: 12px;
        background: var(--modal-bg);
        color: var(--widget-text);
        border: 1px solid var(--widget-border);
        border-radius: 8px;
        box-shadow: 0 4px 12px var(--widget-shadow);
        font-size: 14px;
        line-height: 1.4;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .tooltip.visible {
        opacity: 1;
        pointer-events: auto;
      }

      .tooltip::before {
        content: '';
        position: absolute;
        top: -6px;
        left: 50%;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-bottom: 6px solid var(--modal-bg);
      }
      
      /* Rest of existing widget styles... */
      .manipulation-widget-btn {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: var(--fab-bg, rgba(255,255,255,0.5));
        color: var(--fab-icon-color, rgba(0,0,0,0.8));
        border: 1px solid rgba(0,0,0,0.12);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        overflow: hidden;
        box-shadow: 0 4px 4px rgba(0,0,0,0.15);
        font-size: 32px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 200ms ease;
        will-change: transform;
        position: relative;
      }
      
      .manipulation-widget-panel {
        display: flex;
        width: 350px;
        max-height: 500px;
        background: var(--widget-bg);
        border-radius: 12px;
        box-shadow: 0 4px 24px var(--widget-shadow);
        border: 1px solid var(--widget-border);
        overflow: hidden;
        flex-direction: column;
        opacity: 0;
        transform: scale(0.7);
        pointer-events: none;
        transition: opacity 0.5s cubic-bezier(0.4,0,0.2,1), transform 0.5s cubic-bezier(0.4,0,0.2,1);
        transform-origin: 100% 100%;
        position: relative;
        color: var(--widget-text);
      }
      
      .manipulation-widget-panel.open {
        opacity: 1;
        transform: scale(1);
        pointer-events: auto;
      }
      
      /* Continue with existing styles... */
    `;
    document.head.appendChild(style);
  }
  
  // Initialize theme detection
  detectAndApplyTheme();
}

// Function to detect page background and apply appropriate theme
function detectAndApplyTheme() {
  const root = document.documentElement;
  
  // Check for explicit dark mode preference
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  // Get body background color
  const bodyStyles = window.getComputedStyle(document.body);
  const bodyBg = bodyStyles.backgroundColor;
  
  // Parse RGB values to determine if background is dark
  let isDarkPage = prefersDark;
  
  if (bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent') {
    const rgb = bodyBg.match(/\d+/g);
    if (rgb && rgb.length >= 3) {
      const [r, g, b] = rgb.map(Number);
      // Calculate relative luminance
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      isDarkPage = luminance < 0.5;
    }
  }
  
  // Apply dark theme class if needed
  if (isDarkPage) {
    root.classList.add('dark-page');
  } else {
    root.classList.remove('dark-page');
  }
  
  // Listen for theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (e.matches) {
      root.classList.add('dark-page');
    } else {
      root.classList.remove('dark-page');
    }
  });
}

// Enhanced widget injection with model dropdown and feedback
function injectWidget() {
  if (document.getElementById('manipulation-widget-root')) return;
  
  injectCSS();

  const root = document.createElement('div');
  root.id = 'manipulation-widget-root';
  
  // Enhanced widget panel with model dropdown
  const panel = document.createElement('div');
  panel.className = 'manipulation-widget-panel';
  panel.id = 'manipulationWidgetPanel';
  panel.innerHTML = `
    <div class="manipulation-widget-header" style="background: #1a73e8; color: #fff; padding: 12px 16px; font-size: 16px; font-weight: bold;">
      Manipulation Identifier
    </div>
    <div class="manipulation-widget-content" style="padding: 16px; flex: 1; overflow-y: auto;">
      <div class="model-dropdown">
        <div class="dropdown-button" id="modelDropdownButton">
          <span id="selectedModelText">GPT-5-nano</span>
          <span>▼</span>
        </div>
        <div class="dropdown-menu" id="modelDropdownMenu">
          <div class="dropdown-item" data-model="gpt-5">GPT-5</div>
          <div class="dropdown-item selected" data-model="gpt-5-nano">GPT-5-nano</div>
          <div class="dropdown-item" data-model="gpt-5-mini">GPT-5-mini</div>
        </div>
      </div>
      
      <div class="analyze-button-group">
        <button id="analyzeButton" class="analyze-button">Analyze with GPT-5-nano</button>
      </div>
      
      <div id="navigationControls" class="navigation-controls" style="display: none;">
        <button id="prevInstanceBtn" class="nav-button">←</button>
        <span id="instancePosition" class="instance-position">Instance 1 of 1</span>
        <button id="nextInstanceBtn" class="nav-button">→</button>
      </div>
      
      <div id="status" class="status"></div>
    </div>
  `;

  // Floating button
  const btn = document.createElement('button');
  btn.className = 'manipulation-widget-btn';
  btn.title = 'Open Manipulation Identifier';
  btn.innerHTML = `
    <span class="manipulation-widget-btn-icon show" id="manipulationWidgetBtnEye">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/>
        <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>
      </svg>
    </span>
    <span class="manipulation-widget-btn-icon hide" id="manipulationWidgetBtnClose">✕</span>
  `;

  // Feedback button
  const feedbackBtn = document.createElement('button');
  feedbackBtn.className = 'feedback-button';
  feedbackBtn.id = 'feedbackButton';
  feedbackBtn.title = 'Submit Feedback';
  feedbackBtn.innerHTML = '💬';

  root.appendChild(panel);
  root.appendChild(btn);
  root.appendChild(feedbackBtn);
  document.body.appendChild(root);

  // Initialize enhanced widget functionality
  initializeEnhancedWidget(root);
}

function initializeEnhancedWidget(root) {
  const panel = root.querySelector('.manipulation-widget-panel');
  const btn = root.querySelector('.manipulation-widget-btn');
  const feedbackBtn = root.querySelector('#feedbackButton');
  const dropdownButton = root.querySelector('#modelDropdownButton');
  const dropdownMenu = root.querySelector('#modelDropdownMenu');
  const selectedModelText = root.querySelector('#selectedModelText');
  const analyzeButton = root.querySelector('#analyzeButton');
  const statusDiv = root.querySelector('#status');
  const navigationControls = root.querySelector('#navigationControls');
  const prevBtn = root.querySelector('#prevInstanceBtn');
  const nextBtn = root.querySelector('#nextInstanceBtn');
  const instancePosition = root.querySelector('#instancePosition');

  let isOpen = false;
  let currentInstanceIndex = 0;
  let totalInstances = 0;

  // Model dropdown functionality
  dropdownButton.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownMenu.classList.toggle('open');
  });

  // Model selection
  dropdownMenu.addEventListener('click', (e) => {
    if (e.target.classList.contains('dropdown-item')) {
      const model = e.target.dataset.model;
      selectedModel = model;
      selectedModelText.textContent = e.target.textContent;
      analyzeButton.textContent = `Analyze with ${e.target.textContent}`;
      
      // Update selected state
      dropdownMenu.querySelectorAll('.dropdown-item').forEach(item => {
        item.classList.remove('selected');
      });
      e.target.classList.add('selected');
      
      dropdownMenu.classList.remove('open');
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    dropdownMenu.classList.remove('open');
  });

  // Analyze button functionality
  analyzeButton.addEventListener('click', async () => {
    if (analyzeButton.classList.contains('clear')) {
      clearAllHighlights();
      analyzeButton.textContent = `Analyze with ${selectedModelText.textContent}`;
      analyzeButton.classList.remove('clear');
      statusDiv.innerHTML = '<div class="status-message">Click "Analyze" to search for manipulative language.</div>';
      feedbackBtn.classList.remove('visible');
    } else {
      analyzeButton.disabled = true;
      analyzeButton.textContent = 'Analyzing...';
      statusDiv.innerHTML = '<div class="status-message loading">Analyzing page content...</div>';
      
      try {
        await runAnalysis(selectedModel);
      } catch (error) {
        statusDiv.innerHTML = `<div class="error">${error.message}</div>`;
        analyzeButton.disabled = false;
        analyzeButton.textContent = `Analyze with ${selectedModelText.textContent}`;
      }
    }
  });

  // Feedback button functionality
  feedbackBtn.addEventListener('click', () => {
    if (feedbackBtn.classList.contains('active')) {
      disableFeedbackMode();
      feedbackBtn.classList.remove('active');
      feedbackBtn.style.background = '#4caf50';
      feedbackBtn.title = 'Submit Feedback';
    } else {
      enableFeedbackMode();
      feedbackBtn.classList.add('active');
      feedbackBtn.style.background = '#ff9800';
      feedbackBtn.title = 'Click highlighted text to provide feedback';
    }
  });

  // Navigation controls functionality
  prevBtn.addEventListener('click', () => {
    if (currentInstanceIndex > 0) {
      currentInstanceIndex--;
      navigateToInstance(currentInstanceIndex);
      updateNavigationUI();
    }
  });

  nextBtn.addEventListener('click', () => {
    if (currentInstanceIndex < totalInstances - 1) {
      currentInstanceIndex++;
      navigateToInstance(currentInstanceIndex);
      updateNavigationUI();
    }
  });

  // Navigation utility functions
  function updateNavigationUI() {
    if (totalInstances > 0) {
      instancePosition.textContent = `Instance ${currentInstanceIndex + 1} of ${totalInstances}`;
      navigationControls.style.display = 'flex';
      
      prevBtn.disabled = currentInstanceIndex === 0;
      nextBtn.disabled = currentInstanceIndex === totalInstances - 1;
    } else {
      navigationControls.style.display = 'none';
    }
  }

  function navigateToInstance(index) {
    const highlights = document.querySelectorAll('.manipulation-highlight');
    
    // Remove active state from all highlights
    highlights.forEach(h => h.classList.remove('active'));
    
    if (highlights[index]) {
      const highlight = highlights[index];
      highlight.classList.add('active');
      
      // Scroll to the highlight
      highlight.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center',
        inline: 'nearest'
      });
      
      // Show tooltip for current instance
      showTooltipForHighlight(highlight);
    }
  }

  function initializeNavigation() {
    const highlights = document.querySelectorAll('.manipulation-highlight');
    totalInstances = highlights.length;
    currentInstanceIndex = 0;
    updateNavigationUI();
    
    if (highlights.length > 0) {
      navigateToInstance(0);
    }
  }

  function showTooltipForHighlight(highlight) {
    // Remove any existing tooltips
    document.querySelectorAll('.tooltip').forEach(tooltip => tooltip.remove());
    
    // Get the tooltip content from the highlight's data
    const tacticName = highlight.dataset.tacticName || 'Unknown Tactic';
    const explanation = highlight.dataset.explanation || 'No explanation available';
    
    // Create tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip visible';
    tooltip.innerHTML = `
      <strong>${tacticName}</strong><br>
      ${explanation}
    `;
    
    // Position tooltip
    document.body.appendChild(tooltip);
    
    const rect = highlight.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    
    let top = rect.top - tooltipRect.height - 10;
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    
    // Adjust if tooltip goes off screen
    if (top < 10) {
      top = rect.bottom + 10;
      tooltip.classList.add('bottom');
    }
    
    if (left < 10) {
      left = 10;
    } else if (left + tooltipRect.width > window.innerWidth - 10) {
      left = window.innerWidth - tooltipRect.width - 10;
    }
    
    tooltip.style.position = 'fixed';
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    
    // Auto-hide tooltip after 5 seconds
    setTimeout(() => {
      if (tooltip.parentNode) {
        tooltip.remove();
      }
    }, 5000);
  }

  // Panel toggle functionality
  btn.addEventListener('click', () => {
    isOpen = !isOpen;
    if (isOpen) {
      panel.classList.add('open');
    } else {
      panel.classList.remove('open');
    }
  });

  // Listen for analysis results
  window.addEventListener('analysisComplete', (e) => {
    analyzeButton.disabled = false;
    const results = e.detail.results || [];
    
    if (results.length > 0) {
      analyzeButton.textContent = 'Clear';
      analyzeButton.classList.add('clear');
      statusDiv.innerHTML = `<div class="status-message">Analysis complete. ${results.length} manipulation tactic${results.length > 1 ? 's' : ''} identified.</div>`;
      feedbackBtn.classList.add('visible');
      
      // Initialize navigation after highlights are created
      setTimeout(() => {
        initializeNavigation();
      }, 100);
    } else {
      analyzeButton.textContent = `Analyze with ${selectedModelText.textContent}`;
      analyzeButton.classList.remove('clear');
      statusDiv.innerHTML = '<div class="status-message">No manipulative language identified.</div>';
      feedbackBtn.classList.remove('visible');
      
      // Hide navigation controls when no results
      navigationControls.style.display = 'none';
    }
  });

  window.addEventListener('analysisError', (e) => {
    analyzeButton.disabled = false;
    analyzeButton.textContent = `Analyze with ${selectedModelText.textContent}`;
    statusDiv.innerHTML = `<div class="error">${e.detail.error}</div>`;
  });

  // Listen for instance changes from highlight clicks
  root.addEventListener('instanceChanged', (e) => {
    const index = e.detail.index;
    if (index !== currentInstanceIndex) {
      currentInstanceIndex = index;
      updateNavigationUI();
      navigateToInstance(index);
    }
  });
}

// Core highlight interaction functions
function handleHighlightClick(e, highlight, match) {
  e.preventDefault();
  e.stopPropagation();
  
  // Remove any existing tooltips
  document.querySelectorAll('.tooltip').forEach(tooltip => tooltip.remove());
  
  // Show tooltip for this highlight
  showInstanceTooltip(highlight, match);
  
  // Update navigation to this instance
  const highlights = document.querySelectorAll('.manipulation-highlight');
  const index = Array.from(highlights).indexOf(highlight);
  if (index !== -1) {
    updateCurrentInstance(index);
  }
}

function showInstanceTooltip(highlight, match) {
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip visible';
  
  const tacticName = match.tactic || 'Unknown Tactic';
  const definition = match.definition || 'No definition available';
  const examples = match.examples || [];
  
  let examplesHtml = '';
  if (examples.length > 0) {
    examplesHtml = examples.map(example => 
      `<div style="margin-top: 8px; padding: 6px; background: var(--highlight-bg); border-radius: 4px;">
        <em>"${example.text}"</em><br>
        <small>${example.explanation}</small>
      </div>`
    ).join('');
  }
  
  tooltip.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 8px;">${tacticName}</div>
    <div style="margin-bottom: 8px;">${definition}</div>
    ${examplesHtml}
  `;
  
  // Position tooltip
  document.body.appendChild(tooltip);
  positionTooltip(tooltip, highlight);
  
  // Auto-hide after 10 seconds
  setTimeout(() => {
    if (tooltip.parentNode) {
      tooltip.remove();
    }
  }, 10000);
}

function positionTooltip(tooltip, highlight) {
  const rect = highlight.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  
  let top = rect.top - tooltipRect.height - 10;
  let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
  
  // Adjust if tooltip goes off screen
  if (top < 10) {
    top = rect.bottom + 10;
    // Adjust arrow direction for bottom position
    tooltip.style.setProperty('--arrow-direction', 'up');
  }
  
  if (left < 10) {
    left = 10;
  } else if (left + tooltipRect.width > window.innerWidth - 10) {
    left = window.innerWidth - tooltipRect.width - 10;
  }
  
  tooltip.style.position = 'fixed';
  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
  tooltip.style.zIndex = '1000000';
}

function updateCurrentInstance(index) {
  // This will be called by the navigation system
  const widget = document.getElementById('manipulation-widget-root');
  if (widget) {
    const event = new CustomEvent('instanceChanged', { detail: { index } });
    widget.dispatchEvent(event);
  }
}

// Utility functions for highlight management
function clearAllHighlights() {
  document.querySelectorAll('.manipulation-highlight').forEach(highlight => {
    const parent = highlight.parentNode;
    parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
    parent.normalize();
  });
  
  // Clear tooltips
  document.querySelectorAll('.tooltip').forEach(tooltip => tooltip.remove());
  
  // Reset navigation
  const navigationControls = document.querySelector('#navigationControls');
  if (navigationControls) {
    navigationControls.style.display = 'none';
  }
}

function enableFeedbackMode() {
  document.querySelectorAll('.manipulation-highlight').forEach(highlight => {
    highlight.classList.add('feedback-mode');
  });
}

function disableFeedbackMode() {
  document.querySelectorAll('.manipulation-highlight').forEach(highlight => {
    highlight.classList.remove('feedback-mode');
  });
}

// Initialize widget on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectWidget);
} else {
  injectWidget();
}