import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tactics = JSON.parse(
  readFileSync(join(__dirname, '..', 'tactics.json'), 'utf-8')
);

const REQUIRED_FIELDS = ['name', 'definition', 'alsoKnownAs', 'examples', 'why', 'whatToDo'];

describe('tactics.json structure', () => {
  test('should have exactly 15 tactics', () => {
    expect(tactics).toHaveLength(15);
  });

  test('should not include Impersonation', () => {
    const names = tactics.map(t => t.name);
    expect(names).not.toContain('Impersonation');
  });

  test('should include all expected tactics', () => {
    const names = tactics.map(t => t.name);
    const expected = [
      'Emotional Language', 'False Dichotomy', 'Cherry Picking',
      'Fake Experts', 'Appeal to Authority', 'Red Herring',
      'Scapegoating', 'Ad Hominem', 'Polarization',
      'Slippery Slope', 'Decontextualization',
      'Hasty Generalization', 'Appeal to Majority',
      'Appeal to Nature', 'Appeal to Tradition'
    ];
    for (const name of expected) {
      expect(names).toContain(name);
    }
  });

  test('every tactic should have all required fields', () => {
    for (const tactic of tactics) {
      for (const field of REQUIRED_FIELDS) {
        expect(tactic).toHaveProperty(field);
      }
    }
  });

  test('every tactic should have a non-empty name', () => {
    for (const tactic of tactics) {
      expect(typeof tactic.name).toBe('string');
      expect(tactic.name.length).toBeGreaterThan(0);
    }
  });

  test('every tactic should have a non-empty definition', () => {
    for (const tactic of tactics) {
      expect(typeof tactic.definition).toBe('string');
      expect(tactic.definition.length).toBeGreaterThan(10);
    }
  });

  test('no definition should start with "Definition:"', () => {
    for (const tactic of tactics) {
      expect(tactic.definition).not.toMatch(/^Definition:/i);
    }
  });

  test('every tactic should have at least 2 examples', () => {
    for (const tactic of tactics) {
      expect(Array.isArray(tactic.examples)).toBe(true);
      expect(tactic.examples.length).toBeGreaterThanOrEqual(2);
    }
  });

  test('every example should be its own string (not concatenated)', () => {
    for (const tactic of tactics) {
      for (const example of tactic.examples) {
        expect(typeof example).toBe('string');
        expect(example.length).toBeLessThan(500);
      }
    }
  });

  test('every tactic should have at least one "why" entry', () => {
    for (const tactic of tactics) {
      expect(Array.isArray(tactic.why)).toBe(true);
      expect(tactic.why.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('every tactic should have at least one "whatToDo" entry', () => {
    for (const tactic of tactics) {
      expect(Array.isArray(tactic.whatToDo)).toBe(true);
      expect(tactic.whatToDo.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('alsoKnownAs should be an array', () => {
    for (const tactic of tactics) {
      expect(Array.isArray(tactic.alsoKnownAs)).toBe(true);
    }
  });

  test('tactic names should be unique', () => {
    const names = tactics.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('Red Herring should include "Appeal to worse problems" as alias', () => {
    const redHerring = tactics.find(t => t.name === 'Red Herring');
    expect(redHerring.alsoKnownAs.some(
      alias => alias.toLowerCase().includes('worse problems')
    )).toBe(true);
  });
});
