// popup.js
console.log("popup.js loaded");

document.addEventListener('DOMContentLoaded', function() {
  const analyzeButton = document.getElementById('analyzeButton');
  const statusDiv = document.getElementById('status');
  const resultsDiv = document.getElementById('results');
  const resultsContent = document.getElementById('resultsContent');
  const llmResponseDiv = document.getElementById('llmResponse');
  const resizeHandle = document.querySelector('.resize-handle');

  // Function to check page state and restore results
  async function checkPageStateAndRestoreResults() {
    try {
      const tabs = await new Promise(resolve => chrome.tabs.query({active: true, currentWindow: true}, resolve));
      if (!tabs[0]) return;

      const highlightState = await new Promise(resolve => {
        chrome.tabs.sendMessage(tabs[0].id, {action: "getHighlightState"}, response => {
          if (chrome.runtime.lastError) {
            console.warn("Could not get highlight state:", chrome.runtime.lastError);
            resolve(null);
          } else {
            resolve(response);
          }
        });
      });

      const storage = await new Promise(resolve => {
        chrome.storage.local.get(['popupWidth', 'popupHeight', 'lastAnalysis'], resolve);
      });

      // Restore popup size if saved
      if (storage.popupWidth && storage.popupHeight) {
        document.body.style.width = storage.popupWidth + 'px';
        document.body.style.height = storage.popupHeight + 'px';
      }

      // Handle state restoration
      if (highlightState?.hasHighlights) {
        console.log("Found highlights on page:", highlightState);
        
        if (!storage.lastAnalysis || !storage.lastAnalysis.results?.length) {
          console.log("Highlights exist but no stored analysis - reconstructing state");
          // Reconstruct state from highlights
          storage.lastAnalysis = {
            results: highlightState.tactics.map(tactic => ({
              tactic: tactic,
              description: "Previously detected manipulation tactic",
              examples: []
            })),
            llmResponse: ""
          };
          // Save reconstructed state
          chrome.storage.local.set({ lastAnalysis: storage.lastAnalysis });
        }
        
        // Display results
        displayResults(storage.lastAnalysis.results, storage.lastAnalysis.llmResponse);
      } else if (storage.lastAnalysis) {
        console.log("No highlights found, but have stored analysis");
        // If we have stored analysis but no highlights, trigger reanalysis
        analyzeButton.click();
      } else {
        console.log("No highlights or stored analysis - showing initial state");
        resultsContent.innerHTML = '<div class="initial-state">Click "Analyze Current Page" to check this page for manipulative language.</div>';
      }
    } catch (error) {
      console.error("Error checking page state:", error);
      resultsContent.innerHTML = '<div class="initial-state">Click "Analyze Current Page" to check this page for manipulative language.</div>';
    }
  }

  // Initialize popup
  checkPageStateAndRestoreResults();

  // Handle resize functionality
  let isResizing = false;
  let initialWidth, initialHeight, initialX, initialY;

  resizeHandle.addEventListener('mousedown', function(e) {
    isResizing = true;
    initialWidth = document.body.offsetWidth;
    initialHeight = document.body.offsetHeight;
    initialX = e.clientX;
    initialY = e.clientY;

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  });

  function handleMouseMove(e) {
    if (!isResizing) return;

    const newWidth = initialWidth + (e.clientX - initialX);
    const newHeight = initialHeight + (e.clientY - initialY);

    // Get the CSS variables
    const style = getComputedStyle(document.documentElement);
    const minWidth = parseInt(style.getPropertyValue('--min-width'));
    const minHeight = parseInt(style.getPropertyValue('--min-height'));
    const maxWidth = parseInt(style.getPropertyValue('--max-width'));
    const maxHeight = parseInt(style.getPropertyValue('--max-height'));

    // Apply size constraints
    const constrainedWidth = Math.min(Math.max(newWidth, minWidth), maxWidth);
    const constrainedHeight = Math.min(Math.max(newHeight, minHeight), maxHeight);

    document.body.style.width = constrainedWidth + 'px';
    document.body.style.height = constrainedHeight + 'px';

    // Save the new size to storage
    chrome.storage.local.set({
      popupWidth: constrainedWidth,
      popupHeight: constrainedHeight
    });
  }

  function handleMouseUp() {
    isResizing = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }

  // Show the results container by default
  resultsDiv.style.display = 'block';

  let timeoutId = null;

  // Check for any pending analysis stored by background.js
  chrome.storage.local.get("pendingAnalysis", ({ pendingAnalysis }) => {
    if (pendingAnalysis) {
      console.log("popup.js: Found pending analysis in storage", pendingAnalysis);

      if (pendingAnalysis.action === "analysisComplete") {
        const analysisData = {
          results: pendingAnalysis.results,
          llmResponse: pendingAnalysis.llmResponse
        };
        
        // Save and display the results
        chrome.storage.local.set({ lastAnalysis: analysisData }, () => {
          displayResults(analysisData.results, analysisData.llmResponse);
        });
      } else if (pendingAnalysis.action === "analysisError") {
        showError(pendingAnalysis.error || "Unknown error occurred during analysis.");
      }

      // Clear pending analysis
      chrome.storage.local.remove("pendingAnalysis");
    }
  });

  // Listen for messages from the background script
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    console.log("📩 popup.js received message:", message);

    if (message.action === "analysisComplete") {
      console.log("popup.js: Received analysisComplete message");
      clearTimeout(timeoutId);
      
      const analysisData = {
        results: message.results,
        llmResponse: message.llmResponse
      };

      // Save the results to storage and display them
      chrome.storage.local.set({ lastAnalysis: analysisData }, () => {
        displayResults(analysisData.results, analysisData.llmResponse);
        resetButton();
      });
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

    // Clear last analysis when showing an error
    chrome.storage.local.remove("lastAnalysis");
  }

  function displayResults(results, llmResponse) {
    console.log("Displaying results:", { results, llmResponse });
    statusDiv.textContent = '';

    // First, handle the LLM response section
    if (llmResponse && llmResponse.trim().length > 0) {
      const formattedResponse = formatLLMResponse(llmResponse);
      llmResponseDiv.innerHTML = `<h3>Analysis Details:</h3>${formattedResponse}`;
      llmResponseDiv.style.display = 'block';
    } else {
      llmResponseDiv.style.display = 'none';
    }

    // Always ensure results div is visible
    resultsDiv.style.display = 'block';

    // Handle the results content section
    if (!results || results.length === 0) {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs[0]) {
          showInitialState();
          return;
        }

        chrome.tabs.sendMessage(tabs[0].id, {action: "getHighlightState"}, function(response) {
          if (chrome.runtime.lastError || !response) {
            showInitialState();
            return;
          }

          if (response.hasHighlights) {
            console.log("State mismatch - highlights exist but no results");
            // Clear storage and trigger reanalysis
            chrome.storage.local.remove("lastAnalysis", function() {
              analyzeButton.click();
            });
          } else {
            if (!results) {
              showInitialState();
            } else {
              showNoResults();
            }
          }
        });
      });
    } else {
      showTactics(results);
    }
  }

  // Helper functions to maintain consistent display states
  function showInitialState() {
    resultsContent.innerHTML = '<div class="initial-state">Click "Analyze Current Page" to check this page for manipulative language.</div>';
    resultsDiv.style.display = 'block';
  }

  function showNoResults() {
    resultsContent.innerHTML = '<div class="no-results">✓ No manipulative language detected on this page.</div>';
    resultsDiv.style.display = 'block';
  }

  function showTactics(results) {
    let html = '<h3>Detected Tactics:</h3>';
    results.forEach(result => {
      if (!result.tactic) return; // Skip invalid results
      
      html += `
        <div class="tactic-item">
          <div class="tactic-title">${escapeHtml(result.tactic)}</div>
          <div class="tactic-description">${escapeHtml(result.description || '')}</div>
          ${result.examples && result.examples.length > 0 
            ? `<div class="tactic-examples">Examples: ${escapeHtml(result.examples.join(', '))}</div>` 
            : ''}
        </div>
      `;
    });
    resultsContent.innerHTML = html;
    resultsDiv.style.display = 'block';
  }

  function formatLLMResponse(text) {
    if (!text || typeof text !== 'string') return '';
    
    // Split the text into paragraphs
    const paragraphs = text.split('\n\n').filter(p => p.trim());
    
    let html = '';
    paragraphs.forEach(paragraph => {
      // Check if this is a numbered tactic
      if (/^\d+\.\s*\[.*?\]:/.test(paragraph)) {
        // This is a tactic description
        html += `<div class="llm-tactic">${escapeHtml(paragraph)}</div>`;
      } else {
        // This is a regular paragraph
        html += `<div class="llm-paragraph">${escapeHtml(paragraph)}</div>`;
      }
    });

    return html;
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
