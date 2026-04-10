# Project Tracker

## Current Focus

UX feedback round (Apr 9, 2026) surfaced 8 issues across accuracy, UX, and reliability. These are now tracked as Priority 5 items. Key themes: reduce false positives via better context, improve text collection to focus on main content, add re-run button, fix highlighting reliability, improve results presentation with progressive disclosure, and accessibility pass on text sizes.

Accuracy items (5.5 main content filtering, 5.6 false positive reduction) feed directly into item 1.1 (prompt tuning). UX items (5.1–5.4, 5.7–5.8) can proceed independently.

## Handoff Notes

- 8 new feedback entries added (FB-0005 through FB-0012) from user testing session.
- Empty state copy needs neutral language (FB-0005) — don't assume page type.
- `collectText()` needs main-content filtering (FB-0009) — currently grabs sidebar/trending text.
- Highlighting breaks on re-run (FB-0008) — needs investigation.
- Results presentation overhaul (FB-0011) — progressive disclosure, less repetition.
- False positive investigation needed (FB-0010) — quotes vs article rhetoric.
- Feedback form data capture improvements worth exploring for dev use (FB-0012).
- Priority 4 (Infrastructure & Debt) fully completed — all 6 items shipped.
- `database.js` deleted, `better-sqlite3` removed. No more SQLite dependency.
- All feedback/analytics endpoints and UI stripped. Server is analysis-only now.
- `parseJsonResponse` returns `null` on failure in both background.js and server.js.
- LLM provider switched from Anthropic to Google Gemini (Phase 12).
- Eval harness and 119-file test corpus shipped (item 1.0).
- All Priority 2 (Core UX) and Priority 3 (Polish) items shipped and review-polished.
- 72 tests pass (15 new for streaming parsing).

---

## Roadmap

### Priority 1 — Accuracy & Trust

These directly affect whether the product delivers on its promise. Ship these first.

#### 1.0 Evaluation harness and test corpus -- COMPLETE

**Status:** Shipped on `eval-harness-corpus` branch, Apr 8, 2026.

**What was built:**
- 119 corpus files in `eval/corpus/` (45 tactic-specific, 34 benchmark ports, 15 multi-tactic, 15 clean text, 10 ambiguous edge cases)
- `eval/harness.cjs` — reads corpus, calls Gemini API (rate-limited 1 req/sec), scores results
- `eval/scorer.cjs` — character overlap matching (50% threshold), precision/recall/F1 per-tactic and overall, quote fidelity
- `eval/reporter.cjs` — console table output + JSON persistence to `eval/results/`
- `eval/compare.cjs` — side-by-side metric comparison between two eval runs
- `eval/prompts/v1.cjs` — baseline prompt extracted from production
- `npm run eval` and `npm run eval:compare` scripts in package.json

**Targets:** Overall precision >= 85%, recall >= 65%, no tactic < 70% precision, quote fidelity >= 95%

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
- **New from feedback (FB-0010):** Add instructions to distinguish quoted speech from article rhetoric, and contextualize findings within the full article rather than flagging in isolation. See item 5.6.
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

#### 1.4 Fix test suite -- COMPLETE

**Status:** Fixed on main. 72 tests pass across 6 suites (resolved ESM import errors, added streaming tests).

---

### Priority 2 — Core UX -- COMPLETE

All four items shipped and review-polished. See history.md Phase 10 for details.

- **2.1 Streaming API responses** — SSE with incremental JSON parsing, append-only DOM rendering, 150ms debounce, per-chunk timeout reset, fetchStreamWithRetry for 5xx/429
- **2.2 Category-colored page highlights** — Blue (logical), orange (rhetorical), red (credibility) with hover/active states
- **2.3 Extension icon badge** — Tactic count badge after analysis, clears on highlight removal
- **2.4 Analysis progress stages** — "Collecting text..." → "Analyzing with Gemini..." → "Processing results..."

---

### Priority 3 — Polish & Completeness -- COMPLETE

All seven items shipped. See history.md Phase 9 for details.

- **3.1 Options page dark theme** — Dark palette matching sidepanel.css
- **3.2 First-run onboarding** — One-line description + CTA (per FB-0002)
- **3.3 Humanize model selector** — "Flash 2.5 (Recommended)" / "Flash Lite 2.5 (Faster)"
- **3.4 Quote click affordance** — Subtle underline, accent color on hover
- **3.5 Improved empty state** — Positive framing. **Updated (FB-0005):** Don't suggest specific page types. See item 5.1.
- **3.6 Category legend** — Colored dots with labels below results summary
- **3.7 Keyboard shortcut** — Platform-aware hint in ready state

