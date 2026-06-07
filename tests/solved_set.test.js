require('./setup');
require('../shared');
require('../storage');

const SM = window.StorageManager;

// Build an in-memory chrome.storage.local that the StorageManager can drive
// like the real thing, so we can test merge/read semantics end-to-end.
function installFakeStorage() {
  const backing = {};
  chrome.storage.local.get.mockImplementation((keys, cb) => {
    const out = {};
    const arr = Array.isArray(keys) ? keys : [keys];
    for (const k of arr) if (k in backing) out[k] = backing[k];
    if (cb) cb(out);
    return Promise.resolve(out);
  });
  chrome.storage.local.set.mockImplementation((data, cb) => {
    Object.assign(backing, data);
    if (cb) cb();
    return Promise.resolve();
  });
  chrome.storage.local.remove.mockImplementation((keys, cb) => {
    const arr = Array.isArray(keys) ? keys : [keys];
    for (const k of arr) delete backing[k];
    if (cb) cb();
    return Promise.resolve();
  });
  return backing;
}

describe('Solved-slug set: merge semantics', () => {
  let backing;
  beforeEach(() => {
    jest.clearAllMocks();
    backing = installFakeStorage();
  });

  test('starts empty for a brand-new user', async () => {
    const set = await SM.getSolvedSet('alice');
    expect(set).toEqual({ slugs: {}, lastRefreshed: 0 });
    expect(await SM.getSolvedCount('alice')).toBe(0);
    expect(await SM.hasSolvedSlug('alice', 'two-sum')).toBe(false);
  });

  test('mergeSolvedSlugs adds entries and bumps lastRefreshed', async () => {
    const before = Date.now() - 1;
    await SM.mergeSolvedSlugs('alice', [
      { titleSlug: 'two-sum', timestamp: 100 },
      { titleSlug: 'add-two-numbers', timestamp: 200 },
    ]);
    const set = await SM.getSolvedSet('alice');
    expect(set.slugs['two-sum']).toBe(100);
    expect(set.slugs['add-two-numbers']).toBe(200);
    expect(set.lastRefreshed).toBeGreaterThan(before);
    expect(await SM.getSolvedCount('alice')).toBe(2);
    expect(await SM.hasSolvedSlug('alice', 'two-sum')).toBe(true);
  });

  test('subsequent merges union; never lose previously known slugs', async () => {
    await SM.mergeSolvedSlugs('alice', [{ titleSlug: 'two-sum', timestamp: 100 }]);
    await SM.mergeSolvedSlugs('alice', [{ titleSlug: 'add-two-numbers', timestamp: 200 }]);
    await SM.mergeSolvedSlugs('alice', [{ titleSlug: 'reverse-integer', timestamp: 300 }]);
    expect(await SM.getSolvedCount('alice')).toBe(3);
    expect(await SM.hasSolvedSlug('alice', 'two-sum')).toBe(true);
  });

  test('keeps the LATER timestamp when the same slug reappears', async () => {
    await SM.mergeSolvedSlugs('alice', [{ titleSlug: 'two-sum', timestamp: 100 }]);
    await SM.mergeSolvedSlugs('alice', [{ titleSlug: 'two-sum', timestamp: 500 }]);
    await SM.mergeSolvedSlugs('alice', [{ titleSlug: 'two-sum', timestamp: 200 }]);
    expect(await SM.getSolvedSlugTimestamp('alice', 'two-sum')).toBe(500);
  });

  test('different users are isolated', async () => {
    await SM.mergeSolvedSlugs('alice', [{ titleSlug: 'two-sum', timestamp: 100 }]);
    await SM.mergeSolvedSlugs('bob',   [{ titleSlug: 'reverse-integer', timestamp: 100 }]);
    expect(await SM.hasSolvedSlug('alice', 'two-sum')).toBe(true);
    expect(await SM.hasSolvedSlug('alice', 'reverse-integer')).toBe(false);
    expect(await SM.hasSolvedSlug('bob', 'two-sum')).toBe(false);
    expect(await SM.hasSolvedSlug('bob', 'reverse-integer')).toBe(true);
  });

  test('clearSolvedSet drops only the named user', async () => {
    await SM.mergeSolvedSlugs('alice', [{ titleSlug: 'two-sum', timestamp: 1 }]);
    await SM.mergeSolvedSlugs('bob',   [{ titleSlug: 'two-sum', timestamp: 1 }]);
    await SM.clearSolvedSet('alice');
    expect(await SM.getSolvedCount('alice')).toBe(0);
    expect(await SM.getSolvedCount('bob')).toBe(1);
  });

  test('ignores entries without a titleSlug', async () => {
    await SM.mergeSolvedSlugs('alice', [
      { timestamp: 100 },
      { titleSlug: '', timestamp: 200 },
      { titleSlug: 'two-sum', timestamp: 300 },
    ]);
    expect(await SM.getSolvedCount('alice')).toBe(1);
  });

  test('no-op when called with empty array or null', async () => {
    await SM.mergeSolvedSlugs('alice', []);
    await SM.mergeSolvedSlugs('alice', null);
    expect(await SM.getSolvedCount('alice')).toBe(0);
  });

  test('mergeSolvedSlugs persists id + lang + rt + mem per slug', async () => {
    await SM.mergeSolvedSlugs('alice', [
      { titleSlug: 'two-sum', timestamp: 100, id: 'sub-1', lang: 'cpp', rt: '5 ms', mem: '8 MB' },
    ]);
    expect(await SM.getSubmissionId('alice', 'two-sum')).toBe('sub-1');
    expect(await SM.getSubmissionMeta('alice', 'two-sum')).toEqual({
      lang: 'cpp', rt: '5 ms', mem: '8 MB',
    });
  });

  test('mergeSolvedSlugs preserves prior meta when new entry omits those fields', async () => {
    await SM.mergeSolvedSlugs('alice', [
      { titleSlug: 'two-sum', timestamp: 100, id: 'sub-1', lang: 'cpp', rt: '5 ms', mem: '8 MB' },
    ]);
    await SM.mergeSolvedSlugs('alice', [
      { titleSlug: 'two-sum', timestamp: 200 },
    ]);
    expect(await SM.getSubmissionId('alice', 'two-sum')).toBe('sub-1');
    expect(await SM.getSubmissionMeta('alice', 'two-sum')).toEqual({
      lang: 'cpp', rt: '5 ms', mem: '8 MB',
    });
    expect(await SM.getSolvedSlugTimestamp('alice', 'two-sum')).toBe(200);
  });

  test('mergeSolvedSlugs overwrites meta when new entry sends non-empty fields', async () => {
    await SM.mergeSolvedSlugs('alice', [
      { titleSlug: 'two-sum', id: 'old', lang: 'java', rt: '10 ms' },
    ]);
    await SM.mergeSolvedSlugs('alice', [
      { titleSlug: 'two-sum', id: 'new', lang: 'cpp', rt: '5 ms' },
    ]);
    expect(await SM.getSubmissionId('alice', 'two-sum')).toBe('new');
    expect(await SM.getSubmissionMeta('alice', 'two-sum')).toEqual({
      lang: 'cpp', rt: '5 ms',
    });
  });
});
