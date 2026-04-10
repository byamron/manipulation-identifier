# Feature History

Detailed documentation of shipped features, organized by development phase.

---

## Phase 14: Analyzing UI & Gemini API Fixes (April 2026)

### Apr 9, 2026 — Consolidate analyzing indicator into animated button & fix Flash 2.5 errors

**Branch:** analyzing-btn-gemini-fix

**What was done:**
1. Replaced the dual "Analyzing" indicators (button text + skeleton cards with timer) with a single animated button. The button shows "Analyzing" with pulsing dots and a shimmer background — no redundant status text below.
2. Fixed Gemini API error cascade: stopped retrying 429 (rate limit) responses, which were compounding when Flash 2.5 returned initial 500 errors.
3. Increased `maxOutputTokens` from 4096 to 8192 for Flash 2.5 (a thinking model that needs budget for both thinking and response tokens). Flash Lite stays at 4096.

**Why:**
- UI: Two "analyzing" indicators were redundant and the static "Analyzing..." text in the button looked stuck. User wanted a single animated indicator.
- API: Flash 2.5 returned "API server error" (500) on first use, then "Rate limited" (429) on retry. Flash Lite worked fine. The retry logic was retrying 429 errors, which made rate limiting worse instead of better.

**Design decisions:**
- Button uses CSS shimmer + animated dots (three `<span>` elements with staggered `dot-pulse` animation). Reuses the existing `shimmer` keyframe from skeleton styles for visual consistency.
- Removed skeleton loading cards entirely — the animated button is sufficient to communicate progress, and streaming results appear below as they arrive.
- Timeout check (45s) kept as a silent interval, only surfacing an error if exceeded.

**Technical decisions:**
- 429 errors now fail immediately without retry. Rate limits need time to clear, not more requests.
- 500 errors still retry (up to 2 times with exponential backoff) since they can be transient.
- Flash 2.5 gets 8192 maxOutputTokens because it's a thinking model — the thinking tokens consume part of the output budget. 4096 was likely too low, causing the model to fail.
- Flash Lite keeps 4096 since it doesn't use thinking tokens.

**Tradeoffs:**
- Not retrying 429 means a single rate limit hit shows an error immediately rather than waiting for retries. This is better UX — the user sees the error faster and knows to wait, rather than staring at a loading state for 6+ seconds before getting the same error.
- 8192 maxOutputTokens for Flash 2.5 allows more thinking tokens, which could marginally increase cost. But the user only pays for tokens generated, not the budget cap, and thinking improves detection quality.

**SAFETY:** Error handling preserved — 429 errors still surface to the user with the same message. Only the retry behavior changed (immediate fail vs. delayed fail). No error paths removed.

**Files changed:** `sidepanel.js`, `sidepanel.css`, `background.js`

---

## Phase 13: Attribution Framework (April 2026)

### Apr 9, 2026 — Quoted speech attribution: distinguish author rhetoric from reported speech

**Branch:** `ux-feedback-round`

**What was done:**
Added an attribution system that distinguishes between manipulation tactics used by the article/author ("author") and tactics present in quoted/reported speech ("source"). The model now classifies each detected instance and identifies who is being quoted when applicable. The UI and page highlights differentiate these visually.

