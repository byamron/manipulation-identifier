// Updated content.js
let tactics = [];

// Load tactics from JSON file
async function loadTactics() {
  try {
    const response = await fetch(chrome.runtime.getURL('tactics.json'));
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    tactics = await response.json();
    console.log('Tactics loaded successfully:', tactics);
  } catch (error) {
    console.error('Error loading tactics:', error);
  }
}

// Function to escape HTML to prevent DOM injection issues
function escapeHTML(str) {
  return str.replace(/[&<>"']/g, match =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match])
  );
}

// Function to send text to the server for LLM analysis
const analyzeTextWithLLM = async (text) => {
  try {
    const response = await fetch('http://localhost:3000/analyze-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });

    if (!response.ok) throw new Error(`Server error: ${response.status}`);

    const data = await response.json();
    console.log('LLM analysis result:', data);
    
    // Parse the LLM response and extract detected tactics
    const detectedTactics = parseLLMResponse(data.manipulativeLanguage);
    
    // Send results back to popup
    chrome.runtime.sendMessage({
      action: "analysisComplete",
      results: detectedTactics
    });
    
    return detectedTactics;
  } catch (error) {
    console.error('Error sending text to LLM:', error);
    chrome.runtime.sendMessage({
      action: "analysisError",
      error: 'Failed to analyze content. Please ensure the server is running on localhost:3000.'
    });
    throw error;
  }
};

// Function to parse LLM response and extract tactics
function parseLLMResponse(llmResponse) {
  const detectedTactics = [];
  
  // Simple parsing - look for tactic names in the response
  tactics.forEach(tactic => {
    const tacticName = tactic.name.toLowerCase();
    const aliases = tactic.alsoKnownAs || [];
    
    // Check if this tactic is mentioned in the LLM response
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

// Collect visible text and send it for analysis
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

// Function to run the analysis
async function runAnalysis() {
  console.log('Running content analysis');
  const visibleTextArray = collectTextForAnalysis(document.body);
  const combinedText = visibleTextArray.join(' ').slice(0, 3000); // Trim to 3,000 chars for LLM
  
  if (combinedText.length < 50) {
    chrome.runtime.sendMessage({
      action: "analysisError",
      error: 'Not enough text content found on this page to analyze.'
    });
    return;
  }
  
  await analyzeTextWithLLM(combinedText);
}

// Listen for messages from the background script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "analyze") {
    runAnalysis().then(() => {
      sendResponse({ status: "Analysis started" });
    }).catch((error) => {
      sendResponse({ status: "Analysis failed", error: error.message });
    });
    return true; // Indicates we'll send a response asynchronously
  }
});

// Initialize when the content script loads
(async () => {
  await loadTactics();
  console.log('Content script initialized');
})();