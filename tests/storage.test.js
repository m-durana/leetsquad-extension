require('./setup');
require('../storage');

const SM = window.StorageManager;

// In-memory storage mock
let mockStore = {};

beforeEach(() => {
  jest.clearAllMocks();
  mockStore = {};

  chrome.storage.local.get.mockImplementation((keys, callback) => {
    const result = {};
    keys.forEach(k => {
      if (mockStore[k] !== undefined) result[k] = mockStore[k];
    });
    if (callback) callback(result);
    return Promise.resolve(result);
  });

  chrome.storage.local.set.mockImplementation((data, callback) => {
    Object.assign(mockStore, data);
    if (callback) callback();
    return Promise.resolve();
  });

  chrome.storage.local.remove.mockImplementation((keys, callback) => {
    keys.forEach(k => delete mockStore[k]);
    if (callback) callback();
    return Promise.resolve();
  });
});

// ============================================================
// Basic storage operations
// ============================================================
describe('StorageManager basic operations', () => {
  test('get returns null for missing key', async () => {
    const result = await SM.get('nonexistent');
    expect(result).toBeNull();
  });

  test('set and get round-trip', async () => {
    await SM.set('test_key', { value: 42 });
    const result = await SM.get('test_key');
    expect(result).toEqual({ value: 42 });
  });

  test('remove deletes a key', async () => {
    await SM.set('test_key', 'hello');
    await SM.remove('test_key');
    const result = await SM.get('test_key');
    expect(result).toBeNull();
  });
});

// ============================================================
// Friends management
// ============================================================
describe('StorageManager friends', () => {
  test('getFriends returns empty array initially', async () => {
    const friends = await SM.getFriends();
    expect(friends).toEqual([]);
  });

  test('addFriend adds a username to the list', async () => {
    const result = await SM.addFriend('alice');
    expect(result).toContain('alice');
  });

  test('addFriend prevents duplicates', async () => {
    await SM.addFriend('alice');
    const result = await SM.addFriend('alice');
    expect(result.filter(f => f === 'alice')).toHaveLength(1);
  });

  test('addFriend allows multiple distinct friends', async () => {
    await SM.addFriend('alice');
    const result = await SM.addFriend('bob');
    expect(result).toEqual(['alice', 'bob']);
  });

  test('removeFriend removes a specific friend', async () => {
    await SM.addFriend('alice');
    await SM.addFriend('bob');
    const result = await SM.removeFriend('alice');
    expect(result).toEqual(['bob']);
  });

  test('removeFriend is a no-op for non-existent friend', async () => {
    await SM.addFriend('alice');
    const result = await SM.removeFriend('charlie');
    expect(result).toEqual(['alice']);
  });
});

// ============================================================
// My username
// ============================================================
describe('StorageManager username', () => {
  test('getMyUsername returns null initially', async () => {
    const username = await SM.getMyUsername();
    expect(username).toBeNull();
  });

  test('setMyUsername and getMyUsername round-trip', async () => {
    await SM.setMyUsername('myuser');
    const username = await SM.getMyUsername();
    expect(username).toBe('myuser');
  });
});

