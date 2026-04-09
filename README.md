# Manipulation Identifier

A Chrome extension that detects manipulative language on any web page and highlights it in place. It uses AI to identify 15 psychological manipulation tactics — from fear-mongering to false dichotomies — and explains *why* each passage is manipulative so you can think critically about what you read.

## How It Works

1. **Open the side panel** — Click the extension icon or press `Cmd+Shift+M` (Mac) / `Ctrl+Shift+M` (Windows/Linux).
2. **Hit Analyze** — The side panel has a model selector and an Analyze button. Click it to scan the current page.
3. **See results inline** — Manipulative passages are highlighted directly on the page, color-coded by category:
   - **Blue** — Logical fallacies (False Dichotomy, Slippery Slope, Cherry Picking, etc.)
   - **Orange** — Rhetorical manipulation (Emotional Language, Polarization, Scapegoating, etc.)
   - **Red** — Credibility attacks (Fake Experts, Decontextualization)
4. **Read explanations** — Click any highlight to see which tactic was detected and why, or browse all results in the side panel.

## Detected Tactics

| Category | Tactics |
|----------|---------|
| Logical Fallacies | False Dichotomy, Slippery Slope, Hasty Generalization, Cherry Picking, Appeal to Authority, Appeal to Majority, Appeal to Nature, Appeal to Tradition |
| Rhetorical Manipulation | Emotional Language, Ad Hominem, Scapegoating, Polarization, Red Herring |
| Credibility Attacks | Fake Experts, Decontextualization |

## Installation

### Load as an unpacked extension

1. Clone this repo:
   ```
   git clone https://github.com/byamron/manipulation-identifier.git
   ```
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the repo folder

### Configure your API key

The extension calls Anthropic directly from the browser (BYOK mode). No backend server required.

1. Right-click the extension icon → **Options** (or go to `chrome://extensions` → Manipulation Identifier → Details → Extension options)
2. Enter your Anthropic API key (get one at [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys))
3. Choose a model — Sonnet 4.6 is the most accurate; Haiku 4.5 is faster and cheaper
4. Click **Save**, then **Test Key** to verify

### Optional: run the backend server

If you prefer to route requests through a local server instead of calling Anthropic directly:

```
npm install
cp .env.example .env   # add your ANTHROPIC_API_KEY
npm start              # starts on http://localhost:3000
```

Then enter `http://localhost:3000` as the Server URL in the extension's settings. The extension will use the server proxy instead of calling Anthropic directly. When both an API key and server URL are set, BYOK (API key) takes priority.

## Running Tests

```
npm test
```

Runs 57 tests across 5 suites covering highlight matching, response parsing, prompt construction, and taxonomy validation.

## Requirements

- Chrome 116+
- Node.js 18+ (only if using the backend server)
- An Anthropic API key

## Project Structure

```
├── manifest.json          Chrome extension manifest (V3)
├── background.js          Service worker — API calls, message routing
├── content.js             Content script — text collection, highlighting
├── sidepanel.html/js/css  Side panel UI — controls, results display
├── shared.js              Constants and utilities shared across contexts
├── highlight-matcher.js   Fuzzy text matching for inline highlights
├── options.html/js        Settings page — API key, model, server URL
├── server.js              Optional Express backend proxy
├── tactics.json           15 tactic definitions with examples
├── prompts.js             Server-only prompt templates
├── test/                  Jest test suites
└── core-docs/             Project documentation (history, plan, spec)
```
