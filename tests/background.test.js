require('./setup');

// The background script registers listeners at load time, so we capture them
let alarmHandler;
let messageHandler;
let notificationClickHandler;
let installedHandler;

chrome.alarms.onAlarm.addListener.mockImplementation(fn => { alarmHandler = fn; });
chrome.runtime.onMessage.addListener.mockImplementation(fn => { messageHandler = fn; });
chrome.notifications.onClicked.addListener.mockImplementation(fn => { notificationClickHandler = fn; });
chrome.runtime.onInstalled.addListener.mockImplementation(fn => { installedHandler = fn; });

require('../background');

let mockStore = {};

beforeEach(() => {
  jest.clearAllMocks();
  mockStore = {};

  chrome.storage.local.get.mockImplementation((keys, callback) => {
    if (typeof keys === 'object' && !Array.isArray(keys)) {
      const result = {};
      for (const k of Object.keys(keys)) {
        result[k] = mockStore[k] !== undefined ? mockStore[k] : keys[k];
      }
      if (callback) callback(result);
      return Promise.resolve(result);
    }
    const result = {};
    const keyArr = Array.isArray(keys) ? keys : [keys];
    keyArr.forEach(k => {
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
});

// Helper: mock a GraphQL response from LeetCode
function mockGraphQLResponse(data) {
  return {
    ok: true,
    json: () => Promise.resolve({ data }),
  };
}

// ============================================================
// Installation
// ============================================================
describe('Background: onInstalled', () => {
  test('registers alarms on install', () => {
    installedHandler();
    expect(chrome.alarms.create).toHaveBeenCalledWith('checkUpdates', { periodInMinutes: 30 });
    expect(chrome.alarms.create).toHaveBeenCalledWith('dailyReset', expect.objectContaining({
      periodInMinutes: 1440,
    }));
  });
});

// ============================================================
// Alarm: checkUpdates
// ============================================================
describe('Background: checkUpdates alarm', () => {
  test('does nothing when notifications are disabled', async () => {
    mockStore.leetsquad_friends = ['alice'];
    mockStore.leetsquad_settings = { notifications: false };

    await alarmHandler({ name: 'checkUpdates' });
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test('does nothing when friends list is empty', async () => {
    mockStore.leetsquad_friends = [];
    mockStore.leetsquad_settings = { notifications: true };

    await alarmHandler({ name: 'checkUpdates' });
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test('sends notification for new accepted submissions', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockStore.leetsquad_friends = ['alice'];
    mockStore.leetsquad_settings = { notifications: true };
    mockStore.leetsquad_last_check = (now - 3600) * 1000; // 1 hour ago

    // GraphQL response format
    fetch.mockResolvedValueOnce(mockGraphQLResponse({
      recentSubmissionList: [
        { title: 'Two Sum', statusDisplay: 'Accepted', timestamp: now - 60 },
      ],
    }));

    await alarmHandler({ name: 'checkUpdates' });
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      expect.stringContaining('leetsquad-'),
      expect.objectContaining({
        type: 'basic',
        title: 'LeetSquad Update',
        message: expect.stringContaining('alice'),
      })
    );
  });

  test('groups multiple submissions per user in notification', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockStore.leetsquad_friends = ['bob'];
    mockStore.leetsquad_settings = { notifications: true };
    mockStore.leetsquad_last_check = (now - 3600) * 1000;

    fetch.mockResolvedValueOnce(mockGraphQLResponse({
      recentSubmissionList: [
        { title: 'Two Sum', statusDisplay: 'Accepted', timestamp: now - 30 },
        { title: 'Three Sum', statusDisplay: 'Accepted', timestamp: now - 60 },
      ],
    }));

    await alarmHandler({ name: 'checkUpdates' });
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        message: expect.stringContaining('2 problems'),
      })
    );
  });

  test('ignores non-accepted submissions', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockStore.leetsquad_friends = ['alice'];
    mockStore.leetsquad_settings = { notifications: true };
    mockStore.leetsquad_last_check = (now - 3600) * 1000;

    fetch.mockResolvedValueOnce(mockGraphQLResponse({
      recentSubmissionList: [
        { title: 'Hard Problem', statusDisplay: 'Wrong Answer', timestamp: now - 30 },
      ],
    }));

    await alarmHandler({ name: 'checkUpdates' });
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  test('updates leetsquad_last_check timestamp', async () => {
    mockStore.leetsquad_friends = ['alice'];
    mockStore.leetsquad_settings = { notifications: true };

    fetch.mockResolvedValueOnce(mockGraphQLResponse({
      recentSubmissionList: [],
    }));

    await alarmHandler({ name: 'checkUpdates' });
    expect(mockStore.leetsquad_last_check).toBeDefined();
    expect(typeof mockStore.leetsquad_last_check).toBe('number');
  });

  test('handles API errors gracefully per friend', async () => {
    mockStore.leetsquad_friends = ['alice', 'bob'];
    mockStore.leetsquad_settings = { notifications: true };
    mockStore.leetsquad_last_check = 0;

    // alice fails (all retries), bob succeeds
    fetch
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('network retry 1'))
      .mockRejectedValueOnce(new Error('network retry 2'))
      .mockResolvedValueOnce(mockGraphQLResponse({
        recentSubmissionList: [],
      }));

    await expect(alarmHandler({ name: 'checkUpdates' })).resolves.not.toThrow();
  }, 30000);
});

// ============================================================
// Alarm: dailyReset
// ============================================================
describe('Background: dailyReset alarm', () => {
  test('logs daily reset message', async () => {
    await alarmHandler({ name: 'dailyReset' });
    expect(console.log).toHaveBeenCalledWith('Daily reset triggered');
  });
});

// ============================================================
// Message handling
// ============================================================
describe('Background: message handler', () => {
  test('handles checkUpdates action', () => {
    const sendResponse = jest.fn();
    fetch.mockResolvedValue(mockGraphQLResponse({ recentSubmissionList: [] }));

    const result = messageHandler(
      { action: 'checkUpdates' },
      {},
      sendResponse
    );
    expect(result).toBe(true); // async response
  });

  test('handles getUserData action', () => {
    const sendResponse = jest.fn();
    fetch.mockResolvedValueOnce(mockGraphQLResponse({
      matchedUser: {
        username: 'testuser',
        profile: { userAvatar: null, ranking: 1000 },
        submitStats: { acSubmissionNum: [] },
      },
    }));

    const result = messageHandler(
      { action: 'getUserData', username: 'testuser' },
      {},
      sendResponse
    );
    expect(result).toBe(true);
  });

  test('handles problemSolved action', () => {
    const sendResponse = jest.fn();
    mockStore.leetsquad_daily_goals = {};

    const result = messageHandler(
      { action: 'problemSolved', problemSlug: 'two-sum', difficulty: 'easy' },
      {},
      sendResponse
    );
    expect(result).toBe(true);
  });
});

// ============================================================
// Notification clicks
// ============================================================
describe('Background: notification clicks', () => {
  test('opens LeetCode problemset on notification click', () => {
    notificationClickHandler('leetsquad-12345');
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://leetcode.com/problemset/',
    });
  });

  test('ignores non-leetsquad notification clicks', () => {
    notificationClickHandler('other-notification');
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
});
