# Feedback Log

User feedback synthesized into actionable guidance. When the user gives feedback -- corrections, preferences, reactions, direction changes -- the relevant insight is captured here so it shapes all future work.

This is not a transcript. Each entry distills feedback into a rule or preference that applies going forward.

---

## How to Write an Entry

```
### FB-XXXX: [Short summary of the feedback]
**Date:** YYYY-MM-DD
**Source:** user correction | user preference | user direction | review feedback

**What was said:** Brief, factual summary of the feedback.

**Synthesized rule:** The actionable takeaway -- what to do differently going forward.

**Applies to:** [areas this affects: ux, code, architecture, workflow, etc.]
```

### Numbering
Increment from the last entry. Use `FB-0001`, `FB-0002`, etc.

### Source types
- **user correction** -- user fixed something you did wrong
- **user preference** -- user expressed a stylistic or process preference
- **user direction** -- user set strategic direction or priorities
- **review feedback** -- issues found during code/design review

---

## Entries

<!-- Add new entries below this line, newest first. -->

### FB-0012: Feedback form should capture useful dev data
**Date:** 2026-04-09
**Source:** user direction

**What was said:** The feedback form currently posts to the server endpoint, but it's unclear if data is going anywhere useful. During development, feedback should capture a snapshot of the page, the flagged items, the full analysis results, and the user's comment — enough to do deep review. Worth exploring whether there's a productive way to do this.

**Synthesized rule:** The dev-time feedback system should produce actionable records: page snapshot, full analysis context (all items, not just the one being reported), and user commentary. Don't just store a rating — store enough to replay the decision. This is dev-only infrastructure (see FB-0003) and should be designed for prompt tuning, not user-facing analytics.

**Applies to:** architecture, feedback, dev-tooling

### FB-0011: Results presentation is repetitive and overwhelming
**Date:** 2026-04-09
**Source:** user direction

**What was said:** Tactic cards are repetitive ("the word X is emotional language" repeated for every instance). Too much text. Should contextualize findings relative to each other, not as isolated items. Progressive disclosure should go further — hide explanations by default, let users expand for depth. The "Learn more" pattern is good but needs to be the default, not the exception.

**Synthesized rule:** Default to compact presentation: show the quote and tactic name, hide explanations behind expand. Contextualize findings as a cohesive analysis, not a flat list of independent detections. Avoid repetitive phrasing across instances of the same tactic. When multiple instances share the same tactic, group and summarize rather than repeating the pattern per-instance.

**Applies to:** ux, sidepanel, prompts

### FB-0010: Reduce false positives — contextualize within full article
**Date:** 2026-04-09
**Source:** user direction

**What was said:** Many detections are quotes (someone being quoted, not the article making the claim) or text that looks manipulative in isolation but isn't when read in context. The AI should consider the full article context when determining whether something is actually manipulation vs. reporting/quoting. Needs investigation and examples.

**Synthesized rule:** The prompt should instruct the model to distinguish between the article's own rhetoric and quoted speech being reported on. A quote from a politician using emotional language is not the same as the article using emotional language. Context-dependent judgment is more important than pattern matching. This is a prompt tuning task (item 1.1) and should be evaluated with the eval harness.

**Applies to:** prompts, accuracy, eval

### FB-0009: Filter main content from secondary content (sidebars, trending, related)
**Date:** 2026-04-09
**Source:** user direction

**What was said:** News sites show related/trending article headlines in sidebars, top bars, and inline widgets. The analyzer picks up text from these, flagging manipulation from headlines that aren't part of the article being read. This is distracting and inaccurate.

**Synthesized rule:** `collectText()` should prioritize main article content over page chrome. Use `<article>`, `<main>`, or `role="main"` as primary content boundaries. If those exist, prefer text within them. Fall back to full-page collection only when no main content container is detected. Exclude common secondary containers: `aside`, `nav`, `[role="complementary"]`, elements with classes/IDs containing "sidebar", "related", "trending", "popular", "recommended".

**Applies to:** content.js, text collection, accuracy

### FB-0008: Highlighting is unreliable on re-run
**Date:** 2026-04-09
**Source:** review feedback

**What was said:** Highlights are hit or miss whether they show up, especially when analysis is re-run on a page (after clearing and re-analyzing).

