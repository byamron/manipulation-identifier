import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const tactics = JSON.parse(
  readFileSync(join(__dirname, 'tactics.json'), 'utf-8')
);

export default tactics;
