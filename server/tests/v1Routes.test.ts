import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { unlinkSync, existsSync } from 'node:fs';

vi.mock('../src/leetcode', () => ({
  getPublicSkillTags: vi.fn(),
  getPublicSolvedCount: vi.fn(),
}));

import { createApp } from '../src/app';
import { db } from '../src/db';
import { signToken } from '../src/jwt';
import { issueKeyForUser, resetTouchDebounceForTests } from '../src/apiKeys';
import { computeStatsNow, stopStatsAggregatorForTests } from '../src/statsAggregator';

const app = createApp();

function jwtHeader(username: string) {
  return `Bearer ${signToken({ lc_username: username }).token}`;
}

function seedSolvedSet(username: string, slugs: string[], updated_at = Date.now()) {
  db.prepare(
    `INSERT INTO solved_sets (lc_username, slugs_json, schema_version, updated_at, last_self_sync_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(lc_username) DO UPDATE SET slugs_json = excluded.slugs_json,
       updated_at = excluded.updated_at, last_self_sync_at = excluded.last_self_sync_at`
  ).run(username, JSON.stringify(slugs), 1, updated_at, updated_at);
}

beforeEach(() => {
  db.exec(
    'DELETE FROM api_keys; DELETE FROM contributions; DELETE FROM solved_sets; ' +
      'DELETE FROM auth_nonces; DELETE FROM users; DELETE FROM public_solved_counts; ' +
      'DELETE FROM user_friends;'
  );
  resetTouchDebounceForTests();
  stopStatsAggregatorForTests();
});

afterAll(() => {
  stopStatsAggregatorForTests();
  db.close();
  const p = process.env.DB_PATH!;
  if (existsSync(p)) unlinkSync(p);
});

describe('/api/v1/health', () => {
  it('returns ok with no-store cache control and an x-trace-id header', async () => {
    const r = await request(app).get('/api/v1/health');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.headers['cache-control']).toContain('no-store');
    expect(r.headers['x-trace-id']).toBeTruthy();
  });
});

describe('/api/v1/openapi.json', () => {
  it('serves the OpenAPI spec', async () => {
    const r = await request(app).get('/api/v1/openapi.json');
    expect(r.status).toBe(200);
    expect(r.body.openapi).toBe('3.1.0');
    expect(r.body.paths['/api/v1/users/{username}']).toBeDefined();
    expect(r.body.paths['/api/v1/slugs/{slug}/solvers']).toBeDefined();
    expect(r.body.paths['/api/v1/key/rotate']).toBeDefined();
  });
});

describe('/api/v1/users/:u', () => {
  it('returns the user shape with solved_slugs and contributors_count', async () => {
    seedSolvedSet('alice', ['two-sum', 'add-two-numbers']);
    const r = await request(app).get('/api/v1/users/alice');
    expect(r.status).toBe(200);
    expect(r.body.solved_slugs.sort()).toEqual(['add-two-numbers', 'two-sum']);
    expect(r.body.solved_count).toBe(2);
    expect(r.body.contributors_count).toBe(0);
    expect(r.body.terms_url).toBeUndefined();
    expect(r.headers['cache-control']).toContain('max-age=60');
  });

  it('400 on bad username', async () => {
    const r = await request(app).get('/api/v1/users/bad%20name');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_username');
    expect(r.body.trace_id).toBeTruthy();
  });

  it('404 when no record exists', async () => {
    const r = await request(app).get('/api/v1/users/nobody');
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('not_found');
  });
});

describe('/api/v1/users/:u/count', () => {
  it('returns solved_count', async () => {
    seedSolvedSet('bob', ['x', 'y', 'z']);
    const r = await request(app).get('/api/v1/users/bob/count');
    expect(r.status).toBe(200);
    expect(r.body.solved_count).toBe(3);
  });
});

