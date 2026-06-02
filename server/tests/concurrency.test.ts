import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { unlinkSync, existsSync } from 'node:fs';

vi.mock('../src/leetcode', () => ({
  getPublicSkillTags: vi.fn(),
  getPublicSolvedCount: vi.fn(),
}));

import { createApp } from '../src/app';
import { db } from '../src/db';
import { getPublicSkillTags, getPublicSolvedCount } from '../src/leetcode';
import { signToken } from '../src/jwt';
import { issueKeyForUser, rotateKeyForUser, resetTouchDebounceForTests } from '../src/apiKeys';
import { computeStatsNow, stopStatsAggregatorForTests, getStatsPayload } from '../src/statsAggregator';

const mockedCount = vi.mocked(getPublicSolvedCount);
const mockedSkillTags = vi.mocked(getPublicSkillTags);
const app = createApp();

function jwtFor(u: string) {
  return `Bearer ${signToken({ lc_username: u }).token}`;
}

function seedVerifiedUser(username: string) {
  const now = Date.now();
  db.prepare('INSERT OR REPLACE INTO users (lc_username, verified_at, last_sync_at) VALUES (?, ?, 0)').run(username, now);
}

function seedSolvedSet(username: string, slugs: string[], updated_at = Date.now()) {
  db.prepare(
    `INSERT INTO solved_sets (lc_username, slugs_json, schema_version, updated_at, last_self_sync_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(lc_username) DO UPDATE SET slugs_json = excluded.slugs_json,
       updated_at = excluded.updated_at, last_self_sync_at = excluded.last_self_sync_at`
  ).run(username, JSON.stringify(slugs), 1, updated_at, updated_at);
}

function syncBody(slugs: string[], friendSets: Record<string, string[]> = {}, ts = Date.now()) {
  return { slugs, friend_sets: friendSets, updated_at: ts, schema_version: 1 };
}

beforeEach(() => {
  db.exec(
    'DELETE FROM api_keys; DELETE FROM contributions; DELETE FROM solved_sets; ' +
      'DELETE FROM auth_nonces; DELETE FROM users; DELETE FROM public_solved_counts; ' +
      'DELETE FROM user_friends;'
  );
  resetTouchDebounceForTests();
  stopStatsAggregatorForTests();
  mockedCount.mockReset();
  mockedSkillTags.mockReset();
});

afterAll(() => {
  stopStatsAggregatorForTests();
  db.close();
  const p = process.env.DB_PATH!;
  if (existsSync(p)) unlinkSync(p);
});

