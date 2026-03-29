// Test parseAnalysisResponse in isolation (extracted from server.js)
// We re-implement the function here to avoid importing the full server
// (which starts listening on a port and requires database/OpenAI setup).

function parseAnalysisResponse(manipulativeLanguage) {
  if (manipulativeLanguage.trim() === "No manipulation tactics detected.") {
    return [];
  }

  const tactics = [];
  const sections = manipulativeLanguage.split(/\[(.*?)\]/);

  for (let i = 1; i < sections.length; i += 2) {
    const tacticName = sections[i].trim();
    const content = sections[i + 1] || '';

    const definitionMatch = content.match(/Definition:\s*([^\n]+)/);
    const definition = definitionMatch ? definitionMatch[1].trim() : '';

    const examples = [];
    const exampleMatches = content.matchAll(/(\d+)\.\s*"([^"]+)"\s*Why this is an example:\s*([^\n]+)/g);

    for (const match of exampleMatches) {
      examples.push({
        text: match[2].trim(),
        explanation: match[3].trim()
      });
    }

    if (tacticName && definition && examples.length > 0) {
      tactics.push({
        tactic: tacticName,
        definition: definition,
        examples: examples
      });
    }
  }

  return tactics;
}

describe('parseAnalysisResponse', () => {
  test('should return empty array for no tactics detected', () => {
    expect(parseAnalysisResponse('No manipulation tactics detected.')).toEqual([]);
  });

  test('should return empty array for whitespace-padded no tactics response', () => {
    expect(parseAnalysisResponse('  No manipulation tactics detected.  ')).toEqual([]);
  });

  test('should parse a single tactic with one example', () => {
    const input = `[Emotional Language]
Definition: Language that contains strong emotional terms.

Examples:
1. "This will horrify you"
   Why this is an example: Uses fear to bypass rational thinking`;

    const result = parseAnalysisResponse(input);
    expect(result).toHaveLength(1);
    expect(result[0].tactic).toBe('Emotional Language');
    expect(result[0].definition).toBe('Language that contains strong emotional terms.');
    expect(result[0].examples).toHaveLength(1);
    expect(result[0].examples[0].text).toBe('This will horrify you');
    expect(result[0].examples[0].explanation).toBe('Uses fear to bypass rational thinking');
  });

  test('should parse multiple tactics', () => {
    const input = `[Ad Hominem]
Definition: Attacking a person instead of addressing the argument.

Examples:
1. "He failed math, so he can't lead foreign policy"
   Why this is an example: Attacks personal history rather than policy positions

[Emotional Language]
Definition: Language using strong emotional terms.

Examples:
1. "This DISGUSTING ruling will destroy everything"
   Why this is an example: Uses outrage-inducing language to provoke emotional response`;

    const result = parseAnalysisResponse(input);
    expect(result).toHaveLength(2);
    expect(result[0].tactic).toBe('Ad Hominem');
    expect(result[1].tactic).toBe('Emotional Language');
  });

  test('should parse multiple examples within a tactic', () => {
    const input = `[False Dichotomy]
Definition: Presenting limited choices as the only options.

Examples:
1. "You're either with us or against us"
   Why this is an example: Reduces complex position to two options
2. "Either you support this or you hate freedom"
   Why this is an example: Artificially narrows choices`;

    const result = parseAnalysisResponse(input);
    expect(result).toHaveLength(1);
    expect(result[0].examples).toHaveLength(2);
    expect(result[0].examples[1].text).toBe('Either you support this or you hate freedom');
  });

  test('should skip tactics without definition', () => {
    const input = `[Some Tactic]

Examples:
1. "Example text"
   Why this is an example: Explanation`;

    const result = parseAnalysisResponse(input);
    expect(result).toHaveLength(0);
  });

  test('should skip tactics without examples', () => {
    const input = `[Some Tactic]
Definition: A definition without examples.`;

    const result = parseAnalysisResponse(input);
    expect(result).toHaveLength(0);
  });

  test('should handle empty input', () => {
    expect(parseAnalysisResponse('')).toEqual([]);
  });
});
