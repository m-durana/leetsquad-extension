require('./setup');

// popup.js is tightly coupled to the DOM (DOMContentLoaded listener).
// We test the extracted helper functions and business logic here.

// ============================================================
// formatTimeAgo
// ============================================================
describe('Popup: formatTimeAgo', () => {
  function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return `${Math.floor(seconds / 604800)}w ago`;
  }

  test('shows "just now" for < 60 seconds', () => {
    expect(formatTimeAgo(Date.now() - 30000)).toBe('just now');
  });

  test('shows minutes', () => {
    expect(formatTimeAgo(Date.now() - 5 * 60 * 1000)).toBe('5m ago');
  });

  test('shows hours', () => {
    expect(formatTimeAgo(Date.now() - 3 * 60 * 60 * 1000)).toBe('3h ago');
  });

  test('shows days', () => {
    expect(formatTimeAgo(Date.now() - 2 * 24 * 60 * 60 * 1000)).toBe('2d ago');
  });

  test('shows weeks', () => {
    expect(formatTimeAgo(Date.now() - 14 * 24 * 60 * 60 * 1000)).toBe('2w ago');
  });
});

// ============================================================
// formatLanguage
// ============================================================
describe('Popup: formatLanguage', () => {
  function formatLanguage(lang) {
    const langMap = {
      'cpp': 'C++', 'java': 'Java', 'python': 'Python', 'python3': 'Python',
      'c': 'C', 'csharp': 'C#', 'javascript': 'JavaScript', 'typescript': 'TypeScript',
      'php': 'PHP', 'swift': 'Swift', 'kotlin': 'Kotlin', 'dart': 'Dart',
      'go': 'Go', 'ruby': 'Ruby', 'scala': 'Scala', 'rust': 'Rust',
    };
    return langMap[lang?.toLowerCase()] || lang || 'N/A';
  }

  test('maps known languages', () => {
    expect(formatLanguage('cpp')).toBe('C++');
    expect(formatLanguage('java')).toBe('Java');
    expect(formatLanguage('python3')).toBe('Python');
  });

  test('passes through unknown languages', () => {
    expect(formatLanguage('zig')).toBe('zig');
  });

  test('returns N/A for null', () => {
    expect(formatLanguage(null)).toBe('N/A');
  });
});

// ============================================================
// getPeriodStartTimestamp
// ============================================================
describe('Popup: getPeriodStartTimestamp', () => {
  function getPeriodStartTimestamp(period) {
    const now = new Date();
    if (period === 'week') {
      return Math.floor((now.getTime() - 7 * 24 * 60 * 60 * 1000) / 1000);
    } else if (period === 'month') {
      return Math.floor((now.getTime() - 30 * 24 * 60 * 60 * 1000) / 1000);
    }
    return 0;
  }

  test('week period returns timestamp ~7 days ago', () => {
    const result = getPeriodStartTimestamp('week');
    const expected = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
    expect(Math.abs(result - expected)).toBeLessThan(2);
  });

  test('month period returns timestamp ~30 days ago', () => {
    const result = getPeriodStartTimestamp('month');
    const expected = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    expect(Math.abs(result - expected)).toBeLessThan(2);
  });

  test('all-time returns 0', () => {
    expect(getPeriodStartTimestamp('all')).toBe(0);
  });
});

