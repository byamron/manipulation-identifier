let tactics = [];

// Load tactics from JSON file
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

// Safely highlight manipulative language in visible DOM
function highlightManipulativeLanguage(detectedTactics) {
  if (!detectedTactics || detectedTactics.length === 0) return;

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
    let hasMatch = false;

    detectedTactics.forEach(tactic => {
      const keywords = [tactic.name, ...(tactic.alsoKnownAs || [])];
      keywords.forEach(keyword => {
        const regex = new RegExp(`\\b(${keyword})\\b`, 'gi');
        if (regex.test(replaced)) {
          hasMatch = true;
          replaced = replaced.replace(regex, '<span class="manipulation-highlight">$1</span>');
        }
      });
    });

    if (hasMatch) {
      const wrapper = document.createElement('span');
      wrapper.innerHTML = replaced;
      parent.replaceChild(wrapper, node);
    }
  });
}

// Analyze text with LLM via background script
function analyzeTextWithLLM(text) {
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
          highlightManipulativeLanguage(detectedTactics);
          chrome.runtime.sendMessage({ action: "showPopup", result: resultText, tactics: detectedTactics });
        }

        resolve();
      } else {
        reject(new Error('LLM response indicated failure'));
      }
    });
  });
}

// Parse LLM response (currently unused but kept for reference)
function parseLLMResponse(llmResponse) {
  const detectedTactics = [];

  tactics.forEach(tactic => {
    const names = [tactic.name.toLowerCase(), ...(tactic.alsoKnownAs || []).map(a => a.toLowerCase())];
    const isDetected = names.some(name => llmResponse.toLowerCase().includes(name));

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

// Collect visible, non-trivial text from page
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

// Run analysis end-to-end
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

// Listen for messages from popup or background
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

// Load tactics and initialize
(async () => {
  await loadTactics();
  console.log('Content script initialized');
})();