describe('/api/v1/users (paginated list)', () => {
  it('401 without API key', async () => {
    const r = await request(app).get('/api/v1/users');
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('missing_key');
  });

  it('returns paginated rows ordered by updated_at desc with stable cursor', async () => {
    seedSolvedSet('alice', ['s1'], 1000);
    seedSolvedSet('bob', ['s1', 's2'], 2000);
    seedSolvedSet('carol', ['s1', 's2', 's3'], 3000);

    const issued = issueKeyForUser('alice');
    const key = `Bearer ${issued.plaintext}`;

    const page1 = await request(app).get('/api/v1/users?limit=2').set('Authorization', key);
    expect(page1.status).toBe(200);
    expect(page1.body.users.map((u: any) => u.username)).toEqual(['carol', 'bob']);
    expect(page1.body.next_cursor).toBeTruthy();

    const page2 = await request(app)
      .get(`/api/v1/users?limit=2&cursor=${encodeURIComponent(page1.body.next_cursor)}`)
      .set('Authorization', key);
    expect(page2.status).toBe(200);
    expect(page2.body.users.map((u: any) => u.username)).toEqual(['alice']);
    expect(page2.body.next_cursor).toBeNull();
  });

  it('400 on bad cursor', async () => {
    const issued = issueKeyForUser('alice');
    const r = await request(app)
      .get('/api/v1/users?cursor=!!!notbase64!!!')
      .set('Authorization', `Bearer ${issued.plaintext}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('bad_cursor');
  });

  it('rejects a revoked key with revoked_key', async () => {
    seedSolvedSet('alice', ['x']);
    const issued = issueKeyForUser('alice');
    db.prepare('UPDATE api_keys SET revoked_at = ?').run(Date.now());
    const r = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${issued.plaintext}`);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('revoked_key');
  });

  it('rejects a malformed bearer with invalid_key', async () => {
    const r = await request(app).get('/api/v1/users').set('Authorization', 'Bearer not-a-key');
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('invalid_key');
  });
});

describe('/api/v1/stats', () => {
  it('returns the cached aggregate payload', async () => {
    seedSolvedSet('alice', ['two-sum', 'add-two-numbers']);
    seedSolvedSet('bob', ['two-sum']);
    computeStatsNow();
    const r = await request(app).get('/api/v1/stats');
    expect(r.status).toBe(200);
    expect(r.body.users_total).toBe(2);
    expect(r.body.solves_total).toBe(3);
    expect(r.body.top_slugs[0]).toEqual({ slug: 'two-sum', count: 2 });
    expect(r.headers['cache-control']).toContain('max-age=600');
  });
});

describe('/api/v1/changes', () => {
  it('lists rows with updated_at > since, ordered asc, with next_since cursor', async () => {
    seedSolvedSet('alice', ['x'], 100);
    seedSolvedSet('bob', ['y'], 200);
    seedSolvedSet('carol', ['z'], 300);

    const key = `Bearer ${issueKeyForUser('alice').plaintext}`;
    const r = await request(app).get('/api/v1/changes?since=100&limit=10').set('Authorization', key);
    expect(r.status).toBe(200);
    expect(r.body.changes.map((c: any) => c.username)).toEqual(['bob', 'carol']);
    expect(r.body.next_since).toBe(300);
    expect(r.headers['cache-control']).toContain('no-store');
  });

  it('empty result echoes since back as next_since', async () => {
    const key = `Bearer ${issueKeyForUser('alice').plaintext}`;
    const r = await request(app).get('/api/v1/changes?since=9999&limit=10').set('Authorization', key);
    expect(r.status).toBe(200);
    expect(r.body.changes).toEqual([]);
    expect(r.body.next_since).toBe(9999);
  });

  it('401 without key', async () => {
    const r = await request(app).get('/api/v1/changes?since=0');
    expect(r.status).toBe(401);
  });
});

describe('/api/v1/slugs/:slug/count', () => {
  it('counts users with that slug', async () => {
    seedSolvedSet('alice', ['two-sum', 'add-two-numbers']);
    seedSolvedSet('bob', ['two-sum']);
    seedSolvedSet('carol', ['add-two-numbers']);
    const r = await request(app).get('/api/v1/slugs/two-sum/count');
    expect(r.status).toBe(200);
    expect(r.body.solver_count).toBe(2);
  });

  it('returns 0 for unknown slug', async () => {
    const r = await request(app).get('/api/v1/slugs/nothing-here/count');
    expect(r.status).toBe(200);
    expect(r.body.solver_count).toBe(0);
  });

  it('400 for bad slug shape', async () => {
    const r = await request(app).get('/api/v1/slugs/BAD_SLUG/count');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('bad_slug');
  });
});

