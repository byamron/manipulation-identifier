// Log when extension is installed
chrome.runtime.onInstalled.addListener(() => {
    console.log('Extension installed');
  });
  
  // Trigger analysis when extension icon is clicked
  chrome.action.onClicked.addListener((tab) => {
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
  
        const payload = {
          action: "analysisComplete",
          results: data.results,
          llmResponse: data.llmResponse
        };
  
        console.log("📤 background.js: attempting to send message to popup", payload);
  
        chrome.runtime.sendMessage(payload, (response) => {
          if (chrome.runtime.lastError) {
            console.warn("Popup not open. Saving analysis to chrome.storage.local instead.");
            chrome.storage.local.set({ pendingAnalysis: payload });
          } else {
            console.log("Message delivered to popup successfully");
          }
        });
  
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Fetch to LLM server failed:', error);
  
        const errorPayload = {
          action: "analysisError",
          error: error.message
        };
  
        chrome.runtime.sendMessage(errorPayload, (response) => {
          if (chrome.runtime.lastError) {
            console.warn("Popup not open. Saving error to chrome.storage.local.");
            chrome.storage.local.set({ pendingAnalysis: errorPayload });
          } else {
            console.log("Error message delivered to popup");
          }
        });
  
        sendResponse({ success: false, error: error.message });
      });
  
      return true; // allow async sendResponse
    }
  });
  