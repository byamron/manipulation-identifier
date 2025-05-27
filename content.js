let tactics = [];

// Load tactics from JSON file (with safeguard for chrome.runtime.getURL)
async function loadTactics() {
  try {
    if (!chrome.runtime?.getURL) {
      throw new Error('chrome.runtime.getURL is not available. Content script may have been run outside of a Chrome extension context.');
    }

    const response = await fetch(chrome.runtime.getURL('tactics.json'));
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    tactics = await response.json();
    console.log('Tactics loaded successfully:', tactics);
  } catch (error) {
    console.error('Error loading tactics:', error);
  }
}

// Escape HTML to prevent DOM injection issues
function escapeHTML(str) {
  return str.replace(/[&<>"']/g, match =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match])
  );
}

// Highlight detected manipulation tactics in page text
function highlightManipulativeLanguage(detectedTactics, pageText) {
  const style = document.createElement('style');
  style.textContent = `
    .manipulation-highlight {
      background-color: yellow;
      font-weight: bold;
      border-radius: 2px;
      padding: 0 2px;
    }
  `;
  document.head.appendChild(style);

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);

  const textNodes = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  textNodes.forEach(node => {
    const parent = node.parentNode;
    if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) return;

    let replaced = node.textContent;
    detectedTactics.forEach(tactic => {
      const keywords = [tactic.name, ...(tactic.alsoKnownAs || [])];
      keywords.forEach(keyword => {
        const regex = new RegExp(`\\b(${keyword})\\b`, 'gi');
        replaced = replaced.replace(regex, '<span class="manipulation-highlight">$1</span>');
      });
    });

    if (replaced !== node.textContent) {
      const wrapper = document.createElement('span');
      wrapper.innerHTML = replaced;
      parent.replaceChild(wrapper, node);
    }
  });
}

// Send text to the server for LLM analysis via background script
const analyzeTextWithLLM = (text) => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "analyzeText", text }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Message failed:', chrome.runtime.lastError.message);
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response) {
        reject(new Error('No response from background script'));
        return;
      }

      if (response.success) {
        const resultText = response.data.manipulativeLanguage;

        console.log('LLM analysis result:', resultText);

        const detectedTactics = tactics.filter(tactic =>
          resultText.toLowerCase().includes(tactic.name.toLowerCase())
        );

        if (detectedTactics.length === 0) {
          console.log('No tactics detected.');
          chrome.runtime.sendMessage({ action: "showPopup", result: "No manipulation tactics were detected." });
        } else {
          highlightManipulativeLanguage(detectedTactics, text);
          chrome.runtime.sendMessage({ action: "showPopup", result: resultText, tactics: detectedTactics });
        }
      }
    });
  });
};

// Parse LLM response and extract tactics
function parseLLMResponse(llmResponse) {
  const detectedTactics = [];

  tactics.forEach(tactic => {
    const tacticName = tactic.name.toLowerCase();
    const aliases = tactic.alsoKnownAs || [];

    const isDetected = [tacticName, ...aliases.map(a => a.toLowerCase())]
      .some(name => llmResponse.toLowerCase().includes(name));

    if (isDetected) {
      detectedTactics.push({
        tactic: tactic.name,
        description: tactic.definition,
        examples: tactic.examples.join('; '),
        whatToDo: tactic.whatToDo.join(' ')
      });
    }
  });

  return detectedTactics;
}

// Collect visible text from page
function collectTextForAnalysis(node, collected = []) {
  if (node.nodeType === Node.TEXT_NODE && node.parentNode) {
    const parentTag = node.parentNode.tagName;
    const trimmedText = node.textContent.trim();

    if (
      trimmedText.length > 0 &&
      parentTag !== 'SCRIPT' &&
      parentTag !== 'STYLE' &&
      parentTag !== 'A'
    ) {
      collected.push(trimmedText);
    }
  } else if (node.nodeType === Node.ELEMENT_NODE && !['SCRIPT', 'STYLE'].includes(node.tagName)) {
    for (let child of node.childNodes) {
      collectTextForAnalysis(child, collected);
    }
  }

  return collected;
}

// Run the analysis process
async function runAnalysis() {
  console.log('Running content analysis');
  const visibleTextArray = collectTextForAnalysis(document.body);
  const combinedText = visibleTextArray.join(' ').slice(0, 3000);
  console.log('Collected page content:', combinedText);

  if (combinedText.length < 50) {
    chrome.runtime.sendMessage({
      action: "analysisError",
      error: 'Not enough text content found on this page to analyze.'
    });
    return;
  }

  await analyzeTextWithLLM(combinedText);
}

// Handle incoming messages
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "analyze") {
      runAnalysis().then(() => {
        sendResponse({ status: "Analysis started" });
      }).catch((error) => {
        sendResponse({ status: "Analysis failed", error: error.message });
      });
      return true; // Keep message channel open
    }
  });
}

// Init on load
(async () => {
  await loadTactics();
  console.log('Content script initialized');
})();