**Why:**
User testing revealed a major class of false positives: the model was flagging quoted speech (e.g., a politician's statement reported by a news article) as manipulation by the article itself. A quote from a politician using emotional language is not the same as the article using emotional language. The user is still exposed to the tactic, so it should be shown — but with different framing and weight.

**Design decisions:**
- **Binary attribution (author/source) rather than a 4-level taxonomy.** Considered breaking out "amplified quote" and "critically examined quote" as separate categories. Decided that amplified = author (the article adopted the rhetoric) and critically examined = don't flag at all (the article is analyzing, not employing). This keeps the schema simple and the model's task clear.
- **Show source-attributed instances, don't suppress them.** The psychological effect of reading manipulative language exists whether it's a direct claim or a quote. But the user needs to know the article isn't the one making that claim.
- **Dimmed visual weight for source-attributed instances.** Dashed border + 50% opacity on page highlights, 70% opacity + dashed left border + attribution label in side panel. Visible but clearly secondary.
- **Default to "author" when attribution is missing.** Backwards-compatible with responses from the old prompt that don't include attribution fields.

**Technical decisions:**
- New prompt instructions (~150 tokens) teach the model the attribution rules with explicit guidance on edge cases (endorsement = author, critical examination = don't flag, uncertain = source).
- New JSON schema fields: `attribution` ("author"|"source") and `attributed_to` (string|null) on each instance.
- Both `parseJsonResponse` (background.js and server.js) normalize the new fields, defaulting to "author" for any unrecognized value.
- 5 new tests covering attribution parsing, default behavior, and streaming preservation.

**Tradeoffs:**
- ~150 extra tokens in the system prompt per request. Acceptable per FB-0001 (cost-conscious) given the significant accuracy improvement.
- The model may not always correctly identify attribution, especially in opinion pieces where editorial voice and quotation blend together. This is a prompt quality issue that will be measured and tuned via the eval harness (item 1.1).
- Selective curation (case 4 — manipulation through the *selection and arrangement* of quotes) is not addressed. The model would need to see full article structure and compare quote selection against available sources, which is beyond the current 5000-char window.

**Files changed:** `background.js`, `server.js`, `content.js`, `sidepanel.js`, `sidepanel.css`, `test/parseJsonResponse.test.js`, `test/streaming.test.js`

---

## Phase 12: Gemini Migration (April 2026)

### Apr 8, 2026 — Switch LLM provider from Anthropic to Google Gemini

**Branch:** gemini-llm-provider

**What was done:**
Replaced the entire Anthropic/Claude integration with Google Gemini across all extension and server files. Default models changed from Claude Sonnet 4.6 / Haiku 4.5 to Gemini 2.5 Flash / Flash Lite 2.5. BYOK mode now calls the Gemini REST API directly from the browser. Server proxy mode uses the `@google/generative-ai` SDK.

**Why:**
Gemini's free tier is substantially better than Anthropic's paid-only API. Flash 2.5 offers 10 RPM / 250 requests per day free, and Flash Lite gives 15 RPM / 1,000 requests per day. This removes the cost barrier for users and aligns with FB-0001 (be cost-conscious — users pay with their own keys).

**Design decisions:**
- Chose Flash 2.5 as default (not Pro) because Pro's free tier is very limited (5 RPM, 100 req/day) and may have been removed from free tier entirely as of April 2026. Flash 2.5 is the sweet spot for quality vs. rate limits.
- Flash Lite 2.5 replaces Haiku as the "faster" option — higher free RPM (15 vs 10) at the cost of some quality.
- Storage key renamed from `anthropicApiKey` to `geminiApiKey`. Existing users will need to re-enter their key.
- Gemini API key validation tests against Flash Lite (cheapest) with `maxOutputTokens: 1`, matching the pattern established for Anthropic.

**Technical decisions:**
- Server uses `@google/generative-ai` SDK (`GoogleGenerativeAI` class) with `getGenerativeModel()` and `generateContent()`. System instructions passed via `systemInstruction` parameter.
- BYOK browser calls use the REST API directly (`generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`) with `x-goog-api-key` header. No SDK needed in the browser — avoids bundling complexity.
- Token counting changed from `input_tokens + output_tokens` (Anthropic) to `promptTokenCount + candidatesTokenCount` (Gemini).
- Response extraction changed from `content[0].text` to `candidates[0].content.parts[0].text`.
- Gemini uses 403 (not 401) for invalid API keys, so error handling checks both 401 and 403.
- Streaming (implemented on main for Anthropic SSE) is removed in this branch — Gemini uses a different streaming format. Non-streaming `fetchWithRetry` is used for BYOK. Gemini streaming can be added as a future enhancement.

**Tradeoffs:**
- Gemini's free tier data may be used to improve Google's products — noted in privacy context. BYOK users should be aware.
- Prompt format unchanged (same system prompt + JSON output schema). Gemini handles the same structured JSON output instructions well. If quality differs, will need prompt tuning via the eval harness (1.0).
- No `anthropic-dangerous-direct-browser-access` equivalent needed — Gemini REST API allows browser calls natively.

**SAFETY:** API key storage key renamed. Error handling preserved for all HTTP status codes. Rate limiting and caching unchanged.

**Files changed:** `server.js`, `background.js`, `options.js`, `options.html`, `sidepanel.html`, `sidepanel.js`, `manifest.json`, `package.json`, `.env.example`, `CLAUDE.md`, `core-docs/spec.md`, `core-docs/plan.md`, `test/parseJsonResponse.test.js`

---

## Phase 11: Infrastructure & Debt Cleanup (April 2026)

### Apr 8, 2026 — Complete Priority 4: Infrastructure & Debt

**Branch:** strip-infra-debt (from 6ab7c26)

**What was done:**
Completed all 6 items in Priority 4 (Infrastructure & Debt):

1. **4.1 — Fix server.js error handler position:** Moved Express error handling middleware from before routes to after all route definitions, where Express requires it to function.
2. **4.2 — Hash cache keys:** Replaced raw 5KB+ string cache keys with SHA-256 hashes using `crypto.createHash()`.
3. **4.3 — Clean up dead files:** Added ownership comments to `prompts.js` (server-only), `tactics.js` (server-only), and `highlight-matcher.js` (test-only; canonical version is in content.js).
4. **4.4 — Update spec.md and benchmarks.md:** Removed GPT model references from benchmarks.md, replaced with current Claude stack and placeholder for eval harness results. Updated spec.md to remove feedback/analytics/SQLite references.
5. **4.5 — Strip dev-only feedback code:** SAFETY — See "Feedback System Teardown" section below for full details.
6. **4.6 — Normalize parseJsonResponse:** Both `background.js` and `server.js` now return `null` on parse failure (previously background.js returned `[]`). Callers handle the null — server.js falls back to regex parser, background.js falls back to empty array.

**Why:**
Priority 4 items are infrastructure debt that should be fixed before scaling. The feedback system in particular was dev-only code that violated "privacy by default" (FB-0003) and had no path to improving detection.

**Design decisions:**
- Kept backward-compat `/analyze-content` endpoint — it's a real analysis route, not feedback.
- `parseJsonResponse` returns `null` uniformly on failure; callers decide the fallback. This separates "parse failed" from "no tactics found" (which returns `[]`).
- `highlight-matcher.js` kept as a separate file (not merged into content.js) because content scripts can't use ES module imports, and the test suite needs the module version.
- Health endpoint simplified to sync (no db queries) — just returns cache size and uptime.

**Tradeoffs:**
- Stripping feedback means no post-release user signal. Accepted because the eval harness (item 1.0) replaces feedback as the measurement tool, and BYOK mode made the feedback endpoints unreachable anyway.
- Duplication between highlight-matcher.js and content.js is accepted and documented rather than eliminated, because content scripts fundamentally can't import ES modules.

#### Feedback System Teardown — Full Context

This section documents the complete feedback system that was removed in 4.5, so future work to reintroduce user feedback has full context on what existed, why it was removed, and what to consider.

**What the feedback system was:**

The system had three layers:

1. **Side panel UI (sidepanel.js + sidepanel.css):**
   - Every tactic card had a "Was this accurate?" button in the `.card-actions` row
   - Clicking it expanded a `.card-feedback` section with:
     - Three rating buttons: Accurate / Inaccurate / Uncertain (`.feedback-btn`)
     - A comment textarea (`.feedback-comment`, placeholder: "Optional comment...")
     - A Submit button (`.feedback-submit`)
   - On submit, a POST was sent to the server's `/submit-instance-feedback` endpoint
   - After submission, the feedback section showed "Thank you for your feedback!" and auto-collapsed after 2 seconds
   - The Escape key could collapse expanded feedback sections

2. **Server endpoints (server.js):**
   - `POST /submit-instance-feedback` — accepted: originalFullText, highlightedText, detectedTactic, modelUsed, userRating (accurate/inaccurate/uncertain), userComments, pageUrl, responseTime, sessionId. Validated required fields and rating values, stored via `dbOperations.recordFeedback()`.
   - `POST /report-missing-manipulation` — accepted: originalFullText, missedText, suggestedTactic, userComments, modelUsed, pageUrl, sessionId, reportedFromFeedbackId. For reporting tactics the model missed.
   - `GET /analytics/model-performance` — aggregated performance stats per model (total requests, success/fail counts, avg response time, avg tokens, avg tactics detected)
   - `GET /analytics/satisfaction` — feedback ratings grouped by model
   - `GET /analytics/tactic-performance[/:model]` — feedback ratings grouped by tactic (optionally filtered by model)
   - `GET /analytics/missing-patterns` — most-reported missed tactics
   - `GET /analytics/recent-performance[/:hours]` — raw performance records for last N hours
   - The `/health` endpoint also queried recent performance from the DB

3. **Database layer (database.js):**
   - Used `better-sqlite3` (SQLite) with WAL mode
   - Three tables:
     - `performance` — model_name, response_time_ms, success, error_message, tokens_used, tactics_detected_count, analysis_complexity_score, session_id, page_url, created_at
     - `feedback` — page_url, original_full_text, highlighted_text, model_used, detected_tactic, user_rating, user_comments, response_time_ms, session_id, feedback_type, created_at
     - `missing_manipulations` — page_url, original_full_text, missed_text, suggested_tactic, user_comments, model_used, session_id, reported_from_feedback_id, created_at
   - Indexes on model_name, created_at, detected_tactic, model_used, suggested_tactic
   - Prepared statements for inserts and parameterized queries for analytics
   - `analyzeContent()` called `dbOperations.recordPerformance()` on every analysis (success and failure), including cached responses

   Helper functions removed from server.js:
   - `generateSessionId()` — `crypto.randomBytes(16).toString('hex')`
   - `calculateComplexityScore(text, tacticsCount)` — weighted score based on text length and tactic count

**Why it was removed (four reasons):**

1. **Broken in the recommended mode.** BYOK mode (users provide their own API key) talks directly to Anthropic — no server involved. The feedback UI submitted to the server, so in BYOK mode, feedback submissions silently failed. Since BYOK is the recommended and primary mode, the feature was effectively dead for most users.

2. **No feedback loop.** Data went into SQLite but nothing read it back to improve detection. The analytics endpoints existed but had no consumer. There was no process for reviewing feedback, no way to incorporate it into prompt tuning, and no pipeline from user ratings to model improvement.

3. **Privacy violation.** The project's core principle is "privacy by default — text stays between the user and the API; no telemetry, no data collection." Storing analyzed page text and user feedback in a SQLite database contradicts this. User direction (FB-0003) explicitly required removal before release.

4. **Replaced by a better measurement tool.** The eval harness (`npm run eval`, item 1.0) provides systematic measurement: 119 labeled test cases with precision/recall/F1 scoring, versioned prompts, and side-by-side comparison. This is more rigorous than user feedback for prompt tuning, and it runs at development time with no user data involved.

**What was removed (complete inventory):**

| Component | What | Lines removed |
|-----------|------|--------------|
| `database.js` | Entire file deleted — SQLite setup, 3 tables, prepared statements, 7 query functions | ~200 |
| `package.json` | `better-sqlite3` dependency | 1 |
| `server.js` endpoints | `/submit-instance-feedback`, `/report-missing-manipulation`, 7 `/analytics/*` routes | ~180 |
| `server.js` helpers | `generateSessionId()`, `calculateComplexityScore()`, all `dbOperations.*` calls in `analyzeContent()` | ~40 |
| `server.js` health | DB query in `/health` endpoint replaced with simple sync response | ~15 |
| `sidepanel.js` HTML | "Was this accurate?" button, `.card-feedback` div with rating buttons, textarea, submit | ~15 |
| `sidepanel.js` handlers | Feedback toggle, button selection, submit (with server POST), thank-you message | ~50 |
| `sidepanel.js` keyboard | Escape key handler for `.card-feedback.expanded` | 1 |
| `sidepanel.css` | `.card-feedback`, `.feedback-options`, `.feedback-btn`, `.feedback-comment`, `.feedback-submit`, `.feedback-thanks` styles, `--success` CSS variable | ~100 |
| `options.html` | "Analytics Server" section retitled to "Server Proxy", hint text updated | 2 |

**Git reference:** The last version with the complete feedback system is commit `6ab7c26` on the `strip-infra-debt` branch (the parent of this work). The full `database.js` file, all endpoints, and all UI code can be recovered from that commit.

**If reintroducing feedback in the future, consider:**

1. **BYOK compatibility.** Any feedback mechanism must work without a server. Options: (a) store feedback locally in Chrome storage and expose a "export feedback" action, (b) use a lightweight cloud endpoint (not the Express server), (c) make feedback opt-in with a clear privacy disclosure.

2. **Privacy-first design.** Don't store the full analyzed text. Store only: tactic name, rating, optional comment, timestamp. If the full text is needed for ground-truth corpus building, make it an explicit opt-in with clear language about what's stored and where.

3. **Close the feedback loop.** The previous system stored data with no consumer. Any reintroduction should have a concrete plan for how feedback improves detection — e.g., flagged inaccurate detections feed into the eval corpus, or aggregated tactic accuracy rates surface in the eval dashboard.

4. **UI weight.** The previous "Was this accurate?" button appeared on every card, adding visual noise. Consider: (a) a single "Report a problem" action per analysis session instead of per-card, (b) a thumbs-up/down that's less intrusive than three buttons + textarea, (c) feedback only on first use or periodically, not every time.

5. **Separation of concerns.** Keep feedback storage separate from the analysis server. The Express backend should remain a pure analysis proxy. Feedback could use a separate service, local storage, or a simple cloud function.

---

## Phase 10: Core UX (April 2026)

### Apr 8, 2026 — Review pass: fix streaming reliability, UX, and test coverage

**Branch:** core-ux-improvements — `a542548`

**What was done:**
Staff-level review across engineering, design, and design engineering perspectives identified 13 issues. All were fixed:

*Streaming reliability (SAFETY):*
- **Timeout reset on each chunk:** The 30s AbortController timeout now resets on every received SSE event, preventing legitimate long streams from being killed.
- **Reader cleanup:** `reader.cancel()` is called in a `finally` block to release the HTTP connection on error or completion.
- **Retry for initial fetch errors:** New `fetchStreamWithRetry` function retries 5xx/429 errors with exponential backoff, matching the behavior of the non-streaming `fetchWithRetry`. Previously, streaming had zero retry — a silent reliability regression.

*Stage timestamp fix (SAFETY):*
- Analysis status now stores a stable `startedAt` timestamp alongside the per-stage `timestamp`. The side panel uses `startedAt` for elapsed time display and timeout checks, so tab re-entry shows correct elapsed time.

*Streaming UX rebuild:*
- **Append-only rendering:** New streaming cards are appended via `insertAdjacentHTML` instead of replacing all of `resultsArea.innerHTML`. Scroll position, text selection, and existing card animations are preserved.
- **Skeleton collapse:** On first streaming result, the full skeleton is replaced with a compact timer-only status line.
- **150ms debounce:** Rapid streaming updates are batched to prevent excessive DOM writes.
- **Non-interactive affordance:** Streaming cards suppress the pointer cursor on quotes (via `.non-interactive` class) since click-to-scroll is only available after analysis completes.

*Card HTML deduplication:*
- Single `renderTacticCard(tactic, { interactive })` function used by both `showResults` and `applyStreamingResults`. Interactive flag controls click handlers, learn-more, and feedback sections.

*Highlight CSS:*
- Bumped highlight opacity from 0.18 to 0.25 (0.22 for red) for better visibility on light backgrounds.
- Removed redundant base `.mi-highlight` color rules — the base class now only sets layout/transition, category classes provide all color.
- Added cross-reference comment noting `sidepanel.css` as the source of truth for RGB values.

*Test coverage:*
- 15 new tests for `extractCompleteTactics` (escaped quotes, nested braces, partial streams, empty arrays, multi-instance, markdown fences) and SSE parsing (malformed JSON, orphan data lines, empty stream). Total: 72 tests, all pass.

**Why:**
The initial implementation had real bugs (timeout killing streams, no retry, wrong elapsed time on tab switch) and UX problems (full DOM replacement causing flicker and scroll loss during streaming, broken click affordance). A review pass before merge caught all of these.

**Tradeoffs:**
- `fetchStreamWithRetry` only retries the initial connection, not mid-stream failures. Reconnecting a partial stream would require tracking the last received position, which is not supported by the Anthropic API.
- The 150ms debounce adds slight latency to streaming card appearance. This is preferable to jank from rapid DOM updates.

---

### Apr 7, 2026 — Streaming responses, category highlights, icon badge, progress stages

**Branch:** core-ux-improvements — `a542548`

**What was done:**
Implemented all four Priority 2 (Core UX) items:
1. **Streaming API responses (2.1):** BYOK mode now uses Anthropic's streaming API (`stream: true`). An SSE parser reads `content_block_delta` events, accumulates text, and extracts complete tactic objects incrementally using bracket-depth tracking. Partial results are stored to session storage, and the side panel renders tactic cards as they arrive — transforming a 5-30s dead wait into progressive reveal.
2. **Category-colored page highlights (2.2):** Replaced uniform yellow highlights with category-specific colors: blue (`rgba(91, 156, 245, 0.18)`) for logical fallacies, orange (`rgba(232, 148, 58, 0.18)`) for rhetorical manipulation, red (`rgba(239, 83, 80, 0.18)`) for credibility attacks. Each has matching hover and active states.
3. **Extension icon badge (2.3):** After analysis, the extension icon shows the number of detected tactics as a red badge. Badge clears when highlights are cleared.
4. **Analysis progress stages (2.4):** The analyzing state now shows stage-specific text: "Collecting text..." → "Analyzing with Claude..." → "Processing results..." Stage transitions are stored in session storage and the side panel updates without resetting the elapsed timer.

**Why:**
These four items transform the UX from "it works" to "this is good." Streaming eliminates perceived latency, category colors let users scan the manipulation landscape at a glance, the badge provides ambient awareness, and progress stages reduce uncertainty during analysis.

**Design decisions:**
- Streaming uses raw `fetch` + `ReadableStream` instead of the Anthropic SDK because the background service worker can't load npm packages. The SSE parser is a simple async generator that handles chunked reads.
- Incremental JSON parsing uses bracket-depth tracking to find complete `{"tactic_name": ...}` objects rather than attempting to parse the entire accumulated string. This avoids repeated parse failures on incomplete JSON.
- Partial results are written to session storage with a `streaming: true` flag so the side panel can distinguish incremental updates from final results and render accordingly (simplified cards without click-to-scroll during streaming, full cards with actions after completion).
- Category highlight colors use semi-transparent RGBA values that work on both light and dark page backgrounds, matching the plan spec exactly.

**Technical decisions:**
- `callAnthropicDirect` now accepts an `onPartialResults` callback, keeping the streaming logic decoupled from the storage/UI emission.
- `TACTIC_CATEGORIES` is inlined in `content.js` (duplicated from `shared.js`) because content scripts can't use `importScripts`.
- `parseSSEStream` is an async generator that yields parsed events, allowing `for await...of` consumption — clean separation between SSE framing and business logic.
- Progress stages use `chrome.storage.session` rather than message passing so the side panel's existing `onChanged` listener handles them with zero new infrastructure.

**Tradeoffs:**
- Streaming only works in BYOK mode. Server proxy mode still uses the non-streaming `fetchWithRetry` path because the server's `/analyze-content-with-model` endpoint doesn't support streaming. This is acceptable since BYOK is the recommended mode.
- The streaming error path does not retry (unlike `fetchWithRetry`). If the initial request fails with 5xx/429, it throws immediately. Retry with streaming would require re-establishing the stream, which adds complexity for a rare case.
- `extractCompleteTactics` re-scans the full accumulated text on each delta. For typical responses (<10 tactics), this is negligible. A production optimization would track the last scan position.

---

## Phase 9: Polish & Completeness (April 2026)

### Apr 7, 2026 — Ship Priority 3: Polish & Completeness (3.1–3.7)

**Branch:** polish-and-completeness

**What was done:**
Implemented all seven Priority 3 items to make the product feel finished:

1. **3.1 Options page dark theme** — Rewrote inline `<style>` in `options.html` to use the same dark palette, monospace typography, surface colors, and border styles as `sidepanel.css`. Also corrected the server section hint (was "feedback and analytics", now "analysis requests are proxied").
2. **3.2 First-run onboarding** — Replaced the three-paragraph setup message with a one-line description ("Detects manipulation tactics...") and a CTA link, per FB-0002.
3. **3.3 Humanize model selector** — Changed labels from "Sonnet 4.6" / "Haiku 4.5" to "Thorough (Sonnet)" / "Quick (Haiku)" in both sidepanel.html and options.html.
4. **3.4 Quote click affordance** — Added a subtle underline to `.instance-quote` that intensifies to accent color on hover, making quotes visually clickable.
5. **3.5 Improved empty state** — Rewrote `showEmpty()` with positive framing ("looks clean") and a suggestion to try opinion pieces.
6. **3.6 Category legend** — Added a row of three colored dots with labels (Logical, Rhetorical, Credibility) below the results summary.
7. **3.7 Keyboard shortcut** — Added a platform-aware shortcut hint (`Cmd+Shift+M` on Mac, `Ctrl+Shift+M` elsewhere) to the ready state message with styled `<kbd>` element.

**Why:**
These items were the "feel finished" layer — the gap between "it works" and "this is a product." The options page dark theme was the most impactful since it's the first thing new users see during setup.

**Design decisions:**
- Options page reuses the exact color values from sidepanel.css (not CSS custom properties) because options.html uses inline styles and doesn't import sidepanel.css. This means the palette is duplicated, but the two pages are visually consistent.
- Onboarding kept to two lines per FB-0002's "product should be self-explanatory" rule.
- Model labels use "Thorough/Quick" as the primary descriptor with model name in parentheses, balancing accessibility for non-technical users with clarity for technical ones.
- Quote affordance uses a permanent subtle underline (not hover-only) because hover-only affordance is invisible until interaction, defeating the purpose.
- Empty state keeps it brief — positive framing without over-explaining what "no results" means.

**Tradeoffs:**
- Duplicating color values between options.html and sidepanel.css is tech debt. A shared CSS file or CSS custom properties in a shared sheet would be cleaner, but options.html's inline `<style>` makes that impractical without a build step.
- The keyboard shortcut detects platform via `navigator.platform` to show `Cmd` (Mac) or `Ctrl` (Windows/Linux). `navigator.platform` is deprecated but still reliable in Chrome extension contexts; the modern async alternative isn't worth the complexity.

**Files changed:** `options.html`, `sidepanel.html`, `sidepanel.js`, `sidepanel.css`

---

## Phase 8: Accuracy Measurement System (April 2026)

### Apr 8, 2026 — Build evaluation harness and test corpus (item 1.0)

**Branch:** eval-harness-corpus | **Commit:** `148d253`

**What was done:**
Built the complete evaluation harness and 119-file test corpus for measuring manipulation detection accuracy. This is the measurement infrastructure that all prompt tuning (item 1.1) depends on.

Files created:
- `eval/harness.cjs` — Main runner: reads corpus, calls Anthropic API (rate-limited 1 req/sec), scores results
- `eval/scorer.cjs` — Scoring logic: character overlap matching (50% threshold), precision/recall/F1 per-tactic and overall, quote fidelity
- `eval/reporter.cjs` — Console table output + JSON result persistence to `eval/results/`
- `eval/compare.cjs` — Side-by-side metric comparison between two eval runs
- `eval/prompts/v1.cjs` — Baseline prompt extracted from production (reads tactics.json directly)
- 119 corpus files in `eval/corpus/`: 45 tactic-specific (3 per tactic: textbook, variation, real-world-style), 34 benchmark ports (format/content/real-world political), 15 multi-tactic passages, 15 clean text (false positive controls), 10 ambiguous edge cases

Files modified:
- `package.json` — Added `eval` and `eval:compare` scripts
- `.gitignore` — Added `eval/results/*.json`

Usage: `npm run eval`, `npm run eval -- --prompt eval/prompts/v2.cjs`, `npm run eval -- --filter "emotional"`, `npm run eval -- --model claude-haiku-4-5-20251001`, `npm run eval:compare file1.json file2.json`

**Why:**
The prompt is the single biggest lever for detection quality, but there was no way to measure whether changes help or hurt. Per-tactic precision/recall, overall F1, and quote fidelity metrics are needed before any tuning work can begin. Without this, prompt changes are guesswork. This was explicitly identified as the prerequisite for items 1.1 through 1.4 and for stripping the dev-only feedback system (4.5).

**Design decisions:**
- Used `.cjs` extension for all eval files because `package.json` has `"type": "module"` — CommonJS files need the explicit extension to be parsed correctly by Node.js. This avoids the alternative of adding complex ESM-to-CJS interop.
- Reads `tactics.json` directly (via `require()`) instead of importing `tactics.js` (which is ESM). This avoids module compatibility issues and keeps the eval harness self-contained.
- One JSON file per corpus example (not a monolithic file) for easy diffing, reviewing, and extending — same rationale as documented in the Apr 7 planning entry.
- Ambiguous edge cases (10 files) are reported separately and excluded from headline metrics to avoid contested annotations distorting precision/recall numbers.

**Technical decisions:**
- Scorer uses longest common substring for character overlap calculation — more robust than token-level or word-level matching because it handles partial quotes and minor rephrasing without artificial tokenization boundaries.
- Greedy matching algorithm (best overlap first) prevents a poor match from "claiming" a prediction and blocking a better match from being recognized. Without this, match order could suppress true positives.
- Quote fidelity returns 1.0 for clean texts (no predictions = no failures). This prevents clean-text files from artificially inflating or deflating the quote fidelity metric.
- Rate limited to 1 request per second to avoid Anthropic API rate limits and to keep eval run costs predictable (119 calls at current Sonnet pricing).

**Tradeoffs:**
- 50% character overlap threshold is a judgment call. Too strict penalizes minor rephrasing by the model; too loose lets actual misquotes pass as matches. The threshold can be tuned after seeing initial baseline results, but 50% was chosen as a conservative starting point that allows substantial but not arbitrary deviation from the annotation.
- Corpus size of 119 examples is a balance: large enough for per-tactic metrics to be statistically meaningful (3+ examples per tactic), small enough that a solo developer can annotate and maintain them, and cheap enough to run frequently (~119 API calls per eval run).
- The eval prompt (`v1.cjs`) reads `tactics.json` directly rather than reusing the extension's `buildSystemPrompt()` function from `background.js`. This creates slight divergence risk (if the production prompt changes and v1.cjs doesn't), but avoids pulling in Chrome extension APIs that don't exist in a Node.js context. The tradeoff is acceptable because eval prompts are versioned and compared explicitly.
- `.gitignore` excludes `eval/results/*.json` to avoid committing potentially large result files. The downside is that baseline results must be shared manually or re-generated, but this prevents accidental commits of verbose JSON output.

---

### Apr 7, 2026 — Plan accuracy measurement and prompt tuning system

**Branch:** sidebar-ui-restyle

**What was done:**
Designed a 5-phase plan for systematic accuracy measurement: (1) labeled test corpus (~120 examples), (2) evaluation harness (`npm run eval`), (3) prompt tuning workflow with versioned prompts, (4) strip all dev-only feedback code from shipped extension, (5) documentation updates.

**Why:**
The feedback system (database.js, server analytics, feedback UI) was built for development but has no path to improving detection — it just stores data. The user decided feedback should not ship (privacy by default), so the project needs a proper development-time measurement system instead.

**Design decisions:**
- Precision over recall as the primary metric, reflecting "accuracy over coverage — only flag with high confidence" product principle. Targets: precision >= 85%, recall >= 65%.
- Quote fidelity tracked as a separate metric because non-verbatim quotes break the highlighting system.
- Ambiguous corpus cases excluded from headline metrics to avoid contested annotations distorting numbers.
- Test corpus format: one JSON file per example (not monolithic) for easy diffing, reviewing, and extending.
- Evaluation harness reuses the same prompt/parse functions as the extension, not a reimplementation.

**Tradeoffs:**
- Chose ~120 examples as corpus size — large enough for per-tactic metrics to be meaningful, small enough for a solo developer to annotate and maintain. Each API call costs money, so the corpus can't be arbitrarily large.
- 50% character overlap threshold for quote matching is a judgment call — too strict penalizes minor rephrasing, too loose lets misquotes pass. Can be tuned after seeing initial results.
- Stripping feedback UI means no post-release signal. Acceptable because the prompt is universal (not personalized) and the eval harness provides the measurement loop during development.

---

## Phase 7: UI Restyle & Bug Fixes (April 2026)

### Apr 7, 2026 — Restyle sidebar with DevPanel-inspired dark glass aesthetic

**Branch:** sidebar-ui-restyle

**What was done:**
Rewrote sidepanel.css to adopt a dark, glass-morphism design language inspired by the DevPanel component from the ui-playground repo. The new style features a dark background (`#0e0e11`), monospace typography (SF Mono/Cascadia Code) for labels and metadata, a white-alpha color system for text and borders, tighter spacing (14px gaps), refined category accent colors tuned for dark backgrounds, thin scrollbar styling, and subtle interaction states using 0.12s transitions. All existing HTML structure and class names preserved — no JS changes needed.

**Why:**
The previous sidebar used a stock light-theme with generic Google Blue accents and system sans-serif fonts. The DevPanel's aesthetic — used across the ui-playground demos — has a more refined, technical character that better suits a power-user tool for identifying manipulation tactics.

**Design decisions:**
- Adopted a fully dark theme rather than adapting the DevPanel's glass morphism over a light background. The sidebar is a standalone panel (not overlaid on content), so solid dark with subtle raised surfaces reads better than transparency.
- Used CSS custom properties (27 tokens in `:root`) for the entire color/spacing system, making future theme tweaks trivial.
- Kept the sans-serif font (system stack) for body/content text but switched labels, buttons, metadata, and summaries to the DevPanel's monospace stack. This creates the same information hierarchy the DevPanel uses.
- Kept category color bars at 3px width (same as original) with tuned-for-dark accent colors. Removed opacity modifiers to maintain scanability — the bars are the primary visual differentiator when skimming results.

**Technical decisions:**
- Custom select dropdown arrow via inline SVG data URI to replace the browser default (which renders poorly on dark backgrounds).
- Thin scrollbar styling via both `scrollbar-width: thin` (Firefox) and `::-webkit-scrollbar` (Chromium) for consistency.
- Error states use red-alpha overlays instead of the previous solid `#fef2f2` light background.

**Tradeoffs:**
- Dark-only for now — no light mode toggle. The DevPanel is dark-only too. A future preference toggle could use the CSS custom properties to swap palettes.
- The monospace font stack (`SF Mono`, `Cascadia Code`, `Fira Code`) may not be installed on all systems; `ui-monospace` and `monospace` serve as fallbacks but render differently per OS.

### Apr 7, 2026 — Fix cross-node highlighting, fuzzy matching, and side panel scroll

**Branch:** review-plugin-functionality

**What was done:**
Fixed four bugs that degraded the extension's core UX:
1. **Cross-node quote matching**: Rewrote highlighting to use "text runs" — groups of text nodes under the same block-level ancestor. Quotes spanning inline elements (bold, links, italic) now highlight correctly across multiple DOM nodes.
2. **3-tier fuzzy matcher**: Inlined the trigram-based fuzzy matcher from `highlight-matcher.js` into the content script (replacing the simpler 2-tier exact+normalized matcher). Quotes with minor formatting variations now match via Jaccard trigram similarity (threshold 0.85).
3. **Side panel → page scroll**: Fixed broken `findAndScrollToHighlight` action (unhandled by content script) and incorrect `findHighlightIndex` mapping. Side panel now sends `SCROLL_TO` with `tactic` + `instanceIndex` directly to the content script, which resolves highlights by querying `[data-tactic]` attributes.
4. **Multi-span highlight support**: `scrollToHighlight` now activates all spans sharing a highlight ID (for quotes that span multiple text nodes). Click handlers on highlights do the same.

Also fixed: redundant ternary in `clearHighlights`, removed dead `findHighlightIndex` and `data-first-highlight-id`.

**Why:**
The extension's highlighting and navigation were broken in several compounding ways. Quotes crossing inline formatting boundaries (extremely common on real web pages) silently failed to highlight. Clicking a quote in the side panel sent an action the content script didn't handle, and the fallback used a highlight-ID mapping that assumed tactic-card order matched DOM order (it doesn't). These bugs meant the core feature — see manipulation highlighted on the page and navigate between side panel and highlights — didn't work reliably.

**Design decisions:**
- **Text runs over full-page concatenation**: Rather than concatenating the entire page text and matching globally, we group text nodes by their nearest block-level ancestor. This keeps match positions accurate (no cross-paragraph false matches) while enabling cross-node matching within the same paragraph/heading/list-item.
- **Inline fuzzy matcher over module import**: Content scripts can't use ES module imports. The highlight-matcher.js file used `export` syntax and was never loaded. Inlining the functions into content.js was the only viable option without a build step.
- **Direct `chrome.tabs.sendMessage` from side panel**: The side panel now sends scroll messages directly to the content script instead of routing through background.js. This removes the broken background.js forwarder from the critical path and is simpler.
- **Shared highlight IDs for cross-node spans**: When a quote spans multiple text nodes, all resulting `<span>` elements share the same `data-highlight-id`. This lets `scrollToHighlight` and click handlers treat them as a single logical highlight.

**Technical decisions:**
- `BLOCK_TAGS` set includes all HTML block-level elements to correctly partition text runs
- `scrollToInstance` deduplicates highlight IDs (since one match may produce multiple spans) before indexing by instance number
- `SCROLL_TO` message handler accepts either `{ highlightId }` (backward compat with background.js forwarder) or `{ tactic, instanceIndex }` (new path from side panel)

**Tradeoffs:**
- The text-runs approach won't match quotes that span across block boundaries (e.g., across two paragraphs). This is intentional — cross-paragraph quotes from the LLM are likely extraction errors.
- Inlining the fuzzy matcher duplicates code between content.js and highlight-matcher.js. Acceptable until a build step is introduced. The canonical version remains in highlight-matcher.js (tested), and content.js is the runtime copy.
- Trigram fuzzy matching has O(n*m) complexity but is bounded by the 5000-char text limit and typically short-circuits at tier 1 or 2.

---

## Phase 6: API Provider Migration (April 2026)

### Apr 1, 2026 — Complete server-side Anthropic migration

**Branch:** fix-anthropic-analysis | **Commit:** 828762e

**What was done:**
Migrated the server proxy path (server.js) from OpenAI SDK to Anthropic SDK, completing the API migration that PR #2 started on the client side. The server now uses `@anthropic-ai/sdk`, accepts Claude model names, calls `anthropic.messages.create()`, and handles Anthropic-specific response/error formats. Also updated prompts.js to include JSON output instructions in the system prompt (replacing the removed OpenAI JSON schema), removed dead legacy prompt code, and updated CLAUDE.md.

**Why:**
PR #2 migrated the BYOK (client-side) path to Anthropic but left the server proxy path on OpenAI. This caused two failures: (1) the server rejected Claude model names sent by the extension, and (2) even if model validation passed, the server would try to call OpenAI's API with an Anthropic key. Users without a BYOK key configured saw "Could not reach the server."

**Design decisions:**
- Used the official `@anthropic-ai/sdk` npm package rather than raw fetch, to match the project's existing pattern of using an SDK for the server.
- Added JSON output instructions directly to `promptRoleSystem` in prompts.js (matching the pattern already used in background.js for BYOK mode). This replaces the OpenAI `response_format.json_schema` approach.
- Kept the legacy regex parser (`parseAnalysisResponse`) as a fallback in case JSON parsing fails.

**Technical decisions:**
- Anthropic SDK's `messages.create()` uses `system` as a top-level parameter, `content[0].text` for response text, and `usage.input_tokens + usage.output_tokens` for token counting.
- Added markdown fence stripping to server's `parseJsonResponse` (matching background.js) since Anthropic may wrap JSON in code fences.
- Error handling maps Anthropic HTTP status codes (401, 402, 429) instead of OpenAI error codes.
- Removed `analysisJsonSchema` from prompts.js and `promptRoleUser` legacy export (both dead code).

**Tradeoffs:**
- The `.env.example` file could not be auto-updated (blocked by a pre-commit hook on .env files). Users must manually rename `OPENAI_API_KEY` to `ANTHROPIC_API_KEY`.
- Replaced `openai` npm dependency with `@anthropic-ai/sdk`, which is a breaking change for anyone running the server with `OPENAI_API_KEY` in their `.env`.

---

### Apr 1, 2026 — Migrate BYOK from OpenAI to Anthropic API

**Branch:** byo-api-key-analysis | **Commit:** `6a55d88`

**What was done:**
Replaced the entire OpenAI integration with Anthropic's Claude API across all extension files (background.js, manifest.json, options.html, options.js, sidepanel.html, sidepanel.js). Default model changed from GPT-5-nano to Claude Sonnet 4.6, with Claude Haiku 4.5 as the lightweight alternative.

**Why:**
Anthropic's Claude models offer stronger reasoning for manipulation detection tasks. Moving to Anthropic also aligns the extension with the project's broader tooling.

**Design decisions:**
- Switched from OpenAI's structured output (JSON schema in `response_format`) to prompt-based JSON instructions with markdown fence stripping. Anthropic doesn't support OpenAI-style structured output, so JSON format is requested in the system prompt and `parseJsonResponse` strips code fences defensively.
- API key validation in options.js now sends a minimal real request (`max_tokens: 1`) instead of hitting a free models endpoint. Anthropic has no equivalent free validation endpoint; cost per test is negligible.
- Removed the `ANALYSIS_SCHEMA` constant entirely rather than keeping it as dead code.

**Technical decisions:**
- Anthropic requires `system` as a top-level field (not a message role), `max_tokens` (required), and specific headers (`x-api-key`, `anthropic-version`, `anthropic-dangerous-direct-browser-access` for BYOK browser calls).
- Token counting changed from `total_tokens` to `input_tokens + output_tokens` (Anthropic splits them).
- Storage key renamed from `openaiApiKey` to `anthropicApiKey` across all files.
- `host_permissions` updated from `api.openai.com` to `api.anthropic.com` in manifest.

**Tradeoffs:**
- Losing OpenAI's guaranteed JSON schema enforcement in exchange for broader model choice. Mitigated by the existing `try/catch` in `parseJsonResponse` which returns `[]` on parse failure.
- Breaking change for existing users who had an OpenAI key saved — their stored `openaiApiKey` will be ignored. Acceptable since this is pre-release.

---

## Phase 5: Infrastructure Standardization (April 2026)

### Apr 1, 2026 — Standardized Project Infrastructure

**Branch:** main | **Commits:** `161f03d`, `d4d20fc`

**What was done:**
Migrated project documentation and Claude Code configuration to standardized template structure. Merged the `review-next-steps` branch (Side Panel, BYOK, JSON structured output) into main.

**Why:**
The project had grown organically with `core-documentation/` naming, no CLAUDE.md, no agent definitions, and no automated rules. Standardizing enables consistent agent workflows, automatic rule enforcement, and a clear entry point for any contributor or agent session.

**Design decisions:**
- Renamed `core-documentation/` → `core-docs/` to match template convention. Used `git mv` to preserve file history.
- Created CLAUDE.md with project-specific content (not template placeholders): actual tech stack, product principles, quality bar with concrete targets (30s timeout, 56+ tests).
- Skipped template files that don't apply: `ui.md` rule (not a design-system app), `dev-server.md` rule, `design-language.md` (Chrome extension CSS, not tokens), `link`/`dev-panel`/`setup` skills.

**Technical decisions:**
- Safety rule scoped to `server.*`, `database.*`, `background.*`, `manifest.json` — the files where mistakes leak API keys or break the extension silently.
- Excluded `.claude/forge/` from version control (ephemeral cache).
- Adapted all 5 agent specs to reference this project's actual files (sidepanel.js, shared.js, highlight-matcher.js, etc.) rather than generic template paths.

**Tradeoffs:**
- feedback.md was reformatted from the old "what went wrong" template to the FB-XXXX format. No existing entries were lost (file had none). New format is more structured but requires more fields per entry.
- Merged review-next-steps directly to main rather than via PR — the branch was already code-reviewed and all 56 tests pass.

---

## Phase 1: Initial Project Setup (April 2025)

### Apr 8, 2025 — Initial Extension Setup & Keyword Highlighting

**What was shipped:**
Basic Chrome extension structure with manifest.json, content script injection, and simple keyword-based highlighting.

**Why it was built:**
Foundation needed to inject code into web pages and begin experimenting with text analysis approaches.

**Key design decisions:**
- Chose Manifest V3 for future-proofing (Chrome deprecating V2)
- Content script runs at `document_idle` to avoid blocking page load
- Started with keyword matching as simplest possible detection approach

**Technical decisions:**
- Chrome Extension architecture (content script + background service worker)
- All URLs permission for universal page access

---

### Apr 26, 2025 — OpenAI API Integration

**What was shipped:**
Backend server with OpenAI API connection for AI-powered text analysis.

**Why it was built:**
Keyword matching was too simplistic; needed AI to understand context and nuance of manipulation tactics.

**Key design decisions:**
- Separate backend server rather than direct API calls from extension (security)
- Express.js for simplicity and rapid development
- Environment variables for API key management

**Technical decisions:**
- Node.js + Express server architecture
- OpenAI SDK for API communication
- CORS enabled for extension communication

---

## Phase 2: LLM Integration (April–May 2025)

### May 5, 2025 — Manipulation Tactics Database

**What was shipped:**
Comprehensive tactics.json with 11 manipulation tactics, definitions, examples, and countermeasures.

**Why it was built:**
Needed structured knowledge base for the AI to reference when analyzing text.

**Key design decisions:**
- JSON format for easy parsing and extension access
- Included "why" explanations to help AI understand manipulation mechanisms
- Added "whatToDo" for educational user guidance

**Technical decisions:**
- Flat JSON array structure (simple, no nesting complexity)
- Web-accessible resource in manifest for content script access

---

### May 10, 2025 — Tactics JSON Conversion

**What was shipped:**
Fixed service worker compatibility issues with tactics loading.

**Why it was built:**
Manifest V3 service workers have restrictions on file access; needed proper loading mechanism.

**Technical decisions:**
- Proper async loading pattern for service worker environment
- Web-accessible resources configuration

---

### May 19, 2025 — Core Analysis Loop

**What was shipped:**
Working end-to-end flow: text selection → API call → manipulation detection → response display.

**Why it was built:**
Connected all components into functional analysis pipeline.

**Key design decisions:**
- User-initiated analysis (not automatic) to respect user control
- Async message passing between content script and background

**Technical decisions:**
- Chrome runtime messaging API for component communication
- Promise-based async flow

---

### May 27, 2025 — Popup Messaging System

**What was shipped:**
Browser action popup to display analysis results.

**Why it was built:**
Needed UI surface to show analysis results to user.

**Key design decisions:**
- Simple popup approach initially (later replaced by widget)

---

### May 28, 2025 — Functional Text Highlighting & LLM Display

**What was shipped:**
Visual highlighting of analyzed text and proper display of LLM analysis results.

**Why it was built:**
Users needed visual feedback showing what text was analyzed and what was found.

**Technical decisions:**
- CSS-based highlighting with custom classes
- Formatted display of tactic names and explanations

---

## Phase 3: Widget-Based UI Migration (June 2025)

### Jun 2, 2025 — Widget-based UI Migration

**What was shipped:**
Replaced popup with floating widget that appears near selected text.

**Why it was built:**
Popup required clicking browser action; widget provides more natural, contextual UX.

**Key design decisions:**
- Widget floats near text selection (contextual placement)
- Non-intrusive design that doesn't block content
- Tradeoff: More complex positioning logic vs. better user experience

**Technical decisions:**
- Shadow DOM for style isolation from host page
- Absolute positioning based on selection coordinates
- Z-index management to stay above page content

---

### Jun 5, 2025 — Widget Animations & API Key Security

**What was shipped:**
Smooth widget animations and moved API key to secure storage.

**Why it was built:**
Polish for production readiness; security improvement for API key handling.

**Key design decisions:**
- CSS transitions for professional feel
- Options page for user API key entry
- Tradeoff: User must configure key vs. exposing key in code

**Technical decisions:**
- Chrome Storage API for secure key storage
- CSS keyframes for entrance/exit animations

---

### Jun 6, 2025 — Click-based Tooltips & Positioning

**What was shipped:**
Changed from hover-triggered to click-triggered tooltips; improved positioning algorithm.

**Why it was built:**
Hover tooltips were accidentally triggered; click provides intentional interaction.

**Key design decisions:**
- Click-to-show is more intentional than hover
- Smart positioning to stay within viewport bounds
- Tradeoff: Extra click required vs. fewer accidental triggers

**Technical decisions:**
- Click event listeners instead of mouseenter/mouseleave
- Viewport boundary detection for positioning

---

## Phase 4: Production Polish (August 2025)

### Aug 11, 2025 — Frosted Glass Styling & Close Behavior

**What was shipped:**
Visual refresh with frosted glass aesthetic; improved widget close behavior.

**Why it was built:**
Restarting active development; modernizing visual design.

**Key design decisions:**
- Frosted glass effect for modern, polished appearance
- Clear close affordance for dismissing widget
- Tradeoff: Backdrop-filter not supported in all browsers, but degrades gracefully

**Technical decisions:**
- CSS `backdrop-filter: blur()` for frosted effect
- Explicit close button with click handler

---

### Aug 12, 2025 — Widget Flash Fix

**What was shipped:**
Fixed widget briefly appearing on page load before being needed.

**Why it was built:**
Flash of widget on load was jarring and unprofessional.

**Technical decisions:**
- Initial hidden state in CSS
- Only show widget after explicit user action

---

### Aug 12, 2025 — Navigation System & Manual Click Fix

**What was shipped:**
Navigation between multiple detected tactics; fixed manual click analysis triggering.

**Why it was built:**
Multi-tactic results needed way to browse; click analysis wasn't working reliably.

**Key design decisions:**
- Arrow navigation for browsing multiple results
- Counter showing current position (e.g., "2 of 5")

**Technical decisions:**
- State management for current tactic index
- Event delegation for navigation controls

---

### Aug 12, 2025 — A/B Testing System & UI Cleanup

**What was shipped:**
Comprehensive UI polish and A/B testing infrastructure.

**Why it was built:**
Final production polish; infrastructure for future UX experimentation.

**Key design decisions:**
- Clean, consistent visual hierarchy
- A/B test framework for data-driven decisions

**Technical decisions:**
- Feature flag system for A/B variants
- Analytics hooks for measuring engagement