// ============================================================
// countSubmissionsInPeriod
// ============================================================
describe('Popup: countSubmissionsInPeriod', () => {
  function countSubmissionsInPeriod(submissions, periodStart) {
    if (!submissions?.submission) return { total: 0, easy: 0, medium: 0, hard: 0 };

    const accepted = submissions.submission.filter(s =>
      s.statusDisplay === 'Accepted' && s.timestamp >= periodStart
    );

    const uniqueProblems = new Map();
    accepted.forEach(s => {
      if (!uniqueProblems.has(s.titleSlug)) {
        uniqueProblems.set(s.titleSlug, s.difficulty || 'Medium');
      }
    });

    let easy = 0, medium = 0, hard = 0;
    uniqueProblems.forEach(diff => {
      if (diff === 'Easy') easy++;
      else if (diff === 'Hard') hard++;
      else medium++;
    });

    return { total: uniqueProblems.size, easy, medium, hard };
  }

  test('returns zeros for null submissions', () => {
    const result = countSubmissionsInPeriod(null, 0);
    expect(result).toEqual({ total: 0, easy: 0, medium: 0, hard: 0 });
  });

  test('counts unique accepted submissions in period', () => {
    const now = Math.floor(Date.now() / 1000);
    const submissions = {
      submission: [
        { titleSlug: 'two-sum', statusDisplay: 'Accepted', timestamp: now - 100, difficulty: 'Easy' },
        { titleSlug: 'three-sum', statusDisplay: 'Accepted', timestamp: now - 200, difficulty: 'Medium' },
        { titleSlug: 'two-sum', statusDisplay: 'Accepted', timestamp: now - 50, difficulty: 'Easy' }, // dupe
      ],
    };

    const result = countSubmissionsInPeriod(submissions, now - 1000);
    expect(result.total).toBe(2);
    expect(result.easy).toBe(1);
    expect(result.medium).toBe(1);
  });

  test('excludes submissions before period start', () => {
    const now = Math.floor(Date.now() / 1000);
    const submissions = {
      submission: [
        { titleSlug: 'old-problem', statusDisplay: 'Accepted', timestamp: now - 999999, difficulty: 'Easy' },
        { titleSlug: 'new-problem', statusDisplay: 'Accepted', timestamp: now - 100, difficulty: 'Hard' },
      ],
    };

    const result = countSubmissionsInPeriod(submissions, now - 1000);
    expect(result.total).toBe(1);
    expect(result.hard).toBe(1);
    expect(result.easy).toBe(0);
  });

  test('excludes non-Accepted submissions', () => {
    const now = Math.floor(Date.now() / 1000);
    const submissions = {
      submission: [
        { titleSlug: 'p1', statusDisplay: 'Wrong Answer', timestamp: now, difficulty: 'Easy' },
        { titleSlug: 'p2', statusDisplay: 'Accepted', timestamp: now, difficulty: 'Medium' },
      ],
    };

    const result = countSubmissionsInPeriod(submissions, 0);
    expect(result.total).toBe(1);
    expect(result.medium).toBe(1);
  });

  test('defaults unknown difficulty to Medium', () => {
    const now = Math.floor(Date.now() / 1000);
    const submissions = {
      submission: [
        { titleSlug: 'p1', statusDisplay: 'Accepted', timestamp: now },
      ],
    };

    const result = countSubmissionsInPeriod(submissions, 0);
    expect(result.medium).toBe(1);
  });
});

// ============================================================
// Leaderboard rendering logic
// ============================================================
describe('Popup: leaderboard rendering', () => {
  function renderLeaderboardItem(user, index) {
    const { username, total } = user;
    let rankDisplay = index + 1;
    if (index === 0) rankDisplay = '🥇';
    else if (index === 1) rankDisplay = '🥈';
    else if (index === 2) rankDisplay = '🥉';
    return { username, rankDisplay, total };
  }

  test('first place gets gold medal', () => {
    const result = renderLeaderboardItem({ username: 'alice', total: 100 }, 0);
    expect(result.rankDisplay).toBe('🥇');
  });

  test('second place gets silver medal', () => {
    const result = renderLeaderboardItem({ username: 'bob', total: 90 }, 1);
    expect(result.rankDisplay).toBe('🥈');
  });

  test('third place gets bronze medal', () => {
    const result = renderLeaderboardItem({ username: 'charlie', total: 80 }, 2);
    expect(result.rankDisplay).toBe('🥉');
  });

  test('4th+ place gets numeric rank', () => {
    const result = renderLeaderboardItem({ username: 'dave', total: 70 }, 3);
    expect(result.rankDisplay).toBe(4);
  });

  test('leaderboard sorts by total descending', () => {
    const users = [
      { username: 'b', total: 50 },
      { username: 'a', total: 100 },
      { username: 'c', total: 75 },
    ];
    const sorted = users.sort((a, b) => b.total - a.total);
    expect(sorted[0].username).toBe('a');
    expect(sorted[1].username).toBe('c');
    expect(sorted[2].username).toBe('b');
  });
});