// ============================================================
// Cache management
// ============================================================
describe('StorageManager cache', () => {
  test('getCachedData returns null for missing user', async () => {
    const result = await SM.getCachedData('unknown');
    expect(result).toBeNull();
  });

  test('setCachedData and getCachedData round-trip', async () => {
    const data = { profile: { ranking: 100 }, fetchedAt: Date.now() };
    await SM.setCachedData('testuser', data);
    const result = await SM.getCachedData('testuser');
    expect(result).not.toBeNull();
    expect(result.profile.ranking).toBe(100);
  });

  test('getCachedData returns null for expired cache', async () => {
    const data = { profile: {}, fetchedAt: Date.now() - 31 * 60 * 1000 }; // 31 min ago
    await SM.setCachedData('testuser', data);

    // Override fetchedAt to simulate old cache
    const cache = mockStore[SM.KEYS.CACHE];
    const key = Object.keys(cache).find(k => k.startsWith('testuser'));
    cache[key].fetchedAt = Date.now() - 31 * 60 * 1000;
    mockStore[SM.KEYS.CACHE] = cache;

    const result = await SM.getCachedData('testuser');
    expect(result).toBeNull();
  });

  test('setCachedData supports type parameter for namespaced keys', async () => {
    await SM.setCachedData('testuser', { profile: {} }, 'profile');
    await SM.setCachedData('testuser', { solved: {} }, 'solved');

    const profile = await SM.getCachedData('testuser', 'profile');
    const solved = await SM.getCachedData('testuser', 'solved');
    expect(profile).not.toBeNull();
    expect(solved).not.toBeNull();
  });

  test('invalidateCache removes all entries for a user', async () => {
    await SM.setCachedData('testuser', { profile: {} }, 'profile');
    await SM.setCachedData('testuser', { solved: {} }, 'solved');
    await SM.invalidateCache('testuser');

    expect(await SM.getCachedData('testuser', 'profile')).toBeNull();
    expect(await SM.getCachedData('testuser', 'solved')).toBeNull();
  });

  test('invalidateCache with type removes only that type', async () => {
    await SM.setCachedData('testuser', { profile: {} }, 'profile');
    await SM.setCachedData('testuser', { solved: {} }, 'solved');
    await SM.invalidateCache('testuser', 'profile');

    expect(await SM.getCachedData('testuser', 'profile')).toBeNull();
    expect(await SM.getCachedData('testuser', 'solved')).not.toBeNull();
  });

  test('clearCache removes all cached data', async () => {
    await SM.setCachedData('user1', { profile: {} });
    await SM.setCachedData('user2', { profile: {} });
    await SM.clearCache();

    const r1 = await SM.getCachedData('user1');
    const r2 = await SM.getCachedData('user2');
    expect(r1).toBeNull();
    expect(r2).toBeNull();
  });

  test('getCachedDataWithStale returns fresh data with stale:false', async () => {
    await SM.setCachedData('stale_test', { profile: { ranking: 42 } });
    const result = await SM.getCachedDataWithStale('stale_test');
    expect(result).not.toBeNull();
    expect(result.stale).toBe(false);
    expect(result.data.profile.ranking).toBe(42);
  });

  test('getCachedDataWithStale returns expired data with stale:true', async () => {
    await SM.setCachedData('stale_test2', { profile: {} });

    // Override fetchedAt to simulate old cache
    const cache = mockStore[SM.KEYS.CACHE];
    const key = Object.keys(cache).find(k => k.startsWith('stale_test2'));
    cache[key].fetchedAt = Date.now() - 31 * 60 * 1000;
    mockStore[SM.KEYS.CACHE] = cache;

    const result = await SM.getCachedDataWithStale('stale_test2');
    expect(result).not.toBeNull();
    expect(result.stale).toBe(true);
    expect(result.data).toBeDefined();
  });

  test('getCachedDataWithStale returns null for missing user', async () => {
    const result = await SM.getCachedDataWithStale('nonexistent_stale');
    expect(result).toBeNull();
  });
});

// ============================================================
// Settings
// ============================================================
describe('StorageManager settings', () => {
  test('getSettings returns defaults when no settings saved', async () => {
    const settings = await SM.getSettings();
    expect(settings.showOnProblemPage).toBe(true);
    expect(settings.notifications).toBe(true);
    expect(settings.debugMode).toBe(false);
    expect(settings.widgetDisplayMode).toBe('minimized');
    expect(settings.theme).toBe('dark');
  });

  test('updateSettings merges partial updates', async () => {
    await SM.updateSettings({ debugMode: true });
    const settings = await SM.getSettings();
    expect(settings.debugMode).toBe(true);
    expect(settings.showOnProblemPage).toBe(true); // unchanged default
  });

  test('updateSettings overwrites existing values', async () => {
    await SM.updateSettings({ notifications: false });
    const settings = await SM.getSettings();
    expect(settings.notifications).toBe(false);
  });
});

// ============================================================
// Daily goals
// ============================================================
describe('StorageManager daily goals', () => {
  test('getDailyGoals returns default goal for today', async () => {
    const goal = await SM.getDailyGoals();
    expect(goal.target).toBe(3);
    expect(goal.completed).toBe(0);
    expect(goal.problems).toEqual([]);
    expect(goal.streak).toBe(0);
  });

  test('updateDailyGoal increments completion', async () => {
    const result = await SM.updateDailyGoal('two-sum', 'Easy');
    expect(result.completed).toBe(1);
    expect(result.problems).toContain('two-sum');
  });

  test('updateDailyGoal does not double-count same problem', async () => {
    await SM.updateDailyGoal('two-sum', 'Easy');
    const result = await SM.updateDailyGoal('two-sum', 'Easy');
    expect(result.completed).toBe(1);
  });

  test('updateDailyGoal counts distinct problems', async () => {
    await SM.updateDailyGoal('two-sum', 'Easy');
    const result = await SM.updateDailyGoal('three-sum', 'Medium');
    expect(result.completed).toBe(2);
    expect(result.problems).toEqual(['two-sum', 'three-sum']);
  });

  test('setDailyTarget updates target for today', async () => {
    const result = await SM.setDailyTarget(5);
    expect(result.target).toBe(5);
  });

  test('setDailyTarget preserves existing completions', async () => {
    await SM.updateDailyGoal('two-sum', 'Easy');
    const result = await SM.setDailyTarget(10);
    expect(result.target).toBe(10);
    expect(result.completed).toBe(1);
  });
});

