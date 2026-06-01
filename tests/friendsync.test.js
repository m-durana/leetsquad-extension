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

async function setupVerified() {
  await CloudSync.setEnabled(true);
  await CloudSync.storeToken({
    token: 'jwt.tok',
    expires_at: Date.now() + 60_000,
    username: 'alice',
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  fetch.mockReset();
  installStorageMock();
});

describe('CloudSync friend list helpers', () => {
  test('getServerFriends returns null when cloud sync is disabled', async () => {
    await CloudSync.setEnabled(false);
    const r = await CloudSync.getServerFriends();
    expect(r).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('getServerFriends returns null when not verified', async () => {
    await CloudSync.setEnabled(true);
    const r = await CloudSync.getServerFriends();
    expect(r).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('getServerFriends GETs with Bearer JWT and returns friend list', async () => {
    await setupVerified();
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ friends: ['bob', 'carol'], updated_at: 5000 }),
    });
    const r = await CloudSync.getServerFriends();
    expect(r).toEqual(['bob', 'carol']);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${CloudSync.BASE}/friends`);
    expect(init.headers.Authorization).toBe('Bearer jwt.tok');
  });

  test('getServerFriends returns null on non-OK response', async () => {
    await setupVerified();
    fetch.mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) });
    const r = await CloudSync.getServerFriends();
    expect(r).toBeNull();
  });

  test('putServerFriends PUTs JSON body and returns canonical list', async () => {
    await setupVerified();
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ friends: ['bob', 'carol'], updated_at: 1234 }),
    });
    const r = await CloudSync.putServerFriends(['carol', 'bob', 'bob']);
    expect(r).toEqual(['bob', 'carol']);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${CloudSync.BASE}/friends`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ friends: ['carol', 'bob', 'bob'] });
  });

  test('putServerFriends no-op when cloud sync is disabled', async () => {
    await CloudSync.setEnabled(false);
    const r = await CloudSync.putServerFriends(['bob']);
    expect(r).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('disconnect-then-call: both helpers refuse without re-verification', async () => {
    await setupVerified();
    await CloudSync.disconnect();
    expect(await CloudSync.getServerFriends()).toBeNull();
    expect(await CloudSync.putServerFriends(['bob'])).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('network error returns null instead of throwing', async () => {
    await setupVerified();
    fetch.mockRejectedValueOnce(new Error('boom'));
    expect(await CloudSync.getServerFriends()).toBeNull();
  });
});
