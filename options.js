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

  // Load saved settings
  chrome.storage.local.get(['openaiApiKey', 'selectedModel', 'serverUrl'], (result) => {
    if (result.openaiApiKey) apiKeyInput.value = result.openaiApiKey;
    if (result.selectedModel) modelSelect.value = result.selectedModel;
    if (result.serverUrl) serverUrlInput.value = result.serverUrl;
    updateModeIndicator(result.openaiApiKey);
  });

  function updateModeIndicator(apiKey) {
    if (apiKey) {
      modeIndicator.textContent = 'BYOK Active';
      modeIndicator.className = 'mode-indicator byok';
    } else {
      modeIndicator.textContent = 'Server Proxy';
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
      openaiApiKey: apiKey,
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
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });

      if (response.ok) {
        showStatus(apiStatus, 'API key is valid.', 'success');
      } else if (response.status === 401) {
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
});