// ============================================================
// Streak calculation
// ============================================================
describe('StorageManager.calculateStreak', () => {
  test('returns 0 when no goals exist', () => {
    const streak = SM.calculateStreak({}, '2025-01-15');
    expect(streak).toBe(0);
  });

  test('returns 1 when only today has completions', () => {
    const goals = {
      '2025-01-15': { target: 3, completed: 2, problems: ['a', 'b'] },
    };
    const streak = SM.calculateStreak(goals, '2025-01-15');
    expect(streak).toBe(1);
  });

  test('returns correct streak for consecutive days', () => {
    const goals = {
      '2025-01-15': { target: 3, completed: 1, problems: ['a'] },
      '2025-01-14': { target: 3, completed: 2, problems: ['b', 'c'] },
      '2025-01-13': { target: 3, completed: 1, problems: ['d'] },
    };
    const streak = SM.calculateStreak(goals, '2025-01-15');
    expect(streak).toBe(3);
  });

  test('breaks streak on day with zero completions', () => {
    const goals = {
      '2025-01-15': { target: 3, completed: 1, problems: ['a'] },
      '2025-01-14': { target: 3, completed: 0, problems: [] },
      '2025-01-13': { target: 3, completed: 5, problems: ['x'] },
    };
    const streak = SM.calculateStreak(goals, '2025-01-15');
    expect(streak).toBe(1);
  });

  test('breaks streak on missing day', () => {
    const goals = {
      '2025-01-15': { target: 3, completed: 1, problems: ['a'] },
      // 14 missing
      '2025-01-13': { target: 3, completed: 1, problems: ['b'] },
    };
    const streak = SM.calculateStreak(goals, '2025-01-15');
    expect(streak).toBe(1);
  });
});

// ============================================================
// Challenges
// ============================================================
describe('StorageManager challenges', () => {
  test('getChallenges returns empty array initially', async () => {
    const challenges = await SM.getChallenges();
    expect(challenges).toEqual([]);
  });

  test('addChallenge adds with auto-generated id and timestamp', async () => {
    const result = await SM.addChallenge({ name: 'Solve 5 hards' });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Solve 5 hards');
    expect(result[0].id).toBeDefined();
    expect(result[0].createdAt).toBeDefined();
  });

  test('removeChallenge removes by id', async () => {
    const added = await SM.addChallenge({ name: 'Test' });
    const id = added[0].id;
    const result = await SM.removeChallenge(id);
    expect(result).toEqual([]);
  });
});

// ============================================================
// Activity log
// ============================================================
describe('StorageManager activity log', () => {
  test('getActivityLog returns empty array initially', async () => {
    const log = await SM.getActivityLog();
    expect(log).toEqual([]);
  });

  test('addActivity prepends to the log with timestamp', async () => {
    await SM.addActivity({ username: 'alice', problem: 'two-sum' });
    const log = await SM.getActivityLog();
    expect(log).toHaveLength(1);
    expect(log[0].username).toBe('alice');
    expect(log[0].timestamp).toBeDefined();
  });

  test('getActivityLog respects limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await SM.addActivity({ index: i });
    }
    const log = await SM.getActivityLog(3);
    expect(log).toHaveLength(3);
  });

  test('activity log is capped at 200 entries', async () => {
    // Simulate 205 activities
    const log = [];
    for (let i = 0; i < 205; i++) {
      log.unshift({ index: i, timestamp: Date.now() });
    }
    mockStore[SM.KEYS.ACTIVITY_LOG] = log;

    await SM.addActivity({ index: 999 });
    const stored = mockStore[SM.KEYS.ACTIVITY_LOG];
    expect(stored.length).toBeLessThanOrEqual(200);
  });
});
