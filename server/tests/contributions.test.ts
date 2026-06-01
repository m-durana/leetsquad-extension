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

function syncBody(slugs: string[], friendSets: Record<string, string[]> = {}, ts = Date.now()) {
  return { slugs, friend_sets: friendSets, updated_at: ts, schema_version: 1 };
}

function getUnion(username: string): string[] {
  const row = db.prepare('SELECT slugs_json FROM solved_sets WHERE lc_username = ?').get(username) as
    | { slugs_json: string }
    | undefined;
  return row ? JSON.parse(row.slugs_json).sort() : [];
}

function getContribution(target: string, contributor: string): string[] | null {
  const row = db
    .prepare('SELECT slugs_json FROM contributions WHERE target_username = ? AND contributor_username = ?')
    .get(target, contributor) as { slugs_json: string } | undefined;
  return row ? JSON.parse(row.slugs_json).sort() : null;
}

function contributorsCount(target: string): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM contributions WHERE target_username = ?').get(target) as {
    c: number;
  }).c;
}

beforeEach(() => {
  db.exec(
    'DELETE FROM contributions; DELETE FROM solved_sets; DELETE FROM auth_nonces; ' +
      'DELETE FROM users; DELETE FROM public_solved_counts;'
  );
  mockedCount.mockReset();
  mockedCount.mockResolvedValue(500);
});

afterAll(() => {
  db.close();
  const p = process.env.DB_PATH!;
  if (existsSync(p)) unlinkSync(p);
});

describe('contributions: single contributor (self upload)', () => {
  it('writes a contribution row + derived solved_set row', async () => {
    const r = await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send(syncBody(['two-sum', 'three-sum']));
    expect(r.status).toBe(200);
    expect(getContribution('alice', 'alice')).toEqual(['three-sum', 'two-sum']);
    expect(getUnion('alice')).toEqual(['three-sum', 'two-sum']);
    expect(contributorsCount('alice')).toBe(1);
  });

  it('stamps last_self_sync_at on the solved_sets row', async () => {
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send(syncBody(['two-sum']));
    const row = db
      .prepare('SELECT last_self_sync_at FROM solved_sets WHERE lc_username = ?')
      .get('alice') as { last_self_sync_at: number };
    expect(row.last_self_sync_at).toBeGreaterThan(0);
  });
});

describe('contributions: two contributors union into one solved_set', () => {
  it('alice and bob both describe carol; union has every slug', async () => {
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send(syncBody([], { carol: ['two-sum'] }));
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('bob'))
      .send(syncBody([], { carol: ['three-sum'] }));
    expect(getUnion('carol')).toEqual(['three-sum', 'two-sum']);
    expect(getContribution('carol', 'alice')).toEqual(['two-sum']);
    expect(getContribution('carol', 'bob')).toEqual(['three-sum']);
    expect(contributorsCount('carol')).toBe(2);
  });

  it('overlapping slugs from two contributors stay deduped in the union', async () => {
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send(syncBody([], { carol: ['two-sum', 'three-sum'] }));
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('bob'))
      .send(syncBody([], { carol: ['three-sum', 'four-sum'] }));
    expect(getUnion('carol')).toEqual(['four-sum', 'three-sum', 'two-sum']);
    expect(contributorsCount('carol')).toBe(2);
  });

  it('re-upload from the same contributor merges with their prior contribution', async () => {
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send(syncBody([], { carol: ['two-sum'] }));
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send(syncBody([], { carol: ['three-sum'] }));
    expect(getContribution('carol', 'alice')).toEqual(['three-sum', 'two-sum']);
    expect(contributorsCount('carol')).toBe(1);
  });
});

describe('contributions: self + crowdsourced overlap on the same target', () => {
  it('alice self-uploads, then bob describes alice; union is correct and last_self_sync_at is preserved', async () => {
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send(syncBody(['two-sum', 'three-sum']));
    const selfStamp = (db.prepare('SELECT last_self_sync_at FROM solved_sets WHERE lc_username = ?').get('alice') as {
      last_self_sync_at: number;
    }).last_self_sync_at;

    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('bob'))
      .send(syncBody([], { alice: ['four-sum'] }));

    expect(getUnion('alice')).toEqual(['four-sum', 'three-sum', 'two-sum']);
    const after = (db.prepare('SELECT last_self_sync_at FROM solved_sets WHERE lc_username = ?').get('alice') as {
      last_self_sync_at: number;
    }).last_self_sync_at;
    expect(after).toBe(selfStamp);
    expect(contributorsCount('alice')).toBe(2);
  });
});

describe('contributions: public-count guard fires on the UNION', () => {
  it('two contributors whose union slightly exceeds public_count + grace is rejected for the second contributor', async () => {
    mockedCount.mockReset();
    mockedCount.mockResolvedValue(100); // tight
    const aliceSlugs = Array.from({ length: 100 }, (_, i) => `slug-${i}`);
    const bobSlugs = Array.from({ length: 60 }, (_, i) => `extra-${i}`); // pushes union past 150 (100+50 grace)

    const r1 = await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send(syncBody([], { carol: aliceSlugs }));
    expect(r1.body.friends_accepted).toEqual({ carol: 100 });

    const r2 = await request(app)
      .post('/sync')
      .set('Authorization', authHeader('bob'))
      .send(syncBody([], { carol: bobSlugs }));
    expect(r2.body.friends_rejected).toEqual({ carol: 'count_exceeded' });
    // The first contributor's data must still be intact.
    expect(getUnion('carol').length).toBe(100);
    expect(contributorsCount('carol')).toBe(1);
  });

  it('two contributors whose union fits within budget both succeed', async () => {
    mockedCount.mockReset();
    mockedCount.mockResolvedValue(100);
    const aliceSlugs = Array.from({ length: 80 }, (_, i) => `slug-${i}`);
    const bobSlugs = Array.from({ length: 40 }, (_, i) => `extra-${i}`); // union = 120 <= 150

    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send(syncBody([], { carol: aliceSlugs }));
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('bob'))
      .send(syncBody([], { carol: bobSlugs }));
    expect(getUnion('carol').length).toBe(120);
    expect(contributorsCount('carol')).toBe(2);
  });
});

