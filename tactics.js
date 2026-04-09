// Server-only: loads tactics.json for the Express backend (prompts.js).
// The extension loads tactics.json directly at runtime via chrome.runtime.getURL().
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const tactics = JSON.parse(
  readFileSync(join(__dirname, 'tactics.json'), 'utf-8')
);

export default tactics;
