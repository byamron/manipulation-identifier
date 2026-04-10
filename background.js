importScripts('shared.js');

// Configuration
const CONFIG = {
  TIMEOUT_MS: 30000,
  MAX_RETRIES: 2,
  RETRY_DELAY_MS: 1000,
  DEFAULT_MODEL: 'claude-sonnet-4-6',
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
    chrome.storage.local.get(['serverUrl', 'anthropicApiKey', 'selectedModel'], result => {
      resolve({
        serverUrl: result.serverUrl || CONFIG.DEFAULT_SERVER_URL,
        apiKey: result.anthropicApiKey || null,
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
- Only report tactics you are confident are present. Do not speculate.

Attribution rules — for each instance, determine WHO is employing the tactic:
- "author": The article/content itself uses the tactic to persuade the reader. This includes cases where the article frames, endorses, or amplifies a quote (e.g., "rightly warned", "as we've all seen") — the article adopted the rhetoric.
- "source": A quoted or paraphrased person uses the tactic, and the article reports it without endorsing it. When attribution is "source", identify who is being quoted in the "attributed_to" field.
- Do NOT flag manipulation that the article is critically examining or debunking (e.g., "Critics say this claim is fear-mongering" — the article is analyzing the tactic, not employing it).
- When unsure whether the article endorses a quote or merely reports it, use "source".

- Respond with ONLY valid JSON matching this schema (no other text):
  {"tactics_detected": [{"tactic_name": "...", "definition": "...", "instances": [{"exact_quote": "...", "explanation": "...", "attribution": "author"|"source", "attributed_to": "...or null if attribution is author"}]}]}
- If no tactics are found, respond with: {"tactics_detected": []}`;
}

function buildUserPrompt(content) {
  return `Analyze the following text for manipulation tactics.

<content>
${content}
</content>`;
}

// Parse structured JSON response into normalized format
function parseJsonResponse(rawContent) {
  try {
    // Strip markdown code fences if present
    const cleaned = rawContent.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    const detected = parsed.tactics_detected;
    if (!Array.isArray(detected)) return [];

    return detected
      .filter(t => t.tactic_name && t.definition && Array.isArray(t.instances) && t.instances.length > 0)
      .map(t => ({
        tactic: t.tactic_name,
        definition: t.definition,
        examples: t.instances.map(inst => ({
          text: inst.exact_quote,
          explanation: inst.explanation,
          attribution: inst.attribution === 'source' ? 'source' : 'author',
          attributedTo: inst.attributed_to || null
        }))
      }));
  } catch {
    return [];
  }
}

// Parse SSE stream from Anthropic API
async function* parseSSEStream(reader) {
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer

    let eventType = null;
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith('data: ') && eventType) {
        try {
          yield { event: eventType, data: JSON.parse(line.slice(6)) };
        } catch { /* skip malformed JSON */ }
        eventType = null;
      } else if (line === '') {
        eventType = null;
      }
    }
  }
}

// Extract complete tactic objects from accumulated JSON text
function extractCompleteTactics(accumulated) {
  // Find the start of the tactics array
  const arrayStart = accumulated.indexOf('[');
  if (arrayStart === -1) return [];

  const text = accumulated.slice(arrayStart + 1);
  const tactics = [];
  let depth = 0;
  let objectStart = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // Skip string contents
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++; // Skip escaped char
        i++;
      }
    } else if (ch === '{') {
      if (depth === 0) objectStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objectStart !== -1) {
        const objectStr = text.slice(objectStart, i + 1);
        try {
          const obj = JSON.parse(objectStr);
          if (obj.tactic_name && obj.definition && Array.isArray(obj.instances)) {
            tactics.push(obj);
          }
        } catch { /* incomplete or malformed */ }
        objectStart = -1;
      }
    }
  }

  return tactics;
}

// Fetch streaming response with retry on 5xx/429 (matches fetchWithRetry behavior)
async function fetchStreamWithRetry(url, options, retries = CONFIG.MAX_RETRIES) {
  const controller = new AbortController();
  let timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });

    if (!response.ok) {
      clearTimeout(timeoutId);
      const status = response.status;
      if ((status >= 500 || status === 429) && retries > 0) {
        const backoff = CONFIG.RETRY_DELAY_MS * Math.pow(2, CONFIG.MAX_RETRIES - retries);
        await delay(backoff);
        return fetchStreamWithRetry(url, options, retries - 1);
      }
      let errorBody;
      try { errorBody = await response.json(); } catch { errorBody = {}; }
      const err = new Error(errorBody.error?.message || errorBody.error || `Server error: ${status}`);
      err.status = status;
      throw err;
    }

    return { response, controller, timeoutId };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout — the server took too long to respond.');
    }
    if (retries > 0 && !error.status) {
      const backoff = CONFIG.RETRY_DELAY_MS * Math.pow(2, CONFIG.MAX_RETRIES - retries);
      await delay(backoff);
      return fetchStreamWithRetry(url, options, retries - 1);
    }
    throw error;
  }
}

// Call Anthropic directly (BYOK mode) with streaming
async function callAnthropicDirect(text, model, apiKey, onPartialResults) {
  const tactics = await loadTactics();

  const { response, controller, timeoutId } = await fetchStreamWithRetry(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 4096,
        stream: true,
        system: buildSystemPrompt(tactics),
        messages: [
          { role: 'user', content: buildUserPrompt(text) }
        ]
      })
    }
  );

  // Process stream — reset timeout on each chunk, cancel reader on error
  const reader = response.body.getReader();
  let accumulated = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let lastEmittedCount = 0;
  let activeTimeout = timeoutId;

  const resetTimeout = () => {
    clearTimeout(activeTimeout);
    activeTimeout = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);
  };

  try {
    for await (const { event, data } of parseSSEStream(reader)) {
      resetTimeout();

      if (event === 'content_block_delta' && data.delta?.type === 'text_delta') {
        accumulated += data.delta.text;

        // Try to extract complete tactics incrementally
        if (onPartialResults) {
          const completeTactics = extractCompleteTactics(accumulated);
          if (completeTactics.length > lastEmittedCount) {
            lastEmittedCount = completeTactics.length;
            const parsed = completeTactics
              .filter(t => t.instances.length > 0)
              .map(t => ({
                tactic: t.tactic_name,
                definition: t.definition,
                examples: t.instances.map(inst => ({
                  text: inst.exact_quote,
                  explanation: inst.explanation,
                  attribution: inst.attribution === 'source' ? 'source' : 'author',
                  attributedTo: inst.attributed_to || null
                }))
              }));
            onPartialResults(parsed);
          }
        }
      } else if (event === 'message_start') {
        inputTokens = data.message?.usage?.input_tokens || 0;
      } else if (event === 'message_delta') {
        outputTokens = data.usage?.output_tokens || 0;
      }
    }
  } finally {
    clearTimeout(activeTimeout);
    reader.cancel().catch(() => {});
  }

  if (!accumulated) throw new Error('No response from Anthropic');

  return {
    results: parseJsonResponse(accumulated),
    rawResponse: accumulated,
    tokensUsed: inputTokens + outputTokens,
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

  const statusKey = `status_${tabId}`;
  const startedAt = Date.now();
  const writeStage = (stage) => chrome.storage.session.set({
    [statusKey]: { status: 'analyzing', stage, startedAt, timestamp: Date.now() }
  });

  await writeStage('collecting');

  try {
    // Collect text from content script (inject if needed)
    let textResponse;
    try {
      textResponse = await chrome.tabs.sendMessage(tabId, { action: MSG.COLLECT_TEXT });
    } catch {
      // Content script not injected — inject it and retry
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      textResponse = await chrome.tabs.sendMessage(tabId, { action: MSG.COLLECT_TEXT });
    }
    const text = textResponse?.text;

    if (!text || text.trim().length < 50) {
      throw new Error('Not enough text content on this page to analyze.');
    }

    await writeStage('calling_api');

    // Call API — BYOK if key exists, otherwise server proxy
    const resultsKey = `results_${tabId}`;
    let result;
    if (settings.apiKey) {
      result = await callAnthropicDirect(text, useModel, settings.apiKey, (partialResults) => {
        // Emit partial results to session storage for incremental rendering
        chrome.storage.session.set({
          [resultsKey]: {
            results: partialResults,
            model: useModel,
            streaming: true,
            timestamp: Date.now()
          }
        });
      });
    } else {
      result = await callServerProxy(text, useModel, settings.serverUrl);
    }

    await writeStage('processing');

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

    // Update extension icon badge
    const count = result.results.length;
    chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' });
    if (count > 0) {
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#ef5350' });
    }

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
    console.error('[MI] Analysis failed:', error.message, error.status || '', error);
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
  if (status === 402) return 'API quota exceeded. Check your Anthropic billing.';
  if (status === 429) return 'Too many requests. Try again in a minute.';
  if (status >= 500) return 'API server error. Try again later.';
  if (msg.includes('timeout') || msg.includes('AbortError')) return 'Request timed out. Try again.';
  if (msg.includes('NetworkError') || msg.includes('Failed to fetch')) {
    return 'Network error — could not reach the API. Check your connection.';
  }
  if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
    return 'Content script not loaded. Try refreshing the page first.';
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
        chrome.action.setBadgeText({ tabId, text: '' });
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
