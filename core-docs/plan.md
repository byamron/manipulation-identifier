# Project Tracker

## Current Focus

Priority 5 UX feedback items shipped (6 of 8 items). Remaining: 5.6 (false positive reduction — depends on 1.1 prompt tuning) and 5.8 (dev feedback capture — deferred, eval harness serves same purpose).

Next up: Priority 1.1 (prompt tuning with few-shot examples) which will also address the remaining 5.6 work.

## Handoff Notes

- Priority 5 shipped: 5.1 (empty state), 5.2 (re-run button), 5.3 (accessibility), 5.4 (highlight reliability), 5.5 (main content filtering), 5.7 (progressive disclosure).
- Main content filtering: `collectText()` now prefers `<article>`, `<main>`, `[role="main"]`. Falls back to body with secondary content exclusion.
- Re-run button: shows in results and empty states; waits for clear to complete before starting new analysis.
- Highlight reliability: background.js now defensively clears highlights before collecting text; re-run waits for clear callback.
- Progressive disclosure: explanations hidden by default (double-click quote to show), instances capped at 2 with "and N more" expandable, definition removed from card header to reduce repetition.
- Text size preference: Small/Medium/Large in options page, applies via `data-text-size` attribute on body.
- 77 tests pass.

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

#### 5.1 Fix empty state copy — don't assume page type -- COMPLETE
**Status:** Shipped. Empty state now says "No manipulation tactics detected on this page." — neutral, no page-type assumptions.

#### 5.2 Add re-run button -- COMPLETE
**Status:** Shipped. Circular-arrow re-run button in results header and empty state. Waits for clear callback before starting new analysis to avoid race conditions.

#### 5.3 Accessibility pass — text sizes and contrast -- COMPLETE
**Status:** Shipped. Font scale bumped +1px (xs:11, sm:12, base:13, md:14). Contrast improved: tertiary to 70% lightness, muted to 55%. Text size preference (Small/Medium/Large) in options page with `data-text-size` body attribute.

#### 5.4 Fix highlighting reliability on re-run -- COMPLETE
**Status:** Shipped. Root cause: race condition — `collectText()` skips text inside `.mi-highlight` spans, so if highlights aren't fully cleared before re-collection, text differs. Fix: background.js now sends defensive `CLEAR_HIGHLIGHTS` before `COLLECT_TEXT`; re-run button waits for clear callback.

#### 5.5 Filter main content from secondary content -- COMPLETE
**Status:** Shipped. `collectText()` now uses `findMainContent()` to prefer `<article>`, `<main>`, `[role="main"]`. Falls back to body with `isSecondaryElement()` exclusions (aside, nav, header, footer, sidebar/related/trending class patterns).

#### 5.6 Reduce false positives — article context and quoted speech -- PARTIAL
**Status:** Attribution framework shipped Apr 9, 2026. Prompt now distinguishes author/source. UI dims source-attributed instances. 5 new tests.

**Remaining work:**
- Add negative examples to the prompt (item 1.1 work): e.g., "This quote from a politician uses emotional language, but the article is reporting it neutrally — attribute to source, not author"
- Measure attribution accuracy with eval harness before and after
- Investigate remaining false positive categories beyond quoted speech (e.g., strong language that isn't manipulation in context)
**Depends on:** Benefits from 1.1 (prompt tuning framework)

#### 5.7 Progressive disclosure for results presentation -- COMPLETE
**Status:** Shipped. Explanations hidden by default with "Why?" toggle per instance. Instances capped at 2 with "and N more" expandable. Instance count badge on card header. Definition retained (one line per tactic, not repetitive). Prompt changes for explanation variety deferred to 1.1.

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

- **Apr 9, 2026**: Priority 5 UX feedback round — 6 items shipped: empty state copy (5.1), re-run button (5.2), accessibility pass (5.3), highlight reliability fix (5.4), main content filtering (5.5), progressive disclosure (5.7). 77 tests pass.
- **Apr 9, 2026**: Quoted speech attribution framework (item 5.6 partial) — author/source distinction in prompt, parsing, side panel, and page highlights. 5 new tests (77 total).
- **Apr 9, 2026**: Switch LLM provider from Anthropic to Google Gemini (Phase 12)
- **Apr 9, 2026**: Complete Priority 4 — Infrastructure & Debt (all 6 items)
- **Apr 8, 2026**: Build eval harness and 119-file test corpus (item 1.0) — measurement system for prompt tuning
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
