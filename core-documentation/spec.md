# Manipulation Identifier

**A Chrome extension that identifies and highlights manipulative language in web content using AI.**

## Problem Statement

The internet is saturated with content designed to manipulate readers through psychological tactics—fear-mongering, false dichotomies, ad hominem attacks, and other techniques that bypass rational thinking. Most people lack the training to recognize these patterns, making them vulnerable to manipulation.

## Vision

Empower users to recognize manipulation in real-time as they browse the web. By highlighting manipulative language and explaining the specific tactics being used, the tool helps users develop critical thinking skills and make more informed decisions about the content they consume.

## Core Features

- **Real-time text analysis** — Analyzes selected text on any webpage
- **AI-powered detection** — Uses GPT-5-nano for sophisticated manipulation detection
- **Multi-tactic recognition** — Identifies multiple overlapping tactics in single passages
- **Educational explanations** — Explains why content is manipulative, not just that it is
- **Non-intrusive UI** — Floating widget appears only when needed
- **Click-to-analyze** — User-initiated analysis via text selection

## Supported Manipulation Tactics

The tool detects 11 manipulation tactics:

1. **Emotional Language** — Fear-mongering, outrage-inducing language
2. **False Dichotomy** — Artificially limiting choices to two options
3. **Cherry Picking** — Selective use of evidence
4. **Fake Experts** — False appeals to authority
5. **Red Herring** — Diverting attention from the real issue
6. **Scapegoating** — Placing unwarranted blame on a group
7. **Ad Hominem** — Attacking the person instead of the argument
8. **Polarization** — Dividing into extreme opposing groups
9. **Impersonation** — Deceiving by assuming another's identity
10. **Slippery Slope** — Claiming small steps lead to disaster
11. **Decontextualization** — Removing context to change meaning

## Technology Stack

- **Frontend**: Chrome Extension (Manifest V3)
- **Backend**: Node.js + Express server
- **AI**: OpenAI API (GPT-5-nano)
- **Storage**: Chrome Storage API, SQLite for feedback

## Current Status

Production-ready with 75-100% detection accuracy across test categories. GPT-5-nano provides strong conceptual understanding of manipulation tactics beyond pattern matching.
