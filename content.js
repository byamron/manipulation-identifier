let tactics = [];
let isProcessing = false;
let debounceTimeout = null;
let currentHighlights = null; // Track current highlights state

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
      }
      .manipulation-highlight:hover {
        background-color: #fff0b3 !important;
        cursor: help !important;
      }
      .manipulation-tooltip {
        display: none;
        position: fixed;
        background-color: #333;
        color: white;
        padding: 10px;
        border-radius: 5px;
        font-size: 12px;
        max-width: 250px;
        z-index: 10000;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        pointer-events: none;
      }
      .manipulation-tooltip.visible {
        display: block;
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
        left: 50%;
        transform: translateX(-50%);
        border-top: 5px solid #333;
      }
      .manipulation-tooltip.tooltip-bottom::before {
        top: -5px;
        left: 50%;
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
    
    // Calculate space above and below the highlight
    const spaceAbove = highlightRect.top;
    const spaceBelow = viewportHeight - highlightRect.bottom;
    
    // Default margin from the highlight
    const margin = 10;
    
    // Remove existing position classes
    tooltip.classList.remove('tooltip-top', 'tooltip-bottom');
    
    // Position horizontally
    let left = highlightRect.left + (highlightRect.width / 2) - (tooltipRect.width / 2);
    
    // Ensure tooltip doesn't go off-screen horizontally
    left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));
    
    // Decide whether to show above or below based on available space
    if (spaceAbove > tooltipRect.height + margin && spaceAbove >= spaceBelow) {
      // Position above
      tooltip.style.top = `${highlightRect.top + scrollY - tooltipRect.height - margin}px`;
      tooltip.classList.add('tooltip-top');
    } else {
      // Position below
      tooltip.style.top = `${highlightRect.bottom + scrollY + margin}px`;
      tooltip.classList.add('tooltip-bottom');
    }
    
    tooltip.style.left = `${left}px`;
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
    let hasMatch = false;
    let lastIndex = 0;
    const matches = [];

    // Look for exact matches of examples in the text
    detectedTactics.forEach(tactic => {
      if (!tactic.examples) return;
      
      tactic.examples.forEach(example => {
        // Escape special regex characters in the example
        const escapedExample = example.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedExample, 'gi');
        let match;
        
        while ((match = regex.exec(text)) !== null) {
          matches.push({
            index: match.index,
            length: match[0].length,
            text: match[0],
            tactic: tactic.tactic
          });
          hasMatch = true;
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
        
        // Create tooltip
        const tooltip = document.createElement('span');
        tooltip.className = 'manipulation-tooltip';
        tooltip.textContent = `Manipulation Tactic: ${match.tactic}`;
        document.body.appendChild(tooltip);
        
        // Add hover listeners
        highlight.addEventListener('mouseenter', () => {
          tooltip.classList.add('visible');
          positionTooltip(highlight, tooltip);
        });
        
        highlight.addEventListener('mouseleave', () => {
          tooltip.classList.remove('visible');
        });
        
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
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Analysis timeout'));
      }, 30000);

      chrome.runtime.sendMessage({ action: "analyzeText", text }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });

    if (!response?.success || !response?.data?.manipulativeLanguage) {
      throw new Error('Invalid response from analysis');
    }

    const resultText = response.data.manipulativeLanguage;
    console.log('Analysis result:', resultText);

    // Parse the LLM response to extract tactics and their examples
    const detectedTactics = [];
    const sections = resultText.split(/\d+\.\s*\[/);
    
    sections.forEach(section => {
      if (!section.trim()) return;
      
      section = '[' + section; // Add back the '[' we split on
      const tacticMatch = section.match(/\[(.*?)\]:/);
      if (!tacticMatch) return;
      
      const tacticName = tacticMatch[1].trim();
      const remainingText = section.slice(section.indexOf(']:') + 2).trim();
      
      // Extract the description (text until the first quote or example)
      const descriptionEnd = Math.min(
        remainingText.indexOf('"') > -1 ? remainingText.indexOf('"') : Infinity,
        remainingText.indexOf('Example') > -1 ? remainingText.indexOf('Example') : Infinity
      );
      const description = remainingText.slice(0, descriptionEnd).trim();
      
      // Extract examples (text in quotes)
      const examples = [];
      const exampleMatches = remainingText.match(/"([^"]+)"/g);
      if (exampleMatches) {
        exampleMatches.forEach(match => {
          // Remove the quotes and trim
          const example = match.slice(1, -1).trim();
          examples.push(example);
        });
      }
      
      detectedTactics.push({
        tactic: tacticName,
        description: description,
        examples: examples
      });
    });

    // Send the analysis results to the popup
    chrome.runtime.sendMessage({ 
      action: "analysisComplete",
      results: detectedTactics,
      llmResponse: resultText
    });

    // Highlight the detected tactics if any were found
    if (detectedTactics.length > 0) {
      highlightManipulativeLanguage(detectedTactics);
    }
  } catch (error) {
    console.error('Analysis error:', error);
    chrome.runtime.sendMessage({
      action: "analysisError",
      error: error.message || 'Failed to analyze text'
    });
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
    chrome.runtime.sendMessage({
      action: "analysisError",
      error: error.message
    });
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
  }
});

// Initialize
(async () => {
  await loadTactics();
  console.log('Content script initialized');
})();
