importScripts('shared.js');

// Configuration
const CONFIG = {
  TIMEOUT_MS: 30000,
  MAX_RETRIES: 2,
  RETRY_DELAY_MS: 1000,
  DEFAULT_MODEL: 'gpt-5-nano',
  DEFAULT_SERVER_URL: 'http://localhost:3000'
};

// Open side panel on extension icon click
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Utility: delayed retry
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Fetch with timeout and retry (retries only on 5xx/429, throws on 4xx)
async function fetchWithRetry(url, options, retries = CONFIG.MAX_RETRIES) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });

    if (!response.ok) {
      const status = response.status;
      if (status >= 500 || status === 429) {
        if (retries > 0) {
          const backoff = CONFIG.RETRY_DELAY_MS * Math.pow(2, CONFIG.MAX_RETRIES - retries);
          await delay(backoff);
          return fetchWithRetry(url, options, retries - 1);
        }
      }
      // Parse error body for better messages
      let errorBody;
      try { errorBody = await response.json(); } catch { errorBody = {}; }
      const err = new Error(errorBody.error || `Server error: ${status}`);
      err.status = status;
      throw err;
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout — the server took too long to respond.');
    }
    if (retries > 0 && !error.status) {
      // Network error — retry
      const backoff = CONFIG.RETRY_DELAY_MS * Math.pow(2, CONFIG.MAX_RETRIES - retries);
      await delay(backoff);
      return fetchWithRetry(url, options, retries - 1);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Get settings from storage
async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['serverUrl', 'openaiApiKey', 'selectedModel'], result => {
      resolve({
        serverUrl: result.serverUrl || CONFIG.DEFAULT_SERVER_URL,
        apiKey: result.openaiApiKey || null,
        model: result.selectedModel || CONFIG.DEFAULT_MODEL
      });
    });
  });
}

// Build prompt from tactics.json (for BYOK mode)
let cachedTactics = null;
async function loadTactics() {
  if (cachedTactics) return cachedTactics;
  const response = await fetch(chrome.runtime.getURL('tactics.json'));
  cachedTactics = await response.json();
  return cachedTactics;
}

function buildSystemPrompt(tactics) {
  const tacticList = tactics.map(t => `- ${t.name}: ${t.definition}`).join('\n');
  return `You are an expert in detecting manipulation tactics in text. Identify instances of these tactics:

${tacticList}

Instructions:
- For each tactic you detect, provide its name, definition, and every instance where it appears.
- For each instance, return the EXACT text from the input as the quote. Copy it verbatim — do not paraphrase, summarize, or shorten.
- Provide a brief explanation of why each quote is an example of the tactic.
- Only report tactics you are confident are present. Do not speculate.`;
}

function buildUserPrompt(content) {
  return `Analyze the following text for manipulation tactics.

<content>
${content}
</content>`;
}

// JSON schema for OpenAI structured output
const ANALYSIS_SCHEMA = {
  name: 'manipulation_analysis',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      tactics_detected: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tactic_name: { type: 'string' },
            definition: { type: 'string' },
            instances: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  exact_quote: { type: 'string' },
                  explanation: { type: 'string' }
                },
                required: ['exact_quote', 'explanation'],
                additionalProperties: false
              }
            }
          },
          required: ['tactic_name', 'definition', 'instances'],
          additionalProperties: false
        }
      }
    },
    required: ['tactics_detected'],
    additionalProperties: false
  }
};

// Parse structured JSON response into normalized format
function parseJsonResponse(rawContent) {
  try {
    const parsed = JSON.parse(rawContent);
    const detected = parsed.tactics_detected;
    if (!Array.isArray(detected)) return [];

    return detected
      .filter(t => t.tactic_name && t.definition && Array.isArray(t.instances) && t.instances.length > 0)
      .map(t => ({
        tactic: t.tactic_name,
        definition: t.definition,
        examples: t.instances.map(inst => ({
          text: inst.exact_quote,
          explanation: inst.explanation
        }))
      }));
  } catch {
    return [];
  }
}

// Call OpenAI directly (BYOK mode)
async function callOpenAIDirect(text, model, apiKey) {
  const tactics = await loadTactics();

  const data = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: buildSystemPrompt(tactics) },
        { role: 'user', content: buildUserPrompt(text) }
      ],
      max_completion_tokens: 4000,
      response_format: {
        type: 'json_schema',
        json_schema: ANALYSIS_SCHEMA
      }
    })
  });

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('No response from OpenAI');

  return {
    results: parseJsonResponse(content),
    rawResponse: content,
    tokensUsed: data.usage?.total_tokens || 0,
    model: model
  };
}

