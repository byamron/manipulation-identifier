---
name: review
description: >
  Three-perspective review (engineer, UX, design eng) with doc alignment.
  Saves checkpoint for /ship. Run before shipping or after fixes.
context: fork
allowed-tools: Read, Grep, Glob, Bash
---

## 1. Scope

```bash
git diff main..HEAD --name-only
git log --oneline main..HEAD
```

If `.context/review-report.json` exists and `last_reviewed_sha` matches HEAD, only re-review files changed since. Otherwise review all.

## 2. Tests

Run `npm test 2>&1`. Record failures. Note untested changed logic.

## 3. Three independent reviews

Read every changed file and its diff. Keep perspectives separate — do not blend yet.

**Engineer** — correctness, reliability, maintainability:
bugs (off-by-one, null/undefined, race conditions, missing await), broken refs (missing functions, wrong imports), edge cases (empty arrays, missing fields, unhandled API errors), security (unsanitized input, exposed secrets, injection), error handling patterns, API patterns, Chrome Storage patterns, test gaps

**UX Designer** — experience, interaction, hierarchy:
clarity of UI/copy, visual consistency, information hierarchy (primary content prominent, secondary actions clearly secondary), loading/empty/error states, accessibility (contrast, target size, focus order), flow and dead ends

**Design Engineer** — design-to-code fidelity:
DOM/CSS pattern consistency with sidepanel.html/css, naming conventions, motion/transitions (match existing timing/easing), responsive behavior, shortcuts that degrade UX

Use Grep and Glob to find similar existing code and compare patterns.

## 4. Doc alignment

Check changed code against each — flag deviations:
- `spec.md` — implementation matches spec?
- `plan.md` — completed items marked done?
- `history.md` — entries exist with what/why/tradeoffs?
- `feedback.md` — any rule violations?
- `unified-taxonomy.md` — detection logic aligned? (if applicable)

## 5. Consolidate

Bring perspectives together:
1. Overlaps across perspectives → higher priority
2. Tensions → weigh tradeoff, pick best user outcome
3. Deduplicate same issue flagged from different angles
4. Rank by impact

## 6. Report

One list. Tag each: `[Eng]` `[UX]` `[Design]` `[All]` `[Docs]`.

**Blockers** (must fix): bugs, test failures, security, spec violations, missing history.md, UX issues that confuse/block users.

**Warnings** (should fix): test gaps, pattern inconsistencies, plan.md stale, feedback near-misses, polish, accessibility.

```
## Review Results

### Blockers
- [file:line] [Tag] — explanation

### Warnings
- [file:line] [Tag] — explanation

### Clean
- [checks that passed]
```

If blockers: propose fix plan, wait for user approval, then tell user to re-run `/review`.

## 7. Checkpoint

Write `.context/review-report.json`:

```json
{"timestamp":"<ISO>","last_reviewed_sha":"<HEAD>","files_reviewed":[],"blockers":[],"warnings":[],"tests_passed":true,"clean":true}
```
