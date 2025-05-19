// popup.js
document.addEventListener('DOMContentLoaded', function() {
    const analyzeButton = document.getElementById('analyzeButton');
    const statusDiv = document.getElementById('status');
    const resultsDiv = document.getElementById('results');
    const resultsContent = document.getElementById('resultsContent');
  
    analyzeButton.addEventListener('click', function() {
      // Disable button and show loading state
      analyzeButton.disabled = true;
      analyzeButton.textContent = 'Analyzing...';
      statusDiv.innerHTML = '<div class="loading">Analyzing page content</div>';
      resultsDiv.style.display = 'none';
  
      // Get the active tab and send message to content script
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {action: "analyze"}, function(response) {
          if (chrome.runtime.lastError) {
            showError('Failed to communicate with the page. Please refresh and try again.');
            resetButton();
            return;
          }
  
          if (response && response.status === "Analysis started") {
            statusDiv.textContent = 'Analysis in progress...';
            
            // Listen for analysis results
            const messageListener = function(message, sender, sendResponse) {
              if (message.action === "analysisComplete") {
                chrome.runtime.onMessage.removeListener(messageListener);
                displayResults(message.results);
                resetButton();
              } else if (message.action === "analysisError") {
                chrome.runtime.onMessage.removeListener(messageListener);
                showError(message.error);
                resetButton();
              }
            };
            
            chrome.runtime.onMessage.addListener(messageListener);
            
            // Set timeout for analysis
            setTimeout(() => {
              chrome.runtime.onMessage.removeListener(messageListener);
              showError('Analysis timed out. Please try again.');
              resetButton();
            }, 30000); // 30 second timeout
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
      statusDiv.innerHTML = `<div class="error">${errorMessage}</div>`;
      resultsDiv.style.display = 'none';
    }
  
    function displayResults(results) {
      statusDiv.textContent = '';
      
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