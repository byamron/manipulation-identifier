// Log when extension is installed
chrome.runtime.onInstalled.addListener(() => {
    console.log('Extension installed');
  });
  
  // Handle when the extension icon is clicked
  chrome.action.onClicked.addListener((tab) => {
    // Use the scripting API to execute a script in the active tab
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: triggerAnalysis
    });
  });
  
  // Function that will be injected into the page
  function triggerAnalysis() {
    // Send a message to the content script to trigger the analysis
    chrome.runtime.sendMessage({ action: "analyze" });
    console.log('Analysis triggered');
  }