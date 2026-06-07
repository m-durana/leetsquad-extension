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
  db.prepare('INSERT INTO users (lc_username, verified_at, last_sync_at) VALUES (?, ?, 0)').run('bob', Date.now());
  mockedCount.mockReset();
  mockedCount.mockResolvedValue(500);
});

afterAll(() => {
  db.close();
  const p = process.env.DB_PATH!;
  if (existsSync(p)) unlinkSync(p);
});

describe('rich slug payloads (v2)', () => {
  it('round-trips ts/id/lang/rt/mem through sync -> GET /user/:u', async () => {
    const slugs = {
      'two-sum': { ts: 1700000000, id: 'sub-1', lang: 'cpp', rt: '5 ms', mem: '8 MB' },
      'three-sum': { ts: 1700001000, id: 'sub-2' },
    };
    const r = await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send({ slugs, updated_at: 1, schema_version: 2 });
    expect(r.status).toBe(200);

    const g = await request(app).get('/user/alice');
    expect(g.status).toBe(200);
    expect(g.body.slugs.sort()).toEqual(['three-sum', 'two-sum']);
    expect(g.body.solved_slug_details['two-sum']).toEqual({
      ts: 1700000000, id: 'sub-1', lang: 'cpp', rt: '5 ms', mem: '8 MB',
    });
    expect(g.body.solved_slug_details['three-sum']).toEqual({ ts: 1700001000, id: 'sub-2' });
  });

  it('accepts legacy string[] upload (back-compat)', async () => {
    const r = await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send({ slugs: ['two-sum', 'three-sum'], updated_at: 1, schema_version: 1 });
    expect(r.status).toBe(200);
    const g = await request(app).get('/user/alice');
    expect(g.body.slugs.sort()).toEqual(['three-sum', 'two-sum']);
    expect(g.body.solved_slug_details['two-sum']).toEqual({});
  });

  it('keeps max ts when two contributors send different timestamps for the same slug', async () => {
    await request(app).post('/sync').set('Authorization', authHeader('alice'))
      .send({ slugs: {}, friend_sets: { carol: { 'two-sum': { ts: 1700000000 } } }, updated_at: 1, schema_version: 2 });
    await request(app).post('/sync').set('Authorization', authHeader('bob'))
      .send({ slugs: {}, friend_sets: { carol: { 'two-sum': { ts: 1700009999 } } }, updated_at: 2, schema_version: 2 });

    const g = await request(app).get('/user/carol');
    expect(g.body.solved_slug_details['two-sum'].ts).toBe(1700009999);
  });

  it('preserves existing id/lang/rt/mem when a later contributor sends an empty record', async () => {
    await request(app).post('/sync').set('Authorization', authHeader('alice'))
      .send({
        slugs: {},
        friend_sets: { carol: { 'two-sum': { id: 'sub-x', lang: 'cpp', rt: '5 ms', mem: '8 MB' } } },
        updated_at: 1,
        schema_version: 2,
      });
    await request(app).post('/sync').set('Authorization', authHeader('bob'))
      .send({ slugs: {}, friend_sets: { carol: { 'two-sum': {} } }, updated_at: 2, schema_version: 2 });

    const g = await request(app).get('/user/carol');
    expect(g.body.solved_slug_details['two-sum']).toEqual({
      id: 'sub-x', lang: 'cpp', rt: '5 ms', mem: '8 MB',
    });
  });

  it('overwrites id/lang/rt/mem when a later contributor sends fresher non-empty values', async () => {
    await request(app).post('/sync').set('Authorization', authHeader('alice'))
      .send({
        slugs: {},
        friend_sets: { carol: { 'two-sum': { id: 'old', lang: 'java', rt: '10 ms' } } },
        updated_at: 1,
        schema_version: 2,
      });
    await request(app).post('/sync').set('Authorization', authHeader('bob'))
      .send({
        slugs: {},
        friend_sets: { carol: { 'two-sum': { id: 'new', lang: 'cpp', rt: '5 ms', mem: '8 MB' } } },
        updated_at: 2,
        schema_version: 2,
      });

    const g = await request(app).get('/user/carol');
    expect(g.body.solved_slug_details['two-sum']).toEqual({
      id: 'new', lang: 'cpp', rt: '5 ms', mem: '8 MB',
    });
  });

  it('v1/users/:u responds with both solved_slugs and solved_slug_details', async () => {
    await request(app).post('/sync').set('Authorization', authHeader('alice'))
      .send({ slugs: { 'two-sum': { ts: 1700000000, lang: 'cpp' } }, updated_at: 1, schema_version: 2 });

    const g = await request(app).get('/api/v1/users/alice');
    expect(g.status).toBe(200);
    expect(g.body.solved_slugs).toEqual(['two-sum']);
    expect(g.body.solved_slug_details['two-sum']).toEqual({ ts: 1700000000, lang: 'cpp' });
    expect(g.body.solved_count).toBe(1);
  });
});
