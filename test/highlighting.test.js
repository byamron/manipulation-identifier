import { findMatchInText, findAllMatches } from '../highlight-matcher.js';

describe('findMatchInText', () => {
  describe('Tier 1: Exact match', () => {
    test('should find exact case-insensitive match', () => {
      const result = findMatchInText('Hello World', 'Say Hello World to everyone');
      expect(result).toEqual({ start: 4, end: 15 });
    });

    test('should find match regardless of case', () => {
      const result = findMatchInText('HELLO', 'say hello please');
      expect(result).toEqual({ start: 4, end: 9 });
    });

    test('should return first occurrence', () => {
      const result = findMatchInText('test', 'test this test');
      expect(result).toEqual({ start: 0, end: 4 });
    });
  });

  describe('Tier 2: Normalized match', () => {
    test('should match with different whitespace', () => {
      const result = findMatchInText(
        'hello world',
        'say hello   world please'
      );
      expect(result).not.toBeNull();
      expect(result.start).toBe(4);
    });

    test('should match with Unicode smart quotes normalized to ASCII', () => {
      const result = findMatchInText(
        '"hello world"',
        'say \u201Chello world\u201D please'
      );
      expect(result).not.toBeNull();
    });

    test('should match with em-dash normalized to hyphen', () => {
      const result = findMatchInText(
        'this - that',
        'this \u2014 that'
      );
      expect(result).not.toBeNull();
    });

    test('should match across newlines', () => {
      const result = findMatchInText(
        'hello world',
        'say hello\nworld please'
      );
      expect(result).not.toBeNull();
    });
  });

  describe('Tier 3: Fuzzy match', () => {
    test('should match with minor word differences at high threshold', () => {
      // "this will horrify you completely" vs "this will horrify you"
      // The quote is a substring, should match via trigrams
      const text = 'Read this article. This will horrify you completely and shock you.';
      const result = findMatchInText('This will horrify you completely', text, 0.7);
      expect(result).not.toBeNull();
    });

    test('should not match completely different text', () => {
      const result = findMatchInText(
        'apples and oranges',
        'The weather today is sunny and warm',
        0.85
      );
      expect(result).toBeNull();
    });

    test('should handle short quotes gracefully', () => {
      // Trigrams need at least 3 chars, so very short quotes fall back
      const result = findMatchInText('ab', 'abcdef');
      // Should still match via exact/normalized
      expect(result).toEqual({ start: 0, end: 2 });
    });
  });

  describe('Edge cases', () => {
    test('should return null for empty quote', () => {
      expect(findMatchInText('', 'some text')).toBeNull();
    });

    test('should return null for empty text', () => {
      expect(findMatchInText('hello', '')).toBeNull();
    });

    test('should return null for null inputs', () => {
      expect(findMatchInText(null, 'text')).toBeNull();
      expect(findMatchInText('quote', null)).toBeNull();
    });

    test('should handle quote longer than text', () => {
      const result = findMatchInText(
        'this is a very long quote that does not exist in the text',
        'short text'
      );
      expect(result).toBeNull();
    });
  });
});

describe('findAllMatches', () => {
  test('should find all instances and sort by position', () => {
    const text = 'First quote here and second quote there.';
    const instances = [
      { exact_quote: 'second quote', explanation: 'exp2', tactic: 'T2' },
      { exact_quote: 'First quote', explanation: 'exp1', tactic: 'T1' }
    ];

    const matches = findAllMatches(instances, text);
    expect(matches).toHaveLength(2);
    expect(matches[0].tactic).toBe('T1'); // First by position
    expect(matches[1].tactic).toBe('T2');
  });

  test('should remove overlapping matches', () => {
    const text = 'overlapping text here';
    const instances = [
      { exact_quote: 'overlapping text', explanation: 'e1', tactic: 'T1' },
      { exact_quote: 'text here', explanation: 'e2', tactic: 'T2' }
    ];

    const matches = findAllMatches(instances, text);
    expect(matches).toHaveLength(1);
    expect(matches[0].tactic).toBe('T1'); // Earlier match wins
  });

  test('should return empty array for no matches', () => {
    const matches = findAllMatches(
      [{ exact_quote: 'nonexistent', explanation: 'e', tactic: 'T' }],
      'some other text'
    );
    expect(matches).toEqual([]);
  });

  test('should handle text field as fallback for exact_quote', () => {
    const text = 'find this text';
    const instances = [
      { text: 'this text', explanation: 'e1', tactic: 'T1' }
    ];

    const matches = findAllMatches(instances, text);
    expect(matches).toHaveLength(1);
  });
});
