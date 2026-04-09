// Tests for streaming parsing functions (inlined from background.js)

function extractCompleteTactics(accumulated) {
  const arrayStart = accumulated.indexOf('[');
  if (arrayStart === -1) return [];

  const text = accumulated.slice(arrayStart + 1);
  const tactics = [];
  let depth = 0;
  let objectStart = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++;
        i++;
      }
    } else if (ch === '{') {
      if (depth === 0) objectStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objectStart !== -1) {
        const objectStr = text.slice(objectStart, i + 1);
        try {
          const obj = JSON.parse(objectStr);
          if (obj.tactic_name && obj.definition && Array.isArray(obj.instances)) {
            tactics.push(obj);
          }
        } catch { /* incomplete or malformed */ }
        objectStart = -1;
      }
    }
  }

  return tactics;
}

// Simulates parseSSEStream by processing pre-built SSE text
function parseSSEText(sseText) {
  const results = [];
  const lines = sseText.split('\n');
  let eventType = null;

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith('data: ') && eventType) {
      try {
        results.push({ event: eventType, data: JSON.parse(line.slice(6)) });
      } catch { /* skip */ }
      eventType = null;
    } else if (line === '') {
      eventType = null;
    }
  }

  return results;
}

describe('extractCompleteTactics', () => {
  test('extracts a single complete tactic', () => {
    const json = '{"tactics_detected": [{"tactic_name": "Ad Hominem", "definition": "Attacking the person", "instances": [{"exact_quote": "You are dumb", "explanation": "Direct insult"}]}]}';
    const result = extractCompleteTactics(json);
    expect(result).toHaveLength(1);
    expect(result[0].tactic_name).toBe('Ad Hominem');
    expect(result[0].instances).toHaveLength(1);
  });

  test('extracts multiple complete tactics', () => {
    const json = '{"tactics_detected": [{"tactic_name": "Ad Hominem", "definition": "d1", "instances": [{"exact_quote": "q1", "explanation": "e1"}]}, {"tactic_name": "Red Herring", "definition": "d2", "instances": [{"exact_quote": "q2", "explanation": "e2"}]}]}';
    const result = extractCompleteTactics(json);
    expect(result).toHaveLength(2);
    expect(result[0].tactic_name).toBe('Ad Hominem');
    expect(result[1].tactic_name).toBe('Red Herring');
  });

  test('extracts complete tactics from partial stream (incomplete second tactic)', () => {
    const partial = '{"tactics_detected": [{"tactic_name": "Ad Hominem", "definition": "d1", "instances": [{"exact_quote": "q1", "explanation": "e1"}]}, {"tactic_name": "Red Her';
    const result = extractCompleteTactics(partial);
    expect(result).toHaveLength(1);
    expect(result[0].tactic_name).toBe('Ad Hominem');
  });

  test('returns empty array when no array bracket found', () => {
    expect(extractCompleteTactics('{"tactics_detected": ')).toEqual([]);
    expect(extractCompleteTactics('')).toEqual([]);
  });

  test('returns empty array for empty tactics array', () => {
    expect(extractCompleteTactics('{"tactics_detected": []}')).toEqual([]);
  });

  test('handles escaped quotes in string values', () => {
    const json = '{"tactics_detected": [{"tactic_name": "Ad Hominem", "definition": "Attacking \\"the person\\"", "instances": [{"exact_quote": "He said \\"you are wrong\\"", "explanation": "Contains \\"quotes\\""}]}]}';
    const result = extractCompleteTactics(json);
    expect(result).toHaveLength(1);
    expect(result[0].definition).toBe('Attacking "the person"');
  });

  test('handles braces inside string values', () => {
    const json = '{"tactics_detected": [{"tactic_name": "Test", "definition": "A {complex} definition", "instances": [{"exact_quote": "text with {braces}", "explanation": "has {nested} braces"}]}]}';
    const result = extractCompleteTactics(json);
    expect(result).toHaveLength(1);
    expect(result[0].definition).toBe('A {complex} definition');
  });

  test('skips objects without required fields', () => {
    const json = '{"tactics_detected": [{"tactic_name": "Valid", "definition": "d", "instances": [{"exact_quote": "q", "explanation": "e"}]}, {"not_a_tactic": true}]}';
    const result = extractCompleteTactics(json);
    expect(result).toHaveLength(1);
    expect(result[0].tactic_name).toBe('Valid');
  });

  test('handles newlines in JSON (pretty-printed)', () => {
    const json = `{"tactics_detected": [
      {
        "tactic_name": "Slippery Slope",
        "definition": "d1",
        "instances": [
          {"exact_quote": "q1", "explanation": "e1"}
        ]
      }
    ]}`;
    const result = extractCompleteTactics(json);
    expect(result).toHaveLength(1);
  });

  test('handles markdown code fence wrapper', () => {
    // extractCompleteTactics only looks for [ — code fences don't break it
    const json = '```json\n{"tactics_detected": [{"tactic_name": "T", "definition": "d", "instances": [{"exact_quote": "q", "explanation": "e"}]}]}\n```';
    const result = extractCompleteTactics(json);
    expect(result).toHaveLength(1);
  });

  test('handles multiple instances per tactic', () => {
    const json = '{"tactics_detected": [{"tactic_name": "T", "definition": "d", "instances": [{"exact_quote": "q1", "explanation": "e1"}, {"exact_quote": "q2", "explanation": "e2"}, {"exact_quote": "q3", "explanation": "e3"}]}]}';
    const result = extractCompleteTactics(json);
    expect(result).toHaveLength(1);
    expect(result[0].instances).toHaveLength(3);
  });
});

describe('SSE parsing (sync simulation)', () => {
  test('parses content_block_delta events', () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":100}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"output_tokens":50}}',
      '',
    ].join('\n');

    const events = parseSSEText(sse);
    expect(events).toHaveLength(4);
    expect(events[0].event).toBe('message_start');
    expect(events[1].event).toBe('content_block_delta');
    expect(events[1].data.delta.text).toBe('hello');
    expect(events[2].data.delta.text).toBe(' world');
    expect(events[3].event).toBe('message_delta');
    expect(events[3].data.usage.output_tokens).toBe(50);
  });

  test('skips malformed JSON in data lines', () => {
    const sse = [
      'event: content_block_delta',
      'data: {not valid json',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
      '',
    ].join('\n');

    const events = parseSSEText(sse);
    expect(events).toHaveLength(1);
    expect(events[0].data.delta.text).toBe('ok');
  });

  test('ignores data lines without preceding event', () => {
    const sse = [
      'data: {"orphan": true}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
      '',
    ].join('\n');

    const events = parseSSEText(sse);
    expect(events).toHaveLength(1);
  });

  test('handles empty stream', () => {
    expect(parseSSEText('')).toEqual([]);
  });
});
