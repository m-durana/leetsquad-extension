import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { unlinkSync, existsSync } from 'node:fs';

vi.mock('../src/leetcode', () => ({
  getPublicSkillTags: vi.fn(),
  getPublicSolvedCount: vi.fn(),
}));

import { createApp } from '../src/app';
import { db } from '../src/db';
import { getPublicSolvedCount } from '../src/leetcode';
import { signToken } from '../src/jwt';

const mockedCount = vi.mocked(getPublicSolvedCount);
const app = createApp();

function authHeader(username: string) {
  return `Bearer ${signToken({ lc_username: username }).token}`;
}

beforeEach(() => {
  db.exec(
    'DELETE FROM contributions; DELETE FROM solved_sets; DELETE FROM auth_nonces; ' +
      'DELETE FROM users; DELETE FROM public_solved_counts;'
  );
  db.prepare('INSERT INTO users (lc_username, verified_at, last_sync_at) VALUES (?, ?, 0)').run('alice', Date.now());
  mockedCount.mockReset();
});

afterAll(() => {
  db.close();
  const p = process.env.DB_PATH!;
  if (existsSync(p)) unlinkSync(p);
});

describe('POST /sync', () => {
  it('requires Bearer token', async () => {
    const r = await request(app).post('/sync').send({ slugs: [], updated_at: 1, schema_version: 1 });
    expect(r.status).toBe(401);
  });

  it('stores the slug set under the JWT username', async () => {
    mockedCount.mockResolvedValueOnce(150);
    const r = await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send({
        slugs: ['two-sum', 'add-two-numbers', 'two-sum'], // duplicate dropped
        updated_at: 12345,
        schema_version: 1,
      });
    expect(r.status).toBe(200);
    expect(r.body.accepted).toBe(2);

    const row = db.prepare('SELECT slugs_json FROM solved_sets WHERE lc_username = ?').get('alice') as
      | { slugs_json: string }
      | undefined;
    expect(JSON.parse(row!.slugs_json).sort()).toEqual(['add-two-numbers', 'two-sum']);
  });

  it('filters malformed slugs', async () => {
    mockedCount.mockResolvedValueOnce(100);
    const r = await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send({
        slugs: ['two-sum', '../etc/passwd', 'OK-BUT-CAPS', 'good-slug'],
        updated_at: 12345,
        schema_version: 1,
      });
    expect(r.status).toBe(200);
    const row = db.prepare('SELECT slugs_json FROM solved_sets WHERE lc_username = ?').get('alice') as
      | { slugs_json: string };
    expect(JSON.parse(row.slugs_json).sort()).toEqual(['good-slug', 'two-sum']);
  });

  it('rejects when uploaded count wildly exceeds public count', async () => {
    mockedCount.mockResolvedValueOnce(10);
    const lots = Array.from({ length: 500 }, (_, i) => `problem-${i}`);
    const r = await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send({ slugs: lots, updated_at: 1, schema_version: 1 });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('slug_count_exceeds_public_solved');
  });

  it('returns 502 when LeetCode is unreachable', async () => {
    mockedCount.mockRejectedValueOnce(new Error('boom'));
    const r = await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send({ slugs: ['two-sum'], updated_at: 1, schema_version: 1 });
    expect(r.status).toBe(502);
  });
});

