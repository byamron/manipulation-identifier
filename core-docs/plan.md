# Project Tracker

## Current Focus

Priority 1 — Accuracy & Trust (items 1.0–1.4). Build eval harness and test corpus, then tune prompt.

## Handoff Notes

- All Priority 2 (Core UX) items shipped and review-polished.
- Streaming uses SSE with incremental JSON parsing, append-only DOM rendering, 150ms debounce, and per-chunk timeout reset.
- `fetchStreamWithRetry` handles 5xx/429 retry for the initial connection; `reader.cancel()` ensures cleanup.
- Stage timestamps carry `startedAt` so elapsed timer is correct on tab re-entry.
- Shared `renderTacticCard(tactic, { interactive })` eliminates card HTML duplication.
- 72 tests pass (15 new for streaming parsing).

---

## Roadmap

### Priority 1 — Accuracy & Trust

These directly affect whether the product delivers on its promise. Ship these first.

#### 1.0 Evaluation harness and test corpus

**Why:** The prompt is the single biggest lever, but there's no way to measure whether changes help or hurt. Every other item in Priority 1 depends on having a measurement system. Without it, prompt tuning is guesswork.

**Key decision:** Precision is the primary metric (false positives erode trust more than misses). Feedback collection is dev-only — stripped before release (see 4.5). This aligns with "accuracy over coverage" and "privacy by default."

**What to do:**

*Test corpus (~120 labeled examples in `eval/corpus/`, one JSON per file):*
- ~45 tactic-specific (3 per tactic: textbook, variation, real-world-style)
- ~34 ported from existing benchmarks.md
- ~15 multi-tactic passages
- ~15 clean text (false positive controls)
- ~10 ambiguous edge cases (excluded from headline metrics, reported separately)

*Evaluation harness (`npm run eval`):*
- Reads corpus, calls Anthropic API with same prompt functions as the extension
- Scores: precision/recall/F1 per tactic + overall, quote fidelity (is exact_quote a substring?)
- Matching: tactic name match AND >= 50% character overlap with annotation
- Outputs console table + `eval/results/<timestamp>.json`
- Surfaces false positives and false negatives explicitly

*Prompt tuning workflow:*
- Versioned prompt files in `eval/prompts/`
- `npm run eval -- --prompt eval/prompts/v2.js` to test alternatives
- `npm run eval:compare` for side-by-side metric diff

**Targets:** Overall precision >= 85%, recall >= 65%, no tactic < 70% precision, quote fidelity >= 95%

**Files:** New `eval/` directory (harness.js, scorer.js, reporter.js, compare.js, corpus/, prompts/)
**Risk:** Corpus creation is labor-intensive (~120 annotated examples). API calls for eval runs cost money. Rate-limit to 1 req/sec.

#### 1.1 Tune prompt with few-shot examples and confidence scores

**Why:** The prompt is a tactic list + "be confident." No examples of what good detection looks like vs. a stretch.
**What to do:**
- Run baseline eval with current prompt (using 1.0 harness)
- Try tuning strategies in order, measuring each:
  1. Few-shot examples (1-2 per tactic in system prompt)
  2. Confidence threshold instruction ("only flag when > 80% confident")
  3. Tactic disambiguation notes (commonly confused pairs like Scapegoating vs. Ad Hominem)
  4. Negative examples ("strong language is not automatically Emotional Language")
- Add `"confidence": "high" | "medium"` field to JSON output schema
- Update `parseJsonResponse` in both `background.js` and `server.js` to pass confidence through
- In `sidepanel.js`, show high-confidence results by default; add visual dimming for medium
- Keep `buildSystemPrompt()` in `background.js` and `promptRoleSystem` in `prompts.js` in sync
**Files:** `background.js`, `server.js`, `prompts.js`, `sidepanel.js`, `eval/prompts/`
**Risk:** More prompt tokens = slightly higher cost and latency. Few-shot examples add ~500-800 tokens. Worth it for accuracy.
**Depends on:** 1.0

#### 1.2 Show "analyzed X of Y" indicator
**Why:** The 5000-char text limit means only ~800 words are analyzed. On long articles, users see results for the top of the page and assume the rest is clean. This silently destroys trust.
**What to do:**
- In `content.js` `collectText()`, track total chars collected before truncation. Return both `text` and `totalChars` in the response
- In `background.js` `handleAnalyze()`, pass `totalChars` and `analyzedChars` through to results storage
- In `sidepanel.js`, show a subtle indicator below the summary: "Analyzed first 5,000 of 12,400 characters" when truncated
- Future: consider chunked analysis (multiple API calls) but that's a separate work item
**Files:** `content.js` (collectText), `background.js` (handleAnalyze), `sidepanel.js` (showResults)

