// Test dev snapshot data structure and accumulation logic

const REQUIRED_FIELDS = [
  'id', 'url', 'title', 'analyzedText', 'results',
  'rawResponse', 'model', 'tokensUsed', 'analysisTimestamp', 'savedAt'
];

function createSnapshot({
  url = 'https://example.com',
  title = 'Page Title',
  analyzedText = 'the text that was analyzed',
  results = [],
  rawResponse = '{"tactics_detected":[]}',
  model = 'gemini-2.5-flash',
  tokensUsed = 1250,
  analysisTimestamp = Date.now() - 1000,
  comment = null
} = {}) {
  return {
    id: crypto.randomUUID(),
    url,
    title,
    analyzedText,
    results,
    rawResponse,
    model,
    tokensUsed,
    analysisTimestamp,
    savedAt: Date.now(),
    comment
  };
}

function saveSnapshot(existingSnapshots, newSnapshot) {
  return [...existingSnapshots, newSnapshot];
}

function exportSnapshots(snapshots) {
  return JSON.stringify(snapshots);
}

describe('dev snapshot structure', () => {
  test('snapshot has all required fields', () => {
    const snapshot = createSnapshot();
    for (const field of REQUIRED_FIELDS) {
      expect(snapshot).toHaveProperty(field);
    }
  });

  test('snapshot id is a valid UUID', () => {
    const snapshot = createSnapshot();
    expect(snapshot.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test('each snapshot gets a unique id', () => {
    const a = createSnapshot();
    const b = createSnapshot();
    expect(a.id).not.toBe(b.id);
  });

  test('savedAt is a number timestamp', () => {
    const snapshot = createSnapshot();
    expect(typeof snapshot.savedAt).toBe('number');
    expect(snapshot.savedAt).toBeGreaterThan(0);
  });

  test('analysisTimestamp is a number timestamp', () => {
    const snapshot = createSnapshot();
    expect(typeof snapshot.analysisTimestamp).toBe('number');
    expect(snapshot.analysisTimestamp).toBeGreaterThan(0);
  });

  test('results is an array', () => {
    const snapshot = createSnapshot({ results: [{ tactic: 'Ad Hominem' }] });
    expect(Array.isArray(snapshot.results)).toBe(true);
    expect(snapshot.results).toHaveLength(1);
  });

  test('snapshot without comment has comment as null', () => {
    const snapshot = createSnapshot();
    expect(snapshot.comment).toBeNull();
  });

  test('snapshot with comment preserves it', () => {
    const snapshot = createSnapshot({ comment: 'false positive on paragraph 2' });
    expect(snapshot.comment).toBe('false positive on paragraph 2');
  });

  test('snapshot preserves all analysis metadata', () => {
    const snapshot = createSnapshot({
      url: 'https://news.example.com/article',
      title: 'Breaking News',
      model: 'gemini-2.5-flash-lite',
      tokensUsed: 800
    });
    expect(snapshot.url).toBe('https://news.example.com/article');
    expect(snapshot.title).toBe('Breaking News');
    expect(snapshot.model).toBe('gemini-2.5-flash-lite');
    expect(snapshot.tokensUsed).toBe(800);
  });
});

describe('dev snapshot accumulation', () => {
  test('first snapshot creates a one-element array', () => {
    const snapshot = createSnapshot();
    const stored = saveSnapshot([], snapshot);
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(snapshot.id);
  });

  test('snapshots accumulate without overwriting', () => {
    const first = createSnapshot({ url: 'https://a.com' });
    const second = createSnapshot({ url: 'https://b.com' });

    let stored = saveSnapshot([], first);
    stored = saveSnapshot(stored, second);

    expect(stored).toHaveLength(2);
    expect(stored[0].url).toBe('https://a.com');
    expect(stored[1].url).toBe('https://b.com');
  });

  test('original array is not mutated on save', () => {
    const existing = [createSnapshot()];
    const before = existing.length;
    saveSnapshot(existing, createSnapshot());
    expect(existing).toHaveLength(before);
  });

  test('many snapshots accumulate correctly', () => {
    let stored = [];
    for (let i = 0; i < 10; i++) {
      stored = saveSnapshot(stored, createSnapshot({ url: `https://site${i}.com` }));
    }
    expect(stored).toHaveLength(10);
    expect(stored[0].url).toBe('https://site0.com');
    expect(stored[9].url).toBe('https://site9.com');
  });
});

describe('dev snapshot export', () => {
  test('export produces valid JSON', () => {
    const snapshots = [createSnapshot(), createSnapshot()];
    const exported = exportSnapshots(snapshots);
    expect(() => JSON.parse(exported)).not.toThrow();
  });

  test('exported JSON round-trips back to equivalent array', () => {
    const snapshots = [
      createSnapshot({ url: 'https://a.com', comment: 'test note' }),
      createSnapshot({ url: 'https://b.com' })
    ];
    const exported = exportSnapshots(snapshots);
    const parsed = JSON.parse(exported);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].url).toBe('https://a.com');
    expect(parsed[0].comment).toBe('test note');
    expect(parsed[1].url).toBe('https://b.com');
    expect(parsed[1].comment).toBeNull();
  });

  test('empty snapshot array exports as empty JSON array', () => {
    const exported = exportSnapshots([]);
    expect(exported).toBe('[]');
  });

  test('exported snapshots preserve results array contents', () => {
    const results = [
      {
        tactic: 'Emotional Language',
        definition: 'Language using strong emotional terms.',
        examples: [{ text: 'This will horrify you', explanation: 'Uses fear' }]
      }
    ];
    const snapshots = [createSnapshot({ results })];
    const parsed = JSON.parse(exportSnapshots(snapshots));

    expect(parsed[0].results).toHaveLength(1);
    expect(parsed[0].results[0].tactic).toBe('Emotional Language');
    expect(parsed[0].results[0].examples[0].text).toBe('This will horrify you');
  });
});
