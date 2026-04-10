importScripts('shared.js');

// Configuration
const CONFIG = {
  TIMEOUT_MS: 30000,
  MAX_RETRIES: 2,
  RETRY_DELAY_MS: 1000,
  DEFAULT_MODEL: 'gemini-2.5-flash',
  DEFAULT_SERVER_URL: 'http://localhost:3000',
  GEMINI_API_BASE: 'https://generativelanguage.googleapis.com/v1beta/models'
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
      // Retry on server errors only — not 429 (retrying rate limits just compounds the problem)
      if (status >= 500 && retries > 0) {
        const backoff = CONFIG.RETRY_DELAY_MS * Math.pow(2, CONFIG.MAX_RETRIES - retries);
        await delay(backoff);
        return fetchWithRetry(url, options, retries - 1);
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
    chrome.storage.local.get(['serverUrl', 'geminiApiKey', 'selectedModel'], result => {
      resolve({
        serverUrl: result.serverUrl || CONFIG.DEFAULT_SERVER_URL,
        apiKey: result.geminiApiKey || null,
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
  return `You are an expert in detecting manipulation tactics in text. Your role is to help readers recognize significant manipulation — not to flag every possible stretch.

Tactics to look for:

${tacticList}

Core principle: PRECISION OVER VOLUME.
- Only flag instances that are clearly and significantly manipulative. A reader should look at your flag and immediately understand why this is manipulation.
- If you have to make an argument for why something qualifies, it probably doesn't. Manipulation should be evident, not debatable.
- A typical 500-word text contains 0-2 genuine manipulation tactics. If you are finding 4+, you are likely over-flagging. Step back and ask which ones are truly significant.
- It is MUCH better to miss a borderline tactic than to flag something that isn't clearly manipulation. False alarms erode the system's credibility.

Instructions:
- For each tactic you detect, provide its name, definition, and every instance where it appears.
- For each instance, return the EXACT text from the input as the quote. Copy it verbatim — do not paraphrase, summarize, or shorten.
- Provide a brief explanation of why each quote is a significant example of the tactic.
- Flag the PRIMARY tactic operating in each passage. Do not flag the same passage under multiple tactics unless each one is independently clear and significant. If text uses emotional words as part of a Slippery Slope argument, flag the Slippery Slope — do not also flag Emotional Language for the same passage.

Confidence scoring:
- For each instance, assign a confidence level: "high" or "medium".
- Use "high" for clear, unambiguous manipulation that a reasonable person would recognize.
- Use "medium" sparingly — only when the tactic is genuinely present but context makes it somewhat ambiguous.
- If you would rate confidence below "medium", do not flag it at all.

Attribution rules — for each instance, determine WHO is employing the tactic:
- "author": The article/content itself uses the tactic to persuade the reader.
- "source": A quoted or paraphrased person uses the tactic, and the article reports it without endorsing it. When attribution is "source", identify who is being quoted in the "attributed_to" field.
- Do NOT flag manipulation that the article is critically examining, debunking, or neutrally reporting.
- When unsure whether the article endorses a quote or merely reports it, use "source".

What IS manipulation (flag these):
- Language calculated to provoke fear, outrage, or panic disproportionate to the facts — ALL CAPS hysteria, manufactured urgency, vague existential threats ("this will DESTROY everything")
- Logical fallacies used to mislead — artificially limiting choices, blaming an entire group, attacking a person instead of their argument
- Credibility tricks — invoking irrelevant authority, presenting fake expertise, stripping context to change meaning

What is NOT manipulation (do NOT flag):
- Genuine emotion proportionate to the situation. "I am heartbroken about the factory closure" is real feeling, not a tactic. "This HORRIFYING crisis will DESTROY your family" with no specifics is manufactured panic.
- Common strong language that everyone uses. Words like "devastating," "critical," "serious," "alarming" in proportion to their context are normal rhetoric, not manipulation.
- Making an argument with evidence. Presenting data or citing relevant experts is argumentation, not Cherry Picking or Appeal to Authority.
- Describing a real consequence. "If we cut the budget, services will be reduced" is factual. "If we cut the budget, civilization will COLLAPSE" is Slippery Slope.
- Mentioning groups or sides. "Democrats and Republicans disagree" is reporting. "Those people are destroying our country" is Polarization.
- Conditional statements with genuine logical connections. "If you don't study, you may fail the test" is not a False Dichotomy.

- Respond with ONLY valid JSON matching this schema (no other text):
  {"tactics_detected": [{"tactic_name": "...", "definition": "...", "instances": [{"exact_quote": "...", "explanation": "...", "confidence": "high"|"medium", "attribution": "author"|"source", "attributed_to": "...or null if attribution is author"}]}]}
- If no tactics are found, respond with: {"tactics_detected": []}`;
}

function buildUserPrompt(content) {
  return `Analyze the following text for manipulation tactics. Remember: only flag significant, clearly manipulative instances. When in doubt, leave it out.

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
    if (!Array.isArray(detected)) return null;

    return detected
      .filter(t => t.tactic_name && t.definition && Array.isArray(t.instances) && t.instances.length > 0)
      .map(t => ({
        tactic: t.tactic_name,
        definition: t.definition,
        examples: t.instances.map(inst => ({
          text: inst.exact_quote,
          explanation: inst.explanation,
          attribution: inst.attribution === 'source' ? 'source' : 'author',
          attributedTo: inst.attributed_to || null,
          confidence: inst.confidence === 'medium' ? 'medium' : 'high'
        }))
      }));
  } catch {
    return null;
  }
}

// Call Gemini directly (BYOK mode)
async function callGeminiDirect(text, model, apiKey) {
  const tactics = await loadTactics();
  const url = `${CONFIG.GEMINI_API_BASE}/${model}:generateContent`;

  // Flash 2.5 is a thinking model — needs higher output budget for thinking + response.
  // Flash Lite doesn't think, so 4096 is sufficient for the JSON response.
  const maxOutputTokens = model === 'gemini-2.5-flash' ? 8192 : 4096;

  const data = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildSystemPrompt(tactics) }] },
      contents: [{ role: 'user', parts: [{ text: buildUserPrompt(text) }] }],
      generationConfig: { maxOutputTokens }
    })
  });

  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('No response from Gemini');

  const usage = data.usageMetadata;
  return {
    results: parseJsonResponse(content) || [],
    rawResponse: content,
    tokensUsed: (usage?.promptTokenCount || 0) + (usage?.candidatesTokenCount || 0),
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
      result = await callGeminiDirect(text, useModel, settings.apiKey);
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
        totalChars: textResponse.totalChars,
        analyzedChars: textResponse.analyzedChars,
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

  if (status === 401 || status === 403) return 'Invalid API key. Check Settings.';
  if (status === 429) return 'Rate limited. Wait a minute and try again.';
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
