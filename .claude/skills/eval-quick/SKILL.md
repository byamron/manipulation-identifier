---
name: eval-quick
description: >
  Run the next batch of v1-vs-v2 prompt eval. Each run tests 10 new corpus files,
  accumulating results daily until all 119 are covered. Tracks progress across sessions.
allowed-tools: Read, Bash, Grep, Glob
---

Run the progressive eval comparison. Each invocation tests the next 10 untested corpus files
against both v1 (baseline) and v2 (tuned) prompts, then shows cumulative results.

## Steps

1. **Check current progress**:
   ```
   cat eval/progress.json 2>/dev/null || echo "No progress yet — first run"
   ```
   Report how many files have been completed out of 119.

2. **Run the next batch**:
   ```
   cd /Users/benyamron/conductor/workspaces/manipulation-identifier/cancun
   npm run eval:quick
   ```
   This automatically:
   - Picks the next 10 untested files from the corpus
   - Runs v1 (baseline) on those 10 files
   - Runs v2 (tuned) on those same 10 files
   - Merges results into cumulative files (`eval/results/v1-cumulative.json`, `eval/results/v2-cumulative.json`)
   - Updates `eval/progress.json` to track which files are done
   - Compares cumulative v1 vs v2 results

   If you hit a 429 quota error, tell the user the daily quota is exhausted and to try again tomorrow.
   If it says "All 119 corpus files have been evaluated!", skip to step 3.

3. **Read and report the cumulative results**:

   ```
   ## Eval Progress: N / 119 files

   | Metric          | v1 (baseline) | v2 (tuned) | Delta |
   |-----------------|---------------|------------|-------|
   | Precision       | X%            | Y%         | +Z%   |
   | Recall          | X%            | Y%         | +Z%   |
   | F1              | X%            | Y%         | +Z%   |
   | Quote Fidelity  | X%            | Y%         | +Z%   |
   | False Positives | N             | N          | -N    |

   ### Today's batch
   - Files tested: [list the 10 new files]
   - Errors: N

   ### Cumulative trend
   - [Is precision improving as more files are added?]
   - [Any tactic categories where v2 is notably better/worse?]
   ```

4. **Recommend next steps** based on cumulative results:
   - If v2 is winning: "Looking good — N more days to complete the full eval"
   - If a specific tactic is regressing: suggest targeted prompt adjustments
   - If all 119 done: "Full eval complete — here are the final numbers"

## Commands

- `npm run eval:quick` — run next batch (default: Flash Lite)
- `npm run eval:quick -- gemini-2.5-flash` — use Flash 2.5 instead
- `npm run eval:quick -- reset` — reset progress and start over
- `npm run eval:compare -- eval/results/v1-cumulative.json eval/results/v2-cumulative.json` — re-compare without using quota

## How it works

- Progress tracked in `eval/progress.json` (gitignored)
- Each run: 10 files x 2 prompts = 20 API calls = one day's free tier quota
- Results accumulate in `eval/results/v1-cumulative.json` and `v2-cumulative.json`
- Metrics are recalculated from all accumulated data after each batch
- ~12 days to cover all 119 files at 10/day
