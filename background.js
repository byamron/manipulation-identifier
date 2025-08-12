// Configuration
const CONFIG = {
  TIMEOUT_MS: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  WINDOW_ID: 'manipulation-identifier-window',
  WINDOW_WIDTH: 320,
  WINDOW_HEIGHT: 200
};

let SERVER_URL = 'http://localhost:3000'; // default
chrome.storage.local.get(['serverUrl'], (result) => {
  if (result.serverUrl) SERVER_URL = result.serverUrl;
  });
  
// Utility function for delayed retry
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Utility function to handle message sending with storage fallback
async function sendMessageWithFallback(payload) {
  try {
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(payload, response => {
        if (chrome.runtime.lastError) {
          console.warn("Popup not open. Saving to storage instead.");
          chrome.storage.local.set({ pendingAnalysis: payload }, () => {
      if (chrome.runtime.lastError) {
              reject(new Error('Storage fallback failed'));
            } else {
              resolve();
            }
          });
      } else {
          console.log("Message delivered successfully");
          resolve();
        }
      });
    });
  } catch (error) {
    console.error('Message delivery failed:', error);
    throw error;
  }
}

// Enhanced fetch with timeout and retry
async function fetchWithRetry(url, options, retries = CONFIG.MAX_RETRIES) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    if (retries > 0) {
      console.log(`Retrying... ${retries} attempts remaining`);
      await delay(CONFIG.RETRY_DELAY_MS);
      return fetchWithRetry(url, options, retries - 1);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Note: We rely on the manifest `action.default_popup` (popup.html) for UI.
// No custom window creation is needed here.
  
  // Listen for analysis requests from content.js
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "analyzeText") {
      console.log('Background received text for analysis');
  
    (async () => {
      try {
        const data = await fetchWithRetry(SERVER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message.text })
        });

        console.log('LLM server responded:', data);
  
        // Ensure consistent response structure
        const payload = {
          action: "analysisComplete",
          data: {
            manipulativeLanguage: data.manipulativeLanguage,
            results: data.results || []
          }
        };

        await sendMessageWithFallback(payload);
        sendResponse({ success: true, data: payload.data });
      } catch (error) {
        console.error('Analysis failed:', error);
  
        const errorPayload = {
          action: "analysisError",
          error: error.message
        };
  
        await sendMessageWithFallback(errorPayload);
        sendResponse({ success: false, error: error.message });
      }
    })();
  
    return true; // Keep message channel open for async response
    }
});

// Log when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
  // Initialize any necessary storage
  chrome.storage.local.set({ pendingAnalysis: null });
  });
  