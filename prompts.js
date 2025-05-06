// Import full description of tactics
import { tactics } from './tactics.js';

// Helper function to format the tactic data
const formatTactic = (tactic) => {
  return `[${tactic.name}]. Definition: ${tactic.definition}. ${tactic.alsoKnownAs ? `Also known as: ${tactic.alsoKnownAs}.` : ''} Examples: ${tactic.examples.join('; ')}. Why: ${tactic.why} What to do: ${tactic.whatToDo}`;
};

// Define and export the system prompt(s)
export const promptRoleSystem = `You are a helpful assistant designed to detect possible manipulation tactics in text. The tactics you are aiming to detect are described here in the following format: ${tactics.map(formatTactic).join(' ')}`;
export const promptRoleUser = 'Please identify any manipulation tactics (e.g., guilt-tripping, gaslighting) in the following text: [text goes here]';