// ============================================================
// Activity feed - first-solve detection
// ============================================================
describe('Popup: first-solve detection', () => {
  function markFirstSolves(submissions) {
    const seenProblems = new Map();
    submissions.forEach(sub => {
      const key = `${sub.username}:${sub.titleSlug}`;
      if (!seenProblems.has(key) || sub.timestamp < seenProblems.get(key)) {
        seenProblems.set(key, sub.timestamp);
      }
    });

    return submissions.map(sub => ({
      ...sub,
      isFirstSolve: sub.timestamp === seenProblems.get(`${sub.username}:${sub.titleSlug}`),
    }));
  }

  test('marks earliest submission as first solve', () => {
    const subs = [
      { username: 'alice', titleSlug: 'two-sum', timestamp: 200 },
      { username: 'alice', titleSlug: 'two-sum', timestamp: 100 }, // earlier = first solve
    ];
    const result = markFirstSolves(subs);
    expect(result[0].isFirstSolve).toBe(false);
    expect(result[1].isFirstSolve).toBe(true);
  });

  test('different users have independent first solves', () => {
    const subs = [
      { username: 'alice', titleSlug: 'two-sum', timestamp: 100 },
      { username: 'bob', titleSlug: 'two-sum', timestamp: 200 },
    ];
    const result = markFirstSolves(subs);
    expect(result[0].isFirstSolve).toBe(true);
    expect(result[1].isFirstSolve).toBe(true);
  });

  test('different problems have independent first solves', () => {
    const subs = [
      { username: 'alice', titleSlug: 'two-sum', timestamp: 100 },
      { username: 'alice', titleSlug: 'three-sum', timestamp: 200 },
    ];
    const result = markFirstSolves(subs);
    expect(result[0].isFirstSolve).toBe(true);
    expect(result[1].isFirstSolve).toBe(true);
  });
});

// ============================================================
// Activity feed filtering
// ============================================================
describe('Popup: activity filtering', () => {
  test('filters to first-solve only', () => {
    const subs = [
      { isFirstSolve: true, title: 'Two Sum' },
      { isFirstSolve: false, title: 'Two Sum (retry)' },
      { isFirstSolve: true, title: 'Three Sum' },
    ];
    const filtered = subs.filter(s => s.isFirstSolve);
    expect(filtered).toHaveLength(2);
  });

  test('shows all when filter is off', () => {
    const subs = [
      { isFirstSolve: true }, { isFirstSolve: false }, { isFirstSolve: true },
    ];
    const showFirstSolveOnly = false;
    const filtered = showFirstSolveOnly ? subs.filter(s => s.isFirstSolve) : subs;
    expect(filtered).toHaveLength(3);
  });
});