#### 1.3 Preserve text structure in collection
**Why:** `collectText()` joins all text nodes with single spaces into a flat string. The AI loses paragraph boundaries, headings, and structure — making it harder to identify context and return exact quotes.
**What to do:**
- Modify `collectText()` to insert double-newlines between text nodes from different block-level ancestors (use the `BLOCK_TAGS` set already in content.js)
- This preserves paragraph structure without adding markup
- Test that the fuzzy matcher still works with newlines in the concatenated text (it should — `normalizeText` collapses whitespace)
**Files:** `content.js` (collectText)

#### 1.4 Fix test suite
**Why:** 3 of 5 test suites (`highlighting.test.js`, `promptBuilder.test.js`, `tactics.test.js`) fail with ESM import errors. Only 17 of ~56 tests actually run.
**What to do:**
- Add `"type": "module"` to `package.json` OR configure Jest for ESM via `--experimental-vm-modules` in the test script
- Alternatively, convert test files to use `require()` / CommonJS if the extension doesn't need ESM
- Verify all 56 tests pass
- `highlight-matcher.js` uses `export` — if keeping ESM, ensure Jest transforms it; if dropping ESM, convert to CommonJS
**Files:** `package.json`, `test/*.test.js`, possibly `highlight-matcher.js`

---

### Priority 2 — Core UX

These transform the experience from "it works" to "this is good."

#### 2.1 Streaming API responses
**Why:** Analysis takes 5-30 seconds. Users stare at a skeleton loader. With streaming, the first tactic card can appear in 2-3s — transforming dead wait into progressive reveal.
**What to do:**
- In `background.js`, switch `callAnthropicDirect()` to use Anthropic's streaming API (`stream: true` in the request, or use the SDK's `messages.stream()`)
- Parse partial JSON as content chunks arrive. Strategy: accumulate text, attempt JSON parse after each `content_block_delta`, emit partial results when a complete tactic object is detected
- Store partial results to session storage as they arrive so the side panel can render incrementally
- In `sidepanel.js`, update the storage listener to handle incremental result updates — append new tactic cards as they arrive rather than replacing all at once
- Send highlights to content script incrementally too (or batch at the end)
- Fallback: if streaming parsing fails, fall back to waiting for the complete response
**Files:** `background.js` (callAnthropicDirect, handleAnalyze), `sidepanel.js` (storage listener, showResults)
**Complexity:** High. This touches the core data flow. Test thoroughly with both short (no tactics) and long (5+ tactics) responses.

#### 2.2 Category-colored page highlights
**Why:** All highlights are the same yellow. The category color system (blue/orange/red) exists in the side panel but is invisible on the page. Category colors would let users scan an article and immediately see the manipulation landscape.
**What to do:**
- In `content.js`, add the `TACTIC_CATEGORIES` mapping (already inlined partially — need the full map from `shared.js`)
- In `ensureHighlightStyles()`, add category-specific highlight classes: `.mi-highlight.mi-logical`, `.mi-highlight.mi-rhetorical`, `.mi-highlight.mi-credibility`
- Use semi-transparent category colors that work on both light and dark page backgrounds: logical = `rgba(91, 156, 245, 0.18)`, rhetorical = `rgba(232, 148, 58, 0.18)`, credibility = `rgba(239, 83, 80, 0.18)`
- In the highlight creation loop, look up the tactic's category and add the appropriate class
- Hover/active states should intensify the category color
**Files:** `content.js` (ensureHighlightStyles, highlightResults, TACTIC_CATEGORIES)

#### 2.3 Extension icon badge
**Why:** No way to tell from the toolbar whether a page has been analyzed or how many tactics were found. A badge count ("3") gives ambient awareness.
**What to do:**
- In `background.js`, after `handleAnalyze()` completes successfully, call `chrome.action.setBadgeText({ tabId, text: String(result.results.length) })` and `chrome.action.setBadgeBackgroundColor({ tabId, color: '#ef5350' })`
- When results are cleared, call `chrome.action.setBadgeText({ tabId, text: '' })`
- Show "0" in a neutral color (gray) when analysis finds nothing, or leave blank
- On tab switch, badge should reflect that tab's state (Chrome handles this automatically via `tabId`)
**Files:** `background.js` (handleAnalyze, CLEAR_HIGHLIGHTS handler)

