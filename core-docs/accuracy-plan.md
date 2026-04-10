# Accuracy Improvement Plan

**Goal:** Precision ≥ 85%, Recall ≥ 65%, Quote Fidelity ≥ 95%
**Current (v2, Flash Lite):** Precision 35%, Recall 76.5%, QF 96.1%
**Gap:** Precision needs to more than double. Recall already meets target.

---

## Diagnosis: Where the 278 False Positives Come From

### 1. Under-annotated corpus (estimated 80-120 FPs are actually correct)

The benchmark files average only 2.3 annotations each, but the model finds ~5 things per file. Many "FPs" are correct detections the corpus simply doesn't annotate.

**Example:** benchmark-08 describes a retired plumber giving spinal health advice on YouTube. Corpus only annotates "Fake Experts." The model also flags "Appeal to Authority" and "Hasty Generalization" — both arguably correct, but scored as FPs because the corpus is silent on them.

**Impact:** Fixing corpus annotations alone could move precision from 35% to ~50-55% without any prompt changes.

### 2. Emotional Language over-triggering (87 FPs, 31% of total)

The model flags any vivid or strong language as Emotional Language, even when it's:
- Emphasis without manipulation ("people!!!")
- Factual descriptions of emotional situations ("deeply angry about what happened")
- Rhetorical intensity that's proportionate to the topic
- Strong language that's part of a different tactic (e.g., Appeal to Nature text that uses emotional words)

### 3. Cross-tactic hallucination (73 FPs on single-tactic files)

When a file contains one clear tactic (e.g., "Slippery Slope"), the model correctly identifies it but ALSO flags 2-3 other tactics that aren't really there. It sees manipulation and over-generates related tactics.

### 4. Polarization over-triggering (41 FPs, 15% of total)

Any text that mentions groups or sides gets flagged as Polarization, even when it's balanced reporting or legitimate criticism.

### 5. False Dichotomy over-triggering (34 FPs, 12% of total)

The model flags conditional statements ("if X then Y") as False Dichotomy even when they're genuine logical connections, not artificial binary choices.

---

## Plan: Three Layers of Improvement

### Layer 1: Fix the Corpus (biggest bang for buck)

**Why first:** Every correct detection currently scored as FP artificially depresses precision. We're measuring the wrong thing.

**Actions:**

#### 1A. Audit benchmark files (34 files)
- For each benchmark file, read the text and the model's v2 predictions
- For each "FP," ask: is this actually a correct detection the corpus missed?
- Add missing annotations where the model is right
- Mark genuinely incorrect detections to confirm they're real FPs
- **Expected impact:** +60-80 TPs (precision jumps from 35% to ~50%)

#### 1B. Audit tactic-specific files (45 files)
- Same process: check if cross-tactic FPs are actually valid secondary tactics
- E.g., a Slippery Slope text that also genuinely uses Emotional Language
- Add multi-tactic annotations where warranted
- **Expected impact:** +20-30 TPs

#### 1C. Audit clean files (15 files)
- Currently only 7 FPs across 15 clean files (good!)
- Verify: are those 7 FPs genuinely wrong, or does the "clean" text actually contain subtle tactics?
- If clean text legitimately contains no tactics, these are true FPs to fix via prompt

#### 1D. Add annotation confidence to corpus
- Mark each annotation as "clear" or "borderline"
- Borderline annotations count as TP if detected but don't count as FN if missed
- This stops ambiguous cases from polluting both precision and recall

**Effort:** ~2-3 hours of manual review. Can be partially automated by having Claude review the model's predictions against the corpus text.

---

### Layer 2: Targeted Prompt Refinement

After corpus fixes establish a true baseline, target remaining real FPs.

#### 2A. Emotional Language precision (biggest single tactic problem)

Current: 20% precision (18 TP, 87 FP). The model flags almost everything as emotional.

**Specific prompt additions:**
- "Emotional Language requires CALCULATED emotional manipulation — language designed to bypass rational evaluation. It is NOT: genuine expression of emotion about a real situation, rhetorical emphasis proportionate to the topic, or vivid descriptive language in factual reporting."
- Add 2-3 negative examples specific to Emotional Language:
  - "I am deeply angry about the factory closure that cost 300 families their jobs" → NOT Emotional Language (genuine emotion about a real event)
  - "This HORRIFYING trend will DESTROY our children's future!!!" → IS Emotional Language (manufactured panic, all-caps escalation, vague threat)
