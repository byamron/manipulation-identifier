# Project Tracker

## Current Focus

Design craft pass complete (Phase 18). Feature flag system, interactive legend filter, enhanced motion, compact layout, and UI polish all shipped on `design-craft-audit` branch.

Next priorities: continued accuracy improvements per `accuracy-plan.md`, remaining 5.6 false positive reduction work, investigate unsupported-page bug on valid news sites.

## Handoff Notes

- Feature flag system live: `FEATURE_FLAGS` registry in `shared.js`, auto-generated toggles in Settings > Experiments. 4 flags shipped (legendFilter, devSnapshots, enhancedMotion, compactLayout), all default on.
- CSS-driven flags (enhancedMotion, compactLayout) live-update via body class — no reload needed.
- Snapshot now auto-copies JSON to clipboard on save.
- Instance quotes now use monospace code-block treatment (was italic + underline).
- Compact layout recovers ~24px horizontal space per instance quote.
- V3 prompt still live. Eval infrastructure unchanged. 94 tests pass across 7 suites.
- Known issue: extension sometimes shows "Cannot analyze this page" on valid news sites — needs investigation (likely tab query race or content script injection failure).

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

#### 1.1 Tune prompt with few-shot examples and confidence scores -- COMPLETE

**Status:** V3 prompt shipped to production (Apr 9, 2026). Three prompt iterations (v1→v2→v3) measured against full 119-file corpus. Corpus audited and corrected.

**Results (119 files, Flash Lite):**
- v1 baseline: 30.0% precision, 76.0% recall, 347 FP
- v2 (disambiguation + negatives): 35.0% precision, 76.5% recall, 278 FP
- v3 (precision-focused + corpus fixes): 54.9% precision, 73.5% recall, 121 FP
- Gap to target: precision needs +30% to reach 85%. See `core-docs/accuracy-plan.md`.

**What was done:**
- Three prompt versions: v1 (baseline), v2 (disambiguation/negatives/few-shot), v3 (precision-over-volume philosophy)
- Confidence field ("high"|"medium") end-to-end: parsing, sidepanel UI, page highlights
- Eval harness migrated from Anthropic to Gemini SDK with model-aware rate limiting and retry logic
- Corpus audit: 7 benchmark files corrected (5 annotations added, 1 removed, 2 quote fixes)
- Progressive eval skill (`/eval-quick`) for incremental testing
- `--subset` flag added to harness for targeted eval runs
- FB-0013 captured: "only flag significant, high-confidence manipulation"

**Files:** `background.js`, `server.js`, `prompts.js`, `sidepanel.js`, `sidepanel.css`, `content.js`, `eval/harness.cjs`, `eval/prompts/v1.cjs`, `eval/prompts/v2.cjs`, `eval/prompts/v3.cjs`, `eval/compare-quick.sh`, 7 corpus files
**Depends on:** 1.0

#### 1.2 Show "analyzed X of Y" indicator -- COMPLETE

**Status:** Shipped on `roadmap-review` branch, Apr 9, 2026.

**What was built:**
- `collectText()` returns `{ text, totalChars, analyzedChars }` instead of a plain string
- `background.js` passes totalChars/analyzedChars through to session storage results
- `sidepanel.js` shows "Analyzed first X of Y characters" below the summary when truncation occurred
- Styled with mono font, muted color, centered layout
**Files:** `content.js`, `background.js`, `sidepanel.js`, `sidepanel.css`

#### 1.3 Preserve text structure in collection -- COMPLETE

**Status:** Shipped on `roadmap-review` branch, Apr 9, 2026.

**What was built:**
- `collectText()` switched from Set (loses order, deduplicates) to Array with block-ancestor tracking
- Uses existing `nearestBlockAncestor()` and `BLOCK_TAGS` to determine paragraph boundaries
- Same block ancestor: join with single space. Different block: join with `\n\n`
- Normalizes: collapses 3+ newlines to `\n\n`, collapses spaces/tabs (not newlines) to single space
- Safe for fuzzy matcher: `normalizeText()` collapses all whitespace during comparison
**Files:** `content.js`

#### 1.4 Fix test suite -- COMPLETE

**Status:** Fixed on main. 77 tests pass across 6 suites (resolved ESM import errors, added streaming tests, attribution tests).

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

7 of 8 items shipped. **Last remaining: 5.6** (false positive reduction) — attribution framework is done, but remaining work (negative examples, eval measurement) is prompt tuning that belongs in Priority 1.1. Being handled on `roadmap-review` branch.

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

#### 5.8 Dev snapshot capture -- COMPLETE
**Status:** Shipped on `finish-priority-5` branch, Apr 9, 2026.

**What was built:**
- "Save Snapshot" button in results header captures full analysis context (URL, title, analyzed text, all results, raw response, model, tokens, timestamps, optional comment)
- Snapshots stored in `chrome.storage.local` as accumulating array
- Dev Tools section in options page: snapshot count, Export as JSON, Clear All
- `background.js` now persists analyzed text in session storage for snapshot access
- 17 new tests (94 total)

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

- **Apr 14, 2026**: Design craft pass (Phase 18) — feature flag system, interactive category legend filter, enhanced motion (hover lifts, glow pulse, snappier press, bar response), compact layout (flattened indentation, horizontal separators), UI polish (neutral clear button, monospace quotes, clipboard snapshot, alignment fixes, deprecated API fix). PR #24.
- **Apr 9, 2026**: Priority 1 prompt tuning complete (item 1.1) — three iterations (v1→v2→v3), precision 30% → 55%, FPs cut from 347 → 121. Corpus audited. `/eval-quick` skill for ongoing testing.
- **Apr 9, 2026**: "Analyzed X of Y" indicator (item 1.2) — coverage transparency when text is truncated.
- **Apr 9, 2026**: Preserve text structure in collection (item 1.3) — paragraph boundaries preserved for better AI context.
- **Apr 9, 2026**: Dev snapshot capture (5.8) — Save Snapshot button, options page Dev Tools (export/clear), 17 new tests. 94 total.
- **Apr 9, 2026**: Priority 5 UX feedback round — 7 of 8 items shipped: 5.1–5.5, 5.7, 5.8.
- **Apr 9, 2026**: Quoted speech attribution framework (item 5.6 partial) — author/source distinction.
- **Apr 9, 2026**: Analyzing UI consolidation & Gemini API fixes (Phase 14)
- **Apr 9, 2026**: Switch LLM provider from Anthropic to Google Gemini (Phase 12)
- **Apr 9, 2026**: Complete Priority 4 — Infrastructure & Debt (all 6 items)
- **Apr 8, 2026**: Build eval harness and 119-file test corpus (item 1.0)
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
