// Mock Chrome APIs used throughout the extension
global.chrome = {
  storage: {
    local: {
      get: jest.fn((keys, callback) => {
        if (callback) callback({});
        return Promise.resolve({});
      }),
      set: jest.fn((data, callback) => {
        if (callback) callback();
        return Promise.resolve();
      }),
      remove: jest.fn((keys, callback) => {
        if (callback) callback();
        return Promise.resolve();
      }),
    },
    onChanged: {
      addListener: jest.fn(),
    },
  },
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
    },
    onInstalled: {
      addListener: jest.fn(),
    },
    onStartup: {
      addListener: jest.fn(),
    },
    getURL: jest.fn((p) => `chrome-extension://test/${p}`),
  },
  action: {
    setBadgeText: jest.fn(() => Promise.resolve()),
    setBadgeBackgroundColor: jest.fn(() => Promise.resolve()),
    openPopup: jest.fn(() => Promise.resolve()),
  },
  alarms: {
    create: jest.fn(),
    onAlarm: {
      addListener: jest.fn(),
    },
  },
  notifications: {
    create: jest.fn(),
    onClicked: {
      addListener: jest.fn(),
    },
  },
  cookies: {
    get: jest.fn(),
  },
  tabs: {
    create: jest.fn(),
  },
};

// Alias browser -> chrome so migrated `browser.*` calls hit the same mocks.
// Same object reference, so per-test mockImplementation tweaks apply to both.
global.browser = global.chrome;

// Mock fetch
global.fetch = jest.fn();

// Suppress console during tests unless debugging
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
};
