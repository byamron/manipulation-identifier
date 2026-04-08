# Project Tracker

## Current Focus

Accuracy measurement and prompt tuning system. Build infrastructure to measure detection quality, iterate on prompts with data, and strip dev-only feedback code from the shipped extension.

## Handoff Notes

Sidebar UI restyle shipped (dark glass aesthetic, contrast fixes, layout fixes). Content script injection fallback added. Branch protection updated to allow merge without human review.

---

## Active Work Items

### Accuracy Measurement & Prompt Tuning System

**Goal:** Systematic, data-driven approach to prompt quality. Measure precision/recall across a labeled corpus, iterate on prompts with evidence, then strip all dev-only feedback infrastructure from the shipped extension.

**Key decision:** Feedback collection is development-only. The shipped extension collects no user data — once the prompt is accurate, the feedback UI and server analytics are removed. This aligns with the "privacy by default" product principle.

---

#### What accuracy means

The product principle is "accuracy over coverage — only flag with high confidence; false positives erode trust." **Precision is the primary metric.**

| Metric | Measures | Priority |
|--------|----------|----------|
| Precision (per tactic) | Of flagged instances, how many correct? | Highest |
| Recall (per tactic) | Of true instances, how many found? | Secondary |
| F1 (per tactic) | Harmonic mean | Summary |
| Quote fidelity | Does `exact_quote` appear verbatim in input? | High — non-verbatim breaks highlighting |
| Tactic confusion | Correct quote, wrong tactic label | Tracked — highlights taxonomy boundary issues |

**Targets:**
- Overall precision >= 85%
- Overall recall >= 65%
- No tactic with precision < 70%
- Quote fidelity >= 95%

---

#### Phase 1: Test Corpus

Build ~120 labeled examples in `eval/corpus/`, one JSON file per example.

| Source | Count | Purpose |
|--------|-------|---------|
| Tactic-specific (3 per tactic) | ~45 | Baseline: textbook cases recognized? |
| Existing benchmarks from benchmarks.md | ~34 | Regression coverage |
| Multi-tactic passages | ~15 | Realistic: overlapping tactics |
| Clean text (no manipulation) | ~15 | False positive control |
| Edge cases / ambiguous | ~10 | Boundary testing |

Format per file:
```json
{
  "id": "001-political-speech",
  "source": "Synthetic",
  "text": "...",
  "annotations": [
    { "tactic": "Emotional Language", "quote": "exact substring", "explanation": "..." }
  ],
  "negative_annotations": [
    { "quote": "looks manipulative but isn't", "note": "why" }
  ],
  "ambiguous": false
}
```

Ambiguous cases excluded from headline metrics, reported separately.

**Deliverables:**
- [ ] `eval/corpus/` directory + JSON schema + validation script
- [ ] Port existing benchmark cases
- [ ] Write tactic-specific, clean, multi-tactic, and edge cases
- [ ] Cross-validate all annotations (second review pass)

---

#### Phase 2: Evaluation Harness

Node.js script: `npm run eval` → calls Anthropic API against corpus → scores → outputs per-tactic table.

**Location:** `eval/harness.js`, `eval/scorer.js`, `eval/reporter.js`

**Matching logic:**
- True positive: tactic name matches AND quote has >= 50% character overlap with annotation
- False positive: flagged instance with no matching annotation
- False negative: annotation with no matching detection
- Quote fidelity: separate check — is `exact_quote` a substring of input text?

**Output:** Console table + `eval/results/<timestamp>.json`

**Deliverables:**
- [ ] Extract shared prompt/parse functions into importable module
- [ ] Write harness (corpus loading, rate-limited API calls, result collection)
- [ ] Write scorer (matching, precision/recall/F1, quote fidelity)
- [ ] Write reporter (console table, JSON output, FP/FN detail)
- [ ] `npm run eval` script in package.json
- [ ] Tests for scorer matching logic

---

#### Phase 3: Prompt Tuning Workflow

Prompt versions live in `eval/prompts/`. Default prompt is "current." Alternatives are experimental.

```bash
npm run eval                                    # run current prompt
npm run eval -- --prompt eval/prompts/v2.js     # run alternative
npm run eval:compare result-a.json result-b.json # side-by-side diff
```

**Tuning strategies (in order):**
1. Baseline measurement with current prompt
2. Few-shot examples (1-2 per tactic in system prompt)
3. Confidence threshold instruction ("only flag when > 80% confident")
4. Tactic disambiguation notes (commonly confused pairs)
5. Negative examples ("strong language ≠ Emotional Language")

**Deliverables:**
- [ ] `eval/prompts/` directory, copy current prompt as v1-baseline
- [ ] `--prompt` flag in harness
- [ ] `eval/compare.js` + `npm run eval:compare`
- [ ] Run baseline, iterate through strategies, record results

---

#### Phase 4: Strip Dev-Only Code

Remove feedback/analytics infrastructure from the shipped extension.

| Remove | Reason |
|--------|--------|
| `database.js` | Delete entirely — SQLite feedback storage, dev-only |
| `server.js` feedback endpoints | `/submit-instance-feedback`, `/report-missing-manipulation`, all `/analytics/*` |
| `server.js` db dependencies | `dbOperations`, `recordPerformance`, `calculateComplexityScore`, `generateSessionId` |
| `sidepanel.js` feedback UI | "Was this accurate?" button, rating buttons, submit handler, textarea |
| `sidepanel.css` feedback styles | `.card-feedback`, `.feedback-*` blocks |
| `better-sqlite3` dependency | Remove from package.json |
| `options.html` server hint | Update text — no longer mentions "feedback and analytics" |

| Keep | Reason |
|------|--------|
| `server.js` `/analyze-content-with-model` | Server proxy mode for non-BYOK users |
| `server.js` `/health` | Operational (strip db parts) |
| `eval/` directory | Dev tool, not packaged in extension |
| `background.js` BYOK path | Primary mode |
| `tactics.json` | Prompt building |

**Deliverables:**
- [ ] Remove feedback UI from sidepanel.js/css
- [ ] Remove feedback/analytics endpoints from server.js
- [ ] Delete database.js, remove better-sqlite3
- [ ] Verify tests pass, update any that reference removed code
- [ ] Verify extension works in both BYOK and server proxy modes

---

#### Phase 5: Documentation

- [ ] Update `benchmarks.md` with harness results (replaces informal data)
- [ ] Update `spec.md` to remove feedback collection references
- [ ] Update `CLAUDE.md` tech stack (remove SQLite/database.js)
- [ ] Record decisions in `history.md`

---

## Recently Completed

- **Apr 7, 2026**: Fix controls layout for narrow panel, improve text contrast
- **Apr 7, 2026**: Fix content script injection fallback, improve error messages
- **Apr 7, 2026**: Remove duplicate title, move settings gear into controls bar
- **Apr 7, 2026**: Restyle sidebar UI with DevPanel-inspired dark glass aesthetic
- **Apr 7, 2026**: Fix cross-node highlighting, fuzzy matching, side panel navigation

---

## Shipped Features

- **Apr 1, 2026**: Complete Anthropic migration — server.js + BYOK on Claude API
- **Apr 1, 2026**: Infrastructure migration — CLAUDE.md, agents, rules, core-docs
- **Mar 25, 2026**: Best-in-Class Overhaul — JSON output, BYOK, Side Panel, fuzzy highlighting, 56 tests
- **Mar 24, 2026**: Taxonomy expansion (11→15 tactics), XSS fixes, database.js, SOURCES.md
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
