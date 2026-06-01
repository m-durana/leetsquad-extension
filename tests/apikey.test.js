require('./setup');
require('../shared');
require('../storage');
require('../cloudsync');

const CloudSync = window.CloudSync;
const StorageManager = window.StorageManager;

function installStorageMock() {
  const data = {};
  chrome.storage.local.get = jest.fn((keys, cb) => {
    const out = {};
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const k of keyList) if (k in data) out[k] = data[k];
    if (cb) cb(out);
    return Promise.resolve(out);
  });
  chrome.storage.local.set = jest.fn((obj, cb) => {
    Object.assign(data, obj);
    if (cb) cb();
    return Promise.resolve();
  });
  chrome.storage.local.remove = jest.fn((keys, cb) => {
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const k of keyList) delete data[k];
    if (cb) cb();
    return Promise.resolve();
  });
  return data;
}

beforeEach(() => {
  jest.clearAllMocks();
  fetch.mockReset();
  installStorageMock();
});

describe('CloudSync API key storage', () => {
  test('getApiKey returns null when not set', async () => {
    expect(await CloudSync.getApiKey()).toBeNull();
  });

  test('storeToken persists api_key when present in verify response', async () => {
    await CloudSync.storeToken({
      token: 'jwt.tok',
      expires_at: Date.now() + 60_000,
      username: 'alice',
      api_key: 'ls_pk_ABCDEFGHIJKLMN',
    });
    expect(await CloudSync.getApiKey()).toBe('ls_pk_ABCDEFGHIJKLMN');
  });

  test('storeToken without api_key leaves any prior key untouched', async () => {
    await CloudSync.setApiKey('ls_pk_OLD');
    await CloudSync.storeToken({
      token: 'jwt.tok',
      expires_at: Date.now() + 60_000,
      username: 'bob',
    });
    expect(await CloudSync.getApiKey()).toBe('ls_pk_OLD');
  });

  test('setApiKey(null) clears the key', async () => {
    await CloudSync.setApiKey('ls_pk_X');
    await CloudSync.setApiKey(null);
    expect(await CloudSync.getApiKey()).toBeNull();
  });

  test('disconnect clears the API key alongside token + enabled flag', async () => {
    await CloudSync.setEnabled(true);
    await CloudSync.storeToken({
      token: 'tk',
      expires_at: Date.now() + 60_000,
      username: 'carol',
      api_key: 'ls_pk_CAROLKEY',
    });
    await CloudSync.disconnect();
    const s = await CloudSync.getStatus();
    expect(s.enabled).toBe(false);
    expect(s.verified).toBe(false);
    expect(await CloudSync.getApiKey()).toBeNull();
  });

  test('storage key uses the documented constant', () => {
    expect(StorageManager.KEYS.CLOUD_SYNC_API_KEY).toBe('leetsquad_cloud_sync_api_key');
  });
});
