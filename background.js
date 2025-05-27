// Log when extension is installed
chrome.runtime.onInstalled.addListener(() => {
    console.log('Extension installed');
  });
  
  // Trigger analysis when extension icon is clicked
  chrome.action.onClicked.addListener((tab) => {
    // Send a message to the content script to start analysis
    chrome.tabs.sendMessage(tab.id, { action: "analyze" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error sending analyze message:', chrome.runtime.lastError.message);
      } else {
        console.log('Analyze message sent to content script');
      }
    });
  });
  
  // Listen for analysis requests from content.js
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "analyzeText") {
      console.log('Background received text for analysis');
  
      fetch('http://localhost:3000/analyze-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message.text })
      })
      .then(response => {
        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        return response.json();
      })
      .then(data => {
        console.log('LLM server responded:', data);
        sendResponse({ success: true, data });
      })
      .catch(error => {
        console.error('Fetch to LLM server failed:', error);
        sendResponse({ success: false, error: error.message });
      });
  
      // Return true to indicate we'll respond asynchronously
      return true;
    }
  });
  