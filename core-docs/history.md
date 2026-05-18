# Feature History

Detailed documentation of shipped features, organized by development phase.

---

## Phase 22: Fix "Cannot analyze this page" on valid sites (May 2026)

### May 12, 2026 — Re-check tab state across reloads, same-tab navigation, and panel visibility

**Branch:** `fix-unsupported-page-bug` (from `af8b990`)

**Summary:** The extension intermittently showed "Cannot analyze this page" on valid news sites. Three independent causes converged: a defensive URL guard that treated undefined `tab.url` as unsupported, an init flow that only checked tab state once (so same-tab navigation never re-checked), and a Chrome side panel lifecycle quirk where the panel document survives close/open but `init()` doesn't run again. Fixes all three.

**What was done:**

1. **`isAnalyzableUrl(tab)` extracted to `shared.js`** — pure helper used by `checkTabState`. Returns true for http(s) URLs, true for undefined URL (the bug fix), false for chrome://, file://, about:blank, etc. Falls back to `tab.pendingUrl` when `tab.url` is unset. Original guard (`!tab.url || !/^https?:/.test(tab.url)`) failed closed on undefined — now we fail open, treating "unknown URL" as analyzable rather than unsupported.
2. **Same-tab navigation listener added** — `chrome.tabs.onUpdated` fires on the active tab when status reaches `complete`, calling `checkTabState`. Previously the only re-check trigger was tab-switch via `chrome.tabs.onActivated`, so navigating within the same tab kept stale state.
3. **Visibility re-check added** — `document.addEventListener('visibilitychange', ...)` queries the active tab and re-runs `checkTabState` when the panel becomes visible. Closes the gap where Chrome keeps the side panel document alive across close/open cycles but `init()` only runs once. Guarded by `if (!activeTabId) return;` to avoid racing with `init()` on first load.
4. **Diagnostic breadcrumb** — `console.warn` when `checkTabState` is invoked with both `tab.url` and `tab.pendingUrl` undefined. Gives the next debugger a DevTools signal confirming the URL-undefined path was hit if the bug recurs.
5. **12 unit tests for `isAnalyzableUrl`** — covers http(s), chrome://, file://, about:blank, undefined (regression), empty string, pendingUrl fallback, pendingUrl rejection, tab.url precedence over pendingUrl, URLs with port/path. New file `test/isAnalyzableUrl.test.js`.
6. **`chrome.tabs.onUpdated` property filter** — `{ properties: ['status'] }` passed as the second argument, narrowing notifications to status changes only. Skips title/favicon/audible churn during a single navigation. Filter inside the callback (`changeInfo.status === 'complete'`) still narrows to the final completion, but the API-level filter reduces wake-up cost.
7. **Listener teardown on `beforeunload`** — listener references are stored on a `listeners` object up front (anonymous functions can't be removed via `removeListener`). A `beforeunload` handler removes all three on unload. Side panel documents typically persist, but if Chrome ever recycles them this prevents handler accumulation on re-`init()`.
8. **Diagnostic counters in session storage** — `mi_check_tab_state_total` and `mi_check_tab_state_undefined` track all invocations and the undefined-URL subset, persisted to `chrome.storage.session` so a future diagnostics view (or manual DevTools poke) can read the ratio across sessions. Gives signal beyond the per-invocation console.warn.
9. **Unsupported state rewrite (UX)** — replaced the dead-end "Cannot analyze this page. Navigate to a regular web page..." with a card-style explanation: bold title ("This page can't be analyzed"), explanatory body naming the causes (system pages, new-tab page, local files), and a "Try again" affordance. Try again re-queries the active tab through `showChecking` → `checkTabState`, so the user can recover without closing the panel.
10. **`showChecking()` transient state (design eng)** — neutral "Checking page…" with a static braille glyph. Used when (a) `visibilitychange` fires while `currentState === 'unsupported'`, bridging the moment before re-check resolves; and (b) the Try again button is clicked, with a 120ms defer so the user perceives the transition instead of a snap.
11. **Status-area fade-in transition (design eng)** — `.status-message` animates `status-fade-in` (180ms, ease-out, slight Y translate) on every state swap. Snap behavior preserved under `prefers-reduced-motion`. Functional motion, not enhanced — applies unconditionally rather than under the `enhanced-motion` flag, because state transitions communicate change.
12. **11 structural contract tests for sidepanel.js** — new file `test/sidepanelContract.test.js` asserts on source patterns: `isAnalyzableUrl` is used, `onUpdated` has the property filter, the visibility handler guards on `activeTabId`, the diagnostic counters write, the breadcrumb logs, listeners tear down, the unsupported card has a Try again button that re-queries, `showChecking` exists, and the visibility handler routes through it. Brittle by design — if you change the contract, you must touch this test. Total suite: 145 tests, 11 files.

**Why:**

The bug was filed during Phase 21 ("known issue: extension sometimes shows 'Cannot analyze this page' on valid news sites") and a WIP candidate fix was committed to `debug-analysis-screen` on May 10 but not verified or shipped. Each of the three causes is independently plausible: the URL guard is provably wrong when `tab.url` is briefly undefined (a state Chrome can produce around extension reload and permissions-grant timing); the missing same-tab listener is a real gap (the existing code only listens to tab-switch); and the side panel document lifecycle is documented Chrome behavior. The fix is conservative — it expands the conditions under which analysis is offered, never tightens them.

**Design decisions:**

- **`tab.pendingUrl` fallback over polling.** When a navigation has started but `tab.url` hasn't been written yet, `tab.pendingUrl` carries the target URL. Using it as a fallback is one line and avoids any polling/retry scheme. Trades a small risk (pendingUrl could in theory be misleading mid-redirect) for far simpler logic.
- **Listen for `status === 'complete'` on `onUpdated`, not every change.** `onUpdated` fires repeatedly during a navigation (loading → URL change → title → complete). Gating on `complete` avoids re-running the state check 3-5 times per navigation, and matches what users see — the page is "done" by then.
- **Visibility check refreshes `activeTabId`.** Inside the visibilitychange handler we re-query the active tab and update `activeTabId` before calling `checkTabState`. The user may have switched tabs in another window while the panel was hidden; relying on the cached `activeTabId` would re-check the wrong tab.
- **`isAnalyzableUrl` lives in `shared.js`, not as a local helper.** `shared.js` is the canonical home for cross-context pure utilities (loaded via `importScripts` in background, `<script>` in sidepanel). The URL-guard logic is exactly that shape — pure, no side effects, useful anywhere a tab is inspected. Placing it next to `escapeHtml` matches the existing pattern.
- **Diagnostic breadcrumb stays in production.** A `console.warn` is cheap (one log line per state check on the rare undefined-URL path), removable later, and gives the next debugger a confirmation signal. Worth far more than gating behind a debug flag.
- **Diagnostic counters live in session storage, not local.** Session storage clears on browser restart, which is the right scope — the bug we're tracking is per-session timing. Local storage would conflate runs across days. The counters are also small enough that the storage write on every `checkTabState` is negligible.
- **Unsupported state adopts card-style, not status-message style.** The original message was a one-off paragraph that didn't match the tactic-card visual language elsewhere in the panel. Moving it to a card with title/body/footer-action makes the dead-end moment feel like part of the same system and gives the Try again button a natural footer position.
- **`showChecking` rather than holding the previous state.** When visibility fires on an "unsupported" panel, two options existed: hold the unsupported state while re-checking (silent recovery) or show a neutral checking state (visible transition). Chose checking because (a) silent recovery on the bug path flashed "Cannot analyze → analyzable" with no indication of why, which felt buggy, and (b) the visible spinner sets the expectation that something might change.
- **Try again button uses `setTimeout(120ms)` before re-check.** Pure UX choice — without the delay, the state transition is too fast to perceive; users would click and either nothing visible happens (state was already correct) or it snaps. The 120ms gives the fade-in time to land and reads as intentional.
- **Functional motion stays unconditional, polish motion stays flag-gated.** The 180ms status fade-in is a state-change communicator (you couldn't tell ready→empty from a no-op without it), so it lives outside `enhanced-motion`. The `enhanced-motion` flag remains for hover lifts and other polish that adds character without conveying state. `prefers-reduced-motion` overrides both.

**Tradeoffs:**

- **Best-effort fix without a reproducer.** The original "Cannot analyze this page" reports came without timing or URL details. Each of the three changes addresses a plausible cause, but we don't have a deterministic repro to confirm which one was the actual culprit in the wild. All three are independently defensible, low-risk, and don't conflict with each other.
- **Loosening the URL guard accepts edge cases.** A tab with truly undefined and unrecoverable URL state will now reach the analyze button instead of showing "Cannot analyze." If the user clicks analyze, downstream code will fail with a clearer error than the misleading "unsupported page" message. Net better UX even in the failure path.
- **Visibility listener adds a small cost on every panel show.** A single `chrome.tabs.query` call when the panel becomes visible. Negligible vs. the value of catching the lifecycle case.
- **Diagnostic counters write to session storage on every `checkTabState`.** This is one extra `chrome.storage.session.set` per state check, which fires on tab switch, navigation complete, and panel visibility. Quantitatively negligible (session storage writes are µs-level and not awaited), but it's a non-zero new write path. Removable once we have enough data to confirm the fix landed.
- **Structural tests are brittle.** The 11 new tests in `sidepanelContract.test.js` regex-match source patterns rather than asserting on behavior. If the implementation shape changes (rename a function, change a class name, restructure a listener), the tests will fail even if behavior is preserved. This is the right tradeoff for a recurring-bug area — the cost of brittleness is "update one regex per refactor," the cost of no test is "the bug returns in 3 months and no one catches it." Documented at the top of the test file so future maintainers know they're not pure-unit tests.
- **Architectural items deferred.** The review surfaced three larger items not addressed here: (a) extracting tab-state logic into a `TabStateController` (state machine refactor across ~4 listeners), (b) splitting `sidepanel.js` (749 lines) into `tabState.js` / `events.js` / `render.js`, and (c) adding a Diagnostics view in Settings that surfaces the breadcrumb counters to users. All three are reasonable next steps; all three are too broad to fold into a bug-fix branch without disproportionate regression risk. Filed as future work.

**SAFETY:** Modifies the page-state gating in the side panel. The URL guard now fails open (analyzable) on undefined URLs rather than failing closed (unsupported). New listeners (`chrome.tabs.onUpdated`, `visibilitychange`) only call `checkTabState`, which is idempotent and doesn't mutate persistent state. No error paths removed; the downstream analyze flow still validates URLs before making API calls.

**Files changed:** `sidepanel.js`, `shared.js`, `sidepanel.css`, `test/isAnalyzableUrl.test.js`, `test/sidepanelContract.test.js`, `core-docs/history.md`, `core-docs/plan.md`

### May 12, 2026 — Post-review corrections

Five small follow-ups to PR #32 driven by a careful post-ship code review.

**What was done:**

1. **Visibility-guard rationale corrected.** The `if (!activeTabId) return;` guard in `listeners.visibilityChange` was originally documented as preventing an "init race." On inspection, `setupEventListeners` runs at the end of `init()` — after `activeTabId` is assigned — so the guard is unreachable under the current registration order. Kept the guard as defense-in-depth but rewrote both the in-code comment and the design-decision below to honestly describe it as defensive (protects against a future change moving listener setup earlier) rather than claiming a race that can't happen.
2. **CSS comment / code mismatch fixed.** `sidepanel.css` had a comment claiming the `.status-message` fade animation was "Gated to enhanced-motion." The selector is actually `.status-message` (unconditional). The history's design decision was correct ("functional motion stays unconditional") — only the CSS comment was wrong. Rewrote the comment to match.
3. **Try again 120ms staleness eliminated.** The Try again button's `setTimeout(() => checkTabState(tab), 120)` captured a `tab` reference that could go stale if the user navigated during the 120ms defer. Now captures `tab.id`, re-queries via `chrome.tabs.get(tabId)` inside the setTimeout, wrapped in try/catch (the tab may have closed during the defer; visibility/onActivated will re-render correctly).
4. **"Try again" renamed to "Re-check".** The button doesn't retry a failed analysis — it re-checks the current page state. "Re-check" is more accurate, single-word, and doesn't carry retry semantics that confuse users on genuinely-unsupported pages (where clicking yields the same state).
5. **Diagnostic write throttle.** `chrome.storage.session.set` for the counters previously fired on every `checkTabState` call (100+/heavy session). Now writes only when the undefined-URL counter increments (the interesting case) OR every 50th total call (denominator checkpoint for healthy sessions). In-memory counters tick on every call, so DevTools inspection of the live page is unaffected.

**Design decisions (correcting Phase 22):**

- **Kept the guard rather than moving listeners earlier.** Moving `setupEventListeners` before `init()`'s `await chrome.tabs.query` would make the guard load-bearing, but introduces a behavior window where listeners can fire on null `activeTabId`. Each listener IS null-safe (verified), but this is a behavior change worth careful browser testing — disproportionate risk for the bug-fix branch. Filed as future consideration.
- **Write throttle uses an OR condition, not a pure undefined-only filter.** "Only write on undefined increment" would leave the storage empty in healthy sessions, making it impossible to compute a meaningful ratio if the bug recurs. The `count % 50 === 0` checkpoint gives a denominator without saturating the write path.
- **Try again re-queries via `chrome.tabs.get(tabId)`, not `chrome.tabs.query` again.** Cheaper (single-tab lookup vs. active+window filter) and more direct — we know the tab id we want to refresh.

**Tradeoffs:**

- **The guard is admittedly dead code today.** Reasonable readers may want to delete it. Comment now explicitly says it's defensive against future refactor — the trigger to remove it would be a code archaeologist confident no future refactor will reverse the registration order.
- **The 120ms defer in the Try again handler is still arbitrary.** Replacing the captured tab with a re-query fixes the correctness issue but doesn't eliminate the magic number. A two-frame `requestAnimationFrame` would be more principled but adds nesting. Acceptable tradeoff for the simplicity.

**SAFETY:** No new error paths or persistence behavior. Counter-write throttle reduces I/O. Try again handler now has a try/catch around `chrome.tabs.get` — swallowing the rare "tab closed during defer" case is correct (visibility/onActivated will re-render).

**Files changed:** `sidepanel.js`, `sidepanel.css`, `test/sidepanelContract.test.js`, `core-docs/history.md`, `core-docs/plan.md`

---

## Phase 21: Flash 2.5 API Reliability Fixes (April 2026)

### Apr 19, 2026 — Fix token budget mismatch and add model-aware timeouts for thinking models

**Branch:** `fix-api-settings-snapshot` (from `6930837`)

**Summary:** Flash 2.5 is a thinking model that consumes output tokens for internal reasoning, causing API errors under two conditions: (1) server proxy mode had the wrong token budget (4096 instead of 8192), and (2) all models shared the same 30s timeout regardless of thinking overhead. Fixed both root causes.

**What was done:**

1. **server.js token budget fix:**
   - `CONFIG.MODELS['gemini-2.5-flash'].tokens` changed from 4096 to 8192
   - Background.js (BYOK mode) already had 8192; server proxy mode was the only path with the wrong value
   - Thinking models use output tokens for internal chain-of-thought reasoning, so 4096 total output tokens could cause truncated or malformed responses when the model spent most of the budget on thinking

2. **Model-aware timeouts in background.js:**
   - Added `TIMEOUT_MS_THINKING: 60000` (60s, vs 30s default `TIMEOUT_MS`) to CONFIG
   - Added `THINKING_MODELS: ['gemini-2.5-flash']` array to CONFIG for easy future extension
   - `fetchWithRetry` now accepts a `timeoutMs` parameter, passed through on retries
   - Both `callGeminiDirect` (BYOK) and `callServerProxy` pass the appropriate timeout based on whether the model is in the `THINKING_MODELS` list

3. **Model-aware timeout checks in sidepanel.js:**
   - The UI-side "may have timed out" guard now uses 75s for thinking models vs 45s for standard models
   - Prevents premature timeout warnings while Flash 2.5 is still working through its thinking phase

**Why:**

Flash 2.5 was returning API errors that appeared intermittent. Two independent causes were identified:

- The token budget mismatch in server.js was a real bug — the value should have been updated when Flash 2.5 was added (background.js had the correct value, server.js didn't). This is the higher-confidence fix.
- The timeout issue is a reasonable assumption for thinking models: they need more time than non-thinking models because internal reasoning happens before response generation begins. The 30s default timeout could abort requests that were still in the thinking phase.

**Design decisions:**

- **`THINKING_MODELS` array rather than per-model timeout fields.** A simple array check (`THINKING_MODELS.includes(model)`) is cleaner than adding a `timeoutMs` property to each model config entry. It also makes the intent explicit — this is about the thinking/non-thinking distinction, not arbitrary per-model tuning. Adding future thinking models (e.g., a hypothetical Gemini 2.5 Pro) requires only one array entry.
- **`timeoutMs` as a parameter to `fetchWithRetry` rather than reading CONFIG internally.** Keeps `fetchWithRetry` generic — callers decide the timeout based on their context. The function doesn't need to know about model types.

**Tradeoffs:**

- **Best-effort fixes without direct error diagnosis.** The actual API errors weren't captured with enough detail to confirm either root cause definitively. The token budget fix (server.js had the wrong value, period) is certain. The timeout fix is a reasonable inference — thinking models plausibly need more time — but the original errors may not have been timeout-related. Both fixes are low-risk and correct regardless of whether they address the specific errors observed.
- **60s thinking timeout is a guess.** There's no published guidance on how long Flash 2.5 thinking takes. 60s (2x the standard 30s) provides headroom without being so long that real failures take too long to surface. Can be tuned if empirical data shows it's too short or too long.
- **75s UI-side guard for thinking models.** The sidepanel timeout (75s) is higher than the fetch timeout (60s) to avoid the UI showing "may have timed out" while the fetch layer is still retrying. The 15s gap matches the existing 15s gap between the standard timeouts (30s fetch, 45s UI).

**SAFETY:** Modifies timeout and error-handling behavior in the API call path. `fetchWithRetry` signature changed (new optional `timeoutMs` parameter, backward-compatible — defaults to existing behavior when omitted). Server proxy token budget changed for Flash 2.5. Sidepanel timeout guard thresholds changed for thinking models. All changes increase tolerance (longer timeouts, more output tokens), reducing the chance of premature failures. No error paths removed.

**Files changed:** `background.js`, `server.js`, `sidepanel.js`

---

## Phase 20: Side Panel Card Cleanup (April 2026)

### Apr 19, 2026 — Attribution dedup, confidence labels, contrast boost, alignment fixes

**Branch:** `sidepanel-card-cleanup` (from `b0f5ea9`)

**Summary:** Addressed user feedback on side panel card layout: repetitive attribution headers, unreadable grey text, unexplained confidence labels, and misaligned text gridlines. Also fixed review skill test command and gitignored `.context/`.

**What was done:**

1. **Grouped consecutive same-speaker attributions:**
   - When consecutive instances within a tactic card share the same `attributedTo`, the "IN A QUOTE BY..." header renders only once for the group
   - Handles edge cases: first instance always shows header, different speakers get separate headers, undefined `attributedTo` grouped correctly

2. **Confidence labels (mixed-only):**
   - Removed the `instance-medium` opacity dimming (was 0.6) — confidence is now communicated via text labels, not visual dimming
   - Labels ("High confidence" / "Medium confidence") only appear when a card has mixed confidence levels — all-high cards stay clean
   - Added tooltip on hover explaining what confidence means

3. **`--text-muted` contrast boost:**
   - Changed from `hsl(0, 0%, 55%)` to `hsl(0, 0%, 65%)`
   - Contrast ratio on dark background: ~5.5:1 → ~7.4:1 (both WCAG AA, but new value significantly more readable on small monospace text)

4. **Vertical alignment cleanup (compact layout):**
   - `.card-definition` gets `padding-left: 13px` to align with tactic name text (past the 3px category bar + 10px gap)
   - `.compact-layout .instance-explanation` changed from `padding-left: 9px` to `0`, aligning flush with attribution/confidence text
   - Reduces effective text gridlines from 4+ to 2 (heading block at ~29px, all instance text at 16px) plus quote blocks as visually distinct bordered elements

5. **Review skill fix:** Changed test command from `npx jest --verbose` to `npm test` — the project requires `--experimental-vm-modules` for ESM support, which only the npm script includes.

6. **Added `.context/` to `.gitignore`** — prevents accidental commits of Conductor workspace files (attachments, review checkpoints). Forge uses `.claude/forge/` (separately gitignored), so no side effects.

**Design decisions:**

- **Attribution dedup vs. quote merging:** User noted that consecutive quotes from the same person broken by narrative text should "be treated as one." The UI fix (skip repeated headers) addresses the visual noise without changing the data model. Merging the quotes themselves would require prompt-level changes — out of scope for a UI pass.
- **Mixed-only confidence labels:** Showing "High confidence" on every instance when all are high adds visual weight without information value. Labels only appear when there's variation within a card, making them informative rather than decorative.
- **Definition indent (13px):** Aligns definition text with the tactic name, consolidating the heading block. Creates a clear visual break between the heading (name + definition at ~29px) and instance content (at 16px).

**Tradeoffs:**

- Bumping `--text-muted` to 65% narrows the gap with `--text-tertiary` (70%) to just 5 points. Accepted because: they serve different functional roles (labels vs. body text), the slight blue tint on tertiary maintains visual distinction, and the user explicitly reported readability issues.
- Not showing confidence labels on all-high cards means users don't see confirmation that items are high confidence. Accepted because the absence of a "medium" label implicitly signals high confidence, and the tooltip on mixed-card labels explains this.

---

## Phase 19: Forge Infrastructure Pass (April 2026)

### Apr 18, 2026 — Review/ship skill redesign, detection accuracy rule, CLAUDE.md refinements

**Branch:** `optimize-forge-setup` (from `94e0f89`)

**Summary:** Ran Forge analysis across 26 sessions. Filtered 6 raw proposals to 4 (5 generic workflow agents removed by quality gate). Applied 3: new `/review` skill with three-perspective framework, updated `/ship` to use review checkpoints without auto-merge, and a scoped detection accuracy rule. Deleted `/audit` (replaced by `/review`).

**What was done:**

1. **`/review` skill** (new, replaces `/audit`):
   - Three independent review perspectives: Staff Engineer (correctness, security, patterns), Staff UX Designer (experience, hierarchy, accessibility), Staff Design Engineer (design-to-code fidelity)
   - Cross-check and consolidation step that deduplicates, resolves tensions, and prioritizes
   - Saves checkpoint to `.context/review-report.json` so `/ship` can skip redundant re-review
   - Incremental re-review: only re-checks files changed since last report

2. **`/ship` skill** (updated):
   - Reads `/review` checkpoint — if clean and current, skips to doc updates
   - Minimal gate fallback when no review exists (tests + history.md check)
   - No longer auto-merges — opens PR and stops

3. **Detection accuracy rule** (`.claude/rules/detection-accuracy.md`):
   - Scoped to `*.js`, `server.js`, `unified-taxonomy.md`
   - Enforces precision over recall for detection logic changes
   - Requires benchmark verification before shipping prompt changes

4. **CLAUDE.md**: Added "UI feedback is visual" to How to Work section.

**Design decisions:**

- **Two skills vs. one monolith:** Kept `/review` and `/ship` separate for token efficiency. Review can be re-run after fixes without paying for the ship context. Ship after a clean review is lightweight — just reads the checkpoint.
- **Three-perspective framework over flat checklist:** User's existing review prompt used independent expert perspectives that then cross-check each other. This catches more issues than a single-pass checklist because different lenses surface different problems, and the consolidation step resolves tensions.
- **No auto-merge on /ship:** User always reviews before merging. Removing auto-merge makes this explicit in the skill definition.

**Tradeoffs:**

- The three-perspective review is more thorough but costs more tokens than the old `/audit`. Tradeoff accepted because review quality was the user's priority, and the checkpoint system amortizes cost across the review→fix→re-review cycle.
- Deleted `/audit` entirely rather than keeping it as a lightweight option. The minimal gate in `/ship` step 1b covers the "quick sanity check" use case.

---

## Phase 18: Design Craft Pass (April 2026)

### Apr 14, 2026 — Feature flag system, interactive legend filter, enhanced motion, compact layout, UI polish

**Branch:** `design-craft-audit` (from `cd591ca`, commit `1a39eb6`)

**Summary:** Design craft audit driven by 8-lens critique (fidgetability, morphing, hospitality, motion, reduction, metaphor integrity). Built a registry-driven feature flag system for A/B testing new features. Shipped 4 flagged features (legend filter, snapshot gating, enhanced motion, compact layout) and a set of direct UI fixes (clear button color, quote treatment, alignment, deprecated API).

**What was done:**

1. **Feature flag system:**
   - `FEATURE_FLAGS` registry in `shared.js` — single source of truth (label, description, default)
   - Adding a new flag = one entry; toggle auto-appears in Settings > Experiments
   - `getFeatureFlags()` merges stored values with defaults (new flags auto-appear with defaults)
   - Options page: auto-generated toggle switches from registry, immediate save on click
   - Side panel: flags loaded on init, cached in `activeFlags`, updated via storage change listener
   - CSS-driven flags (`enhancedMotion`, `compactLayout`) toggle body classes live — no reload needed

2. **Category legend filter** (`legendFilter` flag, default: on):
   - Click legend dots to toggle tactic category visibility
   - Dimmed: dot becomes hollow ring (inset box-shadow), label drops to 35% opacity
   - Filtered cards: 8% opacity in place (no layout shift), pointer-events disabled
   - Dot scales to 75% on press for tactile feedback
   - Non-filterable legend (flag off): cursor reverts to default, hover has no effect

3. **Enhanced motion** (`enhancedMotion` flag, default: on):
   - Card hover: `translateY(-1px)` lift with deeper shadow (`0 4px 16px`), 0.2s transition
   - Card flash: `cardGlowPulse` animation (0.5s ease-out) replaces static transition, hold extended 300→500ms
   - Analyze button: `scale(0.97)` with 0.06s snap-down, inherits 0.12s release (physical button feel)
   - Category bar: `brightness(1.2)` on hover, widens 3→4px on keyboard focus

4. **Compact layout** (`compactLayout` flag, default: on):
   - Card instances/actions/learn-more padding: `26px` → `var(--panel-pad)` (14px)
   - Instance left-border + padding removed; replaced with horizontal `1px` separators between instances
   - Recovers ~24px of horizontal space for quote text (~300px → ~324px usable in 400px panel)
   - Tighter card-to-card spacing (10→8px), header/legend margins tightened
   - Definition: 2-line `-webkit-line-clamp` for density control
   - Explanation text and "Why?" button aligned with quote content edge (9px indent)

5. **Direct UI fixes (not flagged — always active):**
   - Clear button: neutral color (was incorrectly using `--cat-credibility` red)
   - Instance quotes: monospace code-block treatment with subtle border/bg (was italic + underline)
   - "What you can do" → "What to look for" (tool-like framing, not teacher-mode)
   - Snapshot: auto-copies JSON to clipboard on save via `navigator.clipboard.writeText()`
   - Re-run button sizing unified (removed extra font-family/font-size overrides on inline variant)
   - Card header: removed `cursor: pointer` (no click handler exists — broken affordance)
   - Error message: fixed double horizontal margin (`margin: 12px var(--panel-pad)` → `12px 0`)
   - Analysis coverage: `text-align: center` → `left` (consistency)
   - `navigator.platform` → `navigator.userAgentData?.platform` with fallback (deprecated API)
   - Removed unused `--panel-gap` CSS variable
   - Removed inert `border-left-style: dashed` on `.instance-source`
   - Consolidated duplicate `.btn-rerun`/`.btn-snapshot` CSS into shared selector

**Why:**

The interface was functional but static — nothing responded to touch, transitions were innerHTML replacements, and each nesting level consumed horizontal space. A staff-level design audit identified that the biggest craft gaps were: (1) the category legend was static decoration earning no screen space, (2) motion was adequate but not physical, (3) instance indentation stacked 62px of left margin in a 400px panel, and (4) several visual inconsistencies (red clear button, italic quotes in a DevTools aesthetic, broken cursor affordance). The feature flag system was built first to support rapid A/B testing of each change.

**Design decisions:**

- **Registry-driven flags over ad-hoc booleans.** One object in `shared.js` drives the entire system: options UI, side panel behavior, and CSS classes. Adding a flag is a single entry — no plumbing in settings page or consumer code beyond gating the feature itself.
- **CSS body-class flags for layout/motion.** `enhancedMotion` and `compactLayout` use `.enhanced-motion` and `.compact-layout` body classes. CSS overrides at the end of the file scope all enhanced styles. This means toggling a flag in settings updates the UI immediately — no re-analysis or reload needed.
- **Fade-in-place filtering over collapse.** Filtered cards ghost to 8% opacity instead of being removed. Preserves spatial memory, avoids layout shift, makes the filter feel reversible and lightweight.
- **Monospace code-block quotes over italic + underline.** The DevTools metaphor calls for code-inspection styling, not book-annotation styling. The code block (`font-mono`, subtle bg, 1px border) fits the inspector aesthetic while the italic + underline fought it.
- **Horizontal instance separators over vertical left-border.** The left-border consumed 12px per instance (2px border + 10px padding). Horizontal `1px` separators between instances cost zero horizontal space and provide the same visual grouping.

**Tradeoffs:**

- **All flags default to `on`.** This means users get the new behavior immediately. If a flag causes issues, it can be toggled off in settings. The alternative (default off, opt-in) would mean most users never see the improvements.
- **`!important` on `.category-filtered` opacity.** The card entrance animation uses `forwards` fill mode which holds `opacity: 1`. Normal cascade can't override animation fills, so `!important` is required. Architecturally fragile if more animation states are added.
- **Compact layout changes definition clamp.** The 2-line clamp on `.card-definition` may truncate longer definitions with no way to expand them (unlike "Learn more" which has its own toggle). Acceptable because most definitions are already 1-2 lines, and the full definition is visible with the flag off.

**SAFETY:** All changes are presentation-only. No analysis pipeline, API calls, or data storage modified. Feature flags default to `on` but stored values survive extension updates (new flags get defaults automatically via merge logic).

**Test results:** 94 tests pass across 7 suites. No regressions.

**Files changed:** `shared.js`, `sidepanel.css`, `sidepanel.js`, `options.html`, `options.js`

---

## Phase 15: Priority 1 — Accuracy & Trust (April 2026)

### Apr 9, 2026 — Prompt tuning v1→v2→v3, confidence scoring, eval infrastructure, corpus audit

**Branch:** `roadmap-review` (from `9c8642b`)

**Summary:** Three prompt iterations drove precision from 30% → 55% across full 119-file eval. Core principle established: "precision over volume — only flag significant, clearly manipulative instances." False positives cut from 347 → 121 while losing only 2 true positives. Eval harness migrated to Gemini. Corpus audited and corrected. Progressive eval skill (`/eval-quick`) created. Accuracy plan written for path to 85% target.

**What was done:**

1. **V3 prompt — precision-focused rewrite:**
   - New core principle: "PRECISION OVER VOLUME" — if you have to argue why something qualifies, it probably doesn't
   - Primary tactic rule: flag the main tactic per passage, don't stack multiples on the same text
   - "What IS manipulation" vs "What is NOT manipulation" — concrete positive/negative guidance replacing abstract disambiguation
   - Stronger few-shot examples: clear manipulation, strong-but-legitimate (no flags), and mixed (one tactic, resist over-flagging)
   - User prompt reinforcement: "When in doubt, leave it out"

2. **Full eval comparison (119 files × 3 prompts on Flash Lite):**
   - v1 → v2: precision 30% → 35% (+5%), FPs 347 → 278 (-69)
   - v2 → v3: precision 35% → 52% (+17%), FPs 278 → 136 (-142)
   - v3 + corpus fixes: precision 52% → 55%, FPs 136 → 121 (-15)
   - Recall held steady: 76% → 73.5% (lost only 2 TPs across all iterations)

3. **Corpus audit (7 benchmark files corrected):**
   - benchmark-01: replaced borderline Emotional Language with Polarization
   - benchmark-03: added Emotional Language for ALL CAPS fear-mongering
   - benchmark-05: added second Ad Hominem ("ivory towers")
   - benchmark-07/08: fixed Fake Experts quotes to point at the manipulative claim, not setup text
   - benchmark-11: added False Dichotomy ("action right now, not calm deliberation")
   - benchmark-13: added second Ad Hominem ("silver spoon")
   - Clean and tactic-specific files confirmed correct

4. **Eval infrastructure:**
   - `--subset` flag for targeted eval runs
   - `eval/compare-quick.sh` — progressive eval script (10 files/day, accumulates results)
   - `npm run eval:quick` convenience script
   - `/eval-quick` skill for repeatable testing across sessions
   - `core-docs/accuracy-plan.md` — roadmap for reaching 85% precision target

5. **FB-0013 captured:** "Only flag significant, high-confidence manipulation" — core product principle

**Why:**

User testing revealed that over-flagging undermines the product. Weak flags (common strong language, borderline cases, quoted speech misattributed to the author) make the system feel unreliable and reduce its usefulness. The v3 prompt embodies the principle that a missed borderline tactic is better than a false alarm. This aligns with the product thesis: "make manipulation visible" means making REAL manipulation visible, not stretching to find it everywhere.

**Design decisions:**

- **"Precision over volume" as a prompt-level principle, not just a scoring goal.** The v2 prompt tried to constrain the model with negative examples and disambiguation rules. V3 goes further — it tells the model its *role* is to surface significant manipulation, and explicitly says false alarms erode credibility. This framing shift produced a bigger precision jump (+17%) than v2's specific rules (+5%).
- **Primary tactic rule.** The model was stacking 3-4 tactics on the same passage (e.g., Slippery Slope + Emotional Language + False Dichotomy). V3 instructs: flag the primary tactic, don't also flag the emotional language that serves it. This directly addresses the 73 cross-tactic FPs found on single-tactic files.
- **"What IS / What is NOT" structure.** V2 had abstract disambiguation rules ("Emotional Language vs. genuine strong opinion"). V3 replaces these with concrete side-by-side contrasts: "I am heartbroken about the factory closure" = NOT manipulation vs "This HORRIFYING crisis will DESTROY your family" = IS manipulation. Concrete beats abstract.
- **Corpus audit used a high bar.** Only added annotations for instances that clearly pass the test: "would a reader benefit from knowing this is manipulation?" Removed one borderline annotation. Net +4 annotations across 119 files, confirming the corpus was already well-calibrated.

**Tradeoffs:**

- **V3 prompt adds ~200 tokens over v2.** The "What IS / What is NOT" section and third few-shot example add length, but the precision-over-volume framing actually produces shorter model responses (fewer detections = fewer output tokens), making total cost roughly neutral.
- **Appeal to Authority recall dropped from 88% → 63%.** The "What is NOT manipulation" section says citing relevant experts isn't Appeal to Authority. The model may be applying this too broadly, missing cases where authority IS being invoked to shut down debate. Worth monitoring.
- **Corpus changes are modest (net +4 annotations).** The accuracy plan estimated 80-120 FPs were actually correct detections the corpus missed. The audit found only ~5. This means the remaining 121 FPs are mostly genuine model over-flagging, and further improvements need to come from prompt/scoring changes, not corpus fixes.

**SAFETY:** All `parseJsonResponse` changes are backwards-compatible (confidence defaults to "high" when absent). Production prompt change is a prompt-content-only update — no code paths or error handling modified.

**Test results:** 77 tests pass across 6 suites. No regressions.

**Files changed:** `background.js`, `prompts.js`, `eval/prompts/v3.cjs` (NEW), `eval/harness.cjs`, `eval/compare-quick.sh` (NEW), `.claude/skills/eval-quick/SKILL.md` (NEW), `core-docs/accuracy-plan.md` (NEW), `core-docs/feedback.md` (FB-0013), `package.json`, `.gitignore`, 7 corpus files

---

### Earlier in session — Prompt tuning (v2), confidence scoring, coverage indicator, text structure preservation

**Branch:** `roadmap-review` (from `9c8642b`)

**What was done:**

Completed the three active Priority 1 items (1.1 partial, 1.2, 1.3):

1. **1.1 — Prompt tuning with few-shot examples and confidence scores (partial):**
   - Migrated eval harness from Anthropic SDK to Google Gemini (`@google/generative-ai`)
   - Synced eval/prompts/v1.cjs with production prompt (had been missing attribution rules since Phase 13)
   - Wrote v2 prompt (eval/prompts/v2.cjs) with all four tuning strategies: confidence scoring ("high"|"medium"), tactic disambiguation (6 commonly confused pairs), negative examples (what NOT to flag), and few-shot examples (3 examples covering emotional language, clean text, and quoted speech)
   - Shipped v2 prompt to production: background.js `buildSystemPrompt()` and prompts.js both updated
   - Added confidence field to `parseJsonResponse` in background.js, server.js, and eval harness
   - Built confidence UI: sidepanel shows "Medium confidence" label and dims medium instances (0.6 opacity); content script shows dotted border and 0.4 opacity for medium-confidence highlights
   - Ran partial baseline eval (12/109 files before hitting free tier limit): 31% precision, 78% recall, 100% quote fidelity
   - **Blocked:** Full eval comparison requires more quota (free tier: 20 req/day per model)

2. **1.2 — "Analyzed X of Y" indicator:**
   - `collectText()` now returns `{ text, totalChars, analyzedChars }` instead of a plain string
   - background.js passes both values through to session storage
   - sidepanel.js shows "Analyzed first X of Y characters" below the summary when truncation occurred
   - Styled with mono font, muted color, centered layout

3. **1.3 — Preserve text structure in collection:**
   - `collectText()` switched from Set (which loses order and deduplicates) to Array with block-ancestor tracking
   - Uses existing `nearestBlockAncestor()` and `BLOCK_TAGS` to determine paragraph boundaries
   - Same block ancestor: join with single space. Different block: join with `\n\n`
   - Normalizes output: collapses 3+ newlines to `\n\n`, collapses spaces/tabs (not newlines) to single space
   - Safe for fuzzy matcher: `normalizeText()` collapses all whitespace during comparison, so newlines don't break matching

**Why:**

Priority 1 is about accuracy and trust — the foundation of the product's value proposition. The v1 prompt was a tactic list with no examples, no disambiguation guidance, and no confidence calibration. The text collection was a flat string with no structure (losing paragraph boundaries) and no transparency about truncation. These three items address the main accuracy and trust gaps:
- **1.1** reduces false positives through better prompt design and gives users confidence calibration
- **1.2** makes truncation visible so users don't assume the full page was analyzed
- **1.3** gives the AI paragraph structure to make better contextual judgments

**Design decisions:**

- **Confidence as "high"|"medium" rather than a numeric score.** The model isn't calibrated for precise probabilities. A binary high/medium distinction is honest about what the model can reliably distinguish — "I'm quite sure" vs. "this could go either way." Considered adding "low" but decided those should just not be flagged at all (the prompt instructs this).
- **Tactic disambiguation as explicit pairs, not general guidance.** Rather than telling the model to "be careful about similar tactics," the v2 prompt lists 6 specific confusion pairs with concrete rules: Scapegoating vs Ad Hominem (blame shifting vs character attack), Emotional Language vs strong opinion, Cherry Picking vs normal argumentation, False Dichotomy vs real binaries, Appeal to Authority vs legitimate citation, Polarization vs legitimate criticism. Specific disambiguation outperforms vague caution.
- **Negative examples in the prompt.** Telling the model what NOT to flag is as important as telling it what to flag. V2 includes explicit "do not flag" instructions for: statistics and data points, direct quotes being reported, domain expert citations, and critical analysis/debunking.
- **Few-shot examples chosen for common failure modes.** Three examples: (1) emotional language with high confidence (shows what a correct detection looks like), (2) clean text with no flags (shows restraint), (3) quoted speech with source attribution (shows the attribution framework in action).
- **Coverage indicator uses mono font.** The "Analyzed first X of Y characters" text uses monospace to visually separate it as a metadata/diagnostic element, not a finding.
- **Block-ancestor tracking reuses existing infrastructure.** `nearestBlockAncestor()` and `BLOCK_TAGS` were already defined in content.js for highlighting. No new DOM constants needed.

**Technical decisions:**

- **Eval harness Gemini migration:** API key check changed from `ANTHROPIC_API_KEY` to `GEMINI_API_KEY`. Client switched from Anthropic `messages.create` to Gemini `generateContent`. Rate limiter updated to be model-aware: 13s delay for Flash 2.5 (5 req/min), 2.5s for Flash Lite (30 req/min). Added retry logic for 429 and 5xx errors with 25s backoff.
- **collectText() return type change:** Changed from returning a plain string to `{ text, totalChars, analyzedChars }`. The `totalChars` represents all collected text before truncation; `analyzedChars` is what was actually sent to the API. This required updating all callers in content.js message handlers and background.js.
- **Set to Array in collectText():** The previous implementation used a Set to deduplicate text nodes, but this lost insertion order (in practice, V8 Sets preserve insertion order, but the semantic intent was wrong) and collapsed text from different elements that happened to have identical content. The Array approach preserves order and tracks which block ancestor each node belongs to, enabling paragraph boundary detection.
- **Newline normalization strategy:** Collapsing 3+ newlines to `\n\n` prevents excessive whitespace from deeply nested DOM structures while preserving intentional paragraph breaks. Spaces and tabs are collapsed to single space but newlines are preserved — this is the key difference from `normalizeText()` which collapses everything.

**Tradeoffs:**

- **V2 prompt adds ~800 tokens to every request.** Few-shot examples, disambiguation notes, and negative examples increase the system prompt significantly. Per FB-0001 (cost-conscious), this is justified: the tokens target the biggest accuracy problems (false positives from over-flagging), and the user's API cost increase is marginal (input tokens are cheaper than output tokens, and the prompt is cached by the API on repeated requests within a session).
- **Partial eval results (12/109 files) are not statistically reliable.** The 31% precision is concerning but expected — v1 was known to over-flag. The comparison that matters (v1 vs v2 on the same corpus) hasn't been run yet. The partial results confirm the tooling works but shouldn't drive prompt changes.
- **collectText() API change could break callers.** Changed from returning a string to an object. All callers within the codebase were updated, but any external code (there is none) would break. The change is safe because `collectText()` is only called via Chrome message passing within the extension.
- **Block-ancestor tracking adds a DOM lookup per text node.** `nearestBlockAncestor()` walks up the DOM tree for each node to find its block-level ancestor. On large pages this could be measurable, but the existing `collectText()` already does similar DOM traversal, and text collection is not the performance bottleneck (API latency dominates by orders of magnitude).

**Discovery — Gemini free tier rate limits:**
- Free tier allows only 20 requests per day per model (both Flash 2.5 and Flash Lite)
- Per-minute limits: 5/min for Flash 2.5, 30/min for Flash Lite
- A full 119-file eval run is impossible on free tier in a single session
- The eval harness handles this gracefully (rate limiting + retry), but a paid API key is needed for efficient eval iterations

**SAFETY:** `parseJsonResponse` in background.js and server.js updated to extract the new `confidence` field, defaulting to `"high"` when absent. This is backwards-compatible — responses from the v1 prompt (without confidence) will render identically to before. The `collectText()` return type change required updating all message handlers, but the old string-only callers would fail obviously (not silently), so there's no hidden degradation path.

**Test results:** 77 tests pass across 6 suites. No regressions. Test count unchanged from Phase 13 (no new tests added in this phase — the changes are to production code and prompt content, not to testable behavior boundaries).

**Files changed:** `background.js`, `server.js`, `prompts.js`, `content.js`, `sidepanel.js`, `sidepanel.css`, `eval/harness.cjs`, `eval/prompts/v1.cjs`, `eval/prompts/v2.cjs` (NEW)

---

## Phase 17: Dev Snapshot Capture — Item 5.8 (April 2026)

### Apr 9, 2026 — Ship dev snapshot feature for analysis review

**Branch:** `finish-priority-5`

**What was done:**
1. Added "Save Snapshot" button (floppy disk icon) to the side panel results header, next to the re-run button.
2. Clicking the button reveals an inline comment input with Save button. Enter to save, Escape to dismiss.
3. Each snapshot captures the full analysis context: page URL, page title, analyzed text, all tactic results, raw model response, model name, token count, analysis timestamp, save timestamp, and optional user comment.
4. Snapshots stored in `chrome.storage.local` under `devSnapshots` key as an accumulating array. Each snapshot gets a `crypto.randomUUID()` id.
5. Added Dev Tools section to the options page showing snapshot count, Export as JSON button (downloads dated file), and Clear All button (with confirmation).
6. Modified `background.js` to persist the analyzed text (`analyzedText`) in session storage alongside results, so it's available for snapshot capture without re-collecting.
7. Added 17 tests covering snapshot structure, accumulation, and export round-trip.

**Why:**
Item 5.8 (FB-0012) identified that during development there's no way to capture rich analysis context for review. The eval harness tests prompts against controlled corpus, but dev snapshots capture real-world observations — "this page had a false positive" or "this headline was missed" — which feed into corpus building and prompt tuning.

**Design decisions:**
- **chrome.storage.local over IndexedDB**: Simpler API, no schema management, and the data volume is small (each snapshot is ~10KB with full text). IndexedDB would only be needed at hundreds of snapshots, which is unlikely during dev.
- **Inline comment input (not modal)**: Keeps the flow lightweight — click, type optional note, save. No context switch.
- **Accumulate array, not keyed by URL**: Multiple snapshots of the same page are valuable (before/after prompt changes, different models). Deduplication would lose this signal.
- **Export as JSON file, not clipboard**: Clipboard is limited by size; JSON file integrates naturally with the eval corpus workflow (`eval/corpus/`).
- **No storage quota management**: `chrome.storage.local` has a 10MB quota. At ~10KB per snapshot, that's ~1000 snapshots before concern. Not worth adding eviction logic for dev-only infrastructure.

**Tradeoffs:**
- Could have built a snapshot viewer/browser in the options page. Decided against it — the JSON export is sufficient for dev review, and building a viewer would be scope creep for dev-only tooling. If the export proves insufficient, a viewer can be added later.
- Considered re-collecting text on snapshot save instead of storing it in session. Storing it adds ~5KB to session storage per tab but avoids a round-trip to the content script and the possibility that the page has changed since analysis.

**Files changed:** `background.js`, `sidepanel.js`, `sidepanel.css`, `options.html`, `options.js`, `test/devSnapshot.test.js`

---

## Phase 16: Academic Sources & Attribution (April 2026)

### Apr 9, 2026 — Expand SOURCES.md with theoretical grounding and design references

**Branch:** paper-framing-analysis

**What was done:**
1. Added citation for Starbird et al. 2025 ("What is going on? An evidence-frame framework") — theoretical grounding for how framing-based manipulation operates.
2. Added citation for Prochaska et al. 2025 ("Deep Storytelling: Collective Sensemaking and Layers of Meaning in U.S. Elections") — context for why manipulation tactics work via persistent meta-narratives.
3. Added Jigsaw Prebunking Initiative (prebunking.withgoogle.com) as a design reference — inoculation theory influenced the extension's "educate, don't censor" philosophy.
4. Standardized formatting across all SOURCES.md entries (consistent License labels, citation structure, relevance sections).

**Why:**
The extension's academic grounding was incomplete. CoCoLoFa and MAFALDA covered the taxonomy expansion (11 to 15 tactics) but the original tactic selection and the project's educational design philosophy had no documented sources. The two CSCW papers provide theoretical context for existing tactics (especially Decontextualization, Cherry Picking, Emotional Language), and Jigsaw documents the design lineage.

**Design decisions:**
- Organized SOURCES.md into four sections: Taxonomy References, Design References, Theoretical References, Original Content. Each serves a distinct role (what we built from, what inspired the approach, what validates the framework, what's ours).
- Each theoretical paper includes a "Relevance to this project" section that explicitly scopes what's applicable and what's not (e.g., social-dynamic findings are not implementable in a single-page extension).
- Assessed both papers for implementable findings. Concluded that they enrich existing tactic definitions (especially Decontextualization) but do not warrant new tactics — the distinctive findings operate at social/multi-text scales beyond the extension's single-page architecture.

**Tradeoffs:**
- Could have added "Frame Escalation" or "Implicit Framing" as new tactics based on the papers. Decided against it: frame escalation is a social process across multiple posts (not visible on one page), and the papers' own coders had low inter-rater reliability on implicit frames. Adding either would violate the "accuracy over coverage" principle.

**Files changed:** `core-docs/SOURCES.md`

---

## Phase 15: Priority 5 — UX Feedback Round (April 2026)

### Apr 9, 2026 — Ship 6 of 8 UX feedback items

**Branch:** `priority-5-work`

**What was done:**
1. **5.1 Empty state copy** — Removed "Try analyzing a news article or opinion piece with strong claims." Changed to neutral "No manipulation tactics detected on this page." (FB-0005)
2. **5.2 Re-run button** — Added circular-arrow re-run button in results header and empty state. Re-run clears highlights and immediately starts new analysis. Waits for clear callback to avoid race conditions.
3. **5.3 Accessibility pass** — Bumped font scale +1px across the board (xs:11, sm:12, base:13, md:14). Improved contrast: `--text-tertiary` from 64% to 70% lightness, `--text-muted` from 48% to 55%. Added text size preference (Small/Medium/Large) in options page stored in `chrome.storage.local`.
4. **5.4 Highlight reliability fix** — Root cause: `collectText()` skips text inside `.mi-highlight` spans. On re-analysis, if old highlights aren't cleared before text collection, the collected text differs from the original page text, causing the fuzzy matcher to miss quotes. Fix: `handleAnalyze()` in background.js now sends a defensive `CLEAR_HIGHLIGHTS` before `COLLECT_TEXT`. The re-run button also waits for the clear response callback before starting analysis.
5. **5.5 Main content filtering** — `collectText()` now uses `findMainContent()` to look for `<article>`, `<main>`, `[role="main"]` in order. If found, constrains TreeWalker root to that element. If not found, falls back to `document.body` with secondary content exclusions: `aside`, `nav`, `header`, `footer`, `[role="complementary"]`, `[role="navigation"]`, and elements with class/ID matching patterns (sidebar, related, trending, popular, recommended, widget, ad-container, promo, newsletter, social-share).
6. **5.7 Progressive disclosure** — Card view now shows tactic name + instance count badge, quotes only (no explanations by default). Explanations revealed on double-click. When 3+ instances exist, shows first 2 with "and N more" expandable button. Definition removed from card header to reduce repetition per FB-0011.

**Not shipped:**
- **5.6** (false positive reduction) — attribution framework already shipped; remaining work (negative examples, eval measurement) depends on 1.1 prompt tuning.
- **5.8** (dev feedback capture) — deferred; the eval harness serves the same purpose for prompt tuning without needing a separate feedback capture system.

**Design decisions:**
- Re-run button in results header (next to summary) rather than in the controls bar. This keeps the controls bar clean and puts re-run in context with results.
- Text size preference uses CSS custom property overrides via `data-text-size` attribute on body, rather than inline styles. Clean, maintainable, works with all existing CSS.
- Main content filtering uses a two-tier approach: semantic containers first, then class/ID pattern matching as fallback. This avoids over-filtering on simple pages while correctly scoping on news sites.
- Progressive disclosure: each instance has a "Why?" toggle that reveals the explanation. This avoids overloading the quote click (which scrolls to the page highlight) and is discoverable. Definition kept in card header — it's one line per tactic and helps users understand what the tactic means.

**Technical decisions:**
- Defensive clear in background.js before collect text eliminates the race condition without requiring complex synchronization. The clear is a no-op when no highlights exist.
- `isSecondaryElement()` checks both CSS selectors and regex patterns on class/ID strings. The regex handles `className` being a string or SVGAnimatedString (for SVG elements).
- Text size stored in `chrome.storage.local` alongside other preferences. Loaded on sidepanel init.

**SAFETY:** Defensive clear in background.js adds a `CLEAR_HIGHLIGHTS` message before `COLLECT_TEXT`. The clear handler in content.js is idempotent (no-op when no highlights exist). Error handling preserved — the clear is wrapped in try/catch since the content script may not be injected yet.

**Tradeoffs:**
- Double-click for explanation reveal is less discoverable than a visible toggle, but single-click is already used for scroll-to-highlight. The card is still informative without explanations (tactic name + quotes tell the story).
- Main content filtering may miss content in non-standard layouts that don't use semantic HTML. The fallback to body with exclusions handles this gracefully.
- The "and N more" threshold of 2 visible instances is a judgment call. Could be 3, but 2 keeps cards compact while still showing the pattern.

**Files changed:** `sidepanel.js`, `sidepanel.css`, `sidepanel.html`, `content.js`, `background.js`, `options.html`, `options.js`

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