#### 2.4 Analysis progress stages
**Why:** "Analyzing... 12s" gives no indication of what's happening. Even approximate stages reduce perceived wait time.
**What to do:**
- In `background.js`, write intermediate status updates to session storage during `handleAnalyze()`:
  - After text collection: `{ status: 'analyzing', stage: 'collected', timestamp }`
  - Before API call: `{ status: 'analyzing', stage: 'calling_api', timestamp }`
  - After API response: `{ status: 'analyzing', stage: 'processing', timestamp }`
- In `sidepanel.js`, the storage listener already watches status changes. Update `showAnalyzing()` to show stage-appropriate text: "Collecting text..." → "Analyzing with Claude..." → "Processing results..."
**Files:** `background.js` (handleAnalyze), `sidepanel.js` (showAnalyzing, storage listener)

---

### Priority 3 — Polish & Completeness

These make the product feel finished.

#### 3.1 Options page dark theme restyle
**Why:** The options page is light-themed with Google Blue accents — completely disconnected from the dark side panel. It's the first thing new users see (setup flow sends them there).
**What to do:**
- Rewrite the inline `<style>` in `options.html` to use the same CSS custom properties and dark palette as `sidepanel.css`
- Match typography (mono for labels, sans for content), surface colors, border styles, and button patterns
- Keep the layout — just restyle the visual layer
**Files:** `options.html`

#### 3.2 First-run onboarding
**Why:** First-time users see a cold "set up your API key" message. No explanation of value, no preview.
**What to do:**
- In `sidepanel.js` `showSetup()`, replace the current message with a brief one-screen description:
  - What this does (1 sentence)
  - Setup CTA ("Add your Anthropic API key to get started")
- Keep it minimal — no multi-step wizard (see FB-0002)
**Files:** `sidepanel.js` (showSetup), `sidepanel.css` (onboarding styles)

#### 3.3 Humanize model selector
**Why:** "Sonnet 4.6" vs "Haiku 4.5" means nothing to non-technical users.
**What to do:**
- Change option labels in `sidepanel.html`: "Thorough (Sonnet)" and "Quick (Haiku)"
- Keep the `value` attributes as-is (model IDs)
- Update `options.html` similarly
**Files:** `sidepanel.html`, `options.html`

#### 3.4 Instance quote click affordance
**Why:** Quotes in the side panel are clickable (scroll to page highlight) but look like plain italic text. Zero visual affordance.
**What to do:**
- Add a small arrow or link icon before each quote, or underline on hover
- In `sidepanel.css`, style `.instance-quote` with a subtle underline that appears on hover
**Files:** `sidepanel.css`

#### 3.5 Improved empty state
**Why:** "No manipulation tactics detected" is a dead end with no positive framing or next action.
**What to do:**
- Rewrite `showEmpty()` with positive framing and helpful context
- Suggest: "Try analyzing a different page, or a news article with strong opinions."
**Files:** `sidepanel.js` (showEmpty)

#### 3.6 Category legend
**Why:** The three category colors (blue/orange/red) are used throughout the UI but never explained.
**What to do:**
- Add a small inline legend below the results summary: three colored dots with labels
- Style as a subtle monospace row matching the summary aesthetic
**Files:** `sidepanel.js` (showResults), `sidepanel.css`

#### 3.7 Keyboard shortcut discoverability
**Why:** Cmd+Shift+M opens the panel but is never shown in the UI.
**What to do:**
- Show the shortcut in the ready state message
**Files:** `sidepanel.js` (showReady)

---

### Priority 4 — Infrastructure & Debt

Fix before scaling. Can be done in any order.

#### 4.1 Fix server.js error handler position
**Why:** The error handling middleware is defined before routes — Express error handlers must come after.
**What to do:**
- Move the `app.use((err, req, res, next) => { ... })` block to after all route definitions
**Files:** `server.js`

#### 4.2 Hash cache keys
**Why:** `server.js` uses 5KB+ string keys per cache entry.
**What to do:**
- Use `crypto.createHash('sha256').update(cacheKey).digest('hex')` instead
**Files:** `server.js`

#### 4.3 Clean up dead files
**Why:** `prompts.js` and `tactics.js` are server-only. `highlight-matcher.js` is tested but never loaded at runtime.
**What to do:**
- Clarify ownership with comments or directory moves
- Accept duplication between highlight-matcher.js and content.js, document canonical version
**Files:** `manifest.json`, `highlight-matcher.js`, `content.js`

