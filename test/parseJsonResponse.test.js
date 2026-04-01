// Test parseJsonResponse in isolation (re-implemented to avoid importing server)

function parseJsonResponse(rawContent) {
  try {
    const cleaned = rawContent.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    const detected = parsed.tactics_detected;

    if (!Array.isArray(detected)) return [];

    return detected
      .filter(t => t.tactic_name && t.definition && Array.isArray(t.instances) && t.instances.length > 0)
      .map(t => ({
        tactic: t.tactic_name,
        definition: t.definition,
        examples: t.instances.map(inst => ({
          text: inst.exact_quote,
          explanation: inst.explanation
        }))
      }));
  } catch {
    return null;
  }
}

describe('parseJsonResponse', () => {
  test('should parse valid JSON with one tactic', () => {
    const input = JSON.stringify({
      tactics_detected: [{
        tactic_name: 'Emotional Language',
        definition: 'Language using strong emotional terms.',
        instances: [{
          exact_quote: 'This will horrify you',
          explanation: 'Uses fear to bypass rational thinking'
        }]
      }]
    });

    const result = parseJsonResponse(input);
    expect(result).toHaveLength(1);
    expect(result[0].tactic).toBe('Emotional Language');
    expect(result[0].definition).toBe('Language using strong emotional terms.');
    expect(result[0].examples).toHaveLength(1);
    expect(result[0].examples[0].text).toBe('This will horrify you');
    expect(result[0].examples[0].explanation).toBe('Uses fear to bypass rational thinking');
  });

  test('should parse empty tactics array', () => {
    const input = JSON.stringify({ tactics_detected: [] });
    expect(parseJsonResponse(input)).toEqual([]);
  });

  test('should parse multiple tactics with multiple instances', () => {
    const input = JSON.stringify({
      tactics_detected: [
        {
          tactic_name: 'Ad Hominem',
          definition: 'Attacking a person instead of their argument.',
          instances: [
            { exact_quote: 'He failed math', explanation: 'Attacks personal history' },
            { exact_quote: 'She has no degree', explanation: 'Attacks credentials' }
          ]
        },
        {
          tactic_name: 'False Dichotomy',
          definition: 'Presenting only two options.',
          instances: [
            { exact_quote: "You're either with us or against us", explanation: 'Reduces to binary' }
          ]
        }
      ]
    });

    const result = parseJsonResponse(input);
    expect(result).toHaveLength(2);
    expect(result[0].tactic).toBe('Ad Hominem');
    expect(result[0].examples).toHaveLength(2);
    expect(result[1].tactic).toBe('False Dichotomy');
    expect(result[1].examples).toHaveLength(1);
  });

  test('should return null for invalid JSON', () => {
    expect(parseJsonResponse('not json at all')).toBeNull();
    expect(parseJsonResponse('{unclosed')).toBeNull();
  });

  test('should return empty array if tactics_detected is not an array', () => {
    const input = JSON.stringify({ tactics_detected: 'not an array' });
    expect(parseJsonResponse(input)).toEqual([]);
  });

  test('should skip tactics without required fields', () => {
    const input = JSON.stringify({
      tactics_detected: [
        { tactic_name: 'No Definition', instances: [{ exact_quote: 'x', explanation: 'y' }] },
        { definition: 'No Name', instances: [{ exact_quote: 'x', explanation: 'y' }] },
        { tactic_name: 'No Instances', definition: 'Has def' },
        { tactic_name: 'Empty Instances', definition: 'Has def', instances: [] },
        {
          tactic_name: 'Valid',
          definition: 'Has everything',
          instances: [{ exact_quote: 'quote', explanation: 'reason' }]
        }
      ]
    });

    const result = parseJsonResponse(input);
    expect(result).toHaveLength(1);
    expect(result[0].tactic).toBe('Valid');
  });

  test('should strip markdown json fences from Anthropic responses', () => {
    const input = '```json\n' + JSON.stringify({
      tactics_detected: [{
        tactic_name: 'Emotional Language',
        definition: 'Language using strong emotional terms.',
        instances: [{
          exact_quote: 'This will horrify you',
          explanation: 'Uses fear to bypass rational thinking'
        }]
      }]
    }) + '\n```';

    const result = parseJsonResponse(input);
    expect(result).toHaveLength(1);
    expect(result[0].tactic).toBe('Emotional Language');
  });

  test('should handle refusal or no-content response', () => {
    const input = JSON.stringify({ tactics_detected: [] });
    const result = parseJsonResponse(input);
    expect(result).toEqual([]);
  });

  test('output format matches legacy parser shape', () => {
    const input = JSON.stringify({
      tactics_detected: [{
        tactic_name: 'Slippery Slope',
        definition: 'Asserting that a first step leads to disaster.',
        instances: [{
          exact_quote: "If we allow this, chaos follows",
          explanation: 'Predicts extreme consequences from minor action'
        }]
      }]
    });

    const result = parseJsonResponse(input);
    // Verify the shape matches what the legacy parser produces
    expect(result[0]).toHaveProperty('tactic');
    expect(result[0]).toHaveProperty('definition');
    expect(result[0]).toHaveProperty('examples');
    expect(result[0].examples[0]).toHaveProperty('text');
    expect(result[0].examples[0]).toHaveProperty('explanation');
    // Should NOT have the JSON-schema field names
    expect(result[0]).not.toHaveProperty('tactic_name');
    expect(result[0].examples[0]).not.toHaveProperty('exact_quote');
  });
});
