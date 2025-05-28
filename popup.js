// popup.js
console.log("popup.js loaded");

document.addEventListener('DOMContentLoaded', function() {
  const analyzeButton = document.getElementById('analyzeButton');
  const statusDiv = document.getElementById('status');
  const resultsDiv = document.getElementById('results');
  const resultsContent = document.getElementById('resultsContent');
  const llmResponseDiv = document.getElementById('llmResponse');

  // Show the results container by default
  resultsDiv.style.display = 'block';

  let timeoutId = null;

  // 🆕 Check for any pending analysis stored by background.js
  chrome.storage.local.get("pendingAnalysis", ({ pendingAnalysis }) => {
    if (pendingAnalysis) {
      console.log("popup.js: Found pending analysis in storage", pendingAnalysis);

      if (pendingAnalysis.action === "analysisComplete") {
        displayResults(pendingAnalysis.results, pendingAnalysis.llmResponse);
      } else if (pendingAnalysis.action === "analysisError") {
        showError(pendingAnalysis.error || "Unknown error occurred during analysis.");
      }

      // Clear it so it's not shown again
      chrome.storage.local.remove("pendingAnalysis");
    }
  });

  // Listen for messages from the background script
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    console.log("📩 popup.js received message:", message);

    if (message.action === "analysisComplete") {
      console.log("popup.js: Received analysisComplete message");
      clearTimeout(timeoutId);
      displayResults(message.results, message.llmResponse);
      resetButton();
    } else if (message.action === "analysisError") {
      console.log("popup.js: Received analysisError message", message.error);
      clearTimeout(timeoutId);
      showError(message.error || "Unknown error occurred during analysis.");
      resetButton();
    }
  });

  analyzeButton.addEventListener('click', function() {
    analyzeButton.disabled = true;
    analyzeButton.textContent = 'Analyzing...';
    statusDiv.innerHTML = '<div class="loading">Analyzing page content</div>';
    resultsDiv.style.display = 'none';
    if (llmResponseDiv) llmResponseDiv.style.display = 'none';

    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (!tabs[0]) {
        showError('No active tab found.');
        resetButton();
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, {action: "analyze"}, function(response) {
        if (chrome.runtime.lastError) {
          console.error("popup.js: runtime.lastError", chrome.runtime.lastError.message);
          showError('Failed to communicate with the page. Please refresh and try again.');
          resetButton();
          return;
        }

        if (response && response.status === "Analysis started") {
          console.log("popup.js: Analysis started");

          timeoutId = setTimeout(() => {
            console.warn("popup.js: Analysis timed out");
            showError('Analysis timed out. Please try again.');
            resetButton();
          }, 30000);
        } else {
          showError('Failed to start analysis. Please try again.');
          resetButton();
        }
      });
    });
  });

  function resetButton() {
    analyzeButton.disabled = false;
    analyzeButton.textContent = 'Analyze Current Page';
    statusDiv.textContent = '';
  }

  function showError(errorMessage) {
    statusDiv.innerHTML = `<div class="error">${escapeHtml(errorMessage)}</div>`;
    resultsDiv.style.display = 'none';
    if (llmResponseDiv) llmResponseDiv.style.display = 'none';
  }

  function displayResults(results, llmResponse) {
    statusDiv.textContent = '';

    if (llmResponseDiv) {
      if (llmResponse && llmResponse.trim().length > 0) {
        llmResponseDiv.innerHTML = `<h3>LLM Response:</h3><pre>${escapeHtml(llmResponse)}</pre>`;
        llmResponseDiv.style.display = 'block';
      } else {
        llmResponseDiv.style.display = 'none';
      }
    }

    if (!results || results.length === 0) {
      resultsContent.innerHTML = '<div class="no-results">✓ No manipulative language detected on this page.</div>';
    } else {
      let html = '';
      results.forEach(result => {
        html += `
          <div class="tactic-item">
            <div class="tactic-title">${escapeHtml(result.tactic)}</div>
            <div class="tactic-description">${escapeHtml(result.description)}</div>
            ${result.examples ? `<div class="tactic-examples">Examples: ${escapeHtml(result.examples)}</div>` : ''}
          </div>
        `;
      });
      resultsContent.innerHTML = html;
    }

    resultsDiv.style.display = 'block';
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