// ============================================================
// Mutuals: common problem finding
// ============================================================
describe('Popup: mutuals common problems', () => {
  function findCommonProblems(mySolved, friendSolved) {
    const friendSolvedMap = new Map();
    friendSolved.forEach(p => {
      if (p?.titleSlug) friendSolvedMap.set(p.titleSlug, p);
    });

    const common = [];
    mySolved.forEach(myProblem => {
      if (!myProblem?.titleSlug) return;
      const friendProblem = friendSolvedMap.get(myProblem.titleSlug);
      if (friendProblem) {
        common.push({
          titleSlug: myProblem.titleSlug,
          title: myProblem.title || friendProblem.title,
          difficulty: myProblem.difficulty || friendProblem.difficulty || 'Medium',
        });
      }
    });
    return common;
  }

  test('finds common problems between two users', () => {
    const mySolved = [
      { titleSlug: 'two-sum', title: 'Two Sum', difficulty: 'Easy' },
      { titleSlug: 'three-sum', title: 'Three Sum', difficulty: 'Medium' },
    ];
    const friendSolved = [
      { titleSlug: 'two-sum', title: 'Two Sum', difficulty: 'Easy' },
      { titleSlug: 'four-sum', title: 'Four Sum', difficulty: 'Medium' },
    ];

    const result = findCommonProblems(mySolved, friendSolved);
    expect(result).toHaveLength(1);
    expect(result[0].titleSlug).toBe('two-sum');
  });

  test('returns empty array when no common problems', () => {
    const mySolved = [{ titleSlug: 'a' }];
    const friendSolved = [{ titleSlug: 'b' }];
    const result = findCommonProblems(mySolved, friendSolved);
    expect(result).toEqual([]);
  });

  test('handles empty solved lists', () => {
    expect(findCommonProblems([], [])).toEqual([]);
    expect(findCommonProblems([], [{ titleSlug: 'a' }])).toEqual([]);
  });

  test('skips null entries', () => {
    const mySolved = [null, { titleSlug: 'two-sum' }];
    const friendSolved = [{ titleSlug: 'two-sum' }, null];
    const result = findCommonProblems(mySolved, friendSolved);
    expect(result).toHaveLength(1);
  });
});

// ============================================================
// Mutuals: runtime comparison
// ============================================================
describe('Popup: runtime comparison', () => {
  function parseRuntime(runtimeStr) {
    if (!runtimeStr) return null;
    const match = runtimeStr.match(/(\d+)\s*ms/i);
    return match ? parseInt(match[1]) : null;
  }

  test('parses "99 ms" to 99', () => {
    expect(parseRuntime('99 ms')).toBe(99);
  });

  test('parses "4 ms" to 4', () => {
    expect(parseRuntime('4 ms')).toBe(4);
  });

  test('parses "150ms" (no space) to 150', () => {
    expect(parseRuntime('150ms')).toBe(150);
  });

  test('returns null for null input', () => {
    expect(parseRuntime(null)).toBeNull();
  });

  test('returns null for non-ms format', () => {
    expect(parseRuntime('N/A')).toBeNull();
  });

  test('determines winner by lower runtime', () => {
    const myRuntime = 4;
    const friendRuntime = 99;
    expect(myRuntime < friendRuntime).toBe(true);
  });
});

// ============================================================
// getAvatarGradient (popup version)
// ============================================================
describe('Popup: getAvatarGradient', () => {
  function getAvatarGradient(username) {
    const colors = [
      ['#e94560', '#a855f7'], ['#a855f7', '#3b82f6'], ['#3b82f6', '#06b6d4'],
      ['#06b6d4', '#10b981'], ['#10b981', '#f59e0b'], ['#f59e0b', '#e94560'],
    ];
    const hash = username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const pair = colors[hash % colors.length];
    return `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;
  }

  test('produces consistent gradient per username', () => {
    expect(getAvatarGradient('alice')).toBe(getAvatarGradient('alice'));
  });
});

// ============================================================
// Toast notification
// ============================================================
describe('Popup: showToast', () => {
  function showToast(message, type = 'success') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    return toast;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('creates toast element with message', () => {
    const toast = showToast('Test message');
    expect(toast.textContent).toBe('Test message');
    expect(toast.classList.contains('toast-success')).toBe(true);
  });

  test('creates error toast', () => {
    const toast = showToast('Error!', 'error');
    expect(toast.classList.contains('toast-error')).toBe(true);
  });

  test('removes existing toast before creating new one', () => {
    showToast('First');
    showToast('Second');
    const toasts = document.querySelectorAll('.toast');
    expect(toasts).toHaveLength(1);
    expect(toasts[0].textContent).toBe('Second');
  });
});
