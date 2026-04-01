---
paths:
  - "**/server.*"
  - "**/database.*"
  - "**/background.*"
  - "**/manifest.json"
---

# Safety-Critical Code Rules

This file loads automatically when you touch the server, database, background script, or manifest. These are the files where mistakes can leak API keys, corrupt stored data, or break the extension silently.

## Before modifying safety-critical code

1. Run `git log --oneline -5 -- <file>` to check for recent deliberate safety decisions.
2. If a recent commit mentions "crash", "data loss", "safety", "integrity", or "fallback" -- read that commit's diff to understand what was deliberately added.
3. Preserve safety behavior through rewrites. If restructuring a function, verify all safety-critical paths from the previous version still exist.

## When committing safety changes

- Flag the change in the commit message with a `SAFETY` marker.
- Flag the change in `core-docs/history.md` with a `SAFETY` marker.
- Explain what safety behavior was preserved, modified, or added.

## Never silently downgrade error handling

- Don't replace explicit error handling with silent fallbacks (e.g., `throw` to silent catch, error alerts to console logs).
- Don't convert user-facing warnings to debug-only logging.
- Don't remove validation without documenting why it's no longer needed.
