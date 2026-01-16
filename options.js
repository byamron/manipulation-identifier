document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('serverUrl');
  const saveBtn = document.getElementById('saveBtn');
  const statusDiv = document.getElementById('status');

  // Load current value
  chrome.storage.local.get(['serverUrl'], (result) => {
    input.value = result.serverUrl || 'http://localhost:3000';
  });

  saveBtn.addEventListener('click', () => {
    chrome.storage.local.set({ serverUrl: input.value }, () => {
      statusDiv.textContent = 'Server URL saved!';
      setTimeout(() => { statusDiv.textContent = ''; }, 2000);
    });
  });
}); 