---

### Priority 4 — Infrastructure & Debt ✓

All items completed (Apr 8, 2026). See `history.md` Phase 9 for details.

- ~~4.1 Fix server.js error handler position~~ — moved after routes
- ~~4.2 Hash cache keys~~ — SHA-256 hashed
- ~~4.3 Clean up dead files~~ — ownership comments added
- ~~4.4 Update spec.md and benchmarks.md~~ — GPT refs removed, current stack documented
- ~~4.5 Strip dev-only feedback code~~ — database.js deleted, feedback UI/endpoints/CSS removed, better-sqlite3 removed
- ~~4.6 Normalize parseJsonResponse~~ — both return null on failure

---

### Priority 5 — UX Feedback Round (Apr 9, 2026)

Issues surfaced during user testing. Ordered by impact.

#### 5.1 Fix empty state copy — don't assume page type
**Why:** Empty state says "try a news article" but user was already on BBC News. The extension doesn't know what page the user is on and shouldn't guess. (FB-0005)
**What to do:**
- Rewrite `showEmpty()` message to use neutral language: "No manipulation tactics detected on this page." Remove the suggestion to try a specific page type.
- Review all status/error messages for similar assumptions.
**Files:** `sidepanel.js` (showEmpty)
**Effort:** Small

#### 5.2 Add re-run button
**Why:** After analysis, users must clear then re-analyze to re-run (e.g., after switching models). Need a single-action re-run. (FB-0006)
**What to do:**
- Add a circular-arrow icon button next to the Clear button in results/empty states
- Re-run = clear + immediately start new analysis with current model selection
- Keep Clear button as-is (returns to ready state without re-analyzing)
**Files:** `sidepanel.js` (handleAnalyze, showResults, showEmpty), `sidepanel.html`, `sidepanel.css`
**Effort:** Small

#### 5.3 Accessibility pass — text sizes and contrast
**Why:** Text is too small in several places (base 12px, minimum 10px). Low contrast on secondary text. (FB-0007)
**What to do:**
- Increase CSS variable scale: `--font-size-xs: 11px`, `--font-size-sm: 12px`, `--font-size-base: 13px`, `--font-size-md: 14px`
- Audit all text for WCAG AA contrast (4.5:1 normal, 3:1 large). Bump `--text-tertiary` and `--text-muted` if needed.
- Add text size preference in options page (Small / Medium / Large) that shifts the entire scale up/down 1-2px
- Store preference in `chrome.storage.local`, apply on sidepanel load via a `data-text-size` attribute on body
**Files:** `sidepanel.css`, `sidepanel.js`, `options.html`
**Effort:** Medium

#### 5.4 Fix highlighting reliability on re-run
**Why:** Highlights are hit-or-miss on re-analysis. Likely caused by residual DOM state or race conditions. (FB-0008)
**What to do:**
- Investigate: does `clearHighlights()` fully restore the DOM? Are `.mi-highlight` spans unwrapped completely?
- Check for race conditions: does `collectText()` run before clear completes?
- Check if re-run creates duplicate event listeners or stale references
- Add defensive cleanup at start of `highlightResults()`
- Test systematically: analyze → clear → analyze on 5+ different pages
**Files:** `content.js` (clearHighlights, highlightResults)
**Effort:** Medium — requires investigation

#### 5.5 Filter main content from secondary content
**Why:** Sidebars, trending articles, related article widgets get analyzed alongside the main article. Flags manipulation from headlines that aren't part of the article being read. (FB-0009)
**What to do:**
- In `collectText()`, look for `<article>`, `<main>`, or `[role="main"]` first. If found, constrain TreeWalker root to that element.
- If no main content container found, fall back to `document.body` but exclude: `aside`, `nav`, `[role="complementary"]`, `[role="navigation"]`, `header`, `footer`, elements with classes/IDs matching patterns: `sidebar`, `related`, `trending`, `popular`, `recommended`, `widget`, `ad-`, `promo`
- Test on BBC, CNN, Breitbart, NYT, Fox News, AP News to verify correct content extraction
**Files:** `content.js` (collectText)
**Effort:** Medium
**Impact:** High — directly reduces false positives from non-article content

#### 5.6 Reduce false positives — article context and quoted speech -- PARTIAL
**Status:** Attribution framework shipped Apr 9, 2026. Prompt now distinguishes author/source. UI dims source-attributed instances. 5 new tests.