describe('POST /sync with friend_sets (crowdsourced)', () => {
  it('upserts friend slug-sets alongside self', async () => {
    mockedCount.mockResolvedValue(500); // any user passes guard
    const r = await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send({
        slugs: ['two-sum'],
        friend_sets: {
          bob: ['three-sum', 'two-sum'],
          carol: ['valid-parentheses'],
        },
        updated_at: 1,
        schema_version: 1,
      });
    expect(r.status).toBe(200);
    expect(r.body.friends_accepted).toEqual({ bob: 2, carol: 1 });
    const bob = db.prepare('SELECT slugs_json FROM solved_sets WHERE lc_username = ?').get('bob') as
      | { slugs_json: string }
      | undefined;
    expect(JSON.parse(bob!.slugs_json).sort()).toEqual(['three-sum', 'two-sum']);
  });

  it('unions crowdsourced uploads instead of overwriting', async () => {
    mockedCount.mockResolvedValue(500);
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send({ slugs: ['a'], friend_sets: { bob: ['two-sum'] }, updated_at: 1, schema_version: 1 });
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send({ slugs: ['a'], friend_sets: { bob: ['three-sum'] }, updated_at: 2, schema_version: 1 });
    const bob = db.prepare('SELECT slugs_json FROM solved_sets WHERE lc_username = ?').get('bob') as
      | { slugs_json: string };
    expect(JSON.parse(bob.slugs_json).sort()).toEqual(['three-sum', 'two-sum']);
  });

  it('rejects bogus friend usernames', async () => {
    mockedCount.mockResolvedValue(100);
    const r = await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send({ slugs: [], friend_sets: { 'bad name!': ['two-sum'] }, updated_at: 1, schema_version: 1 });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_friend_username');
  });

  it('rejects friend_sets entry that collides with the uploader', async () => {
    mockedCount.mockResolvedValue(100);
    const r = await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send({ slugs: [], friend_sets: { alice: ['x'] }, updated_at: 1, schema_version: 1 });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('friend_collides_with_self');
  });

  it('per-friend count-exceeded does not block the rest of the upload', async () => {
    mockedCount.mockImplementation(async (u) => (u === 'bob' ? 1 : 500));
    const r = await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send({
        slugs: ['x'],
        friend_sets: {
          bob: Array.from({ length: 200 }, (_, i) => `s-${i}`),
          carol: ['valid-parentheses'],
        },
        updated_at: 1,
        schema_version: 1,
      });
    expect(r.status).toBe(200);
    expect(r.body.friends_accepted).toEqual({ carol: 1 });
    expect(r.body.friends_rejected).toEqual({ bob: 'count_exceeded' });
  });

  it('caches public solved count and only calls LeetCode once per username', async () => {
    mockedCount.mockResolvedValue(500);
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send({ slugs: ['x'], friend_sets: { bob: ['y'] }, updated_at: 1, schema_version: 1 });
    const firstCalls = mockedCount.mock.calls.length;
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send({ slugs: ['x'], friend_sets: { bob: ['z'] }, updated_at: 2, schema_version: 1 });
    // No additional LeetCode calls because the public count is cached in DB.
    expect(mockedCount.mock.calls.length).toBe(firstCalls);
  });
});

describe('GET /user/:username', () => {
  it('returns the stored set', async () => {
    db.prepare(
      'INSERT INTO solved_sets (lc_username, slugs_json, schema_version, updated_at) VALUES (?, ?, ?, ?)'
    ).run('alice', JSON.stringify(['two-sum']), 1, 5000);
    const r = await request(app).get('/user/alice');
    expect(r.status).toBe(200);
    expect(r.body.slugs).toEqual(['two-sum']);
    expect(r.body.updated_at).toBe(5000);
    expect(r.headers['cache-control']).toMatch(/max-age=60/);
  });

  it('404 when missing', async () => {
    const r = await request(app).get('/user/nobody');
    expect(r.status).toBe(404);
  });

  it('400 on bad username', async () => {
    const r = await request(app).get('/user/bad%20name');
    expect(r.status).toBe(400);
  });
});

describe('DELETE /user/:username', () => {
  it('owner can delete; cascades to solved_sets', async () => {
    db.prepare(
      'INSERT INTO solved_sets (lc_username, slugs_json, schema_version, updated_at) VALUES (?, ?, ?, ?)'
    ).run('alice', JSON.stringify(['x']), 1, 1);
    const r = await request(app).delete('/user/alice').set('Authorization', authHeader('alice'));
    expect(r.status).toBe(204);
    const row = db.prepare('SELECT 1 FROM solved_sets WHERE lc_username = ?').get('alice');
    expect(row).toBeUndefined();
  });

  it('rejects deleting someone else', async () => {
    const r = await request(app).delete('/user/bob').set('Authorization', authHeader('alice'));
    expect(r.status).toBe(403);
  });
});
