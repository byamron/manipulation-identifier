# CLAUDE.md -- Manipulation Identifier

## What This Is

A Chrome extension that detects and highlights manipulative language on web pages using AI. It helps users recognize psychological manipulation tactics in real-time — fear-mongering, false dichotomies, ad hominem attacks, and 12 other techniques — so they can think more critically about the content they consume.

**Core thesis:** Make manipulation visible so people can decide for themselves.

## Tech Stack

- **Platform:** Chrome Extension (Manifest V3)
- **Language/UI:** JavaScript, Chrome Side Panel (sidepanel.js/html/css)
- **Backend:** Node.js + Express (server.js)
- **Key APIs:** Google Gemini API (Flash 2.5, Flash Lite 2.5), supports BYOK (bring your own key) and server proxy modes
- **Persistence:** Chrome Storage API (settings + session results)

## Product Principles

- **Educate, don't censor** — highlight and explain tactics, never block or hide content
- **Minimal surface area** — side panel + inline highlights, nothing more
- **Accuracy over coverage** — only flag tactics with high confidence; false positives erode trust
- **Privacy by default** — text stays between the user and the API; no telemetry, no data collection

## Core Documents

All project documentation lives in `core-docs/`. Review and update these as part of your workflow.

| Document | Path | Purpose |
|----------|------|---------|
| Plan | `core-docs/plan.md` | Living roadmap -- current focus, active work, completed features |
| History | `core-docs/history.md` | Decision log -- what was done, why, tradeoffs, branch+SHA |
| Feedback | `core-docs/feedback.md` | Synthesized user feedback distilled into rules |
| Spec | `core-docs/spec.md` | Product specification and feature definitions |
| Taxonomy | `core-docs/unified-taxonomy.md` | 15-tactic taxonomy with definitions and mappings |
| Benchmarks | `core-docs/benchmarks.md` | Model performance comparisons |
| Sources | `core-docs/SOURCES.md` | Academic attribution and licensing |

## Agent Workflow

Agents are defined in `.claude/agents/` and invoked via `claude --agent <name>` or by name in conversation.

| Agent | Role | When to use |
|-------|------|-------------|
| `planner` | Scope features, write UX goals, update plan.md | Starting or refining features |
| `domain` | Business logic, services, API integration | Behavior or data structure changes |
| `ui` | Side panel, content script, styling | Any UI/frontend work |
| `testing` | Unit tests, integration tests | After domain or UI changes |
| `docs` | History, doc updates, commits | Shipping completed work |

## How to Work

1. **Read before writing.** Check `core-docs/plan.md` for current focus and `core-docs/feedback.md` for past corrections.
2. **Follow the rules.** Scoped rules in `.claude/rules/` load automatically and enforce documentation discipline, scope control, and safety checks.
3. **Use agents.** See agent table above. Use `/clear` between agent phases.

## Quality Bar

Code doesn't ship unless it meets these standards simultaneously:

- **Functional:** Does what it's supposed to. Edge cases handled.
- **Accurate:** Detection matches benchmarks. No regressions in tactic identification.
- **Performant:** Analysis completes within 30s timeout. Side panel renders instantly.
- **Clean:** Follows project conventions. No dead code.
- **Tested:** 57 tests pass. New features include tests.
