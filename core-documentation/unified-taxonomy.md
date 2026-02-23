# Unified Taxonomy (WORKING DRAFT — not finalized)

This is the proposed unified taxonomy merging our original 11 tactics with CoCoLoFa's 8 categories. It has not been implemented yet. Review and refine before integrating into `tactics.json` and the detection system.

---

## Mapping: Our Tactics × CoCoLoFa

| Our Current Tactic  | CoCoLoFa Equivalent      | Action                                                  |
|----------------------|--------------------------|---------------------------------------------------------|
| Slippery Slope       | Slippery Slope           | Merge (same concept, add CoCoLoFa examples)             |
| False Dichotomy      | False Dilemma            | Merge (same concept, add CoCoLoFa examples)             |
| Fake Experts         | Appeal to Authority      | Related but distinct — keep both                        |
| Red Herring          | Appeal to Worse Problems | Overlaps (worse problems is a subtype of red herring)   |
| Emotional Language   | —                        | Keep (unique to us)                                     |
| Cherry Picking       | —                        | Keep (unique to us)                                     |
| Scapegoating         | —                        | Keep (unique to us)                                     |
| Ad Hominem           | —                        | Keep (unique to us)                                     |
| Polarization         | —                        | Keep (unique to us)                                     |
| Impersonation        | —                        | **Removed** (hard to detect from text alone; more about identity than argument) |
| Decontextualization  | —                        | Keep (unique to us)                                     |
| —                    | Appeal to Majority       | Add new (bandwagon — "everyone believes it")            |
| —                    | Appeal to Nature         | Add new ("it's natural so it's good")                   |
| —                    | Appeal to Tradition      | Add new ("we've always done it this way")               |
| —                    | Hasty Generalization     | Add new ("one example proves the rule")                 |

---

## Proposed Unified Taxonomy: 15 Tactics

### Logical Fallacies (8)

1. **False Dichotomy / False Dilemma** — Presenting limited choices as the only options
2. **Slippery Slope** — Asserting a first step inevitably leads to disaster
3. **Hasty Generalization** *(new)* — Drawing broad conclusions from limited examples
4. **Cherry Picking** — Selectively presenting evidence while ignoring contradictions
5. **Appeal to Authority** *(new, distinct from Fake Experts)* — Citing an authority figure to settle an argument regardless of relevance
6. **Appeal to Majority** *(new)* — Arguing something is true because many people believe it
7. **Appeal to Nature** *(new)* — Arguing something is good because it's natural
8. **Appeal to Tradition** *(new)* — Arguing something is right because it's always been done that way

### Rhetorical Manipulation (5)

9. **Emotional Language** — Fear-mongering, outrage-inducing language to bypass rational thinking
10. **Ad Hominem** — Attacking the person instead of the argument
11. **Scapegoating** — Placing unwarranted blame on a person or group
12. **Polarization** — Dividing into extreme opposing groups
13. **Red Herring / Appeal to Worse Problems** — Diverting attention from the real issue

### Credibility Attacks (2)

14. **Fake Experts** — Individuals conveying false expertise to support unproven claims
15. **Decontextualization** — Removing context to change meaning

---

## Removed from Previous Taxonomy

- **Impersonation** — Hard to detect from text analysis alone; more about identity fraud than argumentative manipulation

---

## Status

- [ ] Finalize taxonomy (review groupings, naming, definitions)
- [ ] Write full definitions, examples, and "whatToDo" for new tactics (3–5 examples each)
- [ ] Merge CoCoLoFa examples into existing tactics (Slippery Slope, False Dichotomy, Red Herring)
- [ ] Update `tactics.json` with final 15-tactic structure
- [ ] Update detection prompts to use new taxonomy
- [ ] Benchmark against CoCoLoFa test set
