# Manipulation Identifier

**A Chrome extension that identifies and highlights manipulative language in web content using AI.**

## Problem Statement

The internet is saturated with content designed to manipulate readers through psychological tactics -- fear-mongering, false dichotomies, ad hominem attacks, and other techniques that bypass rational thinking. Most people lack the training to recognize these patterns, making them vulnerable to manipulation.

## Vision

Empower users to recognize manipulation in real-time as they browse the web. By highlighting manipulative language and explaining the specific tactics being used, the tool helps users develop critical thinking skills and make more informed decisions about the content they consume.

## Core Features

- **Full-page analysis** -- Analyzes visible text content on any webpage (up to 5000 characters)
- **AI-powered detection** -- Uses Google Gemini (Flash 2.5 / Flash Lite 2.5) for manipulation detection
- **Multi-tactic recognition** -- Identifies multiple overlapping tactics in single passages
- **Educational explanations** -- Explains why content is manipulative, not just that it is
- **Side panel UI** -- Chrome Side Panel with dark, DevTools-inspired aesthetic
- **Inline highlighting** -- Highlights manipulative text directly on the page with click-to-navigate
- **BYOK architecture** -- Users provide their own Gemini API key (no server required)
- **Optional server proxy** -- Express backend for centralized analytics, caching, and feedback collection

## Supported Manipulation Tactics

The tool detects 15 manipulation tactics across three categories:

**Logical Fallacies (8):**
1. **False Dichotomy** -- Artificially limiting choices to two options
2. **Slippery Slope** -- Claiming small steps lead to disaster
3. **Hasty Generalization** -- Drawing broad conclusions from limited examples
4. **Cherry Picking** -- Selective use of evidence
5. **Appeal to Authority** -- Citing authority to settle arguments regardless of relevance
6. **Appeal to Majority** -- Arguing popularity equals truth
7. **Appeal to Nature** -- Arguing natural means good
8. **Appeal to Tradition** -- Arguing longevity means right

**Rhetorical Manipulation (5):**
9. **Emotional Language** -- Fear-mongering, outrage-inducing language
10. **Ad Hominem** -- Attacking the person instead of the argument
11. **Scapegoating** -- Placing unwarranted blame on a group
12. **Polarization** -- Dividing into extreme opposing groups
13. **Red Herring** -- Diverting attention from the real issue

**Credibility Attacks (2):**
14. **Fake Experts** -- Individuals conveying false expertise
15. **Decontextualization** -- Removing context to change meaning

## Technology Stack

- **Platform**: Chrome Extension (Manifest V3)
- **UI**: Chrome Side Panel (sidepanel.js/html/css)
- **AI**: Google Gemini API (Flash 2.5, Flash Lite 2.5) via BYOK or server proxy
- **Backend**: Node.js + Express (optional, for analytics and feedback)
- **Storage**: Chrome Storage API (settings + session results), SQLite (feedback)
- **Matching**: 3-tier fuzzy text matching (exact, normalized, trigram similarity)

## Current Status

Core analysis pipeline functional. Cross-node highlighting, fuzzy matching, and side panel navigation working. Dark UI restyle complete. See `plan.md` for detailed roadmap of accuracy improvements, UX enhancements, and infrastructure work.
