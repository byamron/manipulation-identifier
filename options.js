document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const modelSelect = document.getElementById('model');
  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  const toggleKeyBtn = document.getElementById('toggleKey');
  const apiStatus = document.getElementById('apiStatus');
  const modeIndicator = document.getElementById('modeIndicator');
  const serverUrlInput = document.getElementById('serverUrl');
  const saveServerBtn = document.getElementById('saveServerBtn');
  const serverStatus = document.getElementById('serverStatus');
  const textSizeSelect = document.getElementById('textSize');
  const saveDisplayBtn = document.getElementById('saveDisplayBtn');
  const displayStatus = document.getElementById('displayStatus');

  // Load saved settings (and detect upgrade from old Anthropic version)
  chrome.storage.local.get(['geminiApiKey', 'anthropicApiKey', 'selectedModel', 'serverUrl', 'textSize'], (result) => {
    if (result.geminiApiKey) apiKeyInput.value = result.geminiApiKey;
    if (result.selectedModel) modelSelect.value = result.selectedModel;
    if (result.serverUrl) serverUrlInput.value = result.serverUrl;
    if (result.textSize) textSizeSelect.value = result.textSize;
    updateModeIndicator(result.geminiApiKey);

    // Show migration notice for users upgrading from the Anthropic version
    if (result.anthropicApiKey && !result.geminiApiKey) {
      showStatus(apiStatus, 'This extension now uses Google Gemini. Please add a Gemini API key below.', 'error');
      chrome.storage.local.remove('anthropicApiKey');
    }
  });

  function updateModeIndicator(apiKey) {
    if (apiKey) {
      modeIndicator.textContent = 'Using Your Key';
      modeIndicator.className = 'mode-indicator byok';
    } else {
      modeIndicator.textContent = 'No Key Set';
      modeIndicator.className = 'mode-indicator server';
    }
  }

  function showStatus(el, message, type) {
    el.textContent = message;
    el.className = `status ${type}`;
    if (type === 'success') {
      setTimeout(() => { el.textContent = ''; }, 3000);
    }
  }

  // Toggle API key visibility
  toggleKeyBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleKeyBtn.textContent = 'Hide';
    } else {
      apiKeyInput.type = 'password';
      toggleKeyBtn.textContent = 'Show';
    }
  });

  // Save API key and model
  saveBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;

    chrome.storage.local.set({
      geminiApiKey: apiKey,
      selectedModel: model
    }, () => {
      updateModeIndicator(apiKey);
      showStatus(apiStatus, 'Settings saved.', 'success');
    });
  });

  // Test API key
  testBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showStatus(apiStatus, 'Enter an API key first.', 'error');
      return;
    }

    showStatus(apiStatus, 'Testing...', '');
    testBtn.disabled = true;

    try {
      const testModel = modelSelect.value || 'gemini-2.5-flash-lite';
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${testModel}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'hi' }] }],
          generationConfig: { maxOutputTokens: 1 }
        })
      });

      if (response.ok) {
        showStatus(apiStatus, 'API key is valid.', 'success');
      } else if (response.status === 400 || response.status === 403) {
        showStatus(apiStatus, 'Invalid API key.', 'error');
      } else {
        showStatus(apiStatus, `Unexpected response: ${response.status}`, 'error');
      }
    } catch (error) {
      showStatus(apiStatus, `Connection error: ${error.message}`, 'error');
    } finally {
      testBtn.disabled = false;
    }
  });

  // Save server URL
  saveServerBtn.addEventListener('click', () => {
    const serverUrl = serverUrlInput.value.trim();
    chrome.storage.local.set({ serverUrl }, () => {
      showStatus(serverStatus, 'Server URL saved.', 'success');
    });
  });

  // Save display settings
  saveDisplayBtn.addEventListener('click', () => {
    const textSize = textSizeSelect.value;
    chrome.storage.local.set({ textSize }, () => {
      showStatus(displayStatus, 'Display settings saved.', 'success');
    });
  });
});
