// Structural contract tests for sidepanel.js — guards the bug-fix work shipped
// in history.md Phase 22. These aren't pure-unit tests; they assert that the
// source contains specific patterns that, if deleted, would reintroduce known
// failure modes. Brittle to refactor by design — if you change the shape, you
// must look at this file and decide whether the contract still holds.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sidepanelSrc = readFileSync(join(__dirname, '..', 'sidepanel.js'), 'utf-8');

describe('sidepanel.js contract: tab state re-checking', () => {
  test('uses isAnalyzableUrl helper from shared.js', () => {
    expect(sidepanelSrc).toMatch(/isAnalyzableUrl\(tab\)/);
  });

  test('chrome.tabs.onUpdated uses property filter to suppress noise', () => {
    expect(sidepanelSrc).toMatch(/onUpdated\.addListener\([^,]+,\s*\{\s*properties:\s*\[\s*['"]status['"]\s*\]/);
  });

  test('visibilitychange handler guards on activeTabId to avoid init race', () => {
    // The handler body must short-circuit when activeTabId hasn't been set yet,
    // otherwise it races with init() and runs checkTabState twice on first load.
    expect(sidepanelSrc).toMatch(/visibilityChange\s*=\s*async[\s\S]{0,500}if\s*\(!activeTabId\)\s*return/);
  });

  test('checkTabState writes diagnostic counters to session storage', () => {
    expect(sidepanelSrc).toMatch(/mi_check_tab_state_total/);
    expect(sidepanelSrc).toMatch(/mi_check_tab_state_undefined/);
  });

  test('tab.url undefined path logs a console.warn breadcrumb', () => {
    expect(sidepanelSrc).toMatch(/console\.warn\(['"]?\[MI\] checkTabState/);
  });

  test('listeners are torn down on beforeunload', () => {
    expect(sidepanelSrc).toMatch(/beforeunload/);
    expect(sidepanelSrc).toMatch(/chrome\.tabs\.onActivated\.removeListener/);
    expect(sidepanelSrc).toMatch(/chrome\.tabs\.onUpdated\.removeListener/);
    expect(sidepanelSrc).toMatch(/removeEventListener\(['"]visibilitychange['"]/);
  });
});

describe('sidepanel.js contract: unsupported state UX', () => {
  test('renders an explanation, not just a dead-end message', () => {
    // Must mention what kinds of pages aren't supported.
    expect(sidepanelSrc).toMatch(/system pages|http and https/i);
  });

  test('exposes a re-check affordance', () => {
    expect(sidepanelSrc).toMatch(/id=['"]recheckBtn['"]/);
    // Button text "Re-check" (renamed from "Try again" — see Phase 22 post-review).
    expect(sidepanelSrc).toMatch(/>Re-check</);
  });

  test('Re-check button re-queries the active tab and refetches it inside the defer', () => {
    // Initial query gets the tab id; the defer's chrome.tabs.get refetches a
    // fresh tab to avoid acting on a stale reference if the user navigated.
    expect(sidepanelSrc).toMatch(/recheckBtn[\s\S]{0,400}chrome\.tabs\.query/);
    expect(sidepanelSrc).toMatch(/recheckBtn[\s\S]{0,900}chrome\.tabs\.get\(tabId\)/);
  });

  test('showChecking transient state exists to bridge re-checks', () => {
    expect(sidepanelSrc).toMatch(/function showChecking/);
    expect(sidepanelSrc).toMatch(/status-checking/);
  });

  test('visibilitychange handler transitions through showChecking when previous state was unsupported', () => {
    expect(sidepanelSrc).toMatch(/currentState\s*===\s*['"]unsupported['"][\s\S]{0,100}showChecking\(\)/);
  });

  test('visibility handler short-circuits before showChecking when no active tab', () => {
    // Guards against a regression where chrome.tabs.query returns [] and the
    // user is stranded on the checking spinner with no resolution path.
    // Order must be: query → if (!tab) return → showChecking → checkTabState.
    expect(sidepanelSrc).toMatch(/visibilityChange[\s\S]{0,800}if\s*\(!tab\)\s*return[\s\S]{0,300}showChecking/);
  });
});
