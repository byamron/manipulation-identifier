// Test API error message mapping.
// Re-implemented from background.js mapErrorMessage() to test in isolation
// (background.js can't be imported — it registers Chrome event listeners at load time).

function mapErrorMessage(error) {
  const msg = error.message || '';
  const status = error.status;

  if (status === 401 || status === 403) return 'Invalid API key. Check Settings.';
  if (status === 429) return 'Rate limited. Wait a minute and try again.';
  if (status >= 500) return 'API server error. Try again later.';
  if (msg.includes('timeout') || msg.includes('AbortError')) return 'Request timed out. Try again.';
  if (msg.includes('NetworkError') || msg.includes('Failed to fetch')) {
    return 'Network error — could not reach the API. Check your connection.';
  }
  if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
    return 'Content script not loaded. Try refreshing the page first.';
  }
  return msg || 'An unexpected error occurred.';
}

describe('API error message mapping', () => {
  describe('HTTP status errors', () => {
    test('401 → invalid API key', () => {
      const err = new Error('Unauthorized');
      err.status = 401;
      expect(mapErrorMessage(err)).toBe('Invalid API key. Check Settings.');
    });

    test('403 → invalid API key', () => {
      const err = new Error('Forbidden');
      err.status = 403;
      expect(mapErrorMessage(err)).toBe('Invalid API key. Check Settings.');
    });

    test('429 → rate limited', () => {
      const err = new Error('Too Many Requests');
      err.status = 429;
      expect(mapErrorMessage(err)).toBe('Rate limited. Wait a minute and try again.');
    });

    test('500 → server error', () => {
      const err = new Error('Internal Server Error');
      err.status = 500;
      expect(mapErrorMessage(err)).toBe('API server error. Try again later.');
    });

    test('503 → server error', () => {
      const err = new Error('Service Unavailable');
      err.status = 503;
      expect(mapErrorMessage(err)).toBe('API server error. Try again later.');
    });

    test('502 → server error', () => {
      const err = new Error('Bad Gateway');
      err.status = 502;
      expect(mapErrorMessage(err)).toBe('API server error. Try again later.');
    });
  });

  describe('Network and timeout errors', () => {
    test('Failed to fetch → network error', () => {
      expect(mapErrorMessage(new Error('Failed to fetch')))
        .toBe('Network error — could not reach the API. Check your connection.');
    });

    test('NetworkError → network error', () => {
      expect(mapErrorMessage(new Error('NetworkError when attempting to fetch resource')))
        .toBe('Network error — could not reach the API. Check your connection.');
    });

    test('timeout → timeout message', () => {
      expect(mapErrorMessage(new Error('Request timeout — the server took too long to respond.')))
        .toBe('Request timed out. Try again.');
    });

    test('AbortError → timeout message', () => {
      expect(mapErrorMessage(new Error('AbortError')))
        .toBe('Request timed out. Try again.');
    });
  });

  describe('Content script errors', () => {
    test('Receiving end does not exist → refresh message', () => {
      expect(mapErrorMessage(new Error('Receiving end does not exist')))
        .toBe('Content script not loaded. Try refreshing the page first.');
    });

    test('Could not establish connection → refresh message', () => {
      expect(mapErrorMessage(new Error('Could not establish connection. Receiving end does not exist.')))
        .toBe('Content script not loaded. Try refreshing the page first.');
    });
  });

  describe('Fallback handling', () => {
    test('unknown error → returns original message', () => {
      expect(mapErrorMessage(new Error('Something unexpected')))
        .toBe('Something unexpected');
    });

    test('empty message → generic fallback', () => {
      expect(mapErrorMessage(new Error('')))
        .toBe('An unexpected error occurred.');
    });

    test('non-Error object with no message → generic fallback', () => {
      expect(mapErrorMessage({}))
        .toBe('An unexpected error occurred.');
    });

    test('error with status but no matching range → returns message', () => {
      const err = new Error('Weird status');
      err.status = 418; // I'm a teapot
      expect(mapErrorMessage(err)).toBe('Weird status');
    });
  });
});
