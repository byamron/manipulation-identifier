# Feature History

Detailed documentation of shipped features, organized by development phase.

---

## Phase 9: Infrastructure & Debt Cleanup (April 2026)

### Apr 7, 2026 — Complete Priority 4: Infrastructure & Debt

**Branch:** strip-infra-debt (from 6ab7c26)

**What was done:**
Completed all 6 items in Priority 4 (Infrastructure & Debt):

1. **4.1 — Fix server.js error handler position:** Moved Express error handling middleware from before routes to after all route definitions, where Express requires it to function.
2. **4.2 — Hash cache keys:** Replaced raw 5KB+ string cache keys with SHA-256 hashes using `crypto.createHash()`.
3. **4.3 — Clean up dead files:** Added ownership comments to `prompts.js` (server-only), `tactics.js` (server-only), and `highlight-matcher.js` (test-only; canonical version is in content.js).
4. **4.4 — Update spec.md and benchmarks.md:** Removed GPT model references from benchmarks.md, replaced with current Claude stack and placeholder for eval harness results. Updated spec.md to remove feedback/analytics/SQLite references.
5. **4.5 — Strip dev-only feedback code:** SAFETY — Deleted `database.js`, removed `better-sqlite3` dependency, removed all feedback endpoints (`/submit-instance-feedback`, `/report-missing-manipulation`), removed all analytics endpoints (`/analytics/*`), removed feedback UI (rating buttons, textarea, submit handler) from sidepanel.js, removed feedback CSS from sidepanel.css, updated options.html server section wording, updated CLAUDE.md.
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

---

## Phase 8: Accuracy Measurement System (April 2026)

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
