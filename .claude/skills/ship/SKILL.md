---
name: ship
description: >
  Ship reviewed changes. Updates core docs, commits, pushes, and opens a PR.
  Reads the /review checkpoint to skip redundant checks. Does NOT auto-merge --
  the PR is opened for the user to merge. Triggered by /ship or "ship it".
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

You are running the ship workflow. Follow every step in order.

## 1. Check review status

- Run `git status` and `git diff` (staged + unstaged)
- Run `git log --oneline main..HEAD` to see commits on this branch
- If on `main`, create a new branch with a descriptive kebab-case name

Check for `.context/review-report.json`:

- **If it exists and `last_reviewed_sha` matches current HEAD:** Review is current. Read the report. If `clean` is true, proceed to step 2. If blockers remain, show them and stop — tell the user to fix and re-run `/review`.
- **If it exists but SHA doesn't match:** Files changed since review. Run a minimal gate (step 1b).
- **If it doesn't exist:** No review was run. Run a minimal gate (step 1b).

### 1b. Minimal gate (only when no current review)

This is NOT a full review — just enough to catch obvious problems:

- Run `npx jest --verbose 2>&1` — if tests fail, stop and show failures
- Check that `core-docs/history.md` has an entry for the current changes — warn if missing

If the minimal gate passes, proceed with a note: "Shipping without full /review — consider running /review for thorough checks."

## 2. Update core docs

Read `core-docs/history.md` and `core-docs/plan.md`.

For each meaningful change on this branch:
- Add an entry to `core-docs/history.md` following the existing format (what, why, decisions, tradeoffs). Use today's date. Skip if an entry already exists.
- Update `core-docs/plan.md` — mark completed items, update "Current focus" if needed.

If the user gave feedback during this session that isn't already captured:
- Add a synthesized entry to `core-docs/feedback.md`

## 3. Stage and commit

- Stage all relevant files (code + doc updates). Never stage `.env`, secrets, or credentials.
- Write a concise commit message explaining **why** the change was made.

## 4. Push and open PR

- Push with `-u` flag
- Create a PR using `gh pr create` with:
  - Short title (under 70 characters)
  - Body with `## Summary` (1-3 bullets) and `## Test plan` (checklist)
- **Do NOT merge the PR.** Return the PR URL and stop.

## 5. Handle conflicts (if any)

If the push fails due to conflicts:

1. **Surface the conflict clearly.** Show which files conflict and a brief explanation of why.
2. **Present options:**
   - **Rebase onto target branch** — best when your branch has a small number of clean commits
   - **Merge target into your branch** — best when you want to preserve exact branch history
   - **Abort and let the user resolve manually** — safest when conflicts touch critical code
3. **Recommend the best option** based on the situation.
4. **Wait for user approval** before resolving. Never force-push or auto-resolve without confirmation.
5. After resolution, re-push and verify the PR is clean before proceeding.