#### 4.4 Update spec.md and benchmarks.md
**Why:** `spec.md` references "GPT-5-nano", "floating widget" — none of which exist anymore. `benchmarks.md` compares GPT models.
**What to do:**
- `spec.md`: Already updated for current stack. Verify after prompt tuning.
- `benchmarks.md`: Replace with eval harness results after 1.0 is complete.
**Files:** `core-docs/spec.md`, `core-docs/benchmarks.md`

#### 4.5 Strip dev-only feedback code
**Why:** Feedback collection was built for development measurement. It does not ship. In BYOK mode (recommended), feedback silently fails. Aligns with "privacy by default" (see FB-0003).
**What to do:**

| Remove | Reason |
|--------|--------|
| `database.js` | Delete — SQLite feedback storage, dev-only |
| `server.js` feedback endpoints | `/submit-instance-feedback`, `/report-missing-manipulation`, all `/analytics/*` |
| `server.js` db dependencies | `dbOperations`, `recordPerformance`, `calculateComplexityScore`, `generateSessionId` |
| `sidepanel.js` feedback UI | "Was this accurate?" button, rating buttons, submit handler, textarea |
| `sidepanel.css` feedback styles | `.card-feedback`, `.feedback-*` blocks |
| `better-sqlite3` dependency | Remove from package.json |
| `options.html` server hint | Update — no longer mentions "feedback and analytics" |

| Keep | Reason |
|------|--------|
| `server.js` `/analyze-content-with-model` | Server proxy mode |
| `server.js` `/health` | Operational (strip db parts) |
| `eval/` directory | Dev tool, not packaged |

**Files:** `database.js` (delete), `server.js`, `sidepanel.js`, `sidepanel.css`, `options.html`, `package.json`
**Depends on:** Complete 1.0 first (the harness replaces feedback as the measurement tool)

#### 4.6 Normalize parseJsonResponse behavior
**Why:** `background.js` returns `[]` on parse failure (silent "no results"). `server.js` returns `null` (triggers regex fallback). Inconsistent.
**What to do:**
- Both return `null` on failure; caller decides whether to fall back or show error
**Files:** `background.js`, `server.js`

---

## Future Considerations (not planned yet)

- **Chunked analysis**: Split long pages into multiple API calls to analyze beyond 5000 chars
- **SPA navigation detection**: MutationObserver or `chrome.webNavigation` listener to detect page changes and clear stale highlights
- **Light/dark theme toggle**: The CSS custom properties are already set up for this
- **Toolbar popup as quick summary**: Show top-line results without opening the side panel

---

## Recently Completed

- **Apr 8, 2026**: Priority 2 review pass — streaming reliability, UX polish, test coverage (13 issues fixed, 15 new tests)
- **Apr 7, 2026**: Priority 2 — Core UX: streaming API responses, category-colored highlights, icon badge, analysis progress stages
- **Apr 7, 2026**: Fix controls layout for narrow panel, improve text contrast
- **Apr 7, 2026**: Fix content script injection fallback, improve error messages
- **Apr 7, 2026**: Remove duplicate title, move settings gear into controls bar
- **Apr 7, 2026**: Restyle sidebar UI with DevPanel-inspired dark glass aesthetic
- **Apr 7, 2026**: Fix cross-node highlighting, fuzzy matching, side panel navigation
- **Apr 1, 2026**: Complete Anthropic migration — server.js + BYOK on Claude API
- **Apr 1, 2026**: Infrastructure migration — CLAUDE.md, agents, rules, core-docs

---

## Shipped Features

- **Mar 25, 2026**: Best-in-Class Overhaul — BYOK, Side Panel, fuzzy highlighting, test suite
- **Mar 24, 2026**: Taxonomy expansion (11->15 tactics), XSS fixes, database.js
- **Aug 12, 2025**: A/B Testing System & UI Cleanup
- **Aug 12, 2025**: Navigation System & Manual Click Fix
- **Aug 11, 2025**: Frosted Glass Styling & Close Behavior
- **Jun 6, 2025**: Click-based Tooltips & Positioning
- **Jun 5, 2025**: Widget Animations & API Key Security
- **Jun 2, 2025**: Widget-based UI Migration
- **May 28, 2025**: Functional Text Highlighting & LLM Display
- **May 27, 2025**: Popup Messaging System
- **May 19, 2025**: Core Analysis Loop
- **May 10, 2025**: Tactics JSON Conversion
- **May 5, 2025**: Manipulation Tactics Database
- **Apr 26, 2025**: OpenAI API Integration
- **Apr 8, 2025**: Initial Extension Setup & Keyword Highlighting
