// Import the tactics array using fetch
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
    const response = await fetch('http://localhost:3000/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) throw new Error(`Server error: ${response.status}`);

    const data = await response.json();
    console.log('LLM analysis result:', data);
    // You could use this data to influence UI later
  } catch (error) {
    console.error('Error sending text to LLM:', error);
  }
};

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
function runAnalysis() {
  console.log('Running content analysis');
  const visibleTextArray = collectTextForAnalysis(document.body);
  const combinedText = visibleTextArray.join(' ').slice(0, 3000); // Trim to 3,000 chars for LLM
  analyzeTextWithLLM(combinedText);
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "analyze") {
    runAnalysis();
    sendResponse({ status: "Analysis started" });
  }
  return true; // Indicates we'll send a response asynchronously
});

// Initialize when the content script loads
(async () => {
  await loadTactics();
  // We don't auto-run the analysis now, we wait for the extension button to be clicked
  console.log('Content script initialized');
})();