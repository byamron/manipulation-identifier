# Manipulation Detection Benchmarks

## Current Status

**Pending formal evaluation.** The eval harness (roadmap item 1.0) will replace this document with measured precision, recall, and F1 scores once implemented.

## Current Stack

- **Primary model:** Claude Sonnet 4.6 (recommended — higher accuracy)
- **Secondary model:** Claude Haiku 4.5 (faster, cheaper, lower accuracy)
- **Architecture:** BYOK (user provides Anthropic API key) or server proxy

## Historical Context

Early versions of this project used OpenAI GPT models (GPT-5-nano, GPT-4.1-nano). The project migrated to Anthropic Claude in April 2026. Historical GPT benchmark data is no longer relevant to the current implementation.

### Key findings from the GPT era (for reference only):

- GPT-5-nano significantly outperformed GPT-4.1-nano (~75% vs ~25% real-world detection)
- Format independence was strong (100% across formatting variations)
- Multi-tactic detection worked well (up to 5 tactics per passage)
- "Fake Experts" was the weakest tactic for detection

## Planned Metrics (via eval harness)

Once item 1.0 ships, this document will track:

- **Precision** per tactic and overall (target: >= 85%)
- **Recall** per tactic and overall (target: >= 65%)
- **F1** per tactic and overall
- **Quote fidelity** — is exact_quote a substring of the input? (target: >= 95%)
- **No tactic below 70% precision**

Results will be stored in `eval/results/` as timestamped JSON files.
