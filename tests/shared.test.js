require('./setup');
require('../shared');

const utils = window.LeetSquadUtils;

// ============================================================
// formatLanguage
// ============================================================
describe('LeetSquadUtils.formatLanguage', () => {
  test('maps known language identifiers', () => {
    expect(utils.formatLanguage('cpp')).toBe('C++');
    expect(utils.formatLanguage('python3')).toBe('Python');
    expect(utils.formatLanguage('javascript')).toBe('JavaScript');
    expect(utils.formatLanguage('typescript')).toBe('TypeScript');
    expect(utils.formatLanguage('csharp')).toBe('C#');
    expect(utils.formatLanguage('go')).toBe('Go');
    expect(utils.formatLanguage('rust')).toBe('Rust');
  });

  test('is case-insensitive', () => {
    expect(utils.formatLanguage('Python3')).toBe('Python');
    expect(utils.formatLanguage('JAVA')).toBe('Java');
    expect(utils.formatLanguage('CPP')).toBe('C++');
  });

  test('returns raw value for unknown languages', () => {
    expect(utils.formatLanguage('haskell')).toBe('haskell');
  });

  test('returns N/A for null/undefined', () => {
    expect(utils.formatLanguage(null)).toBe('N/A');
    expect(utils.formatLanguage(undefined)).toBe('N/A');
  });
});

// ============================================================
// getAvatarGradient
// ============================================================
describe('LeetSquadUtils.getAvatarGradient', () => {
  test('returns a linear-gradient string', () => {
    const gradient = utils.getAvatarGradient('testuser');
    expect(gradient).toMatch(/^linear-gradient\(135deg,/);
  });

  test('is consistent for the same username', () => {
    const g1 = utils.getAvatarGradient('alice');
    const g2 = utils.getAvatarGradient('alice');
    expect(g1).toBe(g2);
  });

  test('produces different gradients for different usernames', () => {
    const g1 = utils.getAvatarGradient('alice');
    const g2 = utils.getAvatarGradient('bob');
    // Not guaranteed different, but with these names they should be
    expect(g1).not.toBe(g2);
  });
});

// ============================================================
// timeAgo (unix timestamp in seconds)
// ============================================================
describe('LeetSquadUtils.timeAgo', () => {
  test('returns "just now" for recent timestamps', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(utils.timeAgo(now)).toBe('just now');
  });

  test('returns minutes for timestamps < 1 hour ago', () => {
    const fiveMinAgo = Math.floor(Date.now() / 1000) - 300;
    expect(utils.timeAgo(fiveMinAgo)).toBe('5m ago');
  });

  test('returns hours for timestamps < 1 day ago', () => {
    const twoHoursAgo = Math.floor(Date.now() / 1000) - 7200;
    expect(utils.timeAgo(twoHoursAgo)).toBe('2h ago');
  });

  test('returns days for timestamps < 1 week ago', () => {
    const threeDaysAgo = Math.floor(Date.now() / 1000) - 259200;
    expect(utils.timeAgo(threeDaysAgo)).toBe('3d ago');
  });

  test('returns weeks for older timestamps', () => {
    const twoWeeksAgo = Math.floor(Date.now() / 1000) - 1209600;
    expect(utils.timeAgo(twoWeeksAgo)).toBe('2w ago');
  });
});

// ============================================================
// timeAgoMs (timestamp in milliseconds)
// ============================================================
describe('LeetSquadUtils.timeAgoMs', () => {
  test('returns "just now" for recent timestamps', () => {
    expect(utils.timeAgoMs(Date.now())).toBe('just now');
  });

  test('returns minutes for timestamps < 1 hour ago', () => {
    expect(utils.timeAgoMs(Date.now() - 300000)).toBe('5m ago');
  });
});

// ============================================================
// escapeHtml
// ============================================================
describe('LeetSquadUtils.escapeHtml', () => {
  test('escapes HTML special characters', () => {
    expect(utils.escapeHtml('<script>alert("xss")</script>')).not.toContain('<script>');
    expect(utils.escapeHtml('a & b')).toContain('&amp;');
  });

  test('returns empty string for null/undefined', () => {
    expect(utils.escapeHtml(null)).toBe('');
    expect(utils.escapeHtml(undefined)).toBe('');
  });

  test('passes through safe strings unchanged', () => {
    expect(utils.escapeHtml('hello world')).toBe('hello world');
  });
});