describe('/api/v1/slugs/:slug/solvers', () => {
  it('lists exactly the users who solved that slug, sorted by username', async () => {
    seedSolvedSet('alice', ['two-sum', 'add-two-numbers']);
    seedSolvedSet('bob', ['two-sum']);
    seedSolvedSet('carol', ['add-two-numbers']);

    const key = `Bearer ${issueKeyForUser('alice').plaintext}`;
    const r = await request(app).get('/api/v1/slugs/two-sum/solvers?limit=10').set('Authorization', key);
    expect(r.status).toBe(200);
    expect(r.body.solvers.map((s: any) => s.username)).toEqual(['alice', 'bob']);
    expect(r.body.next_cursor).toBeNull();
  });

  it('paginates with a stable cursor', async () => {
    seedSolvedSet('alice', ['two-sum']);
    seedSolvedSet('bob', ['two-sum']);
    seedSolvedSet('carol', ['two-sum']);

    const key = `Bearer ${issueKeyForUser('alice').plaintext}`;
    const p1 = await request(app).get('/api/v1/slugs/two-sum/solvers?limit=2').set('Authorization', key);
    expect(p1.body.solvers.map((s: any) => s.username)).toEqual(['alice', 'bob']);
    expect(p1.body.next_cursor).toBeTruthy();

    const p2 = await request(app)
      .get(`/api/v1/slugs/two-sum/solvers?limit=2&cursor=${encodeURIComponent(p1.body.next_cursor)}`)
      .set('Authorization', key);
    expect(p2.body.solvers.map((s: any) => s.username)).toEqual(['carol']);
    expect(p2.body.next_cursor).toBeNull();
  });

  it('401 without API key', async () => {
    const r = await request(app).get('/api/v1/slugs/two-sum/solvers');
    expect(r.status).toBe(401);
  });
});

describe('/api/v1/key (JWT) — get/rotate', () => {
  it('GET returns prefix + tier + created_at for a verified user', async () => {
    const issued = issueKeyForUser('alice');
    const r = await request(app).get('/api/v1/key').set('Authorization', jwtHeader('alice'));
    expect(r.status).toBe(200);
    expect(r.body.prefix).toBe(issued.prefix);
    expect(r.body.tier).toBe('free');
    expect(typeof r.body.created_at).toBe('number');
  });

  it('GET 404 when user has no live key', async () => {
    const r = await request(app).get('/api/v1/key').set('Authorization', jwtHeader('nobody'));
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('not_found');
  });

  it('GET 401 without JWT', async () => {
    const r = await request(app).get('/api/v1/key');
    expect(r.status).toBe(401);
  });

  it('POST /rotate returns new plaintext and revokes the prior key', async () => {
    const first = issueKeyForUser('bob');
    const r = await request(app).post('/api/v1/key/rotate').set('Authorization', jwtHeader('bob')).send({});
    expect(r.status).toBe(200);
    expect(r.body.api_key).toMatch(/^ls_pk_/);
    expect(r.body.api_key).not.toBe(first.plaintext);
    // Old key now revoked
    const ok = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${first.plaintext}`);
    expect(ok.status).toBe(403);
    expect(ok.body.error).toBe('revoked_key');
    // New key works
    const ok2 = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${r.body.api_key}`);
    expect(ok2.status).toBe(200);
  });

  it('POST /rotate 401 without JWT', async () => {
    const r = await request(app).post('/api/v1/key/rotate').send({});
    expect(r.status).toBe(401);
  });
});

