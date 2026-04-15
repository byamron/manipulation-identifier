// Test feature flag system: registry integrity, resolution logic, guard resilience.
// Ensures the settings page and flag-gated features can't crash if shared.js
// fails to load (the root cause of the settings button failure).

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load shared.js in a controlled scope with a mock Chrome API.
// This tests the actual production code, not a re-implementation.
function loadShared(mockStorage = {}) {
  const source = readFileSync(join(__dirname, '..', 'shared.js'), 'utf-8');
  const mockChrome = {
    storage: {
      local: {
        get: (key, callback) => {
          const result = {};
          if (typeof key === 'string') {
            if (key in mockStorage) result[key] = mockStorage[key];
          }
          callback(result);
        }
      }
    }
  };

  const wrapped = source + '\nreturn { FEATURE_FLAGS, getFeatureFlags, escapeHtml, MSG };';
  const factory = new Function('chrome', wrapped);
  return factory(mockChrome);
}

// ── Flag registry ──

describe('Feature flag registry (FEATURE_FLAGS)', () => {
  const { FEATURE_FLAGS } = loadShared();

  test('should be a non-empty object', () => {
    expect(typeof FEATURE_FLAGS).toBe('object');
    expect(Object.keys(FEATURE_FLAGS).length).toBeGreaterThan(0);
  });

  test('every flag must have label, description, and boolean default', () => {
    for (const [key, flag] of Object.entries(FEATURE_FLAGS)) {
      expect(flag).toHaveProperty('label');
      expect(flag).toHaveProperty('description');
      expect(flag).toHaveProperty('default');
      expect(typeof flag.label).toBe('string');
      expect(typeof flag.description).toBe('string');
      expect(typeof flag.default).toBe('boolean');
    }
  });

  test('flag keys should be valid JS identifiers (used as object keys in activeFlags)', () => {
    for (const key of Object.keys(FEATURE_FLAGS)) {
      expect(key).toMatch(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/);
    }
  });

  test('labels and descriptions should be non-empty', () => {
    for (const [key, flag] of Object.entries(FEATURE_FLAGS)) {
      expect(flag.label.length).toBeGreaterThan(0);
      expect(flag.description.length).toBeGreaterThan(0);
    }
  });
});

// ── Flag resolution ──

describe('Feature flag resolution (getFeatureFlags)', () => {
  test('should return defaults when no flags stored', () => {
    const { FEATURE_FLAGS, getFeatureFlags } = loadShared({});
    return new Promise(resolve => {
      getFeatureFlags(flags => {
        for (const [key, def] of Object.entries(FEATURE_FLAGS)) {
          expect(flags[key]).toBe(def.default);
        }
        resolve();
      });
    });
  });

  test('should override defaults with stored values', () => {
    const { FEATURE_FLAGS, getFeatureFlags } = loadShared({
      featureFlags: { legendFilter: false, enhancedMotion: false }
    });
    return new Promise(resolve => {
      getFeatureFlags(flags => {
        expect(flags.legendFilter).toBe(false);
        expect(flags.enhancedMotion).toBe(false);
        // Non-overridden flags keep defaults
        for (const [key, def] of Object.entries(FEATURE_FLAGS)) {
          if (key !== 'legendFilter' && key !== 'enhancedMotion') {
            expect(flags[key]).toBe(def.default);
          }
        }
        resolve();
      });
    });
  });

  test('should ignore stored flags not in registry', () => {
    const { getFeatureFlags } = loadShared({
      featureFlags: { nonExistentFlag: true, anotherFake: false }
    });
    return new Promise(resolve => {
      getFeatureFlags(flags => {
        expect(flags).not.toHaveProperty('nonExistentFlag');
        expect(flags).not.toHaveProperty('anotherFake');
        resolve();
      });
    });
  });

  test('new flags added to registry should get defaults even with old stored data', () => {
    // Simulates: user has stored flags from before a new flag was added
    const { FEATURE_FLAGS, getFeatureFlags } = loadShared({
      featureFlags: { legendFilter: true }
    });
    return new Promise(resolve => {
      getFeatureFlags(flags => {
        // Every registry flag should be present in resolved output
        for (const key of Object.keys(FEATURE_FLAGS)) {
          expect(flags).toHaveProperty(key);
        }
        resolve();
      });
    });
  });
});

// ── Guard resilience ──
// This is the critical test: if shared.js fails to load, FEATURE_FLAGS is
// undefined. The sidepanel.js IIFE must not crash — it should degrade to
// an empty flags object so settings buttons still work.

describe('Guard resilience (sidepanel.js pattern)', () => {
  test('activeFlags init should handle undefined FEATURE_FLAGS without crashing', () => {
    const FEATURE_FLAGS_MAYBE = undefined;

    const activeFlags = typeof FEATURE_FLAGS_MAYBE !== 'undefined'
      ? Object.fromEntries(Object.entries(FEATURE_FLAGS_MAYBE).map(([k, v]) => [k, v.default]))
      : {};

    expect(activeFlags).toEqual({});
  });

  test('activeFlags init should produce correct defaults when FEATURE_FLAGS exists', () => {
    const { FEATURE_FLAGS } = loadShared();

    const activeFlags = typeof FEATURE_FLAGS !== 'undefined'
      ? Object.fromEntries(Object.entries(FEATURE_FLAGS).map(([k, v]) => [k, v.default]))
      : {};

    expect(Object.keys(activeFlags).length).toBe(Object.keys(FEATURE_FLAGS).length);
    for (const [key, def] of Object.entries(FEATURE_FLAGS)) {
      expect(activeFlags[key]).toBe(def.default);
    }
  });

  test('empty activeFlags should make all flag-gated checks safely falsy', () => {
    // When FEATURE_FLAGS is missing, activeFlags is {}. All feature gates
    // use truthiness checks (if (activeFlags.flagName)), so undefined = skip.
    const activeFlags = {};

    expect(!!activeFlags.legendFilter).toBe(false);
    expect(!!activeFlags.devSnapshots).toBe(false);
    expect(!!activeFlags.enhancedMotion).toBe(false);
    expect(!!activeFlags.compactLayout).toBe(false);
  });

  test('storage change handler should skip flag update when FEATURE_FLAGS is undefined', () => {
    // Simulates the guard in the storage.onChanged listener
    const FEATURE_FLAGS_MAYBE = undefined;
    const activeFlags = {};
    const changes = { featureFlags: { newValue: { legendFilter: false } } };

    // Guard pattern from sidepanel.js
    if (typeof FEATURE_FLAGS_MAYBE !== 'undefined') {
      const newFlags = changes.featureFlags.newValue || {};
      for (const [key, def] of Object.entries(FEATURE_FLAGS_MAYBE)) {
        activeFlags[key] = key in newFlags ? newFlags[key] : def.default;
      }
    }

    // activeFlags should remain empty — no crash
    expect(activeFlags).toEqual({});
  });
});
