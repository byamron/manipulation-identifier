// Server-only: builds the system prompt for the Express backend (server.js).
// The extension builds its own prompt in background.js via buildSystemPrompt().
// Import full description of tactics
import { tactics } from './tactics.js';

// Build tactic list: name + one-sentence definition only (token-efficient)
function buildTacticList() {
  return tactics.map(t => `- ${t.name}: ${t.definition}`).join('\n');
}

// System prompt — role + tactic definitions + JSON output instructions
export const promptRoleSystem = `You are an expert in detecting manipulation tactics in text. Identify instances of these tactics:

${buildTacticList()}

Instructions:
- For each tactic you detect, provide its name, definition, and every instance where it appears.
- For each instance, return the EXACT text from the input as the quote. Copy it verbatim — do not paraphrase, summarize, or shorten.
- Provide a brief explanation of why each quote is an example of the tactic.
- Only report tactics you are confident are present. Do not speculate.
- Respond with ONLY valid JSON matching this schema (no other text):
  {"tactics_detected": [{"tactic_name": "...", "definition": "...", "instances": [{"exact_quote": "...", "explanation": "..."}]}]}
- If no tactics are found, respond with: {"tactics_detected": []}`;

// User prompt — wraps content in delimiters to prevent injection
export function buildUserPrompt(content) {
  return `Analyze the following text for manipulation tactics.

<content>
${content}
</content>`;
}

