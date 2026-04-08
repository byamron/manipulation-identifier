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