**Remaining work:**
- Add negative examples to the prompt (item 1.1 work): e.g., "This quote from a politician uses emotional language, but the article is reporting it neutrally — attribute to source, not author"
- Measure attribution accuracy with eval harness before and after
- Investigate remaining false positive categories beyond quoted speech (e.g., strong language that isn't manipulation in context)
**Depends on:** Benefits from 1.1 (prompt tuning framework)

#### 5.7 Progressive disclosure for results presentation
**Why:** Results are repetitive and text-heavy. Multiple instances of the same tactic repeat similar explanations. Too much information shown by default. (FB-0011)
**What to do:**
- Default card view: tactic name + count + quotes only (no explanations visible)
- Expand on click/tap to reveal explanations for each quote
- When a tactic has 3+ instances, show first 2 quotes with "and N more" expandable
- Rewrite explanation prompt to avoid repetitive patterns ("the word X is..."). Instruct the model to vary its explanations and relate instances to each other.
- Consider a brief cohesive summary at the top that contextualizes findings together, rather than pure list
**Files:** `sidepanel.js` (renderTacticCard), `sidepanel.css`, `background.js` (buildSystemPrompt)
**Effort:** Medium

#### 5.8 Improve dev feedback data capture
**Why:** The feedback form submits minimal data (rating + comment). During development, need richer context: page snapshot, full analysis results, all flagged items, to enable deep review. (FB-0012)
**What to do:**
- When submitting feedback, include: full analysis results (all tactics, not just the one rated), page URL, page title, text that was analyzed, model used, timestamp
- Store locally (JSON file or IndexedDB) rather than requiring server — dev can review offline
- Consider a "dev export" button in options page that dumps all collected feedback as JSON
- This is dev-only infrastructure (see FB-0003) — will be stripped before release
**Files:** `sidepanel.js` (feedback handler), potentially new `dev-feedback.js`
**Effort:** Medium
**Note:** Explore whether this is worth building vs. just using the eval harness for the same purpose

---

## Future Considerations (not planned yet)

- **Reintroduce user feedback (privacy-compatible)**: The original feedback system was stripped in Priority 4 (see `history.md` Phase 11, "Feedback System Teardown" section for full context on what existed and why it was removed). Any reintroduction must work in BYOK mode (no server), respect privacy-by-default, and close the feedback loop (data must actually improve detection). See the teardown doc for specific design considerations.
- **Extract shared `parseJsonResponse`**: Three copies exist (server.js, background.js, test). Extract to a standalone module that server.js can `import`, background.js can `importScripts`, and tests can import directly.
- **BYOK regex fallback parity**: BYOK mode silently returns empty results on malformed JSON (`|| []`), while server-proxy mode falls back to the regex parser. Consider adding the regex fallback to BYOK or surfacing a user-visible error.
- **Chunked analysis**: Split long pages into multiple API calls to analyze beyond 5000 chars
- **SPA navigation detection**: MutationObserver or `chrome.webNavigation` listener to detect page changes and clear stale highlights
- **Light/dark theme toggle**: The CSS custom properties are already set up for this
- **Toolbar popup as quick summary**: Show top-line results without opening the side panel

---

## Recently Completed

- **Apr 9, 2026**: Quoted speech attribution framework (item 5.6 partial) — author/source distinction in prompt, parsing, side panel, and page highlights. 5 new tests (77 total).
- **Apr 9, 2026**: Switch LLM provider from Anthropic to Google Gemini (Phase 12)
- **Apr 9, 2026**: Complete Priority 4 — Infrastructure & Debt (all 6 items)
- **Apr 8, 2026**: Build eval harness and 119-file test corpus (item 1.0) — measurement system for prompt tuning
- **Apr 8, 2026**: Priority 2 review pass — streaming reliability, UX polish, test coverage (13 issues fixed, 15 new tests)
- **Apr 7, 2026**: Priority 3 — Polish & Completeness (3.1–3.7): dark options page, minimal onboarding, human model labels, quote click affordance, improved empty state, category legend, keyboard shortcut hint
- **Apr 7, 2026**: Priority 2 — Core UX: streaming API responses, category-colored highlights, icon badge, analysis progress stages
- **Apr 7, 2026**: Fix controls layout for narrow panel, improve text contrast
- **Apr 7, 2026**: Fix content script injection fallback, improve error messages
- **Apr 7, 2026**: Remove duplicate title, move settings gear into controls bar
- **Apr 7, 2026**: Restyle sidebar UI with DevPanel-inspired dark glass aesthetic
- **Apr 8, 2026**: Switch LLM provider from Anthropic to Google Gemini (free tier)
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
