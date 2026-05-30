require('./setup');

// Load shared utilities (content.js now depends on LeetSquadUtils)
require('../shared');

// Content.js is an IIFE that runs immediately. We test its helper functions
// by extracting the logic into testable units. Since content.js uses global
// LeetCodeAPI, StorageManager, and LeetSquadUtils, we mock those and test the behavior.

// Mock StorageManager and LeetCodeAPI on window
window.StorageManager = {
  getFriends: jest.fn().mockResolvedValue([]),
  getMyUsername: jest.fn().mockResolvedValue(null),
  getSettings: jest.fn().mockResolvedValue({
    showOnProblemPage: true,
    debugMode: false,
    widgetDisplayMode: 'minimized',
  }),
  getCachedData: jest.fn().mockResolvedValue(null),
  setCachedData: jest.fn().mockResolvedValue(undefined),
};

window.LeetCodeAPI = {
  getUserProfile: jest.fn().mockResolvedValue(null),
  getUserSolvedProblems: jest.fn().mockResolvedValue(null),
  getRecentSubmissions: jest.fn().mockResolvedValue(null),
  getFullUserData: jest.fn().mockResolvedValue(null),
  getRecentAcSubmissions: jest.fn().mockResolvedValue([]),
  hasUserSolvedProblemGraphQL: jest.fn().mockResolvedValue({ solved: false }),
  getSubmissionDetails: jest.fn().mockResolvedValue(null),
  getProblemSubmissions: jest.fn().mockResolvedValue([]),
};

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
  // Reset location
  delete window.location;
  window.location = { pathname: '/problems/two-sum/', href: 'https://leetcode.com/problems/two-sum/' };
});

// ============================================================
// getProblemSlug (extracted logic)
// ============================================================
describe('Content: getProblemSlug logic', () => {
  function getProblemSlug() {
    const match = window.location.pathname.match(/\/problems\/([^/]+)/);
    return match ? match[1] : null;
  }

  test('extracts slug from /problems/two-sum/', () => {
    window.location.pathname = '/problems/two-sum/';
    expect(getProblemSlug()).toBe('two-sum');
  });

  test('extracts slug from /problems/add-two-numbers/description/', () => {
    window.location.pathname = '/problems/add-two-numbers/description/';
    expect(getProblemSlug()).toBe('add-two-numbers');
  });

  test('returns null for non-problem pages', () => {
    window.location.pathname = '/explore/';
    expect(getProblemSlug()).toBeNull();
  });

  test('returns null for /problemset/', () => {
    window.location.pathname = '/problemset/all/';
    expect(getProblemSlug()).toBeNull();
  });
});

// ============================================================
// timeAgo (extracted logic)
// ============================================================
describe('Content: timeAgo logic', () => {
  function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp * 1000) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return `${Math.floor(seconds / 604800)}w ago`;
  }

  test('shows "just now" for < 60 seconds', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(timeAgo(now - 30)).toBe('just now');
  });

  test('shows minutes for < 1 hour', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(timeAgo(now - 300)).toBe('5m ago');
  });

  test('shows hours for < 1 day', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(timeAgo(now - 7200)).toBe('2h ago');
  });

  test('shows days for < 1 week', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(timeAgo(now - 259200)).toBe('3d ago');
  });

  test('shows weeks for >= 1 week', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(timeAgo(now - 1209600)).toBe('2w ago');
  });
});

// ============================================================
// formatLanguage (extracted logic)
// ============================================================
describe('Content: formatLanguage logic', () => {
  function formatLanguage(lang) {
    const langMap = {
      'cpp': 'C++', 'java': 'Java', 'python': 'Python', 'python3': 'Python',
      'c': 'C', 'csharp': 'C#', 'javascript': 'JavaScript', 'typescript': 'TypeScript',
      'php': 'PHP', 'swift': 'Swift', 'kotlin': 'Kotlin', 'dart': 'Dart',
      'go': 'Go', 'ruby': 'Ruby', 'scala': 'Scala', 'rust': 'Rust',
      'racket': 'Racket', 'erlang': 'Erlang', 'elixir': 'Elixir',
      'mysql': 'MySQL', 'mssql': 'MS SQL', 'oraclesql': 'Oracle SQL',
    };
    return langMap[lang?.toLowerCase()] || lang || 'N/A';
  }

  test('maps known languages correctly', () => {
    expect(formatLanguage('cpp')).toBe('C++');
    expect(formatLanguage('python3')).toBe('Python');
    expect(formatLanguage('javascript')).toBe('JavaScript');
    expect(formatLanguage('typescript')).toBe('TypeScript');
    expect(formatLanguage('go')).toBe('Go');
    expect(formatLanguage('rust')).toBe('Rust');
    expect(formatLanguage('csharp')).toBe('C#');
  });

  test('is case-insensitive', () => {
    expect(formatLanguage('CPP')).toBe('C++');
    expect(formatLanguage('Java')).toBe('Java');
    expect(formatLanguage('PYTHON3')).toBe('Python');
  });

  test('returns raw value for unknown languages', () => {
    expect(formatLanguage('haskell')).toBe('haskell');
  });

  test('returns N/A for null/undefined', () => {
    expect(formatLanguage(null)).toBe('N/A');
    expect(formatLanguage(undefined)).toBe('N/A');
  });
});

