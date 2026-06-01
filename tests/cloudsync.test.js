require('./setup');
require('../shared');
require('../storage');
require('../cloudsync');

const CloudSync = window.CloudSync;
const StorageManager = window.StorageManager;

// Simple in-memory chrome.storage.local backing for these tests
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

describe('CloudSync.startAuth', () => {
  test('POSTs username and returns nonce', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ nonce: 'leetsquad-verify-abc', expires_at: Date.now() + 600_000 }),
    });
    const r = await CloudSync.startAuth('akutasan');
    expect(r.nonce).toBe('leetsquad-verify-abc');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${CloudSync.BASE}/auth/start`);
    expect(JSON.parse(init.body)).toEqual({ lc_username: 'akutasan' });
  });

  test('throws on non-OK response', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 400, json: () => Promise.resolve({}) });
    await expect(CloudSync.startAuth('bad name')).rejects.toThrow(/auth\/start failed/);
  });
});

describe('CloudSync.verifyAuth', () => {
  test('returns token on success', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: 'jwt.token.here', expires_at: 9999 }),
    });
    const r = await CloudSync.verifyAuth('alice');
    expect(r.token).toBe('jwt.token.here');
  });

  test('throws with structured error on 403', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: 'nonce_not_found_in_bio' }),
    });
    await expect(CloudSync.verifyAuth('bob')).rejects.toMatchObject({ code: 'nonce_not_found_in_bio' });
  });
});

describe('CloudSync.getStatus + storeToken + clearToken', () => {
  test('fresh install: enabled (default-on), unverified', async () => {
    const s = await CloudSync.getStatus();
    expect(s.enabled).toBe(true);
    expect(s.verified).toBe(false);
  });

  test('storeToken + setEnabled produces verified=true while exp in future', async () => {
    await CloudSync.setEnabled(true);
    await CloudSync.storeToken({
      token: 'tok',
      expires_at: Date.now() + 60_000,
      username: 'carol',
    });
    const s = await CloudSync.getStatus();
    expect(s.enabled).toBe(true);
    expect(s.verified).toBe(true);
    expect(s.username).toBe('carol');
  });

  test('expired token surfaces tokenExpired=true and verified=false', async () => {
    await CloudSync.setEnabled(true);
    await CloudSync.storeToken({
      token: 'tok',
      expires_at: Date.now() - 1000,
      username: 'dave',
    });
    const s = await CloudSync.getStatus();
    expect(s.verified).toBe(false);
    expect(s.tokenExpired).toBe(true);
  });

  test('clearToken wipes username + token', async () => {
    await CloudSync.storeToken({ token: 't', expires_at: Date.now() + 1000, username: 'eve' });
    await CloudSync.clearToken();
    const s = await CloudSync.getStatus();
    expect(s.username).toBeNull();
    expect(s.verified).toBe(false);
  });
});

describe('CloudSync.BASE', () => {
  test('is a valid origin url', () => {
    expect(CloudSync.BASE).toMatch(/^https?:\/\/[^/]+$/);
  });
});

describe('CloudSync.fetchAndMergeFriend', () => {
  test('merges returned slugs into local store', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ slugs: ['two-sum', 'add-two-numbers'], updated_at: 555 }),
    });
    const r = await CloudSync.fetchAndMergeFriend('carol');
    expect(r.ok).toBe(true);
    expect(r.count).toBe(2);
    const set = await StorageManager.getSolvedSet('carol');
    expect(Object.keys(set.slugs).sort()).toEqual(['add-two-numbers', 'two-sum']);
    const [url] = fetch.mock.calls[0];
    expect(url).toBe(`${CloudSync.BASE}/user/carol`);
  });

  test('404 returns not_found without merging', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({}) });
    const r = await CloudSync.fetchAndMergeFriend('ghost');
    expect(r.error).toBe('not_found');
    const set = await StorageManager.getSolvedSet('ghost');
    expect(Object.keys(set.slugs)).toEqual([]);
  });

  test('url-encodes username', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ slugs: [], updated_at: 0 }),
    });
    await CloudSync.fetchAndMergeFriend('weird user');
    expect(fetch.mock.calls[0][0]).toBe(`${CloudSync.BASE}/user/weird%20user`);
  });
});

describe('CloudSync.disconnect', () => {
  test('clears local token + enabled flag without calling the server', async () => {
    await CloudSync.setEnabled(true);
    await CloudSync.storeToken({ token: 'tk', expires_at: Date.now() + 60_000, username: 'dee' });
    await CloudSync.disconnect();
    expect(fetch).not.toHaveBeenCalled();
    const s = await CloudSync.getStatus();
    expect(s.enabled).toBe(false);
    expect(s.verified).toBe(false);
    expect(s.username).toBeNull();
  });
});

describe('CloudSync.getStatus default-on behaviour', () => {
  test('enabled defaults to true when never written', async () => {
    const s = await CloudSync.getStatus();
    expect(s.enabled).toBe(true);
  });

  test('explicit false opts out', async () => {
    await CloudSync.setEnabled(false);
    const s = await CloudSync.getStatus();
    expect(s.enabled).toBe(false);
  });
});
