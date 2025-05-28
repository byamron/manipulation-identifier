let tactics = [];
let isProcessing = false;
let debounceTimeout = null;

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

// Optimized highlighting function using DocumentFragment
function highlightManipulativeLanguage(detectedTactics) {
  if (!detectedTactics?.length) return;

  // Add style only once
  if (!document.querySelector('#manipulation-highlight-style')) {
    const style = document.createElement('style');
    style.id = 'manipulation-highlight-style';
    style.textContent = `
      .manipulation-highlight {
        background-color: yellow;
        font-weight: bold;
        border-radius: 2px;
        padding: 0 2px;
        transition: background-color 0.3s ease;
      }
      .manipulation-highlight:hover {
        background-color: #ffed4a;
      }
    `;
    document.head.appendChild(style);
  }

  const fragment = document.createDocumentFragment();
  const textNodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  textNodes.forEach(node => {
    const parent = node.parentNode;
    if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) return;

    let text = node.textContent;
    let hasMatch = false;
    let lastIndex = 0;
    const matches = [];

    detectedTactics.forEach(tactic => {
      const keywords = [tactic.name, ...(tactic.alsoKnownAs || [])];
      keywords.forEach(keyword => {
        const regex = new RegExp(`\\b(${keyword})\\b`, 'gi');
        let match;
        while ((match = regex.exec(text)) !== null) {
          matches.push({
            index: match.index,
            length: match[0].length,
            text: match[0]
          });
          hasMatch = true;
        }
      });
    });

    if (hasMatch) {
      const wrapper = document.createElement('span');
      matches.sort((a, b) => a.index - b.index);
      
      matches.forEach(match => {
        if (match.index > lastIndex) {
          wrapper.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }
        const highlight = document.createElement('span');
        highlight.className = 'manipulation-highlight';
        highlight.textContent = match.text;
        wrapper.appendChild(highlight);
        lastIndex = match.index + match.length;
      });

      if (lastIndex < text.length) {
        wrapper.appendChild(document.createTextNode(text.substring(lastIndex)));
      }

      parent.replaceChild(wrapper, node);
    }
  });
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

    // Parse the LLM response to extract tactics
    const tacticMatches = resultText.match(/\[(.*?)\]:/g);
    const detectedTactics = [];

    if (tacticMatches) {
      tacticMatches.forEach(match => {
        const tacticName = match.replace('[', '').replace(']:', '').trim();
        // Find the corresponding description in the text
        const descriptionRegex = new RegExp(`\\[${tacticName}\\]:\\s*([^\\[]+)`);
        const descriptionMatch = resultText.match(descriptionRegex);
        const description = descriptionMatch ? descriptionMatch[1].trim() : '';

        detectedTactics.push({
          tactic: tacticName,
          description: description,
          examples: [], // Could be extracted from the text if needed
        });
      });
    }

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
    return true; // Keep the message channel open for async response
  }
});

// Initialize
(async () => {
  await loadTactics();
  console.log('Content script initialized');
})();