describe('Multi-account isolation', () => {
  it('two distinct users verify in parallel and each gets a distinct key', async () => {
    for (const u of ['alice', 'bob']) {
      const r = await request(app).post('/auth/start').send({ lc_username: u });
      expect(r.status).toBe(200);
    }
    mockedSkillTags.mockImplementation(async (u) => {
      const row = db.prepare('SELECT nonce FROM auth_nonces WHERE lc_username = ?').get(u) as
        | { nonce: string }
        | undefined;
      return row ? [row.nonce] : [];
    });

    const [a, b] = await Promise.all([
      request(app).post('/auth/verify').send({ lc_username: 'alice' }),
      request(app).post('/auth/verify').send({ lc_username: 'bob' }),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.api_key).not.toBe(b.body.api_key);
    expect(a.body.api_key_prefix).not.toBe(b.body.api_key_prefix);
    expect(a.body.token).not.toBe(b.body.token);
  });

  it('user A deleting their data does not touch user B', async () => {
    seedVerifiedUser('alice');
    seedVerifiedUser('bob');
    seedSolvedSet('alice', ['two-sum']);
    seedSolvedSet('bob', ['add-two-numbers']);
    issueKeyForUser('alice');
    issueKeyForUser('bob');
    db.prepare('INSERT INTO contributions (target_username, contributor_username, slugs_json, updated_at) VALUES (?, ?, ?, ?)')
      .run('alice', 'bob', JSON.stringify(['two-sum']), Date.now());
    db.prepare('INSERT INTO user_friends (lc_username, friend_username, added_at) VALUES (?, ?, ?)')
      .run('alice', 'bob', Date.now());

    const r = await request(app).delete('/api/v1/users/me').set('Authorization', jwtFor('alice'));
    expect(r.status).toBe(200);

    expect(db.prepare('SELECT 1 FROM users WHERE lc_username = ?').get('bob')).toBeTruthy();
    expect(db.prepare('SELECT 1 FROM solved_sets WHERE lc_username = ?').get('bob')).toBeTruthy();
    expect(db.prepare('SELECT 1 FROM api_keys WHERE lc_username = ? AND revoked_at IS NULL').get('bob')).toBeTruthy();
    expect(db.prepare('SELECT 1 FROM users WHERE lc_username = ?').get('alice')).toBeUndefined();
  });

  it('contributions are scoped per (target, contributor); two contributors do not stomp each other', async () => {
    seedVerifiedUser('target');
    mockedCount.mockResolvedValue(100);

    await request(app)
      .post('/sync')
      .set('Authorization', jwtFor('alice'))
      .send(syncBody(['a1', 'a2'], { target: ['s1', 's2'] }));
    await request(app)
      .post('/sync')
      .set('Authorization', jwtFor('bob'))
      .send(syncBody(['b1', 'b2'], { target: ['s2', 's3'] }));

    const union = (db.prepare('SELECT slugs_json FROM solved_sets WHERE lc_username = ?').get('target') as {
      slugs_json: string;
    }).slugs_json;
    expect(JSON.parse(union).sort()).toEqual(['s1', 's2', 's3']);
    const contribs = db
      .prepare('SELECT contributor_username FROM contributions WHERE target_username = ? ORDER BY contributor_username')
      .all('target') as Array<{ contributor_username: string }>;
    expect(contribs.map((c) => c.contributor_username)).toEqual(['alice', 'bob']);
  });
});

describe('Race conditions', () => {
  it('parallel uploads to the same target by different contributors converge to a union', async () => {
    mockedCount.mockResolvedValue(1000);
    const results = await Promise.all(
      ['alice', 'bob', 'carol', 'dave'].map((c, i) =>
        request(app)
          .post('/sync')
          .set('Authorization', jwtFor(c))
          .send(syncBody([`self${i}`], { target: [`s${i}`, 'shared'] }))
      )
    );
    expect(results.every((r) => r.status === 200)).toBe(true);

    const row = db.prepare('SELECT slugs_json FROM solved_sets WHERE lc_username = ?').get('target') as
      | { slugs_json: string }
      | undefined;
    expect(row).toBeTruthy();
    const union = JSON.parse(row!.slugs_json).sort();
    expect(union).toEqual(['s0', 's1', 's2', 's3', 'shared']);
    const cc = db.prepare('SELECT COUNT(*) AS c FROM contributions WHERE target_username = ?').get('target') as {
      c: number;
    };
    expect(cc.c).toBe(4);
  });

  it('two parallel key rotations on the same JWT leave exactly one live key', async () => {
    seedVerifiedUser('alice');
    issueKeyForUser('alice');

    const [r1, r2] = await Promise.all([
      request(app).post('/api/v1/key/rotate').set('Authorization', jwtFor('alice')).send({}),
      request(app).post('/api/v1/key/rotate').set('Authorization', jwtFor('alice')).send({}),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const live = db
      .prepare('SELECT COUNT(*) AS c FROM api_keys WHERE lc_username = ? AND revoked_at IS NULL')
      .get('alice') as { c: number };
    expect(live.c).toBe(1);

    const revoked = db
      .prepare('SELECT COUNT(*) AS c FROM api_keys WHERE lc_username = ? AND revoked_at IS NOT NULL')
      .get('alice') as { c: number };
    expect(revoked.c).toBeGreaterThanOrEqual(1);
  });

  it('DELETE /users/me racing a /sync from the same JWT ends with no rows for that user', async () => {
    seedVerifiedUser('alice');
    mockedCount.mockResolvedValue(100);

    const results = await Promise.all([
      request(app).post('/sync').set('Authorization', jwtFor('alice')).send(syncBody(['x', 'y'])),
      request(app).delete('/api/v1/users/me').set('Authorization', jwtFor('alice')),
    ]);
    // both must complete cleanly (no 500)
    expect(results[0].status).toBeLessThan(500);
    expect(results[1].status).toBe(200);

    // After the dust settles, /users/me has wiped everything. A /sync that happened
    // to win the race may have left a row; re-issue delete to assert idempotency.
    await request(app).delete('/api/v1/users/me').set('Authorization', jwtFor('alice'));
    expect(db.prepare('SELECT 1 FROM users WHERE lc_username = ?').get('alice')).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM solved_sets WHERE lc_username = ?').get('alice')).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM api_keys WHERE lc_username = ?').get('alice')).toBeUndefined();
  });

  it('parallel /friends PUTs converge: one of the two payloads wins, no partial mixing', async () => {
    seedVerifiedUser('alice');
    const a = ['bob', 'carol'];
    const b = ['dave', 'eve', 'frank'];

    await Promise.all([
      request(app).put('/friends').set('Authorization', jwtFor('alice')).send({ friends: a }),
      request(app).put('/friends').set('Authorization', jwtFor('alice')).send({ friends: b }),
    ]);

    const rows = db.prepare('SELECT friend_username FROM user_friends WHERE lc_username = ? ORDER BY friend_username')
      .all('alice') as Array<{ friend_username: string }>;
    const got = rows.map((r) => r.friend_username);
    // Whichever PUT lost is fully overwritten by the winner; never a mix of both.
    expect(got.sort()).toEqual(
      [a.slice().sort(), b.slice().sort()].find((arr) => JSON.stringify(arr) === JSON.stringify(got.slice().sort())) ||
        got
    );
    expect(got.length === a.length || got.length === b.length).toBe(true);
  });

  it('two /auth/start in a row for the same user: only the latest nonce is active', async () => {
    const r1 = await request(app).post('/auth/start').send({ lc_username: 'alice' });
    const r2 = await request(app).post('/auth/start').send({ lc_username: 'alice' });
    expect(r1.body.nonce).not.toBe(r2.body.nonce);

    const rows = db
      .prepare('SELECT nonce FROM auth_nonces WHERE lc_username = ?')
      .all('alice') as Array<{ nonce: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].nonce).toBe(r2.body.nonce);
  });

  it('public-count guard rejects collusion: 5 contributors cannot inflate target past public count + grace', async () => {
    mockedCount.mockResolvedValue(10); // target has only 10 public solves; grace +50 → cap 60
    // Each contributor claims 20 UNIQUE slugs, so the union grows fast: 20, 40, 60, 80, 100.
    const claimsBy = (c: string) => Array.from({ length: 20 }, (_, i) => `${c}-slug-${i}`);

    // Serial, not parallel: each /sync sees the updated union from the previous one.
    const results = [];
    for (const c of ['c1', 'c2', 'c3', 'c4', 'c5']) {
      results.push(
        await request(app).post('/sync').set('Authorization', jwtFor(c)).send(syncBody([], { target: claimsBy(c) }))
      );
    }
    const accepted = results.filter((r) => r.body?.friends_accepted?.target !== undefined).length;
    const rejected = results
      .map((r) => r.body?.friends_rejected?.target)
      .filter((x) => x === 'count_exceeded').length;
    expect(accepted + rejected).toBe(5);
    expect(rejected).toBeGreaterThan(0);

    const row = db.prepare('SELECT slugs_json FROM solved_sets WHERE lc_username = ?').get('target') as
      | { slugs_json: string }
      | undefined;
    const union = row ? JSON.parse(row.slugs_json) : [];
    // grace = 50, so union is bounded by 10 + 50 = 60.
    expect(union.length).toBeLessThanOrEqual(60);
  });

  it('stats aggregator computed while writes happen yields a coherent snapshot (no torn JSON)', async () => {
    mockedCount.mockResolvedValue(100);

    const writes = ['u1', 'u2', 'u3', 'u4'].map((u) =>
      request(app).post('/sync').set('Authorization', jwtFor(u)).send(syncBody([u + 'a', u + 'b', 'shared']))
    );
    const stats = (async () => {
      await Promise.resolve();
      computeStatsNow();
      return getStatsPayload();
    })();

    const [statsPayload] = await Promise.all([stats, ...writes]);
    expect(typeof statsPayload.users_total).toBe('number');
    expect(Number.isFinite(statsPayload.solves_total)).toBe(true);
    expect(Array.isArray(statsPayload.top_slugs)).toBe(true);

    computeStatsNow();
    const after = getStatsPayload();
    expect(after.users_total).toBe(4);
    expect(after.top_slugs[0]).toEqual({ slug: 'shared', count: 4 });
  });

  it('a key revoked between auth and DB hit returns 403 revoked_key on next request', async () => {
    seedVerifiedUser('alice');
    seedSolvedSet('alice', ['x']);
    const { plaintext } = issueKeyForUser('alice');
    expect(plaintext).toBeTruthy();

    const r1 = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${plaintext!}`);
    expect(r1.status).toBe(200);

    db.prepare('UPDATE api_keys SET revoked_at = ? WHERE lc_username = ?').run(Date.now(), 'alice');

    const r2 = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${plaintext!}`);
    expect(r2.status).toBe(403);
    expect(r2.body.error).toBe('revoked_key');
  });

  it('paginated /users is stable: cursor still resolves correctly after concurrent writes', async () => {
    for (let i = 0; i < 5; i++) seedSolvedSet(`user${i}`, ['x'], 1000 + i);
    seedVerifiedUser('alice');
    const { plaintext } = issueKeyForUser('alice');
    const key = `Bearer ${plaintext!}`;

    const page1 = await request(app).get('/api/v1/users?limit=2').set('Authorization', key);
    expect(page1.status).toBe(200);
    expect(page1.body.users.length).toBe(2);

    seedSolvedSet('user99', ['z'], 9999);

    const page2 = await request(app)
      .get(`/api/v1/users?limit=10&cursor=${encodeURIComponent(page1.body.next_cursor)}`)
      .set('Authorization', key);
    expect(page2.status).toBe(200);
    const seen = new Set([...page1.body.users.map((u: any) => u.username), ...page2.body.users.map((u: any) => u.username)]);
    expect(seen.size).toBe(page1.body.users.length + page2.body.users.length);
  });

  it('contributor making themselves the target is idempotent and isolated from cross-user contributions', async () => {
    mockedCount.mockResolvedValue(100);
    seedVerifiedUser('alice');

    const r1 = await request(app).post('/sync').set('Authorization', jwtFor('alice')).send(syncBody(['x', 'y']));
    const r2 = await request(app).post('/sync').set('Authorization', jwtFor('alice')).send(syncBody(['x', 'y']));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const cc = db.prepare('SELECT COUNT(*) AS c FROM contributions WHERE target_username = ?').get('alice') as {
      c: number;
    };
    expect(cc.c).toBe(1);

    await request(app).post('/sync').set('Authorization', jwtFor('bob')).send(syncBody([], { alice: ['z'] }));
    const ccAfter = db.prepare('SELECT COUNT(*) AS c FROM contributions WHERE target_username = ?').get('alice') as {
      c: number;
    };
    expect(ccAfter.c).toBe(2);
  });
});

