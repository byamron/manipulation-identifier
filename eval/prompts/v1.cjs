'use strict';

const fs = require('fs');
const path = require('path');

// Read tactics from the canonical JSON file (avoids ESM import of tactics.js)
const tacticsPath = path.join(__dirname, '..', '..', 'tactics.json');
const tactics = JSON.parse(fs.readFileSync(tacticsPath, 'utf-8'));

// Mirrors buildSystemPrompt() in background.js exactly
function buildSystemPrompt() {
  const tacticList = tactics.map(t => `- ${t.name}: ${t.definition}`).join('\n');
  return `You are an expert in detecting manipulation tactics in text. Identify instances of these tactics:

${tacticList}

Instructions:
- For each tactic you detect, provide its name, definition, and every instance where it appears.
- For each instance, return the EXACT text from the input as the quote. Copy it verbatim — do not paraphrase, summarize, or shorten.
- Provide a brief explanation of why each quote is an example of the tactic.
- Only report tactics you are confident are present. Do not speculate.
- Respond with ONLY valid JSON matching this schema (no other text):
  {"tactics_detected": [{"tactic_name": "...", "definition": "...", "instances": [{"exact_quote": "...", "explanation": "..."}]}]}
- If no tactics are found, respond with: {"tactics_detected": []}`;
}

// Mirrors buildUserPrompt() in background.js exactly
function buildUserPrompt(content) {
  return `Analyze the following text for manipulation tactics.

<content>
${content}
</content>`;
}

module.exports = { buildSystemPrompt, buildUserPrompt };