**Synthesized rule:** Investigate and fix highlighting reliability on re-analysis. Possible causes: stale DOM references after clear, race conditions in highlight injection, residual `.mi-highlight` spans interfering with text collection on re-run. The clear operation must fully restore the DOM before re-analysis begins.

**Applies to:** content.js, highlighting, reliability

### FB-0007: Text is too small and low contrast — add text size setting
**Date:** 2026-04-09
**Source:** user direction

**What was said:** Text is still too small or too low contrast in several places. Most of the UI could use a slight size increase. Suggested a text size slider in settings, as long as it follows accessibility best practices and respects system text settings.

**Synthesized rule:** Do a full accessibility pass on font sizes and contrast. Base font should be at least 13px, not 12px. Nothing should be below 11px. Add a text size preference in settings (small/medium/large or a slider) that adjusts the CSS custom property scale. Respect system-level text size preferences where possible. Ensure all text meets WCAG AA contrast ratios (4.5:1 for normal text, 3:1 for large text).

**Applies to:** ux, sidepanel.css, options, accessibility

### FB-0006: Add re-run button (no clear-then-analyze cycle)
**Date:** 2026-04-09
**Source:** user direction

**What was said:** When switching pages or models, the current analysis stays but there's no way to re-run without clearing first. Need a "run again" button (circular arrow icon) next to the clear button when analysis has been run.

**Synthesized rule:** After analysis completes, show both a Clear button and a Re-run button (circular arrow icon). Re-run should clear results and immediately start a new analysis with the current model selection, in one action. This is especially important when the user changes the model dropdown — they shouldn't have to clear, then re-analyze.

**Applies to:** ux, sidepanel

### FB-0005: Empty state should not assume page type
**Date:** 2026-04-09
**Source:** user correction

**What was said:** The empty state says "try a news article or opinion piece" but the user was already on a BBC News article. The extension shouldn't assume what type of page the user is on — it doesn't know and will be wrong.

**Synthesized rule:** Never reference specific page types in empty/status messages unless the extension has actually detected what kind of page the user is on. Use neutral language like "this content" or "this page." Don't suggest trying a different type of page — it implies the current page isn't valid and the extension knows what it is.

**Applies to:** ux, sidepanel, copy

### FB-0004: Always use full GitHub PR URLs
**Date:** 2026-04-07
**Source:** user preference

**What was said:** Send full GitHub URLs for PRs (e.g. `https://github.com/...`), not shorthand like `owner/repo#123`.

**Synthesized rule:** When creating, merging, or referencing a PR, always use the full URL so it's directly clickable.

**Applies to:** workflow, communication

### FB-0003: No feedback collection in shipped extension
**Date:** 2026-04-07
**Source:** user direction

**What was said:** Feedback collection is only needed during development for prompt tuning. The shipped extension should not collect any user data. Once the prompt is accurate, the feedback UI, server analytics, and database should be stripped. This aligns with the "privacy by default" principle.

**Synthesized rule:** The feedback system (database.js, feedback UI, analytics endpoints) is dev-only infrastructure. It must be removed before release. Design all measurement/tuning tools as development-time scripts (in eval/), not user-facing features.

**Applies to:** architecture, product, privacy

### FB-0002: Keep onboarding minimal — product should be self-explanatory
**Date:** 2026-04-07
**Source:** user preference

**What was said:** Onboarding should be very short if there is one at all. The product should be pretty self-explanatory.

**Synthesized rule:** Don't add onboarding flows, wizards, or multi-step intros. The side panel UI (Analyze button + results) should be self-explanatory. The setup state can have a one-sentence description and a link to settings — nothing more.

**Applies to:** ux, sidepanel

### FB-0001: Be cost-conscious — users pay with their own API keys
**Date:** 2026-04-07
**Source:** user direction

**What was said:** It's BYOK, so don't make it too expensive. Asked specifically whether streaming would increase token costs.

**Synthesized rule:** Every feature that touches the API should be evaluated for token/cost impact on the user. Don't add extra API calls, verbose prompts, or redundant requests without justification. When proposing API-touching changes, state the cost impact explicitly. (Note: streaming has zero cost impact — same tokens and pricing as non-streaming.)

**Applies to:** architecture, api, prompts
