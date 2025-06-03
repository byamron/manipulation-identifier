// popup.js
console.log("popup.js loaded");

// Utility to get the active tab in the last focused normal window
async function getActiveTabInLastFocusedNormalWindow() {
  const windows = await chrome.windows.getAll({populate: true, windowTypes: ['normal']});
  const lastFocused = windows.find(w => w.focused) || windows[0];
  if (!lastFocused) return null;
  const activeTab = lastFocused.tabs.find(tab => tab.active);
  return activeTab || null;
}

document.addEventListener('DOMContentLoaded', function() {
  const analyzeButton = document.getElementById('analyzeButton');
  const statusDiv = document.getElementById('status');
  const closeButton = document.getElementById('closeButton');

  // Handle close button click
  closeButton.addEventListener('click', () => {
    window.close();
  });

  // Function to check page state
  async function checkPageState() {
    try {
      const tab = await getActiveTabInLastFocusedNormalWindow();
      if (!tab) return;

      const highlightState = await new Promise(resolve => {
        chrome.tabs.sendMessage(tab.id, {action: "getHighlightState"}, response => {
          if (chrome.runtime.lastError) {
            console.warn("Could not get highlight state:", chrome.runtime.lastError);
            resolve(null);
          } else {
            resolve(response);
          }
        });
      });

      // Update button and status based on highlights
      if (highlightState?.hasHighlights) {
        analyzeButton.textContent = 'Clear Highlights';
        analyzeButton.classList.add('active');
        statusDiv.innerHTML = `<div class="status-message">Analysis complete. ${highlightState.tactics?.length || 0} manipulation tactics identified.</div>`;
      } else {
        analyzeButton.textContent = 'Analyze Current Page';
        analyzeButton.classList.remove('active');
        statusDiv.innerHTML = '<div class="status-message">Click "Analyze" to search for manipulative language.</div>';
      }
    } catch (error) {
      console.error('Error checking page state:', error);
    }
  }

  // Handle analyze button click
  analyzeButton.addEventListener('click', async function() {
    try {
      const tab = await getActiveTabInLastFocusedNormalWindow();
      if (!tab) return;

      if (analyzeButton.classList.contains('active')) {
        chrome.tabs.sendMessage(tab.id, {action: "clearHighlights"}, (response) => {
          if (chrome.runtime.lastError) {
            showError('Could not clear highlights: ' + chrome.runtime.lastError.message);
            return;
          }
          analyzeButton.textContent = 'Analyze Current Page';
          analyzeButton.classList.remove('active');
          statusDiv.innerHTML = '<div class="status-message">Click "Analyze" to search for manipulative language.</div>';
        });
      } else {
        // Start analysis
        analyzeButton.disabled = true;
        analyzeButton.textContent = 'Analyzing...';
        statusDiv.innerHTML = '<div class="status-message loading">Analyzing page content...</div>';

        chrome.tabs.sendMessage(tab.id, {action: "analyze"}, (response) => {
          if (chrome.runtime.lastError) {
            showError('Could not analyze page: ' + chrome.runtime.lastError.message + '. Try reloading the page.');
            return;
          }
        });
      }
    } catch (error) {
      console.error('Error during analysis:', error);
      showError(error.message);
    }
  });

  function showError(errorMessage) {
    statusDiv.innerHTML = `<div class="error">${escapeHtml(errorMessage)}</div>`;
    analyzeButton.disabled = false;
    analyzeButton.textContent = 'Analyze Current Page';
  }

  function escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Listen for messages from the background script
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === "analysisComplete") {
      analyzeButton.disabled = false;
      analyzeButton.textContent = 'Clear Highlights';
      analyzeButton.classList.add('active');
      
      if (message.results?.length > 0) {
        statusDiv.innerHTML = `<div class="status-message">Analysis complete. ${message.results.length} manipulation tactics identified.</div>`;
      } else {
        statusDiv.innerHTML = '<div class="status-message">No manipulative language identified.</div>';
      }
    } else if (message.action === "analysisError") {
      showError(message.error || "Unknown error occurred during analysis.");
    }
  });

  // Initialize popup
  checkPageState();
});