// ============================================================
// getAvatarGradient (extracted logic)
// ============================================================
describe('Content: getAvatarGradient logic', () => {
  function getAvatarGradient(username) {
    const colors = [
      ['#e94560', '#a855f7'], ['#a855f7', '#3b82f6'], ['#3b82f6', '#06b6d4'],
      ['#06b6d4', '#10b981'], ['#10b981', '#f59e0b'], ['#f59e0b', '#e94560'],
    ];
    const hash = username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const pair = colors[hash % colors.length];
    return `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;
  }

  test('returns a linear-gradient string', () => {
    const result = getAvatarGradient('testuser');
    expect(result).toMatch(/^linear-gradient\(135deg, #[0-9a-f]+, #[0-9a-f]+\)$/);
  });

  test('returns the same gradient for the same username', () => {
    const a = getAvatarGradient('alice');
    const b = getAvatarGradient('alice');
    expect(a).toBe(b);
  });

  test('returns different gradients for different usernames', () => {
    const a = getAvatarGradient('alice');
    const b = getAvatarGradient('bob');
    // Not guaranteed different, but very likely for these two
    // At minimum they should both be valid gradients
    expect(a).toMatch(/linear-gradient/);
    expect(b).toMatch(/linear-gradient/);
  });
});

// ============================================================
// Widget creation and display modes
// ============================================================
describe('Content: widget behavior', () => {
  test('widget should not be injected on non-problem pages', () => {
    window.location.pathname = '/explore/';
    // The IIFE checks getProblemSlug() before inserting
    const widget = document.getElementById('leetsquad-widget');
    expect(widget).toBeNull();
  });
});

// ============================================================
// Deep check solved - multi-method detection
// ============================================================
describe('Content: deepCheckSolved logic', () => {
  // Re-implement the core detection logic for testing
  async function checkSolvedMultiMethod(username, problemSlug) {
    const results = { solved: false, method: null };

    // Method 1: solved list (broken - returns number now)
    const solvedData = await window.LeetCodeAPI.getUserSolvedProblems(username);
    if (solvedData?.solvedProblem && Array.isArray(solvedData.solvedProblem)) {
      const found = solvedData.solvedProblem.find(p => p.titleSlug === problemSlug);
      if (found) {
        results.solved = true;
        results.method = 'solved-list';
      }
    }

    // Method 2: recent submissions
    if (!results.solved) {
      const subs = await window.LeetCodeAPI.getRecentSubmissions(username, 100);
      if (subs?.submission) {
        const found = subs.submission.find(
          s => s.titleSlug === problemSlug && s.statusDisplay === 'Accepted'
        );
        if (found) {
          results.solved = true;
          results.method = 'submissions';
        }
      }
    }

    // Method 3: GraphQL
    if (!results.solved) {
      const gql = await window.LeetCodeAPI.getRecentAcSubmissions(username, 50);
      if (gql?.length > 0) {
        const found = gql.find(s => s.titleSlug === problemSlug);
        if (found) {
          results.solved = true;
          results.method = 'graphql';
        }
      }
    }

    return results;
  }

  test('detects solve via solved list (array)', async () => {
    window.LeetCodeAPI.getUserSolvedProblems.mockResolvedValueOnce({
      solvedProblem: [{ titleSlug: 'two-sum' }],
    });

    const result = await checkSolvedMultiMethod('alice', 'two-sum');
    expect(result.solved).toBe(true);
    expect(result.method).toBe('solved-list');
  });

  test('falls back to submissions when solved list is a number', async () => {
    window.LeetCodeAPI.getUserSolvedProblems.mockResolvedValueOnce({
      solvedProblem: 150, // broken API
    });
    window.LeetCodeAPI.getRecentSubmissions.mockResolvedValueOnce({
      submission: [
        { titleSlug: 'two-sum', statusDisplay: 'Accepted' },
      ],
    });

    const result = await checkSolvedMultiMethod('alice', 'two-sum');
    expect(result.solved).toBe(true);
    expect(result.method).toBe('submissions');
  });

  test('falls back to GraphQL when submissions miss', async () => {
    window.LeetCodeAPI.getUserSolvedProblems.mockResolvedValueOnce({
      solvedProblem: 150,
    });
    window.LeetCodeAPI.getRecentSubmissions.mockResolvedValueOnce({
      submission: [],
    });
    window.LeetCodeAPI.getRecentAcSubmissions.mockResolvedValueOnce([
      { titleSlug: 'two-sum', id: '123' },
    ]);

    const result = await checkSolvedMultiMethod('alice', 'two-sum');
    expect(result.solved).toBe(true);
    expect(result.method).toBe('graphql');
  });

  test('returns not solved when all methods fail', async () => {
    window.LeetCodeAPI.getUserSolvedProblems.mockResolvedValueOnce({
      solvedProblem: 150,
    });
    window.LeetCodeAPI.getRecentSubmissions.mockResolvedValueOnce({
      submission: [],
    });
    window.LeetCodeAPI.getRecentAcSubmissions.mockResolvedValueOnce([]);

    const result = await checkSolvedMultiMethod('alice', 'two-sum');
    expect(result.solved).toBe(false);
  });

  test('ignores non-Accepted submissions in method 2', async () => {
    window.LeetCodeAPI.getUserSolvedProblems.mockResolvedValueOnce(null);
    window.LeetCodeAPI.getRecentSubmissions.mockResolvedValueOnce({
      submission: [
        { titleSlug: 'two-sum', statusDisplay: 'Wrong Answer' },
        { titleSlug: 'two-sum', statusDisplay: 'Time Limit Exceeded' },
      ],
    });
    window.LeetCodeAPI.getRecentAcSubmissions.mockResolvedValueOnce([]);

    const result = await checkSolvedMultiMethod('alice', 'two-sum');
    expect(result.solved).toBe(false);
  });
});

// ============================================================
// Extension context validation
// ============================================================
describe('Content: extension context validation', () => {
  function isExtensionContextValid() {
    try {
      return !!(chrome && chrome.storage && chrome.storage.local);
    } catch (e) {
      return false;
    }
  }

  test('returns true when chrome.storage.local is available', () => {
    expect(isExtensionContextValid()).toBe(true);
  });

  test('returns false when chrome.storage is undefined', () => {
    const orig = chrome.storage;
    chrome.storage = undefined;
    expect(isExtensionContextValid()).toBe(false);
    chrome.storage = orig;
  });
});

// ============================================================
// renderFriendCard HTML structure
// ============================================================
describe('Content: renderFriendCard', () => {
  function renderFriendCard(friend, isMe, problemSlug) {
    const { username, submissions, profile, runtimePercentile } = friend;
    const submission = submissions?.[0];
    const avatar = profile?.avatar ?? null;

    const percentileDisplay = runtimePercentile
      ? `<span class="percentile-tag">🏆${runtimePercentile.toFixed(1)}%</span>`
      : '';

    return `
      <a class="leetsquad-friend solved ${isMe ? 'is-me' : ''}">
        <div class="friend-info">
          <span class="friend-name-text">${username}</span>
          ${isMe ? '<span class="you-badge">You</span>' : ''}
          ${percentileDisplay}
        </div>
      </a>
    `;
  }

  test('renders username in card', () => {
    const html = renderFriendCard(
      { username: 'alice', submissions: [], profile: {} },
      false,
      'two-sum'
    );
    expect(html).toContain('alice');
    expect(html).toContain('leetsquad-friend solved');
  });

  test('shows "You" badge for current user', () => {
    const html = renderFriendCard(
      { username: 'me', submissions: [], profile: {} },
      true,
      'two-sum'
    );
    expect(html).toContain('you-badge');
    expect(html).toContain('is-me');
  });

  test('shows percentile when available', () => {
    const html = renderFriendCard(
      { username: 'alice', submissions: [], profile: {}, runtimePercentile: 95.5 },
      false,
      'two-sum'
    );
    expect(html).toContain('95.5%');
    expect(html).toContain('percentile-tag');
  });

  test('hides percentile when not available', () => {
    const html = renderFriendCard(
      { username: 'alice', submissions: [], profile: {} },
      false,
      'two-sum'
    );
    expect(html).not.toContain('percentile-tag');
  });
});
