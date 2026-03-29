// Import full description of tactics
import { tactics } from './tactics.js';

// Build tactic list: name + one-sentence definition only (token-efficient)
function buildTacticList() {
  return tactics.map(t => `- ${t.name}: ${t.definition}`).join('\n');
}

// JSON schema for OpenAI structured output
export const analysisJsonSchema = {
  name: 'manipulation_analysis',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      tactics_detected: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tactic_name: { type: 'string' },
            definition: { type: 'string' },
            instances: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  exact_quote: { type: 'string' },
                  explanation: { type: 'string' }
                },
                required: ['exact_quote', 'explanation'],
                additionalProperties: false
              }
            }
          },
          required: ['tactic_name', 'definition', 'instances'],
          additionalProperties: false
        }
      }
    },
    required: ['tactics_detected'],
    additionalProperties: false
  }
};

// System prompt — role + tactic definitions only (~400 tokens vs ~1500 before)
export const promptRoleSystem = `You are an expert in detecting manipulation tactics in text. Identify instances of these tactics:

${buildTacticList()}

Instructions:
- For each tactic you detect, provide its name, definition, and every instance where it appears.
- For each instance, return the EXACT text from the input as the quote. Copy it verbatim — do not paraphrase, summarize, or shorten.
- Provide a brief explanation of why each quote is an example of the tactic.
- Only report tactics you are confident are present. Do not speculate.`;

// User prompt — wraps content in delimiters to prevent injection
export function buildUserPrompt(content) {
  return `Analyze the following text for manipulation tactics.

<content>
${content}
</content>`;
}

// Legacy user prompt string (kept for backward compatibility with concat pattern)
export const promptRoleUser = `Analyze this text for manipulation tactics. For each tactic found, provide a response in the following format:

[TACTIC NAME]
Definition: [A clear, concise definition of this manipulation tactic]

Examples:
1. "[Example text from the content]"
   Why this is an example: [Specific explanation of why this text demonstrates the tactic]

[Next Tactic Name]
Definition: [Definition of next tactic]
...

If no manipulation tactics are found, respond with "No manipulation tactics detected."

Here is the text to analyze: `;
