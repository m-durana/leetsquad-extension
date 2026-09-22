// Parse-smoke tests: require each entry-point JS file to ensure it at least
// parses under Node's V8. These caught one real bug: `await` inside a
// non-async `updateWidgetUI`, that none of the behavioural tests would have
// found, because none of them actually load content.js.
//
// We can't fully execute content.js / popup.js / background.js inside Jest
// (they assume Chrome extension globals and DOM hooks we don't fully model),
// but a require()'d file at least gets parsed before any runtime hooks fire,
// which is enough to catch SyntaxErrors.

require('./setup');
require('../shared');
require('../storage');
require('../cloudsync');

beforeEach(() => {
  // Minimum globals that the IIFE in content.js / popup.js may reach for
  // during top-level evaluation. The goal is "doesn't throw at parse time",
  // not "renders the widget".
  global.window = global.window || {};
  global.document = global.document || {
    addEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { addEventListener: () => {}, innerHTML: '' },
    createElement: () => ({ addEventListener: () => {}, classList: { add: () => {}, remove: () => {} } }),
  };
});

describe('Parse smoke', () => {
  test('content.js parses without SyntaxError', () => {
    jest.isolateModules(() => {
      expect(() => require('../content')).not.toThrow();
    });
  });

  test('background.js parses without SyntaxError', () => {
    jest.isolateModules(() => {
      // background.js may attach handlers at module load; the chrome mock in
      // tests/setup.js covers the surface it touches.
      expect(() => require('../background')).not.toThrow();
    });
  });

  test('popup.js parses without SyntaxError', () => {
    jest.isolateModules(() => {
      // popup.js attaches a DOMContentLoaded listener at the top level and
      // does not run heavy work until the event fires.
      expect(() => require('../popup')).not.toThrow();
    });
  });

  test('api.js parses without SyntaxError', () => {
    jest.isolateModules(() => {
      expect(() => require('../api')).not.toThrow();
    });
  });
});