describe('contributions: partial failure semantics', () => {
  it('one friend trips the guard; the rest of the upload still applies', async () => {
    mockedCount.mockReset();
    mockedCount.mockImplementation(async (u: string) => (u === 'bob' ? 1 : 500));
    const lots = Array.from({ length: 200 }, (_, i) => `x-${i}`);
    const r = await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send(syncBody(['ok-slug'], { bob: lots, carol: ['two-sum'] }));
    expect(r.body.friends_accepted).toEqual({ carol: 1 });
    expect(r.body.friends_rejected).toEqual({ bob: 'count_exceeded' });
    expect(getUnion('bob')).toEqual([]);
    expect(getUnion('carol')).toEqual(['two-sum']);
    expect(getUnion('alice')).toEqual(['ok-slug']);
  });
});

describe('GET /user/:u: contributors_count exposed', () => {
  it('reports 2 after two contributors describe the same target', async () => {
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send(syncBody([], { carol: ['two-sum'] }));
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('bob'))
      .send(syncBody([], { carol: ['three-sum'] }));
    const r = await request(app).get('/user/carol');
    expect(r.status).toBe(200);
    expect(r.body.contributors_count).toBe(2);
    expect(r.body.slugs.sort()).toEqual(['three-sum', 'two-sum']);
  });
});

describe('DELETE /user/:u: cascades to contributions', () => {
  it('removes both contributions ABOUT alice and contributions BY alice', async () => {
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send(syncBody(['x'], { bob: ['y'] }));
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('bob'))
      .send(syncBody([], { alice: ['z'] }));

    expect(contributorsCount('alice')).toBe(2); // alice self + bob about alice
    // bob = bob self (empty slugs still records a contribution row) + alice about bob
    expect(contributorsCount('bob')).toBe(2);

    await request(app).delete('/user/alice').set('Authorization', authHeader('alice'));

    // alice gone as target AND as contributor.
    expect(contributorsCount('alice')).toBe(0);
    // bob's own self-contribution persists; only alice's contribution to bob is removed.
    expect(contributorsCount('bob')).toBe(1);
    expect(getUnion('alice')).toEqual([]);
  });

  it('recomputes affected targets union after stripping the deleted user\'s contributions', async () => {
    // Two contributors describe carol.
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send(syncBody([], { carol: ['two-sum', 'three-sum'] }));
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('bob'))
      .send(syncBody([], { carol: ['four-sum'] }));
    expect(getUnion('carol').sort()).toEqual(['four-sum', 'three-sum', 'two-sum']);

    // Delete alice; carol's union should shrink to bob's contribution only.
    await request(app).delete('/user/alice').set('Authorization', authHeader('alice'));
    expect(getUnion('carol')).toEqual(['four-sum']);
    expect(contributorsCount('carol')).toBe(1);
  });

  it('drops the solved_set row when the last contributor for a target is deleted', async () => {
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send(syncBody([], { carol: ['two-sum'] }));
    expect(getUnion('carol')).toEqual(['two-sum']);
    await request(app).delete('/user/alice').set('Authorization', authHeader('alice'));
    const row = db.prepare('SELECT 1 FROM solved_sets WHERE lc_username = ?').get('carol');
    expect(row).toBeUndefined();
  });
});

describe('contributions: slug validation', () => {
  it('filters bogus slug shapes before guard + storage', async () => {
    await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send(syncBody(['two-sum', '../etc/passwd', 'OK-CAPS', 'spaces in here', 'good-slug']));
    expect(getContribution('alice', 'alice')).toEqual(['good-slug', 'two-sum']);
  });
});

describe('contributions: idempotent re-upload', () => {
  it('uploading the same payload twice changes nothing', async () => {
    const body = syncBody(['two-sum'], { bob: ['three-sum'] });
    await request(app).post('/sync').set('Authorization', authHeader('alice')).send(body);
    const beforeUnion = getUnion('bob');
    const beforeContrib = getContribution('bob', 'alice');
    await request(app).post('/sync').set('Authorization', authHeader('alice')).send(body);
    expect(getUnion('bob')).toEqual(beforeUnion);
    expect(getContribution('bob', 'alice')).toEqual(beforeContrib);
    expect(contributorsCount('bob')).toBe(1);
  });
});

describe('contributions: LeetCode-unreachable does not corrupt state', () => {
  it('502 leaves no contribution row written', async () => {
    mockedCount.mockReset();
    mockedCount.mockRejectedValueOnce(new Error('boom'));
    const r = await request(app)
      .post('/sync')
      .set('Authorization', authHeader('alice'))
      .send(syncBody(['two-sum']));
    expect(r.status).toBe(502);
    expect(getContribution('alice', 'alice')).toBeNull();
  });
});