describe('DELETE /api/v1/users/me', () => {
  it('wipes solved set, contributions (both sides), friends (both sides), api keys, and user row', async () => {
    db.prepare('INSERT INTO users (lc_username, verified_at, last_sync_at) VALUES (?, ?, 0)').run('alice', Date.now());
    db.prepare('INSERT INTO users (lc_username, verified_at, last_sync_at) VALUES (?, ?, 0)').run('bob', Date.now());
    seedSolvedSet('alice', ['two-sum']);
    seedSolvedSet('bob', ['add-two-numbers']);
    db.prepare(
      `INSERT INTO contributions (target_username, contributor_username, slugs_json, updated_at) VALUES (?, ?, ?, ?)`
    ).run('alice', 'bob', JSON.stringify(['two-sum']), Date.now());
    db.prepare(
      `INSERT INTO contributions (target_username, contributor_username, slugs_json, updated_at) VALUES (?, ?, ?, ?)`
    ).run('bob', 'alice', JSON.stringify(['add-two-numbers']), Date.now());
    db.prepare('INSERT INTO user_friends (lc_username, friend_username, added_at) VALUES (?, ?, ?)').run('alice', 'bob', Date.now());
    db.prepare('INSERT INTO user_friends (lc_username, friend_username, added_at) VALUES (?, ?, ?)').run('bob', 'alice', Date.now());
    db.prepare('INSERT INTO user_daily_goals (lc_username, goals_json, updated_at) VALUES (?, ?, ?)').run('alice', '{}', Date.now());
    db.prepare('INSERT INTO user_daily_goals (lc_username, goals_json, updated_at) VALUES (?, ?, ?)').run('bob', '{}', Date.now());
    issueKeyForUser('alice');

    const r = await request(app).delete('/api/v1/users/me').set('Authorization', jwtHeader('alice'));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.deleted).toBe('alice');

    expect(db.prepare('SELECT COUNT(*) AS c FROM users WHERE lc_username = ?').get('alice')).toMatchObject({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM solved_sets WHERE lc_username = ?').get('alice')).toMatchObject({ c: 0 });
    // Contributions ABOUT alice are gone, contributions BY alice (about bob)
    // are preserved — they're observations about the target, not alice's data.
    expect(db.prepare('SELECT COUNT(*) AS c FROM contributions WHERE target_username = ?').get('alice')).toMatchObject({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM contributions WHERE contributor_username = ? AND target_username = ?').get('alice', 'bob')).toMatchObject({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM user_friends WHERE lc_username = ?').get('alice')).toMatchObject({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM user_daily_goals WHERE lc_username = ?').get('alice')).toMatchObject({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM api_keys WHERE lc_username = ?').get('alice')).toMatchObject({ c: 0 });

    // Bob's data is untouched — including bob's friend list, which still
    // contains alice's handle (a follower's list is their data, not alice's).
    expect(db.prepare('SELECT COUNT(*) AS c FROM users WHERE lc_username = ?').get('bob')).toMatchObject({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM solved_sets WHERE lc_username = ?').get('bob')).toMatchObject({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM user_daily_goals WHERE lc_username = ?').get('bob')).toMatchObject({ c: 1 });
    expect(db.prepare('SELECT friend_username FROM user_friends WHERE lc_username = ?').all('bob')).toEqual([
      { friend_username: 'alice' },
    ]);
  });

  it('401 without JWT', async () => {
    const r = await request(app).delete('/api/v1/users/me');
    expect(r.status).toBe(401);
  });
});

describe('error envelope', () => {
  it('every error response has error, message, and trace_id', async () => {
    const r = await request(app).get('/api/v1/users/bad%20name');
    expect(r.body).toMatchObject({
      error: expect.any(String),
      message: expect.any(String),
      trace_id: expect.any(String),
    });
    expect(r.headers['x-trace-id']).toBe(r.body.trace_id);
  });
});

describe('auth.test.ts compatibility: /auth/verify now returns api_key', () => {
  it('issues an API key alongside the JWT and lets the client query /api/v1 reads with it', async () => {
    db.prepare('INSERT INTO users (lc_username, verified_at, last_sync_at) VALUES (?, ?, 0)').run(
      'alice',
      Date.now()
    );
    seedSolvedSet('alice', ['two-sum']);
    const issued = issueKeyForUser('alice');
    const r = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${issued.plaintext}`);
    expect(r.status).toBe(200);
    expect(r.body.users.map((u: any) => u.username)).toContain('alice');
  });
});
