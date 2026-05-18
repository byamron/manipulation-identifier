// Test isAnalyzableUrl: the URL guard that decides whether the side panel
// shows "Cannot analyze this page" vs offering analysis. The historical bug
// was failing closed when tab.url was briefly undefined (extension reload,
// permissions timing), which surfaced as the unsupported-page message on
// valid http sites. See history.md Phase 22.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadShared() {
  const source = readFileSync(join(__dirname, '..', 'shared.js'), 'utf-8');
  const wrapped = source + '\nreturn { isAnalyzableUrl };';
  const factory = new Function('chrome', wrapped);
  return factory({ storage: { local: { get: (_k, cb) => cb({}) } } });
}

const { isAnalyzableUrl } = loadShared();

describe('isAnalyzableUrl', () => {
  test('https URL is analyzable', () => {
    expect(isAnalyzableUrl({ url: 'https://example.com' })).toBe(true);
  });

  test('http URL is analyzable', () => {
    expect(isAnalyzableUrl({ url: 'http://example.com' })).toBe(true);
  });

  test('chrome:// URL is not analyzable', () => {
    expect(isAnalyzableUrl({ url: 'chrome://settings' })).toBe(false);
  });

  test('chrome-extension:// URL is not analyzable', () => {
    expect(isAnalyzableUrl({ url: 'chrome-extension://abc/options.html' })).toBe(false);
  });

  test('file:// URL is not analyzable', () => {
    expect(isAnalyzableUrl({ url: 'file:///Users/me/page.html' })).toBe(false);
  });

  test('about:blank is not analyzable', () => {
    expect(isAnalyzableUrl({ url: 'about:blank' })).toBe(false);
  });

  // Regression: the original bug. tab.url undefined during extension reload /
  // permissions-grant timing must NOT fall through to "Cannot analyze."
  test('undefined tab.url falls open to analyzable', () => {
    expect(isAnalyzableUrl({})).toBe(true);
  });

  test('empty string tab.url falls open to analyzable', () => {
    expect(isAnalyzableUrl({ url: '' })).toBe(true);
  });

  test('pendingUrl is used when tab.url is undefined', () => {
    expect(isAnalyzableUrl({ pendingUrl: 'https://example.com' })).toBe(true);
  });

  test('pendingUrl that is non-http is rejected', () => {
    expect(isAnalyzableUrl({ pendingUrl: 'chrome://settings' })).toBe(false);
  });

  test('tab.url takes precedence over pendingUrl when both set', () => {
    // Mid-navigation: tab.url is current page (analyzable), pendingUrl is target.
    // We honor tab.url because that's what the user is currently looking at.
    expect(isAnalyzableUrl({ url: 'https://current.com', pendingUrl: 'chrome://settings' })).toBe(true);
  });

  test('https with port and path is analyzable', () => {
    expect(isAnalyzableUrl({ url: 'https://example.com:8080/path?q=1' })).toBe(true);
  });
});
