// Import full description of tactics
import { tactics } from './tactics.js';

// Helper function to format the tactic data
const formatTactic = (tactic) => {
  return `[${tactic.name}]. Definition: ${tactic.definition}. ${tactic.alsoKnownAs ? `Also known as: ${tactic.alsoKnownAs}.` : ''} Examples: ${tactic.examples.join('; ')}. Why: ${tactic.why} What to do: ${tactic.whatToDo}`;
};

// Define and export the system prompt
export const promptRoleSystem = `You are a helpful assistant designed to detect possible manipulation tactics in text. The tactics you are aiming to detect are described here in the following format: ${tactics.map(formatTactic).join(' ')}`;

// Define and export the user prompt
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

// Helper function to format the response for tooltips
export const formatTooltipContent = (tacticName, definition, explanation) => {
  return `
    <h4>Tactic: ${tacticName}</h4>
    <div class="definition">Definition: ${definition}</div>
    <div class="explanation">Why this is an example: ${explanation}</div>
  `;
};