// Call server proxy
async function callServerProxy(text, model, serverUrl) {
  const data = await fetchWithRetry(`${serverUrl.replace(/\/$/, '')}/analyze-content-with-model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text, model: model })
  });

  return {
    results: data.results || [],
    rawResponse: data.manipulativeLanguage,
    tokensUsed: data.tokensUsed || 0,
    model: data.model || model
  };
}

// Core analysis handler
async function handleAnalyze(tabId, model) {
  const settings = await getSettings();
  const useModel = model || settings.model;

  // Write "analyzing" status
  await chrome.storage.session.set({
    [`status_${tabId}`]: { status: 'analyzing', timestamp: Date.now() }
  });

  try {
    // Collect text from content script
    const textResponse = await chrome.tabs.sendMessage(tabId, { action: MSG.COLLECT_TEXT });
    const text = textResponse?.text;

    if (!text || text.trim().length < 50) {
      throw new Error('Not enough text content on this page to analyze.');
    }

    // Call API — BYOK if key exists, otherwise server proxy
    let result;
    if (settings.apiKey) {
      result = await callOpenAIDirect(text, useModel, settings.apiKey);
    } else {
      result = await callServerProxy(text, useModel, settings.serverUrl);
    }

    // Persist results
    await chrome.storage.session.set({
      [`results_${tabId}`]: {
        results: result.results,
        rawResponse: result.rawResponse,
        model: result.model,
        tokensUsed: result.tokensUsed,
        timestamp: Date.now()
      },
      [`status_${tabId}`]: { status: 'complete', timestamp: Date.now() }
    });

    // Send highlights to content script
    if (result.results.length > 0) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          action: MSG.HIGHLIGHT_RESULTS,
          results: result.results
        });
      } catch {
        // Content script may not be present (e.g., on restricted pages)
      }
    }

    return result;
  } catch (error) {
    // Persist error
    await chrome.storage.session.set({
      [`status_${tabId}`]: {
        status: 'error',
        error: mapErrorMessage(error),
        timestamp: Date.now()
      }
    });
    throw error;
  }
}

// Map errors to user-friendly messages
function mapErrorMessage(error) {
  const msg = error.message || '';
  const status = error.status;

  if (status === 401) return 'Invalid API key. Update in Settings.';
  if (status === 402) return 'API quota exceeded. Check your OpenAI billing.';
  if (status === 429) return 'Too many requests. Try again in a minute.';
  if (status >= 500) return 'Server error. Try again later.';
  if (msg.includes('timeout')) return 'Request timed out. Try again.';
  if (msg.includes('NetworkError') || msg.includes('Failed to fetch')) {
    return 'Could not reach the server. Check your connection.';
  }
  return msg || 'An unexpected error occurred.';
}

// LRU eviction for session storage (max 20 tab results)
async function evictOldResults() {
  const all = await chrome.storage.session.get(null);
  const resultKeys = Object.keys(all)
    .filter(k => k.startsWith('results_'))
    .map(k => ({ key: k, timestamp: all[k].timestamp || 0 }))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (resultKeys.length > 20) {
    const toRemove = resultKeys.slice(0, resultKeys.length - 20).map(r => r.key);
    // Also remove corresponding status keys
    const statusKeys = toRemove.map(k => k.replace('results_', 'status_'));
    await chrome.storage.session.remove([...toRemove, ...statusKeys]);
  }
}

// Message routing
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === MSG.ANALYZE) {
    const { tabId, model } = message;
    handleAnalyze(tabId, model)
      .then(result => {
        evictOldResults();
        sendResponse({ success: true, ...result });
      })
      .catch(error => {
        sendResponse({ success: false, error: mapErrorMessage(error) });
      });
    return true; // async
  }

  if (message.action === MSG.CLEAR_HIGHLIGHTS) {
    const { tabId } = message;
    chrome.tabs.sendMessage(tabId, { action: MSG.CLEAR_HIGHLIGHTS })
      .then(() => {
        chrome.storage.session.remove([`results_${tabId}`, `status_${tabId}`]);
        sendResponse({ success: true });
      })
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  if (message.action === MSG.SCROLL_TO) {
    // Forward scroll request to content script
    const { tabId, highlightId } = message;
    chrome.tabs.sendMessage(tabId, { action: MSG.SCROLL_TO, highlightId })
      .catch(() => {});
    return false;
  }

  if (message.action === MSG.HIGHLIGHT_CLICKED) {
    // Forward from content script to side panel (broadcast)
    // Side panel will pick this up
    return false;
  }
});
