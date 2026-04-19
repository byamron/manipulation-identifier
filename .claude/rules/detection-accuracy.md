---
paths: ["*.js", "server.js", "core-docs/unified-taxonomy.md"]
---

# Detection Accuracy Rule

When modifying detection logic or prompts, bias toward precision over recall. A missed tactic is acceptable; a false positive erodes user trust and is treated as a regression. Before shipping prompt changes, verify against existing benchmarks in `core-docs/benchmarks.md`.
