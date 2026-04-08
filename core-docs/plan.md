# Project Tracker

## Current Focus

Roadmap defined after full code review (Apr 7, 2026). Four priority tiers: Accuracy & Trust, Core UX, Polish, Infrastructure. New workspaces should start at the top of the Next Up list and work down.

## Handoff Notes

- API migration (OpenAI -> Anthropic) complete. BYOK and server proxy paths both use Anthropic Claude.
- Cross-node highlighting, 3-tier fuzzy matching, and side panel navigation fixed (PR #5).
- UI restyle (dark DevPanel aesthetic) merged to main.
- `.env.example` updated to `ANTHROPIC_API_KEY`.
- `spec.md` updated to reflect current stack and features.
- `benchmarks.md` still references GPT models — needs rewrite after Anthropic benchmarking.

---

## Roadmap

### Priority 1 — Accuracy & Trust

These directly affect whether the product delivers on its promise. Ship these first.

#### 1.1 Improve prompt with few-shot examples and confidence scores
**Why:** The prompt is the single biggest lever for detection quality. Currently it's a tactic list + "be confident." No examples of what good detection looks like vs. a stretch.
**What to do:**
- Add 2-3 few-shot examples to the system prompt: one clear positive detection, one borderline that should NOT be flagged, and one multi-tactic example
- Add `"confidence": "high" | "medium"` field to the JSON output schema
- Update `parseJsonResponse` in both `background.js` and `server.js` to pass confidence through
- In `sidepanel.js`, show high-confidence results by default; add a toggle or visual dimming for medium
- Update `buildSystemPrompt()` in `background.js` and `promptRoleSystem` in `prompts.js` (keep them in sync)
**Files:** `background.js` (buildSystemPrompt, parseJsonResponse), `server.js` (parseJsonResponse), `prompts.js` (promptRoleSystem), `sidepanel.js` (showResults)
**Risk:** More prompt tokens = slightly higher cost and latency. Few-shot examples add ~500-800 tokens. Worth it for accuracy.

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
- In `sidepanel.js` `showSetup()`, replace the current message with a brief onboarding flow:
  - What this does (1 sentence + a small illustration or icon)
  - What you'll see (mention highlights + tactic cards)
  - Setup CTA ("Add your Anthropic API key to get started")
- Keep it to one screen — no multi-step wizard
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
- Add `title="Click to scroll to this text on the page"` (already present but not visible)
- In `sidepanel.css`, style `.instance-quote` with a left border accent or subtle underline that appears on hover
**Files:** `sidepanel.css`

#### 3.5 Improved empty state
**Why:** "No manipulation tactics detected" is a dead end with no positive framing or next action.
**What to do:**
- Rewrite the empty state in `sidepanel.js` `showEmpty()`:
  - Positive framing: "No manipulation tactics detected on this page."
  - Helpful context: "This means none of the 15 tracked tactics were identified with confidence."
  - Suggestion: "Try analyzing a different page, or a news article with strong opinions."
- Consider adding a "Report missed manipulation" link (the server already has the endpoint)
**Files:** `sidepanel.js` (showEmpty)

#### 3.6 Category legend
**Why:** The three category colors (blue/orange/red) are used throughout the UI but never explained. Users don't know what the colors mean.
**What to do:**
- Add a small inline legend below the results summary: three colored dots with labels ("Logical Fallacy", "Rhetorical Manipulation", "Credibility Attack")
- Style it as a subtle, monospace row matching the summary aesthetic
**Files:** `sidepanel.js` (showResults), `sidepanel.css`

#### 3.7 Keyboard shortcut discoverability
**Why:** Cmd+Shift+M opens the panel but is never shown in the UI.
**What to do:**
- Show the shortcut in the ready state message: "Click Analyze to scan this page (Cmd+Shift+M)"
- Or add it as a tooltip on the extension title/header area
**Files:** `sidepanel.js` (showReady)

---

### Priority 4 — Infrastructure & Debt

Fix before scaling. Can be done in any order.

#### 4.1 Fix server.js error handler position
**Why:** The error handling middleware at `server.js:110` is defined before routes — Express error handlers must come after. Route errors will crash unhandled.
**What to do:**
- Move the `app.use((err, req, res, next) => { ... })` block to after all route definitions (before `app.listen`)
**Files:** `server.js`

#### 4.2 Hash cache keys
**Why:** `server.js:218` uses `${model}:${content.trim()}` as the Map key — 5KB+ string keys per entry.
**What to do:**
- Use `crypto.createHash('sha256').update(cacheKey).digest('hex')` instead
**Files:** `server.js`

#### 4.3 Clean up dead files
**Why:** `prompts.js` and `tactics.js` are only used by `server.js`. `highlight-matcher.js` is tested but never loaded at runtime (content.js inlines its own copy).
**What to do:**
- Move `prompts.js` and `tactics.js` into a `server/` directory or add a comment clarifying they're server-only
- Either: (a) add `highlight-matcher.js` to `manifest.json` content_scripts and import from it in content.js (requires build step), or (b) accept the duplication and add a comment in both files noting the canonical version
- Remove `highlight-matcher.js` from `web_accessible_resources` if present, since it's not used by extension pages
**Files:** `manifest.json`, `highlight-matcher.js`, `content.js` (comment), file moves

#### 4.4 Update spec.md and benchmarks.md
**Why:** `spec.md` references "GPT-5-nano", "floating widget", "text selection" — none of which exist anymore. `benchmarks.md` compares GPT models.
**What to do:**
- `spec.md`: Update tech stack to Anthropic Claude, update core features to reflect side panel + full-page analysis + BYOK architecture. Already done as of this plan.
- `benchmarks.md`: Mark as historical. Add a header noting these benchmarks are from the OpenAI era and need re-running with Claude models. Don't delete the data — it's useful context.
**Files:** `core-docs/spec.md`, `core-docs/benchmarks.md`

#### 4.5 Fix feedback in BYOK mode
**Why:** In BYOK mode (recommended), clicking "Accurate"/"Inaccurate" shows "Thank you!" but the POST silently fails because there's no server. Feedback goes nowhere.
**What to do:**
- In `sidepanel.js`, check if `serverUrl` is configured before showing the feedback form
- If no server: either hide the feedback UI, or store feedback in `chrome.storage.local` for later retrieval
- If storing locally: add a simple `GET /sync-feedback` flow when a server is eventually configured, or just keep it as local history
**Files:** `sidepanel.js` (attachCardListeners, feedback submit)

#### 4.6 Normalize parseJsonResponse behavior
**Why:** `background.js` returns `[]` on parse failure (silent "no results"). `server.js` returns `null` (triggers regex fallback). Inconsistent.
**What to do:**
- Decide on one behavior. Recommendation: both return `null` on failure, and have the caller decide whether to fall back or show empty
- In `background.js`, change `parseJsonResponse` catch to return `null`, and handle `null` in `handleAnalyze` (show an error like "Could not parse analysis results")
**Files:** `background.js` (parseJsonResponse, handleAnalyze), `server.js` (parseJsonResponse) — or leave server.js as-is since it already handles null correctly

---

## Future Considerations (not planned yet)

- **Chunked analysis**: Split long pages into multiple API calls to analyze beyond 5000 chars
- **SPA navigation detection**: MutationObserver or `chrome.webNavigation` listener to detect page changes and clear stale highlights
- **Local feedback storage**: Full implementation with sync when server becomes available
- **Light/dark theme toggle**: The CSS custom properties are already set up for this
- **Report missed manipulation UI**: Server endpoint exists (`/report-missing-manipulation`), needs a UI trigger in the side panel
- **Toolbar popup as quick summary**: Show top-line results without opening the side panel

---

## Recently Completed

- **Apr 7, 2026**: UI restyle — dark DevPanel-inspired aesthetic for side panel
- **Apr 7, 2026**: Fix cross-node highlighting, wire in fuzzy matcher, fix side panel -> page scroll navigation
- **Apr 1, 2026**: Complete Anthropic migration — server.js migrated from OpenAI SDK to @anthropic-ai/sdk
- **Apr 1, 2026**: Infrastructure migration — CLAUDE.md, agents, rules, core-docs
- **Mar 25, 2026**: Best-in-Class Overhaul — BYOK, Side Panel, fuzzy highlighting, test suite
- **Mar 24, 2026**: Taxonomy expansion (11->15 tactics), XSS fixes, database.js

---

## Shipped Features

- **Aug 12, 2025**: A/B Testing System & UI Cleanup
- **Aug 12, 2025**: Navigation System & Manual Click Fix
- **Aug 12, 2025**: Widget Flash Fix
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
