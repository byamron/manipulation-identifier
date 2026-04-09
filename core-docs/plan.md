# Project Tracker

## Current Focus

Item 1.0 (eval harness and test corpus) is complete. Next steps: run baseline eval to establish current prompt performance, then begin item 1.1 (prompt tuning with few-shot examples and confidence scores).

## Handoff Notes

- Eval harness and 119-file test corpus shipped (item 1.0).
- Run `npm run eval` to establish baseline metrics before starting 1.1.
- Corpus uses `.cjs` extension throughout because package.json has `"type": "module"`.
- Rate limited to 1 req/sec to avoid API cost spikes.
- Results are gitignored (`eval/results/*.json`) -- only the harness and corpus are tracked.
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
- `eval/harness.cjs` — reads corpus, calls Anthropic API (rate-limited 1 req/sec), scores results
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
- **2.4 Analysis progress stages** — "Collecting text..." → "Analyzing with Claude..." → "Processing results..."

---

### Priority 3 — Polish & Completeness -- COMPLETE

All seven items shipped. See history.md Phase 9 for details.

- **3.1 Options page dark theme** — Dark palette matching sidepanel.css
- **3.2 First-run onboarding** — One-line description + CTA (per FB-0002)
- **3.3 Humanize model selector** — "Thorough (Sonnet)" / "Quick (Haiku)"
- **3.4 Quote click affordance** — Subtle underline, accent color on hover
- **3.5 Improved empty state** — Positive framing + suggestion
- **3.6 Category legend** — Colored dots with labels below results summary
- **3.7 Keyboard shortcut** — Platform-aware hint in ready state

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

- **Apr 8, 2026**: Build eval harness and 119-file test corpus (item 1.0) — measurement system for prompt tuning
- **Apr 8, 2026**: Priority 2 review pass — streaming reliability, UX polish, test coverage (13 issues fixed, 15 new tests)
- **Apr 7, 2026**: Priority 3 — Polish & Completeness (3.1–3.7): dark options page, minimal onboarding, human model labels, quote click affordance, improved empty state, category legend, keyboard shortcut hint
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
