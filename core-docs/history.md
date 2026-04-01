# Feature History

Detailed documentation of shipped features, organized by development phase.

---

## Phase 6: API Provider Migration (April 2026)

### Apr 1, 2026 — Complete server-side Anthropic migration

**Branch:** fix-anthropic-analysis

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