- Consider instructing the model to flag Emotional Language ONLY when it scores "high" confidence

#### 2B. Cross-tactic over-generation

The model averages 3.9 detections per file. Much of this is seeing one real tactic and "hallucinating" related ones.

**Specific prompt additions:**
- "For each piece of text, identify the PRIMARY manipulation tactic at work. Do not flag secondary or tangential tactics unless they are independently clear. If text uses emotional words as part of a Slippery Slope argument, flag the Slippery Slope — do not also flag Emotional Language for the same passage."
- "Each instance should reflect a distinct, independent use of a tactic. Do not flag the same passage under multiple tactics unless each tactic is clearly operating independently."

#### 2C. Polarization precision

Current: 13% precision (9 TP, 41 FP). The model flags any mention of groups.

**Specific prompt additions:**
- "Polarization requires HOSTILE othering — characterizing an entire group with negative traits to create an us-vs-them divide. Mentioning that two groups disagree, or criticizing a specific group's actions with evidence, is NOT Polarization."
- Negative example: "Democrats and Republicans disagree on this policy" → NOT Polarization

#### 2D. Output volume constraint

Consider adding: "Aim for precision over completeness. A typical 500-word text contains 0-3 genuine manipulation tactics, rarely more. If you find yourself flagging 5+ instances, reconsider whether each one independently meets the threshold."

---

### Layer 3: Scoring & Methodology Improvements

#### 3A. Tactic-family matching

Current scorer requires exact tactic name match. But "Fake Experts" and "Appeal to Authority" are closely related — a prediction of one when the annotation says the other is partially correct, not completely wrong.

**Action:** Add a tactic similarity map. When a prediction matches the right passage but uses a related tactic name, score it as a "partial match" (0.5 TP) rather than 1 FP + 1 FN.

Suggested families:
- {Fake Experts, Appeal to Authority}
- {Scapegoating, Ad Hominem, Polarization}
- {Cherry Picking, Decontextualization}
- {Slippery Slope, False Dichotomy}
- {Emotional Language} (standalone — too commonly confused with everything)

#### 3B. Multi-instance deduplication

If the model returns 3 instances of Emotional Language but the corpus only annotates 1, the scorer counts 2 FPs even if all 3 quotes are from the same manipulative passage. Consider deduplicating predictions that overlap the same text span.

#### 3C. Benchmark-vs-tactic split reporting

Report metrics separately for:
- Tactic-specific files (45) — tests recall per tactic
- Benchmark files (34) — tests real-world detection
- Clean files (15) — tests false positive rate specifically
- Multi-tactic files (15) — tests discrimination

This prevents under-annotated benchmarks from dragging down tactic-specific precision.

---

### Layer 4: Model Comparison

After prompt and corpus improvements stabilize, compare:
- **Flash Lite 2.5** (current) — fast, cheap, but less capable
- **Flash 2.5** (thinking model) — should be more precise due to reasoning, costs ~$2 for full eval
- Consider whether the thinking model's extra precision justifies the latency tradeoff for production use

---

## Execution Order

| Phase | Action | Expected Precision Impact | Effort |
|-------|--------|--------------------------|--------|
| **1** | Audit & fix benchmark annotations (1A) | 35% → ~50% | 2-3 hrs |
| **2** | Audit tactic-specific annotations (1B) | ~50% → ~55% | 1-2 hrs |
| **3** | Emotional Language prompt fix (2A) | ~55% → ~62% | 30 min |
| **4** | Cross-tactic constraint (2B) | ~62% → ~68% | 30 min |
| **5** | Polarization prompt fix (2C) | ~68% → ~72% | 15 min |
| **6** | Output volume constraint (2D) | ~72% → ~75% | 15 min |
| **7** | Scorer improvements (3A, 3B) | ~75% → ~80% | 1 hr |
| **8** | Flash 2.5 comparison (4) | ~80% → ~85%? | ~$2 |

**Total estimated effort:** ~6-8 hours across multiple sessions
**Expected outcome:** Precision 75-85%, Recall 65-75%

---

## Measurement

After each phase, run the full eval:
```
npm run eval -- --prompt eval/prompts/v2.cjs --model gemini-2.5-flash-lite
```

Compare against the current v2 baseline:
```
npm run eval:compare -- eval/results/2026-04-10T05-04-10-998Z.json eval/results/<new-file>.json
```

The v2 baseline file (`2026-04-10T05-04-10-998Z.json`) is the reference point.