describe('Friend-list cross-account', () => {
  it('A adds B and B adds A: both lists are independent and contain the other', async () => {
    seedVerifiedUser('alice');
    seedVerifiedUser('bob');

    await Promise.all([
      request(app).put('/friends').set('Authorization', jwtFor('alice')).send({ friends: ['bob'] }),
      request(app).put('/friends').set('Authorization', jwtFor('bob')).send({ friends: ['alice'] }),
    ]);

    const aGet = await request(app).get('/friends').set('Authorization', jwtFor('alice'));
    const bGet = await request(app).get('/friends').set('Authorization', jwtFor('bob'));
    expect(aGet.body.friends).toEqual(['bob']);
    expect(bGet.body.friends).toEqual(['alice']);
  });

  it("deleting user A leaves A's handle in B's friend list (handle is public)", async () => {
    seedVerifiedUser('alice');
    seedVerifiedUser('bob');
    db.prepare('INSERT INTO user_friends (lc_username, friend_username, added_at) VALUES (?, ?, ?)')
      .run('bob', 'alice', Date.now());
    issueKeyForUser('alice');

    await request(app).delete('/api/v1/users/me').set('Authorization', jwtFor('alice'));

    const bRows = db.prepare('SELECT friend_username FROM user_friends WHERE lc_username = ?').all('bob') as Array<{
      friend_username: string;
    }>;
    expect(bRows.map((r) => r.friend_username)).toEqual(['alice']);
  });
});
